import { describe, expect, it } from "vitest";
import {
  GROUNDING_METADATA_STRING_LIMIT,
  GROUNDING_REF_AUTHORITY,
  GROUNDING_REF_KINDS,
  GROUNDING_REF_LABEL_LIMIT,
  GROUNDING_REF_REF_LIMIT,
  GROUNDING_REF_SUMMARY_LIMIT,
  GROUNDING_REF_TRUSTS,
  buildGroundingQueryFixture,
  buildGroundingRefFixture,
  buildGroundingResultFixture,
  isGroundingQuery,
  isGroundingRef,
  isGroundingRefKind,
  isGroundingRefTrust,
  isGroundingResult,
  sanitizeGroundingQuery,
  sanitizeGroundingRef,
  type GroundingQuery,
  type GroundingRef,
  type RuntimeCoreJsonObject,
} from "../../openclaw_runtime/src/runtime-core";

describe("runtime grounding contracts", () => {
  it("defines the readonly derived grounding taxonomy", () => {
    expect(GROUNDING_REF_KINDS).toEqual([
      "evidence",
      "file",
      "test",
      "tool",
      "trace",
      "source",
      "checkpoint",
      "event",
      "event_log",
      "verifier_report",
      "verifier_finding",
      "memory",
      "symbol",
      "patch",
    ]);
    expect(GROUNDING_REF_TRUSTS).toEqual([
      "verified",
      "supplied",
      "projected",
      "untrusted",
    ]);
    expect(GROUNDING_REF_AUTHORITY).toBe("none");
    expect(GROUNDING_REF_KINDS.every(isGroundingRefKind)).toBe(true);
    expect(isGroundingRefKind("human")).toBe(false);
  });

  it("validates valid and invalid GroundingRef shapes", () => {
    const ref = buildGroundingRefFixture({
      metadata: { safe: true, nested: { count: 1 } },
    });

    expect(isGroundingRef(ref)).toBe(true);
    expect(isGroundingRef({ ...ref, kind: "human" })).toBe(false);
    expect(isGroundingRef({ ...ref, id: "" })).toBe(false);
    expect(isGroundingRef({ ...ref, canonicalKey: "" })).toBe(false);
    expect(isGroundingRef({ ...ref, ref: "" })).toBe(false);
    expect(isGroundingRef({ ...ref, authority: "runtime" })).toBe(false);
    expect(isGroundingRef({ ...ref, rawRetained: true })).toBe(false);
    expect(isGroundingRef({
      ...ref,
      projection: { ...ref.projection, derived: false },
    })).toBe(false);
    expect(isGroundingRef({
      ...ref,
      projection: { ...ref.projection, rawRetained: true },
    })).toBe(false);
    expect(isGroundingRef({
      ...ref,
      sanitization: { ...ref.sanitization, sanitized: false },
    })).toBe(false);
    expect(isGroundingRef({
      ...ref,
      sanitization: { ...ref.sanitization, rawRetained: true },
    })).toBe(false);
  });

  it("keeps every grounding ref non-authoritative across all kinds", () => {
    const refs = GROUNDING_REF_KINDS.map((kind) =>
      buildGroundingRefFixture({
        kind,
        id: `grounding_${kind}`,
        canonicalKey: `${kind}:fixture`,
        ref: `${kind}:fixture`,
      })
    );

    expect(refs.every(isGroundingRef)).toBe(true);
    expect(refs.map((ref) => ref.authority)).toEqual(
      GROUNDING_REF_KINDS.map(() => "none"),
    );
    expect(refs.map((ref) => ref.rawRetained)).toEqual(
      GROUNDING_REF_KINDS.map(() => false),
    );
  });

  it("allows only the accepted trust enum", () => {
    expect(GROUNDING_REF_TRUSTS.every(isGroundingRefTrust)).toBe(true);
    expect(isGroundingRefTrust("trusted")).toBe(false);

    for (const trust of GROUNDING_REF_TRUSTS) {
      expect(isGroundingRef(buildGroundingRefFixture({ trust }))).toBe(true);
    }

    expect(isGroundingRef({
      ...buildGroundingRefFixture(),
      trust: "trusted",
    })).toBe(false);
  });

  it("normalizes projection and sanitization metadata to derived summary-only markers", () => {
    const dirty = {
      ...buildGroundingRefFixture(),
      authority: "policy",
      rawRetained: true,
      projection: {
        derived: false,
        sourceSurface: "surface",
        sourceField: "field",
        transform: "identity",
        lossy: true,
        rawRetained: true,
      },
      sanitization: {
        sanitized: false,
        rawRetained: true,
      },
    } as unknown as GroundingRef;

    const sanitized = sanitizeGroundingRef(dirty);

    expect(sanitized.authority).toBe("none");
    expect(sanitized.rawRetained).toBe(false);
    expect(sanitized.projection).toMatchObject({
      derived: true,
      rawRetained: false,
    });
    expect(sanitized.sanitization).toMatchObject({
      sanitized: true,
      rawRetained: false,
    });
    expect(isGroundingRef(sanitized)).toBe(true);
  });

  it("bounds ref, label, summary, and metadata fixture output", () => {
    const metadata = {
      longValue: "m".repeat(GROUNDING_METADATA_STRING_LIMIT + 64),
      nested: { ok: true },
      omitted: undefined,
    } as unknown as RuntimeCoreJsonObject;

    const ref = buildGroundingRefFixture({
      ref: "r".repeat(GROUNDING_REF_REF_LIMIT + 64),
      label: "l".repeat(GROUNDING_REF_LABEL_LIMIT + 64),
      summary: "s".repeat(GROUNDING_REF_SUMMARY_LIMIT + 64),
      metadata,
    });

    expect(ref.ref.length).toBeLessThanOrEqual(GROUNDING_REF_REF_LIMIT);
    expect(ref.label?.length).toBeLessThanOrEqual(GROUNDING_REF_LABEL_LIMIT);
    expect(ref.summary?.length).toBeLessThanOrEqual(GROUNDING_REF_SUMMARY_LIMIT);
    expect(String(ref.metadata?.longValue).length).toBeLessThanOrEqual(
      GROUNDING_METADATA_STRING_LIMIT,
    );
    expect(ref.metadata).not.toHaveProperty("omitted");
    expect(isGroundingRef(ref)).toBe(true);
  });

  it("allows GroundingQuery includeRaw only when false or undefined", () => {
    const query = buildGroundingQueryFixture({ includeRaw: false });
    const noIncludeRaw = { ...query };
    delete noIncludeRaw.includeRaw;

    expect(isGroundingQuery(query)).toBe(true);
    expect(isGroundingQuery(noIncludeRaw)).toBe(true);
    expect(isGroundingQuery({ ...query, includeRaw: true })).toBe(false);
    expect(isGroundingQuery({ ...query, includeRaw: null })).toBe(false);

    const sanitized = sanitizeGroundingQuery({
      ...query,
      includeRaw: true,
    } as unknown as GroundingQuery);
    expect(sanitized.includeRaw).toBe(false);
    expect(isGroundingQuery(sanitized)).toBe(true);
  });

  it("validates bounded readonly GroundingResult shapes", () => {
    const result = buildGroundingResultFixture();

    expect(isGroundingResult(result)).toBe(true);
    expect(result.readonly).toBe(true);
    expect(result.refs[0]?.authority).toBe("none");
    expect(result.items[0]?.authority).toBe("none");
    expect(result.estimatedTokens).toBeLessThanOrEqual(result.tokenBudget);
    expect(isGroundingResult({ ...result, readonly: false })).toBe(false);
  });

  it("rejects non-JSON metadata values", () => {
    const ref = buildGroundingRefFixture();
    const query = buildGroundingQueryFixture();
    const result = buildGroundingResultFixture();

    expect(isGroundingRef({
      ...ref,
      metadata: { createdAt: new Date(0) },
    })).toBe(false);
    expect(isGroundingRef({
      ...ref,
      metadata: { missing: undefined },
    })).toBe(false);
    expect(isGroundingRef({
      ...ref,
      evidenceRef: {
        type: "file",
        ref: "src/example.ts",
        metadata: { createdAt: new Date(0) },
      },
    })).toBe(false);
    expect(isGroundingQuery({
      ...query,
      metadata: { map: new Map() },
    })).toBe(false);
    expect(isGroundingResult({
      ...result,
      metadata: { unsupported: () => "nope" },
    })).toBe(false);
  });
});
