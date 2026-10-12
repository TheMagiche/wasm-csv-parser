import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    react: "src/react.ts",
    worker: "src/worker.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  shims: true,
  target: "es2022",
  external: ["react", "react/jsx-runtime"],
  esbuildOptions(options) {
    options.supported = { ...options.supported };
  },
});
