import type { KnowledgeStore } from "./knowledge-store.js";
import { getPrincipleVersion, type SekbAdoptionEvidence } from "./types.js";

export function fixtureAttribution(
  store: KnowledgeStore,
  principleId: string,
  runId: string,
  patch: Partial<SekbAdoptionEvidence> = {},
): SekbAdoptionEvidence {
  return {
    schemaVersion: "RsiExperienceAttribution/v1", principleVersion: getPrincipleVersion(store.get_principle(principleId)),
    taskId: `task:${runId}`, runId, sessionId: "sekb-fixture-session", sessionKey: "session:ks05:fresh",
    experimentId: null, arm: null, repeat: null, trajectoryId: `trajectory:${runId}`,
    trigger: "retrieved", source: "runtime", outcome: "unknown", outcomeKind: null,
    observationId: null, operation: null, actor: "codex/sekb-regression-fixture", driven_by: "agent", ...patch,
  };
}

/** Scripted owner receipts used by storage and reporting regressions. */
export function recordFixtureAdoption(
  store: KnowledgeStore,
  principleId: string,
  runId: string,
  outcome: "success" | "failure" = "success",
): void {
  const evidence = fixtureAttribution(store, principleId, runId);
  const operation = { toolCallId: `operation:${runId}`, toolName: "fixture_operation", observed: true, succeeded: true };
  store.record_adoption(principleId, evidence);
  store.record_adoption(principleId, { ...evidence, trigger: "operation", operation });
  store.record_adoption(principleId, { ...evidence, trigger: "adopted", source: "agent", operation });
  store.record_adoption(principleId, { ...evidence, trigger: "outcome", source: "grader", outcomeKind: "task", outcome,
    observationId: `scripted-grade:${runId}` });
}
