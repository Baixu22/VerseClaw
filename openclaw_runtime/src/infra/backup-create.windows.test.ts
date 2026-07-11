import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

const tempRoots: string[] = [];

afterEach(async () => {
  delete process.env.OPENCLAW_CONFIG_PATH;
  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_STATE_DIR;
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("backup creation on Windows", () => {
  it("closes a partial archive before propagating a stream error", async () => {
    const { testApi } = await import("./backup-create.js");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-backup-stream-"));
    tempRoots.push(root);
    const archivePath = path.join(root, "partial.tar.gz");
    const archiveStream = new PassThrough();
    const writePromise = testApi.writeArchiveStreamToFile({
      archivePath,
      archiveStream,
    });
    archiveStream.write("partial archive");
    archiveStream.destroy(new Error("injected tar read failure"));

    await expect(writePromise).rejects.toThrow("injected tar read failure");
    await expect(fs.rm(archivePath)).resolves.toBeUndefined();
  });

  it("treats a trailing platform separator as an output directory", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-backup-windows-"));
    tempRoots.push(root);
    const stateDir = path.join(root, "state");
    const outputDir = path.join(root, "backups");
    await fs.mkdir(stateDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(stateDir, "durable.txt"), "durable");
    process.env.OPENCLAW_HOME = root;
    process.env.OPENCLAW_STATE_DIR = stateDir;
    process.env.OPENCLAW_CONFIG_PATH = path.join(stateDir, "openclaw.json");
    const { createBackupArchive } = await import("./backup-create.js");

    const result = await createBackupArchive({
      output: `${outputDir}${path.sep}`,
      includeWorkspace: false,
    });

    expect(path.dirname(result.archivePath)).toBe(outputDir);
    expect(path.basename(result.archivePath)).toMatch(/\.tar\.gz$/u);
  });
});
