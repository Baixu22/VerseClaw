import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type {
  ObservabilityTraceIndexEntry,
  ObservabilityTraceIssue,
} from "../../shared/types/observability";
import {
  buildObservabilityProblemSnapshot,
  exportObservabilityProblemArtifacts,
} from "@electron/services/observability-problems";

const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

function makeIssue(overrides: Partial<ObservabilityTraceIssue> = {}): ObservabilityTraceIssue {
  return {
    id: "issue:trace-1:error-root-cause:node-1",
    traceId: "trace-1",
    nodeId: "node-1",
    severity: "error",
    category: "error-root-cause",
    title: "Runtime error",
    detail: "bounded diagnostic detail",
    evidence: ["tool:search", "status:error"],
    ...overrides,
  };
}

function makeEntry(overrides: Partial<ObservabilityTraceIndexEntry> = {}): ObservabilityTraceIndexEntry {
  const id = overrides.id ?? "trace-1";
  const issue = makeIssue({ traceId: id, ...(overrides.issues?.[0] ?? {}) });
  return {
    id,
    name: id,
    status: "error",
    durationMs: 100,
    startedAt: Date.parse("2026-10-10T00:00:00.000Z"),
    updatedAt: Date.parse("2026-10-10T00:00:00.000Z"),
    sourceStatus: "rehydrated",
    costUsd: 0,
    tokenCount: 0,
    spanCount: 0,
    errorCount: 1,
    toolCallCount: 1,
    artifactCount: 0,
    warningCount: 0,
    retryCount: 0,
    approvalCount: 0,
    issueCount: 1,
    issues: [issue],
    model: "gpt-test",
    agent: "main",
    runId: `run-${id}`,
    sessionKey: `session-${id}`,
    hasToolCalls: true,
    hasArtifacts: false,
    hasApproval: false,
    hasRetries: false,
    hasWarnings: false,
    correlation: { traceId: id, runId: `run-${id}`, sessionKey: `session-${id}`, filePaths: [] },
    ...overrides,
  };
}

function entryAt(id: string, observedAt: number, issueId = `issue:${id}:error-root-cause:node-1`): ObservabilityTraceIndexEntry {
  const issue = makeIssue({
    id: issueId,
    traceId: id,
    nodeId: `node-${id}`,
    evidence: ["tool:search", `trace:${id}`],
  });
  return makeEntry({
    id,
    startedAt: observedAt,
    updatedAt: observedAt,
    issues: [issue],
    issueCount: 1,
  });
}

describe("cross-run observability Problems", () => {
  it("aggregates a bounded seven-day signature once per trace, not once per diagnostic", () => {
    const now = Date.parse("2026-10-10T12:00:00.000Z");
    const sameTraceSecondDiagnostic = entryAt(
      "trace-1",
      now - 60 * 60 * 1000,
      "issue:trace-1:error-root-cause:node-2",
    );
    const snapshot = buildObservabilityProblemSnapshot([
      entryAt("trace-1", now - 61 * 60 * 1000),
      sameTraceSecondDiagnostic,
      entryAt("trace-2", now - 2 * 60 * 60 * 1000),
      entryAt("trace-3", now - 8 * 24 * 60 * 60 * 1000),
    ], { now, windowMs: 7 * 24 * 60 * 60 * 1000 });

    expect(snapshot.scannedIssues).toBe(3);
    expect(snapshot.problems).toHaveLength(1);
    expect(snapshot.problems[0]).toMatchObject({
      category: "error-root-cause",
      occurrenceCount: 2,
      distinctTraceCount: 2,
      state: "open",
    });
    expect(snapshot.problems[0]?.evidence.map((evidence) => evidence.traceId)).toEqual([
      "trace-1",
      "trace-1",
      "trace-2",
    ]);
  });

  it("promotes critical evidence without waiting for a repeat threshold", () => {
    const now = Date.parse("2026-10-10T12:00:00.000Z");
    const critical = entryAt("trace-critical", now - 1000);
    critical.issues = [makeIssue({
      id: "issue:trace-critical:error-root-cause:node-critical",
      traceId: "trace-critical",
      severity: "critical",
      category: "command-failed",
      title: "Data loss command failed",
    })];
    const snapshot = buildObservabilityProblemSnapshot([critical], { now });
    expect(snapshot.problems).toHaveLength(1);
    expect(snapshot.problems[0]).toMatchObject({ state: "open", severity: "critical", occurrenceCount: 1 });
  });

  it("exports idempotent manifest/evidence/resolution artifacts and preserves state transitions", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "observability-problems-"));
    tempRoots.push(root);
    const now = Date.parse("2026-10-10T12:00:00.000Z");
    const entries = [
      entryAt("trace-a", now - 60_000),
      entryAt("trace-b", now - 120_000),
    ];
    const first = await exportObservabilityProblemArtifacts({
      entries,
      outputDir: root,
      now,
      windowMs: 7 * 24 * 60 * 60 * 1000,
    });
    expect(first.artifacts).toHaveLength(1);
    const manifestPath = path.join(first.artifacts[0]!.directory, "manifest.json");
    const evidencePath = path.join(first.artifacts[0]!.directory, "evidence.json");
    const resolutionPath = path.join(first.artifacts[0]!.directory, "resolution.md");
    const firstManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    expect(firstManifest).toMatchObject({
      schema: "ObservabilityProblemManifest/v1",
      driven_by: "agent",
      actor: "codex-observability-agent",
      occurrenceCount: 2,
      distinctTraceCount: 2,
      state: "open",
    });
    expect(JSON.parse(await fs.readFile(evidencePath, "utf8")).evidence).toHaveLength(2);
    expect(await fs.readFile(resolutionPath, "utf8")).toContain("Driven by: `agent` / `codex-observability-agent`");

    await exportObservabilityProblemArtifacts({
      entries,
      outputDir: root,
      now,
      stateOverrides: { [first.artifacts[0]!.problemId]: { state: "closed", resolution: "Synthetic verification closed the problem." } },
    });
    const closedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    expect(closedManifest.state).toBe("closed");
    expect(closedManifest.occurrenceCount).toBe(2);

    const reappeared = [...entries, entryAt("trace-c", now + 1_000)];
    await exportObservabilityProblemArtifacts({ entries: reappeared, outputDir: root, now: now + 2_000 });
    const reopenedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    expect(reopenedManifest.state).toBe("open");
    expect(reopenedManifest.occurrenceCount).toBe(3);
    expect(reopenedManifest.timeline.some((entry: { event: string }) => entry.event === "observed")).toBe(true);
  });
});