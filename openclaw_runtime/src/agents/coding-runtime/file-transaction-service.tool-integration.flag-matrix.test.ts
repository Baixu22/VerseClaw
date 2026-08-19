import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplyPatchTool } from "../apply-patch.js";
import { createEditToolDefinition, type EditToolInput } from "../sessions/tools/edit.js";
import { createWriteToolDefinition } from "../sessions/tools/write.js";
import { __resetBatchLocks } from "../apply-patch-batch-lock.js";
import { __resetWriteJournals, getOrCreateWriteJournal, hashFileContent } from "../tools/write-journal.js";
import { codingObservability } from "../../context-engine/coding-observability.js";
import { isCodingBaseVersionGuardEnabled, isCodingUftkEnabled } from "../../context-engine/coding-runtime-flags.js";
import { FileTransactionService } from "./file-transaction-service.js";
import type { AnyAgentTool } from "../agent-tools.types.js";
import type { ExtensionContext } from "../sessions/extensions/types.js";

let root: string;
let service: FileTransactionService;
const sessionId = "flag-matrix";

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "uftk-tool-matrix-"));
  __resetWriteJournals();
  __resetBatchLocks();
  codingObservability.reset();
  service = new FileTransactionService({ workspaceRoot: root, sessionId });
});

afterEach(async () => {
  __resetWriteJournals();
  __resetBatchLocks();
  codingObservability.reset();
  await rm(root, { recursive: true, force: true });
});

describe("runtime.coding.uftk.enabled resolver", () => {
  it("is false by default and honors the explicit override only", () => {
    expect(isCodingUftkEnabled()).toBe(false);
    expect(isCodingUftkEnabled(undefined, { uftkEnabled: true })).toBe(true);
    expect(
      isCodingUftkEnabled({ runtime: { coding: { uftk: { enabled: true } } } } as never),
    ).toBe(true);
    expect(
      isCodingUftkEnabled({ runtime: { coding: { uftk: { enabled: false } } } } as never),
    ).toBe(false);
  });

  it("baseVersionGuard stays false by default and only honors explicit wiring", () => {
    expect(isCodingBaseVersionGuardEnabled()).toBe(false);
    expect(isCodingBaseVersionGuardEnabled(undefined, { baseVersionGuardEnabled: true })).toBe(true);
    expect(
      isCodingBaseVersionGuardEnabled({
        runtime: { coding: { uftk: { baseVersionGuard: { enabled: true } } } },
      } as never),
    ).toBe(true);
  });
});

describe("write tool off/on flag matrix", () => {
  it("flag off: existing write path, no UFTK prepare/commit counters", async () => {
    const tool = createWriteToolDefinition(root);
    const result = await tool.execute(
      "off-call",
      { path: "off.txt", content: "off" },
      undefined,
      undefined,
      {} as ExtensionContext,
    );
    expect(result.details).toMatchObject({ working_memory: { significance: "high" } });
    expect(await readFile(path.join(root, "off.txt"), "utf8")).toBe("off");
    expect(codingObservability.snapshot().uftkPrepareCount).toBe(0);
    expect(codingObservability.snapshot().uftkCommitCount).toBe(0);
  });

  it("flag on: write goes through prepare -> commit and preserves working_memory", async () => {
    const tool = createWriteToolDefinition(root, {
      codingRuntime: { service, sessionId },
    });
    const result = await tool.execute(
      "on-call",
      { path: "on.txt", content: "on" },
      undefined,
      undefined,
      {} as ExtensionContext,
    );
    expect(result.details).toMatchObject({
      working_memory: { significance: "high", result_summary: expect.stringContaining("on.txt") },
    });
    expect(await readFile(path.join(root, "on.txt"), "utf8")).toBe("on");
    expect(codingObservability.snapshot().uftkPrepareCount).toBe(1);
    expect(codingObservability.snapshot().uftkCommitCount).toBe(1);
    expect(getOrCreateWriteJournal(root, sessionId).entries[0]?.kind).toBe("write");
  });

  it("flag on: injected WriteOperations cannot bypass UFTK", async () => {
    const tool = createWriteToolDefinition(root, {
      operations: {
        writeFile: async () => {
          throw new Error("injected writeFile must not be called under UFTK");
        },
        mkdir: async () => {
          throw new Error("injected mkdir must not be called under UFTK");
        },
      },
      codingRuntime: { service, sessionId },
    });
    const result = await tool.execute(
      "injected-call",
      { path: "injected.txt", content: "x" },
      undefined,
      undefined,
      {} as ExtensionContext,
    );
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("injected.txt") });
    expect(await readFile(path.join(root, "injected.txt"), "utf8")).toBe("x");
    expect(codingObservability.snapshot().uftkCommitCount).toBe(1);
  });
});

describe("edit tool flag on preserves encoding/working_memory", () => {
  it("preserves CRLF and BOM while routing the final write through UFTK", async () => {
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("alpha\r\nbeta\r\n")]);
    await writeFile(path.join(root, "bom.txt"), bom);
    const tool = createEditToolDefinition(root, {
      codingRuntime: { service, sessionId },
    });
    const result = await tool.execute(
      "edit-call",
      { path: "bom.txt", edits: [{ oldText: "alpha", newText: "ALPHA" }] } as EditToolInput,
      undefined,
      undefined,
      {} as ExtensionContext,
    );
    expect(result.details).toMatchObject({ working_memory: { significance: "high" } });
    const bytes = await readFile(path.join(root, "bom.txt"));
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.subarray(3).toString("utf8")).toBe("ALPHA\r\nbeta\r\n");
    expect(getOrCreateWriteJournal(root, sessionId).entries[0]?.kind).toBe("edit");
  });
});

describe("apply_patch tool flag on", () => {
  it("journals add/delete/move hunks and keeps the DCS envelope", async () => {
    await writeFile(path.join(root, "target.txt"), "old\n", "utf8");
    await writeFile(path.join(root, "src.txt"), "moved\n", "utf8");
    const tool = createApplyPatchTool({
      cwd: root,
      codingRuntime: { service, sessionId },
    }) as unknown as AnyAgentTool;
    const input = [
      "*** Begin Patch",
      "*** Add File: added.txt",
      "+added",
      "*** Update File: target.txt",
      "@@",
      "-old",
      "+new",
      "*** Update File: src.txt",
      "*** Move to: moved.txt",
      "@@",
      "-moved",
      "+moved",
      "*** Delete File: deleted.txt",
      "*** End Patch",
    ].join("\n");
    await writeFile(path.join(root, "deleted.txt"), "x", "utf8");

    const result = await tool.execute("patch-call", { input }, undefined);
    expect(result.details).toMatchObject({
      working_memory: { significance: "high" },
      batchState: "committed",
    });
    expect(await readFile(path.join(root, "added.txt"), "utf8")).toBe("added\n");
    expect(await readFile(path.join(root, "target.txt"), "utf8")).toBe("new\n");
    expect(await readFile(path.join(root, "moved.txt"), "utf8")).toBe("moved\n");
    expect(existsSync(path.join(root, "src.txt"))).toBe(false);
    expect(existsSync(path.join(root, "deleted.txt"))).toBe(false);

    const journal = getOrCreateWriteJournal(root, sessionId);
    expect(journal.entries.filter((entry) => entry.kind === "apply_patch").length).toBeGreaterThanOrEqual(4);
  });
});

async function versionForRoot(relPath: string): Promise<{ path: string; contentHash: string; mtimeMs: number; size: number }> {
  const absPath = path.join(root, relPath);
  const bytes = await readFile(absPath);
  const fileStat = await stat(absPath);
  return {
    path: relPath,
    contentHash: hashFileContent(bytes),
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
  };
}

describe("tool-internal baseVersion plumbing (model schema unchanged)", () => {
  it("write tool returns E_CONFLICT when the internal baseVersion is stale", async () => {
    await writeFile(path.join(root, "conflict.txt"), "base", "utf8");
    const baseVersion = await versionForRoot("conflict.txt");
    await writeFile(path.join(root, "conflict.txt"), "external", "utf8");

    const tool = createWriteToolDefinition(root, {
      codingRuntime: { service, sessionId },
      baseVersion,
    });
    const error = await tool
      .execute(
        "write-conflict",
        { path: "conflict.txt", content: "mine" },
        undefined,
        undefined,
        {} as ExtensionContext,
      )
      .then(
        () => null,
        (caught: unknown) => caught,
      );
    expect(error).toMatchObject({ code: "E_CONFLICT", path: "conflict.txt" });
    expect(await readFile(path.join(root, "conflict.txt"), "utf8")).toBe("external");
  });

  it("apply_patch tool returns E_CONFLICT from internal baseVersions[] before mutation", async () => {
    await writeFile(path.join(root, "patch.txt"), "old\n", "utf8");
    const baseVersion = await versionForRoot("patch.txt");
    await writeFile(path.join(root, "patch.txt"), "external\n", "utf8");
    const tool = createApplyPatchTool({
      cwd: root,
      codingRuntime: { service, sessionId },
      baseVersions: [baseVersion],
    }) as unknown as AnyAgentTool;
    const input = [
      "*** Begin Patch",
      "*** Update File: patch.txt",
      "@@",
      "-old",
      "+new",
      "*** End Patch",
    ].join("\n");
    const error = await tool.execute("patch-conflict", { input }, undefined).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ code: "E_CONFLICT", path: "patch.txt" });
    expect(await readFile(path.join(root, "patch.txt"), "utf8")).toBe("external\n");
    expect(getOrCreateWriteJournal(root, sessionId).entries).toHaveLength(0);
  });
});
