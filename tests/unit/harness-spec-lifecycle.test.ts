import { describe, expect, it } from 'vitest';

import {
  collectTaskSpecLifecycleErrors,
  LIFECYCLE_STATUSES,
  validateLifecycleStatus,
} from '../../scripts/check-spec-lifecycle.mjs';

describe('task spec lifecycle', () => {
  it('accepts only explicit lifecycle statuses', () => {
    expect(LIFECYCLE_STATUSES).toEqual(['active', 'completed', 'archived']);
    expect(validateLifecycleStatus({ lifecycleStatus: 'active' })).toEqual([]);
    expect(validateLifecycleStatus({ lifecycleStatus: 'completed' })).toEqual([]);
    expect(validateLifecycleStatus({ lifecycleStatus: 'archived' })).toEqual([]);
    expect(validateLifecycleStatus({ lifecycleStatus: 'unknown' })).toContain(
      'spec: lifecycleStatus must be one of active, completed, archived',
    );
    expect(validateLifecycleStatus({})).toContain('spec: missing required field "lifecycleStatus"');
  });

  it('covers every checked-in task spec without lifecycle gaps', async () => {
    await expect(collectTaskSpecLifecycleErrors()).resolves.toEqual([]);
  });
});
