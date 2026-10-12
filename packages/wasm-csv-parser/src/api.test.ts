import { expectTypeOf, test } from "vitest";
import { init, parse, parseAsync, ParserHandle } from "./index";
import type { ParseResult, StepResult } from "./types";

test("public functions keep their types", () => {
  expectTypeOf(init).toBeFunction();
  expectTypeOf(parse).toBeFunction();
  expectTypeOf(parseAsync).toBeFunction();
  expectTypeOf<ParseResult<string[]>>().toHaveProperty("data");
  expectTypeOf<ParseResult<string[]>>().toHaveProperty("errors");
  expectTypeOf<ParseResult<string[]>>().toHaveProperty("meta");
  expectTypeOf<StepResult<Record<string, string>>>().toHaveProperty("data");
  expectTypeOf<ParserHandle>().toHaveProperty("abort");
  expectTypeOf<ParserHandle>().toHaveProperty("pause");
  expectTypeOf<ParserHandle>().toHaveProperty("resume");
});
