import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { resolveMemoryBackendConfig } from "openclaw/plugin-sdk/memory-core-host-engine-storage";
import { QmdMemoryManager } from "./qmd-manager.js";

it("retains raw QMD bytes and rejects a parent junction escape", async () => {
  const root = await mkdtemp(join(tmpdir(), "rag13-qmd-raw-"));
  const workspace = join(root, "workspace"),
    external = join(root, "external");
  await mkdir(join(workspace, "memory"), { recursive: true });
  await mkdir(external);
  const raw = "QMD13 中文😀\r\nsecond line\r\n";
  await writeFile(join(workspace, "memory/source.md"), raw);
  await writeFile(join(external, "private.md"), "OUTSIDE_QMD13_BODY");
  await symlink(external, join(workspace, "memory/escape"), "junction");
  const cfg = {
    agents: { defaults: { workspace } },
    memory: {
      backend: "qmd" as const,
      qmd: { command: "qmd-not-started", includeDefaultMemory: true },
    },
  };
  const manager = await QmdMemoryManager.create({
    cfg,
    agentId: "main",
    resolved: resolveMemoryBackendConfig({ cfg, agentId: "main" }),
    mode: "status",
  });
  try {
    if (!manager) throw Error("QMD status owner unavailable");
    expect(await manager.readFile({ relPath: "memory/source.md", raw: true })).toMatchObject({
      text: raw,
      path: "memory/source.md",
    });
    await expect(
      manager.readFile({ relPath: "memory/escape/private.md", raw: true }),
    ).rejects.toThrow();
  } finally {
    await manager?.close();
    await rm(root, { recursive: true, force: true });
  }
});
