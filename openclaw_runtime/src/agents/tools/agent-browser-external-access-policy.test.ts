import { describe, expect, it } from "vitest";
import {
  createExternalProvenance,
  createTrustedProvenance,
  deriveProvenance,
} from "../../../../shared/security/content-provenance.js";
import {
  resolveAgentBrowserExternalAccessPolicy,
  resolveAgentBrowserSessionEffectPolicy,
  shouldPreflightAgentBrowserSessionEffect,
} from "./agent-browser-external-access-policy.js";

const RECEIVED_AT = "2026-08-21T00:00:00.000Z";
const external = createExternalProvenance({
  sourceKind: "web",
  sourceId: "web:article-1",
  receivedAt: RECEIVED_AT,
});
const derivedExternal = deriveProvenance({
  sourceKind: "tool-result",
  sourceId: "tool-result:web-fetch-1",
  receivedAt: RECEIVED_AT,
  parents: [external],
});

function evaluate(overrides: Record<string, unknown> = {}) {
  return resolveAgentBrowserExternalAccessPolicy({
    provenanceContext: { provenance: external },
    connectionMode: "auto-connect",
    ...overrides,
  });
}

describe("agent browser external-access provenance policy", () => {
  it.each([
    ["untrusted", external, "present"],
    ["derived-untrusted", derivedExternal, "present"],
    ["missing", undefined, "missing"],
    ["invalid", { ...external, trustLevel: "trusted" }, "missing"],
  ])("denies every external connection mode for %s provenance", (_label, provenance, status) => {
    for (const connectionMode of ["auto-connect", "cdp", "external-profile"]) {
      const result = evaluate({ provenanceContext: { provenance }, connectionMode });
      expect(result).toMatchObject({ allowed: false, restricted: true });
      expect(result.status.status).toBe(status);
    }
  });

  it("keeps managed and omitted connection modes available for external provenance", () => {
    expect(evaluate({ connectionMode: "managed" })).toMatchObject({
      allowed: true,
      restricted: false,
    });
    expect(evaluate({ connectionMode: undefined })).toMatchObject({
      allowed: true,
      restricted: false,
    });
  });

  it("keeps external modes available for trusted system and direct operator provenance", () => {
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
          connectionMode: "external-profile",
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

describe("agent browser existing-session effect policy", () => {
  it.each([
    ["untrusted", external],
    ["derived-untrusted", derivedExternal],
    ["missing", undefined],
    ["invalid", { ...external, trustLevel: "trusted" }],
  ])("requires a Main status preflight for %s provenance", (_label, provenance) => {
    expect(shouldPreflightAgentBrowserSessionEffect({ provenance })).toBe(true);
    expect(
      resolveAgentBrowserSessionEffectPolicy({
        provenanceContext: { provenance },
        sessionConnectionMode: "managed",
        action: "click",
      }),
    ).toMatchObject({ allowed: true, restricted: true });
  });

  it.each(["auto-connect", "cdp", "external-profile", undefined, "invalid-mode"])(
    "denies risky provenance for session mode %s",
    (sessionConnectionMode) => {
      expect(
        resolveAgentBrowserSessionEffectPolicy({
          provenanceContext: { provenance: external },
          sessionConnectionMode,
          action: "type",
        }),
      ).toMatchObject({ allowed: false, restricted: true });
    },
  );

  it("keeps trusted system and direct operator clicks unchanged", () => {
    for (const sourceKind of ["system-generated", "user-direct"] as const) {
      const provenanceContext = {
        provenance: createTrustedProvenance({
          sourceKind,
          sourceId: `${sourceKind}:click`,
          receivedAt: RECEIVED_AT,
        }),
      };
      expect(shouldPreflightAgentBrowserSessionEffect(provenanceContext)).toBe(false);
      expect(
        resolveAgentBrowserSessionEffectPolicy({
          provenanceContext,
          sessionConnectionMode: "external-profile",
          action: "click",
        }),
      ).toMatchObject({ allowed: true, restricted: false });
    }
  });
});
