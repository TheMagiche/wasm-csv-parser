/** One Papa Parse error. `row` and `index` are omitted when Papa omits them. */
export interface ParseError {
  type: "Quotes" | "Delimiter" | "FieldMismatch";
  code:
    | "MissingQuotes"
    | "UndetectableDelimiter"
    | "TooFewFields"
    | "TooManyFields"
    | "InvalidQuotes";
  message: string;
  row?: number;
  index?: number;
}

/** Cursor and delimiter metadata. `fields` is set only when `header` is true. */
export interface ParseMeta {
  delimiter: string;
  linebreak: string;
  aborted: boolean;
  truncated: boolean;
  cursor: number;
  fields?: string[];
  /** Always present. `null` when no header was renamed. */
  renamedHeaders: Record<string, string> | null;
}

export interface ParseResult<T = unknown> {
  data: T[];
  errors: ParseError[];
  meta: ParseMeta;
}

/** Shape Papa passes to `step`: one row, plus the errors on that row. */
export interface StepResult<T = unknown> {
  data: T;
  errors: ParseError[];
  meta: ParseMeta;
}

export type DynamicTyping =
  | boolean
  | Record<string, boolean>
  | ((field: string | number) => boolean);

/**
 * Papa Parse config supported by papa-wasm.
 * Any other key throws `Unsupported Papa Parse option: <name>`.
 */
export interface ParseConfig<T = unknown> {
  /** Empty string auto-detects. Default `""`. */
  delimiter?: string;
  /** Empty string auto-detects `\n`, `\r\n`, or `\r`. Default `""`. */
  newline?: string;
  /** Default `"`. An empty string disables quoting. */
  quoteChar?: string;
  /** Default is the quote character. Pass `""` to disable escapes. */
  escapeChar?: string;
  /** Use the first row as object keys. */
  header?: boolean;
  /** Rename header cells before duplicate suffixes are applied. */
  transformHeader?: (header: string, index: number) => string;
  /** Numbers, booleans, dates, and empty-as-null. Uses JavaScript `parseFloat` and `Date`. */
  dynamicTyping?: DynamicTyping;
  /** Maximum data rows. `0` means the whole input. */
  preview?: number;
  /** `true` means `#`. A string is a literal comment prefix. */
  comments?: boolean | string;
  /** Drop blank rows in the TypeScript layer. `"greedy"` also drops whitespace-only rows. */
  skipEmptyLines?: boolean | "greedy";
  /** `true` ignores quotes. Omit to enable only when the chunk has no quote character. */
  fastMode?: boolean;
  /** Called per data row. `data` is that row, not a list. `parse` returns empty `data`. */
  step?: (results: StepResult<T>, parser: ParserHandle) => void;
  /** Called with the chunk result. `parse` then returns `undefined`, matching Papa. */
  chunk?: (results: ParseResult<T>, parser: ParserHandle) => void;
  complete?: (results: ParseResult<T> | undefined) => void;
  error?: (error: Error) => void;
  /**
   * `parseAsync` runs in a worker when one is available.
   * `parse` throws: it is synchronous and cannot start a worker.
   */
  worker?: boolean;
  /**
   * Per-cell callback. Runs in JavaScript before dynamic typing, so it costs a
   * boundary crossing for every value. Leave it off on large files.
   */
  transform?: (value: string, field: string | number) => unknown;
  /** Byte size for `File` / `Blob` streaming. Default 8 MiB. */
  chunkSize?: number;
}

/** Pause, resume, and abort handle passed to `step` and `chunk`. */
export class ParserHandle {
  aborted = false;
  paused = false;
  /** Continuation installed by the parser when `pause()` stops a sync loop. */
  continuation: (() => void) | null = null;

  abort(): void {
    this.aborted = true;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    const next = this.continuation;
    this.continuation = null;
    next?.();
  }
}
