import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeOpenClawStateDatabaseForTest } from "../../state/openclaw-state-db.js";
import { DistillationTool } from "./distillation-tool.js";
import { KnowledgeStore } from "./knowledge-store.js";
import { RetrievalEngine } from "./retrieval-engine.js";
import { TrajectoryCapture } from "./trajectory-capture.js";

const tempRoots: string[] = [];

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createStore(): KnowledgeStore {
  const root = mkdtempSync(join(tmpdir(), "sekb-ks05-"));
  tempRoots.push(root);
  return new KnowledgeStore({ database: { path: join(root, "state.sqlite") } });
}

function captureFailedPostgresTrajectories(store: KnowledgeStore): string[] {
  const capture = new TrajectoryCapture({ store });
  const ids: string[] = [];
  for (const scenario of [
    {
      intent: "connect PostgreSQL for KS-05 loop",
      error: "could not connect to server: Connection refused (port 5432)",
    },
    {
      intent: "configure database connection for KS-05 loop",
      error: "Connection refused while connecting to PostgreSQL",
    },
  ]) {
    const id = capture.start_trajectory(scenario.intent, "config/db", ["postgresql", "ks05"], {
      driven_by: "agent",
      actor: "ks05-test-fixture",
      runtimeLineage: {
        schema: "runtime-lineage.v1",
        sessionId: "session:ks05:source",
        loopRunId: `run:ks05:source:${ids.length}`,
        traceId: `trace:ks05:source:${ids.length}`,
      },
    });
    capture.log_step(id, "tool.call", { tool: "psql" }, { error: "connection refused" });
    capture.log_step(id, "diagnose", { host: "127.0.0.1" }, { reachable: false });
    capture.finish_trajectory(id, "failure", scenario.error);
    ids.push(id);
  }
  return ids;
}

describe("KS-05 SEKB experience closed loop", () => {
  it("runs failure task -> candidate -> agent-driven confirmation -> fresh recall -> cited/outcome -> archive/delete on real SQLite", () => {
    const store = createStore();
    const trajectoryIds = captureFailedPostgresTrajectories(store);

    const distiller = new DistillationTool({ store });
    const suggestions = distiller.suggest_principles_from_trajectories(trajectoryIds, 2);
    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    expect(store.query_principles({})).toHaveLength(0);

    const suggestion = suggestions[0]!;
    const confirmed = distiller.confirm_and_save(suggestion, {
      title: "Check PostgreSQL access before retrying (KS-05)",
      condition: "When PostgreSQL reports Connection refused during config/db tasks",
      action: "Verify service, pg_hba.conf, and firewall rules before retrying",
      reason: "Repeated connection refusals across trajectories indicate environment/config causes",
      criticality: "high",
      pinned: true,
    }, {
      sessionId: "session:ks05:source",
      requireSession: true,
      sourceSystem: "ui-confirm",
      integrityClaim: "confirmed",
    });

    const principle = store.get_principle(confirmed);
    expect(principle.status).toBe("active");
    expect(principle.created_by).toBe("human");
    expect(principle.source_trajectories.toSorted()).toEqual(trajectoryIds.toSorted());
    for (const trajectoryId of trajectoryIds) {
      const trajectory = store.get_trajectory(trajectoryId);
      expect(trajectory.distilled).toBe(true);
      expect(trajectory.distilled_into).toContain(confirmed);
    }

    // Fresh task recall through the production RetrievalEngine.
    const freshEngine = new RetrievalEngine({ store });
    const freshHits = freshEngine.retrieve_for_task(
      "configure database connection postgresql",
      "config/db",
      ["postgresql", "ks05"],
      5,
    );
    expect(freshHits.map((hit) => hit.principle_id)).toContain(confirmed);
    expect(freshEngine.format_for_injection(freshHits)).toContain(principle.title);

    // retrieval_count may move on recall, but adoption must not.
    const afterRecall = store.get_principle(confirmed);
    expect(afterRecall.retrieval_count).toBeGreaterThanOrEqual(1);
    expect(afterRecall.adoption_count).toBe(0);
    expect(afterRecall.post_adoption_success).toBe(0);

    // Cited adoption evidence moves effectiveness.
    store.record_adoption(confirmed, {
      trigger: "cited",
      taskSucceeded: true,
      taskType: "config/db",
      contextTags: ["postgresql"],
      sessionKey: "session:ks05:fresh",
      sourceRunId: "run:ks05:fresh",
      citationText: "Check PostgreSQL access before retrying (KS-05)",
    });
    const afterCited = store.get_principle(confirmed);
    expect(afterCited.adoption_count).toBe(1);
    expect(afterCited.post_adoption_success).toBe(1);
    const evidence = afterCited.metadata.sekbAdoptionEvidence as Array<Record<string, unknown>>;
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      trigger: "cited",
      taskSucceeded: true,
      sessionKey: "session:ks05:fresh",
      sourceRunId: "run:ks05:fresh",
    });

    // Outcome evidence with a failed task keeps adoption_count moving but not success.
    store.record_adoption(confirmed, {
      trigger: "outcome",
      taskSucceeded: false,
      taskType: "config/db",
      sessionKey: "session:ks05:fresh",
      sourceRunId: "run:ks05:fresh:2",
    });
    const afterOutcome = store.get_principle(confirmed);
    expect(afterOutcome.adoption_count).toBe(2);
    expect(afterOutcome.post_adoption_success).toBe(1);

    // Archive prevents fresh recall.
    store.archive_principle(confirmed);
    const archivedEngine = new RetrievalEngine({ store });
    expect(archivedEngine.retrieve_for_task(
      "configure database connection postgresql",
      "config/db",
      ["postgresql", "ks05"],
      5,
    )).toHaveLength(0);

    // Delete removes the canonical row completely.
    store.delete_principle(confirmed);
    expect(() => store.get_principle(confirmed)).toThrow(/not found/);
  });

  it("rejects evidence-less adoption and never lets retrieval_count move adoption", () => {
    const store = createStore();
    const capture = new TrajectoryCapture({ store });
    const id = capture.start_trajectory("connect PostgreSQL", "config/db", ["postgresql"]);
    capture.log_step(id, "tool.call", { tool: "psql" }, { error: "connection refused" });
    capture.finish_trajectory(id, "failure", "Connection refused");

    const principleId = new DistillationTool({ store }).confirm_and_save({
      cluster_summary: "PostgreSQL connection refused failures",
      source_trajectory_ids: [id],
      suggested_principle: {
        title: "Check PG access",
        condition: "When PostgreSQL reports Connection refused",
        action: "Check pg_hba.conf and firewall rules",
        reason: "Most connection refusals are environment or configuration issues",
        task_types: ["config/db"],
        context_tags: ["postgresql"],
        criticality: "high",
      },
      confidence: 0.8,
    });

    expect(() => store.record_adoption(principleId, {
      trigger: "retrieval",
      taskSucceeded: true,
    } as never)).toThrow(/cited\/adopted\/outcome evidence/);
    expect(() => store.record_adoption(principleId, {
      trigger: "cited",
      taskSucceeded: "yes",
    } as never)).toThrow(/taskSucceeded boolean/);

    const before = store.get_principle(principleId);
    expect(before.adoption_count).toBe(0);
    expect(before.post_adoption_success).toBe(0);

    const engine = new RetrievalEngine({ store });
    engine.retrieve_for_task("connect PostgreSQL", "config/db", ["postgresql"], 5);
    const after = store.get_principle(principleId);
    expect(after.retrieval_count).toBe(1);
    expect(after.adoption_count).toBe(0);
    expect(after.post_adoption_success).toBe(0);
  });
});
