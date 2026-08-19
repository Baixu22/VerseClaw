/**
 * P7 independent-acceptance probe: does exec undo report `undone` for a path it
 * did not actually revert?
 *
 * P3's workspace snapshot walk includes gitignored files (it only skips `.git`,
 * `node_modules`, `.venv`, ...), so `sideEffects` can name one. But a restore
 * plan derives extraneous paths from `ls-files --others --exclude-standard`,
 * which *excludes* ignored files -- so an ignored file an exec created is never
 * in `removePaths` and survives the undo. If the result still says `undone`, the
 * caller is told the exec was reverted when part of it was not.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CODING_RUNTIME_EVENT_TYPES,
  CODING_RUNTIME_SCHEMA_VERSION,
  type CodingExecEvent,
  type CodingFileSideEffect,
} from "../../../../shared/coding-runtime/types.js";
import { GitCheckpointService } from "./git-checkpoint.js";
import { ExecSideEffectUndoService } from "./exec-side-effect-undo.js";

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, windowsHide: true });
  return stdout;
}

let root: string;
let repo: string;
let state: string;
let warnings: string[];
let service: GitCheckpointService;

function sideEffect(
  relPath: string,
  status: CodingFileSideEffect["status"],
): CodingFileSideEffect {
  const hash = "a".repeat(64);
  return {
    path: relPath,
    status,
    beforeHash: status === "added" ? null : hash,
    afterHash: status === "deleted" ? null : hash,
    beforeVersion:
      status === "added" ? null : { path: relPath, contentHash: hash, mtimeMs: 1, size: 8 },
    afterVersion:
      status === "deleted" ? null : { path: relPath, contentHash: hash, mtimeMs: 2, size: 9 },
    bytesBefore: status === "added" ? 0 : 8,
    bytesAfter: status === "deleted" ? 0 : 9,
  };
}

function execEvent(sideEffects: CodingFileSideEffect[]): CodingExecEvent {
  return {
    schemaVersion: CODING_RUNTIME_SCHEMA_VERSION,
    eventId: "coding-exec:req-1:11111111-1111-4111-8111-111111111111",
    eventType: CODING_RUNTIME_EVENT_TYPES.EXEC,
    sessionId: "s",
    requestId: "req-1",
    toolName: "exec",
    timestamp: 1,
    path: repo,
    beforeHash: "workspace-snapshot",
    afterHash: "workspace-snapshot",
    workspaceRoot: repo,
    commandId: "c".repeat(24),
    commandHash: "d".repeat(64),
    commandRedacted: "build",
    cwd: repo,
    status: "succeeded",
    exitCode: 0,
    durationMs: 1,
    outputTruncated: false,
    sideEffects,
  } as CodingExecEvent;
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "uftk-undo-ignored-"));
  repo = path.join(root, "repo");
  state = path.join(root, "state");
  warnings = [];
  await fs.mkdir(path.join(repo, "src"), { recursive: true });
  await git(["init", "-q"], repo);
  await git(["config", "user.email", "t@example.invalid"], repo);
  await git(["config", "user.name", "T"], repo);
  await git(["config", "core.autocrlf", "false"], repo);
  await fs.writeFile(path.join(repo, "src", "a.txt"), "a-base\n", "utf8");
  // src/generated.txt is gitignored: present on disk, invisible to
  // `ls-files --others --exclude-standard`.
  await fs.writeFile(path.join(repo, ".gitignore"), "src/generated.txt\n", "utf8");
  await git(["add", "."], repo);
  await git(["commit", "-qm", "initial"], repo);
  service = new GitCheckpointService({
    workspaceRoot: repo,
    enabled: true,
    pathScopedEnabled: true,
    concurrencyV2Enabled: true,
    stateDir: state,
    warn: (message) => warnings.push(message),
  });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("undo must not claim it reverted an ignored file it left behind", () => {
  it("refuses by default, naming the gitignored path, with zero change", async () => {
    const created = await service.createCheckpoint({ paths: ["src"], label: "pre-exec" });
    expect(created.status).toBe("created");

    // The exec modified a tracked file and created a gitignored artifact.
    await fs.writeFile(path.join(repo, "src", "a.txt"), "a-after-exec\n", "utf8");
    await fs.writeFile(path.join(repo, "src", "generated.txt"), "artifact\n", "utf8");

    const result = await new ExecSideEffectUndoService({
      service,
      execUndoEnabled: true,
      safetySnapshotEnabled: true,
    }).undoExecSideEffects(
      execEvent([
        sideEffect("src/a.txt", "modified"),
        sideEffect("src/generated.txt", "added"),
      ]),
      created.checkpoint!.id,
    );

    expect(result.status).toBe("unsupported");
    expect(result.reason).toContain("gitignored");
    expect(result.reason).toContain("src/generated.txt");
    // Zero change on both paths, including the one that was undoable.
    expect(await fs.readFile(path.join(repo, "src", "a.txt"), "utf8")).toBe("a-after-exec\n");
    expect(await fs.readFile(path.join(repo, "src", "generated.txt"), "utf8")).toBe("artifact\n");
  });

  it("under allowPartial reverts the tracked file and reports the ignored one as skipped", async () => {
    const created = await service.createCheckpoint({ paths: ["src"], label: "pre-exec" });
    await fs.writeFile(path.join(repo, "src", "a.txt"), "a-after-exec\n", "utf8");
    await fs.writeFile(path.join(repo, "src", "generated.txt"), "artifact\n", "utf8");

    const result = await new ExecSideEffectUndoService({
      service,
      execUndoEnabled: true,
      safetySnapshotEnabled: true,
    }).undoExecSideEffects(
      execEvent([
        sideEffect("src/a.txt", "modified"),
        sideEffect("src/generated.txt", "added"),
      ]),
      created.checkpoint!.id,
      { allowPartial: true },
    );

    expect(result.status).toBe("undone");
    expect(result.paths).toEqual(["src/a.txt"]);
    // The surviving ignored file is named, not silently omitted.
    expect(result.skipped).toEqual(["src/generated.txt"]);
    expect(await fs.readFile(path.join(repo, "src", "a.txt"), "utf8")).toBe("a-base\n");
    // Deleting a gitignored file was never on the table: local .env and config
    // files must not disappear because an exec was undone.
    expect(await fs.readFile(path.join(repo, "src", "generated.txt"), "utf8")).toBe("artifact\n");
  });

  it("refuses when every side effect is gitignored", async () => {
    const created = await service.createCheckpoint({ paths: ["src"], label: "pre-exec" });
    await fs.writeFile(path.join(repo, "src", "generated.txt"), "artifact\n", "utf8");

    const result = await new ExecSideEffectUndoService({
      service,
      execUndoEnabled: true,
      safetySnapshotEnabled: true,
    }).undoExecSideEffects(
      execEvent([sideEffect("src/generated.txt", "added")]),
      created.checkpoint!.id,
      { allowPartial: true },
    );

    expect(result.status).toBe("unsupported");
    expect(result.skipped).toEqual(["src/generated.txt"]);
    expect(await fs.readFile(path.join(repo, "src", "generated.txt"), "utf8")).toBe("artifact\n");
  });
});
