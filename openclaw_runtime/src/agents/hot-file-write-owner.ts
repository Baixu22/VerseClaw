/**
 * L06: one verified write owner for a hot file.
 *
 * Same-file writes already serialize through the existing per-file mutation
 * queue (`withFileMutationQueue` -> workspace `fileMutation` lease kernel, issue
 * #167). This module adds the missing verifiable half: an explicit, CAS-style
 * owner claim so a second owner is either queued (serialized) or reported as an
 * explicit conflict — never a silent concurrent write. Claims are released on
 * completion, so a conflict can be recovered/rolled back.
 *
 * No second scheduler: the serialization still comes from the existing queue.
 */
import { createHash } from "node:crypto";

import { withFileMutationQueue } from "./sessions/tools/file-mutation-queue.js";

export type WriteOwnerClaim =
  | { ok: true; token: string; reentrant: boolean }
  | { ok: false; reason: "owned-by-another-owner"; holder: string };

type ActiveClaim = { owner: string; token: string; acquiredAt: number };

const activeClaims = new Map<string, ActiveClaim>();
const conflictCounts = new Map<string, number>();

function ownerKey(filePath: string): string {
  return filePath;
}

function tokenFor(filePath: string, owner: string): string {
  return createHash("sha256").update(`${filePath}\u0000${owner}`).digest("hex");
}

/**
 * CAS-style claim. A different owner holding the file is an explicit conflict;
 * the same owner re-claiming is idempotent (reentrant).
 */
export function claimWriteOwner(filePath: string, owner: string, now: number = Date.now()): WriteOwnerClaim {
  const key = ownerKey(filePath);
  const existing = activeClaims.get(key);
  if (existing && existing.owner !== owner) {
    conflictCounts.set(key, (conflictCounts.get(key) ?? 0) + 1);
    return { ok: false, reason: "owned-by-another-owner", holder: existing.owner };
  }
  const token = tokenFor(filePath, owner);
  activeClaims.set(key, { owner, token, acquiredAt: now });
  return { ok: true, token, reentrant: existing !== undefined };
}

/** Release a claim; only the matching token may release. */
export function releaseWriteOwner(filePath: string, token: string): boolean {
  const key = ownerKey(filePath);
  const existing = activeClaims.get(key);
  if (!existing || existing.token !== token) return false;
  activeClaims.delete(key);
  return true;
}

export function getActiveWriteOwner(filePath: string): { owner: string; acquiredAt: number } | undefined {
  const existing = activeClaims.get(ownerKey(filePath));
  return existing ? { owner: existing.owner, acquiredAt: existing.acquiredAt } : undefined;
}

export function getWriteOwnerConflicts(filePath: string): number {
  return conflictCounts.get(ownerKey(filePath)) ?? 0;
}

/**
 * Serialize a hot-file write under a verified owner. The mutation queue already
 * serializes same-file writes; this wrapper additionally guarantees the write
 * runs under exactly one owner claim and releases it on completion (recovery).
 */
export async function withVerifiedWriteOwner<T>(
  filePath: string,
  owner: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withFileMutationQueue(filePath, async () => {
    const claim = claimWriteOwner(filePath, owner);
    if (!claim.ok) {
      throw new Error(`hot file ${filePath} is owned by ${claim.holder}`);
    }
    try {
      return await fn();
    } finally {
      releaseWriteOwner(filePath, claim.token);
    }
  });
}

export function resetHotFileWriteOwnersForTests(): void {
  activeClaims.clear();
  conflictCounts.clear();
}