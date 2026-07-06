import { describe, expect, it } from "vitest";
import {
  LCP_KIND_METADATA,
  LOCAL_CONTROL_PLANE_REPORT_KINDS,
  MAX_LCP_KINDS,
  type LocalControlPlaneReportKind,
  validateLcpKindRegistration,
} from "../../openclaw_runtime/src/local-control-plane/index.js";

/**
 * Stage 3, criterion 3.11: LCP kind count ≤ 10.
 *
 * The LCP kind registry caps the number of report kinds at MAX_LCP_KINDS (10).
 * Attempting to register an 11th kind must be rejected.
 */
describe("Stage 3 / 3.11: LCP kind count ≤ 10", () => {
  it("MAX_LCP_KINDS is 10", () => {
    expect(MAX_LCP_KINDS).toBe(10);
  });

  it("current kind count is 5 (under the cap)", () => {
    expect(LOCAL_CONTROL_PLANE_REPORT_KINDS.length).toBe(5);
    expect(LOCAL_CONTROL_PLANE_REPORT_KINDS.length).toBeLessThanOrEqual(MAX_LCP_KINDS);
  });

  it("rejects registration when current count >= cap (11th kind)", () => {
    // Simulate 10 existing kinds → 11th must be rejected.
    const error = validateLcpKindRegistration(10);
    expect(error).not.toBeNull();
    expect(error).toContain("Cannot register new LCP kind");
    expect(error).toContain("10");
    expect(error).toContain("10");
  });

  it("allows registration when current count < cap", () => {
    // 5 existing kinds → 6th is allowed.
    const error = validateLcpKindRegistration(5);
    expect(error).toBeNull();
  });

  it("allows registration at count 0 (first kind)", () => {
    expect(validateLcpKindRegistration(0)).toBeNull();
  });

  it("allows registration at count 9 (10th kind, the cap)", () => {
    expect(validateLcpKindRegistration(9)).toBeNull();
  });

  it("rejects registration at count 10 (11th kind, exceeds cap)", () => {
    const error = validateLcpKindRegistration(10);
    expect(error).not.toBeNull();
  });

  it("rejects registration well above cap", () => {
    const error = validateLcpKindRegistration(50);
    expect(error).not.toBeNull();
    expect(error).toContain("50");
  });
});

/**
 * Stage 3, criterion 3.12: LCP kind decay policy enforced.
 *
 * Every LCP report kind MUST declare a decay policy (retentionMs +
 * postPromotionSamplingRate). This is enforced at compile time via
 * `satisfies Record<LocalControlPlaneReportKind, LcpKindDecayPolicy>`,
 * and verified at runtime here by checking every kind has a metadata entry.
 */
describe("Stage 3 / 3.12: LCP kind decay policy enforced", () => {
  it("every kind in LOCAL_CONTROL_PLANE_REPORT_KINDS has a decay policy entry", () => {
    for (const kind of LOCAL_CONTROL_PLANE_REPORT_KINDS) {
      const metadata = LCP_KIND_METADATA[kind];
      expect(metadata, `kind "${kind}" must have a metadata entry`).toBeDefined();
      expect(metadata.retentionMs, `kind "${kind}" retentionMs must be a positive number`).toBeGreaterThan(0);
      expect(metadata.postPromotionSamplingRate, `kind "${kind}" postPromotionSamplingRate must be in [0,1]`).toBeGreaterThanOrEqual(0);
      expect(metadata.postPromotionSamplingRate, `kind "${kind}" postPromotionSamplingRate must be in [0,1]`).toBeLessThanOrEqual(1);
    }
  });

  it("LCP_KIND_METADATA has exactly the same keys as LOCAL_CONTROL_PLANE_REPORT_KINDS", () => {
    const metadataKeys = Object.keys(LCP_KIND_METADATA).sort();
    const kindKeys = [...LOCAL_CONTROL_PLANE_REPORT_KINDS].sort();
    expect(metadataKeys).toEqual(kindKeys);
  });

  it("context kind has a 7-day retention", () => {
    expect(LCP_KIND_METADATA.context.retentionMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("evidence kind has a 30-day retention (longer than others)", () => {
    expect(LCP_KIND_METADATA.evidence.retentionMs).toBe(30 * 24 * 60 * 60 * 1000);
    for (const kind of LOCAL_CONTROL_PLANE_REPORT_KINDS) {
      if (kind === "evidence") continue;
      expect(LCP_KIND_METADATA.evidence.retentionMs).toBeGreaterThan(
        LCP_KIND_METADATA[kind].retentionMs,
      );
    }
  });

  it("all kinds have postPromotionSamplingRate of 1.0 (full sampling post-promotion)", () => {
    for (const kind of LOCAL_CONTROL_PLANE_REPORT_KINDS) {
      expect(LCP_KIND_METADATA[kind].postPromotionSamplingRate).toBe(1.0);
    }
  });

  it("a hypothetical kind without a decay policy would be a compile error (satisfies)", () => {
    // This is a compile-time check via `satisfies Record<...>`. At runtime,
    // we verify the invariant: the metadata object's key set exactly matches
    // the kind tuple. If a kind were added to the tuple without a metadata
    // entry, this test would fail.
    const allKinds: LocalControlPlaneReportKind[] = [...LOCAL_CONTROL_PLANE_REPORT_KINDS];
    const missingKinds = allKinds.filter((k) => !(k in LCP_KIND_METADATA));
    expect(missingKinds, "no kind may be missing a decay policy").toEqual([]);
  });
});
