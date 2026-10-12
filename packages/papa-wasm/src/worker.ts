/**
 * Module worker entry. The main thread transfers wasm bytes and the CSV buffer.
 * Header objects and dynamic typing stay on the caller side.
 */
import { decodeOutput } from "./decode";
import { initSync, parse_bytes } from "../pkg/papa-wasm.js";
import type { WasmScalars } from "./config";

interface Oneshoot {
  type: "oneshot";
  wasm: ArrayBuffer;
  buffer: ArrayBuffer;
  scalars: WasmScalars;
}

function post(message: unknown): void {
  const scope = globalThis as {
    postMessage?: (message: unknown) => void;
    process?: { getBuiltinModule?: (name: string) => { parentPort: { postMessage(message: unknown): void } | null } };
  };
  const inBrowserWorker =
    typeof (globalThis as { DedicatedWorkerGlobalScope?: unknown }).DedicatedWorkerGlobalScope !==
    "undefined";
  if (typeof scope.postMessage === "function" && inBrowserWorker) {
    scope.postMessage(message);
    return;
  }
  scope.process?.getBuiltinModule?.("worker_threads")?.parentPort?.postMessage(message);
}

function run(message: Oneshoot): void {
  initSync({ module: new Uint8Array(message.wasm) });
  const scalars = message.scalars;
  const out = parse_bytes(
    new Uint8Array(message.buffer),
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
  post({ type: "batch", batch: decodeOutput(out) });
}

function listen(): void {
  const scope = globalThis as {
    onmessage?: ((event: MessageEvent<Oneshoot>) => void) | null;
    process?: {
      getBuiltinModule?: (name: string) => {
        parentPort: { on(event: "message", handler: (data: Oneshoot) => void): void } | null;
      };
    };
  };
  const inBrowserWorker = typeof (globalThis as { DedicatedWorkerGlobalScope?: unknown }).DedicatedWorkerGlobalScope !== "undefined";
  if (inBrowserWorker) {
    scope.onmessage = (event) => {
      try {
        run(event.data);
      } catch (error) {
        post({ type: "error", message: error instanceof Error ? error.message : String(error) });
      }
    };
    return;
  }
  const port = scope.process?.getBuiltinModule?.("worker_threads")?.parentPort;
  port?.on("message", (data) => {
    try {
      run(data);
    } catch (error) {
      post({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  });
}

listen();
