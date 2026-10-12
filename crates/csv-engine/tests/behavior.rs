use csv_engine::{parse_csv, Comments, ParseOptions, SetupError, SkipEmpty, StreamParser};

fn opts() -> ParseOptions {
    ParseOptions::explicit(",")
}

fn rec(rows: &[&[&str]]) -> Vec<Vec<String>> {
    rows.iter()
        .map(|row| row.iter().map(|cell| (*cell).to_string()).collect())
        .collect()
}

fn codes(parsed: &csv_engine::RawParse) -> Vec<String> {
    parsed
        .errors
        .iter()
        .map(|e| format!("{:?}:{:?}", e.code, e.row))
        .collect()
}

fn concat_stream(input: &str, chunk: usize, options: &ParseOptions) -> csv_engine::RawParse {
    let mut parser = StreamParser::new(options.clone());
    let bytes = input.as_bytes();
    let mut rows = Vec::new();
    let mut errors = Vec::new();
    let mut delimiter = String::new();
    let mut linebreak = String::new();
    let mut i = 0;
    while i < bytes.len() {
        let end = (i + chunk).min(bytes.len());
        let part = parser.feed(&bytes[i..end]).expect("feed");
        rows.extend(part.records());
        errors.extend(part.errors.clone());
        if !part.delimiter.is_empty() {
            delimiter = part.delimiter;
        }
        if !part.linebreak.is_empty() {
            linebreak = part.linebreak;
        }
        i = end;
    }
    let tail = parser.finish().expect("finish");
    rows.extend(tail.records());
    errors.extend(tail.errors.clone());
    let cursor = tail.cursor;
    if !tail.delimiter.is_empty() {
        delimiter = tail.delimiter;
    }
    if !tail.linebreak.is_empty() {
        linebreak = tail.linebreak;
    }
    let whole = parse_csv(input, options).expect("sync");
    assert_eq!(rows, whole.records(), "rows chunk={chunk} input={input:?}");
    assert_eq!(errors, whole.errors, "errors chunk={chunk} input={input:?}");
    assert_eq!(cursor, whole.cursor, "cursor chunk={chunk} input={input:?}");
    assert_eq!(delimiter, whole.delimiter);
    assert_eq!(linebreak, whole.linebreak);
    whole
}

#[test]
fn simple_rows_and_cursor() {
    let parsed = parse_csv("a,b\nc,d", &ParseOptions::default()).unwrap();
    assert_eq!(parsed.records(), rec(&[&["a", "b"], &["c", "d"]]));
    assert_eq!(parsed.cursor, 7);
    assert!(parsed.errors.is_empty(), "{:?}", parsed.errors);
    assert_eq!(parsed.linebreak, "\n");
}

#[test]
fn trailing_newline_adds_empty_row_and_can_fail_detection() {
    let parsed = parse_csv("a,b\n", &ParseOptions::default()).unwrap();
    assert_eq!(parsed.records(), rec(&[&["a", "b"], &[""]]));
    assert_eq!(parsed.cursor, 4);
    assert_eq!(
        codes(&parsed),
        vec!["UndetectableDelimiter:None".to_string()]
    );

    let explicit = parse_csv("a,b\n", &opts()).unwrap();
    assert!(explicit.errors.is_empty());
    assert_eq!(explicit.records().len(), 2);
}

#[test]
fn unicode_cursors_are_utf16() {
    let parsed = parse_csv("é,b\n", &opts()).unwrap();
    assert_eq!(parsed.cursor, 4);
    assert_eq!(parsed.records()[0][0], "é");

    let emoji = parse_csv("😀,x\ny,z", &opts()).unwrap();
    assert_eq!(emoji.cursor, 8);
    assert_eq!(emoji.records()[0][0], "😀");
}

#[test]
fn quotes_escapes_and_spaces() {
    let parsed = parse_csv("\"a\" ,b", &opts()).unwrap();
    assert_eq!(parsed.records(), rec(&[&["a", "b"]]));
    assert_eq!(parsed.cursor, 6);

    let spaced = parse_csv("\"a\", \"b\"", &opts()).unwrap();
    assert_eq!(spaced.records(), rec(&[&["a", " \"b\""]]));

    let mid = parse_csv("\"a\"\"b\"", &opts()).unwrap();
    assert_eq!(mid.records(), rec(&[&["a\"b"]]));
    assert!(mid.errors.is_empty());

    let eof = parse_csv("\"ab\"\"", &opts()).unwrap();
    assert_eq!(eof.records(), rec(&[&["ab\"\""]]));
    assert_eq!(codes(&eof), vec!["MissingQuotes:Some(0)".to_string()]);

    let empty = parse_csv("\"\"", &opts()).unwrap();
    assert_eq!(empty.records(), rec(&[&[""]]));
    assert!(empty.errors.is_empty(), "{:?}", empty.errors);

    let triple = parse_csv("\"\"\"", &opts()).unwrap();
    assert_eq!(triple.records(), rec(&[&["\"\""]]));
    assert_eq!(codes(&triple), vec!["MissingQuotes:Some(0)".to_string()]);

    let end = parse_csv("\"a\"\"\"", &opts()).unwrap();
    assert_eq!(end.records(), rec(&[&["a\""]]));
    assert!(end.errors.is_empty(), "{:?}", end.errors);
}

#[test]
fn embedded_newline_and_crlf() {
    let parsed = parse_csv("\"a\nb\",c\nd,e", &opts()).unwrap();
    assert_eq!(parsed.records(), rec(&[&["a\nb", "c"], &["d", "e"]]));

    let crlf = parse_csv("\"a\r\nb\",c\r\nd,e", &ParseOptions::default()).unwrap();
    assert_eq!(crlf.linebreak, "\r\n");
    assert_eq!(crlf.records()[0][0], "a\r\nb");
    assert_eq!(crlf.cursor, 13);
}

#[test]
fn preview_fast_and_slow_cursors() {
    let mut fast = opts();
    fast.preview = 1;
    fast.fast_mode = Some(true);
    let parsed = parse_csv("a,b\nc,d\ne,f", &fast).unwrap();
    assert_eq!(parsed.records(), rec(&[&["a", "b"]]));
    assert!(parsed.truncated);
    assert_eq!(parsed.cursor, 8);

    let mut slow = opts();
    slow.preview = 1;
    slow.fast_mode = Some(false);
    let parsed = parse_csv("a,b\nc,d\ne,f", &slow).unwrap();
    assert_eq!(parsed.cursor, 4);
    assert!(parsed.truncated);

    let mut exact = opts();
    exact.preview = 2;
    exact.fast_mode = Some(true);
    let parsed = parse_csv("a,b\nc,d", &exact).unwrap();
    assert!(!parsed.truncated);
    assert_eq!(parsed.cursor, 7);
    assert_eq!(parsed.records().len(), 2);

    let mut trail = opts();
    trail.preview = 1;
    trail.fast_mode = Some(true);
    let parsed = parse_csv("a,b\n", &trail).unwrap();
    assert_eq!(parsed.records(), rec(&[&["a", "b"]]));
    assert!(parsed.truncated);
    assert_eq!(parsed.cursor, 4);
}

#[test]
fn comments_do_not_extend_cursor_when_trailing() {
    let mut options = opts();
    options.comments = Comments::Literal("#".into());
    let parsed = parse_csv("a,b\n#comment", &options).unwrap();
    assert_eq!(parsed.records(), rec(&[&["a", "b"]]));
    assert_eq!(parsed.cursor, 4);

    let only = parse_csv("# hi", &options).unwrap();
    assert!(only.records().is_empty());
    assert_eq!(only.cursor, 0);

    let mid = parse_csv("a,b\n#c\nd,e", &options).unwrap();
    assert_eq!(mid.records().len(), 2);
    assert_eq!(mid.cursor, 10);
    assert_eq!(mid.records()[1], vec!["d".to_string(), "e".into()]);
}

#[test]
fn delimiter_detection() {
    let parsed = parse_csv("a;b\nc;d", &ParseOptions::default()).unwrap();
    assert_eq!(parsed.delimiter, ";");
    assert_eq!(parsed.records()[0], rec(&[&["a", "b"]])[0]);

    let tabs = parse_csv("a\tb\tc\nd\te\tf", &ParseOptions::default()).unwrap();
    assert_eq!(tabs.delimiter, "\t");
    assert_eq!(tabs.records().len(), 2);

    let mixed = parse_csv("a,b\r\nc,d", &ParseOptions::default()).unwrap();
    assert_eq!(mixed.linebreak, "\r\n");
    assert_eq!(mixed.delimiter, ",");
}

#[test]
fn bad_delimiter_becomes_comma() {
    let options = ParseOptions {
        delimiter: "\n".into(),
        ..ParseOptions::default()
    };
    let parsed = parse_csv("a,b\nc,d", &options).unwrap();
    assert_eq!(parsed.delimiter, ",");
    assert_eq!(parsed.records().len(), 2);
}

#[test]
fn comment_same_as_delimiter_throws() {
    let options = ParseOptions {
        comments: Comments::Literal(",".into()),
        ..opts()
    };
    let err = parse_csv("a,b", &options).unwrap_err();
    assert_eq!(err, SetupError::CommentEqualsDelimiter);
}

#[test]
fn fast_mode_ignores_quotes() {
    let options = ParseOptions {
        fast_mode: Some(true),
        ..opts()
    };
    let parsed = parse_csv("\"a,b\",c", &options).unwrap();
    assert_eq!(parsed.records(), rec(&[&["\"a", "b\"", "c"]]));
}

#[test]
fn malformed_quotes() {
    let parsed = parse_csv("\"abc\"def,x\n1,2", &opts()).unwrap();
    assert_eq!(parsed.records(), rec(&[&["abc\"def,x\n1,2"]]));
    let kinds: Vec<_> = parsed.errors.iter().map(|e| e.code).collect();
    assert!(kinds.contains(&csv_engine::ErrorCode::InvalidQuotes));
    assert!(kinds.contains(&csv_engine::ErrorCode::MissingQuotes));
}

#[test]
fn bom_is_not_part_of_cursor() {
    let parsed = parse_csv("\u{feff}a,b\nc,d", &opts()).unwrap();
    assert_eq!(parsed.cursor, 7);
    assert_eq!(parsed.records()[0][0], "a");
}

#[test]
fn skip_empty_affects_detection_not_rows() {
    let greedy = ParseOptions {
        skip_empty: SkipEmpty::Greedy,
        ..ParseOptions::default()
    };
    let parsed = parse_csv("a,b\n   \n,\nc,d", &greedy).unwrap();
    // Filtering happens in TS; the core still returns every row.
    assert!(parsed.records().len() >= 3);
    assert!(parsed.errors.is_empty(), "{:?}", parsed.errors);
}

#[test]
fn chunked_parse_matches_oneshot() {
    let samples = [
        "a,b\nc,d",
        "a,b\n",
        "a,b\n\nc,d",
        "\"hello, world\",b\nc,d",
        "\"hel\nlo\",b\n",
        "\"a\"\"b\",c\nd,e",
        "a,b\r\nc,d\r\n",
        "é,b\n😀,x",
        "#c\na,b\n#x\nc,d",
        "",
        "\n",
        "a,b\n#comment",
        "\"unterminated,field",
        "\"abc\"def,x",
    ];
    for sample in samples {
        let options = if sample.contains('#') {
            ParseOptions {
                comments: Comments::Literal("#".into()),
                ..opts()
            }
        } else {
            opts()
        };
        for chunk in [1usize, 2, 3, 5, 8, 64, 10_000] {
            concat_stream(sample, chunk, &options);
        }
        // Auto-detect on a single feed of the whole buffer, then finish.
        if !sample.contains('#') {
            concat_stream(sample, sample.len().max(1), &ParseOptions::default());
        }
    }
}

#[test]
fn max_rows_stops_without_truncated_flag() {
    let options = ParseOptions {
        max_rows: 2,
        ..opts()
    };
    let parsed = parse_csv("a,b\nc,d\ne,f", &options).unwrap();
    assert_eq!(parsed.records(), rec(&[&["a", "b"], &["c", "d"]]));
    assert!(!parsed.truncated);
    assert_eq!(parsed.cursor, 8);
}

#[test]
fn quoted_field_split_across_chunks() {
    let input = "a,\"hello\nworld\",c";
    concat_stream(input, 1, &opts());
    concat_stream(input, 3, &opts());
}
