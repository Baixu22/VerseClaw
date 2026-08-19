import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GIT_CHECKPOINT_REF_PREFIX, GitCheckpointService } from "./git-checkpoint.js";
import { GitCheckpointLifecycleService } from "./git-checkpoint-lifecycle.js";

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

/**
 * Checkpoint services pinned to a fixed git date so `creatordate` ordering is
 * deterministic instead of depending on sub-second test timing.
 */
function serviceAt(dateIso: string): GitCheckpointService {
  return new GitCheckpointService({
    workspaceRoot: repo,
    enabled: true,
    pathScopedEnabled: true,
    stateDir: state,
    env: { ...process.env, GIT_AUTHOR_DATE: dateIso, GIT_COMMITTER_DATE: dateIso },
    warn: (message) => warnings.push(message),
  });
}

function lifecycleFor(
  service: GitCheckpointService,
  options: { lifecycleEnabled?: boolean } = {},
): GitCheckpointLifecycleService {
  return new GitCheckpointLifecycleService({
    service,
    lifecycleEnabled: options.lifecycleEnabled ?? true,
  });
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "uftk-git-lifecycle-"));
  repo = path.join(root, "repo");
  state = path.join(root, "state");
  warnings = [];
  await fs.mkdir(repo, { recursive: true });
  await git(["init", "-q"], repo);
  await git(["config", "user.email", "test@example.invalid"], repo);
  await git(["config", "user.name", "UFTK Test"], repo);
  await git(["config", "core.autocrlf", "false"], repo);
  await fs.mkdir(path.join(repo, "src"), { recursive: true });
  await fs.writeFile(path.join(repo, "src", "a.txt"), "a-base\n", "utf8");
  await git(["add", "."], repo);
  await git(["commit", "-qm", "initial"], repo);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("checkpoint lifecycle listing", () => {
  it("lists newest-first with label, scope, and parent", async () => {
    const first = await serviceAt("2026-08-01T10:00:00Z").createCheckpoint({
      paths: ["src"],
      label: "oldest",
    });
    const second = await serviceAt("2026-08-02T10:00:00Z").createCheckpoint({
      paths: ["src/a.txt"],
      label: "newest",
    });
    expect(first.status).toBe("created");
    expect(second.status).toBe("created");

    const listed = await lifecycleFor(serviceAt("2026-08-03T10:00:00Z")).listCheckpoints();
    expect(listed.status).toBe("ok");
    expect(listed.checkpoints.map((item) => item.label)).toEqual(["newest", "oldest"]);
    expect(listed.checkpoints[0]?.scope).toEqual({ kind: "paths", paths: ["src/a.txt"] });
    expect(listed.checkpoints[1]?.scope).toEqual({ kind: "paths", paths: ["src"] });
    expect(listed.checkpoints[0]?.parent).toMatch(/^[0-9a-f]{40}$/);
  });

  it("returns structured disabled for every lifecycle method when the flag is off", async () => {
    const created = await serviceAt("2026-08-01T10:00:00Z").createCheckpoint();
    const off = lifecycleFor(serviceAt("2026-08-01T10:00:00Z"), { lifecycleEnabled: false });
    await expect(off.listCheckpoints()).resolves.toMatchObject({ status: "disabled" });
    await expect(off.diffCheckpoints("a", "b")).resolves.toMatchObject({ status: "disabled" });
    await expect(off.exportPatch(created.checkpoint!.id)).resolves.toMatchObject({
      status: "disabled",
    });
    await expect(off.retainCheckpoints({ maxCount: 0 })).resolves.toMatchObject({
      status: "disabled",
      pruned: [],
    });
    await expect(off.collectGarbage()).resolves.toMatchObject({ status: "disabled", pruned: false });
    // Nothing was deleted while disabled.
    expect(await git(["for-each-ref", GIT_CHECKPOINT_REF_PREFIX], repo)).toContain(
      created.checkpoint!.id,
    );
  });
});

describe("checkpoint diff and patch export", () => {
  it("diffs two checkpoint trees", async () => {
    const before = await serviceAt("2026-08-01T10:00:00Z").createCheckpoint({ paths: ["src"] });
    await fs.writeFile(path.join(repo, "src", "a.txt"), "a-v2\n", "utf8");
    await fs.writeFile(path.join(repo, "src", "added.txt"), "added\n", "utf8");
    const after = await serviceAt("2026-08-02T10:00:00Z").createCheckpoint({ paths: ["src"] });

    const diff = await lifecycleFor(serviceAt("2026-08-03T10:00:00Z")).diffCheckpoints(
      before.checkpoint!.id,
      after.checkpoint!.id,
    );
    expect(diff.status).toBe("ok");
    expect(diff.changes).toEqual(
      expect.arrayContaining([
        { status: "M", path: "src/a.txt" },
        { status: "A", path: "src/added.txt" },
      ]),
    );
    expect(diff.summary).toBeTruthy();
  });

  it("exports a checkpoint as a patch against an explicit base", async () => {
    const before = await serviceAt("2026-08-01T10:00:00Z").createCheckpoint({ paths: ["src"] });
    await fs.writeFile(path.join(repo, "src", "a.txt"), "a-v2\n", "utf8");
    const after = await serviceAt("2026-08-02T10:00:00Z").createCheckpoint({ paths: ["src"] });

    const exported = await lifecycleFor(serviceAt("2026-08-03T10:00:00Z")).exportPatch(
      after.checkpoint!.id,
      { against: before.checkpoint!.id },
    );
    expect(exported.status).toBe("ok");
    expect(exported.patch).toContain("src/a.txt");
    expect(exported.patch).toContain("-a-base");
    expect(exported.patch).toContain("+a-v2");
  });

  it("exports a whole-tree checkpoint against its parent by default", async () => {
    await fs.writeFile(path.join(repo, "src", "a.txt"), "a-dirty\n", "utf8");
    const created = await serviceAt("2026-08-01T10:00:00Z").createCheckpoint();
    const exported = await lifecycleFor(serviceAt("2026-08-02T10:00:00Z")).exportPatch(
      created.checkpoint!.id,
    );
    expect(exported.status).toBe("ok");
    expect(exported.patch).toContain("src/a.txt");
    expect(exported.patch).toContain("+a-dirty");
  });

  it("reports not_found for unknown checkpoint ids", async () => {
    const lifecycle = lifecycleFor(serviceAt("2026-08-01T10:00:00Z"));
    await expect(
      lifecycle.diffCheckpoints(
        "0000000000000000000000000000000000000000",
        "1111111111111111111111111111111111111111",
      ),
    ).resolves.toMatchObject({ status: "not_found" });
    await expect(
      lifecycle.exportPatch("0000000000000000000000000000000000000000"),
    ).resolves.toMatchObject({ status: "not_found" });
  });
});

describe("checkpoint retention and prune", () => {
  async function createThree(): Promise<string[]> {
    const ids: string[] = [];
    const dates = ["2026-08-01T10:00:00Z", "2026-08-02T10:00:00Z", "2026-08-03T10:00:00Z"];
    for (const [index, date] of dates.entries()) {
      await fs.writeFile(path.join(repo, "src", "a.txt"), `a-v${index}\n`, "utf8");
      const created = await serviceAt(date).createCheckpoint({ paths: ["src"], label: `cp${index}` });
      expect(created.status).toBe("created");
      ids.push(created.checkpoint!.id);
    }
    return ids;
  }

  it("keeps the newest N and deletes the rest", async () => {
    const [oldest, middle, newest] = await createThree();
    const result = await lifecycleFor(serviceAt("2026-08-04T10:00:00Z")).retainCheckpoints({
      maxCount: 2,
    });
    expect(result.status).toBe("ok");
    expect(result.pruned).toEqual([oldest]);
    expect(result.kept).toEqual(expect.arrayContaining([newest, middle]));

    const refs = await git(["for-each-ref", GIT_CHECKPOINT_REF_PREFIX], repo);
    expect(refs).toContain(newest);
    expect(refs).toContain(middle);
    expect(refs).not.toContain(oldest);
  });

  it("never deletes the newest checkpoint even when asked to keep none", async () => {
    const [oldest, middle, newest] = await createThree();
    const result = await lifecycleFor(serviceAt("2026-08-04T10:00:00Z")).pruneCheckpoints();
    expect(result.status).toBe("ok");
    expect(result.kept).toEqual([newest]);
    expect(result.pruned).toEqual(expect.arrayContaining([oldest, middle]));
    expect(await git(["for-each-ref", GIT_CHECKPOINT_REF_PREFIX], repo)).toContain(newest);
  });

  it("honors protectedIds so a referenced checkpoint survives", async () => {
    const [oldest, , newest] = await createThree();
    const result = await lifecycleFor(serviceAt("2026-08-04T10:00:00Z")).pruneCheckpoints({
      protectedIds: [oldest],
    });
    expect(result.status).toBe("ok");
    expect(result.pruned).not.toContain(oldest);
    expect(result.kept).toEqual(expect.arrayContaining([oldest, newest]));
    const refs = await git(["for-each-ref", GIT_CHECKPOINT_REF_PREFIX], repo);
    expect(refs).toContain(oldest);
    expect(refs).toContain(newest);
  });

  it("drops only checkpoints older than maxAgeMs", async () => {
    const [oldest, middle, newest] = await createThree();
    // Cutoff sits between the oldest (08-01T10:00) and the middle (08-02T10:00)
    // checkpoint, so exactly one checkpoint is old enough to drop.
    const ageMs = Date.now() - Date.parse("2026-08-01T18:00:00Z");
    const result = await lifecycleFor(serviceAt("2026-08-04T10:00:00Z")).retainCheckpoints({
      maxAgeMs: ageMs,
    });
    expect(result.status).toBe("ok");
    expect(result.pruned).toEqual([oldest]);
    expect(result.kept).toEqual(expect.arrayContaining([newest, middle]));
  });

  it("reports a dry run without deleting anything", async () => {
    const [oldest, middle, newest] = await createThree();
    const result = await lifecycleFor(serviceAt("2026-08-04T10:00:00Z")).retainCheckpoints({
      maxCount: 1,
      dryRun: true,
    });
    expect(result.status).toBe("ok");
    expect(result.dryRun).toBe(true);
    expect(result.pruned).toEqual(expect.arrayContaining([oldest, middle]));
    const refs = await git(["for-each-ref", GIT_CHECKPOINT_REF_PREFIX], repo);
    for (const id of [oldest, middle, newest]) {
      expect(refs).toContain(id);
    }
  });

  it("leaves the worktree and index untouched across the whole lifecycle surface", async () => {
    await createThree();
    const beforeStatus = await git(["status", "--porcelain=v1"], repo);
    const lifecycle = lifecycleFor(serviceAt("2026-08-04T10:00:00Z"));
    await lifecycle.listCheckpoints();
    await lifecycle.retainCheckpoints({ maxCount: 1 });
    await lifecycle.collectGarbage();
    expect(await git(["status", "--porcelain=v1"], repo)).toBe(beforeStatus);
    expect(await fs.readFile(path.join(repo, "src", "a.txt"), "utf8")).toBe("a-v2\n");
  });
});
