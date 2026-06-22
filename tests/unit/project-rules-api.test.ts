import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceProfile } from '@shared/types/workspace';

const state = vi.hoisted(() => ({
  workspace: null as WorkspaceProfile | null,
}));

vi.mock('@electron/services/workspaces-api', () => ({
  getActiveWorkspaceProfile: vi.fn(async () => state.workspace),
}));

const root = join(tmpdir(), `clawx-project-rules-${Date.now()}`);

function workspace(rootPath: string): WorkspaceProfile {
  return {
    id: 'rules-workspace',
    name: 'Rules Workspace',
    rootPath,
    agentId: 'main',
    selectedAgentId: 'main',
    activeSessionKey: 'agent:main:main',
    agentBindings: {},
    permissionMode: 'acceptEdits',
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
    state: {},
    sessionStates: {},
  };
}

async function resetWorkspace() {
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  state.workspace = workspace(root);
}

describe('project rules host API', () => {
  beforeEach(async () => {
    vi.resetModules();
    await resetWorkspace();
  });

  it('reports missing AGENTS.md and creates a conservative template without overwriting', async () => {
    const { createProjectRulesApi } = await import('@electron/services/project-rules-api');
    const api = createProjectRulesApi();

    const missing = await api.snapshot();
    expect(missing.agentsFile?.exists).toBe(false);
    expect(missing.issues.map((item) => item.id)).toContain('agents.missing');

    const created = await api.createAgentsTemplate();
    expect(created.templateCreated).toBe(true);
    expect(created.agentsFile?.exists).toBe(true);
    expect(created.agentsFile?.content).toContain('Renderer code must call backend functionality through `src/lib/host-api.ts`');
    expect(created.issues.map((item) => item.id)).not.toContain('agents.missing');

    await writeFile(join(root, 'AGENTS.md'), '# Custom\n\nDo not replace me.\n', 'utf8');
    const preserved = await api.createAgentsTemplate();
    expect(preserved.templateCreated).toBe(false);
    await expect(readFile(join(root, 'AGENTS.md'), 'utf8')).resolves.toContain('Do not replace me.');
  });

  it('lists .clawx/rules markdown files and warns about empty files', async () => {
    await writeFile(join(root, 'AGENTS.md'), '# Rules\n\nRenderer code must use host-api.\nDo not call `window.electron.ipcRenderer.invoke(...)` directly.\nDo not fetch `http://127.0.0.1:18789` from renderer code.\n', 'utf8');
    await mkdir(join(root, '.clawx', 'rules'), { recursive: true });
    await writeFile(join(root, '.clawx', 'rules', 'empty.md'), '', 'utf8');
    await writeFile(join(root, '.clawx', 'rules', 'notes.txt'), 'ignored', 'utf8');

    const { createProjectRulesApi } = await import('@electron/services/project-rules-api');
    const result = await createProjectRulesApi().snapshot();

    expect(result.ruleFiles).toHaveLength(1);
    expect(result.ruleFiles[0]).toMatchObject({
      name: 'empty.md',
      relativePath: '.clawx/rules/empty.md',
      status: 'empty',
    });
    expect(result.issues.map((item) => item.id)).toContain('ruleFile.empty');
  });

  it('detects duplicate titles, duplicate lines, and renderer guidance gaps', async () => {
    await writeFile(join(root, 'AGENTS.md'), '# Shared\n\nAlways inspect current state first.\n', 'utf8');
    await mkdir(join(root, '.clawx', 'rules'), { recursive: true });
    await writeFile(join(root, '.clawx', 'rules', 'one.md'), '# Shared\n\nAlways inspect current state first.\n', 'utf8');

    const { createProjectRulesApi } = await import('@electron/services/project-rules-api');
    const result = await createProjectRulesApi().snapshot();
    const ids = result.issues.map((item) => item.id);

    expect(ids).toContain('rules.duplicateTitle');
    expect(ids).toContain('rules.duplicateLine');
    expect(ids).toContain('renderer.hostApiGuidanceMissing');
    expect(ids).toContain('renderer.ipcBanMissing');
    expect(ids).toContain('renderer.gatewayFetchBanMissing');
  });

  it('detects simple direct IPC and Gateway fetch conflicts', async () => {
    await writeFile(join(root, 'AGENTS.md'), [
      '# Rules',
      '',
      'Renderer code is allowed to use direct ipcRenderer.invoke for local calls.',
      'Renderer code must not use direct ipcRenderer.invoke in pages.',
      'Renderer may call direct Gateway fetch at 127.0.0.1:18789.',
      'Renderer must not call direct Gateway fetch at 127.0.0.1:18789.',
      '',
    ].join('\n'), 'utf8');

    const { createProjectRulesApi } = await import('@electron/services/project-rules-api');
    const result = await createProjectRulesApi().snapshot();
    const ids = result.issues.map((item) => item.id);

    expect(ids).toContain('renderer.ipcConflict');
    expect(ids).toContain('renderer.gatewayFetchConflict');
  });
});
