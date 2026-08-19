/**
 * P1 atomic-write behavior tests.
 *
 * The Windows-specific case is intentionally in the normal suite: this repo's
 * primary target is Windows and rename-overwrite must be proven, not skipped.
 */
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeAtomicText, writeFileAtomic, writeTextFileAtomic } from "./atomic-write.js";
import { codingObservability } from "../../context-engine/coding-observability.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "uftk-atomic-write-"));
  codingObservability.reset();
});

afterEach(async () => {
  codingObservability.reset();
  await rm(dir, { recursive: true, force: true });
});

async function assertNoTempFiles(): Promise<void> {
  const names = await readdir(dir);
  expect(names.filter((name) => name.includes(".uftk-"))).toEqual([]);
}

describe("writeFileAtomic", () => {
  it("writes content through a same-directory temp file and removes the temp", async () => {
    const target = path.join(dir, "file.txt");
    await writeFileAtomic(target, "hello");
    expect(await readFile(target, "utf8")).toBe("hello");
    await assertNoTempFiles();
    expect(codingObservability.snapshot().atomicWriteSuccess).toBe(1);
    expect(codingObservability.snapshot().atomicWriteFailure).toBe(0);
  });

  it("atomically replaces an existing target on this platform (Windows rename-overwrite)", async () => {
    const target = path.join(dir, "existing.txt");
    await writeFile(target, "old-content", "utf8");
    await writeFileAtomic(target, "new-content");
    expect(await readFile(target, "utf8")).toBe("new-content");
    await assertNoTempFiles();
  });

  it("fails closed without touching the target or leaving a temp file", async () => {
    // Renaming a file over an existing directory is not an atomic file
    // replacement on any supported OS; the implementation must fail closed.
    const target = path.join(dir, "target-directory");
    await import("node:fs/promises").then((fs) => fs.mkdir(target));
    const before = (await import("node:fs/promises").then((fs) => fs.readdir(dir))).sort();
    await expect(writeFileAtomic(target, "half-written")).rejects.toThrow();
    const after = (await import("node:fs/promises").then((fs) => fs.readdir(dir))).sort();
    expect(after).toEqual(before);
    await assertNoTempFiles();
    expect(codingObservability.snapshot().atomicWriteFailure).toBe(1);
  });
});

describe("atomic text codec reuse", () => {
  it("encodes UTF-8 BOM without double-encoding the BOM", async () => {
    const target = path.join(dir, "bom.txt");
    await writeTextFileAtomic(target, "alpha\n", { encoding: "utf8-bom" });
    const bytes = await readFile(target);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.subarray(3).toString("utf8")).toBe("alpha\n");
  });

  it("restores CRLF endings from edit-diff capture", async () => {
    const encoded = encodeAtomicText("a\nb\n", { lineEndings: ["\r\n", "\r\n"] });
    expect(encoded.toString("utf8")).toBe("a\r\nb\r\n");
  });

  it("keeps write-tool UTF-8 bytes verbatim when no endings are supplied", async () => {
    const target = path.join(dir, "crlf.txt");
    await writeTextFileAtomic(target, "a\r\nb", { encoding: "utf8" });
    expect((await readFile(target)).toString("utf8")).toBe("a\r\nb");
  });
});
