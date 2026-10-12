import type { RawOutput } from "./loader";
import type { ParseError } from "./types";

const TYPES = ["Quotes", "Delimiter", "FieldMismatch"] as const;
const CODES = [
  "MissingQuotes",
  "InvalidQuotes",
  "UndetectableDelimiter",
  "TooFewFields",
  "TooManyFields",
] as const;

const MESSAGES: Record<(typeof CODES)[number], string> = {
  MissingQuotes: "Quoted field unterminated",
  InvalidQuotes: "Trailing quote on quoted field is malformed",
  UndetectableDelimiter: "Unable to auto-detect delimiting character; defaulted to ','",
  TooFewFields: "Too few fields",
  TooManyFields: "Too many fields",
};

export interface RawBatch {
  rows: string[][];
  rowCursors: number[];
  errors: ParseError[];
  delimiter: string;
  linebreak: string;
  aborted: boolean;
  truncated: boolean;
  cursor: number;
}

/**
 * Turn the flat wasm buffer into strings.
 * ASCII inputs decode once and slice. Other inputs decode each field so a
 * multibyte character cannot be split on a byte offset.
 */
export function decodeOutput(out: RawOutput): RawBatch {
  const bytes = out.take_bytes();
  const fieldEnds = out.take_field_ends();
  const rowEnds = out.take_row_ends();
  const rowCursors = out.take_row_cursors();
  const kinds = out.take_error_kinds();
  const codes = out.take_error_codes();
  const errorRows = out.take_error_rows();
  const errorIndexes = out.take_error_indexes();
  const ascii = out.ascii;
  const delimiter = out.delimiter;
  const linebreak = out.linebreak;
  const aborted = out.aborted;
  const truncated = out.truncated;
  const cursor = out.cursor;
  out.free();

  const decoder = new TextDecoder();
  const text = ascii ? decoder.decode(bytes) : "";
  const rows: string[][] = [];
  let field = 0;
  let byteStart = 0;
  for (let r = 0; r < rowEnds.length; r++) {
    const rowEnd = rowEnds[r]!;
    const row: string[] = [];
    while (field < rowEnd) {
      const byteEnd = fieldEnds[field]!;
      row.push(
        ascii
          ? text.slice(byteStart, byteEnd)
          : decoder.decode(bytes.subarray(byteStart, byteEnd)),
      );
      byteStart = byteEnd;
      field += 1;
    }
    rows.push(row);
  }

  const errors: ParseError[] = [];
  for (let i = 0; i < kinds.length; i++) {
    const code = CODES[codes[i]!] ?? "MissingQuotes";
    const error: ParseError = {
      type: TYPES[kinds[i]!] ?? "Quotes",
      code,
      message: MESSAGES[code],
    };
    const row = errorRows[i]!;
    const index = errorIndexes[i]!;
    if (row >= 0) error.row = row;
    if (index >= 0) error.index = index;
    errors.push(error);
  }

  return {
    rows,
    rowCursors: Array.from(rowCursors),
    errors,
    delimiter,
    linebreak,
    aborted,
    truncated,
    cursor,
  };
}
