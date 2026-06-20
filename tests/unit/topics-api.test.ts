import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';

const tempRoots: string[] = [];

async function makeWorkspace() {
  const root = await mkdtemp(join(tmpdir(), 'clawx-topic-workspace-'));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('topics api workspace scoping', () => {
  it('stores topics under the provided workspace path instead of the agent fallback', async () => {
    const workspaceA = await makeWorkspace();
    const workspaceB = await makeWorkspace();
    const { createTopicsApi } = await import('@electron/services/topics-api');
    const api = createTopicsApi();

    const first = await api.create({
      name: 'Auth Refactor',
      description: 'workspace A context',
      agentId: 'main',
      workspacePath: workspaceA,
    });
    const second = await api.create({
      name: 'Auth Refactor',
      description: 'workspace B context',
      agentId: 'main',
      workspacePath: workspaceB,
    });

    expect(first.topic.id).toBe('auth-refactor');
    expect(second.topic.id).toBe('auth-refactor');
    await expect(api.list({ agentId: 'main', workspacePath: workspaceA })).resolves.toMatchObject({
      topics: [{ id: 'auth-refactor', description: 'workspace A context' }],
    });
    await expect(api.list({ agentId: 'main', workspacePath: workspaceB })).resolves.toMatchObject({
      topics: [{ id: 'auth-refactor', description: 'workspace B context' }],
    });

    await api.update({
      id: 'auth-refactor',
      contextMd: '# Workspace A\n\nOnly A',
      workspacePath: workspaceA,
    });

    const contextA = await api.getContext({ id: 'auth-refactor', workspacePath: workspaceA });
    const contextB = await api.getContext({ id: 'auth-refactor', workspacePath: workspaceB });
    expect(contextA.content).toContain('Only A');
    expect(contextB.content).toContain('workspace B context');

    const fileA = await readFile(join(workspaceA, 'topics', 'auth-refactor', 'CONTEXT.md'), 'utf8');
    const fileB = await readFile(join(workspaceB, 'topics', 'auth-refactor', 'CONTEXT.md'), 'utf8');
    expect(fileA).toContain('Only A');
    expect(fileB).toContain('workspace B context');
  });
});
