//! Core CSV scanner.
//!
//! This is a direct port of Papa Parse 5.7's `Parser`, not a wrapper around
//! `csv-core`. Papa recovers from broken quotes, guesses delimiters by scoring
//! preview rows, and treats fast-mode (no quotes) differently from the quoted
//! scanner — including an off-by-one preview cursor. `csv-core` is a strict
//! RFC 4180 machine and cannot reproduce those results.
//!
//! The hot path searches with `memchr` and copies each field once into a flat
//! buffer. It does not allocate a string per field.

use crate::output::{Builder, RawParse};
use crate::text::{find_at, utf16_len};
use crate::types::ParseError;

#[derive(Debug, Clone)]
pub(crate) struct CoreConfig<'a> {
    pub delim: &'a [u8],
    pub newline: &'a [u8],
    pub quote: Option<u8>,
    pub escape: Option<u8>,
    pub comments: Option<&'a [u8]>,
    pub preview: u32,
    /// Stop after this many committed rows. `0` means no limit.
    /// Used by Papa's `step` + `preview`, which consumes one extra row and
    /// does not set `truncated` the way a normal preview does.
    pub max_rows: u32,
    pub fast_mode: Option<bool>,
    pub ignore_last_row: bool,
}

pub(crate) fn parse_core(input: &[u8], cfg: &CoreConfig<'_>) -> RawParse {
    let newline = normalize_newline(cfg.newline);
    let delim = if cfg.delim.is_empty() {
        b",".as_slice()
    } else {
        cfg.delim
    };
    let use_fast = match cfg.fast_mode {
        Some(true) => true,
        Some(false) => false,
        None => match cfg.quote {
            Some(q) => !input.contains(&q),
            // Papa: indexOf("") === 0, so empty quoteChar disables fast-mode.
            None => false,
        },
    };

    if input.is_empty() {
        return RawParse {
            bytes: Vec::new(),
            field_ends: Vec::new(),
            row_ends: Vec::new(),
            row_cursors: Vec::new(),
            errors: Vec::new(),
            delimiter: String::from_utf8_lossy(delim).into_owned(),
            linebreak: String::from_utf8_lossy(newline).into_owned(),
            aborted: false,
            truncated: false,
            cursor: 0,
            cursor_bytes: 0,
            ascii: true,
        };
    }

    let mut parsed = if use_fast {
        parse_fast(input, delim, newline, cfg)
    } else {
        parse_slow(input, delim, newline, cfg)
    };
    parsed.delimiter = String::from_utf8_lossy(delim).into_owned();
    parsed.linebreak = String::from_utf8_lossy(newline).into_owned();
    parsed
}

fn normalize_newline(newline: &[u8]) -> &[u8] {
    if newline == b"\n" || newline == b"\r" || newline == b"\r\n" {
        newline
    } else {
        b"\n"
    }
}

fn parse_fast(input: &[u8], delim: &[u8], newline: &[u8], cfg: &CoreConfig<'_>) -> RawParse {
    let mut builder = Builder::with_capacity(input.len());
    let mut pos = 0usize;
    let mut i = 0u32;
    let mut last_byte = 0usize;
    let mut last_utf16 = 0u32;
    let mut cursor_utf16 = 0u32;
    let mut truncated = false;

    loop {
        if pos > input.len() {
            break;
        }
        let found = find_at(input, newline, pos);
        let (row_end, next_pos, is_last) = if let Some(nl) = found {
            (nl, nl + newline.len(), false)
        } else {
            (input.len(), input.len(), true)
        };
        let row = &input[pos..row_end];
        cursor_utf16 += utf16_len(row);
        let mut cursor_byte = row_end;
        if !is_last {
            cursor_utf16 += utf16_len(newline);
            cursor_byte = next_pos;
        } else if cfg.ignore_last_row {
            break;
        }

        // Empty comment string matches every row, same as Papa's `substring(0, 0) === ""`.
        let is_comment = cfg.comments.is_some_and(|c| row.starts_with(c));
        if !is_comment {
            push_split(&mut builder, row, delim);
            builder.commit_row(cursor_utf16);
            last_byte = cursor_byte;
            last_utf16 = cursor_utf16;
            if cfg.max_rows > 0 && builder.row_ends.len() as u32 >= cfg.max_rows {
                break;
            }
            if cfg.preview > 0 && i >= cfg.preview {
                builder.truncate_rows(cfg.preview as usize);
                truncated = true;
                break;
            }
        }

        if is_last {
            break;
        }
        pos = next_pos;
        i += 1;
    }

    pack(builder, Vec::new(), last_utf16, last_byte, truncated)
}

fn push_split(builder: &mut Builder, row: &[u8], delim: &[u8]) {
    if delim.is_empty() {
        builder.push_bytes(row);
        return;
    }
    let mut start = 0usize;
    while let Some(rel) = find_at(row, delim, start) {
        builder.push_bytes(&row[start..rel]);
        start = rel + delim.len();
        if start > row.len() {
            break;
        }
    }
    builder.push_bytes(&row[start.min(row.len())..]);
}

struct Slow<'a> {
    input: &'a [u8],
    delim: &'a [u8],
    newline: &'a [u8],
    comments: Option<&'a [u8]>,
    quote: Option<u8>,
    escape: Option<u8>,
    preview: u32,
    max_rows: u32,
    ignore_last: bool,
    cursor: usize,
    cursor_utf16: u32,
    last_byte: usize,
    last_utf16: u32,
    next_delim: Option<usize>,
    next_newline: Option<usize>,
    builder: Builder,
    errors: Vec<ParseError>,
    truncated: bool,
}

fn parse_slow(input: &[u8], delim: &[u8], newline: &[u8], cfg: &CoreConfig<'_>) -> RawParse {
    let mut s = Slow {
        input,
        delim,
        newline,
        comments: cfg.comments,
        quote: cfg.quote,
        escape: cfg.escape,
        preview: cfg.preview,
        max_rows: cfg.max_rows,
        ignore_last: cfg.ignore_last_row,
        cursor: 0,
        cursor_utf16: 0,
        last_byte: 0,
        last_utf16: 0,
        next_delim: find_at(input, delim, 0),
        next_newline: find_at(input, newline, 0),
        builder: Builder::with_capacity(input.len()),
        errors: Vec::new(),
        truncated: false,
    };
    s.run();
    pack(s.builder, s.errors, s.last_utf16, s.last_byte, s.truncated)
}

impl<'a> Slow<'a> {
    fn run(&mut self) {
        loop {
            if self.opened_quote() {
                if self.scan_quoted_field() {
                    return;
                }
                continue;
            }

            if self.at_comment() {
                if self.next_newline.is_none() {
                    self.discard_partial();
                    return;
                }
                let nl = self.next_newline.unwrap();
                self.seek(nl + self.newline.len());
                self.next_newline = find_at(self.input, self.newline, self.cursor);
                self.next_delim = find_at(self.input, self.delim, self.cursor);
                continue;
            }

            if let Some(nd) = self.next_delim {
                if self.next_newline.is_none_or(|nn| nd < nn) {
                    self.push_source(self.cursor, nd);
                    self.seek(nd + self.delim.len());
                    self.next_delim = find_at(self.input, self.delim, self.cursor);
                    continue;
                }
            }

            if let Some(nn) = self.next_newline {
                self.push_source(self.cursor, nn);
                self.save_row(nn + self.newline.len());
                if self.hit_row_cap() {
                    return;
                }
                continue;
            }

            break;
        }
        self.finish(None);
    }

    /// Returns true when the caller should stop the parse (EOF / preview / ignore).
    fn scan_quoted_field(&mut self) -> bool {
        let quote = self.quote.unwrap();
        let mut quote_search = self.cursor;
        self.seek(self.cursor + 1);

        loop {
            quote_search = match find_at(self.input, &[quote], quote_search + 1) {
                Some(pos) => pos,
                None => {
                    if !self.ignore_last {
                        let row = self.row_count();
                        let index = self.cursor_utf16;
                        self.errors.push(ParseError::missing_quotes(row, index));
                    }
                    self.finish(None);
                    return true;
                }
            };

            if quote_search + 1 == self.input.len() {
                let value_start = self.cursor;
                self.finish(Some((value_start, quote_search)));
                return true;
            }

            if self.quote == self.escape
                && quote_search + 1 < self.input.len()
                && self.input[quote_search + 1] == quote
            {
                quote_search += 1;
                continue;
            }

            if self.quote != self.escape
                && quote_search > 0
                && self
                    .escape
                    .is_some_and(|esc| self.input[quote_search - 1] == esc)
            {
                continue;
            }

            let quote_end = quote_search + 1;
            if self.next_delim.is_some_and(|nd| nd < quote_end) {
                self.next_delim = find_at(self.input, self.delim, quote_end);
            }
            if self.next_newline.is_some_and(|nn| nn < quote_end) {
                self.next_newline = find_at(self.input, self.newline, quote_end);
            }

            let check_up_to = match self.next_newline {
                None => self.next_delim,
                Some(nn) => self.next_delim.map(|nd| nd.min(nn)),
            };
            let spaces = self.extra_spaces(check_up_to, quote_end);
            let after_spaces = quote_end + spaces;
            if self
                .input
                .get(after_spaces..)
                .is_some_and(|rest| rest.starts_with(self.delim))
            {
                self.push_unescaped(self.cursor, quote_search);
                self.seek(after_spaces + self.delim.len());
                self.next_delim = find_at(self.input, self.delim, self.cursor);
                self.next_newline = find_at(self.input, self.newline, self.cursor);
                return false;
            }

            let spaces_nl = self.extra_spaces(self.next_newline, quote_end);
            let nl_at = quote_end + spaces_nl;
            if self
                .input
                .get(nl_at..)
                .is_some_and(|rest| rest.starts_with(self.newline))
            {
                self.push_unescaped(self.cursor, quote_search);
                self.save_row(nl_at + self.newline.len());
                self.next_delim = find_at(self.input, self.delim, self.cursor);
                return self.hit_row_cap();
            }

            let row = self.row_count();
            let index = self.cursor_utf16;
            self.errors.push(ParseError::invalid_quotes(row, index));
            quote_search += 1;
        }
    }

    fn finish(&mut self, quoted: Option<(usize, usize)>) {
        if self.ignore_last {
            self.discard_partial();
            return;
        }
        if let Some((start, end)) = quoted {
            self.push_unescaped(start, end);
        } else if self.cursor <= self.input.len() {
            self.push_source(self.cursor, self.input.len());
        }
        self.seek(self.input.len());
        self.builder.commit_row(self.cursor_utf16);
        self.last_byte = self.cursor;
        self.last_utf16 = self.cursor_utf16;
    }

    fn save_row(&mut self, new_cursor: usize) {
        self.seek(new_cursor);
        self.builder.commit_row(self.cursor_utf16);
        self.last_byte = self.cursor;
        self.last_utf16 = self.cursor_utf16;
        self.next_newline = find_at(self.input, self.newline, self.cursor);
    }

    fn discard_partial(&mut self) {
        let finished = self.row_count();
        self.errors
            .retain(|err| err.row.is_none_or(|r| r < finished));
        self.builder.discard_open_row();
    }

    fn opened_quote(&self) -> bool {
        match self.quote {
            Some(q) if self.cursor < self.input.len() => self.input[self.cursor] == q,
            _ => false,
        }
    }

    fn at_comment(&self) -> bool {
        let Some(comments) = self.comments else {
            return false;
        };
        if self.builder.open_field_count() != 0 {
            return false;
        }
        self.input
            .get(self.cursor..)
            .is_some_and(|rest| rest.starts_with(comments))
    }

    fn row_count(&self) -> u32 {
        self.builder.row_ends.len() as u32
    }

    /// Papa preview sets `truncated`. `max_rows` stops without that flag.
    fn hit_row_cap(&mut self) -> bool {
        if self.max_rows > 0 && self.row_count() >= self.max_rows {
            return true;
        }
        if self.preview > 0 && self.row_count() >= self.preview {
            self.truncated = true;
            return true;
        }
        false
    }

    fn push_source(&mut self, start: usize, end: usize) {
        let end = end.min(self.input.len());
        let start = start.min(end);
        self.builder.push_bytes(&self.input[start..end]);
    }

    fn push_unescaped(&mut self, start: usize, end: usize) {
        let end = end.min(self.input.len());
        let start = start.min(end);
        self.builder
            .push_unescaped(&self.input[start..end], self.escape, self.quote);
    }

    fn seek(&mut self, new_byte: usize) {
        let new_byte = new_byte.min(self.input.len());
        if new_byte >= self.cursor {
            self.cursor_utf16 += utf16_len(&self.input[self.cursor..new_byte]);
            self.cursor = new_byte;
        }
    }

    fn extra_spaces(&self, index: Option<usize>, quote_end: usize) -> usize {
        let Some(index) = index else {
            return 0;
        };
        if index < quote_end || index > self.input.len() {
            return 0;
        }
        let gap = &self.input[quote_end..index];
        if gap.is_empty() {
            return 0;
        }
        if crate::text::js_trim_is_empty(gap) {
            gap.len()
        } else {
            0
        }
    }
}

fn pack(
    builder: Builder,
    errors: Vec<ParseError>,
    cursor: u32,
    cursor_bytes: usize,
    truncated: bool,
) -> RawParse {
    let (bytes, field_ends, row_ends, row_cursors, ascii) = builder.into_parts();
    RawParse {
        bytes,
        field_ends,
        row_ends,
        row_cursors,
        errors,
        delimiter: String::new(),
        linebreak: String::new(),
        aborted: false,
        truncated,
        cursor,
        cursor_bytes: cursor_bytes as u32,
        ascii,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg<'a>(delim: &'a [u8], newline: &'a [u8]) -> CoreConfig<'a> {
        CoreConfig {
            delim,
            newline,
            quote: Some(b'"'),
            escape: Some(b'"'),
            comments: None,
            preview: 0,
            max_rows: 0,
            fast_mode: None,
            ignore_last_row: false,
        }
    }

    #[test]
    fn quoted_escape_and_eof() {
        let rows = parse_core(br#""a""b""#, &cfg(b",", b"\n")).records();
        assert_eq!(rows, vec![vec!["a\"b"]]);

        let parsed = parse_core(br#""ab"""#, &cfg(b",", b"\n"));
        assert_eq!(parsed.records(), vec![vec!["ab\"\""]]);
        assert_eq!(
            parsed.errors[0].code,
            crate::types::ErrorCode::MissingQuotes
        );

        let rows = parse_core(br#""""#, &cfg(b",", b"\n")).records();
        assert_eq!(rows, vec![vec![""]]);
    }
}
