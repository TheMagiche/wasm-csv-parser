use std::fmt;

/// Papa's `skipEmptyLines` values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SkipEmpty {
    #[default]
    False,
    True,
    Greedy,
}

/// `true` means Papa's default comment character `#`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum Comments {
    #[default]
    Off,
    /// Boolean `true` in Papa, which becomes `#` after the delimiter check.
    Hash,
    Literal(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorType {
    Quotes,
    Delimiter,
    FieldMismatch,
}

impl ErrorType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Quotes => "Quotes",
            Self::Delimiter => "Delimiter",
            Self::FieldMismatch => "FieldMismatch",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    MissingQuotes,
    InvalidQuotes,
    UndetectableDelimiter,
    TooFewFields,
    TooManyFields,
}

impl ErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::MissingQuotes => "MissingQuotes",
            Self::InvalidQuotes => "InvalidQuotes",
            Self::UndetectableDelimiter => "UndetectableDelimiter",
            Self::TooFewFields => "TooFewFields",
            Self::TooManyFields => "TooManyFields",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    pub kind: ErrorType,
    pub code: ErrorCode,
    pub message: &'static str,
    pub row: Option<u32>,
    pub index: Option<u32>,
}

impl ParseError {
    pub fn missing_quotes(row: u32, index: u32) -> Self {
        Self {
            kind: ErrorType::Quotes,
            code: ErrorCode::MissingQuotes,
            message: "Quoted field unterminated",
            row: Some(row),
            index: Some(index),
        }
    }

    pub fn invalid_quotes(row: u32, index: u32) -> Self {
        Self {
            kind: ErrorType::Quotes,
            code: ErrorCode::InvalidQuotes,
            message: "Trailing quote on quoted field is malformed",
            row: Some(row),
            index: Some(index),
        }
    }

    pub fn undetectable_delimiter() -> Self {
        Self {
            kind: ErrorType::Delimiter,
            code: ErrorCode::UndetectableDelimiter,
            message: "Unable to auto-detect delimiting character; defaulted to ','",
            row: None,
            index: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SetupError {
    CommentEqualsDelimiter,
    QuoteChar,
    EscapeChar,
}

impl fmt::Display for SetupError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CommentEqualsDelimiter => write!(f, "Comment character same as delimiter"),
            Self::QuoteChar => write!(f, "quoteChar must be empty or a single-byte character"),
            Self::EscapeChar => write!(f, "escapeChar must be empty or a single-byte character"),
        }
    }
}

impl std::error::Error for SetupError {}

pub fn single_byte(value: &str, what: SetupError) -> Result<Option<u8>, SetupError> {
    if value.is_empty() {
        return Ok(None);
    }
    let bytes = value.as_bytes();
    if bytes.len() == 1 {
        Ok(Some(bytes[0]))
    } else {
        Err(what)
    }
}
