import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createExternalProvenance,
  createTrustedProvenance,
  deriveProvenance,
} from "../../../shared/security/content-provenance.js";
import { resolveWorkspaceExternalWritePolicy } from "./workspace-external-write-provenance-policy.js";

const workspaceRoot = path.resolve("workspace-provenance-fixture");
const insideTarget = path.join(workspaceRoot, "src", "index.ts");
const outsideTarget = path.resolve(workspaceRoot, "..", "outside.txt");
const external = createExternalProvenance({
  sourceKind: "web",
  sourceId: "web:external-write-policy",
  receivedAt: "2026-08-21T00:00:00.000Z",
});
const derivedExternal = deriveProvenance({
  sourceKind: "tool-result",
  sourceId: "tool-result:external-write-policy",
  receivedAt: "2026-08-21T00:00:00.000Z",
  parents: [external],
});

function evaluate(
  overrides: Partial<Parameters<typeof resolveWorkspaceExternalWritePolicy>[0]> = {},
) {
  return resolveWorkspaceExternalWritePolicy({
    action: "write",
    provenanceContext: { provenance: external },
    workspaceRoot,
    targetPaths: [outsideTarget],
    scopeKnown: true,
    ...overrides,
  });
}

describe("workspace external-write provenance policy", () => {
  it.each([
    ["untrusted", external, "present"],
    ["derived-untrusted", derivedExternal, "present"],
    ["missing", undefined, "missing"],
    ["invalid", { trustLevel: "trusted" }, "missing"],
  ])("denies an external target for %s provenance", (_label, provenance, status) => {
    const result = evaluate({ provenanceContext: { provenance } });
    expect(result).toMatchObject({
      allowed: false,
      restricted: true,
      externalTarget: true,
      status: { status },
    });
    expect(result.reason).not.toContain(outsideTarget);
  });

  it("keeps in-workspace coding available for external and unknown provenance", () => {
    expect(evaluate({ targetPaths: [insideTarget] })).toMatchObject({
      allowed: true,
      restricted: true,
      externalTarget: false,
    });
    expect(
      evaluate({ provenanceContext: { provenance: undefined }, targetPaths: [insideTarget] }),
    ).toMatchObject({ allowed: true, restricted: true, externalTarget: false });
  });

  it("keeps trusted system and direct operator external targets unchanged", () => {
    for (const sourceKind of ["system-generated", "user-direct"] as const) {
      expect(
        evaluate({
          provenanceContext: {
            provenance: createTrustedProvenance({
              sourceKind,
              sourceId: `${sourceKind}:external-write-policy`,
              receivedAt: "2026-08-21T00:00:00.000Z",
            }),
          },
        }),
      ).toMatchObject({ allowed: true, restricted: false, externalTarget: true });
    }
  });

  it("fails closed when external or unknown input has no determinable target", () => {
    expect(evaluate({ targetPaths: [], scopeKnown: false })).toMatchObject({
      allowed: false,
      restricted: true,
      externalTarget: false,
    });
    expect(
      evaluate({
        provenanceContext: {
          provenance: createTrustedProvenance({
            sourceKind: "user-direct",
            sourceId: "operator:path-validation",
            receivedAt: "2026-08-21T00:00:00.000Z",
          }),
        },
        targetPaths: [],
        scopeKnown: false,
      }),
    ).toMatchObject({ allowed: true, restricted: false });
    expect(evaluate({ targetPaths: [], scopeKnown: true })).toMatchObject({
      allowed: false,
      restricted: true,
    });
  });

  it("denies a mixed patch target set when any destination is external", () => {
    expect(
      resolveWorkspaceExternalWritePolicy({
        action: "apply_patch",
        provenanceContext: { provenance: derivedExternal },
        workspaceRoot,
        targetPaths: [insideTarget, outsideTarget],
        scopeKnown: true,
      }),
    ).toMatchObject({ allowed: false, externalTarget: true });
  });
});
