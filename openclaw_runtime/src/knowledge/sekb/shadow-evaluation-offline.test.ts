import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateSekbShadowV1 } from "./shadow-evaluator.js";
import {
  buildSekbOfflineEvaluationReport,
  buildSekbShadowEvaluationExport,
  createSekbShadowEvaluationReviewProtocol,
  writeSekbOfflineEvaluationReportArtifact,
  writeSekbShadowEvaluationExportArtifact,
  type SekbEvaluationLabel,
  type SekbShadowEvaluationExportArtifact,
  type SekbShadowEvaluationReview,
  type SekbShadowEvaluationReviewProtocol,
} from "./shadow-evaluation-offline.js";
import type { Trajectory } from "./types.js";

const tempRoots: string[] = [];
const pseudonymizationKey = "offline-evaluation-test-key";

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("SEKB Phase A.5 offline shadow evaluation", () => {
  it("exports only pseudonymous structured evidence and writes it under the controlled artifact directory", () => {
    const secret = "sk-sensitive-shadow-export system prompt diff --git a/private.txt b/private.txt";
    const artifact = buildSekbShadowEvaluationExport({
      pseudonymizationKey,
      trajectories: [
        trajectory({ id: "raw-trajectory-1", score: 82, errorSignature: `raw-error-${secret}`, secret }),
        trajectory({ id: "raw-trajectory-2", score: 24, errorSignature: `raw-error-${secret}`, secret }),
      ],
    });

    expect(artifact).toMatchObject({
      schema: "sekb-shadow-evaluation-export.v1",
      authority: "offline_evaluation_evidence_not_runtime_source_of_truth",
    });
    expect(artifact.records).toHaveLength(2);
    expect(artifact.records.map((record) => record.trajectoryId)).not.toContain("raw-trajectory-1");
    expect(Object.keys(artifact.records[0] ?? {}).toSorted()).toEqual([
      "counts",
      "error",
      "shadow",
      "terminalOutcome",
      "trajectoryId",
    ]);
    expect(artifact.records.every((record) => record.error.recurrenceCount === 1)).toBe(true);

    const serialized = JSON.stringify(artifact);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("raw-trajectory-1");
    expect(serialized).not.toContain("task intent");
    expect(serialized).not.toContain("tool input");
    expect(serialized).not.toContain("tool output");
    expect(serialized).not.toContain("system prompt");
    expect(serialized).not.toContain("diff --git");

    const malformedShadow = trajectory({ id: "raw-trajectory-3", score: 80 });
    malformedShadow.metadata = {
      sekbShadow: {
        schema: "sekb-shadow-metadata.v1",
        captureQuality: {
          schema: "sekb-capture-quality-shadow.v1",
          score: 80,
          recommendation: "retain",
          factors: {
            terminalOutcome: 1,
            toolEvidence: 1,
            errorResolutionEvidence: null,
            recurrenceEvidence: null,
            validationEvidence: null,
            userConfirmationEvidence: null,
            exfiltration: secret,
          },
        },
        completionEvidence: {
          schema: "sekb-completion-evidence.v1",
          status: "supported",
        },
      },
    };
    const sanitized = buildArtifact([malformedShadow]);
    expect(JSON.stringify(sanitized)).not.toContain(secret);
    expect(Object.keys(sanitized.records[0]?.shadow.factors ?? {}).toSorted()).toEqual([
      "errorResolutionEvidence",
      "recurrenceEvidence",
      "terminalOutcome",
      "toolEvidence",
      "userConfirmationEvidence",
      "validationEvidence",
    ]);

    const root = tempRoot();
    const written = writeSekbShadowEvaluationExportArtifact({
      pseudonymizationKey,
      trajectories: [trajectory({ id: "raw-trajectory-1", score: 82, secret })],
      workspaceRoot: root,
    });
    expect(written.artifactPath).toBe(path.join(root, "artifacts", "sekb-hermes-phase-a5", "shadow-evaluation-export.v1.json"));
    expect(readFileSync(written.artifactPath, "utf8")).toBe(`${JSON.stringify(written.artifact, null, 2)}\n`);
  });

  it("creates a deterministic stratified review protocol with separate development and holdout samples", () => {
    const artifact = buildArtifact([
      trajectory({ id: "success-tool-high", outcome: "success", score: 90, tool: true }),
      trajectory({ id: "success-tool-low", outcome: "success", score: 10, tool: true }),
      trajectory({ id: "partial-no-tool", outcome: "partial", score: 90, tool: false }),
      trajectory({ id: "failure-recurring", outcome: "failure", score: 10, tool: true, errorSignature: "error-a" }),
      trajectory({ id: "failure-recurring-2", outcome: "failure", score: 10, tool: true, errorSignature: "error-a" }),
    ]);

    const first = createSekbShadowEvaluationReviewProtocol(artifact, { holdoutFraction: 0.5 });
    const second = createSekbShadowEvaluationReviewProtocol(artifact, { holdoutFraction: 0.5 });

    expect(first).toStrictEqual(second);
    expect(first.minimumIndependentReviewers).toBe(2);
    expect(first.holdoutPolicy).toMatchObject({
      developmentAndHoldoutAreSeparate: true,
      holdoutTuning: "forbidden",
    });
    expect(first.strata.some((stratum) => stratum.terminalOutcome === "failure" && stratum.errorRecurrence === "recurring")).toBe(true);
    expect(first.sample.map((item) => item.split)).toContain("development");
    expect(first.sample.map((item) => item.split)).toContain("holdout");

    const onePerStratum = buildArtifact([
      trajectory({ id: "small-success", outcome: "success", score: 90, tool: true }),
      trajectory({ id: "small-partial", outcome: "partial", score: 10, tool: false }),
      trajectory({ id: "small-failure", outcome: "failure", score: 10, tool: true, errorSignature: "error-b" }),
    ]);
    const fallback = createSekbShadowEvaluationReviewProtocol(onePerStratum, { holdoutFraction: 0.2 });
    expect(fallback.sample.map((item) => item.split)).toContain("development");
    expect(fallback.sample.map((item) => item.split)).toContain("holdout");
  });

  it("reports insufficient_data without fabricating a promotion decision", () => {
    const artifact = buildArtifact([
      trajectory({ id: "one", score: 90 }),
      trajectory({ id: "two", score: 10 }),
    ]);
    const protocol = createSekbShadowEvaluationReviewProtocol(artifact, { holdoutFraction: 0.5 });
    const report = buildSekbOfflineEvaluationReport({
      artifact,
      protocol,
      reviewers: ["reviewer-a", "reviewer-b"],
      reviews: completeReviews(protocol, artifact, () => "valuable"),
    });

    expect(report.status).toBe("insufficient_data");
    expect(report.promotion).toMatchObject({ status: "shadow_only" });
    expect(report.promotion.blockers).toContain("reviewed_samples_below_200");
    expect(report.unavailableMetrics).toEqual([
      { metric: "historical_suggestion_acceptance_rate", reason: "not_persisted" },
      { metric: "historical_suggestion_edit_distance", reason: "not_persisted" },
    ]);
  });

  it("reports unresolved reviewer disagreement honestly and does not invent a consensus label", () => {
    const artifact = buildArtifact([
      trajectory({ id: "one", score: 90 }),
      trajectory({ id: "two", score: 10 }),
    ]);
    const protocol = createSekbShadowEvaluationReviewProtocol(artifact, { holdoutFraction: 0.5 });
    const first = protocol.sample[0];
    const second = protocol.sample[1];
    if (!first || !second) {
      throw new Error("test fixture must contain two samples");
    }
    const report = buildSekbOfflineEvaluationReport({
      artifact,
      protocol,
      reviewers: ["reviewer-a", "reviewer-b"],
      reviews: [
        { trajectoryId: first.trajectoryId, reviewerId: "reviewer-a", split: first.split, label: "valuable" },
        { trajectoryId: first.trajectoryId, reviewerId: "reviewer-b", split: first.split, label: "not_valuable" },
        { trajectoryId: second.trajectoryId, reviewerId: "reviewer-a", split: second.split, label: "valuable" },
        { trajectoryId: second.trajectoryId, reviewerId: "reviewer-b", split: second.split, label: "valuable" },
      ],
    });

    expect(report.status).toBe("reviewer_disagreement");
    expect(report.labeling).toMatchObject({ unresolvedDisagreements: 1, consensusTrajectories: 1 });
    expect(report.promotion).toMatchObject({ status: "shadow_only" });
    expect(report.promotion.blockers).toContain("unresolved_reviewer_disagreement");
  });

  it("marks missing shadow fields as unavailable rather than computing a partial metric", () => {
    const trajectories = Array.from({ length: 200 }, (_, index) => trajectory({
      id: `missing-field-${index}`,
      score: index < 2 ? null : index % 2 === 0 ? 90 : 10,
    }));
    const artifact = buildArtifact(trajectories);
    const protocol = createSekbShadowEvaluationReviewProtocol(artifact);
    const report = buildSekbOfflineEvaluationReport({
      artifact,
      protocol,
      reviewers: ["reviewer-a", "reviewer-b"],
      reviews: completeReviews(protocol, artifact, (record) => {
        return record.shadow.score === null || record.shadow.score >= 50 ? "valuable" : "not_valuable";
      }),
    });

    expect(report.status).toBe("unavailable_metrics");
    expect(report.holdout.valuableTrajectoryRecall).toEqual({ status: "unavailable", reason: "missing_shadow_projection" });
    expect(report.promotion).toMatchObject({ status: "shadow_only" });
  });

  it("is deterministic and reports evaluable_for_promotion only when every offline gate passes", () => {
    const artifact = buildArtifact(Array.from({ length: 200 }, (_, index) => trajectory({
      id: `gate-${index}`,
      score: index % 2 === 0 ? 90 : 10,
    })));
    const protocol = createSekbShadowEvaluationReviewProtocol(artifact);
    const reviews = completeReviews(protocol, artifact, (record) => {
      return record.shadow.score !== null && record.shadow.score >= 50 ? "valuable" : "not_valuable";
    });
    const input = { artifact, protocol, reviewers: ["reviewer-a", "reviewer-b"] as const, reviews };
    const first = buildSekbOfflineEvaluationReport(input);
    const second = buildSekbOfflineEvaluationReport(input);

    expect(first).toStrictEqual(second);
    expect(first.status).toBe("evaluated");
    expect(first.agreement).toMatchObject({ status: "available", value: 1 });
    expect(first.holdout.valuableTrajectoryRecall).toMatchObject({ status: "available", rate: 1 });
    expect(first.holdout.projectedFalseDropRate).toMatchObject({ status: "available", rate: 0 });
    expect(first.promotion).toEqual({ status: "evaluable_for_promotion", blockers: [] });

    const root = tempRoot();
    const written = writeSekbOfflineEvaluationReportArtifact({ report: first, workspaceRoot: root });
    expect(written.artifactPath).toBe(path.join(root, "artifacts", "sekb-hermes-phase-a5", "shadow-evaluation-report.v1.json"));
    expect(JSON.stringify(written.report)).not.toContain("reviewer-a");
  });
});

function buildArtifact(trajectories: Trajectory[]): SekbShadowEvaluationExportArtifact {
  return buildSekbShadowEvaluationExport({ trajectories, pseudonymizationKey });
}

function completeReviews(
  protocol: SekbShadowEvaluationReviewProtocol,
  artifact: SekbShadowEvaluationExportArtifact,
  labelFor: (record: SekbShadowEvaluationExportArtifact["records"][number]) => SekbEvaluationLabel,
): SekbShadowEvaluationReview[] {
  const recordsById = new Map(artifact.records.map((record) => [record.trajectoryId, record]));
  return protocol.sample.flatMap((sample) => {
    const record = recordsById.get(sample.trajectoryId);
    if (!record) {
      throw new Error("review sample must resolve to an export record");
    }
    const label = labelFor(record);
    return [
      { trajectoryId: sample.trajectoryId, reviewerId: "reviewer-a", split: sample.split, label },
      { trajectoryId: sample.trajectoryId, reviewerId: "reviewer-b", split: sample.split, label },
    ];
  });
}

function trajectory(input: {
  id: string;
  outcome?: Trajectory["outcome"];
  score?: number | null;
  tool?: boolean;
  errorSignature?: string | null;
  secret?: string;
}): Trajectory {
  const outcome = input.outcome ?? "success";
  const secret = input.secret ?? "ordinary";
  const shadow = input.score === null
    ? null
    : evaluateSekbShadowV1({
        outcome,
        toolCallCount: input.tool === false ? 0 : 1,
        toolResultCount: input.tool === false ? 0 : 1,
        toolErrorCount: 0,
        errorSignaturePresent: Boolean(input.errorSignature),
        priorMatchingErrorSignatureCount: 0,
      });
  if (shadow && input.score !== undefined) {
    shadow.captureQuality.score = input.score;
    shadow.captureQuality.recommendation = input.score >= 50 ? "retain" : "review_low_signal";
  }
  return {
    trajectory_id: input.id,
    created_at: "2026-07-14T00:00:00.000Z",
    task_intent: `task intent ${secret}`,
    task_type: "sensitive/task-type",
    context_fingerprint: [`context-${secret}`],
    steps: input.tool === false ? [] : [
      { action: "tool.call", input: { value: `tool input ${secret}` }, output: { value: `tool output ${secret}` }, timestamp: "2026-07-14T00:00:01.000Z" },
      { action: "tool.result", input: { value: `tool input ${secret}` }, output: { isError: false, content: `tool output ${secret}` }, timestamp: "2026-07-14T00:00:02.000Z" },
    ],
    outcome,
    error_signature: input.errorSignature ?? null,
    cost: { tokens: 99, duration_seconds: 2, retries: 1 },
    distilled: false,
    distilled_into: [],
    expires_at: null,
    metadata: shadow ? { sekbShadow: shadow } : {},
  };
}

function tempRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "sekb-shadow-evaluation-"));
  tempRoots.push(root);
  return root;
}
