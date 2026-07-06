import { access, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRoleProfile } from '@shared/types/agent';

const { testHome, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  const root = process.env.CLAWX_TEST_TMPDIR ?? `${process.cwd()}/.tmp/vitest`;
  return {
    testHome: `${root}/clawx-agent-config-${suffix}`,
    testUserData: `${root}/clawx-agent-config-user-data-${suffix}`,
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = {
    ...actual,
    homedir: () => testHome,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => testUserData,
    getVersion: () => '0.0.0-test',
  },
}));

async function writeOpenClawJson(config: unknown): Promise<void> {
  const openclawDir = join(testHome, '.openclaw');
  await mkdir(openclawDir, { recursive: true });
  await writeFile(join(openclawDir, 'openclaw.json'), JSON.stringify(config, null, 2), 'utf8');
}

async function readOpenClawJson(): Promise<Record<string, unknown>> {
  const content = await readFile(join(testHome, '.openclaw', 'openclaw.json'), 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

describe('agent config lifecycle', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('lists configured agent ids from openclaw.json', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'test3', name: 'test3' },
        ],
      },
    });

    const { listConfiguredAgentIds } = await import('@electron/utils/agent-config');

    await expect(listConfiguredAgentIds()).resolves.toEqual(['main', 'test3']);
  });

  it('falls back to the implicit main agent when no list exists', async () => {
    await writeOpenClawJson({});

    const { listConfiguredAgentIds } = await import('@electron/utils/agent-config');

    await expect(listConfiguredAgentIds()).resolves.toEqual(['main']);
  });

  it('includes canonical per-agent main session keys in the snapshot', async () => {
    await writeOpenClawJson({
      session: {
        mainKey: 'desk',
      },
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'research', name: 'Research' },
        ],
      },
    });

    const { listAgentsSnapshot } = await import('@electron/utils/agent-config');

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'main',
          mainSessionKey: 'agent:main:desk',
        }),
        expect.objectContaining({
          id: 'research',
          mainSessionKey: 'agent:research:desk',
        }),
      ]),
    );
  });

  it('exposes effective and override model refs in the snapshot', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          model: {
            primary: 'moonshot/kimi-k2.6',
          },
        },
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'coder', name: 'Coder', model: { primary: 'ark/ark-code-latest' } },
        ],
      },
    });

    const { listAgentsSnapshot } = await import('@electron/utils/agent-config');
    const snapshot = await listAgentsSnapshot();
    const main = snapshot.agents.find((agent) => agent.id === 'main');
    const coder = snapshot.agents.find((agent) => agent.id === 'coder');

    expect(snapshot.defaultModelRef).toBe('moonshot/kimi-k2.6');
    expect(main).toMatchObject({
      modelRef: 'moonshot/kimi-k2.6',
      overrideModelRef: null,
      inheritedModel: true,
      modelDisplay: 'kimi-k2.6',
    });
    expect(coder).toMatchObject({
      modelRef: 'ark/ark-code-latest',
      overrideModelRef: 'ark/ark-code-latest',
      inheritedModel: false,
      modelDisplay: 'ark-code-latest',
    });
  });

  it('updates and clears per-agent model overrides', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          model: {
            primary: 'moonshot/kimi-k2.6',
          },
        },
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'coder', name: 'Coder' },
        ],
      },
    });

    const { listAgentsSnapshot, updateAgentModel } = await import('@electron/utils/agent-config');

    await updateAgentModel('coder', 'ark/ark-code-latest');
    let config = await readOpenClawJson();
    let coder = ((config.agents as { list: Array<{ id: string; model?: { primary?: string } }> }).list)
      .find((agent) => agent.id === 'coder');
    expect(coder?.model?.primary).toBe('ark/ark-code-latest');

    let snapshot = await listAgentsSnapshot();
    let snapshotCoder = snapshot.agents.find((agent) => agent.id === 'coder');
    expect(snapshotCoder).toMatchObject({
      modelRef: 'ark/ark-code-latest',
      overrideModelRef: 'ark/ark-code-latest',
      inheritedModel: false,
    });

    await updateAgentModel('coder', null);
    config = await readOpenClawJson();
    coder = ((config.agents as { list: Array<{ id: string; model?: unknown }> }).list)
      .find((agent) => agent.id === 'coder');
    expect(coder?.model).toBeUndefined();

    snapshot = await listAgentsSnapshot();
    snapshotCoder = snapshot.agents.find((agent) => agent.id === 'coder');
    expect(snapshotCoder).toMatchObject({
      modelRef: 'moonshot/kimi-k2.6',
      overrideModelRef: null,
      inheritedModel: true,
    });
  });

  it('rejects invalid model ref formats when updating agent model', async () => {
    await writeOpenClawJson({
      agents: {
        list: [{ id: 'main', name: 'Main', default: true }],
      },
    });

    const { updateAgentModel } = await import('@electron/utils/agent-config');

    await expect(updateAgentModel('main', 'invalid-model-ref')).rejects.toThrow(
      'modelRef must be in "provider/model" format',
    );
  });

  it('updates reasoning effort through OpenClaw thinking defaults', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'coder', name: 'Coder' },
        ],
      },
    });

    const { listAgentsSnapshot, updateAgentReasoningEffort } = await import('@electron/utils/agent-config');

    await updateAgentReasoningEffort('coder', 'high');
    let config = await readOpenClawJson();
    let coder = ((config.agents as { list: Array<{ id: string; reasoningEffort?: string; thinkingDefault?: string }> }).list)
      .find((agent) => agent.id === 'coder');
    expect(coder?.reasoningEffort).toBeUndefined();
    expect(coder?.thinkingDefault).toBe('high');

    let snapshot = await listAgentsSnapshot();
    expect(snapshot.agents.find((agent) => agent.id === 'coder')?.reasoningEffort).toBe('high');

    await updateAgentReasoningEffort('coder', 'auto');
    config = await readOpenClawJson();
    coder = ((config.agents as { list: Array<{ id: string; reasoningEffort?: string; thinkingDefault?: string }> }).list)
      .find((agent) => agent.id === 'coder');
    expect(coder?.reasoningEffort).toBeUndefined();
    expect(coder?.thinkingDefault).toBeUndefined();

    snapshot = await listAgentsSnapshot();
    expect(snapshot.agents.find((agent) => agent.id === 'coder')?.reasoningEffort).toBe('auto');
  });

  it('uses legacy OpenClaw thinkingDefault as the displayed reasoning effort', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'coder', name: 'Coder', thinkingDefault: 'xhigh' },
        ],
      },
    });

    const { listAgentsSnapshot } = await import('@electron/utils/agent-config');

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.agents.find((agent) => agent.id === 'coder')?.reasoningEffort).toBe('xhigh');
  });

  it('deletes the config entry, bindings, runtime directory, and managed workspace for a removed agent', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          model: {
            primary: 'custom-custom27/MiniMax-M2.7',
            fallbacks: [],
          },
        },
        list: [
          {
            id: 'main',
            name: 'Main',
            default: true,
            workspace: '~/.openclaw/workspace',
            agentDir: '~/.openclaw/agents/main/agent',
          },
          {
            id: 'test2',
            name: 'test2',
            workspace: '~/.openclaw/workspace-test2',
            agentDir: '~/.openclaw/agents/test2/agent',
          },
          {
            id: 'test3',
            name: 'test3',
            workspace: '~/.openclaw/workspace-test3',
            agentDir: '~/.openclaw/agents/test3/agent',
          },
        ],
      },
      channels: {
        feishu: {
          enabled: true,
        },
      },
      bindings: [
        {
          agentId: 'test2',
          match: {
            channel: 'feishu',
          },
        },
      ],
    });

    const test2RuntimeDir = join(testHome, '.openclaw', 'agents', 'test2');
    const test2WorkspaceDir = join(testHome, '.openclaw', 'workspace-test2');
    await mkdir(join(test2RuntimeDir, 'agent'), { recursive: true });
    await mkdir(join(test2RuntimeDir, 'sessions'), { recursive: true });
    await mkdir(join(test2WorkspaceDir, '.openclaw'), { recursive: true });
    await writeFile(
      join(test2RuntimeDir, 'agent', 'auth-profiles.json'),
      JSON.stringify({ version: 1, profiles: {} }, null, 2),
      'utf8',
    );
    await writeFile(join(test2WorkspaceDir, 'AGENTS.md'), '# test2', 'utf8');

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { deleteAgentConfig } = await import('@electron/utils/agent-config');

    const { snapshot } = await deleteAgentConfig('test2');

    expect(snapshot.agents.map((agent) => agent.id)).toEqual(['main', 'test3']);
    expect(snapshot.channelOwners.feishu).toBe('main');

    const config = await readOpenClawJson();
    expect((config.agents as { list: Array<{ id: string }> }).list.map((agent) => agent.id)).toEqual([
      'main',
      'test3',
    ]);
    expect(config.bindings).toEqual([]);
    await expect(access(test2RuntimeDir)).rejects.toThrow();
    // Workspace deletion is intentionally deferred by `deleteAgentConfig` to avoid
    // ENOENT errors during Gateway restart, so it should still exist here.
    await expect(access(test2WorkspaceDir)).resolves.toBeUndefined();

    infoSpy.mockRestore();
  });

  it('preserves unmanaged custom workspaces when deleting an agent', async () => {
    const customWorkspaceDir = join(testHome, 'custom-workspace-test2');

    await writeOpenClawJson({
      agents: {
        list: [
          {
            id: 'main',
            name: 'Main',
            default: true,
            workspace: '~/.openclaw/workspace',
            agentDir: '~/.openclaw/agents/main/agent',
          },
          {
            id: 'test2',
            name: 'test2',
            workspace: customWorkspaceDir,
            agentDir: '~/.openclaw/agents/test2/agent',
          },
        ],
      },
    });

    await mkdir(join(testHome, '.openclaw', 'agents', 'test2', 'agent'), { recursive: true });
    await mkdir(customWorkspaceDir, { recursive: true });
    await writeFile(join(customWorkspaceDir, 'AGENTS.md'), '# custom', 'utf8');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { deleteAgentConfig } = await import('@electron/utils/agent-config');

    await deleteAgentConfig('test2');

    await expect(access(customWorkspaceDir)).resolves.toBeUndefined();

    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it('does not delete a legacy-named account when it is owned by another agent', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'test2', name: 'test2' },
          { id: 'test3', name: 'test3' },
        ],
      },
      channels: {
        feishu: {
          enabled: true,
          defaultAccount: 'default',
          accounts: {
            default: { enabled: true, appId: 'main-app' },
            test2: { enabled: true, appId: 'legacy-test2-app' },
          },
        },
      },
      bindings: [
        {
          agentId: 'test3',
          match: {
            channel: 'feishu',
            accountId: 'test2',
          },
        },
      ],
    });

    const { deleteAgentConfig } = await import('@electron/utils/agent-config');
    await deleteAgentConfig('test2');

    const config = await readOpenClawJson();
    const feishu = (config.channels as Record<string, unknown>).feishu as {
      accounts?: Record<string, unknown>;
    };
    expect(feishu.accounts?.test2).toBeDefined();
  });

  it('allows the same agent to bind multiple different channels', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
        ],
      },
      channels: {
        feishu: { enabled: true },
        telegram: { enabled: true },
      },
    });

    const { assignChannelAccountToAgent, listAgentsSnapshot } = await import('@electron/utils/agent-config');

    await assignChannelAccountToAgent('main', 'feishu', 'default');
    await assignChannelAccountToAgent('main', 'telegram', 'default');

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.channelAccountOwners['feishu:default']).toBe('main');
    expect(snapshot.channelAccountOwners['telegram:default']).toBe('main');
  });

  it('keeps sibling account bindings for the same agent and channel', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
        ],
      },
      channels: {
        feishu: {
          enabled: true,
          defaultAccount: 'default',
          accounts: {
            default: { enabled: true, appId: 'main-app' },
            alt: { enabled: true, appId: 'alt-app' },
          },
        },
      },
    });

    const { assignChannelAccountToAgent, listAgentsSnapshot } = await import('@electron/utils/agent-config');

    await assignChannelAccountToAgent('main', 'feishu', 'default');
    await assignChannelAccountToAgent('main', 'feishu', 'alt');

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.channelAccountOwners['feishu:default']).toBe('main');
    expect(snapshot.channelAccountOwners['feishu:alt']).toBe('main');
  });

  it('preserves original agentId casing when persisting bindings', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'MainAgent', name: 'Main Agent', default: true },
        ],
      },
      channels: {
        feishu: {
          enabled: true,
          accounts: {
            default: { enabled: true, appId: 'main-app' },
          },
        },
      },
    });

    const { assignChannelAccountToAgent } = await import('@electron/utils/agent-config');

    await assignChannelAccountToAgent('MainAgent', 'feishu', 'default');

    const config = await readOpenClawJson();
    expect(config.bindings).toEqual([
      {
        agentId: 'MainAgent',
        match: { channel: 'feishu', accountId: 'default' },
      },
    ]);
  });

  it('keeps a single owner for the same channel account', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'test2', name: 'test2' },
        ],
      },
      channels: {
        feishu: {
          enabled: true,
          accounts: {
            default: { enabled: true, appId: 'main-app' },
          },
        },
      },
    });

    const { assignChannelAccountToAgent, listAgentsSnapshot } = await import('@electron/utils/agent-config');

    await assignChannelAccountToAgent('main', 'feishu', 'default');
    await assignChannelAccountToAgent('test2', 'feishu', 'default');

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.channelAccountOwners['feishu:default']).toBe('test2');
  });

  it('can clear one channel account binding without affecting another channel on the same agent', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
        ],
      },
      channels: {
        feishu: { enabled: true },
        telegram: { enabled: true },
      },
    });

    const { assignChannelAccountToAgent, clearChannelBinding, listAgentsSnapshot } = await import('@electron/utils/agent-config');

    await assignChannelAccountToAgent('main', 'feishu', 'default');
    await assignChannelAccountToAgent('main', 'telegram', 'default');
    await clearChannelBinding('feishu', 'default');

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.channelAccountOwners['feishu:default']).toBeUndefined();
    expect(snapshot.channelAccountOwners['telegram:default']).toBe('main');
  });

  it('avoids numeric-only ids when creating agents from CJK names', async () => {
    await writeOpenClawJson({
      agents: {
        list: [{ id: 'main', name: 'Main', default: true }],
      },
    });

    const { createAgent, listAgentsSnapshot } = await import('@electron/utils/agent-config');

    await createAgent('测试2');
    await createAgent('测试1');

    const snapshot = await listAgentsSnapshot();
    const agentIds = snapshot.agents.map((agent) => agent.id);

    expect(agentIds).toContain('agent');
    expect(agentIds).toContain('agent-2');
    expect(agentIds).not.toContain('2');
    expect(agentIds).not.toContain('1');
  });

  it('seeds a default Verse Claw IDENTITY.md for newly created agent workspaces', async () => {
    await writeOpenClawJson({
      agents: {
        list: [{ id: 'main', name: 'Main', default: true }],
      },
    });

    const { createAgent } = await import('@electron/utils/agent-config');

    await createAgent('Research');

    await expect(readFile(join(testHome, '.openclaw', 'workspace-research', 'IDENTITY.md'), 'utf8')).resolves.toContain('Verse Claw');
    await expect(readFile(join(testHome, '.openclaw', 'workspace-research', '.verse-claw', 'harness', 'README.md'), 'utf8')).resolves.toContain('Verse Claw Agent Harness');
  });
});

// ── Area 1: Persona sidecar round-trip ───────────────────────────────────
//
// Validates that writeAgentRoleProfile → readAgentRoleProfile is identity when
// the sidecar is present (lossless), and falls back to heuristic parse when
// the sidecar is deleted (regression guard, with the known customStyle drop
// documented as an expected exception).
describe('role profile sidecar round-trip (Area 1 §3.3)', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  /** Full profile exercising every AgentRoleProfile field. */
  function fullProfile(): AgentRoleProfile {
    return {
      displayName: '研究员',
      role: '代码助手',
      customRole: '全栈研究员',
      verbosity: 'detailed',
      tone: 'formal',
      language: 'zh-CN',
      customStyle: '使用中文回复，代码注释用英文',
      expertise: ['TypeScript', '系统设计', '测试驱动开发'],
      limitations: ['不能访问生产数据库', '不处理 PII 数据'],
      backstory: '曾在大厂工作多年，熟悉分布式系统和工程最佳实践。',
    };
  }

  it('write → read is identity via sidecar (lossless)', async () => {
    await writeOpenClawJson({
      agents: {
        list: [{ id: 'main', name: 'Main', default: true }],
      },
    });

    const { writeAgentRoleProfile, readAgentRoleProfile } = await import('@electron/utils/agent-config');
    const profile = fullProfile();
    await writeAgentRoleProfile('main', profile);
    const read = await readAgentRoleProfile('main');

    // Sidecar path: every field including customStyle and customRole survives.
    expect(read).toEqual(profile);
  });

  it('sidecar file exists next to SOUL.md after write', async () => {
    await writeOpenClawJson({
      agents: {
        list: [{ id: 'main', name: 'Main', default: true }],
      },
    });

    const { writeAgentRoleProfile } = await import('@electron/utils/agent-config');
    await writeAgentRoleProfile('main', fullProfile());

    const workspace = join(testHome, '.openclaw', 'workspace');
    await expect(access(join(workspace, 'SOUL.md'))).resolves.toBeUndefined();
    await expect(access(join(workspace, 'role-profile.json'))).resolves.toBeUndefined();
  });

  it('falls back to heuristic parse when sidecar is deleted (customStyle is lost)', async () => {
    await writeOpenClawJson({
      agents: {
        list: [{ id: 'main', name: 'Main', default: true }],
      },
    });

    const { writeAgentRoleProfile, readAgentRoleProfile } = await import('@electron/utils/agent-config');
    const profile = fullProfile();
    await writeAgentRoleProfile('main', profile);

    // Delete the sidecar — simulates a pre-Area-1 agent or manual cleanup.
    const sidecarPath = join(testHome, '.openclaw', 'workspace', 'role-profile.json');
    await rm(sidecarPath, { force: true });

    const read = await readAgentRoleProfile('main');

    // Heuristic parse preserves the core fields that SOUL.md encodes.
    // displayName stays as the entry name ('Main') — the parser only updates
    // it from the first line when it's empty or 'Agent'.
    expect(read.displayName).toBe('Main');
    // role is parsed from the first line "X 是一个 Y。" — Y is the customRole
    // value ('全栈研究员'), not the original role ('代码助手'), because
    // compileRoleProfileToMarkdown uses `customRole || role` as the label.
    expect(read.role).toBe('全栈研究员');
    expect(read.verbosity).toBe('detailed');
    expect(read.tone).toBe('formal');
    expect(read.language).toBe('zh-CN');
    expect(read.expertise).toEqual(['TypeScript', '系统设计', '测试驱动开发']);
    expect(read.limitations).toEqual(['不能访问生产数据库', '不处理 PII 数据']);
    expect(read.backstory).toContain('大厂工作多年');

    // Known lossy fields: customRole and customStyle are NOT recovered by the
    // heuristic parser. This is the documented regression the sidecar fixes.
    // The test asserts the current (pre-sidecar) behavior so future changes
    // to the parser are intentional, not accidental.
    expect(read.customRole).toBeUndefined();
    expect(read.customStyle).toBeUndefined();
  });

  it('falls back to heuristic parse when SOUL.md is hand-edited (hash mismatch)', async () => {
    await writeOpenClawJson({
      agents: {
        list: [{ id: 'main', name: 'Main', default: true }],
      },
    });

    const { writeAgentRoleProfile, readAgentRoleProfile } = await import('@electron/utils/agent-config');
    const profile = fullProfile();
    await writeAgentRoleProfile('main', profile);

    // Simulate the user hand-editing SOUL.md directly — user edits always win.
    const soulPath = join(testHome, '.openclaw', 'workspace', 'SOUL.md');
    await writeFile(soulPath, 'Main 是一个 手编角色。\n', 'utf8');

    const read = await readAgentRoleProfile('main');
    // The sidecar's soulHash no longer matches → heuristic parse kicks in.
    // The hand-edited content is what the user sees, not the stale sidecar.
    expect(read.displayName).toBe('Main'); // entry name, not sidecar's '研究员'
    expect(read.role).toBe('手编角色'); // parsed from hand-edited first line
    // customStyle from the sidecar is NOT used — user edit wins.
    expect(read.customStyle).toBeUndefined();
  });
});
