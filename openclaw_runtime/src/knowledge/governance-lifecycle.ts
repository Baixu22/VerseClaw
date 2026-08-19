import { createHash } from "node:crypto";
import type {
  GovernedMutation,
  GovernedTargetAdapter,
} from "./governance-adapters.js";

export type GovernanceLifecycleReceipt = {
  schema: "governance-lifecycle-receipt.v1";
  receiptId: string;
  idempotencyKey: string;
  owner: string;
  operation: GovernedMutation["operation"];
  status: "committed" | "failed";
  subjectId: string;
  subjectRevision?: string;
  contentDigest: string;
  committedAt: string;
  evidenceRefs: string[];
};

export type GovernanceLifecycleCommitResult = {
  success: boolean;
  duplicate?: boolean;
  receipt?: GovernanceLifecycleReceipt;
  conflict?: { code: string; reason: string };
};

export type GovernanceLifecycleCompensationResult = {
  status: "compensated" | "partial" | "unrecoverable";
  receipt?: GovernanceLifecycleReceipt;
  reason?: string;
};

function receiptFor(
  mutation: GovernedMutation,
  owner: string,
  now: Date,
): GovernanceLifecycleReceipt {
  return {
    schema: "governance-lifecycle-receipt.v1",
    receiptId: `glr_${createHash("sha256").update(`${mutation.idempotencyKey}:${mutation.operation}:${mutation.subjectId}:${mutation.contentDigest}`).digest("hex").slice(0, 24)}`,
    idempotencyKey: mutation.idempotencyKey,
    owner: String(owner),
    operation: mutation.operation,
    status: "committed",
    subjectId: mutation.subjectId,
    subjectRevision: mutation.expectedRevision,
    contentDigest: mutation.contentDigest,
    committedAt: now.toISOString(),
    evidenceRefs: mutation.sourceRefs,
  };
}

/**
 * KS-06: explicit control flow for governed mutations.
 * prepare -> commit -> optional compensate, with receipts.
 */
export class GovernanceLifecycleCoordinator {
  readonly #resolveAdapter: (owner: string) => GovernedTargetAdapter | undefined;
  readonly #committedByIdempotencyKey = new Map<string, { contentDigest: string; receipt: GovernanceLifecycleReceipt }>();

  constructor(resolveAdapter: (owner: string) => GovernedTargetAdapter | undefined) {
    this.#resolveAdapter = resolveAdapter;
  }

  async prepare(
    owner: string,
    mutation: GovernedMutation,
  ): Promise<{ owner: string; plan: unknown }> {
    const adapter = this.#resolveAdapter(owner);
    if (!adapter) {
      throw new Error(`governed target adapter not registered for owner ${owner}`);
    }
    const plan = await adapter.prepare(mutation);
    return { owner, plan };
  }

  async commit(
    owner: string,
    mutation: GovernedMutation,
    plan: unknown,
    now = new Date(),
  ): Promise<GovernanceLifecycleCommitResult> {
    const existing = this.#committedByIdempotencyKey.get(mutation.idempotencyKey);
    if (existing) {
      if (existing.contentDigest === mutation.contentDigest) {
        return { success: true, duplicate: true, receipt: existing.receipt };
      }
      return {
        success: false,
        conflict: {
          code: "idempotency_conflict",
          reason: `idempotency key ${mutation.idempotencyKey} was already committed for content digest ${existing.contentDigest}`,
        },
      };
    }
    const adapter = this.#resolveAdapter(owner);
    if (!adapter) {
      return { success: false, conflict: { code: "adapter_missing", reason: `governed target adapter not registered for owner ${owner}` } };
    }
    let raw: unknown;
    try {
      raw = await adapter.commit(plan);
    } catch (error) {
      return { success: false, conflict: { code: "commit_threw", reason: String(error) } };
    }
    if (raw && typeof raw === "object" && (raw as { success?: unknown }).success === false) {
      return {
        success: false,
        conflict: {
          code: String((raw as { conflict?: { code?: string } }).conflict?.code ?? "commit_rejected"),
          reason: String((raw as { conflict?: { reason?: string } }).conflict?.reason ?? "commit rejected"),
        },
      };
    }
    const receipt = receiptFor(mutation, owner, now);
    this.#committedByIdempotencyKey.set(mutation.idempotencyKey, {
      contentDigest: mutation.contentDigest,
      receipt,
    });
    return { success: true, receipt };
  }

  async compensate(
    owner: string,
    receipt: GovernanceLifecycleReceipt,
  ): Promise<GovernanceLifecycleCompensationResult> {
    const adapter = this.#resolveAdapter(owner);
    if (!adapter) {
      return { status: "unrecoverable", receipt, reason: `governed target adapter not registered for owner ${owner}` };
    }
    try {
      const raw = await adapter.compensate(receipt);
      if (raw && typeof raw === "object" && typeof (raw as { status?: unknown }).status === "string") {
        return raw as GovernanceLifecycleCompensationResult;
      }
      return { status: "compensated", receipt };
    } catch (error) {
      return { status: "partial", receipt, reason: String(error) };
    }
  }
}

/** Deterministic receipt id helper for tests. */
export function governanceLifecycleReceiptId(mutation: GovernedMutation): string {
  return receiptFor(
    mutation,
    "test",
    new Date("2026-08-18T00:00:00.000Z"),
  ).receiptId;
}
