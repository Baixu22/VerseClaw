/**
 * B-3 v3: subagent-spawn write-set coordinate — the spawned-worker write-set is
 * normalized and persisted onto the child session entry (`spawnedWriteSet`).
 */
import { describe, expect, it } from "vitest";
import { testing } from "./subagent-spawn.js";

const { buildDirectChildSessionPatch } = testing;

describe("B-3 v3 buildDirectChildSessionPatch writeSet", () => {
  it("persists a normalized spawnedWriteSet when provided", () => {
    const patch = buildDirectChildSessionPatch({
      spawnedWriteSet: ["src/a.ts", " src/b.ts\\", "src/a.ts", "  "],
    });
    expect(patch.spawnedWriteSet).toEqual(["src/a.ts", "src/b.ts/"]);
  });

  it("omits spawnedWriteSet when absent or empty", () => {
    expect(buildDirectChildSessionPatch({}).spawnedWriteSet).toBeUndefined();
    expect(buildDirectChildSessionPatch({ spawnedWriteSet: [] }).spawnedWriteSet).toBeUndefined();
    expect(buildDirectChildSessionPatch({ spawnedWriteSet: undefined }).spawnedWriteSet).toBeUndefined();
  });

  it("keeps non-writeSet spawn metadata intact", () => {
    const patch = buildDirectChildSessionPatch({
      spawnedBy: "agent:parent:main",
      spawnedWorkspaceDir: "C:/repo",
      spawnedWriteSet: ["src/auth/middleware.ts"],
    });
    expect(patch.spawnedBy).toBe("agent:parent:main");
    expect(patch.spawnedWorkspaceDir).toBe("C:/repo");
    expect(patch.spawnedWriteSet).toEqual(["src/auth/middleware.ts"]);
  });
});
