import { describe, expect, it } from "vitest";
import {
  CONTENT_PROVENANCE_SCHEMA,
  SENSITIVE_SINK_CLASSIFICATION,
  createExternalProvenance,
  createTrustedProvenance,
  deriveProvenance,
  normalizeContentProvenance,
  provenanceStatus,
  type ContentProvenance,
} from "../../shared/security/content-provenance";
import { createInboundMessageProvenance } from "../../shared/channels/inbound-trust";
import {
  wrapExternalContent,
  wrapExternalContentWithProvenance,
  wrapWebContentWithProvenance,
  buildExternalContentProvenance,
} from "../../openclaw_runtime/src/security/external-content";
import {
  wrapUntrustedPromptDataBlock,
  wrapUntrustedPromptDataBlockWithProvenance,
} from "../../openclaw_runtime/src/agents/sanitize-for-prompt";
import { buildWebFetchResultProvenance } from "../../openclaw_runtime/src/agents/tools/web-fetch";

const RECEIVED_AT = "2026-08-20T00:00:00.000Z";

function externalParent(sourceId = "web:article-1"): ContentProvenance {
  return createExternalProvenance({
    sourceKind: "web",
    sourceId,
    receivedAt: RECEIVED_AT,
  });
}

describe("external content provenance baseline", () => {
  it("marks channel and web content as untrusted", () => {
    const channel = createInboundMessageProvenance({
      channel: "telegram",
      senderId: "sender-1",
      messageId: "message-1",
      receivedAt: RECEIVED_AT,
    });
    const web = wrapWebContentWithProvenance("external page text", "web_fetch", {
      sourceId: "web:page-1",
      receivedAt: RECEIVED_AT,
    });

    expect(channel).toMatchObject({
      sourceKind: "channel",
      trustLevel: "untrusted",
      containsExternalUntrustedContent: true,
      sourceId: "channel:telegram:message-1",
    });
    expect(web.provenance).toMatchObject({
      sourceKind: "web",
      trustLevel: "untrusted",
      containsExternalUntrustedContent: true,
      sourceId: "web:page-1",
    });
    expect(
      buildExternalContentProvenance({
        source: "unknown",
        receivedAt: RECEIVED_AT,
      }).sourceKind,
    ).toBe("unknown");
    expect(
      createInboundMessageProvenance({
        channel: "telegram",
        messageId: "seconds-ts",
        receivedAt: 1_735_689_600,
      }).receivedAt,
    ).toBe("2025-01-01T00:00:00.000Z");
  });

  it("keeps structured labels out of the existing wrapped prompt text", () => {
    const options = {
      source: "web_fetch" as const,
      sourceId: "web:page-2",
      receivedAt: RECEIVED_AT,
      includeWarning: false,
    };
    const legacy = wrapExternalContent("keep this visible", options);
    const adapted = wrapExternalContentWithProvenance("keep this visible", options);
    const normalizeMarker = (value: string) => value.replace(/id="[a-f0-9]+"/g, 'id="<stable>"');

    expect(normalizeMarker(adapted.text)).toBe(normalizeMarker(legacy));
    expect(adapted.text).toContain("keep this visible");

    const prompt = wrapUntrustedPromptDataBlock({ label: "Captured output", text: "visible text" });
    const promptWithMetadata = wrapUntrustedPromptDataBlockWithProvenance({
      label: "Captured output",
      text: "visible text",
      provenance: externalParent(),
      sourceId: "prompt:1",
    });
    expect(promptWithMetadata.text).toBe(prompt);

    const promptWithTrustedParent = wrapUntrustedPromptDataBlockWithProvenance({
      label: "Captured output",
      text: "visible text",
      provenance: createTrustedProvenance({
        sourceKind: "system-generated",
        sourceId: "system:trusted-parent",
        receivedAt: RECEIVED_AT,
      }),
      sourceId: "prompt:trusted-parent",
    });
    expect(promptWithTrustedParent.provenance).toMatchObject({
      trustLevel: "derived-untrusted",
      containsExternalUntrustedContent: true,
    });
  });

  it("derives tool results as derived-untrusted from external content", () => {
    const result = buildWebFetchResultProvenance({
      url: "https://example.test/article-1",
      fetchedAt: RECEIVED_AT,
    });
    expect(result).toMatchObject({
      sourceKind: "tool-result",
      trustLevel: "derived-untrusted",
      containsExternalUntrustedContent: true,
      parentSourceIds: ["web:https://example.test/article-1"],
    });
  });

  it("preserves ancestry across agent handoff derivation", () => {
    const parent = deriveProvenance({
      sourceKind: "tool-result",
      sourceId: "tool-result:1",
      receivedAt: RECEIVED_AT,
      parents: [externalParent()],
    });
    const handoff = deriveProvenance({
      sourceKind: "agent-handoff",
      sourceId: "handoff:1",
      receivedAt: RECEIVED_AT,
      parents: [parent],
    });
    expect(handoff.trustLevel).toBe("derived-untrusted");
    expect(handoff.parentSourceIds).toEqual(["tool-result:1", "web:article-1"]);
  });

  it("does not allow ordinary metadata to promote untrusted content", () => {
    const attempted = deriveProvenance({
      sourceKind: "tool-result",
      sourceId: "tool-result:attempted-escalation",
      receivedAt: RECEIVED_AT,
      parents: [externalParent()],
      containsExternalUntrustedContent: false,
    });
    expect(attempted.trustLevel).toBe("derived-untrusted");
    expect(
      normalizeContentProvenance({
        ...externalParent(),
        trustLevel: "trusted",
        containsExternalUntrustedContent: false,
      }),
    ).toBeUndefined();
    expect(
      normalizeContentProvenance({
        ...externalParent(),
        sourceKind: "user-direct",
        trustLevel: "trusted",
        containsExternalUntrustedContent: false,
      }),
    ).toBeUndefined();
    expect(
      createTrustedProvenance({
        sourceKind: "user-direct",
        sourceId: "operator:1",
        receivedAt: RECEIVED_AT,
      }).trustLevel,
    ).toBe("operator");
    expect(
      normalizeContentProvenance({
        ...externalParent(),
        trustLevel: "derived-untrusted",
        containsExternalUntrustedContent: false,
      }),
    ).toBeUndefined();
  });

  it("keeps derived trust and the external-content bit internally consistent", () => {
    const trustedParent = createTrustedProvenance({
      sourceKind: "system-generated",
      sourceId: "system:seed",
      receivedAt: RECEIVED_AT,
    });
    const missingParent = deriveProvenance({
      sourceKind: "agent-handoff",
      sourceId: "handoff:missing-parent",
      receivedAt: RECEIVED_AT,
    });
    const trustedSystemChild = deriveProvenance({
      sourceKind: "system-generated",
      sourceId: "system:child",
      receivedAt: RECEIVED_AT,
      parents: [trustedParent],
    });

    expect(missingParent).toMatchObject({
      trustLevel: "derived-untrusted",
      containsExternalUntrustedContent: true,
    });
    expect(trustedSystemChild).toMatchObject({
      trustLevel: "trusted",
      containsExternalUntrustedContent: false,
    });
    expect(normalizeContentProvenance(missingParent)).toEqual(missingParent);
    expect(normalizeContentProvenance(trustedSystemChild)).toEqual(trustedSystemChild);
  });

  it("reports missing provenance explicitly instead of treating it as trusted", () => {
    expect(provenanceStatus(undefined)).toEqual({ status: "missing", reason: "missing" });
    expect(provenanceStatus({ nope: true })).toEqual({ status: "missing", reason: "invalid" });
    expect(
      normalizeContentProvenance({
        schema: CONTENT_PROVENANCE_SCHEMA,
        sourceKind: "web",
        trustLevel: "untrusted",
        sourceId: "web:valid",
        receivedAt: RECEIVED_AT,
        parentSourceIds: [],
        containsExternalUntrustedContent: true,
      }),
    ).toBeDefined();
  });

  it("keeps the sink taxonomy centralized while command-exec gains narrow enforcement", () => {
    expect(Object.keys(SENSITIVE_SINK_CLASSIFICATION)).toEqual([
      "secret-read",
      "network-send",
      "external-write",
      "command-exec",
      "browser-effect",
      "credential-use",
    ]);
    expect(SENSITIVE_SINK_CLASSIFICATION["command-exec"].enforcement).toBe("source-dependent");
    expect(SENSITIVE_SINK_CLASSIFICATION["secret-read"].enforcement).toBe("classification-only");
    expect(SENSITIVE_SINK_CLASSIFICATION["network-send"].enforcement).toBe("classification-only");
  });
});
