import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
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
