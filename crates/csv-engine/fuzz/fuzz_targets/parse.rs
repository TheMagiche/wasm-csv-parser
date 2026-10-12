#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let _ = csv_engine::parse_csv_bytes(data, &csv_engine::ParseOptions::default());
    let mut parser = csv_engine::StreamParser::new(csv_engine::ParseOptions::explicit(","));
    let mut i = 0;
    while i < data.len() {
        let end = (i + 3).min(data.len());
        if parser.feed(&data[i..end]).is_err() {
            return;
        }
        i = end;
    }
    let _ = parser.finish();
});
