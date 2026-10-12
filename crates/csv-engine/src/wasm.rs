//! wasm-bindgen exports. The Rust crate stays usable without calling these.

use wasm_bindgen::prelude::*;

use crate::config::ParseOptions;
use crate::output::RawParse;
use crate::stream::StreamParser;
use crate::types::{Comments, SetupError, SkipEmpty};

#[wasm_bindgen]
pub struct RawOutput {
    bytes: Vec<u8>,
    field_ends: Vec<u32>,
    row_ends: Vec<u32>,
    row_cursors: Vec<u32>,
    error_kinds: Vec<u8>,
    error_codes: Vec<u8>,
    error_rows: Vec<i32>,
    error_indexes: Vec<i32>,
    delimiter: String,
    linebreak: String,
    aborted: bool,
    truncated: bool,
    cursor: u32,
    ascii: bool,
}

#[wasm_bindgen]
impl RawOutput {
    pub fn take_bytes(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.bytes)
    }
    pub fn take_field_ends(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.field_ends)
    }
    pub fn take_row_ends(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.row_ends)
    }
    pub fn take_row_cursors(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.row_cursors)
    }
    pub fn take_error_kinds(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.error_kinds)
    }
    pub fn take_error_codes(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.error_codes)
    }
    pub fn take_error_rows(&mut self) -> Vec<i32> {
        std::mem::take(&mut self.error_rows)
    }
    pub fn take_error_indexes(&mut self) -> Vec<i32> {
        std::mem::take(&mut self.error_indexes)
    }

    #[wasm_bindgen(getter)]
    pub fn delimiter(&self) -> String {
        self.delimiter.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn linebreak(&self) -> String {
        self.linebreak.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn aborted(&self) -> bool {
        self.aborted
    }
    #[wasm_bindgen(getter)]
    pub fn truncated(&self) -> bool {
        self.truncated
    }
    #[wasm_bindgen(getter)]
    pub fn cursor(&self) -> u32 {
        self.cursor
    }
    #[wasm_bindgen(getter)]
    pub fn ascii(&self) -> bool {
        self.ascii
    }
}

fn to_output(raw: RawParse) -> RawOutput {
    let mut error_kinds = Vec::with_capacity(raw.errors.len());
    let mut error_codes = Vec::with_capacity(raw.errors.len());
    let mut error_rows = Vec::with_capacity(raw.errors.len());
    let mut error_indexes = Vec::with_capacity(raw.errors.len());
    for err in &raw.errors {
        error_kinds.push(match err.kind {
            crate::types::ErrorType::Quotes => 0,
            crate::types::ErrorType::Delimiter => 1,
            crate::types::ErrorType::FieldMismatch => 2,
        });
        error_codes.push(match err.code {
            crate::types::ErrorCode::MissingQuotes => 0,
            crate::types::ErrorCode::InvalidQuotes => 1,
            crate::types::ErrorCode::UndetectableDelimiter => 2,
            crate::types::ErrorCode::TooFewFields => 3,
            crate::types::ErrorCode::TooManyFields => 4,
        });
        error_rows.push(err.row.map(|v| v as i32).unwrap_or(-1));
        error_indexes.push(err.index.map(|v| v as i32).unwrap_or(-1));
    }
    RawOutput {
        bytes: raw.bytes,
        field_ends: raw.field_ends,
        row_ends: raw.row_ends,
        row_cursors: raw.row_cursors,
        error_kinds,
        error_codes,
        error_rows,
        error_indexes,
        delimiter: raw.delimiter,
        linebreak: raw.linebreak,
        aborted: raw.aborted,
        truncated: raw.truncated,
        cursor: raw.cursor,
        ascii: raw.ascii,
    }
}

// Flat arguments are the wasm ABI: one call per chunk, never per row.
#[allow(clippy::too_many_arguments)]
fn options_from_parts(
    delimiter: &str,
    newline: &str,
    quote: &str,
    escape: &str,
    escape_set: bool,
    comments_mode: u8,
    comments: &str,
    preview: u32,
    max_rows: u32,
    fast_mode: i32,
    skip_empty: u8,
) -> ParseOptions {
    let comments = match comments_mode {
        1 => Comments::Hash,
        2 => Comments::Literal(comments.to_string()),
        _ => Comments::Off,
    };
    let skip_empty = match skip_empty {
        1 => SkipEmpty::True,
        2 => SkipEmpty::Greedy,
        _ => SkipEmpty::False,
    };
    let fast_mode = match fast_mode {
        0 => Some(false),
        1 => Some(true),
        _ => None,
    };
    ParseOptions {
        delimiter: delimiter.to_string(),
        newline: newline.to_string(),
        quote: quote.to_string(),
        escape: if escape_set {
            Some(escape.to_string())
        } else {
            None
        },
        comments,
        preview,
        max_rows,
        fast_mode,
        skip_empty,
        ignore_last_row: false,
    }
}

fn map_err(err: SetupError) -> JsValue {
    JsValue::from_str(&err.to_string())
}

#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn parse_bytes(
    input: &[u8],
    delimiter: &str,
    newline: &str,
    quote: &str,
    escape: &str,
    escape_set: bool,
    comments_mode: u8,
    comments: &str,
    preview: u32,
    max_rows: u32,
    fast_mode: i32,
    skip_empty: u8,
) -> Result<RawOutput, JsValue> {
    let opts = options_from_parts(
        delimiter,
        newline,
        quote,
        escape,
        escape_set,
        comments_mode,
        comments,
        preview,
        max_rows,
        fast_mode,
        skip_empty,
    );
    crate::parse_csv_bytes(input, &opts)
        .map(to_output)
        .map_err(map_err)
}

#[wasm_bindgen]
pub struct WasmStream {
    inner: StreamParser,
}

#[wasm_bindgen]
impl WasmStream {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        delimiter: &str,
        newline: &str,
        quote: &str,
        escape: &str,
        escape_set: bool,
        comments_mode: u8,
        comments: &str,
        preview: u32,
        fast_mode: i32,
        skip_empty: u8,
    ) -> WasmStream {
        let _ = preview;
        WasmStream {
            inner: StreamParser::new(options_from_parts(
                delimiter,
                newline,
                quote,
                escape,
                escape_set,
                comments_mode,
                comments,
                0,
                0,
                fast_mode,
                skip_empty,
            )),
        }
    }

    pub fn feed(&mut self, chunk: &[u8]) -> Result<RawOutput, JsValue> {
        self.inner.feed(chunk).map(to_output).map_err(map_err)
    }

    pub fn finish(&mut self) -> Result<RawOutput, JsValue> {
        self.inner.finish().map(to_output).map_err(map_err)
    }

    pub fn abort(&mut self) {
        self.inner.abort();
    }
}
