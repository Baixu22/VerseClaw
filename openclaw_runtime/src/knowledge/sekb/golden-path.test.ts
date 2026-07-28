/**
 * TF-0004: SEKB semi-automatic golden path lock.
 * Proves: execute→compress→candidate→filter→confirm→persist→recall→behavior delta
 * with no auto writeback before human confirm.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContextBlockSink } from "../../context-engine/block.js";
import { closeOpenClawStateDatabaseForTest } from "../../state/openclaw-state-db.js";
import { DistillationTool } from "./distillation-tool.js";
import {
  defaultSekbGoldenPathArtifactPath,
  runSekbGoldenPath,
  SEKB_GOLDEN_PATH_SCHEMA,
  SEKB_GOLDEN_PATH_TASK_ID,
} from "./golden-path.js";
import { KnowledgeStore } from "./knowledge-store.js";
import { TrajectoryCapture } from "./trajectory-capture.js";

const tempRoots: string[] = [];

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createStore(): KnowledgeStore {
  const root = mkdtempSync(join(tmpdir(), "sekb-golden-path-"));
  tempRoots.push(root);
  return new KnowledgeStore({ database: { path: join(root, "state.sqlite") } });
}

describe("SEKB golden path (TF-0004)", () => {
  it("runs write → human confirm → recall → behavior delta with lineage artifact", async () => {
    const root = mkdtempSync(join(tmpdir(), "sekb-golden-art-"));
    tempRoots.push(root);
    const artifactPath = defaultSekbGoldenPathArtifactPath(root);
    const store = createStore();
    const sink: ContextBlockSink = vi.fn(async (writes) => writes.map(() => ({ accepted: true })));

    const result = await runSekbGoldenPath({
      store,
      sessionId: "session:tf-0004:golden",
      contextBlockSink: sink,
      artifactPath,
      now: () => new Date("2026-07-19T12:00:00.000Z"),
    });

    expect(result.schema).toBe(SEKB_GOLDEN_PATH_SCHEMA);
    expect(result.taskId).toBe(SEKB_GOLDEN_PATH_TASK_ID);
    expect(result.ok).toBe(true);
    expect(result.autoWriteback).toBe(false);
    expect(result.trajectoryIds).toHaveLength(2);
    expect(result.compressedStepCounts.every((n) => n > 0)).toBe(true);
    expect(result.candidatesBeforeFilter).toBeGreaterThanOrEqual(1);
    expect(result.candidatesAfterFilter).toBeGreaterThanOrEqual(1);
    expect(result.principleId).toBeTruthy();
    expect(result.principle?.created_by).toBe("human");
    expect(result.principle?.title).toContain("golden-path");
    expect(result.evaluation.chainComplete).toBe(true);
    expect(result.evaluation.writeOccurredOnlyAfterConfirm).toBe(true);
    expect(result.evaluation.recallMatchedConfirmedPrinciple).toBe(true);
    expect(result.evaluation.behaviorChangedAfterPersist).toBe(true);
    expect(result.evaluation.noAutoWriteback).toBe(true);
    expect(result.behaviorDelta.changed).toBe(true);
    expect(result.behaviorDelta.afterInjection).toContain(result.principle!.title);
    expect(result.lineage.sessionId).toBe("session:tf-0004:golden");
    expect(result.lineage.principleId).toBe(result.principleId);
    expect(result.lineage.provenance?.schema).toBe("sekb-confirm-provenance.v1");
    expect(result.lineage.provenance?.sessionId).toBe("session:tf-0004:golden");
    expect(result.lineage.sourceTrajectoryIds).toEqual(expect.arrayContaining(result.trajectoryIds));

    expect(result.stages.map((s) => s.stage)).toEqual([
      "execute",
      "compress",
      "candidate",
      "filter",
      "confirm",
      "persist",
      "recall",
      "behavior_delta",
      "evaluate",
    ]);
    expect(result.stages.every((s) => s.ok)).toBe(true);

    // Experience sink only after confirm (human gate), never from suggest alone.
    expect(sink).toHaveBeenCalled();

    const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as typeof result & {
      policy?: { autoWriteback?: boolean; humanConfirmRequired?: boolean };
    };
    expect(artifact.ok).toBe(true);
    expect(artifact.lineage.principleId).toBe(result.principleId);
    expect(artifact.policy?.autoWriteback).toBe(false);
    expect(artifact.policy?.humanConfirmRequired).toBe(true);
  });

  it("does not write principles from suggest alone (no auto writeback)", () => {
    const store = createStore();
    const cap = new TrajectoryCapture({ store });
    for (let i = 0; i < 2; i += 1) {
      const id = cap.start_trajectory(`intent-${i}`, "config/db", ["postgresql"]);
      cap.log_step(id, "tool.call", { i }, { error: "refused" });
      cap.finish_trajectory(id, "failure", "Connection refused");
    }
    const distiller = new DistillationTool({ store });
    const suggestions = distiller.suggest_principles_from_trajectories(null, 2);
    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    expect(store.query_principles({ status: "active" })).toHaveLength(0);
  });
});
