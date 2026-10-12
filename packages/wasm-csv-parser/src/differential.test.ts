import Papa from "papaparse";
import { describe, expect, test } from "vitest";
import { parse, parseAsync } from "./index";
import type { ParseConfig, ParseResult } from "./types";

function norm(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, inner) => {
      if (inner instanceof Date) return { __date: inner.toISOString() };
      return inner;
    }),
  );
}

function same(input: string, config?: ParseConfig) {
  const ours = parse(input, config);
  const theirs = Papa.parse(input, config as Papa.ParseConfig);
  expect(norm(ours)).toEqual(norm(theirs));
}

const inputs = [
  "a,b\nc,d",
  "a,b\n",
  "a,b\n\nc,d",
  '"hello, world",b\nc,d',
  '"a""b",c',
  '"ab""',
  '""',
  '"""',
  '"a"""',
  '"a" ,b',
  '"a", "b"',
  "a, b,c",
  '"abc"def,x\n1,2',
  "a,b\r\nc,d",
  '"a\r\nb",c\r\nd,e',
  "a;b\nc;d",
  "a\tb\tc\nd\te\tf",
  "é,b\n",
  "😀,x\ny,z",
  "\uFEFFa,b\nc,d",
  "#c\na,b\n#x\nc,d",
  "a,b\n#comment",
  "# hi",
  "",
  "\n",
  "a,b\nc,d\ne,f",
  '"unterminated,field',
  "a,a,a_1\n1,2,3",
  "A,a\n1,2",
  "a,b,c\n1,2",
  "a,b\n1,2,3",
  "a,b\n , \n1,2",
  "a,b\n\n1,2",
  "true,FALSE,True,001,.5,5.,+5,-5,5e2, 2 ,9007199254740993,",
  "a,b\n2020-01-01T00:00:00Z,2020-01-01\n2020-01-01T00:00:00,2020-01-01T00:00Z",
  '"say \\"hi\\"",b',
];

describe("differential parse", () => {
  test("plain and auto delimiter", () => {
    for (const input of inputs) {
      same(input);
      same(input, { delimiter: "," });
    }
  });

  test("header, typing, skip, comments, preview, fast mode", () => {
    const configs: ParseConfig[] = [
      { header: true },
      { header: true, dynamicTyping: true },
      { header: true, skipEmptyLines: true },
      { header: true, skipEmptyLines: "greedy" },
      { header: true, transformHeader: (header) => header.toLowerCase() },
      { comments: "#" },
      { comments: true },
      { preview: 1, delimiter: "," },
      { preview: 1, delimiter: ",", fastMode: true },
      { preview: 1, delimiter: ",", fastMode: false },
      { preview: 2, delimiter: ",", fastMode: true },
      { header: true, preview: 1, delimiter: ",", fastMode: true },
      { header: true, preview: 1, delimiter: ",", fastMode: false },
      { fastMode: true, delimiter: "," },
      { fastMode: false, delimiter: "," },
      { dynamicTyping: true, delimiter: "," },
      { delimiter: ";", newline: "\n" },
      { quoteChar: "'", delimiter: "," },
    ];
    for (const config of configs) {
      for (const input of inputs) {
        if (config.comments && input.includes('"say')) continue;
        try {
          same(input, config);
        } catch (error) {
          throw new Error(
            `${JSON.stringify(config)} input ${JSON.stringify(input)}\n${error}`,
          );
        }
      }
    }
  });

  test("duplicate headers and field mismatch messages", () => {
    same("a,a\n1,2", { header: true });
    same("a,a,a_1\n1,2,3", { header: true });
    same("a,b\n1,2,3", { header: true, dynamicTyping: true });
    same("a,b,c\n1,2", { header: true });
  });

  test("step and chunk callbacks", () => {
    const input = "a,b\nc,d\ne,f";
    const oursSteps: unknown[] = [];
    const papaSteps: unknown[] = [];
    let oursComplete: unknown;
    let papaComplete: unknown;
    const ours = parse(input, {
      delimiter: ",",
      step: (row) => oursSteps.push(norm(row)),
      complete: (result) => {
        oursComplete = norm(result);
      },
    });
    const theirs = Papa.parse(input, {
      delimiter: ",",
      step: (row) => papaSteps.push(norm(row)),
      complete: (result) => {
        papaComplete = norm(result);
      },
    });
    expect(oursSteps).toEqual(papaSteps);
    expect(norm(ours)).toEqual(norm(theirs));
    expect(oursComplete).toEqual(papaComplete);

    const previewOurs: unknown[] = [];
    const previewPapa: unknown[] = [];
    const left = parse(input, {
      delimiter: ",",
      preview: 1,
      fastMode: false,
      step: (row) => previewOurs.push(norm(row)),
    });
    const right = Papa.parse(input, {
      delimiter: ",",
      preview: 1,
      fastMode: false,
      step: (row) => previewPapa.push(norm(row)),
    });
    expect(previewOurs).toEqual(previewPapa);
    expect(norm(left)).toEqual(norm(right));

    let chunkReturn: unknown = "missing";
    let papaChunk: unknown = "missing";
    chunkReturn = parse("a,b\nc,d", {
      delimiter: ",",
      chunk: () => {},
      complete: (result) => {
        chunkReturn = result;
      },
    });
    papaChunk = Papa.parse("a,b\nc,d", {
      delimiter: ",",
      chunk: () => {},
    } as Papa.ParseConfig);
    expect(chunkReturn).toBeUndefined();
    expect(papaChunk).toBeUndefined();
  });

  test("unsupported options and worker flag throw", () => {
    expect(() => parse("a", { download: true } as ParseConfig)).toThrow(/download/);
    expect(() => parse("a", { worker: true })).toThrow(/parseAsync/);
    expect(() => parse("a,b", { comments: "," })).toThrow(/Comment character same as delimiter/);
  });

  test("parseAsync matches parse for strings", async () => {
    const input = "a,b\nc,d\n";
    const asyncResult = await parseAsync(input, { header: true, dynamicTyping: true });
    const syncResult = parse(input, { header: true, dynamicTyping: true });
    expect(norm(asyncResult)).toEqual(norm(syncResult));
  });

  test("blob parse matches a string", async () => {
    const input = "h1,h2\n1,2\n3,4\n";
    const blob = new Blob([input]);
    const fromBlob = await parseAsync(blob, { header: true });
    expect(norm(fromBlob)).toEqual(norm(parse(input, { header: true }) as ParseResult));
  });
});
