/**
 * L04: constrain the persisted attachment into a recoverable minimal checkpoint.
 *
 * A "attachment" here is bounded to one of five reference kinds — never an
 * arbitrary cursor or blob:
 *   task-attachment | recovery-instruction | context | external-artifact-ref | ledger-checkpoint
 *
 * Each binding carries a content hash, an owner and a TTL. Recovery is pure:
 * it validates hashes/owners, flags expired entries, repairs duplicate/conflicting
 * references into an explicit state, and never re-runs a side effect — a recovery
 * pass returns the same result for the same input (no duplicate effect).
 */
import { createHash } from "node:crypto";

export const CHECKPOINT_ATTACHMENT_KINDS = [
  "task-attachment",
  "recovery-instruction",
  "context",
  "external-artifact-ref",
  "ledger-checkpoint",
] as const;

export type CheckpointAttachmentKind = (typeof CHECKPOINT_ATTACHMENT_KINDS)[number];

export type CheckpointAttachmentBinding = {
  attachmentRef: string;
  kind: CheckpointAttachmentKind;
  /** sha256 hex of the referenced content. */
  hash: string;
  /** Owner: the task or session that owns the attachment. */
  owner: string;
  /** Absolute expiry (epoch ms). */
  expiresAt: number;
};

export type CheckpointAttachmentState =
  | "ok"
  | "missing-hash"
  | "invalid-hash"
  | "missing-owner"
  | "expired"
  | "conflict";

export type CheckpointAttachmentDiagnostic = {
  attachmentRef: string;
  state: Exclude<CheckpointAttachmentState, "ok">;
  message: string;
};

export type CheckpointAttachmentRecoveryResult = {
  /** Recovered, validated, de-duplicated bindings (deterministic order). */
  recovered: CheckpointAttachmentBinding[];
  /** One entry per input binding describing its final state. */
  states: Array<{ attachmentRef: string; state: CheckpointAttachmentState }>;
  diagnostics: CheckpointAttachmentDiagnostic[];
  /** True when any input needed a repair (missing/expired/conflict). */
  repaired: boolean;
  digest: string;
};

const HASH_RE = /^[a-f0-9]{64}$/;

export function isCheckpointAttachmentHash(value: unknown): value is string {
  return typeof value === "string" && HASH_RE.test(value);
}

function bindingHash(binding: CheckpointAttachmentBinding): string {
  return createHash("sha256")
    .update([binding.kind, binding.attachmentRef, binding.hash, binding.owner].join("\u0000"))
    .digest("hex");
}

/**
 * Pure recovery pass. Repeated calls with the same input return an identical
 * digest and never mutate inputs or re-run a side effect.
 */
export function recoverCheckpointAttachments(
  bindings: readonly CheckpointAttachmentBinding[],
  options: { now: number },
): CheckpointAttachmentRecoveryResult {
  const diagnostics: CheckpointAttachmentDiagnostic[] = [];
  const states: Array<{ attachmentRef: string; state: CheckpointAttachmentState }> = [];
  const byRef = new Map<string, { binding: CheckpointAttachmentBinding; state: CheckpointAttachmentState }>();

  for (const binding of bindings) {
    let state: CheckpointAttachmentState = "ok";
    if (typeof binding.hash !== "string" || binding.hash.length === 0) {
      state = "missing-hash";
    } else if (!isCheckpointAttachmentHash(binding.hash)) {
      state = "invalid-hash";
    } else if (typeof binding.owner !== "string" || binding.owner.trim().length === 0) {
      state = "missing-owner";
    } else if (typeof binding.expiresAt === "number" && binding.expiresAt <= options.now) {
      state = "expired";
    }
    if (state !== "ok") {
      diagnostics.push({ attachmentRef: binding.attachmentRef, state, message: `attachment binding is ${state}` });
    }

    const existing = byRef.get(binding.attachmentRef);
    if (existing && existing.binding.hash !== binding.hash) {
      // Same ref, different content -> conflict; repair keeps the first and flags.
      diagnostics.push({ attachmentRef: binding.attachmentRef, state: "conflict", message: "conflicting hash for the same attachmentRef" });
      states.push({ attachmentRef: binding.attachmentRef, state: "conflict" });
      continue;
    }
    if (existing && existing.state !== "ok") {
      states.push({ attachmentRef: binding.attachmentRef, state: existing.state });
      continue;
    }
    byRef.set(binding.attachmentRef, { binding, state });
    states.push({ attachmentRef: binding.attachmentRef, state });
  }

  const recovered = [...byRef.values()]
    .filter((entry) => entry.state === "ok")
    .map((entry) => ({ ...entry.binding }))
    .sort((a, b) => (a.attachmentRef < b.attachmentRef ? -1 : a.attachmentRef > b.attachmentRef ? 1 : 0));

  const digest = createHash("sha256")
    .update(JSON.stringify({ recovered: recovered.map(bindingHash), states, diagnostics }))
    .digest("hex");

  return {
    recovered,
    states,
    diagnostics,
    repaired: diagnostics.length > 0,
    digest,
  };
}