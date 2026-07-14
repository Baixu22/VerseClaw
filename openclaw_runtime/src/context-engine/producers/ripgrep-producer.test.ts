import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { projectIdForRoot } from "./hash.js";
import { languageForPath, ripgrepSearch } from "./ripgrep-producer.js";

const rgAvailable = spawnSync("rg", ["--version"], { windowsHide: true }).status === 0;

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ripgrep-producer-"));
fs.writeFileSync(
  path.join(fixtureRoot, "alpha.ts"),
  "export const NEEDLE_TOKEN = \"alpha\";\nexport const other = 1;\n",
);
fs.writeFileSync(
  path.join(fixtureRoot, "beta.py"),
  "NEEDLE_TOKEN = 'beta'\n",
);

afterAll(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

describe.skipIf(!rgAvailable)("ripgrep producer (T0)", () => {
  const projectId = projectIdForRoot(fixtureRoot);

  it("maps rg matches to block chunks", async () => {
    const result = await ripgrepSearch("NEEDLE_TOKEN", fixtureRoot, { projectId });
    expect(result.error).toBeUndefined();
    expect(result.truncated).toBe(false);
    const files = result.chunks.map((chunk) => chunk.filePath).sort();
    expect(files).toEqual(["alpha.ts", "beta.py"]);
    for (const chunk of result.chunks) {
      expect(chunk.kind).toBe("block");
      expect(chunk.projectId).toBe(projectId);
      expect(chunk.content).toContain("NEEDLE_TOKEN");
      expect(chunk.startLine).toBe(1);
    }
    const tsChunk = result.chunks.find((chunk) => chunk.filePath === "alpha.ts");
    expect(tsChunk?.language).toBe("typescript");
    const pyChunk = result.chunks.find((chunk) => chunk.filePath === "beta.py");
    expect(pyChunk?.language).toBe("python");
  });

  it("returns an empty result when nothing matches", async () => {
    const result = await ripgrepSearch("no_such_token_zzz", fixtureRoot, { projectId });
    expect(result.chunks).toEqual([]);
    expect(result.error).toBeUndefined();
  });

  it("honors the match cap", async () => {
    const result = await ripgrepSearch("NEEDLE_TOKEN", fixtureRoot, { projectId, maxMatches: 1 });
    expect(result.chunks.length).toBe(1);
    expect(result.truncated).toBe(true);
  });
});

describe("languageForPath", () => {
  it("maps extensions to language ids", () => {
    expect(languageForPath("a/b/c.ts")).toBe("typescript");
    expect(languageForPath("a/b/c.py")).toBe("python");
    expect(languageForPath("a/b/c.rs")).toBe("rust");
    expect(languageForPath("a/b/c.unknownext")).toBe("unknown");
  });
});
