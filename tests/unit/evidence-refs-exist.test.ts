import { describe, expect, it } from 'vitest';
import { checkEvidenceRefs } from '../../scripts/check-evidence-refs.mjs';

describe('evidence reference path validation (#92)', () => {
  it('resolves every declared shared evidence path from a clean checkout', () => {
    const result = checkEvidenceRefs(process.cwd());
    expect(result.missing).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
