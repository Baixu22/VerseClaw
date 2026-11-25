// Holds current plugin metadata snapshots for process-scoped consumers.
let currentPluginMetadataSnapshot: unknown;
let currentPluginMetadataSnapshotConfigFingerprint: string | undefined;
let currentPluginMetadataSnapshotCompatiblePolicyHashes: readonly string[] | undefined;
let currentPluginMetadataSnapshotCompatibleConfigFingerprints: readonly string[] | undefined;
let currentPluginMetadataSnapshotDiscoveryFingerprint: string | undefined;
let currentPluginMetadataDefaultDiscoveryCompatible = false;

/** Stores the process-current plugin metadata snapshot and compatible config fingerprints. */
export function setCurrentPluginMetadataSnapshotState(
  snapshot: unknown,
  configFingerprint: string | undefined,
  compatiblePolicyHashes?: readonly string[],
  compatibleConfigFingerprints?: readonly string[],
  discoveryFingerprint?: string,
  defaultDiscoveryCompatible = false,
): void {
  currentPluginMetadataSnapshot = snapshot;
  currentPluginMetadataSnapshotConfigFingerprint = snapshot ? configFingerprint : undefined;
  currentPluginMetadataSnapshotCompatiblePolicyHashes = snapshot
    ? compatiblePolicyHashes
    : undefined;
  currentPluginMetadataSnapshotCompatibleConfigFingerprints = snapshot
    ? compatibleConfigFingerprints
    : undefined;
  currentPluginMetadataSnapshotDiscoveryFingerprint = snapshot ? discoveryFingerprint : undefined;
  currentPluginMetadataDefaultDiscoveryCompatible = Boolean(snapshot && defaultDiscoveryCompatible);
}

/** Clears the process-current plugin metadata snapshot. */
export function clearCurrentPluginMetadataSnapshotState(): void {
  currentPluginMetadataSnapshot = undefined;
  currentPluginMetadataSnapshotConfigFingerprint = undefined;
  currentPluginMetadataSnapshotCompatiblePolicyHashes = undefined;
  currentPluginMetadataSnapshotCompatibleConfigFingerprints = undefined;
  currentPluginMetadataSnapshotDiscoveryFingerprint = undefined;
  currentPluginMetadataDefaultDiscoveryCompatible = false;
}

/** Returns the process-current plugin metadata snapshot state. */
export function getCurrentPluginMetadataSnapshotState(): {
  snapshot: unknown;
  configFingerprint: string | undefined;
  compatiblePolicyHashes: readonly string[] | undefined;
  compatibleConfigFingerprints: readonly string[] | undefined;
  discoveryFingerprint: string | undefined;
  defaultDiscoveryCompatible: boolean;
} {
  return {
    snapshot: currentPluginMetadataSnapshot,
    configFingerprint: currentPluginMetadataSnapshotConfigFingerprint,
    compatiblePolicyHashes: currentPluginMetadataSnapshotCompatiblePolicyHashes,
    compatibleConfigFingerprints: currentPluginMetadataSnapshotCompatibleConfigFingerprints,
    discoveryFingerprint: currentPluginMetadataSnapshotDiscoveryFingerprint,
    defaultDiscoveryCompatible: currentPluginMetadataDefaultDiscoveryCompatible,
  };
}
