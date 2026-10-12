use crate::types::{Comments, SkipEmpty};

/// Options for one parse.
///
/// Empty `delimiter` or `newline` means auto-detect, matching Papa's `""` default.
/// Header rows, dynamic typing, and `skipEmptyLines` filtering are applied by the
/// TypeScript layer so JavaScript callbacks and `parseFloat` stay exact. `skip_empty`
/// is still required here because delimiter guessing uses it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseOptions {
    pub delimiter: String,
    pub newline: String,
    pub quote: String,
    pub escape: Option<String>,
    pub comments: Comments,
    pub preview: u32,
    /// Hard stop after this many committed rows. `0` parses the whole input.
    /// `step` + `preview` uses this so both fast and slow mode consume one
    /// extra row without Papa's normal `truncated` preview cursor.
    pub max_rows: u32,
    /// `None` is Papa's auto fast-mode (fast when the chunk has no quote character).
    pub fast_mode: Option<bool>,
    pub skip_empty: SkipEmpty,
    pub ignore_last_row: bool,
}

impl Default for ParseOptions {
    fn default() -> Self {
        Self {
            delimiter: String::new(),
            newline: String::new(),
            quote: "\"".to_string(),
            escape: None,
            comments: Comments::Off,
            preview: 0,
            max_rows: 0,
            fast_mode: None,
            skip_empty: SkipEmpty::False,
            ignore_last_row: false,
        }
    }
}

impl ParseOptions {
    pub fn explicit(delimiter: &str) -> Self {
        Self {
            delimiter: delimiter.to_string(),
            ..Self::default()
        }
    }
}
