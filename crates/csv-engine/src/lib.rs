//! Papa Parse-compatible CSV records, as a flat buffer.
//!
//! The scanner is a Rust port of Papa Parse 5.7. Header objects, dynamic
//! typing, and `skipEmptyLines` filtering live in the JavaScript wrapper,
//! because those steps call user functions and JavaScript `parseFloat` / `Date`.
//! Delimiter guessing still sees `skip_empty`, since Papa scores preview rows
//! with that setting.
//!
//! No `unsafe` code. `csv-core` is not used: it cannot reproduce Papa's quote
//! recovery, fast-mode preview cursor, or delimiter heuristic.

mod config;
mod detect;
mod output;
mod parser;
mod stream;
mod text;
mod types;
#[cfg(target_arch = "wasm32")]
mod wasm;
#[cfg(not(target_arch = "wasm32"))]
mod wasm;

pub use config::ParseOptions;
pub use output::RawParse;
pub use stream::StreamParser;
pub use types::{Comments, ErrorCode, ErrorType, ParseError, SetupError, SkipEmpty};

use text::strip_bom;

/// Parse a Unicode string. Cursors match JavaScript's UTF-16 indexes.
pub fn parse_csv(input: &str, opts: &ParseOptions) -> Result<RawParse, SetupError> {
    parse_csv_bytes(input.as_bytes(), opts)
}

/// Parse UTF-8 bytes. A leading UTF-8 BOM is stripped and excluded from `cursor`.
pub fn parse_csv_bytes(input: &[u8], opts: &ParseOptions) -> Result<RawParse, SetupError> {
    let stripped = strip_bom(input);
    stream::parse_oneshot(stripped, opts)
}
