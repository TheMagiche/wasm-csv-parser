# csv-engine

Papa Parse 5.7-compatible CSV scanner. No JavaScript dependency.

The hot path is a hand-written port of Papa's `Parser`, not `csv-core`.
`csv-core` cannot reproduce Papa's quote recovery, fast-mode preview cursor,
or delimiter heuristic. The Rust crate returns a flat field buffer. Header
objects, `dynamicTyping`, and `skipEmptyLines` filtering live in the
`papa-wasm` TypeScript package so `parseFloat` and `Date` stay exact.

```rust
let parsed = csv_engine::parse_csv("a,b\nc,d", &csv_engine::ParseOptions::default())?;
```
