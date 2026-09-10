import { describe, expect, it } from "vitest";
import {
  createExternalProvenance,
  createTrustedProvenance,
} from "../../../../shared/security/content-provenance.js";
import { resolveProviderCredentialUsePolicy } from "./provider-credential-use-policy.js";

const RECEIVED_AT = "2026-08-21T00:00:00.000Z";
const external = createExternalProvenance({
  sourceKind: "web",
  sourceId: "web:article-1",
  receivedAt: RECEIVED_AT,
});

function evaluate(overrides: Record<string, unknown> = {}) {
  return resolveProviderCredentialUsePolicy({
    provenanceContext: { provenance: external },
    hasExplicitModelOverride: true,
    requestedProvider: "other-provider",
    boundProviderIds: ["openai"],
    ...overrides,
  });
}

describe("provider credential-use provenance policy", () => {
  it.each([
    ["untrusted", external, "present"],
    ["derived-untrusted", { ...external, trustLevel: "derived-untrusted" as const }, "present"],
    ["missing", undefined, "missing"],
    ["invalid", { ...external, trustLevel: "trusted" }, "missing"],
  ])("denies an unbound provider override for %s provenance", (_label, provenance, status) => {
    const result = evaluate({ provenanceContext: { provenance } });
    expect(result).toMatchObject({ allowed: false, restricted: true });
    expect(result.status.status).toBe(status);
    expect(result.reason).not.toContain("credential-value");
  });

  it("allows same-provider and explicitly configured fallback overrides", () => {
    expect(evaluate({ requestedProvider: "OPENAI" })).toMatchObject({
      allowed: true,
      restricted: false,
    });
    expect(
      evaluate({
        requestedProvider: "configured-fallback",
        boundProviderIds: ["openai", "configured-fallback"],
      }),
    ).toMatchObject({ allowed: true, restricted: false });
  });

  it("fails closed when an explicit override has no resolvable provider", () => {
    expect(evaluate({ requestedProvider: undefined })).toMatchObject({
      allowed: false,
      restricted: true,
    });
  });

  it("does not constrain calls without an explicit model override", () => {
    expect(evaluate({ hasExplicitModelOverride: false })).toMatchObject({
      allowed: true,
      restricted: false,
    });
  });

  it("does not constrain trusted system or direct operator provenance", () => {
    for (const sourceKind of ["system-generated", "user-direct"] as const) {
      expect(
        evaluate({
          provenanceContext: {
            provenance: createTrustedProvenance({
              sourceKind,
              sourceId: `${sourceKind}:request`,
              receivedAt: RECEIVED_AT,
            }),
          },
        }),
      ).toMatchObject({ allowed: true, restricted: false });
    }
  });

  it("does not treat an ordinary trust field as an operator boundary", () => {
    expect(
      evaluate({
        provenanceContext: {
          provenance: { ...external, trustLevel: "trusted", operatorApproved: true },
        },
      }),
    ).toMatchObject({
      allowed: false,
      restricted: true,
      status: { status: "missing", reason: "invalid" },
    });
  });
});
