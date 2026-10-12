# wasm-csv-parser

A Papa Parse-compatible CSV parser. The scanner is Rust, compiled to WebAssembly. Header rows, dynamic typing, and `skipEmptyLines` stay in TypeScript so `parseFloat` and `Date` match JavaScript.

```ts
import { init, parse, parseAsync } from "wasm-csv-parser";

await init();
const rows = parse(csv, { header: true, dynamicTyping: true });
const big = await parseAsync(file, { header: true, worker: true });
```

React:

```tsx
import { usePapaWasm } from "wasm-csv-parser/react";

const { parse, data, progress, status, abort } = usePapaWasm({ header: true });
```

Live demo: https://themagiche.github.io/wasm-csv-parser/

## Migrate from Papa Parse

```ts
import Papa from "papaparse";
const result = Papa.parse(csv, { header: true });
```

becomes

```ts
import { parse } from "wasm-csv-parser";
const result = parse(csv, { header: true });
```

`parseAsync` is the path for `File` / `Blob` and for `worker: true`.

## Differences from Papa Parse

- `parse()` is synchronous. `worker: true` throws and tells you to call `parseAsync`. Papa starts the worker and returns `undefined`.
- In the browser, call `await init()` before `parse()`. `parseAsync()` loads the module itself. Node initializes synchronously on the first `parse()`.
- No `unparse`, no `download: true`, and no jQuery build.
- `delimitersToGuess`, `skipFirstNLines`, `beforeFirstChunk`, and network options throw `Unsupported Papa Parse option: …` instead of being ignored.
- Default stream chunk size is 8 MiB.
- `transform` runs in JavaScript on every cell. Leave it off for large files.

Anything else in the v1 config table matches Papa Parse 5.7, including errors and `meta`.

Requires Node 22 or newer.
