import { readFile, rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { executeBashWithOperations } from "./bash-executor.js";
import { DEFAULT_MAX_BYTES } from "./tools/truncate.js";
import { ByteTail } from "../byte-tail.js";

describe("output byte backpressure", () => {
  it("caps a single huge Unicode chunk and preserves full cold output", async () => {
    const body = "汉😀".repeat(100000);
    const result = await executeBashWithOperations("fixture", process.cwd(), { exec: async (_command, _cwd, options) => {
      options.onData(Buffer.from(body)); return { exitCode: 0 };
    } });
    try {
      expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
      expect(result.truncated).toBe(true); expect(result.output).not.toContain("�");
      expect(await readFile(result.fullOutputPath!, "utf8")).toBe(body);
    } finally { if (result.fullOutputPath) await rm(result.fullOutputPath); }
  });
  it("streams many bounded chunks into one artifact with exact incremental readback", async () => {
    const body = "αβγ\n".repeat(4096);
    const result = await executeBashWithOperations("fixture", process.cwd(), { exec: async (_command, _cwd, options) => {
      for (let i = 0; i < 120; i++) options.onData(Buffer.from(body)); return { exitCode: 0 };
    } });
    try { expect(await readFile(result.fullOutputPath!, "utf8")).toBe(body.repeat(120)); expect(result.truncated).toBe(true); }
    finally { if (result.fullOutputPath) await rm(result.fullOutputPath); }
  });
  it("shares a byte cap across streams and never retains partial leading characters", () => {
    const tail = new ByteTail(7); tail.append("stdout", "汉😀"); tail.append("stderr", "abcd");
    expect(tail.bytes).toBeLessThanOrEqual(7); expect(tail.text()).not.toContain("�"); expect(tail.omittedBytes).toBe(7);
    const tiny = new ByteTail(1); for (let i = 0; i < 100; i++) tiny.append("stdout", "汉");
    expect(tiny.bytes).toBe(0); tiny.append("stdout", "a"); expect(tiny.text()).toBe("a");
  });
});
