// Read-only epoch projections for CompilationSnapshot. Catalog epoch comes
// from the V3 shadow-catalog snapshotHash; policy epoch comes from the
// effective policy digest. These are derived labels, not a new catalog or
// policy authority.
const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

export function buildStage2CatalogEpoch(catalogSnapshotHash: string): string {
  const normalized = catalogSnapshotHash.startsWith('sha256:')
    ? catalogSnapshotHash.slice('sha256:'.length)
    : catalogSnapshotHash;
  if (!SHA256_HEX_RE.test(normalized)) {
    throw new Error('catalogSnapshotHash must be sha256:<64hex>');
  }
  return `catalog_v1_${normalized}`;
}

export function buildStage2PolicyEpoch(policyDigest: string): string {
  const normalized = policyDigest.startsWith('sha256:')
    ? policyDigest.slice('sha256:'.length)
    : policyDigest;
  if (!SHA256_HEX_RE.test(normalized)) {
    throw new Error('policyDigest must be sha256:<64hex>');
  }
  return `policy_v1_${normalized}`;
}
