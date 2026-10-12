// src/decode.ts
var TYPES = ["Quotes", "Delimiter", "FieldMismatch"];
var CODES = [
  "MissingQuotes",
  "InvalidQuotes",
  "UndetectableDelimiter",
  "TooFewFields",
  "TooManyFields"
];
var MESSAGES = {
  MissingQuotes: "Quoted field unterminated",
  InvalidQuotes: "Trailing quote on quoted field is malformed",
  UndetectableDelimiter: "Unable to auto-detect delimiting character; defaulted to ','",
  TooFewFields: "Too few fields",
  TooManyFields: "Too many fields"
};
function decodeOutput(out) {
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
  const rows = [];
  let field = 0;
  let byteStart = 0;
  for (let r = 0; r < rowEnds.length; r++) {
    const rowEnd = rowEnds[r];
    const row = [];
    while (field < rowEnd) {
      const byteEnd = fieldEnds[field];
      row.push(
        ascii ? text.slice(byteStart, byteEnd) : decoder.decode(bytes.subarray(byteStart, byteEnd))
      );
      byteStart = byteEnd;
      field += 1;
    }
    rows.push(row);
  }
  const errors = [];
  for (let i = 0; i < kinds.length; i++) {
    const code = CODES[codes[i]] ?? "MissingQuotes";
    const error = {
      type: TYPES[kinds[i]] ?? "Quotes",
      code,
      message: MESSAGES[code]
    };
    const row = errorRows[i];
    const index = errorIndexes[i];
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
    cursor
  };
}

// pkg/wasm-csv-parser.js
var RawOutput = class _RawOutput {
  static __wrap(ptr) {
    const obj = Object.create(_RawOutput.prototype);
    obj.__wbg_ptr = ptr;
    RawOutputFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawOutputFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_rawoutput_free(ptr, 0);
  }
  /**
   * @returns {boolean}
   */
  get aborted() {
    const ret = wasm.rawoutput_aborted(this.__wbg_ptr);
    return ret !== 0;
  }
  /**
   * @returns {boolean}
   */
  get ascii() {
    const ret = wasm.rawoutput_ascii(this.__wbg_ptr);
    return ret !== 0;
  }
  /**
   * @returns {number}
   */
  get cursor() {
    const ret = wasm.rawoutput_cursor(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
   * @returns {string}
   */
  get delimiter() {
    let deferred1_0;
    let deferred1_1;
    try {
      const ret = wasm.rawoutput_delimiter(this.__wbg_ptr);
      deferred1_0 = ret[0];
      deferred1_1 = ret[1];
      return getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
  }
  /**
   * @returns {string}
   */
  get linebreak() {
    let deferred1_0;
    let deferred1_1;
    try {
      const ret = wasm.rawoutput_linebreak(this.__wbg_ptr);
      deferred1_0 = ret[0];
      deferred1_1 = ret[1];
      return getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
  }
  /**
   * @returns {Uint8Array}
   */
  take_bytes() {
    const ret = wasm.rawoutput_take_bytes(this.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
  }
  /**
   * @returns {Uint8Array}
   */
  take_error_codes() {
    const ret = wasm.rawoutput_take_error_codes(this.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
  }
  /**
   * @returns {Int32Array}
   */
  take_error_indexes() {
    const ret = wasm.rawoutput_take_error_indexes(this.__wbg_ptr);
    var v1 = getArrayI32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v1;
  }
  /**
   * @returns {Uint8Array}
   */
  take_error_kinds() {
    const ret = wasm.rawoutput_take_error_kinds(this.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
  }
  /**
   * @returns {Int32Array}
   */
  take_error_rows() {
    const ret = wasm.rawoutput_take_error_rows(this.__wbg_ptr);
    var v1 = getArrayI32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v1;
  }
  /**
   * @returns {Uint32Array}
   */
  take_field_ends() {
    const ret = wasm.rawoutput_take_field_ends(this.__wbg_ptr);
    var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v1;
  }
  /**
   * @returns {Uint32Array}
   */
  take_row_cursors() {
    const ret = wasm.rawoutput_take_row_cursors(this.__wbg_ptr);
    var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v1;
  }
  /**
   * @returns {Uint32Array}
   */
  take_row_ends() {
    const ret = wasm.rawoutput_take_row_ends(this.__wbg_ptr);
    var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v1;
  }
  /**
   * @returns {boolean}
   */
  get truncated() {
    const ret = wasm.rawoutput_truncated(this.__wbg_ptr);
    return ret !== 0;
  }
};
if (Symbol.dispose) RawOutput.prototype[Symbol.dispose] = RawOutput.prototype.free;
var WasmStream = class {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    WasmStreamFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_wasmstream_free(ptr, 0);
  }
  abort() {
    wasm.wasmstream_abort(this.__wbg_ptr);
  }
  /**
   * @param {Uint8Array} chunk
   * @returns {RawOutput}
   */
  feed(chunk) {
    const ptr0 = passArray8ToWasm0(chunk, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.wasmstream_feed(this.__wbg_ptr, ptr0, len0);
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    return RawOutput.__wrap(ret[0]);
  }
  /**
   * @returns {RawOutput}
   */
  finish() {
    const ret = wasm.wasmstream_finish(this.__wbg_ptr);
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    return RawOutput.__wrap(ret[0]);
  }
  /**
   * @param {string} delimiter
   * @param {string} newline
   * @param {string} quote
   * @param {string} escape
   * @param {boolean} escape_set
   * @param {number} comments_mode
   * @param {string} comments
   * @param {number} preview
   * @param {number} fast_mode
   * @param {number} skip_empty
   */
  constructor(delimiter, newline, quote, escape, escape_set, comments_mode, comments, preview, fast_mode, skip_empty) {
    const ptr0 = passStringToWasm0(delimiter, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(newline, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(quote, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passStringToWasm0(escape, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len3 = WASM_VECTOR_LEN;
    const ptr4 = passStringToWasm0(comments, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len4 = WASM_VECTOR_LEN;
    const ret = wasm.wasmstream_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, escape_set, comments_mode, ptr4, len4, preview, fast_mode, skip_empty);
    this.__wbg_ptr = ret;
    WasmStreamFinalization.register(this, this.__wbg_ptr, this);
    return this;
  }
};
if (Symbol.dispose) WasmStream.prototype[Symbol.dispose] = WasmStream.prototype.free;
function parse_bytes(input, delimiter, newline, quote, escape, escape_set, comments_mode, comments, preview, max_rows, fast_mode, skip_empty) {
  const ptr0 = passArray8ToWasm0(input, wasm.__wbindgen_malloc);
  const len0 = WASM_VECTOR_LEN;
  const ptr1 = passStringToWasm0(delimiter, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
  const len1 = WASM_VECTOR_LEN;
  const ptr2 = passStringToWasm0(newline, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
  const len2 = WASM_VECTOR_LEN;
  const ptr3 = passStringToWasm0(quote, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
  const len3 = WASM_VECTOR_LEN;
  const ptr4 = passStringToWasm0(escape, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
  const len4 = WASM_VECTOR_LEN;
  const ptr5 = passStringToWasm0(comments, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
  const len5 = WASM_VECTOR_LEN;
  const ret = wasm.parse_bytes(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, escape_set, comments_mode, ptr5, len5, preview, max_rows, fast_mode, skip_empty);
  if (ret[2]) {
    throw takeFromExternrefTable0(ret[1]);
  }
  return RawOutput.__wrap(ret[0]);
}
function __wbg_get_imports() {
  const import0 = {
    __proto__: null,
    __wbg___wbindgen_throw_41e9ee4f547fc59a: function(arg0, arg1) {
      throw new Error(getStringFromWasm0(arg0, arg1));
    },
    __wbindgen_generic_0000000000000001: function(arg0, arg1) {
      const ret = getStringFromWasm0(arg0, arg1);
      return ret;
    },
    __wbindgen_init_externref_table: function() {
      const table = wasm.__wbindgen_externrefs;
      const offset = table.grow(4);
      table.set(0, void 0);
      table.set(offset + 0, void 0);
      table.set(offset + 1, null);
      table.set(offset + 2, true);
      table.set(offset + 3, false);
    }
  };
  return {
    __proto__: null,
    "./wasm-csv-parser_bg.js": import0
  };
}
var RawOutputFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_rawoutput_free(ptr, 1));
var WasmStreamFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_wasmstream_free(ptr, 1));
function getArrayI32FromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return getInt32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}
function getArrayU32FromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}
function getArrayU8FromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}
var cachedInt32ArrayMemory0 = null;
function getInt32ArrayMemory0() {
  if (cachedInt32ArrayMemory0 === null || cachedInt32ArrayMemory0.byteLength === 0) {
    cachedInt32ArrayMemory0 = new Int32Array(wasm.memory.buffer);
  }
  return cachedInt32ArrayMemory0;
}
function getStringFromWasm0(ptr, len) {
  return decodeText(ptr >>> 0, len);
}
var cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
  if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
    cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
  }
  return cachedUint32ArrayMemory0;
}
var cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
  if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
    cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
  }
  return cachedUint8ArrayMemory0;
}
function passArray8ToWasm0(arg, malloc) {
  const ptr = malloc(arg.length * 1, 1) >>> 0;
  getUint8ArrayMemory0().set(arg, ptr / 1);
  WASM_VECTOR_LEN = arg.length;
  return ptr;
}
function passStringToWasm0(arg, malloc, realloc) {
  if (realloc === void 0) {
    const buf = cachedTextEncoder.encode(arg);
    const ptr2 = malloc(buf.length, 1) >>> 0;
    getUint8ArrayMemory0().subarray(ptr2, ptr2 + buf.length).set(buf);
    WASM_VECTOR_LEN = buf.length;
    return ptr2;
  }
  let len = arg.length;
  let ptr = malloc(len, 1) >>> 0;
  const mem = getUint8ArrayMemory0();
  let offset = 0;
  for (; offset < len; offset++) {
    const code = arg.charCodeAt(offset);
    if (code > 127) break;
    mem[ptr + offset] = code;
  }
  if (offset !== len) {
    if (offset !== 0) {
      arg = arg.slice(offset);
    }
    ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
    const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
    const ret = cachedTextEncoder.encodeInto(arg, view);
    offset += ret.written;
    ptr = realloc(ptr, len, offset, 1) >>> 0;
  }
  WASM_VECTOR_LEN = offset;
  return ptr;
}
function takeFromExternrefTable0(idx) {
  const value = wasm.__wbindgen_externrefs.get(idx);
  wasm.__externref_table_dealloc(idx);
  return value;
}
var cachedTextDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
var MAX_SAFARI_DECODE_BYTES = 2146435072;
var numBytesDecoded = 0;
function decodeText(ptr, len) {
  numBytesDecoded += len;
  if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
    cachedTextDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
    cachedTextDecoder.decode();
    numBytesDecoded = len;
  }
  return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}
var cachedTextEncoder = new TextEncoder();
if (!("encodeInto" in cachedTextEncoder)) {
  cachedTextEncoder.encodeInto = function(arg, view) {
    const buf = cachedTextEncoder.encode(arg);
    view.set(buf);
    return {
      read: arg.length,
      written: buf.length
    };
  };
}
var WASM_VECTOR_LEN = 0;
var wasmModule;
var wasmInstance;
var wasm;
function __wbg_finalize_init(instance, module) {
  wasmInstance = instance;
  wasm = instance.exports;
  wasmModule = module;
  cachedInt32ArrayMemory0 = null;
  cachedUint32ArrayMemory0 = null;
  cachedUint8ArrayMemory0 = null;
  wasm.__wbindgen_start();
  return wasm;
}
function initSync(module) {
  if (wasm !== void 0) return wasm;
  if (module !== void 0) {
    if (Object.getPrototypeOf(module) === Object.prototype) {
      ({ module } = module);
    } else {
      console.warn("using deprecated parameters for `initSync()`; pass a single object instead");
    }
  }
  const imports = __wbg_get_imports();
  if (!(module instanceof WebAssembly.Module)) {
    module = new WebAssembly.Module(module);
  }
  const instance = new WebAssembly.Instance(module, imports);
  return __wbg_finalize_init(instance, module);
}

// src/worker.ts
function post(message) {
  const scope = globalThis;
  const inBrowserWorker = typeof globalThis.DedicatedWorkerGlobalScope !== "undefined";
  if (typeof scope.postMessage === "function" && inBrowserWorker) {
    scope.postMessage(message);
    return;
  }
  scope.process?.getBuiltinModule?.("worker_threads")?.parentPort?.postMessage(message);
}
function run(message) {
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
    scalars.skipEmpty
  );
  post({ type: "batch", batch: decodeOutput(out) });
}
function listen() {
  const scope = globalThis;
  const inBrowserWorker = typeof globalThis.DedicatedWorkerGlobalScope !== "undefined";
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
//# sourceMappingURL=worker.js.map