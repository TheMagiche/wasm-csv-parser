import { readFileSync } from "node:fs";
import { brotliCompressSync, gzipSync } from "node:zlib";

const buf = readFileSync(new URL("../pkg/wasm-csv-parser_bg.wasm", import.meta.url));
const report = {
  raw: buf.length,
  gzip: gzipSync(buf).length,
  brotli: brotliCompressSync(buf).length,
};
console.log(JSON.stringify(report, null, 2));
if (report.gzip >= 100 * 1024) {
  console.error("gzip wasm is over the 100KB budget");
  process.exit(1);
}
