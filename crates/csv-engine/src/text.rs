//! UTF-16 / JavaScript string helpers.
//!
//! Papa Parse indexes strings as UTF-16 code units. The engine scans UTF-8
//! bytes (so ASCII CSV never pays for a decode) and reports cursors in UTF-16
//! units so `meta.cursor` and error `index` match Papa on the same input.

/// JavaScript `String.prototype.trim` whitespace (ECMA-262 WhiteSpace + LineTerminator).
pub fn is_js_whitespace(ch: char) -> bool {
    matches!(
        ch,
        '\u{0009}'
            | '\u{000A}'
            | '\u{000B}'
            | '\u{000C}'
            | '\u{000D}'
            | '\u{0020}'
            | '\u{00A0}'
            | '\u{1680}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202F}'
            | '\u{205F}'
            | '\u{3000}'
            | '\u{FEFF}'
    ) || ('\u{2000}'..='\u{200A}').contains(&ch)
}

pub fn js_trim_is_empty(bytes: &[u8]) -> bool {
    let Ok(text) = std::str::from_utf8(bytes) else {
        return false;
    };
    text.trim_matches(is_js_whitespace).is_empty()
}

pub fn strip_bom(input: &[u8]) -> &[u8] {
    if input.starts_with(&[0xEF, 0xBB, 0xBF]) {
        &input[3..]
    } else {
        input
    }
}

/// UTF-16 code units needed to represent this UTF-8 slice.
/// Invalid sequences count as one unit per byte so cursors stay defined.
pub fn utf16_len(bytes: &[u8]) -> u32 {
    let mut units = 0u32;
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if b < 0x80 {
            units += 1;
            i += 1;
        } else if b & 0xE0 == 0xC0 && i + 1 < bytes.len() && is_cont(bytes[i + 1]) {
            units += 1;
            i += 2;
        } else if b & 0xF0 == 0xE0
            && i + 2 < bytes.len()
            && is_cont(bytes[i + 1])
            && is_cont(bytes[i + 2])
        {
            units += 1;
            i += 3;
        } else if b & 0xF8 == 0xF0
            && i + 3 < bytes.len()
            && is_cont(bytes[i + 1])
            && is_cont(bytes[i + 2])
            && is_cont(bytes[i + 3])
        {
            units += 2;
            i += 4;
        } else {
            units += 1;
            i += 1;
        }
    }
    units
}

fn is_cont(b: u8) -> bool {
    b & 0xC0 == 0x80
}

pub fn find_at(hay: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    if needle.is_empty() || from > hay.len() {
        return None;
    }
    let rest = &hay[from..];
    if needle.len() == 1 {
        return memchr::memchr(needle[0], rest).map(|i| i + from);
    }
    memchr::memmem::find(rest, needle).map(|i| i + from)
}

/// First `limit` UTF-16 code units of `input`, as a byte prefix.
pub fn utf16_prefix(input: &[u8], limit: u32) -> &[u8] {
    if limit == 0 {
        return &input[..0];
    }
    let mut units = 0u32;
    let mut i = 0;
    while i < input.len() && units < limit {
        let b = input[i];
        let (width, ulen) = if b < 0x80 {
            (1usize, 1u32)
        } else if b & 0xE0 == 0xC0 {
            (2, 1)
        } else if b & 0xF0 == 0xE0 {
            (3, 1)
        } else if b & 0xF8 == 0xF0 {
            (4, 2)
        } else {
            (1, 1)
        };
        let width = width.min(input.len() - i).max(1);
        if units + ulen > limit {
            break;
        }
        units += ulen;
        i += width;
    }
    &input[..i]
}

pub fn is_bad_delimiter(delim: &[u8]) -> bool {
    delim == b"\r" || delim == b"\n" || delim == b"\"" || delim == "\u{feff}".as_bytes()
}
