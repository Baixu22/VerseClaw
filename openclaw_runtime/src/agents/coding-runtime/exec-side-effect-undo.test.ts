/**
 * P7: exec workspace file side-effect undo.
 *
 * The load-bearing test here is carry-over B: an exec's side-effect paths must
 * be covered by the checkpoint being restored. P6B's independent acceptance
 * found that restoring an uncovered scope *deletes* it, so exec undo -- which
 * feeds an arbitrary P3 side-effect path set straight into a scoped restore --
 * is the exact downstream that would trigger it.
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
import {
  ExecSideEffectUndoService,
  resolveExecUndoScope,
} from "./exec-side-effect-undo.js";

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

let root: string;
let repo: string;
let state: string;
let warnings: string[];
let service: GitCheckpointService;

function undoService(
  options: { execUndoEnabled?: boolean; safetySnapshotEnabled?: boolean } = {},
): ExecSideEffectUndoService {
  return new ExecSideEffectUndoService({
    service,
    execUndoEnabled: options.execUndoEnabled ?? true,
    safetySnapshotEnabled: options.safetySnapshotEnabled ?? true,
  });
}

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
      status === "added"
        ? null
        : { path: relPath, contentHash: hash, mtimeMs: 1_700_000_000_000, size: 8 },
    afterVersion:
      status === "deleted"
        ? null
        : { path: relPath, contentHash: hash, mtimeMs: 1_700_000_000_010, size: 9 },
    bytesBefore: status === "added" ? 0 : 8,
    bytesAfter: status === "deleted" ? 0 : 9,
  };
}

/**
 * A P3-shaped exec event. `beforeHash`/`afterHash` mark that a workspace
 * snapshot was taken, which is what makes the side-effect list complete.
 */
function execEvent(
  sideEffects: CodingFileSideEffect[],
  overrides: Partial<CodingExecEvent> = {},
): CodingExecEvent {
  return {
    schemaVersion: CODING_RUNTIME_SCHEMA_VERSION,
    eventId: "coding-exec:req-1:11111111-1111-4111-8111-111111111111",
    eventType: CODING_RUNTIME_EVENT_TYPES.EXEC,
    sessionId: "session-1",
    requestId: "req-1",
    toolName: "exec",
    timestamp: 1_700_000_000_000,
    path: repo,
    beforeHash: "workspace-snapshot",
    afterHash: "workspace-snapshot",
    workspaceRoot: repo,
    commandId: "c".repeat(24),
    commandHash: "d".repeat(64),
    commandRedacted: "bash -lc 'build'",
    cwd: repo,
    status: "succeeded",
    exitCode: 0,
    durationMs: 12,
    outputTruncated: false,
    sideEffects,
    ...overrides,
  } as CodingExecEvent;
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "uftk-exec-undo-"));
  repo = path.join(root, "repo");
  state = path.join(root, "state");
  warnings = [];
  await fs.mkdir(path.join(repo, "src"), { recursive: true });
  await fs.mkdir(path.join(repo, "docs"), { recursive: true });
  await git(["init", "-q"], repo);
  await git(["config", "user.email", "test@example.invalid"], repo);
  await git(["config", "user.name", "UFTK Test"], repo);
  await git(["config", "core.autocrlf", "false"], repo);
  await fs.writeFile(path.join(repo, "src", "a.txt"), "a-base\n", "utf8");
  await fs.writeFile(path.join(repo, "src", "gone.txt"), "gone-base\n", "utf8");
  await fs.writeFile(path.join(repo, "docs", "d.txt"), "d-base\n", "utf8");
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

describe("side-effect scope resolution", () => {
  it("keeps workspace files and refuses everything it cannot prove is one", () => {
    const resolved = resolveExecUndoScope(
      repo,
      execEvent([
        sideEffect("src/a.txt", "modified"),
        sideEffect("src/a.txt", "modified"), // duplicate collapses
        sideEffect("../outside.txt", "modified"),
        sideEffect("/abs/elsewhere.txt", "added"),
        sideEffect(".git/config", "modified"),
        sideEffect(".openclaw/state.json", "added"),
        sideEffect("", "modified"),
      ]),
    );
    expect(resolved.paths).toEqual(["src/a.txt"]);
    expect(resolved.diffComplete).toBe(true);
    expect(resolved.rejected.map((entry) => entry.path)).toEqual([
      "../outside.txt",
      "/abs/elsewhere.txt",
      ".git/config",
      ".openclaw/state.json",
      "",
    ]);
  });

  it("marks the diff incomplete when the exec ran without a workspace snapshot", () => {
    const resolved = resolveExecUndoScope(
      repo,
      execEvent([], { beforeHash: null, afterHash: null }),
    );
    expect(resolved.diffComplete).toBe(false);
    expect(resolved.paths).toEqual([]);
  });
});

describe("carry-over B: scope coverage guard", () => {
  it("refuses an uncovered side-effect set with zero change", async () => {
    // Checkpoint covers src/ only; the exec also touched docs/.
    const created = await service.createCheckpoint({ paths: ["src"], label: "pre-exec" });
    expect(created.status).toBe("created");
    await fs.writeFile(path.join(repo, "src", "a.txt"), "a-after-exec\n", "utf8");
    await fs.writeFile(path.join(repo, "docs", "d.txt"), "d-after-exec\n", "utf8");
    const beforeStatus = await git(["status", "--porcelain=v1"], repo);

    const result = await undoService().undoExecSideEffects(
      execEvent([sideEffect("src/a.txt", "modified"), sideEffect("docs/d.txt", "modified")]),
      created.checkpoint!.id,
    );

    expect(result.status).toBe("unsupported");
    expect(result.error?.code).toBe("E_GIT_CHECKPOINT_UNSUPPORTED");
    expect(result.reason).toContain("not covered");
    expect(result.reason).toContain("docs/d.txt");
    // Zero change: neither the covered nor the uncovered path moved.
    expect(await fs.readFile(path.join(repo, "src", "a.txt"), "utf8")).toBe("a-after-exec\n");
    expect(await fs.readFile(path.join(repo, "docs", "d.txt"), "utf8")).toBe("d-after-exec\n");
    expect(await git(["status", "--porcelain=v1"], repo)).toBe(beforeStatus);
  });

  it("never deletes an uncovered path just because it is absent from the tree", async () => {
    // The data-destroying shape from P6B acceptance: a narrow checkpoint plus a
    // wider requested scope. `docs/` exists on disk but not in this tree.
    const created = await service.createCheckpoint({ paths: ["src"] });
    await fs.writeFile(path.join(repo, "docs", "precious.txt"), "precious\n", "utf8");

    const result = await undoService().undoExecSideEffects(
      execEvent([sideEffect("docs/precious.txt", "added")]),
      created.checkpoint!.id,
    );

    expect(result.status).toBe("unsupported");
    // The file the naive path would have deleted is still here, byte-identical.
    expect(await fs.readFile(path.join(repo, "docs", "precious.txt"), "utf8")).toBe("precious\n");
  });

  it("proceeds over the covered subset only when allowPartial is asked for", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    await fs.writeFile(path.join(repo, "src", "a.txt"), "a-after-exec\n", "utf8");
    await fs.writeFile(path.join(repo, "docs", "d.txt"), "d-after-exec\n", "utf8");

    const result = await undoService().undoExecSideEffects(
      execEvent([sideEffect("src/a.txt", "modified"), sideEffect("docs/d.txt", "modified")]),
      created.checkpoint!.id,
      { allowPartial: true },
    );

    expect(result.status).toBe("undone");
    expect(result.paths).toEqual(["src/a.txt"]);
    expect(result.skipped).toEqual(["docs/d.txt"]);
    // The covered path was reverted; the skipped one was left exactly as-is.
    expect(await fs.readFile(path.join(repo, "src", "a.txt"), "utf8")).toBe("a-base\n");
    expect(await fs.readFile(path.join(repo, "docs", "d.txt"), "utf8")).toBe("d-after-exec\n");
    expect(warnings.some((line) => line.includes("allowPartial narrowed the undo"))).toBe(true);
  });

  it("refuses even under allowPartial when the checkpoint covers nothing", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    await fs.writeFile(path.join(repo, "docs", "d.txt"), "d-after-exec\n", "utf8");

    const result = await undoService().undoExecSideEffects(
      execEvent([sideEffect("docs/d.txt", "modified")]),
      created.checkpoint!.id,
      { allowPartial: true },
    );
    expect(result.status).toBe("unsupported");
    expect(result.reason).toContain("no exec side-effect path is undoable");
    expect(await fs.readFile(path.join(repo, "docs", "d.txt"), "utf8")).toBe("d-after-exec\n");
  });

  it("accepts any scope against a whole-tree checkpoint", async () => {
    const created = await service.createCheckpoint();
    await fs.writeFile(path.join(repo, "src", "a.txt"), "a-after-exec\n", "utf8");
    await fs.writeFile(path.join(repo, "docs", "d.txt"), "d-after-exec\n", "utf8");

    const result = await undoService().undoExecSideEffects(
      execEvent([sideEffect("src/a.txt", "modified"), sideEffect("docs/d.txt", "modified")]),
      created.checkpoint!.id,
    );
    expect(result.status).toBe("undone");
    expect(await fs.readFile(path.join(repo, "src", "a.txt"), "utf8")).toBe("a-base\n");
    expect(await fs.readFile(path.join(repo, "docs", "d.txt"), "utf8")).toBe("d-base\n");
  });
});

describe("undoing the three side-effect shapes", () => {
  it("reverts modified, removes added, and restores deleted files", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    // The exec: modified a.txt, added new.txt, deleted gone.txt.
    await fs.writeFile(path.join(repo, "src", "a.txt"), "a-after-exec\n", "utf8");
    await fs.writeFile(path.join(repo, "src", "new.txt"), "new-from-exec\n", "utf8");
    await fs.rm(path.join(repo, "src", "gone.txt"));

    const result = await undoService().undoExecSideEffects(
      execEvent([
        sideEffect("src/a.txt", "modified"),
        sideEffect("src/new.txt", "added"),
        sideEffect("src/gone.txt", "deleted"),
      ]),
      created.checkpoint!.id,
    );

    expect(result.status).toBe("undone");
    expect(result.paths).toEqual(["src/a.txt", "src/gone.txt", "src/new.txt"]);
    expect(await fs.readFile(path.join(repo, "src", "a.txt"), "utf8")).toBe("a-base\n");
    expect(await fs.readFile(path.join(repo, "src", "gone.txt"), "utf8")).toBe("gone-base\n");
    await expect(fs.access(path.join(repo, "src", "new.txt"))).rejects.toThrow();
    // Out of scope and untouched.
    expect(await fs.readFile(path.join(repo, "docs", "d.txt"), "utf8")).toBe("d-base\n");
  });

  it("captures a safety ref so the post-exec content stays recoverable", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    await fs.writeFile(path.join(repo, "src", "a.txt"), "a-after-exec\n", "utf8");

    const result = await undoService().undoExecSideEffects(
      execEvent([sideEffect("src/a.txt", "modified")]),
      created.checkpoint!.id,
    );
    expect(result.status).toBe("undone");
    expect(result.safetyRef).toMatch(/^refs\/openclaw\/uftk-safety\//);
    // The exec's output is not lost by undoing it.
    expect(await git(["show", `${result.safetyRef}:src/a.txt`], repo)).toBe("a-after-exec\n");
  });
});

describe("structured refusals", () => {
  it("returns disabled when the execUndo flag is off, with zero change", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    await fs.writeFile(path.join(repo, "src", "a.txt"), "a-after-exec\n", "utf8");

    const result = await undoService({ execUndoEnabled: false }).undoExecSideEffects(
      execEvent([sideEffect("src/a.txt", "modified")]),
      created.checkpoint!.id,
    );
    expect(result).toMatchObject({ status: "disabled", paths: [] });
    expect(result.reason).toContain("execUndo");
    expect(await fs.readFile(path.join(repo, "src", "a.txt"), "utf8")).toBe("a-after-exec\n");
  });

  it("returns disabled when path-scoped restore is off", async () => {
    const scopedOff = new GitCheckpointService({
      workspaceRoot: repo,
      enabled: true,
      stateDir: state,
      warn: (message) => warnings.push(message),
    });
    const result = await new ExecSideEffectUndoService({
      service: scopedOff,
      execUndoEnabled: true,
    }).undoExecSideEffects(execEvent([sideEffect("src/a.txt", "modified")]), "abc");
    expect(result).toMatchObject({ status: "disabled" });
    expect(result.reason).toContain("pathScoped");
  });

  it("refuses an exec whose side-effect diff was never captured", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    await fs.writeFile(path.join(repo, "src", "a.txt"), "a-after-exec\n", "utf8");

    const result = await undoService().undoExecSideEffects(
      execEvent([], { beforeHash: null, afterHash: null }),
      created.checkpoint!.id,
    );
    expect(result.status).toBe("unsupported");
    expect(result.reason).toContain("no workspace snapshot");
    // Absence of evidence is not reported as "nothing to undo".
    expect(result.status).not.toBe("noop");
    expect(await fs.readFile(path.join(repo, "src", "a.txt"), "utf8")).toBe("a-after-exec\n");
  });

  it("refuses when any side effect is outside the workspace", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    await fs.writeFile(path.join(repo, "src", "a.txt"), "a-after-exec\n", "utf8");

    const result = await undoService().undoExecSideEffects(
      execEvent([
        sideEffect("src/a.txt", "modified"),
        sideEffect("../escape.txt", "modified"),
      ]),
      created.checkpoint!.id,
    );
    expect(result.status).toBe("unsupported");
    expect(result.reason).toContain("not undoable workspace files");
    expect(result.rejected.map((entry) => entry.path)).toEqual(["../escape.txt"]);
    // Zero change, including the path that *was* undoable.
    expect(await fs.readFile(path.join(repo, "src", "a.txt"), "utf8")).toBe("a-after-exec\n");
  });

  it("reports noop for a complete diff with no file side effects", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    const result = await undoService().undoExecSideEffects(
      execEvent([]),
      created.checkpoint!.id,
    );
    expect(result).toMatchObject({ status: "noop", paths: [], rejected: [] });
  });

  it("returns not_found for a checkpoint that does not resolve", async () => {
    await fs.writeFile(path.join(repo, "src", "a.txt"), "a-after-exec\n", "utf8");
    const result = await undoService().undoExecSideEffects(
      execEvent([sideEffect("src/a.txt", "modified")]),
      "0000000000000000000000000000000000000000",
    );
    expect(result.status).toBe("not_found");
    expect(result.error?.code).toBe("E_GIT_CHECKPOINT_NOT_FOUND");
    expect(await fs.readFile(path.join(repo, "src", "a.txt"), "utf8")).toBe("a-after-exec\n");
  });

  it("surfaces a conflict instead of overwriting when safety is off", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    await fs.writeFile(path.join(repo, "src", "a.txt"), "hand-edited-after-exec\n", "utf8");

    const result = await undoService({ safetySnapshotEnabled: false }).undoExecSideEffects(
      execEvent([sideEffect("src/a.txt", "modified")]),
      created.checkpoint!.id,
    );
    expect(result.status).toBe("conflict");
    expect(result.error?.code).toBe("E_GIT_CHECKPOINT_CONFLICT");
    expect(await fs.readFile(path.join(repo, "src", "a.txt"), "utf8")).toBe(
      "hand-edited-after-exec\n",
    );
  });
});

describe("raw command boundary", () => {
  it("carries only the redacted exec identity into the result", async () => {
    const created = await service.createCheckpoint({ paths: ["src"] });
    await fs.writeFile(path.join(repo, "src", "a.txt"), "a-after-exec\n", "utf8");
    const event = execEvent([sideEffect("src/a.txt", "modified")], {
      commandRedacted: "bash -lc 'deploy --token=***'",
    });

    const result = await undoService().undoExecSideEffects(event, created.checkpoint!.id);
    expect(result.status).toBe("undone");
    expect(result.commandId).toBe(event.commandId);
    expect(result.commandHash).toBe(event.commandHash);
    // No command text of any kind rides along on the undo result.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("bash -lc");
    expect(serialized).not.toContain("deploy");
    expect(serialized).not.toContain("commandRedacted");
  });

  it("does not import the exec auditor or the write journal", async () => {
    const source = await fs.readFile(
      path.join(import.meta.dirname, "exec-side-effect-undo.ts"),
      "utf8",
    );
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]!);
    expect(imports.some((spec) => spec.includes("exec-audit"))).toBe(false);
    expect(imports.some((spec) => spec.includes("write-journal"))).toBe(false);
    // And it never reaches for the forbidden restore primitives.
    const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(codeOnly).not.toContain("reset --hard");
    expect(codeOnly).not.toContain("clean -f");
  });
});
