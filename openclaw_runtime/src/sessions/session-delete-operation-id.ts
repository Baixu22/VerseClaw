import { createHash } from "node:crypto";

export function buildSessionDeleteOperationId(owner: string, stableIdentity: string): string {
  const normalizedOwner = owner
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-");
  const identity = stableIdentity.trim();
  if (!normalizedOwner || !identity) {
    throw new Error("session delete operation identity requires owner and stableIdentity");
  }
  const digest = createHash("sha256").update(`${normalizedOwner}\0${identity}`).digest("hex");
  return `delete:${normalizedOwner.slice(0, 48)}:${digest}`;
}
