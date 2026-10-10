import { describe, expect, it } from 'vitest';
import { findLocalPathDocs } from '../../scripts/check-local-paths.mjs';

describe('active documentation local-path guard (#69)', () => {
  it('contains no developer-local absolute paths in AGENTS.md or docs', () => {
    expect(findLocalPathDocs(process.cwd())).toEqual([]);
  });
});
