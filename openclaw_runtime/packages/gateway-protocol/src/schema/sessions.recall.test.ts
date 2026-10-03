import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  CompressionArtifactSchema,
  SessionsCompressionArtifactParamsSchema,
  SessionsCompressionArtifactResultSchema,
  SessionsExpandSelectorParamsSchema,
  SessionsExpandSelectorResultSchema,
  SessionsRecallOriginalParamsSchema,
  SessionsRecallOriginalResultSchema,
  SessionsRecoveryContextParamsSchema,
  SessionsRecoveryContextResultSchema,
} from "./sessions.js";

const cases = [
  {
    name: "recall original params",
    schema: SessionsRecallOriginalParamsSchema,
    value: {
      key: "agent:main",
      archiveHandle: { uri: "archive://one", checksum: "sha256:one", byteLength: 1 },
    },
  },
  {
    name: "recall original result",
    schema: SessionsRecallOriginalResultSchema,
    value: { ok: true, diagnostics: [] },
  },
  {
    name: "compression artifact params",
    schema: SessionsCompressionArtifactParamsSchema,
    value: { key: "agent:main" },
  },
  {
    name: "compression artifact result",
    schema: SessionsCompressionArtifactResultSchema,
    value: { ok: true, key: "agent:main", warnings: [] },
  },
  {
    name: "recovery context params",
    schema: SessionsRecoveryContextParamsSchema,
    value: { key: "agent:main" },
  },
  {
    name: "recovery context result",
    schema: SessionsRecoveryContextResultSchema,
    value: {
      ok: true,
      key: "agent:main",
      context: "",
      projectionTokens: 0,
      warnings: [],
    },
  },
  {
    name: "expand selector params",
    schema: SessionsExpandSelectorParamsSchema,
    value: { key: "agent:main", resourceId: "resource-1", selector: "section" },
  },
  {
    name: "expand selector result",
    schema: SessionsExpandSelectorResultSchema,
    value: { ok: true, diagnostics: [] },
  },
] as const;

describe("session recall and compression schemas", () => {
  it.each(cases)("accepts the declared minimal $name payload", ({ schema, value }) => {
    expect(Value.Check(schema, value)).toBe(true);
  });

  it.each(cases)("rejects undeclared properties for $name", ({ schema, value }) => {
    expect(Value.Check(schema, { ...value, undeclared: true })).toBe(false);
  });
});

const minimalArtifact = {
  schemaVersion: 1,
  objective: "Compression artifact fixture",
  constraints: [],
  currentState: "Fixture state",
  done: [],
  inProgress: [],
  blocked: [],
  decisions: [],
  filesTouched: [],
  testsRun: [],
  failedAttempts: [],
  deviations: [],
  nextAction: "Run schema checks",
  reviewNeeded: [],
  evidenceRefs: [],
  unverifiedClaims: [],
  quality: {
    score: 1,
    level: "high",
    fieldCoverage: 1,
    evidenceCoverage: 1,
    artifactTokens: 10,
    projectionTokens: 10,
    warnings: [],
  },
} as const;

describe("compression artifact semantic atom schema", () => {
  it("accepts a legacy v1 artifact without semanticAtoms", () => {
    expect(Value.Check(CompressionArtifactSchema, minimalArtifact)).toBe(true);
  });

  it("accepts legal semanticAtoms and rejects undeclared atom fields", () => {
    const atom = {
      id: "atom-goal-a",
      type: "goal",
      canonicalIdentity: "goal:fixture",
      severity: "critical",
      confidence: 0.95,
      scope: "session",
      polarity: "positive",
      status: "verified",
      text: "A bounded atom projection.",
      evidenceRefs: [{ type: "session", ref: "message:1" }],
    };
    expect(Value.Check(CompressionArtifactSchema, {
      ...minimalArtifact,
      semanticAtoms: [atom],
    })).toBe(true);
    expect(Value.Check(CompressionArtifactSchema, {
      ...minimalArtifact,
      semanticAtoms: [{ ...atom, undeclared: true }],
    })).toBe(false);
  });

  it("rejects critical verified atoms without evidence and invalid atom fields", () => {
    const criticalNoEvidence = {
      id: "atom-bad",
      type: "decision",
      canonicalIdentity: "decision:bad",
      severity: "critical",
      confidence: 0.9,
      scope: "task",
      polarity: "neutral",
      status: "verified",
      text: "No evidence.",
      evidenceRefs: [],
    };
    expect(Value.Check(CompressionArtifactSchema, {
      ...minimalArtifact,
      semanticAtoms: [criticalNoEvidence],
    })).toBe(false);
    expect(Value.Check(CompressionArtifactSchema, {
      ...minimalArtifact,
      semanticAtoms: [{ ...criticalNoEvidence, type: "unsupported", evidenceRefs: [{ type: "session", ref: "message:1" }] }],
    })).toBe(false);
  });
});
