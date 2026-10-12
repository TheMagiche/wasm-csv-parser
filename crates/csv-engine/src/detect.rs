//! Newline and delimiter guessing, copied from Papa Parse 5.7's
//! `guessLineEndings` and `guessDelimiter`.

use crate::config::ParseOptions;
use crate::parser::{parse_core, CoreConfig};
use crate::text::{find_at, is_bad_delimiter, is_js_whitespace, strip_bom, utf16_prefix};
use crate::types::{single_byte, Comments, SetupError, SkipEmpty};

pub(crate) const DEFAULT_DELIMITERS: [&str; 6] = [",", "\t", "|", ";", "\u{1e}", "\u{1f}"];

#[derive(Debug, Clone)]
pub(crate) struct Resolved {
    pub delim: Vec<u8>,
    pub newline: Vec<u8>,
    pub quote: Option<u8>,
    pub escape: Option<u8>,
    pub comments: Option<Vec<u8>>,
    pub delim_error: bool,
}

pub(crate) fn resolve(input: &[u8], opts: &ParseOptions) -> Result<Resolved, SetupError> {
    let input = strip_bom(input);
    let quote = single_byte(&opts.quote, SetupError::QuoteChar)?;
    let escape = match &opts.escape {
        None => quote,
        Some(value) => single_byte(value, SetupError::EscapeChar)?,
    };

    let newline = if opts.newline.is_empty() {
        guess_newline(input, quote)
    } else {
        normalize_newline(opts.newline.as_bytes()).to_vec()
    };

    let (delim, delim_error) = if opts.delimiter.is_empty() {
        match guess_delimiter(input, &newline, opts)? {
            Some(best) => (best, false),
            None => (b",".to_vec(), true),
        }
    } else {
        (finalize_delim(opts.delimiter.as_bytes()), false)
    };

    let comments = finalize_comments(&opts.comments, &delim)?;

    Ok(Resolved {
        delim,
        newline,
        quote,
        escape,
        comments,
        delim_error,
    })
}

fn normalize_newline(newline: &[u8]) -> &[u8] {
    if newline == b"\n" || newline == b"\r" || newline == b"\r\n" {
        newline
    } else {
        b"\n"
    }
}

pub(crate) fn finalize_delim(delim: &[u8]) -> Vec<u8> {
    if delim.is_empty() || is_bad_delimiter(delim) {
        b",".to_vec()
    } else {
        delim.to_vec()
    }
}

pub(crate) fn finalize_comments(
    comments: &Comments,
    delim: &[u8],
) -> Result<Option<Vec<u8>>, SetupError> {
    match comments {
        Comments::Off => Ok(None),
        // Boolean `true` is compared before it becomes `#`, so it never throws.
        Comments::Hash => Ok(Some(b"#".to_vec())),
        Comments::Literal(value) => {
            let bytes = value.as_bytes();
            if bytes == delim {
                return Err(SetupError::CommentEqualsDelimiter);
            }
            if is_bad_delimiter(bytes) {
                return Ok(None);
            }
            Ok(Some(bytes.to_vec()))
        }
    }
}

fn guess_newline(input: &[u8], quote: Option<u8>) -> Vec<u8> {
    let prefix = utf16_prefix(input, 1024 * 1024);
    let stripped = match quote {
        Some(q) => strip_quoted_regions(prefix, q),
        None => prefix.to_vec(),
    };
    decide_newline(&stripped)
}

fn strip_quoted_regions(input: &[u8], quote: u8) -> Vec<u8> {
    let mut out = Vec::with_capacity(input.len());
    let mut i = 0;
    while i < input.len() {
        match find_at(input, &[quote], i) {
            Some(start) => {
                out.extend_from_slice(&input[i..start]);
                let after = start + 1;
                match find_at(input, &[quote], after) {
                    Some(end) => i = end + 1,
                    None => {
                        out.extend_from_slice(&input[start..]);
                        break;
                    }
                }
            }
            None => {
                out.extend_from_slice(&input[i..]);
                break;
            }
        }
    }
    out
}

fn decide_newline(input: &[u8]) -> Vec<u8> {
    let r_count = memchr::memchr_iter(b'\r', input).count() + 1;
    let n_count = memchr::memchr_iter(b'\n', input).count() + 1;
    let first_lf = memchr::memchr(b'\n', input).unwrap_or(input.len());
    let first_cr = memchr::memchr(b'\r', input).unwrap_or(input.len());
    let n_appears_first = n_count > 1 && first_lf < first_cr;
    if r_count == 1 || n_appears_first {
        return b"\n".to_vec();
    }

    let mut num_with_n = 0usize;
    if input.first() == Some(&b'\n') {
        num_with_n += 1;
    }
    for idx in memchr::memchr_iter(b'\r', input) {
        if input.get(idx + 1) == Some(&b'\n') {
            num_with_n += 1;
        }
    }
    if (num_with_n as f64) >= (r_count as f64) / 2.0 {
        b"\r\n".to_vec()
    } else {
        b"\r".to_vec()
    }
}

fn guess_delimiter(
    input: &[u8],
    newline: &[u8],
    opts: &ParseOptions,
) -> Result<Option<Vec<u8>>, SetupError> {
    // Papa's guess parser always uses `"` / `"`, ignoring the caller's quote.
    let auto_fast = Some(!input.contains(&b'"'));
    let mut best: Option<(Vec<u8>, i64, f64)> = None;

    for cand in DEFAULT_DELIMITERS {
        let delim = finalize_delim(cand.as_bytes());
        // Constructing the preview parser throws if this candidate equals comments.
        let comments = finalize_comments(&opts.comments, &delim)?;
        let parsed = parse_core(
            input,
            &CoreConfig {
                delim: &delim,
                newline,
                quote: Some(b'"'),
                escape: Some(b'"'),
                comments: comments.as_deref(),
                preview: 10,
                max_rows: 0,
                fast_mode: auto_fast,
                ignore_last_row: false,
            },
        );
        let rows = parsed.records();
        let mut delta: i64 = 0;
        let mut avg = 0.0f64;
        let mut empty_lines = 0usize;
        let mut prev: Option<i64> = None;
        for row in &rows {
            if opts.skip_empty != SkipEmpty::False && row_is_skippable(row, opts.skip_empty) {
                empty_lines += 1;
                continue;
            }
            let count = row.len() as i64;
            avg += count as f64;
            if let Some(previous) = prev {
                if count > 0 {
                    delta += (count - previous).abs();
                    prev = Some(count);
                }
            } else {
                prev = Some(count);
            }
        }
        if !rows.is_empty() {
            avg /= rows.len() as f64 - empty_lines as f64;
        }
        let wins = avg > 1.99
            && match &best {
                None => true,
                Some((_, best_delta, best_avg)) => {
                    delta < *best_delta || (delta == *best_delta && avg > *best_avg)
                }
            };
        if wins {
            best = Some((delim, delta, avg));
        }
    }

    Ok(best.map(|(delim, _, _)| delim))
}

fn row_is_skippable(row: &[String], skip: SkipEmpty) -> bool {
    match skip {
        SkipEmpty::False => false,
        SkipEmpty::True => row.len() == 1 && row[0].is_empty(),
        SkipEmpty::Greedy => {
            let joined = row.concat();
            joined.trim_matches(is_js_whitespace).is_empty()
        }
    }
}
