use crate::types::ParseError;

/// Flat field buffer.
///
/// `field_ends[i]` is the exclusive **byte** offset of field `i` in `bytes`.
/// Field `i` occupies `bytes[prev..field_ends[i]]` where `prev` is 0 or the
/// previous field's end. `row_ends[r]` is the exclusive field index of row `r`.
///
/// When `ascii` is true, those byte offsets are also UTF-16 offsets into
/// `TextDecoder.decode(bytes)`, so JavaScript can slice one string.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawParse {
    pub bytes: Vec<u8>,
    pub field_ends: Vec<u32>,
    pub row_ends: Vec<u32>,
    /// UTF-16 cursor (into the source, not the packed buffer) after each emitted row.
    pub row_cursors: Vec<u32>,
    pub errors: Vec<ParseError>,
    pub delimiter: String,
    pub linebreak: String,
    pub aborted: bool,
    pub truncated: bool,
    pub cursor: u32,
    pub cursor_bytes: u32,
    pub ascii: bool,
}

impl RawParse {
    pub fn records(&self) -> Vec<Vec<String>> {
        let mut rows = Vec::with_capacity(self.row_ends.len());
        let mut field_idx = 0usize;
        let mut byte_start = 0usize;
        for &row_end in &self.row_ends {
            let row_end = row_end as usize;
            let mut row = Vec::with_capacity(row_end - field_idx);
            while field_idx < row_end {
                let byte_end = self.field_ends[field_idx] as usize;
                let slice = &self.bytes[byte_start..byte_end];
                row.push(String::from_utf8_lossy(slice).into_owned());
                byte_start = byte_end;
                field_idx += 1;
            }
            rows.push(row);
        }
        rows
    }
}

#[derive(Debug)]
pub(crate) struct Builder {
    pub bytes: Vec<u8>,
    pub field_ends: Vec<u32>,
    pub row_ends: Vec<u32>,
    pub row_cursors: Vec<u32>,
    open_base: usize,
    ascii: bool,
}

impl Builder {
    pub fn new() -> Self {
        Self {
            bytes: Vec::new(),
            field_ends: Vec::new(),
            row_ends: Vec::new(),
            row_cursors: Vec::new(),
            open_base: 0,
            ascii: true,
        }
    }

    pub fn with_capacity(cap: usize) -> Self {
        let mut b = Self::new();
        b.bytes.reserve(cap);
        b
    }

    pub fn push_bytes(&mut self, data: &[u8]) {
        if self.ascii && data.iter().any(|b| *b >= 0x80) {
            self.ascii = false;
        }
        self.bytes.extend_from_slice(data);
        self.field_ends.push(self.bytes.len() as u32);
    }

    pub fn push_unescaped(&mut self, field: &[u8], escape: Option<u8>, quote: Option<u8>) {
        match (escape, quote) {
            (Some(esc), Some(quo)) if field_has_escape(field, esc, quo) => {
                let mut out = Vec::with_capacity(field.len());
                let mut i = 0;
                while i < field.len() {
                    if i + 1 < field.len() && field[i] == esc && field[i + 1] == quo {
                        out.push(quo);
                        i += 2;
                    } else {
                        out.push(field[i]);
                        i += 1;
                    }
                }
                self.push_bytes(&out);
            }
            _ => self.push_bytes(field),
        }
    }

    pub fn commit_row(&mut self, cursor_utf16: u32) {
        self.row_ends.push(self.field_ends.len() as u32);
        self.row_cursors.push(cursor_utf16);
        self.open_base = self.field_ends.len();
    }

    pub fn open_field_count(&self) -> usize {
        self.field_ends.len() - self.open_base
    }

    pub fn discard_open_row(&mut self) {
        self.field_ends.truncate(self.open_base);
        if self.open_base == 0 {
            self.bytes.clear();
            self.ascii = true;
        } else {
            let keep = self.field_ends[self.open_base - 1] as usize;
            self.bytes.truncate(keep);
        }
    }

    /// Drop rows after `keep`. Used by Papa's fast-mode `data.slice(0, preview)`.
    pub fn truncate_rows(&mut self, keep: usize) {
        if self.row_ends.len() <= keep {
            return;
        }
        if keep == 0 {
            self.bytes.clear();
            self.field_ends.clear();
            self.row_ends.clear();
            self.row_cursors.clear();
            self.open_base = 0;
            self.ascii = true;
            return;
        }
        let fields = self.row_ends[keep - 1] as usize;
        self.row_ends.truncate(keep);
        self.row_cursors.truncate(keep);
        let byte_keep = if fields == 0 {
            0
        } else {
            self.field_ends[fields - 1] as usize
        };
        self.field_ends.truncate(fields);
        self.bytes.truncate(byte_keep);
        self.open_base = fields;
    }

    pub fn into_parts(self) -> (Vec<u8>, Vec<u32>, Vec<u32>, Vec<u32>, bool) {
        (
            self.bytes,
            self.field_ends,
            self.row_ends,
            self.row_cursors,
            self.ascii,
        )
    }
}

fn field_has_escape(field: &[u8], escape: u8, quote: u8) -> bool {
    field.windows(2).any(|w| w[0] == escape && w[1] == quote)
}
