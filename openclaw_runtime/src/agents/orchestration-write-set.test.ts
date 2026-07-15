import { describe, expect, it } from "vitest";
import { codingObservability } from "../context-engine/coding-observability.js";
import {
  buildExecutionWaves,
  buildTaskGraph,
  isWriterLikeRole,
  resolveWorkerWriteSet,
  impactRadiiConflict,
  type OrchestrationTaskGraph,
  type OrchestrationTaskNode,
  writeSetsConflict,
} from "./orchestration-protocol.js";

function node(
  id: string,
  writeSet?: string[],
  dependsOn: string[] = [],
): OrchestrationTaskNode {
  return {
    taskNodeId: id,
    roleName: `role-${id}`,
    task: `task ${id}`,
    phase: "implementation",
    dependsOn,
    scope: "repo",
    requiredCapabilities: [],
    attemptPolicy: { maxRepairAttempts: 0, maxRedoAttempts: 0 },
    status: "planned",
    writeSet,
  };
}

function graph(nodes: OrchestrationTaskNode[]): OrchestrationTaskGraph {
  return {
    graphRunId: "g1",
    mode: "flat",
    status: "planned",
    nodes,
    edges: [],
  };
}

describe("orchestration writeSet (C3)", () => {
  it("writeSetsConflict: missing/empty do not constrain; intersection conflicts", () => {
    expect(writeSetsConflict(undefined, undefined)).toBe(false);
    expect(writeSetsConflict(["a.ts"], undefined)).toBe(false);
    expect(writeSetsConflict(["a.ts"], [])).toBe(false);
    expect(writeSetsConflict(["a.ts"], ["b.ts"])).toBe(false);
    expect(writeSetsConflict(["a.ts"], ["a.ts"])).toBe(true);
    expect(writeSetsConflict(["src/*"], ["src/x.ts"])).toBe(true);
  });

  it("disjoint writeSets share a wave; intersecting split", () => {
    const g = graph([
      node("t1", ["src/a.ts"]),
      node("t2", ["src/b.ts"]),
      node("t3", ["src/a.ts"]),
    ]);
    const waves = buildExecutionWaves(g);
    const waveOf = (id: string) => waves.find((w) => w.taskNodeIds.includes(id))?.wave;
    expect(waveOf("t1")).toBeDefined();
    expect(waveOf("t2")).toBe(waveOf("t1"));
    expect(waveOf("t3")).not.toBe(waveOf("t1"));
    expect(waveOf("t3")).toBeGreaterThan(waveOf("t1")!);
  });

  it("nodes without writeSet pack together (backward compatible)", () => {
    const g = graph([node("a"), node("b")]);
    const waves = buildExecutionWaves(g);
    expect(waves).toHaveLength(1);
    expect(waves[0]!.taskNodeIds.sort()).toEqual(["a", "b"]);
  });

  it("empty writeSet is compatible with non-empty peers", () => {
    const g = graph([node("a", ["src/a.ts"]), node("b", []), node("c")]);
    const waves = buildExecutionWaves(g);
    expect(waves).toHaveLength(1);
    expect(waves[0]!.taskNodeIds).toHaveLength(3);
  });

  it("impact radii force different waves when enabled (C3-3)", () => {
    const g = graph([
      node("t1", ["mod-a.ts"]),
      node("t2", ["mod-b.ts"]),
    ]);
    const impact = new Map<string, readonly string[]>([
      ["t1", ["shared/util.ts", "mod-a.ts"]],
      ["t2", ["shared/util.ts", "mod-b.ts"]],
    ]);
    expect(impactRadiiConflict(impact.get("t1"), impact.get("t2"))).toBe(true);
    const waves = buildExecutionWaves(g, undefined, { impactByNodeId: impact });
    expect(waves).toHaveLength(2);
  });

  it("impact radius mode can be force-disabled via flag", () => {
    const g = graph([
      node("t1", ["mod-a.ts"]),
      node("t2", ["mod-b.ts"]),
    ]);
    const impact = new Map<string, readonly string[]>([
      ["t1", ["shared/util.ts"]],
      ["t2", ["shared/util.ts"]],
    ]);
    const waves = buildExecutionWaves(g, undefined, {
      impactByNodeId: impact,
      impactRadiusEnabled: false,
    });
    expect(waves).toHaveLength(1);
  });

  it("non-overlapping impact radii may share wave", () => {
    const g = graph([
      node("t1", ["mod-a.ts"]),
      node("t2", ["mod-b.ts"]),
    ]);
    const impact = new Map<string, readonly string[]>([
      ["t1", ["mod-a.ts"]],
      ["t2", ["mod-b.ts"]],
    ]);
    const waves = buildExecutionWaves(g, undefined, { impactByNodeId: impact });
    expect(waves).toHaveLength(1);
    expect(waves[0]!.taskNodeIds.sort()).toEqual(["t1", "t2"]);
  });

  it("buildTaskGraph can carry planner-provided writeSet (pass-through wiring)", () => {
    codingObservability.reset();
    const g = buildTaskGraph({
      graphRunId: "g-writeset",
      mode: "router",
      graphMode: "flat",
      workers: [
        { roleName: "impl-a", task: "edit a", writeSet: ["src/a.ts"] },
        { roleName: "impl-b", task: "edit b", writeSet: ["src/b.ts"] },
      ],
      requiredCapabilities: [],
    });
    expect(g.nodes.map((n) => n.writeSet)).toEqual([["src/a.ts"], ["src/b.ts"]]);
    const waves = buildExecutionWaves(g);
    expect(waves).toHaveLength(1);
    expect(waves[0]?.taskNodeIds).toHaveLength(2);
    const snap = codingObservability.snapshot();
    expect(snap.writeSetNodesTotal).toBe(2);
    expect(snap.writeSetNodesPopulated).toBe(2);
    expect(codingObservability.rates().writeSetCoverageRate).toBe(1);
  });

  it("records zero writeSet coverage when planner leaves writeSet empty", () => {
    codingObservability.reset();
    const g = buildTaskGraph({
      graphRunId: "g-empty",
      mode: "router",
      graphMode: "flat",
      workers: [
        { roleName: "impl-a", task: "edit a" },
        { roleName: "impl-b", task: "edit b" },
      ],
      requiredCapabilities: [],
    });
    expect(g.nodes.every((n) => n.writeSet === undefined)).toBe(true);
    buildExecutionWaves(g);
    const snap = codingObservability.snapshot();
    expect(snap.writeSetNodesTotal).toBe(2);
    expect(snap.writeSetNodesPopulated).toBe(0);
    expect(codingObservability.rates().writeSetCoverageRate).toBe(0);
  });

  it("resolveWorkerWriteSet: explicit wins; writers inherit fileHints; non-writers stay empty", () => {
    expect(
      resolveWorkerWriteSet({
        roleName: "implementer",
        explicit: ["src/explicit.ts"],
        fileHints: ["src/hint.ts"],
      }),
    ).toEqual(["src/explicit.ts"]);
    expect(
      resolveWorkerWriteSet({
        roleName: "implementer",
        fileHints: [" src\\a.ts ", "src/a.ts", "src/b.ts"],
      }),
    ).toEqual(["src/a.ts", "src/b.ts"]);
    expect(resolveWorkerWriteSet({ roleName: "reviewer", fileHints: ["src/a.ts"] })).toBeUndefined();
    expect(resolveWorkerWriteSet({ roleName: "planner", fileHints: ["src/a.ts"] })).toBeUndefined();
    expect(resolveWorkerWriteSet({ roleName: "implementer" })).toBeUndefined();
    expect(isWriterLikeRole("implementer")).toBe(true);
    expect(isWriterLikeRole("docs-writer")).toBe(true);
    expect(isWriterLikeRole("reviewer")).toBe(false);
  });
});