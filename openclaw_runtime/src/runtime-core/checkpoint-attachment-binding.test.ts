// @vitest-environment node
// L04: bounded checkpoint attachment binding recovery.
import { describe, expect, it } from "vitest";

import {
  CHECKPOINT_ATTACHMENT_KINDS,
  isCheckpointAttachmentHash,
  recoverCheckpointAttachments,
  type CheckpointAttachmentBinding,
} from "./checkpoint-attachment-binding.js";

const NOW = 1_000_000;
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function binding(over: Partial<CheckpointAttachmentBinding> = {}): CheckpointAttachmentBinding {
  return {
    attachmentRef: "ref:file:checkpoint-a",
    kind: "task-attachment",
    hash: HASH_A,
    owner: "task-l04",
    expiresAt: NOW + 60_000,
    ...over,
  };
}

describe("L04 checkpoint attachment binding", () => {
  it("recovers valid bindings deterministically and de-duplicates identical refs", () => {
    const input = [
      binding({ attachmentRef: "ref:file:b" }),
      binding({ attachmentRef: "ref:file:a" }),
      binding({ attachmentRef: "ref:file:a" }),
    ];
    const first = recoverCheckpointAttachments(input, { now: NOW });
    const second = recoverCheckpointAttachments(input, { now: NOW });
    expect(first.repaired).toBe(false);
    expect(first.recovered.map((entry) => entry.attachmentRef)).toEqual(["ref:file:a", "ref:file:b"]);
    expect(first.digest).toBe(second.digest);
    expect(first.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("flags missing/invalid hash, missing owner and expired bindings, and excludes them from recovery", () => {
    const cases: Array<[CheckpointAttachmentBinding, string]> = [
      [binding({ attachmentRef: "r1", hash: "" }), "missing-hash"],
      [binding({ attachmentRef: "r2", hash: "not-a-hash" }), "invalid-hash"],
      [binding({ attachmentRef: "r3", owner: "  " }), "missing-owner"],
      [binding({ attachmentRef: "r4", expiresAt: NOW - 1 }), "expired"],
    ];
    for (const [input, expected] of cases) {
      const result = recoverCheckpointAttachments([input], { now: NOW });
      expect(result.states[0]!.state, input.attachmentRef).toBe(expected);
      expect(result.recovered, input.attachmentRef).toHaveLength(0);
      expect(result.repaired).toBe(true);
    }
  });

  it("repairs a hash conflict on the same attachmentRef into an explicit conflict state", () => {
    const result = recoverCheckpointAttachments([
      binding({ attachmentRef: "ref:file:dup", hash: HASH_A }),
      binding({ attachmentRef: "ref:file:dup", hash: HASH_B }),
    ], { now: NOW });
    expect(result.repaired).toBe(true);
    expect(result.recovered.map((entry) => entry.attachmentRef)).toEqual(["ref:file:dup"]);
    expect(result.recovered[0]!.hash).toBe(HASH_A);
    expect(result.diagnostics.some((diagnostic) => diagnostic.state === "conflict")).toBe(true);
  });

  it("is a pure recovery pass: no side effects, identical digest on repeat, and no arbitrary kind", () => {
    const input = [binding()];
    const before = JSON.stringify(input);
    const a = recoverCheckpointAttachments(input, { now: NOW });
    const b = recoverCheckpointAttachments(input, { now: NOW });
    expect(JSON.stringify(input)).toBe(before);
    expect(a.digest).toBe(b.digest);
    expect(CHECKPOINT_ATTACHMENT_KINDS).toEqual([
      "task-attachment",
      "recovery-instruction",
      "context",
      "external-artifact-ref",
      "ledger-checkpoint",
    ]);
    expect(isCheckpointAttachmentHash(HASH_A)).toBe(true);
    expect(isCheckpointAttachmentHash("short")).toBe(false);
  });
});