import { describe, expect, it } from "vitest";
import { normalizeEffectReceipt } from "../../shared/types/context-control-plane/artifacts";
import { projectStage1EffectReceipt } from "../../openclaw_runtime/src/agents/stage1-effect-projection";

describe("stage1 EffectReceipt acceptance surface", () => {
  it("projects digest-only row facts into a contract-valid EffectReceipt/v1", () => {
    const projected = projectStage1EffectReceipt({
      effect_receipt_id: "efx_1",
      idempotency_key: "grant_1:aprv_1:tool_1",
      approval_id: "aprv_1",
      proposal_digest: "a".repeat(64),
      approval_decision: "approved",
      domain_executor: "stage1-write-tool-guard",
      outcome: "applied",
      artifact_ref: null,
      journal_ref: "write-journal:sess:1",
      recoverability: "none-needed",
      effect_context_json: JSON.stringify({
        approvalPolicyDigest: `sha256:${"a".repeat(64)}`,
        actor: { sessionKey: "sess:1", runId: "run:1", attemptIndex: 0, modelCallIndex: 0, actorKind: "principal" },
        effect: { toolCallId: "tool_1", toolName: "write", resource: "workspace:sentinel.txt", action: "write" },
      }),
      schema_version: "2",
      created_at: Date.now(),
    });
    expect(projected).toBeDefined();
    expect(() => normalizeEffectReceipt(projected)).not.toThrow();
    expect(projected?.effect.toolName).toBe("write");
    expect(projected?.journalRef).toBe("write-journal:sess:1");
  });

  it("does not project legacy rows that lack stage1 identifier facts", () => {
    expect(projectStage1EffectReceipt({
      effect_receipt_id: "efx_legacy",
      idempotency_key: "efx:legacy",
      approval_id: "aprv_legacy",
      proposal_digest: "a".repeat(64),
      approval_decision: "approved",
      domain_executor: "legacy",
      outcome: "applied",
      artifact_ref: null,
      journal_ref: null,
      recoverability: "none-needed",
      effect_context_json: "{}",
      schema_version: "2",
      created_at: Date.now(),
    })).toBeUndefined();
  });
});
