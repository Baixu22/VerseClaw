import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { AnyAgentTool } from "../agent-tools.types.js";
import { acquirePatchBatchLocks } from "../apply-patch-batch-lock.js";
import { toFactRelPath, toResolvedFactRelPath } from "../fact-rel-path.js";
import { wrapToolWithParseOnTouch } from "../parse-on-touch.js";
import {
  __resetSessionReadHashes,
  hashFileContent,
  recordSessionReadHash,
  resolveWorkspaceFile,
} from "../session-read-hashes.js";
import { createEditTool } from "../sessions/tools/edit.js";
import { createReadTool } from "../sessions/tools/read.js";
import { createWriteTool } from "../sessions/tools/write.js";
import { createStaleWriteGuard } from "../stale-write-guard.js";
import {
  __resetWriteJournals,
  getOrCreateWriteJournal,
  snapshotBeforeWrite,
  undoLastWrites,
  wrapToolWithWriteJournal,
} from "./write-journal.js";

const roots: string[] = [];
const sessionId = "coding-path-identity";
const original = "ORIGINAL\n";

afterEach(async () => {
  __resetSessionReadHashes();
  __resetWriteJournals();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function directory(parent: string, prefix: string) {
  const root = await mkdtemp(path.join(parent, prefix));
  roots.push(root);
  return root;
}

async function fixture() {
  const root = await directory(tmpdir(), "coding-path-workspace-");
  const homeRoot = await directory(homedir(), ".clawx-coding-path-");
  const file = path.join(homeRoot, "code.ts");
  const input = `~/${path.basename(homeRoot)}/code.ts`;
  await writeFile(file, original);
  return { root, homeRoot, file, input };
}

function journaledWrite(root: string, workspaceOnly = false) {
  return wrapToolWithWriteJournal(createWriteTool(root) as unknown as AnyAgentTool, {
    workspaceRoot: root,
    workspaceOnly,
    sessionId,
    enabled: true,
  });
}

describe("coding input path identity", () => {
  it.each(["tilde", "file-url"])("tracks actual reads for fresh and stale %s writes", async (kind) => {
    const { homeRoot, file, input } = await fixture();
    const toolPath = kind === "tilde" ? input : pathToFileURL(file).href;
    const reader = wrapToolWithParseOnTouch(createReadTool(homeRoot) as unknown as AnyAgentTool, {
      workspaceRoot: homeRoot,
      sessionId,
      enabled: false,
    });
    const writer = wrapToolWithWriteJournal(
      createWriteTool(homeRoot, {
        beforeWrite: createStaleWriteGuard(
          { workspaceRoot: homeRoot, sessionId, enabled: true },
          (target) => readFile(target),
        ),
      }) as unknown as AnyAgentTool,
      { workspaceRoot: homeRoot, sessionId, workspaceOnly: true },
    );
    await reader.execute("read-original", { path: toolPath });
    await writer.execute("fresh-write", { path: toolPath, content: "FRESH\n" });
    expect(await readFile(file, "utf8")).toBe("FRESH\n");
    await reader.execute("read-fresh", { path: toolPath });
    await writeFile(file, "EXTERNAL\n");
    await expect(writer.execute("stale-write", { path: toolPath, content: "STALE\n" }))
      .rejects.toMatchObject({ code: "STALE_WRITE", relPath: "code.ts" });
    expect(await readFile(file, "utf8")).toBe("EXTERNAL\n");
    expect(getOrCreateWriteJournal(homeRoot, sessionId).entries).toHaveLength(1);
  });

  it.each([false, true])("restores the real tilde target with shadow=%s", async (hasShadow) => {
    const { root, file, input, homeRoot } = await fixture();
    const shadow = path.join(root, "~", path.basename(homeRoot), "code.ts");
    if (hasShadow) {
      await mkdir(path.dirname(shadow), { recursive: true });
      await writeFile(shadow, "SHADOW\n");
    }
    await journaledWrite(root).execute("tilde-write", { path: input, content: "CHANGED\n" });
    expect(await readFile(file, "utf8")).toBe("CHANGED\n");
    const journal = getOrCreateWriteJournal(root, sessionId);
    expect(journal.entries).toHaveLength(1);
    const entry = journal.entries[0]!;
    expect(entry.absPath).toBe(file);
    expect(entry.hadPrior).toBe(true);
    expect(readFileSync(entry.snapshotPath, "utf8")).toBe(original);

    const restored = await undoLastWrites({ workspaceRoot: root, sessionId, steps: 1 });
    expect(restored.errors).toEqual([]);
    expect(restored.restored).toHaveLength(1);
    expect(await readFile(file, "utf8")).toBe(original);
    expect(journal.entries).toHaveLength(0);
    expect(existsSync(entry.snapshotPath)).toBe(false);
    if (hasShadow) expect(await readFile(shadow, "utf8")).toBe("SHADOW\n");
    else expect(existsSync(shadow)).toBe(false);
  });

  it.each(["at-tilde", "file-url"])(
    "journals the native write target for %s input",
    async (kind) => {
      const { root, file, input } = await fixture();
      const toolPath = kind === "at-tilde" ? `@${input}` : pathToFileURL(file).href;
      await journaledWrite(root).execute("normalized-write", {
        path: toolPath,
        content: "CHANGED\n",
      });
      expect(getOrCreateWriteJournal(root, sessionId).entries[0]?.absPath).toBe(file);
      expect((await undoLastWrites({ workspaceRoot: root, sessionId })).errors).toEqual([]);
      expect(await readFile(file, "utf8")).toBe(original);
    },
  );

  it.each([false, true])(
    "keeps decoded file URL and raw absolute targets distinct with workspaceOnly=%s",
    async (workspaceOnly) => {
      const { root, homeRoot } = await fixture();
      const file = path.join(homeRoot, "code\u00a0target.ts");
      const shadow = path.join(homeRoot, "code target.ts");
      const input = pathToFileURL(file).href;
      await writeFile(file, original);
      await writeFile(shadow, "SHADOW\n");
      const workspaceRoot = workspaceOnly ? homeRoot : root;
      const tool = journaledWrite(workspaceRoot, workspaceOnly);
      await tool.execute("decoded-file-url", { path: input, content: "CHANGED\n" });
      const journal = getOrCreateWriteJournal(workspaceRoot, sessionId);
      expect(journal.entries[0]?.absPath).toBe(file);
      expect(readFileSync(journal.entries[0]!.snapshotPath, "utf8")).toBe(original);
      expect(await readFile(file, "utf8")).toBe("CHANGED\n");
      expect(await readFile(shadow, "utf8")).toBe("SHADOW\n");
      expect((await undoLastWrites({ workspaceRoot, sessionId })).errors).toEqual([]);
      expect(await readFile(file, "utf8")).toBe(original);
      expect(await readFile(shadow, "utf8")).toBe("SHADOW\n");
      await tool.execute("raw-absolute", { path: file, content: "NATIVE SPACE\n" });
      expect(journal.entries[0]?.absPath).toBe(shadow);
      expect(await readFile(file, "utf8")).toBe(original);
      expect(await readFile(shadow, "utf8")).toBe("NATIVE SPACE\n");
      expect((await undoLastWrites({ workspaceRoot, sessionId })).errors).toEqual([]);
      expect(await readFile(shadow, "utf8")).toBe("SHADOW\n");
    },
  );

  it.each([false, true])(
    "blocks stale content at the exact decoded file URL target with journal=%s",
    async (enabled) => {
      const { homeRoot } = await fixture();
      const name = "code\u00a0target.ts";
      const file = path.join(homeRoot, name);
      const shadow = path.join(homeRoot, "code target.ts");
      const input = pathToFileURL(file).href;
      expect(toFactRelPath(input, homeRoot)).toBe(name);
      expect(toResolvedFactRelPath(file, homeRoot)).toBe(name);
      recordSessionReadHash(sessionId, name, hashFileContent(original));
      await writeFile(file, "EXTERNAL\n");
      await writeFile(shadow, "SHADOW\n");
      const native = createWriteTool(homeRoot, {
        beforeWrite: createStaleWriteGuard(
          { workspaceRoot: homeRoot, sessionId, enabled: true },
          (target) => readFile(target),
        ),
      });
      const tool = wrapToolWithWriteJournal(native as unknown as AnyAgentTool, {
        workspaceRoot: homeRoot,
        workspaceOnly: true,
        sessionId,
        enabled,
      });
      await expect(
        tool.execute("stale-file-url", { path: input, content: "CHANGED\n" }),
      ).rejects.toMatchObject({ code: "STALE_WRITE", relPath: name });
      expect(await readFile(file, "utf8")).toBe("EXTERNAL\n");
      expect(await readFile(shadow, "utf8")).toBe("SHADOW\n");
      expect(getOrCreateWriteJournal(homeRoot, sessionId).entries).toHaveLength(0);
    },
  );

  it("uses the same tilde target for a direct journal snapshot", async () => {
    const { root, file, input } = await fixture();
    const entry = snapshotBeforeWrite({
      workspaceRoot: root,
      sessionId,
      filePath: input,
      toolName: "write",
    });
    expect(entry?.absPath).toBe(file);
    expect(entry?.hadPrior).toBe(true);
    expect(readFileSync(entry!.snapshotPath, "utf8")).toBe(original);
  });

  it("undoes creation at the expanded target", async () => {
    const { root, file, input } = await fixture();
    await rm(file);
    await journaledWrite(root).execute("tilde-create", { path: input, content: "CREATED\n" });
    expect(await readFile(file, "utf8")).toBe("CREATED\n");
    expect(getOrCreateWriteJournal(root, sessionId).entries[0]?.hadPrior).toBe(false);
    expect((await undoLastWrites({ workspaceRoot: root, sessionId })).errors).toEqual([]);
    expect(existsSync(file)).toBe(false);
  });

  it("journals the actual edit target before changing its contents", async () => {
    const { root, file, input } = await fixture();
    const tool = wrapToolWithWriteJournal(createEditTool(root) as unknown as AnyAgentTool, {
      workspaceRoot: root,
      sessionId,
      enabled: true,
    });
    await tool.execute("tilde-edit", {
      path: input,
      edits: [{ oldText: "ORIGINAL", newText: "CHANGED" }],
    });
    expect(await readFile(file, "utf8")).toBe("CHANGED\n");
    expect(getOrCreateWriteJournal(root, sessionId).entries[0]?.absPath).toBe(file);
    expect((await undoLastWrites({ workspaceRoot: root, sessionId })).errors).toEqual([]);
    expect(await readFile(file, "utf8")).toBe(original);
  });

  it("serializes tilde and absolute writes under the same journal lease", async () => {
    const { root, file, input } = await fixture();
    const release = await acquirePatchBatchLocks([file]);
    const tool = journaledWrite(root);
    const pending = [
      tool.execute("tilde-queued", { path: input, content: "FIRST\n" }),
      tool.execute("absolute-queued", { path: file, content: "SECOND\n" }),
    ];
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(getOrCreateWriteJournal(root, sessionId).entries).toHaveLength(0);
      expect(await readFile(file, "utf8")).toBe(original);
    } finally {
      release();
      await Promise.all(pending);
    }
    expect(await readFile(file, "utf8")).toBe("SECOND\n");
    expect((await undoLastWrites({ workspaceRoot: root, sessionId })).errors).toEqual([]);
    expect(await readFile(file, "utf8")).toBe("FIRST\n");
    expect((await undoLastWrites({ workspaceRoot: root, sessionId })).errors).toEqual([]);
    expect(await readFile(file, "utf8")).toBe(original);
  });

  it("rejects a home escape before a restricted journal or write reads it", async () => {
    const { root, file, input } = await fixture();
    await expect(
      journaledWrite(root, true).execute("restricted-tilde", { path: input, content: "CHANGED\n" }),
    ).rejects.toThrow(/workspace root/);
    expect(await readFile(file, "utf8")).toBe(original);
    expect(getOrCreateWriteJournal(root, sessionId).entries).toHaveLength(0);
  });

  it.each([true, false])(
    "matches stale admission to the real tilde target with journal=%s",
    async (enabled) => {
      const { homeRoot, file, input } = await fixture();
      expect(resolveWorkspaceFile(homeRoot, input)).toBe(file);
      expect(toFactRelPath(input, homeRoot)).toBe("code.ts");
      recordSessionReadHash(sessionId, "code.ts", hashFileContent(original));
      await writeFile(file, "EXTERNAL\n");
      const native = createWriteTool(homeRoot, {
        beforeWrite: createStaleWriteGuard(
          { workspaceRoot: homeRoot, sessionId, enabled: true },
          (target) => readFile(target),
        ),
      });
      const tool = wrapToolWithWriteJournal(native as unknown as AnyAgentTool, {
        workspaceRoot: homeRoot,
        workspaceOnly: true,
        sessionId,
        enabled,
      });
      await expect(
        tool.execute("stale-tilde", { path: input, content: "CHANGED\n" }),
      ).rejects.toMatchObject({ code: "STALE_WRITE", relPath: "code.ts" });
      expect(await readFile(file, "utf8")).toBe("EXTERNAL\n");
      expect(getOrCreateWriteJournal(homeRoot, sessionId).entries).toHaveLength(0);
    },
  );
});
