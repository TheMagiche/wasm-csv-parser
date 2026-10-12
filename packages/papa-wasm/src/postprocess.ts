import type { ParseConfig, ParseError, ParseMeta, ParseResult, StepResult } from "./types";
import { ParserHandle } from "./types";
import type { RawBatch } from "./decode";

const FLOAT = /^\s*-?(\d+\.?|\.\d+|\d+\.\d+)([eE][-+]?\d+)?\s*$/;
const ISO_DATE =
  /^((\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z)))$/;
const MAX_FLOAT = 2 ** 53;
const MIN_FLOAT = -MAX_FLOAT;

export interface Session {
  fields: string[] | null;
  renamedHeaders: Record<string, string> | null;
  headerPending: boolean;
  dataRow: number;
  dynCache: Record<string, boolean>;
  /** Header step swallowed the delimiter error, matching Papa. */
  delimiterDropped: boolean;
  headerNamed: boolean;
}

export function createSession(config: ParseConfig<any> | undefined): Session {
  return {
    fields: null,
    renamedHeaders: null,
    headerPending: config?.header === true,
    dataRow: 0,
    dynCache: Object.create(null) as Record<string, boolean>,
    delimiterDropped: false,
    headerNamed: false,
  };
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function skipMode(config: ParseConfig | undefined): false | true | "greedy" {
  const value = config?.skipEmptyLines;
  if (value === true || value === "greedy") return value;
  return false;
}

function isSkippable(row: string[], mode: false | true | "greedy"): boolean {
  if (mode === "greedy") return row.join("").trim() === "";
  if (mode === true) return row.length === 1 && row[0]!.length === 0;
  return false;
}

function renameHeaderRow(
  row: string[],
  config: ParseConfig | undefined,
): Record<string, string> | null {
  const headerCount: Record<string, number> = Object.create(null);
  const used = new Set(row);
  let renamed: Record<string, string> | null = null;
  let duplicate = false;
  for (let i = 0; i < row.length; i++) {
    let header = stripBom(row[i] ?? "");
    if (config?.transformHeader) header = config.transformHeader(header, i);
    if (!headerCount[header]) {
      headerCount[header] = 1;
      row[i] = header;
    } else {
      let suffix = headerCount[header]!;
      let next = `${header}_${suffix}`;
      while (used.has(next)) {
        suffix += 1;
        next = `${header}_${suffix}`;
      }
      used.add(next);
      row[i] = next;
      headerCount[header] = headerCount[header]! + 1;
      renamed ??= {};
      renamed[next] = header;
      duplicate = true;
    }
    used.add(header);
  }
  if (duplicate) console.warn("Duplicate headers found and renamed.");
  return renamed;
}

function shouldType(
  field: string | number,
  config: ParseConfig | undefined,
  cache: Record<string, boolean>,
): boolean {
  const dyn = config?.dynamicTyping;
  if (!dyn) return false;
  if (dyn === true) return true;
  if (typeof dyn === "function") {
    const key = String(field);
    if (cache[key] === undefined) cache[key] = dyn(field) === true;
    return cache[key] === true;
  }
  return dyn[String(field)] === true;
}

function parseDynamic(
  field: string | number,
  value: unknown,
  config: ParseConfig | undefined,
  cache: Record<string, boolean>,
): unknown {
  if (!shouldType(field, config, cache)) return value;
  if (value === "true" || value === "TRUE") return true;
  if (value === "false" || value === "FALSE") return false;
  const text = typeof value === "string" ? value : String(value);
  if (FLOAT.test(text)) {
    const parsed = Number.parseFloat(text);
    if (parsed > MIN_FLOAT && parsed < MAX_FLOAT) return parsed;
  }
  if (typeof value === "string" && ISO_DATE.test(value)) return new Date(value);
  return text === "" ? null : value;
}

function applyRow(
  row: string[],
  session: Session,
  config: ParseConfig | undefined,
): { value: unknown; mismatch?: ParseError } {
  const fields = session.fields;
  const useHeader = config?.header === true && fields !== null;
  const out: Record<string, unknown> | unknown[] = useHeader ? {} : [];
  let j = 0;
  for (; j < row.length; j++) {
    let field: string | number = j;
    let value: unknown = row[j] ?? "";
    if (useHeader && fields) {
      field = j >= fields.length ? "__parsed_extra" : fields[j]!;
    }
    if (config?.transform) value = config.transform(String(row[j] ?? ""), field);
    value = parseDynamic(field, value, config, session.dynCache);
    if (field === "__parsed_extra") {
      const extra = (out as Record<string, unknown[]>).__parsed_extra ?? [];
      extra.push(value);
      (out as Record<string, unknown[]>).__parsed_extra = extra;
    } else if (useHeader) {
      (out as Record<string, unknown>)[field as string] = value;
    } else {
      (out as unknown[])[j] = value;
    }
  }
  if (useHeader && fields) {
    if (j > fields.length) {
      return {
        value: out,
        mismatch: {
          type: "FieldMismatch",
          code: "TooManyFields",
          message: `Too many fields: expected ${fields.length} fields but parsed ${j}`,
          row: session.dataRow,
        },
      };
    }
    if (j < fields.length) {
      return {
        value: out,
        mismatch: {
          type: "FieldMismatch",
          code: "TooFewFields",
          message: `Too few fields: expected ${fields.length} fields but parsed ${j}`,
          row: session.dataRow,
        },
      };
    }
  }
  return { value: out };
}

export interface Assembled<T> {
  data: T[];
  errors: ParseError[];
  meta: ParseMeta;
  /** True when step+preview consumed an extra row and aborted. */
  previewAborted: boolean;
}

function baseMeta(batch: RawBatch, session: Session, config: ParseConfig<any> | undefined): ParseMeta {
  const meta: ParseMeta = {
    delimiter: batch.delimiter,
    linebreak: batch.linebreak,
    aborted: batch.aborted,
    truncated: batch.truncated,
    cursor: batch.cursor,
    renamedHeaders: session.renamedHeaders,
  };
  if (config?.header) meta.fields = session.fields ?? [];
  return meta;
}

/**
 * Apply header rename, skipEmptyLines, dynamic typing, transform, and field
 * mismatch. Quote errors keep the row index Papa recorded before the header
 * row was removed.
 */
interface KeptRow {
  row: string[];
  raw: number;
}

function prepareRows(
  batch: RawBatch,
  session: Session,
  config: ParseConfig<any> | undefined,
  maxRows: number,
): { kept: KeptRow[]; previewAbort: boolean } {
  const rows = batch.rows.map((row) => row.slice());
  const previewAbort = maxRows > 0 && rows.length === maxRows;
  const limit = previewAbort ? rows.length - 1 : rows.length;
  if (session.headerPending && !session.headerNamed && rows.length > 0) {
    session.renamedHeaders = renameHeaderRow(rows[0]!, config);
    session.headerNamed = true;
  }
  const mode = skipMode(config);
  const kept: KeptRow[] = [];
  for (let i = 0; i < limit; i++) {
    const row = rows[i]!;
    if (isSkippable(row, mode)) continue;
    kept.push({ row, raw: i });
  }
  return { kept, previewAbort };
}

export function assemble<T>(
  batch: RawBatch,
  session: Session,
  config: ParseConfig<any> | undefined,
  maxRows: number,
): Assembled<T> {
  const { kept, previewAbort } = prepareRows(batch, session, config, maxRows);
  const dataRows = kept.slice();
  if (session.headerPending) {
    if (dataRows.length > 0) session.fields = dataRows.shift()!.row;
    else session.fields = [];
    session.headerPending = false;
  }

  const data: T[] = [];
  const mismatches: ParseError[] = [];
  for (const item of dataRows) {
    const applied = applyRow(item.row, session, config);
    data.push(applied.value as T);
    if (applied.mismatch) mismatches.push(applied.mismatch);
    session.dataRow += 1;
  }

  const errors = batch.errors.slice();
  errors.push(...mismatches);
  const meta = baseMeta(batch, session, config);
  if (previewAbort) {
    meta.aborted = true;
    meta.truncated = false;
  }
  return { data, errors, meta, previewAborted: previewAbort };
}

export interface StepDelivery {
  returned: ParseResult | undefined;
  abortedByUser: boolean;
}

/**
 * Papa's step callback sees one row at a time. The final `parse` return value
 * has empty `data` and the real meta. `complete` receives the initial empty
 * result unless the user called `abort()`.
 */
export function deliverSteps(
  batch: RawBatch,
  session: Session,
  config: ParseConfig<any>,
  maxRows: number,
  handle: ParserHandle,
  rowBase = 0,
): { result: ParseResult; userAbort: boolean } {
  const { kept, previewAbort } = prepareRows(batch, session, config, maxRows);
  const dataRows = kept.slice();
  if (session.headerPending) {
    session.delimiterDropped = true;
    if (dataRows.length > 0) session.fields = dataRows.shift()!.row;
    else session.fields = [];
    session.headerPending = false;
  }

  const stepping = config.step!;
  let userAbort = false;
  const walk = (start: number) => {
    for (let i = start; i < dataRows.length; i++) {
      const item = dataRows[i]!;
      const applied = applyRow(item.row, session, config);
      const rowErrors: ParseError[] = [];
      for (const error of batch.errors) {
        if (error.code === "UndetectableDelimiter") {
          if (!session.delimiterDropped) rowErrors.push({ ...error });
          session.delimiterDropped = true;
          continue;
        }
        if (error.row === rowBase + item.raw) rowErrors.push({ ...error, row: 0 });
      }
      if (applied.mismatch) rowErrors.push({ ...applied.mismatch, row: 0 });
      const stepResult: StepResult = {
        data: applied.value,
        errors: rowErrors,
        meta: {
          delimiter: batch.delimiter,
          linebreak: batch.linebreak,
          aborted: false,
          truncated: false,
          cursor: batch.rowCursors[item.raw] ?? batch.cursor,
          renamedHeaders: session.renamedHeaders,
          ...(config.header ? { fields: session.fields ?? [] } : {}),
        },
      };
      session.dataRow += 1;
      stepping(stepResult, handle);
      if (handle.aborted) {
        stepResult.meta.aborted = true;
        config.complete?.(stepResult as unknown as ParseResult);
        userAbort = true;
        return;
      }
      if (handle.paused) {
        handle.continuation = () => walk(i + 1);
        userAbort = true;
        return;
      }
    }
  };
  walk(0);

  const meta = baseMeta(batch, session, config);
  meta.truncated = false;
  if (previewAbort) meta.aborted = true;
  return {
    result: { data: [], errors: [], meta },
    userAbort,
  };
}
