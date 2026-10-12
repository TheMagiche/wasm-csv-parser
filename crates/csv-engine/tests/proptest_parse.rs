use csv_engine::{parse_csv, parse_csv_bytes, ParseOptions};
use proptest::prelude::*;

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    #[test]
    fn random_bytes_do_not_panic(bytes in proptest::collection::vec(any::<u8>(), 0..512)) {
        let _ = parse_csv_bytes(&bytes, &ParseOptions::default());
        let _ = parse_csv_bytes(&bytes, &ParseOptions::explicit(","));
    }

    #[test]
    fn plain_fields_round_trip(
        rows in proptest::collection::vec(
            proptest::collection::vec("[a-z0-9]{0,8}", 1..6),
            1..12,
        )
    ) {
        let mut expected = Vec::new();
        let mut csv = String::new();
        for (i, row) in rows.iter().enumerate() {
            if i > 0 {
                csv.push('\n');
            }
            expected.push(row.clone());
            csv.push_str(&row.join(","));
        }
        let parsed = parse_csv(&csv, &ParseOptions::explicit(",")).unwrap();
        assert_eq!(parsed.records(), expected);
        assert!(parsed.errors.is_empty());
    }
}
