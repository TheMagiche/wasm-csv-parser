//! Chunked parser.
//!
//! `feed` keeps one partial row (a quoted field may cross a chunk boundary).
//! `finish` emits that row. Concatenating `feed` + `finish` matches a one-shot
//! parse when every chunk is parsed with the same resolved delimiter, which is
//! how Papa locks detection after the first chunk.

use crate::config::ParseOptions;
use crate::detect::{resolve, Resolved};
use crate::output::RawParse;
use crate::parser::{parse_core, CoreConfig};
use crate::text::strip_bom;
use crate::types::{ParseError, SetupError};

#[derive(Debug)]
pub struct StreamParser {
    opts: ParseOptions,
    resolved: Option<Resolved>,
    pending: Vec<u8>,
    bom_checked: bool,
    delim_error_pending: bool,
    base_utf16: u32,
    rows_emitted: u32,
    /// A trailing empty row was suppressed because this chunk was not final.
    deferred_empty: bool,
    aborted: bool,
}

impl StreamParser {
    pub fn new(opts: ParseOptions) -> Self {
        Self {
            opts,
            resolved: None,
            pending: Vec::new(),
            bom_checked: false,
            delim_error_pending: false,
            base_utf16: 0,
            rows_emitted: 0,
            deferred_empty: false,
            aborted: false,
        }
    }

    pub fn abort(&mut self) {
        self.aborted = true;
        self.pending.clear();
        self.deferred_empty = false;
    }

    pub fn feed(&mut self, chunk: &[u8]) -> Result<RawParse, SetupError> {
        if self.aborted {
            return Ok(self.empty(true));
        }
        if !chunk.is_empty() {
            self.deferred_empty = false;
        }
        self.pending.extend_from_slice(chunk);
        self.strip_bom_once();
        if self.pending.is_empty() {
            return Ok(self.empty(false));
        }
        // Auto newline/delimiter must see a real line break. Locking on the
        // first byte guesses `\n` and then treats a later `\r` as field data,
        // so `feed` of arbitrary chunk sizes would not match a one-shot parse.
        // A buffer that ends in `\r` is also unfinished: the next byte may make
        // it `\r\n`. `finish` resolves whatever is left.
        if self.resolved.is_none() && !self.detection_ready() {
            return Ok(self.empty(false));
        }
        self.ensure_resolved()?;

        let buffer_ends_with_nl = self
            .resolved
            .as_ref()
            .is_some_and(|r| !r.newline.is_empty() && self.pending.ends_with(&r.newline));

        let mut raw = self.parse_pending(true)?;
        let consumed = (raw.cursor_bytes as usize).min(self.pending.len());
        let consumed_all = consumed == self.pending.len();
        self.shift(&mut raw, consumed);
        if consumed_all && buffer_ends_with_nl {
            self.deferred_empty = true;
        }
        Ok(raw)
    }

    pub fn finish(&mut self) -> Result<RawParse, SetupError> {
        if self.aborted {
            return Ok(self.empty(true));
        }
        self.strip_bom_once();
        if self.resolved.is_none() {
            let mut opts = self.opts.clone();
            opts.ignore_last_row = false;
            let raw = crate::parse_csv_bytes(&self.pending, &opts)?;
            self.pending.clear();
            self.deferred_empty = false;
            return Ok(raw);
        }

        if self.pending.is_empty() {
            let mut raw = self.empty(false);
            if self.deferred_empty {
                raw.field_ends.push(raw.bytes.len() as u32);
                raw.row_ends.push(raw.field_ends.len() as u32);
                raw.row_cursors.push(self.base_utf16);
                raw.cursor = self.base_utf16;
                self.rows_emitted += 1;
                self.deferred_empty = false;
            }
            return Ok(raw);
        }

        self.deferred_empty = false;
        let mut raw = self.parse_pending(false)?;
        let consumed = (raw.cursor_bytes as usize).min(self.pending.len());
        self.shift(&mut raw, consumed);
        self.pending.clear();
        Ok(raw)
    }

    fn detection_ready(&self) -> bool {
        if !self.opts.newline.is_empty() {
            return true;
        }
        if self.pending.ends_with(b"\r") {
            return false;
        }
        self.pending.contains(&b'\n') || self.pending.contains(&b'\r')
    }

    fn strip_bom_once(&mut self) {
        if self.bom_checked {
            return;
        }
        if self.pending.starts_with(&[0xEF, 0xBB, 0xBF]) {
            self.pending.drain(..3);
        }
        self.bom_checked = true;
    }

    fn ensure_resolved(&mut self) -> Result<(), SetupError> {
        if self.resolved.is_some() {
            return Ok(());
        }
        let resolved = resolve(&self.pending, &self.opts)?;
        self.delim_error_pending = resolved.delim_error;
        self.resolved = Some(resolved);
        Ok(())
    }

    fn parse_pending(&mut self, ignore_last: bool) -> Result<RawParse, SetupError> {
        let resolved = self.resolved.as_ref().expect("resolved");
        let comments = resolved.comments.clone();
        let mut raw = parse_core(
            &self.pending,
            &CoreConfig {
                delim: &resolved.delim,
                newline: &resolved.newline,
                quote: resolved.quote,
                escape: resolved.escape,
                comments: comments.as_deref(),
                preview: 0,
                max_rows: 0,
                fast_mode: self.opts.fast_mode,
                ignore_last_row: ignore_last,
            },
        );
        if self.delim_error_pending {
            raw.errors.push(ParseError::undetectable_delimiter());
            self.delim_error_pending = false;
        }
        Ok(raw)
    }

    fn shift(&mut self, raw: &mut RawParse, consumed: usize) {
        let base = self.base_utf16;
        let rows_before = self.rows_emitted;
        for err in &mut raw.errors {
            if let Some(index) = err.index.as_mut() {
                *index = index.saturating_add(base);
            }
            if let Some(row) = err.row.as_mut() {
                *row = row.saturating_add(rows_before);
            }
        }
        for cursor in &mut raw.row_cursors {
            *cursor = cursor.saturating_add(base);
        }
        raw.cursor = raw.cursor.saturating_add(base);
        self.base_utf16 = raw.cursor;
        self.rows_emitted = self.rows_emitted.saturating_add(raw.row_ends.len() as u32);
        self.pending.drain(..consumed);
    }

    fn empty(&self, aborted: bool) -> RawParse {
        let (delimiter, linebreak) = if let Some(resolved) = &self.resolved {
            (
                String::from_utf8_lossy(&resolved.delim).into_owned(),
                String::from_utf8_lossy(&resolved.newline).into_owned(),
            )
        } else {
            (String::new(), String::new())
        };
        RawParse {
            bytes: Vec::new(),
            field_ends: Vec::new(),
            row_ends: Vec::new(),
            row_cursors: Vec::new(),
            errors: Vec::new(),
            delimiter,
            linebreak,
            aborted,
            truncated: false,
            cursor: self.base_utf16,
            cursor_bytes: 0,
            ascii: true,
        }
    }
}

/// One-shot entry used by `finish` before any chunk has resolved a delimiter.
pub(crate) fn parse_oneshot(input: &[u8], opts: &ParseOptions) -> Result<RawParse, SetupError> {
    let stripped = strip_bom(input);
    let resolved = resolve(stripped, opts)?;
    let comments = resolved.comments.clone();
    let mut raw = parse_core(
        stripped,
        &CoreConfig {
            delim: &resolved.delim,
            newline: &resolved.newline,
            quote: resolved.quote,
            escape: resolved.escape,
            comments: comments.as_deref(),
            preview: opts.preview,
            max_rows: opts.max_rows,
            fast_mode: opts.fast_mode,
            ignore_last_row: opts.ignore_last_row,
        },
    );
    if resolved.delim_error {
        raw.errors.push(ParseError::undetectable_delimiter());
    }
    let _ = stripped;
    Ok(raw)
}
