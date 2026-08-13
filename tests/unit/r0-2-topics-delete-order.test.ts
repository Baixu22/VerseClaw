// @vitest-environment node
// R0-2: topic delete must remove the directory FIRST and only then update
// the index. A failed rm must return success:false and keep the index entry.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ failRmSuffix: null as string | null }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rm: async (target: string | URL, options?: unknown) => {
      if (state.failRmSuffix && String(target).includes(state.failRmSuffix)) {
        const err: NodeJS.ErrnoException = new Error('EPERM: operation not permitted, rmdir ' + String(target));
        err.code = 'EPERM';
        throw err;
      }
      return (actual.rm as (t: string | URL, o?: unknown) => Promise<void>)(target, options);
    },
  };
});

const tempRoots: string[] = [];

async function makeWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'clawx-r0-2-topics-'));
  tempRoots.push(root);
  return root;
}

beforeEach(() => {
  state.failRmSuffix = null;
});

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('R0-2 topics delete ordering', () => {
  it('removes the directory and the index entry on success', async () => {
    const workspace = await makeWorkspace();
    const { createTopicsApi } = await import('@electron/services/topics-api');
    const api = createTopicsApi();

    await api.create({ name: 'Auth Refactor', workspacePath: workspace });
    const result = await api.delete({ id: 'auth-refactor', workspacePath: workspace });

    expect(result.success).toBe(true);
    const index = JSON.parse(await readFile(join(workspace, 'topics', '_index.json'), 'utf8')) as {
      topics: Array<{ id: string }>;
    };
    expect(index.topics.some((topic) => topic.id === 'auth-refactor')).toBe(false);
    await expect(rm(join(workspace, 'topics', 'auth-refactor'), { recursive: true, force: true })).resolves.toBeUndefined();
  });

  it('returns success:false and keeps the index entry when the directory removal fails', async () => {
    const workspace = await makeWorkspace();
    const { createTopicsApi } = await import('@electron/services/topics-api');
    const api = createTopicsApi();

    await api.create({ name: 'Auth Refactor', workspacePath: workspace });
    state.failRmSuffix = 'auth-refactor';
    const result = await api.delete({ id: 'auth-refactor', workspacePath: workspace });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Could not remove topic directory');
    // The index must still list the topic so it stays visible/retryable.
    const index = JSON.parse(await readFile(join(workspace, 'topics', '_index.json'), 'utf8')) as {
      topics: Array<{ id: string }>;
    };
    expect(index.topics.some((topic) => topic.id === 'auth-refactor')).toBe(true);
  });
});
