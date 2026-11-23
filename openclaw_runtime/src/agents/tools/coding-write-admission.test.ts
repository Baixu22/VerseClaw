import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHostWorkspaceWriteTool, createSandboxedWriteTool } from "../agent-tools.read.js";
import { acquirePatchBatchLocks } from "../apply-patch-batch-lock.js";
import {
  __resetSessionReadHashes,
  hashFileContent,
  recordSessionReadHash,
} from "../session-read-hashes.js";
import { withFileMutationQueue } from "../sessions/tools/file-mutation-queue.js";
import { createHostSandboxFsBridge } from "../test-helpers/host-sandbox-fs-bridge.js";
import { createRemoteShellSandboxFsBridge } from "../sandbox/remote-fs-bridge.js";
import {
  __resetWriteJournals,
  getOrCreateWriteJournal,
  undoLastWrites,
  wrapToolWithWriteJournal,
} from "./write-journal.js";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  __resetSessionReadHashes();
  __resetWriteJournals();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(journalEnabled: boolean, guardEnabled = true) {
  const root = await mkdtemp(path.join(tmpdir(), "coding-write-admission-"));
  roots.push(root);
  const file = path.join(root, "code.ts");
  const original = "export const value = 0;\n";
  await writeFile(file, original);
  const sessionId = "coding-lease-reader";
  recordSessionReadHash(sessionId, "code.ts", hashFileContent(original));
  const native = createHostWorkspaceWriteTool(root, {
    workspaceOnly: true,
    staleWriteGuard: { workspaceRoot: root, sessionId, enabled: guardEnabled },
  });
  const tool = wrapToolWithWriteJournal(native, {
    workspaceRoot: root,
    workspaceOnly: true,
    sessionId,
    enabled: journalEnabled,
  });
  return { root, file, sessionId, tool };
}

describe("coding write admission after owner waits", () => {
  it("keeps a fresh full rewrite valid beyond the generic root reader limit", async () => {
    const { file, sessionId, tool } = await fixture(false);
    const original = "x".repeat(17 * 1024 * 1024);
    await writeFile(file, original);
    recordSessionReadHash(sessionId, "code.ts", hashFileContent(original));
    await tool.execute("large-fresh-write", { path: "code.ts", content: "small replacement" });
    expect(await readFile(file, "utf8")).toBe("small replacement");
  });

  it.each([true, false])(
    "confirms sandbox absence after a numeric bridge failure with missing=%s",
    async (missing) => {
      const { root, file, sessionId } = await fixture(true);
      if (missing) await rm(file);
      const bridge = createHostSandboxFsBridge(root);
      // SSH failures carry the process exit code, rather than Node's ENOENT.
      const failure = Object.assign(new Error("remote read failed"), { code: 1 });
      bridge.readFile = async () => {
        throw failure;
      };
      const native = createSandboxedWriteTool({
        root,
        bridge,
        staleWriteGuard: { workspaceRoot: root, sessionId, enabled: true },
      });
      const tool = wrapToolWithWriteJournal(native, {
        workspaceRoot: root,
        sessionId,
        workspaceOnly: true,
        enabled: true,
      });
      const pending = tool.execute("sandbox-write", { path: "code.ts", content: "recreated" });
      if (missing) {
        await pending;
        expect(await readFile(file, "utf8")).toBe("recreated");
        expect(getOrCreateWriteJournal(root, sessionId).entries).toHaveLength(1);
      } else {
        await expect(pending).rejects.toBe(failure);
        expect(await readFile(file, "utf8")).toBe("export const value = 0;\n");
        expect(getOrCreateWriteJournal(root, sessionId).entries).toHaveLength(0);
      }
    },
  );

  it.each([true, false])(
    "keeps literal ~ files and recovery targets exact with journal=%s",
    async (journalEnabled) => {
      const { root, file: shadow, sessionId, tool } = await fixture(journalEnabled);
      const literalDir = path.join(root, "~");
      const literal = path.join(literalDir, "code.ts");
      const original = "export const literal = 0;\n";
      await mkdir(literalDir);
      await writeFile(literal, original);
      recordSessionReadHash(sessionId, "~/code.ts", hashFileContent(original));
      vi.stubEnv("HOME", root);
      await tool.execute("literal-write", {
        path: literal,
        content: "export const literal = 1;\n",
      });
      expect(await readFile(literal, "utf8")).toBe("export const literal = 1;\n");
      expect(await readFile(shadow, "utf8")).toBe("export const value = 0;\n");
      if (journalEnabled) {
        const restored = await undoLastWrites({
          workspaceRoot: root,
          sessionId,
          workspaceOnly: true,
        });
        expect(restored.errors).toEqual([]);
        expect(await readFile(literal, "utf8")).toBe(original);
        expect(await readFile(shadow, "utf8")).toBe("export const value = 0;\n");
        const created = path.join(literalDir, "new.ts");
        const createdShadow = path.join(root, "new.ts");
        await writeFile(createdShadow, "retained create shadow");
        await tool.execute("literal-create", { path: created, content: "new literal file" });
        expect(
          (await undoLastWrites({ workspaceRoot: root, sessionId, workspaceOnly: true })).errors,
        ).toEqual([]);
        await expect(readFile(created, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
        expect(await readFile(createdShadow, "utf8")).toBe("retained create shadow");
      }
    },
  );

  it("rejects unknown remote existence output and retains explicit absence", async () => {
    const { root, file } = await fixture(false);
    let reply = "login banner\n1\n";
    const bridge = createRemoteShellSandboxFsBridge({
      sandbox: {
        workspaceDir: root,
        agentWorkspaceDir: root,
        workspaceAccess: "rw",
        containerName: "coding-fixture",
        containerWorkdir: "/workspace",
        docker: {},
      },
      runtime: {
        remoteWorkspaceDir: "/workspace",
        remoteAgentWorkspaceDir: "/workspace",
        runRemoteShellScript: async () => ({
          stdout: Buffer.from(reply),
          stderr: Buffer.alloc(0),
          code: 0,
        }),
      },
    });
    await expect(bridge.stat({ filePath: file })).rejects.toThrow("invalid output");
    reply = "0\n";
    expect(await bridge.stat({ filePath: file })).toBeNull();
    expect(await readFile(file, "utf8")).toBe("export const value = 0;\n");
  });

  it("preserves an explicit override and its ordinary journal entry", async () => {
    const { root, file, sessionId, tool } = await fixture(true);
    await writeFile(file, "export const value = 1;\n");
    await tool.execute("override-write", {
      path: "code.ts",
      content: "export const value = 2;\n",
      force: true,
    });
    expect(await readFile(file, "utf8")).toBe("export const value = 2;\n");
    expect(getOrCreateWriteJournal(root, sessionId).entries).toHaveLength(1);
  });

  it("allows the existing flag-off and unread-file paths", async () => {
    const disabled = await fixture(false, false);
    await writeFile(disabled.file, "changed after read");
    await disabled.tool.execute("flag-off", { path: "code.ts", content: "allowed" });
    expect(await readFile(disabled.file, "utf8")).toBe("allowed");
    const unread = await fixture(false);
    __resetSessionReadHashes();
    await writeFile(unread.file, "unread external content");
    await unread.tool.execute("unread-write", { path: "code.ts", content: "allowed unread" });
    expect(await readFile(unread.file, "utf8")).toBe("allowed unread");
  });
  it("rechecks the read hash after the journal lease and leaves no unapplied undo step", async () => {
    const { root, file, sessionId, tool } = await fixture(true);
    const release = await acquirePatchBatchLocks([file]);
    const pending = tool
      .execute("waiting-write", { path: "code.ts", content: "export const value = 2;\n" })
      .then(
        () => "written",
        (error) => error.code,
      );
    try {
      await writeFile(file, "export const value = 1;\n");
      release();
      expect(await pending).toBe("STALE_WRITE");
      expect(await readFile(file, "utf8")).toBe("export const value = 1;\n");
      expect(getOrCreateWriteJournal(root, sessionId).entries).toHaveLength(0);
    } finally {
      release();
      await pending;
    }
  });

  it.each([true, false])(
    "rechecks after the native mutation queue with journal=%s",
    async (journalEnabled) => {
      const { file, tool } = await fixture(journalEnabled);
      let admitted!: () => void;
      let finish!: () => void;
      const admission = new Promise<void>((resolve) => {
        admitted = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const holder = withFileMutationQueue(file, async () => {
        admitted();
        await gate;
        await writeFile(file, "export const value = 1;\n");
      });
      await admission;
      const pending = tool
        .execute("queued-write", { path: "code.ts", content: "export const value = 2;\n" })
        .then(
          () => "written",
          (error) => error.code,
        );
      try {
        finish();
        await holder;
        expect(await pending).toBe("STALE_WRITE");
        expect(await readFile(file, "utf8")).toBe("export const value = 1;\n");
      } finally {
        finish();
        await holder;
        await pending;
      }
    },
  );
});
