import { assertSupportedConfig, DEFAULT_CHUNK_SIZE, toScalars, type WasmScalars } from "./config";
import { decodeOutput, type RawBatch } from "./decode";
import { ensureSync, init, parse_bytes, wasmBytes, WasmStream } from "./loader";
import { assemble, createSession, deliverSteps, type Session } from "./postprocess";
import { ParserHandle, type ParseConfig, type ParseMeta, type ParseResult } from "./types";

export { init, ParserHandle };
export type {
  DynamicTyping,
  ParseConfig,
  ParseError,
  ParseMeta,
  ParseResult,
  StepResult,
} from "./types";

const encoder = new TextEncoder();

function callParse(bytes: Uint8Array, scalars: WasmScalars): RawBatch {
  const out = parse_bytes(
    bytes,
    scalars.delimiter,
    scalars.newline,
    scalars.quote,
    scalars.escape,
    scalars.escapeSet,
    scalars.commentsMode,
    scalars.comments,
    scalars.preview,
    scalars.maxRows,
    scalars.fastMode,
    scalars.skipEmpty,
  );
  return decodeOutput(out);
}

function emptyCompleteMeta(): ParseMeta {
  return {} as ParseMeta;
}

function finish<T>(
  result: ParseResult<T>,
  config: ParseConfig<T> | undefined,
  handle: ParserHandle,
  stepped: boolean,
  userAbort: boolean,
): ParseResult<T> | undefined {
  if (userAbort) return undefined;
  if (typeof config?.chunk === "function") {
    config.chunk(result, handle);
    config.complete?.(undefined);
    return undefined;
  }
  if (stepped) {
    if (!result.meta.aborted) {
      config?.complete?.({ data: [], errors: [], meta: emptyCompleteMeta() });
    }
    return result;
  }
  config?.complete?.(result);
  return result;
}

/**
 * Parse a CSV string on the current thread.
 *
 * Node loads wasm synchronously on the first call. In the browser, `await init()`
 * first or use {@link parseAsync}. `worker: true` throws because this call is synchronous.
 *
 * @returns The Papa-shaped result, or `undefined` when `chunk` is set or `step` calls `abort()`.
 */
export function parse<T = unknown>(
  input: string,
  config?: ParseConfig<T>,
): ParseResult<T> | undefined {
  if (typeof input !== "string") {
    throw new Error("papa-wasm: File and Blob inputs need parseAsync().");
  }
  assertSupportedConfig(config);
  if (config?.worker) {
    throw new Error(
      "papa-wasm: worker: true needs parseAsync(). parse() stays synchronous.",
    );
  }
  ensureSync();
  const scalars = toScalars(config);
  let batch: RawBatch;
  try {
    batch = callParse(encoder.encode(input), scalars);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    config?.error?.(err);
    throw err;
  }
  return finishParsed(batch, config, scalars.maxRows);
}

function finishParsed<T>(
  batch: RawBatch,
  config: ParseConfig<T> | undefined,
  maxRows: number,
): ParseResult<T> | undefined {
  const session = createSession(config);
  const handle = new ParserHandle();
  if (typeof config?.step === "function") {
    const delivered = deliverSteps(batch, session, config, maxRows, handle);
    return finish(delivered.result as ParseResult<T>, config, handle, true, delivered.userAbort);
  }
  const assembled = assemble<T>(batch, session, config, maxRows);
  return finish(
    { data: assembled.data, errors: assembled.errors, meta: assembled.meta },
    config,
    handle,
    false,
    false,
  );
}

/**
 * Parse a string, `Blob`, or `File`. Loads wasm if needed.
 * `worker: true` uses a module worker and falls back to this thread with a warning.
 *
 * @param input CSV text or a binary blob of UTF-8 CSV.
 */
export async function parseAsync<T = unknown>(
  input: string | Blob,
  config?: ParseConfig<T>,
): Promise<ParseResult<T> | undefined> {
  assertSupportedConfig(config);
  await init();
  if (config?.worker) {
    try {
      return await parseWithWorker(input, config);
    } catch (error) {
      console.warn(
        "papa-wasm: worker unavailable, parsing on this thread.",
        error,
      );
    }
  }
  if (typeof input === "string") return parse(input, { ...config, worker: false });
  return parseBlob(input, { ...config, worker: false });
}

async function parseBlob<T>(
  blob: Blob,
  config: ParseConfig<T> | undefined,
): Promise<ParseResult<T> | undefined> {
  const chunkSize = config?.chunkSize ?? DEFAULT_CHUNK_SIZE;
  if (blob.size <= chunkSize) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    ensureSync();
    const scalars = toScalars(config);
    return finishParsed(callParse(bytes, scalars), config, scalars.maxRows);
  }
  return parseChunked(blob, config);
}

async function parseChunked<T>(
  blob: Blob,
  config: ParseConfig<T> | undefined,
): Promise<ParseResult<T> | undefined> {
  ensureSync();
  const scalars = toScalars(config);
  const stream = new WasmStream(
    scalars.delimiter,
    scalars.newline,
    scalars.quote,
    scalars.escape,
    scalars.escapeSet,
    scalars.commentsMode,
    scalars.comments,
    0,
    scalars.fastMode,
    scalars.skipEmpty,
  );
  const session: Session = createSession(config);
  const handle = new ParserHandle();
  const chunkSize = config?.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const data: T[] = [];
  const errors = [];
  let meta: ParseMeta | null = null;
  let rowBase = 0;
  try {
    for (let offset = 0; offset < blob.size; offset += chunkSize) {
      const bytes = new Uint8Array(
        await blob.slice(offset, offset + chunkSize).arrayBuffer(),
      );
      const batch = decodeOutput(stream.feed(bytes));
      const piece = takeBatch(batch, session, config, handle, rowBase, scalars.maxRows);
      if (piece.userAbort) {
        stream.free();
        return undefined;
      }
      data.push(...piece.data);
      errors.push(...piece.errors);
      meta = piece.meta;
      rowBase += batch.rows.length;
      if (handle.paused) await waitForResume(handle);
      if (piece.stop) break;
    }
    const tail = decodeOutput(stream.finish());
    const piece = takeBatch(tail, session, config, handle, rowBase, scalars.maxRows);
    stream.free();
    if (piece.userAbort) return undefined;
    data.push(...piece.data);
    errors.push(...piece.errors);
    meta = piece.meta;
  } catch (error) {
    stream.free();
    const err = error instanceof Error ? error : new Error(String(error));
    config?.error?.(err);
    throw err;
  }
  const result: ParseResult<T> = {
    data: typeof config?.step === "function" ? [] : data,
    errors: typeof config?.step === "function" ? [] : errors,
    meta: meta ?? {
      delimiter: "",
      linebreak: "",
      aborted: false,
      truncated: false,
      cursor: 0,
      renamedHeaders: null,
    },
  };
  return finish(result, config, handle, typeof config?.step === "function", false);
}

function takeBatch<T>(
  batch: RawBatch,
  session: Session,
  config: ParseConfig<T> | undefined,
  handle: ParserHandle,
  rowBase: number,
  maxRows: number,
): { data: T[]; errors: ParseResult["errors"]; meta: ParseMeta; userAbort: boolean; stop: boolean } {
  if (typeof config?.step === "function") {
    const delivered = deliverSteps(batch, session, config, maxRows, handle, rowBase);
    return {
      data: [],
      errors: [],
      meta: delivered.result.meta,
      userAbort: delivered.userAbort,
      stop: delivered.result.meta.aborted || delivered.userAbort,
    };
  }
  const assembled = assemble<T>(batch, session, config, 0);
  return {
    data: assembled.data,
    errors: assembled.errors,
    meta: assembled.meta,
    userAbort: false,
    stop: false,
  };
}

function waitForResume(handle: ParserHandle): Promise<void> {
  if (!handle.paused) return Promise.resolve();
  return new Promise((resolve) => {
    const previous = handle.continuation;
    handle.continuation = () => {
      previous?.();
      resolve();
    };
  });
}

async function parseWithWorker<T>(
  input: string | Blob,
  config: ParseConfig<T>,
): Promise<ParseResult<T> | undefined> {
  const bytes =
    typeof input === "string"
      ? encoder.encode(input)
      : new Uint8Array(await input.arrayBuffer());
  const worker = openWorker();
  const scalars = toScalars(config);
  const wasm = wasmBytes().slice();
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const batch = await new Promise<RawBatch>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<{ type: string; batch?: RawBatch; message?: string }>) => {
      if (event.data.type === "batch" && event.data.batch) resolve(event.data.batch);
      else reject(new Error(event.data.message ?? "worker failed"));
    };
    worker.onerror = (event) => {
      const failure = event as { error?: Error; message?: string };
      reject(failure.error ?? new Error(failure.message ?? "worker failed"));
    };
    worker.postMessage({ type: "oneshot", wasm, buffer, scalars }, [wasm.buffer, buffer]);
  });
  worker.terminate?.();
  return finishParsed(batch, { ...config, worker: false }, scalars.maxRows);
}

interface WorkerPort {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event | { message?: string; error?: Error }) => void) | null;
  terminate?: () => void;
}

function openWorker(): WorkerPort {
  if (typeof Worker !== "undefined") {
    return new Worker(new URL("./worker.js", import.meta.url), {
      type: "module",
    }) as unknown as WorkerPort;
  }
  const threads = (
    globalThis as {
      process?: {
        getBuiltinModule?: (name: string) => {
          Worker: new (url: URL) => {
            postMessage(message: unknown, transfer?: Transferable[]): void;
            on(event: "message", handler: (data: unknown) => void): void;
            on(event: "error", handler: (error: Error) => void): void;
            terminate(): Promise<number>;
          };
        };
      };
    }
  ).process?.getBuiltinModule?.("worker_threads");
  if (!threads?.Worker) throw new Error("Workers are not available");
  const nodeWorker = new threads.Worker(new URL("./worker.js", import.meta.url));
  const port: WorkerPort = {
    postMessage(message, transfer) {
      nodeWorker.postMessage(message, transfer);
    },
    onmessage: null,
    onerror: null,
    terminate() {
      void nodeWorker.terminate();
    },
  };
  nodeWorker.on("message", (data: unknown) => {
    port.onmessage?.({ data } as MessageEvent);
  });
  nodeWorker.on("error", (error: Error) => {
    port.onerror?.({ message: error.message, error });
  });
  return port;
}
