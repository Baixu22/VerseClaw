import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DistillationTool } from "../../openclaw_runtime/src/knowledge/sekb/distillation-tool";
import { KnowledgeStore } from "../../openclaw_runtime/src/knowledge/sekb/knowledge-store";
import { TrajectoryCapture } from "../../openclaw_runtime/src/knowledge/sekb/trajectory-capture";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";

const tempRoots: string[] = [];

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("TF-0018 SEKB confirm-only writeback", () => {
  it("persists no principle until confirm_and_save is called explicitly", () => {
    const root = mkdtempSync(join(tmpdir(), "tf0018-sekb-"));
    tempRoots.push(root);
    const store = new KnowledgeStore({
      database: { path: join(root, "state", "openclaw.sqlite") },
    });
    const capture = new TrajectoryCapture({ store });
    for (let index = 0; index < 2; index += 1) {
      const trajectoryId = capture.start_trajectory(
        `diagnose database outage ${index}`,
        "config/db",
        ["postgresql"],
      );
      capture.log_step(trajectoryId, "tool.call", { index }, { error: "Connection refused" });
      capture.finish_trajectory(trajectoryId, "failure", "Connection refused");
    }

    const distiller = new DistillationTool({ store });
    const suggestions = distiller.suggest_principles_from_trajectories(null, 2);

    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    expect(store.query_principles({ status: "active" })).toHaveLength(0);

    const principleId = distiller.confirm_and_save(suggestions[0]!, null, {
      sessionId: "session:tf0018:confirm",
      requireSession: true,
      sourceSystem: "ui-confirm",
    });

    expect(principleId).toBeTruthy();
    expect(store.query_principles({ status: "active" })).toEqual([
      expect.objectContaining({ principle_id: principleId, created_by: "human" }),
    ]);
  });
});
