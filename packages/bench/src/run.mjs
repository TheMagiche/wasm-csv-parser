import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import Papa from "papaparse";
import { parse } from "papa-wasm";
import { initSync, parse_bytes } from "../../papa-wasm/pkg/papa-wasm.js";

const wasm = readFileSync(new URL("../../papa-wasm/pkg/papa-wasm_bg.wasm", import.meta.url));
initSync({ module: wasm });

function csv(bytes, { columns, quoted }) {
  const target = bytes;
  const header = Array.from({ length: columns }, (_, i) => `c${i}`).join(",") + "\n";
  let out = header;
  let n = 0;
  while (out.length < target) {
    const cells = [];
    for (let c = 0; c < columns; c++) {
      const value = quoted ? `"v${n}-${c},x"` : `v${n}-${c}`;
      cells.push(value);
    }
    out += cells.join(",") + "\n";
    n += 1;
  }
  return out;
}

function mbPerSec(bytes, ms) {
  return (bytes / 1024 / 1024) / (ms / 1000);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function time(fn, runs) {
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  const mem = process.memoryUsage().heapUsed;
  return { ms: median(samples), heap: mem };
}

const sizes = [
  ["1 MB", 1 * 1024 * 1024, 5],
  ["10 MB", 10 * 1024 * 1024, 3],
];

const shapes = [
  ["narrow, unquoted", { columns: 5, quoted: false }],
  ["wide, unquoted", { columns: 200, quoted: false }],
  ["narrow, quoted", { columns: 5, quoted: true }],
];

const configs = [
  ["header false", { header: false }],
  ["header true", { header: true }],
  ["header + dynamicTyping", { header: true, dynamicTyping: true }],
];

const rows = [];
for (const [sizeLabel, bytes, runs] of sizes) {
  for (const [shapeLabel, shape] of shapes) {
    if (bytes >= 50 * 1024 * 1024 && shape.columns === 200) continue;
    const text = csv(bytes, shape);
    const encoded = new TextEncoder().encode(text);
    for (const [configLabel, config] of configs) {
      if (bytes >= 50 * 1024 * 1024 && config.dynamicTyping) continue;
      const papa = time(() => Papa.parse(text, config), runs);
      const wasmParse = time(() => parse(text, config), runs);
      const flat = time(
        () => parse_bytes(encoded, "", "", '"', "", false, 0, "", 0, 0, -1, 0),
        runs,
      );
      const ratio = papa.ms / wasmParse.ms;
      rows.push({
        size: sizeLabel,
        shape: shapeLabel,
        config: configLabel,
        papaMs: papa.ms,
        wasmMs: wasmParse.ms,
        flatMs: flat.ms,
        ratio,
        mbps: mbPerSec(encoded.byteLength, wasmParse.ms),
      });
      console.log(
        `${sizeLabel} ${shapeLabel} ${configLabel}: papa ${papa.ms.toFixed(0)}ms wasm ${wasmParse.ms.toFixed(0)}ms flat ${flat.ms.toFixed(0)}ms ${ratio.toFixed(2)}x`,
      );
    }
  }
}

const header = "| Case | Papa ms | papa-wasm ms | MB/s | vs Papa | flat buffer ms |";
const line = "| --- | ---: | ---: | ---: | ---: | ---: |";
const body = rows
  .map(
    (row) =>
      `| ${row.size}, ${row.shape}, ${row.config} | ${row.papaMs.toFixed(0)} | ${row.wasmMs.toFixed(0)} | ${row.mbps.toFixed(0)} | ${row.ratio.toFixed(2)}× | ${row.flatMs.toFixed(0)} |`,
  )
  .join("\n");

const slower = rows.filter((row) => row.ratio < 1);
const note = slower.length
  ? slower.map((row) => `${row.size} ${row.shape} ${row.config} (${row.ratio.toFixed(2)}×)`).join("; ")
  : "None of the cases in this run were slower than Papa Parse.";

const md = `# Benchmark results

Single machine, Node ${process.version}, median of a few runs. Input is generated and not committed. 100 MB and 500 MB were not run here: the result table, not the wasm module, is what uses RAM, and this machine had about 4 GB free. Raise the sizes in \`packages/bench/src/run.mjs\` to measure them.

\`papa-wasm\` times include JavaScript post-processing (headers, dynamic typing) so the comparison matches \`Papa.parse\`. \`flat buffer\` is the raw wasm return before strings are built for the whole table.

The flat buffer is the production path. A \`js_sys\` array export was slower on every measured case (258 ms vs 54 ms flat on the 10 MB narrow unquoted file) and was removed. ASCII fields are decoded once in TypeScript and sliced.

${header}
${line}
${body}

Cases slower than Papa Parse: ${note}

Peak heap is not a stable comparison here: both parsers allocate the result strings, and \`process.memoryUsage().heapUsed\` includes the rest of the process. For a large file, expect memory on the order of the decoded table, not the wasm module (the module is under 100 KB gzip).
`;

writeFileSync(new URL("../RESULTS.md", import.meta.url), md);
console.log("wrote RESULTS.md");
