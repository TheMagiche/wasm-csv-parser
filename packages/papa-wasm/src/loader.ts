import initWasm, {
  initSync,
  parse_bytes,
  WasmStream,
  type RawOutput,
} from "../pkg/papa-wasm.js";

export { parse_bytes, WasmStream, type RawOutput };

let ready = false;
let pending: Promise<void> | null = null;
let cached: Uint8Array | null = null;

interface NodeProcess {
  versions?: { node?: string };
  getBuiltinModule?: (name: string) => unknown;
}

function nodeProcess(): NodeProcess | undefined {
  return (globalThis as { process?: NodeProcess }).process;
}

function isNode(): boolean {
  return !!nodeProcess()?.versions?.node;
}

function wasmCandidates(): URL[] {
  return [
    new URL("./papa-wasm_bg.wasm", import.meta.url),
    new URL("../papa-wasm_bg.wasm", import.meta.url),
    new URL("../pkg/papa-wasm_bg.wasm", import.meta.url),
  ];
}

interface NodeFs {
  existsSync(path: string): boolean;
  readFileSync(path: string): Uint8Array;
}

interface NodeUrl {
  fileURLToPath(url: URL): string;
}

function nodeBuiltin<T>(name: string): T {
  const builtin = nodeProcess()?.getBuiltinModule?.(name) as T | undefined;
  if (!builtin) {
    throw new Error(`papa-wasm: Node builtin ${name} is unavailable`);
  }
  return builtin;
}

function readWasmFile(): Uint8Array {
  const fs = nodeBuiltin<NodeFs>("fs");
  const url = nodeBuiltin<NodeUrl>("url");
  for (const candidate of wasmCandidates()) {
    const path = url.fileURLToPath(candidate);
    if (fs.existsSync(path)) return fs.readFileSync(path);
  }
  throw new Error(
    "papa-wasm: could not find papa-wasm_bg.wasm. Run the wasm build first.",
  );
}

/**
 * Load the wasm module and cache it.
 *
 * Node `parse()` initializes synchronously with `initSync` and does not need
 * this call. In the browser, call `await init()` before `parse()`, or use
 * `parseAsync()`, which loads the module itself. A URL fetch tries
 * `WebAssembly.instantiateStreaming` first and falls back when the server
 * does not send `application/wasm`.
 *
 * @param wasmUrl URL of `papa-wasm_bg.wasm` when it is hosted apart from the bundle.
 */
export async function init(wasmUrl?: string): Promise<void> {
  if (ready) return;
  if (!pending) {
    pending = (async () => {
      if (isNode() && !wasmUrl) {
        cached = readWasmFile();
        initSync({ module: cached });
      } else {
        const url = wasmUrl ?? wasmCandidates()[2]!.href;
        try {
          await initWasm({ module_or_path: url });
          cached = new Uint8Array(await (await fetch(url)).arrayBuffer());
        } catch {
          cached = new Uint8Array(await (await fetch(url)).arrayBuffer());
          initSync({ module: cached });
        }
      }
      ready = true;
    })().catch((error: unknown) => {
      pending = null;
      throw error;
    });
  }
  await pending;
}

/**
 * Synchronous init for Node. Browser `parse()` throws a clear error until
 * `init()` has resolved, because wasm cannot be compiled synchronously there.
 */
export function ensureSync(): void {
  if (ready) return;
  if (!isNode()) {
    throw new Error(
      "papa-wasm: call await init() before parse() in the browser. parseAsync() loads the module itself.",
    );
  }
  cached = readWasmFile();
  initSync({ module: cached });
  ready = true;
}

/** Bytes of the compiled module, for transferring into a worker. */
export function wasmBytes(): Uint8Array {
  if (!cached) ensureSync();
  if (!cached) throw new Error("papa-wasm: wasm is not loaded");
  return cached;
}

export function wasmReady(): boolean {
  return ready;
}
