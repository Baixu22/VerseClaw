import { describe, expect, it } from "vitest";
import {
  createExternalProvenance,
  createTrustedProvenance,
} from "../../../../shared/security/content-provenance.js";
import { resolveMessageSecretReadPolicy } from "./message-secret-read-policy.js";

const RECEIVED_AT = "2026-08-21T00:00:00.000Z";
const external = createExternalProvenance({
  sourceKind: "channel",
  sourceId: "channel:telegram:message-1",
  receivedAt: RECEIVED_AT,
});

function evaluate(overrides: Record<string, unknown> = {}) {
  return resolveMessageSecretReadPolicy({
    provenanceContext: { provenance: external },
    currentChannel: "telegram",
    currentAccountId: "default",
    requestedChannel: "telegram",
    requestedAccountId: "default",
    cfg: {},
    ...overrides,
  });
}

describe("message secret-read provenance policy", () => {
  it.each([
    ["untrusted", external, "present"],
    ["derived-untrusted", { ...external, trustLevel: "derived-untrusted" as const }, "present"],
    ["missing", undefined, "missing"],
    ["invalid", { sourceKind: "web" }, "missing"],
  ])("keeps a bound channel/account usable for %s provenance", (_label, provenance, status) => {
    const result = evaluate({ provenanceContext: { provenance } });
    expect(result).toMatchObject({ allowed: true, restricted: false });
    expect(result.status.status).toBe(status);
  });

  it.each([
    ["untrusted", external],
    ["derived-untrusted", { ...external, trustLevel: "derived-untrusted" as const }],
    ["missing", undefined],
    ["invalid", { ...external, trustLevel: "trusted" }],
  ])("denies an implicit provider redirect for %s provenance", (_label, provenance) => {
    const result = evaluate({
      provenanceContext: { provenance },
      requestedChannel: "slack",
    });
    expect(result).toMatchObject({ allowed: false, restricted: true });
    expect(result.reason).not.toContain("CANARY_SECRET_VALUE");
  });

  it("denies an implicit account redirect", () => {
    expect(evaluate({ requestedAccountId: "secondary" })).toMatchObject({
      allowed: false,
      restricted: true,
    });
  });

  it("fails closed when selected paths span an unknown account", () => {
    expect(
      evaluate({
        currentAccountId: undefined,
        requestedAccountId: undefined,
        selectedTargets: [
          {
            path: "channels.telegram.accounts.secondary.botToken",
            pathSegments: ["channels", "telegram", "accounts", "secondary", "botToken"],
            accountId: "secondary",
          },
        ],
      }),
    ).toMatchObject({ allowed: false, restricted: true });
  });

  it("keeps explicit operator cross-context settings effective", () => {
    expect(
      evaluate({
        requestedAccountId: "secondary",
        cfg: { tools: { message: { crossContext: { allowWithinProvider: true } } } },
      }),
    ).toMatchObject({ allowed: true, restricted: true });
    expect(
      evaluate({
        requestedChannel: "slack",
        cfg: { tools: { message: { crossContext: { allowAcrossProviders: true } } } },
      }),
    ).toMatchObject({ allowed: true, restricted: true });
  });

  it("does not constrain trusted system provenance", () => {
    expect(
      evaluate({
        provenanceContext: {
          provenance: createTrustedProvenance({
            sourceKind: "system-generated",
            sourceId: "system:job",
            receivedAt: RECEIVED_AT,
          }),
        },
        requestedChannel: "slack",
      }),
    ).toMatchObject({ allowed: true, restricted: false });
  });

  it("does not constrain direct operator provenance", () => {
    expect(
      evaluate({
        provenanceContext: {
          provenance: createTrustedProvenance({
            sourceKind: "user-direct",
            sourceId: "user:operator",
            receivedAt: RECEIVED_AT,
          }),
        },
        requestedAccountId: "secondary",
      }),
    ).toMatchObject({ allowed: true, restricted: false });
  });
});
