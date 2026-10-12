import type { ParseConfig } from "./types";

const SUPPORTED = new Set([
  "delimiter",
  "newline",
  "quoteChar",
  "escapeChar",
  "header",
  "transformHeader",
  "dynamicTyping",
  "preview",
  "comments",
  "skipEmptyLines",
  "fastMode",
  "step",
  "chunk",
  "complete",
  "error",
  "worker",
  "transform",
  "chunkSize",
]);

/** Throw if the config contains a Papa option this version does not implement. */
export function assertSupportedConfig(config: object | undefined): void {
  if (!config) return;
  for (const key of Object.keys(config)) {
    if (!SUPPORTED.has(key)) {
      throw new Error(`Unsupported Papa Parse option: ${key}`);
    }
  }
}

export interface WasmScalars {
  delimiter: string;
  newline: string;
  quote: string;
  escape: string;
  escapeSet: boolean;
  commentsMode: number;
  comments: string;
  preview: number;
  maxRows: number;
  fastMode: number;
  skipEmpty: number;
}

/** Map a Papa config onto the flat wasm ABI. */
export function toScalars(config: ParseConfig<any> | undefined): WasmScalars {
  const cfg = config ?? {};
  const preview = cfg.preview && cfg.preview > 0 ? cfg.preview : 0;
  const header = cfg.header === true;
  const stepping = typeof cfg.step === "function";
  let rustPreview = preview;
  let maxRows = 0;
  if (stepping && preview > 0) {
    rustPreview = 0;
    maxRows = preview + (header ? 1 : 0) + 1;
  } else if (header && preview > 0) {
    rustPreview = preview + 1;
  }

  let commentsMode = 0;
  let comments = "";
  if (cfg.comments === true) commentsMode = 1;
  else if (typeof cfg.comments === "string") {
    commentsMode = 2;
    comments = cfg.comments;
  }

  let skipEmpty = 0;
  if (cfg.skipEmptyLines === true) skipEmpty = 1;
  else if (cfg.skipEmptyLines === "greedy") skipEmpty = 2;
  else if (cfg.skipEmptyLines) {
    throw new Error(
      "Unsupported skipEmptyLines value. Use false, true, or \"greedy\".",
    );
  }

  let fastMode = -1;
  if (cfg.fastMode === false) fastMode = 0;
  else if (cfg.fastMode === true) fastMode = 1;

  return {
    delimiter: cfg.delimiter ?? "",
    newline: cfg.newline ?? "",
    quote: cfg.quoteChar == null ? '"' : cfg.quoteChar,
    escape: cfg.escapeChar ?? "",
    escapeSet: cfg.escapeChar !== undefined,
    commentsMode,
    comments,
    preview: rustPreview,
    maxRows,
    fastMode,
    skipEmpty,
  };
}

export const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024;
