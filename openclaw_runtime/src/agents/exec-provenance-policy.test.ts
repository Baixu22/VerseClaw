import { describe, expect, it } from "vitest";
import {
  createExternalProvenance,
  createTrustedProvenance,
} from "../../../shared/security/content-provenance.js";
import { resolveCommandExecProvenancePolicy } from "./exec-provenance-policy.js";
import { toContentProvenance } from "../sessions/input-provenance.js";

const RECEIVED_AT = "2026-08-20T00:00:00.000Z";

const external = createExternalProvenance({
  sourceKind: "web",
  sourceId: "web:article-1",
  receivedAt: RECEIVED_AT,
});

describe("command-exec provenance policy", () => {
  it.each([
    ["untrusted", external, true],
    [
      "derived-untrusted",
      {
        ...external,
        trustLevel: "derived-untrusted" as const,
      },
      true,
    ],
    ["missing", undefined, false],
    ["invalid", { sourceKind: "web" }, false],
  ])("constrains %s provenance before an implicit full/off bypass", (_label, provenance, present) => {
    const result = resolveCommandExecProvenancePolicy({
      provenance,
      security: "full",
      ask: "off",
      explicitFullAccess: false,
    });

    expect(result).toMatchObject({
      security: "allowlist",
      ask: "on-miss",
      constrained: true,
    });
    expect(result.status.status === "present").toBe(present);
  });

  it("keeps an already bounded allowlist policy usable without adding approval", () => {
    const result = resolveCommandExecProvenancePolicy({
      provenance: external,
      security: "allowlist",
      ask: "on-miss",
      explicitFullAccess: false,
    });
    expect(result).toMatchObject({
      security: "allowlist",
      ask: "on-miss",
      constrained: true,
    });
  });

  it("does not rewrite an explicit operator fullAccess decision", () => {
    const result = resolveCommandExecProvenancePolicy({
      provenance: undefined,
      security: "full",
      ask: "off",
      explicitFullAccess: true,
    });
    expect(result).toMatchObject({
      security: "full",
      ask: "off",
      constrained: false,
    });
  });

  it("keeps an explicit full security selection even when ask is bounded separately", () => {
    const result = resolveCommandExecProvenancePolicy({
      provenance: external,
      security: "full",
      ask: "on-miss",
      explicitFullAccess: true,
    });
    expect(result).toMatchObject({ security: "full", ask: "on-miss", constrained: false });
  });

  it("leaves trusted system provenance unchanged", () => {
    const result = resolveCommandExecProvenancePolicy({
      provenance: createTrustedProvenance({
        sourceKind: "system-generated",
        sourceId: "system:job",
        receivedAt: RECEIVED_AT,
      }),
      security: "full",
      ask: "off",
      explicitFullAccess: false,
    });
    expect(result).toMatchObject({
      security: "full",
      ask: "off",
      constrained: false,
    });
  });

  it("maps real inbound and inter-session run metadata without trusting ordinary fields", () => {
    expect(
      toContentProvenance(
        {
          kind: "external_user",
          sourceChannel: "telegram",
          sourceTool: "gateway.message",
        },
        RECEIVED_AT,
      ),
    ).toMatchObject({ sourceKind: "channel", trustLevel: "untrusted" });

    expect(
      toContentProvenance(
        {
          kind: "inter_session",
          sourceSessionKey: "agent:planner:child-1",
          sourceTool: "sessions_send",
        },
        RECEIVED_AT,
      ),
    ).toMatchObject({
      sourceKind: "agent-handoff",
      trustLevel: "derived-untrusted",
      parentSourceIds: ["session:agent:planner:child-1"],
    });
  });
});
