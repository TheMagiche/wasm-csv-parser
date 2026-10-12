import { useMemo, useState } from "react";
import Papa from "papaparse";
import { init, parse, usePapaWasm } from "papa-wasm/react";
import wasmUrl from "../../../packages/papa-wasm/pkg/papa-wasm_bg.wasm?url";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";

void init(wasmUrl);

const SAMPLE = `order_id,customer,city,qty,unit_price,shipped
1001,Ada Lovelace,London,2,18.50,true
1002,"Grace Hopper, Rear Admiral",New York,1,42.00,FALSE
1003,Katherine Johnson,Hampton,4,9.25,true
1004,Margaret Hamilton,Cambridge,1,128.00,true
1005,Annie Easley,Cleveland,,15.00,false
`;

interface Timings {
  wasmMs: number;
  papaMs: number;
  bytes: number;
}

function formatCell(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value == null) return "";
  if (Array.isArray(value)) return value.map((item) => formatCell(item)).join(" | ");
  return String(value);
}

function rowCells(row: unknown, header: boolean, keys: string[]): string[] {
  if (header && row && typeof row === "object" && !Array.isArray(row)) {
    const record = row as Record<string, unknown>;
    return keys.map((key) => formatCell(record[key]));
  }
  return (row as unknown[]).map((value) => formatCell(value));
}

export default function App() {
  const [header, setHeader] = useState(true);
  const [dynamicTyping, setDynamicTyping] = useState(true);
  const [skipEmpty, setSkipEmpty] = useState(false);
  const [fileName, setFileName] = useState("No file yet");
  const [source, setSource] = useState<string | null>(null);
  const [timings, setTimings] = useState<Timings | null>(null);
  const [dragging, setDragging] = useState(false);

  const config = useMemo(
    () => ({
      header,
      dynamicTyping,
      skipEmptyLines: skipEmpty ? ("greedy" as const) : false,
    }),
    [header, dynamicTyping, skipEmpty],
  );
  const session = usePapaWasm<Record<string, unknown> | unknown[]>(config);

  async function timeBoth(text: string) {
    await init(wasmUrl);
    const bytes = new TextEncoder().encode(text).byteLength;
    const wasmStart = performance.now();
    parse(text, config);
    const wasmMs = performance.now() - wasmStart;
    const papaStart = performance.now();
    Papa.parse(text, config);
    const papaMs = performance.now() - papaStart;
    setTimings({ wasmMs, papaMs, bytes });
  }

  function run(text: string, name: string, blob?: Blob) {
    setFileName(name);
    setSource(text);
    setTimings(null);
    session.parse(blob ?? new Blob([text], { type: "text/csv" }));
    void timeBoth(text);
  }

  function onFiles(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    void file.text().then((text) => run(text, file.name, file));
  }

  const rows = session.data;
  const keys =
    config.header && rows[0] && typeof rows[0] === "object" && !Array.isArray(rows[0])
      ? Object.keys(rows[0])
      : rows[0]
        ? (rows[0] as unknown[]).map((_, index) => String(index))
        : [];
  const preview = rows.slice(0, 12);
  const faster =
    timings && timings.wasmMs > 0 ? timings.papaMs / timings.wasmMs : null;

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#8a5a3a]">papa-wasm</p>
          <h1 className="font-serif text-4xl leading-tight sm:text-5xl">Parse CSV without freezing the page.</h1>
        </div>
        <p className="max-w-sm text-sm text-[#5c5146]">
          The scanner is Rust compiled to WebAssembly. This page runs it in a worker and times the same file against Papa Parse.
        </p>
      </header>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Input</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <label
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-4 py-10 text-center ${dragging ? "border-[#c4552a] bg-[#f8e7da]" : "border-[#d9cbb6] bg-[#fbf6ee]"}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                onFiles(event.dataTransfer.files);
              }}
            >
              <span className="font-medium">Drop a CSV here</span>
              <span className="text-sm text-[#6d6258]">or choose a file. UTF-8, including quoted commas and newlines.</span>
              <input
                className="sr-only"
                type="file"
                accept=".csv,text/csv,text/plain"
                onChange={(event) => onFiles(event.target.files)}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => run(SAMPLE, "sample-orders.csv")}>
                Load sample orders
              </Button>
              <Button type="button" variant="outline" onClick={session.abort} disabled={session.status === "idle"}>
                Abort
              </Button>
            </div>
            <p className="text-sm text-[#6d6258]">
              {fileName}
              {source ? ` · ${new TextEncoder().encode(source).byteLength.toLocaleString()} bytes` : ""}
            </p>
            <fieldset className="grid gap-3 sm:grid-cols-3">
              <legend className="sr-only">Parse options</legend>
              <Toggle label="Header row" checked={header} onCheckedChange={setHeader} />
              <Toggle label="Dynamic types" checked={dynamicTyping} onCheckedChange={setDynamicTyping} />
              <Toggle label="Skip empty lines" checked={skipEmpty} onCheckedChange={setSkipEmpty} />
            </fieldset>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-sm">
                <span className="capitalize">{session.status.replace("-", " ")}</span>
                <span>{Math.round(session.progress * 100)}%</span>
              </div>
              <Progress value={session.progress} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Timing</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {timings ? (
              <>
                <TimingBar label="papa-wasm" ms={timings.wasmMs} max={Math.max(timings.wasmMs, timings.papaMs)} />
                <TimingBar label="Papa Parse" ms={timings.papaMs} max={Math.max(timings.wasmMs, timings.papaMs)} muted />
                <p className="text-sm text-[#5c5146]">
                  {faster && faster >= 1
                    ? `papa-wasm was ${faster.toFixed(2)}× the speed of Papa Parse on this input.`
                    : faster
                      ? `Papa Parse was ${(1 / faster).toFixed(2)}× the speed of papa-wasm on this input.`
                      : "Not enough time elapsed to compare."}
                  {" "}
                  {(timings.bytes / 1024 / 1024 / (timings.wasmMs / 1000)).toFixed(1)} MB/s through papa-wasm.
                  The worker parse fills the table. These bars are a second pass on the main thread so both parsers do the same work.
                </p>
              </>
            ) : (
              <p className="text-sm text-[#6d6258]">
                Load a file to compare median-free single-run times. Small strings can be noise. The gap shows up once the file is large.
              </p>
            )}
            {session.meta && (
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <Stat term="Delimiter" value={JSON.stringify(session.meta.delimiter)} />
                <Stat term="Line break" value={JSON.stringify(session.meta.linebreak)} />
                <Stat term="Cursor" value={String(session.meta.cursor)} />
                <Stat term="Errors" value={String(session.errors.length)} />
              </dl>
            )}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Preview</CardTitle>
        </CardHeader>
        <CardContent>
          {session.status === "error" && (
            <p className="text-sm text-[#9a3412]" role="alert">
              {session.errors[0]?.message ?? "The parse failed."}
            </p>
          )}
          {session.status !== "error" && preview.length === 0 && (
            <p className="text-sm text-[#6d6258]">
              {session.status === "parsing" || session.status === "loading-wasm"
                ? "Reading the file in a worker so this page can keep drawing."
                : "Nothing parsed yet. The sample file has a quoted comma and a blank quantity."}
            </p>
          )}
          {preview.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                <caption className="sr-only">First rows of the parsed CSV</caption>
                <thead>
                  <tr className="border-b border-[#e4d5c0] text-[#6d6258]">
                    {keys.map((key) => (
                      <th key={key} className="px-2 py-2 font-medium">
                        {key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, index) => (
                    <tr key={index} className="border-b border-[#f0e6d6]">
                      {rowCells(row, config.header, keys).map((value, cellIndex) => (
                        <td key={cellIndex} className="px-2 py-2 align-top">
                          {value || <span className="text-[#b3a394]">empty</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-[#6d6258]">
                Showing {preview.length} of {rows.length} rows.
              </p>
            </div>
          )}
          {session.errors.length > 0 && session.status !== "error" && (
            <ul className="mt-4 flex flex-col gap-1 text-sm text-[#9a3412]">
              {session.errors.slice(0, 6).map((error, index) => (
                <li key={index}>
                  {error.code}: {error.message}
                  {error.row != null ? ` (row ${error.row})` : ""}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function Toggle({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <label htmlFor={id} className="flex items-center justify-between gap-3 rounded-xl border border-[#eadfce] px-3 py-2 text-sm">
      {label}
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}

function TimingBar({ label, ms, max, muted = false }: { label: string; ms: number; max: number; muted?: boolean }) {
  const width = max > 0 ? Math.max(4, (ms / max) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span>{label}</span>
        <span>{ms.toFixed(1)} ms</span>
      </div>
      <div className="h-3 rounded-full bg-[#eadfce]">
        <div
          className={`h-3 rounded-full ${muted ? "bg-[#8d8174]" : "bg-[#c4552a]"}`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

function Stat({ term, value }: { term: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#f6efe4] px-3 py-2">
      <dt className="text-xs uppercase tracking-wide text-[#6d6258]">{term}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
