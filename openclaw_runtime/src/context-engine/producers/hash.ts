// Adapted from ragcode-context-engine (MIT), https://github.com/MarshallEriksen-Neura/ragcode
// Source: src/utils/hash.ts (verbatim) + projectIdForRoot per SPEC §4.2.
import { createHash } from "node:crypto";

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function stableId(parts: Array<string | number | undefined>): string {
  return sha256(parts.filter((part) => part !== undefined).join("::")).slice(0, 24);
}

/**
 * Stable project id from a canonical repo root (SPEC §4.2).
 * Lowercased before hashing so Windows path casing does not fork identities.
 */
export function projectIdForRoot(canonicalRoot: string): string {
  return sha256(canonicalRoot.toLowerCase()).slice(0, 24);
}
