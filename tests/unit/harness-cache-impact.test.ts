import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  parseCacheImpactLevel,
  readCacheImpactBody,
  validateCacheImpactDeclaration,
} from '../../harness/src/rules.mjs';

const CACHE_SENSITIVE_FILE = 'openclaw_runtime/src/agents/compaction.ts';
const SYSTEM_PROMPT_SENSITIVE_FILE = 'openclaw_runtime/src/agents/system-prompt.ts';

describe('cache-impact declaration harness rule', () => {
  it('parses a valid cache-impact level from arbitrary PR body text', () => {
    expect(parseCacheImpactLevel('Cache-impact: high - tool schema changed')).toBe('high');
    expect(parseCacheImpactLevel('Cache-impact: none')).toBe('none');
    expect(parseCacheImpactLevel('body\nCache-impact: medium\nmore')).toBe('medium');
    expect(parseCacheImpactLevel('Cache-impact: nope')).toBeNull();
    expect(parseCacheImpactLevel('')).toBeNull();
  });

  it('reads the declaration body from env, then local file', async () => {
    expect(await readCacheImpactBody({ env: { CACHE_IMPACT_PR_BODY: 'Cache-impact: low' } })).toBe(
      'Cache-impact: low',
    );

    const dir = await mkdtemp(path.join(tmpdir(), 'clawx-cache-impact-'));
    try {
      await writeFile(path.join(dir, '.cache-impact'), 'Cache-impact: high\nCache-guard: x\n');
      expect(await readCacheImpactBody({ env: {}, cwd: dir })).toContain('Cache-impact: high');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('requires Cache-impact and Cache-guard for a cache-sensitive path', async () => {
    const failures = await validateCacheImpactDeclaration([CACHE_SENSITIVE_FILE], { env: {} });
    expect(failures.some((f) => f.includes('Cache-impact'))).toBe(true);
    expect(failures.some((f) => f.includes('Cache-guard'))).toBe(true);
  });

  it('passes a cache-sensitive path with Cache-impact and Cache-guard', async () => {
    const failures = await validateCacheImpactDeclaration([CACHE_SENSITIVE_FILE], {
      env: { PR_BODY: 'Cache-impact: medium\nCache-guard: tests/unit/deepseek-prompt-cache-runtime.test.ts' },
    });
    expect(failures).toEqual([]);
  });

  it('requires System-prompt-review for a system-prompt-sensitive path', async () => {
    const failures = await validateCacheImpactDeclaration([SYSTEM_PROMPT_SENSITIVE_FILE], {
      env: { PR_BODY: 'Cache-impact: high\nCache-guard: focused-guard-test\n' },
    });
    expect(failures.some((f) => f.includes('System-prompt-review'))).toBe(true);
  });

  it('passes a system-prompt-sensitive path with all three declarations', async () => {
    const failures = await validateCacheImpactDeclaration([SYSTEM_PROMPT_SENSITIVE_FILE], {
      env: {
        PR_BODY:
          'Cache-impact: high\nCache-guard: tests/unit/system-prompt.test.ts\nSystem-prompt-review: approved by owner',
      },
    });
    expect(failures).toEqual([]);
  });

  it('passes when no cache-sensitive paths change', async () => {
    const failures = await validateCacheImpactDeclaration(['src/App.tsx'], { env: {} });
    expect(failures).toEqual([]);
  });
});
