import { describe, expect, it } from "vitest";
import {
  createExternalProvenance,
  createTrustedProvenance,
} from "../../../../shared/security/content-provenance.js";
import { enforceCrossContextPolicy } from "./outbound-policy.js";

const RECEIVED_AT = "2026-08-21T00:00:00.000Z";
const external = createExternalProvenance({
  sourceKind: "web",
  sourceId: "web:article-1",
  receivedAt: RECEIVED_AT,
});

function enforce(params: {
  provenance?: unknown;
  includeProvenanceContext?: boolean;
  target?: string;
  config?: Record<string, unknown>;
  dryRun?: boolean;
}) {
  return () =>
    enforceCrossContextPolicy({
      channel: "telegram",
      action: "send",
      args: { to: params.target ?? "chat:other" },
      toolContext: {
        currentChannelId: "chat:current",
        currentChannelProvider: "telegram",
      },
      cfg: params.config ?? {},
      provenanceContext:
        params.includeProvenanceContext === false ? undefined : { provenance: params.provenance },
      dryRun: params.dryRun,
    });
}

describe("network-send provenance policy", () => {
  it.each([
    ["untrusted", external],
    ["derived-untrusted", { ...external, trustLevel: "derived-untrusted" as const }],
    ["missing", undefined],
    ["invalid", { sourceKind: "web" }],
  ])("denies an implicit cross-target send for %s provenance", (_label, provenance) => {
    expect(enforce({ provenance })).toThrow(/requires explicit .*allowWithinProvider=true/u);
  });

  it("keeps a reply to the bound target usable", () => {
    expect(enforce({ provenance: external, target: "chat:current" })).not.toThrow();
  });

  it("honors the existing explicit same-provider operator setting", () => {
    expect(
      enforce({
        provenance: external,
        config: {
          tools: { message: { crossContext: { allowWithinProvider: true } } },
        },
      }),
    ).not.toThrow();
  });

  it("honors explicit cross-provider and legacy operator overrides", () => {
    expect(() =>
      enforceCrossContextPolicy({
        channel: "slack",
        action: "send",
        args: { to: "channel:other" },
        toolContext: {
          currentChannelId: "chat:current",
          currentChannelProvider: "telegram",
        },
        cfg: {
          tools: { message: { crossContext: { allowAcrossProviders: true } } },
        },
        provenanceContext: { provenance: external },
      }),
    ).not.toThrow();

    expect(
      enforce({
        provenance: external,
        config: { tools: { message: { allowCrossContextSend: true } } },
      }),
    ).not.toThrow();
  });

  it("keeps trusted provenance and non-agent delivery callers on existing policy", () => {
    const trusted = createTrustedProvenance({
      sourceKind: "system-generated",
      sourceId: "system:job",
      receivedAt: RECEIVED_AT,
    });
    expect(enforce({ provenance: trusted })).not.toThrow();
    expect(enforce({ includeProvenanceContext: false })).not.toThrow();
  });

  it("does not turn dry-run inspection into a denied side effect", () => {
    expect(enforce({ provenance: external, dryRun: true })).not.toThrow();
  });
});
