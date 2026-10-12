import { useCallback, useEffect, useRef, useState } from "react";
import { parseAsync } from "./index";
import type { ParseConfig, ParseError, ParseMeta, ParseResult } from "./types";

export { init, parse, parseAsync } from "./index";

export type PapaStatus = "idle" | "loading-wasm" | "parsing" | "done" | "error";

export interface UsePapaWasm<T> {
  parse: (input: string | Blob) => void;
  data: T[];
  errors: ParseError[];
  meta: ParseMeta | null;
  /** 0..1, updated at most once per animation frame. */
  progress: number;
  status: PapaStatus;
  abort: () => void;
}

/**
 * Parse CSV in a worker. Progress updates are throttled to animation frames.
 * The in-flight parse is aborted on unmount. Importing this module does not
 * touch `window` or compile wasm.
 *
 * @param config Papa options. `worker` is forced on. `step` and `chunk` are ignored;
 * the hook publishes the finished result.
 */
export function usePapaWasm<T = unknown>(
  config?: Omit<ParseConfig<T>, "step" | "chunk" | "worker">,
): UsePapaWasm<T> {
  const [data, setData] = useState<T[]>([]);
  const [errors, setErrors] = useState<ParseError[]>([]);
  const [meta, setMeta] = useState<ParseMeta | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<PapaStatus>("idle");
  const abortRef = useRef(false);
  const frame = useRef<number | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    return () => {
      abortRef.current = true;
      if (frame.current != null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(frame.current);
      }
    };
  }, []);

  const abort = useCallback(() => {
    abortRef.current = true;
    setStatus("idle");
  }, []);

  const parse = useCallback((input: string | Blob) => {
    abortRef.current = false;
    setStatus("loading-wasm");
    setProgress(0);
    setData([]);
    setErrors([]);
    setMeta(null);
    const size = typeof input === "string" ? input.length : input.size;
    let shown = 0;
    const publish = (next: number) => {
      if (typeof requestAnimationFrame !== "function") {
        setProgress(next);
        return;
      }
      if (frame.current != null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        setProgress(shown);
      });
      shown = next;
    };
    publish(size === 0 ? 1 : 0.02);
    setStatus("parsing");
    void parseAsync<T>(input, { ...configRef.current, worker: true })
      .then((result: ParseResult<T> | undefined) => {
        if (abortRef.current) return;
        publish(1);
        setData(result?.data ?? []);
        setErrors(result?.errors ?? []);
        setMeta(result?.meta ?? null);
        setStatus("done");
      })
      .catch((error: unknown) => {
        if (abortRef.current) return;
        setErrors([
          {
            type: "Delimiter",
            code: "UndetectableDelimiter",
            message: error instanceof Error ? error.message : String(error),
          },
        ]);
        setStatus("error");
      });
  }, []);

  return { parse, data, errors, meta, progress, status, abort };
}
