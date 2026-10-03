import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCapabilityPublicationResult,
} from '../../openclaw_runtime/src/runtime-core/capability-publications';
import type { OpenClawConfig } from '../../openclaw_runtime/src/config/types.openclaw';

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'clawx-capability-publications-'));
  tempDirs.push(dir);
  await mkdir(join(dir, 'skills'), { recursive: true });
  return dir;
}

async function writeSkill(workspaceDir: string, params: {
  dirName: string;
  name: string;
  key: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
}): Promise<void> {
  const skillDir = join(workspaceDir, 'skills', params.dirName);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, 'SKILL.md'),
    [
      '---',
      `name: ${params.name}`,
      `description: ${params.name} publication test skill.`,
      params.disableModelInvocation === undefined
        ? undefined
        : `disable-model-invocation: ${params.disableModelInvocation}`,
      params.userInvocable === undefined
        ? undefined
        : `user-invocable: ${params.userInvocable}`,
      'metadata:',
      '  openclaw:',
      `    skillKey: ${params.key}`,
      '---',
      '',
      `# ${params.name}`,
      '',
      'Test skill body.',
    ].filter((line): line is string => line !== undefined).join('\n'),
    'utf8',
  );
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('runtime capability publications', () => {
  it('projects agent skill filters with defaults, per-agent overrides, and skillKey matching', async () => {
    const workspaceDir = await makeWorkspace();
    const suffix = Date.now().toString(36);
    const alphaName = `Publication Test Alpha ${suffix}`;
    const betaName = `Publication Test Beta ${suffix}`;
    const alphaKey = `publication-test-alpha-${suffix}`;
    const betaKey = `publication-test-beta-${suffix}`;
    await writeSkill(workspaceDir, { dirName: 'alpha', name: alphaName, key: alphaKey });
    await writeSkill(workspaceDir, {
      dirName: 'beta',
      name: betaName,
      key: betaKey,
      disableModelInvocation: true,
      userInvocable: false,
    });

    const cfg = {
      agents: {
        defaults: { workspace: workspaceDir, skills: [alphaKey] },
        list: [
          { id: 'main', workspace: workspaceDir },
          { id: 'empty-agent', workspace: workspaceDir, skills: [] },
          { id: 'named-agent', workspace: workspaceDir, skills: [betaName] },
        ],
      },
    } satisfies OpenClawConfig;

    const defaultResult = buildCapabilityPublicationResult({
      cfg,
      query: { agentId: 'main', workspaceId: workspaceDir },
    });
    expect(defaultResult.publications.filter((entry) => entry.kind === 'skill').map((entry) => entry.sourceId))
      .toEqual([alphaKey]);
    expect(defaultResult.publications.find((entry) => entry.sourceId === alphaKey)?.useModes)
      .toEqual(['prompt', 'adminAction', 'userCommand']);

    const emptyResult = buildCapabilityPublicationResult({
      cfg,
      query: { agentId: 'empty-agent', workspaceId: workspaceDir },
    });
    expect(emptyResult.publications.filter((entry) => entry.kind === 'skill'))
      .toHaveLength(0);

    const namedResult = buildCapabilityPublicationResult({
      cfg,
      query: { agentId: 'named-agent', workspaceId: workspaceDir },
    });
    const beta = namedResult.publications.find((entry) => entry.sourceId === betaKey);
    expect(beta?.exposure.promptVisible).toBe(false);
    expect(beta?.exposure.userInvocable).toBe(false);
    expect(beta?.useModes).toEqual(['adminAction']);
  });

  it('filters MCP publications by exposure while preserving legacy global servers', () => {
    const cfg = {
      agents: {
        defaults: { skills: [] },
        list: [
          { id: 'agent-a', skills: [] },
          { id: 'agent-b', skills: [] },
        ],
      },
      mcp: {
        servers: {
          legacy: { command: 'node', args: ['legacy.js'] },
          agentOnly: { command: 'node', args: ['agent.js'], exposure: { agents: ['agent-a'] } },
          workspaceOnly: { command: 'node', args: ['workspace.js'], exposure: { workspaces: ['workspace-a'] } },
          roleOnly: { command: 'node', args: ['role.js'], exposure: { roles: ['builder'] } },
          cancelled: { command: 'node', args: ['cancelled.js'], exposure: { agents: [] } },
        },
      },
    } satisfies OpenClawConfig;

    const allowed = buildCapabilityPublicationResult({
      cfg,
      query: { agentId: 'agent-a', workspaceId: 'workspace-a', roleName: 'builder' },
    });
    expect(allowed.publications.filter((entry) => entry.kind === 'mcp').map((entry) => entry.sourceId).sort())
      .toEqual(['agentOnly', 'legacy', 'roleOnly', 'workspaceOnly']);
    expect(allowed.publications.find((entry) => entry.sourceId === 'roleOnly')?.owner)
      .toEqual({ type: 'role', id: 'builder' });
    expect(allowed.publications.find((entry) => entry.sourceId === 'workspaceOnly')?.scope)
      .toBe('workspace');

    const narrowed = buildCapabilityPublicationResult({
      cfg,
      query: { agentId: 'agent-b', workspaceId: 'workspace-b', roleName: 'reviewer' },
    });
    expect(narrowed.publications.filter((entry) => entry.kind === 'mcp').map((entry) => entry.sourceId))
      .toEqual(['legacy']);
    expect(narrowed.publications.some((entry) => entry.sourceId === 'cancelled')).toBe(false);
  });

  it('uses role policy only as a publication narrowing and diagnostic layer', () => {
    const cfg = {
      agents: {
        defaults: { skills: [] },
        list: [{ id: 'main', skills: [] }],
        roles: [
          {
            name: 'capability-test-role',
            displayName: 'Capability Test Role',
            rolePrompt: 'Narrow published capabilities for this focused test role.',
            tools: ['mcp:allowed-server'],
            // Required by the role but never published in this context, so the
            // result must carry a roleToolRequirementMissing warning.
            toolRequirements: ['mcp:missing-server'],
            permissions: { filesystem: 'read', network: 'none', commands: [] },
            outputSchema: { format: 'markdown' },
          },
        ],
      },
      mcp: {
        servers: {
          'allowed-server': { command: 'node', args: ['allowed.js'] },
          'blocked-server': { command: 'node', args: ['blocked.js'] },
        },
      },
    } satisfies OpenClawConfig;

    const result = buildCapabilityPublicationResult({
      cfg,
      query: { agentId: 'main', roleName: 'capability-test-role', includeDiagnostics: true },
    });

    expect(result.publications.find((entry) => entry.sourceId === 'allowed-server')?.state)
      .toBe('published');
    const blocked = result.publications.find((entry) => entry.sourceId === 'blocked-server');
    expect(blocked?.state).toBe('blocked');
    expect(blocked?.diagnostics.some((entry) => entry.code === 'roleToolsFilter')).toBe(true);
    expect(result.diagnostics.some((entry) => entry.code === 'roleToolRequirementMissing')).toBe(true);
  });
});
