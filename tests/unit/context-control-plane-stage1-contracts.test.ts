import { describe, expect, it } from "vitest";
import {
  normalizeCapabilityGrant,
  normalizeContextRef,
  normalizeEffectReceipt,
  normalizeRequestEnvelope,
} from "../../shared/types/context-control-plane/artifacts";

describe("stage1 contract normalization remains frozen", () => {
  it("accepts contract-valid RequestEnvelope, minimal grant, and EffectReceipt fixtures", () => {
    expect(() =>
      normalizeRequestEnvelope({
        schema: "RequestEnvelope/v1",
        envelopeId: "env_stage1",
        planId: "plan_stage1",
        snapshotId: "snap_stage1",
        identity: { sessionKey: "sess:1", runId: "run:1", attemptIndex: 0, modelCallIndex: 0 },
        system: ["system"],
        messages: [{ role: "user", content: "hello" }],
        tools: [{ type: "function", function: { name: "write" } }],
        media: [],
        transforms: [
          {
            id: "transport-wire-serialization",
            kind: "non-semantic",
            mutates: "transport",
            version: "1",
            registeredDigest: `sha256:${"a".repeat(64)}`,
          },
        ],
        transport: {
          method: "POST",
          targetOrigin: "https://api.deepseek.com",
          endpointClass: "public",
          providerId: "deepseek",
          adapterId: "openai-completions",
          modelId: "deepseek-v4-flash",
        },
        envelopeDigest: `sha256:${"a".repeat(64)}`,
        createdAt: new Date(0).toISOString(),
      }),
    ).not.toThrow();

    expect(() =>
      normalizeCapabilityGrant({
        schema: "CapabilityGrant/v1",
        grantId: "grant_stage1",
        derivation: {
          ruleId: "grant-adapter/v1:derive-minimal-from-approved-ledger",
          ruleVersion: "1",
          policyDigest: `sha256:${"a".repeat(64)}`,
          inputRefs: ["ref:approval:aprv_1", "ref:tool:tool_1"],
        },
        actor: { sessionKey: "sess:1", runId: "run:1", attemptIndex: 0, modelCallIndex: 0, actorKind: "principal" },
        scope: { taskBranchId: "run:1", resource: "workspace:file.txt", action: "write", purpose: "stage1 test" },
        approvalRef: {
          approvalId: "aprv_1",
          decision: "approved",
          resolvedBy: "owner:stage1",
          policyDigest: `sha256:${"a".repeat(64)}`,
        },
        ttl: { issuedAt: new Date(0).toISOString(), expiresAt: new Date(1000).toISOString() },
        effectIdempotency: { key: "grant_stage1:aprv_1:tool_1", namespace: "coding-tool" },
        status: "active",
      }),
    ).not.toThrow();

    expect(() =>
      normalizeEffectReceipt({
        schema: "EffectReceipt/v1",
        receiptId: "efx_stage1",
        idempotencyKey: "grant_stage1:aprv_1:tool_1",
        approvalRef: { approvalId: "aprv_1", decision: "approved", policyDigest: `sha256:${"a".repeat(64)}` },
        actor: { sessionKey: "sess:1", runId: "run:1", attemptIndex: 0, modelCallIndex: 0, actorKind: "principal" },
        effect: { toolCallId: "tool_1", toolName: "write", resource: "workspace:file.txt", action: "write" },
        outcome: "applied",
        proposalDigest: `sha256:${"a".repeat(64)}`,
        journalRef: "write-journal:sess:1",
        recoverability: "none-needed",
        createdAt: new Date(0).toISOString(),
      }),
    ).not.toThrow();
  });

  it("keeps rejecting raw payload and wildcard violations", () => {
    expect(() =>
      normalizeContextRef({
        schema: "ContextRef/v1",
        refId: "ctxref:transcript:u1",
        kind: "user_intent",
        owner: "transcript",
        sourceRef: "transcript://u1",
        revision: "1",
        contentDigest: `sha256:${"a".repeat(64)}`,
        acl: { scope: "turn", allowedActors: ["owner:1"] },
        retention: { policyId: "retention:default" },
        provenance: { producerId: "identity-adapter/v1", observedAt: new Date(0).toISOString(), evidenceRefs: [] },
        lifecycle: "active",
        payload: "raw text",
      }),
    ).toThrow();

    expect(() =>
      normalizeCapabilityGrant({
        schema: "CapabilityGrant/v1",
        grantId: "grant_wild",
        derivation: {
          ruleId: "grant-adapter/v1:derive-minimal-from-approved-ledger",
          ruleVersion: "1",
          policyDigest: `sha256:${"a".repeat(64)}`,
          inputRefs: ["ref:approval:aprv_1"],
        },
        actor: { sessionKey: "sess:1", runId: "run:1", attemptIndex: 0, modelCallIndex: 0, actorKind: "principal" },
        scope: { taskBranchId: "run:1", resource: "workspace:file.txt", action: "*", purpose: "wildcard" },
        approvalRef: { approvalId: "aprv_1", decision: "approved", resolvedBy: "owner:stage1", policyDigest: `sha256:${"a".repeat(64)}` },
        ttl: { issuedAt: new Date(0).toISOString(), expiresAt: new Date(1000).toISOString() },
        effectIdempotency: { key: "grant_wild:aprv_1:tool_1", namespace: "coding-tool" },
        status: "active",
      }),
    ).toThrow();
  });
});
