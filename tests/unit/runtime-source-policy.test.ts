import { describe, expect, it } from 'vitest';

import { collectRuntimeSourcePolicyErrors } from '../../scripts/check-runtime-source-policy.mjs';
import { compareDuplicateGroups, buildAllowlist } from '../../scripts/check-duplicate-assets.mjs';

describe('runtime source policy', () => {
  it('keeps vendor provenance, prune metadata and LOC baseline aligned', async () => {
    await expect(collectRuntimeSourcePolicyErrors()).resolves.toEqual([]);
  });

  it('requires duplicate groups to be explicitly reviewed', async () => {
    const group = { sha256: 'a'.repeat(64), paths: ['assets/a.bin', 'assets/b.bin'] };
    const allowlist = await buildAllowlist([group]);
    expect(allowlist.groups[0].reason).toBeTruthy();
    expect(compareDuplicateGroups([group], allowlist)).toEqual({ unexpected: [], stale: [], malformed: [] });
    expect(compareDuplicateGroups([group], { groups: [] }).unexpected).toHaveLength(1);
    expect(compareDuplicateGroups([], allowlist).stale).toHaveLength(1);
  });
});
