import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { projectIdForRoot } from "./hash.js";
import {
  languageForPath,
  resolveRipgrepExecutable,
  ripgrepSearch,
} from "./ripgrep-producer.js";

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

describe("ripgrep producer (T0)", () => {
  const projectId = projectIdForRoot(fixtureRoot);

  it("maps rg matches to block chunks", async () => {
    const result = await ripgrepSearch("NEEDLE_TOKEN", fixtureRoot, { projectId });
    expect(result.error).toBeUndefined();
    expect(result.truncated).toBe(false);
    expect(result.diagnostics.exitCode).toBe(0);
    expect(result.diagnostics.matchEvents).toBe(2);
    expect(result.diagnostics.unmappedMatchEvents).toBe(0);
    expect(result.diagnostics.malformedEvents).toBe(0);
    if (process.platform === "win32") {
      expect(path.basename(result.diagnostics.executable).toLowerCase()).toBe("rg.exe");
      expect(["path", "codex-path"]).toContain(result.diagnostics.executableResolution);
      expect(path.isAbsolute(result.diagnostics.executable)).toBe(true);
    }
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
    expect(result.diagnostics.exitCode).toBe(1);
    expect(result.diagnostics.matchEvents).toBe(0);
  });

  it("honors the match cap", async () => {
    const result = await ripgrepSearch("NEEDLE_TOKEN", fixtureRoot, { projectId, maxMatches: 1 });
    expect(result.chunks.length).toBe(1);
    expect(result.truncated).toBe(true);
  });

  it("does not collapse a successful but unmappable rg response into no matches", async () => {
    const result = await ripgrepSearch("NEEDLE_TOKEN", fixtureRoot, {
      projectId,
      // This valid ripgrep mode emits matching file paths rather than --json events.
      // It simulates an executable/configuration drift without needing a fake binary.
      extraArgs: ["--files-with-matches"],
    });

    expect(result.chunks).toEqual([]);
    expect(result.diagnostics.exitCode).toBe(0);
    expect(result.diagnostics.malformedEvents).toBeGreaterThan(0);
    expect(result.error).toContain("unparseable output");
  });
});

describe("ripgrep executable resolution", () => {
  it("uses the Windows PATH/PATHEXT resolved absolute executable before a bare fallback", () => {
    const expected = "C:\\tools\\rg.exe";
    const result = resolveRipgrepExecutable({
      platform: "win32",
      env: { PATH: "C:\\tools" },
      resolvePath: (name) => (name === "rg.exe" ? expected : undefined),
      pathExists: () => false,
    });

    expect(result).toEqual({ executable: expected, executableResolution: "path" });
  });

  it("uses the managed Codex rg.exe absolute path when pnpm has narrowed Windows PATH", () => {
    const localAppData = "C:\\agent-local";
    const expected = path.win32.join(localAppData, "OpenAI", "Codex", "bin", "rg.exe");
    const result = resolveRipgrepExecutable({
      platform: "win32",
      env: { LOCALAPPDATA: localAppData, PATH: "C:\\without-rg" },
      resolvePath: () => undefined,
      pathExists: (candidate) => candidate === expected,
    });

    expect(result).toEqual({ executable: expected, executableResolution: "codex-path" });
  });

  it("keeps a missing Windows rg observable as a bare command, not an empty result", () => {
    const result = resolveRipgrepExecutable({
      platform: "win32",
      env: { PATH: "C:\\without-rg" },
      resolvePath: () => undefined,
      pathExists: () => false,
    });

    expect(result).toEqual({ executable: "rg", executableResolution: "bare" });
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
