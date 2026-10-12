# Benchmark results

Single machine, Node v22.14.0, median of a few runs. Input is generated and not committed. 100 MB and 500 MB were not run here: the result table, not the wasm module, is what uses RAM, and this machine had about 4 GB free. Raise the sizes in `packages/bench/src/run.mjs` to measure them.

`wasm-csv-parser` times include JavaScript post-processing (headers, dynamic typing) so the comparison matches `Papa.parse`. `flat buffer` is the raw wasm return before strings are built for the whole table. `js arrays` builds `string[][]` inside wasm with `js_sys`.

The flat buffer is the production path. Building arrays inside wasm was slower on these runs because each cell still becomes a JavaScript string, plus the extra copies through the externref table, so that export was removed. The TypeScript decoder keeps ASCII input as one `TextDecoder` string and slices it. String inputs are often slower than Papa Parse at these sizes: `parse()` UTF-8-encodes the JavaScript string and then builds the same string table Papa builds. The flat-buffer column is the scanner without that rebuild. On the 10 MB narrow unquoted file the scanner took 54 ms and Papa Parse took 137 ms. The full `parse()` call took 224 ms. Wide unquoted files with `header: false` are the weakest case, because Papa's fast mode is already a split.

| Case | Papa ms | wasm-csv-parser ms | MB/s | vs Papa | flat buffer ms | js arrays ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 MB, narrow, unquoted, header false | 15 | 23 | 44 | 0.66× | 8 | 32 |
| 1 MB, narrow, unquoted, header true | 19 | 20 | 50 | 0.98× | 8 | 32 |
| 1 MB, narrow, unquoted, header + dynamicTyping | 22 | 25 | 40 | 0.87× | 8 | 33 |
| 1 MB, wide, unquoted, header false | 4 | 14 | 73 | 0.26× | 7 | 28 |
| 1 MB, wide, unquoted, header true | 19 | 18 | 55 | 1.04× | 8 | 28 |
| 1 MB, wide, unquoted, header + dynamicTyping | 24 | 24 | 42 | 1.02× | 8 | 29 |
| 1 MB, narrow, quoted, header false | 19 | 25 | 39 | 0.74× | 21 | 35 |
| 1 MB, narrow, quoted, header true | 21 | 26 | 39 | 0.80× | 23 | 36 |
| 1 MB, narrow, quoted, header + dynamicTyping | 23 | 28 | 35 | 0.81× | 20 | 36 |
| 10 MB, narrow, unquoted, header false | 137 | 224 | 45 | 0.61× | 54 | 258 |
| 10 MB, narrow, unquoted, header true | 185 | 205 | 49 | 0.90× | 47 | 269 |
| 10 MB, narrow, unquoted, header + dynamicTyping | 237 | 211 | 47 | 1.12× | 46 | 264 |
| 10 MB, wide, unquoted, header false | 45 | 109 | 92 | 0.41× | 44 | 243 |
| 10 MB, wide, unquoted, header true | 161 | 150 | 67 | 1.08× | 43 | 240 |
| 10 MB, wide, unquoted, header + dynamicTyping | 215 | 212 | 47 | 1.02× | 43 | 247 |
| 10 MB, narrow, quoted, header false | 125 | 242 | 41 | 0.52× | 138 | 291 |
| 10 MB, narrow, quoted, header true | 183 | 245 | 41 | 0.75× | 163 | 300 |
| 10 MB, narrow, quoted, header + dynamicTyping | 203 | 250 | 40 | 0.81× | 138 | 303 |

Cases slower than Papa Parse: 1 MB narrow, unquoted header false (0.66×); 1 MB narrow, unquoted header true (0.98×); 1 MB narrow, unquoted header + dynamicTyping (0.87×); 1 MB wide, unquoted header false (0.26×); 1 MB narrow, quoted header false (0.74×); 1 MB narrow, quoted header true (0.80×); 1 MB narrow, quoted header + dynamicTyping (0.81×); 10 MB narrow, unquoted header false (0.61×); 10 MB narrow, unquoted header true (0.90×); 10 MB wide, unquoted header false (0.41×); 10 MB narrow, quoted header false (0.52×); 10 MB narrow, quoted header true (0.75×); 10 MB narrow, quoted header + dynamicTyping (0.81×)

Peak heap is not a stable comparison here: both parsers allocate the result strings, and `process.memoryUsage().heapUsed` includes the rest of the process. For a large file, expect memory on the order of the decoded table, not the wasm module (the module is under 100 KB gzip).
