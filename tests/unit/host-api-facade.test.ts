import { beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const hostInvoke = vi.fn();

beforeEach(() => {
  hostInvoke.mockReset();
  vi.resetModules();
  vi.stubGlobal('window', {
    verseClaw: { hostInvoke },
  });
});

describe('hostApi facade', () => {
  it('calls settings.getAll through hostInvoke', async () => {
    hostInvoke.mockResolvedValueOnce({ id: 'req', ok: true, data: { theme: 'dark' } });
    const { hostApi } = await import('@/lib/host-api');

    await expect(hostApi.settings.getAll()).resolves.toEqual({ theme: 'dark' });
    expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
      module: 'settings',
      action: 'getAll',
    }));
  });

  it('throws response errors', async () => {
    hostInvoke.mockResolvedValueOnce({
      id: 'req',
      ok: false,
      error: { code: 'INTERNAL', message: 'disk failed' },
    });
    const { hostApi } = await import('@/lib/host-api');

    await expect(hostApi.settings.getAll()).rejects.toThrow('disk failed');
  });

  it('calls settings.setMany and reset through hostInvoke', async () => {
    hostInvoke
      .mockResolvedValueOnce({ id: 'req-1', ok: true, data: { success: true } })
      .mockResolvedValueOnce({ id: 'req-2', ok: true, data: { success: true, settings: { theme: 'system' } } });
    const { hostApi } = await import('@/lib/host-api');

    await expect(hostApi.settings.setMany({ theme: 'dark' })).resolves.toEqual({ success: true });
    await expect(hostApi.settings.reset()).resolves.toEqual({
      success: true,
      settings: { theme: 'system' },
    });
    expect(hostInvoke).toHaveBeenNthCalledWith(1, expect.objectContaining({
      module: 'settings',
      action: 'setMany',
      payload: { patch: { theme: 'dark' } },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(2, expect.objectContaining({
      module: 'settings',
      action: 'reset',
    }));
  });

  it('routes project rules methods through hostInvoke', async () => {
    hostInvoke
      .mockResolvedValueOnce({ id: 'req-1', ok: true, data: { success: true, ruleFiles: [] } })
      .mockResolvedValueOnce({ id: 'req-2', ok: true, data: { success: true, templateCreated: true, ruleFiles: [] } });
    const { hostApi } = await import('@/lib/host-api');

    await expect(hostApi.projectRules.snapshot()).resolves.toEqual({ success: true, ruleFiles: [] });
    await expect(hostApi.projectRules.createAgentsTemplate()).resolves.toEqual({
      success: true,
      templateCreated: true,
      ruleFiles: [],
    });
    expect(hostInvoke).toHaveBeenNthCalledWith(1, expect.objectContaining({
      module: 'projectRules',
      action: 'snapshot',
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(2, expect.objectContaining({
      module: 'projectRules',
      action: 'createAgentsTemplate',
    }));
  });

  it('routes agent browser methods through hostInvoke', async () => {
    hostInvoke
      .mockResolvedValueOnce({ id: 'req-1', ok: true, data: { success: true, session: { id: 'browser-1' } } })
      .mockResolvedValueOnce({ id: 'req-2', ok: true, data: { success: true, profiles: [{ profile: 'default' }] } })
      .mockResolvedValueOnce({ id: 'req-3', ok: true, data: { success: true, profile: { profile: 'work' } } })
      .mockResolvedValueOnce({ id: 'req-4', ok: true, data: { success: true, ok: true, title: 'Ready' } })
      .mockResolvedValueOnce({ id: 'req-5', ok: true, data: { success: true, session: { id: 'browser-1' } } })
      .mockResolvedValueOnce({
        id: 'req-6',
        ok: true,
        data: {
          success: true,
          session: { id: 'browser-1' },
          data: { logs: [] },
          stdout: '{"success":true,"data":{"logs":[]}}',
          stderr: '',
          command: ['--json', 'console'],
        },
      });
    const { hostApi } = await import('@/lib/host-api');

    await expect(hostApi.agentBrowser.open({ url: 'https://example.com' })).resolves.toMatchObject({
      success: true,
      session: { id: 'browser-1' },
    });
    await expect(hostApi.agentBrowser.profiles()).resolves.toMatchObject({
      success: true,
      profiles: [{ profile: 'default' }],
    });
    await expect(hostApi.agentBrowser.saveProfile({ profile: 'Work' })).resolves.toMatchObject({
      success: true,
      profile: { profile: 'work' },
    });
    await expect(hostApi.agentBrowser.validate({ url: 'https://example.com' })).resolves.toMatchObject({
      success: true,
      ok: true,
      title: 'Ready',
    });
    await expect(hostApi.agentBrowser.click({
      sessionId: 'browser-1',
      selector: '#publish',
    })).resolves.toMatchObject({ success: true });
    await expect(hostApi.agentBrowser.command({
      sessionId: 'browser-1',
      args: ['console'],
    })).resolves.toMatchObject({ success: true, data: { logs: [] } });

    expect(hostInvoke).toHaveBeenNthCalledWith(1, expect.objectContaining({
      module: 'agentBrowser',
      action: 'open',
      payload: { url: 'https://example.com' },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(2, expect.objectContaining({
      module: 'agentBrowser',
      action: 'profiles',
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(3, expect.objectContaining({
      module: 'agentBrowser',
      action: 'saveProfile',
      payload: { profile: 'Work' },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(4, expect.objectContaining({
      module: 'agentBrowser',
      action: 'validate',
      payload: { url: 'https://example.com' },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(5, expect.objectContaining({
      module: 'agentBrowser',
      action: 'click',
      payload: { sessionId: 'browser-1', selector: '#publish' },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(6, expect.objectContaining({
      module: 'agentBrowser',
      action: 'command',
      payload: { sessionId: 'browser-1', args: ['console'] },
    }));
  });

  it('routes code review methods through hostInvoke', async () => {
    hostInvoke
      .mockResolvedValueOnce({
        id: 'req-1',
        ok: true,
        data: {
          success: true,
          review: {
            runId: 'review-1',
            readonly: true,
            status: 'completed',
            target: { kind: 'uncommitted', label: 'Uncommitted changes' },
            summary: 'ok',
            diffStats: { files: 1, additions: 1, deletions: 0, patchBytes: 10, truncated: false },
            findings: [],
            evidenceRefs: [],
            startedAt: '2026-01-01T00:00:00.000Z',
            endedAt: '2026-01-01T00:00:01.000Z',
          },
        },
      })
      .mockResolvedValueOnce({
        id: 'req-2',
        ok: true,
        data: { success: true, nodeId: 'node-1', snapshot: { nodes: [] } },
      });
    const { hostApi } = await import('@/lib/host-api');

    await expect(hostApi.codeReview.run({
      target: { kind: 'uncommitted' },
      focus: 'tests',
    })).resolves.toMatchObject({ success: true, review: { readonly: true } });
    await expect(hostApi.codeReview.createTaskLedgerNode({
      runId: 'review-1',
      findingId: 'finding-1',
    })).resolves.toMatchObject({ success: true, nodeId: 'node-1' });

    expect(hostInvoke).toHaveBeenNthCalledWith(1, expect.objectContaining({
      module: 'codeReview',
      action: 'run',
      payload: { target: { kind: 'uncommitted' }, focus: 'tests' },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(2, expect.objectContaining({
      module: 'codeReview',
      action: 'createTaskLedgerNode',
      payload: { runId: 'review-1', findingId: 'finding-1' },
    }));
  });

  it('routes openclaw, shell, dialog, window, and updates methods through hostInvoke', async () => {
    hostInvoke
      .mockResolvedValueOnce({ id: 'req-1', ok: true, data: { packageExists: true, isBuilt: true, entryPath: '/openclaw/openclaw.mjs', dir: '/openclaw' } })
      .mockResolvedValueOnce({ id: 'req-2', ok: true, data: '' })
      .mockResolvedValueOnce({ id: 'req-3', ok: true, data: { canceled: false, filePaths: ['/tmp/a.txt'] } })
      .mockResolvedValueOnce({ id: 'req-4', ok: true, data: undefined })
      .mockResolvedValueOnce({ id: 'req-5', ok: true, data: { success: true, status: { status: 'not-available' } } });
    const { hostApi } = await import('@/lib/host-api');

    await hostApi.openclaw.status();
    await hostApi.shell.openPath('/tmp/a.txt');
    await hostApi.dialog.open({ properties: ['openFile'] });
    await hostApi.window.maximize();
    await hostApi.updates.check();

    expect(hostInvoke).toHaveBeenNthCalledWith(1, expect.objectContaining({
      module: 'openclaw',
      action: 'status',
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(2, expect.objectContaining({
      module: 'shell',
      action: 'openPath',
      payload: { path: '/tmp/a.txt' },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(3, expect.objectContaining({
      module: 'dialog',
      action: 'open',
      payload: { properties: ['openFile'] },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(4, expect.objectContaining({
      module: 'window',
      action: 'maximize',
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(5, expect.objectContaining({
      module: 'updates',
      action: 'check',
    }));
  });

  it('routes uv installer setup through hostInvoke', async () => {
    hostInvoke.mockResolvedValueOnce({ id: 'req', ok: true, data: { success: true } });
    const { hostApi } = await import('@/lib/host-api');

    await expect(hostApi.uv.installAll()).resolves.toEqual({ success: true });
    expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
      module: 'uv',
      action: 'installAll',
    }));
  });

  it('routes git methods through hostInvoke', async () => {
    hostInvoke
      .mockResolvedValueOnce({ id: 'req-1', ok: true, data: { success: true, status: { isRepository: true, changes: [] } } })
      .mockResolvedValueOnce({ id: 'req-2', ok: true, data: { success: true, path: 'src/app.ts', mode: 'unstaged', patch: 'diff' } })
      .mockResolvedValueOnce({ id: 'req-3', ok: true, data: { success: true } })
      .mockResolvedValueOnce({ id: 'req-4', ok: true, data: { success: true } });
    const { hostApi } = await import('@/lib/host-api');

    await hostApi.git.status();
    await hostApi.git.fileDiff({ path: 'src/app.ts', mode: 'unstaged' });
    await hostApi.git.stage({ paths: ['src/app.ts'] });
    await hostApi.git.revertFile({ path: 'src/app.ts' });

    expect(hostInvoke).toHaveBeenNthCalledWith(1, expect.objectContaining({
      module: 'git',
      action: 'status',
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(2, expect.objectContaining({
      module: 'git',
      action: 'fileDiff',
      payload: { path: 'src/app.ts', mode: 'unstaged' },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(3, expect.objectContaining({
      module: 'git',
      action: 'stage',
      payload: { paths: ['src/app.ts'] },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(4, expect.objectContaining({
      module: 'git',
      action: 'revertFile',
      payload: { path: 'src/app.ts' },
    }));
  });

  it('passes log file path and tail lines through hostInvoke', async () => {
    hostInvoke.mockResolvedValueOnce({ id: 'req', ok: true, data: { content: 'tail' } });
    const { hostApi } = await import('@/lib/host-api');

    await expect(hostApi.logs.readFile('/tmp/verse-claw.log', 50)).resolves.toEqual({ content: 'tail' });
    expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
      module: 'logs',
      action: 'readFile',
      payload: { path: '/tmp/verse-claw.log', tailLines: 50 },
    }));
  });

  it('calls channels.accounts through hostInvoke with options', async () => {
    hostInvoke.mockResolvedValueOnce({ id: 'req', ok: true, data: { success: true, channels: [] } });
    const { hostApi } = await import('@/lib/host-api');

    await expect(hostApi.channels.accounts({ mode: 'config', probe: false })).resolves.toEqual({
      success: true,
      channels: [],
    });
    expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
      module: 'channels',
      action: 'accounts',
      payload: { mode: 'config', probe: false },
    }));
  });

  it('passes channel credential validation payload through hostInvoke', async () => {
    hostInvoke.mockResolvedValueOnce({
      id: 'req',
      ok: true,
      data: { success: true, valid: true, errors: [], warnings: [] },
    });
    const { hostApi } = await import('@/lib/host-api');

    const config = { appId: 'cli_a', appSecret: 'secret' };
    await expect(hostApi.channels.validateCredentials('feishu', config)).resolves.toEqual({
      success: true,
      valid: true,
      errors: [],
      warnings: [],
    });
    expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
      module: 'channels',
      action: 'validateCredentials',
      payload: { channelType: 'feishu', config },
    }));
  });

  it('passes channel target lookup payload through hostInvoke', async () => {
    hostInvoke.mockResolvedValueOnce({
      id: 'req',
      ok: true,
      data: { success: true, channelType: 'feishu', accountId: 'default', targets: [] },
    });
    const { hostApi } = await import('@/lib/host-api');

    await expect(hostApi.channels.targets({
      channelType: 'feishu',
      accountId: 'default',
      query: 'alice',
    })).resolves.toEqual({
      success: true,
      channelType: 'feishu',
      accountId: 'default',
      targets: [],
    });
    expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
      module: 'channels',
      action: 'targets',
      payload: { channelType: 'feishu', accountId: 'default', query: 'alice' },
    }));
  });

  it('calls agents.list through hostInvoke', async () => {
    hostInvoke.mockResolvedValueOnce({ id: 'req', ok: true, data: { success: true, agents: [] } });
    const { hostApi } = await import('@/lib/host-api');

    await expect(hostApi.agents.list()).resolves.toEqual({ success: true, agents: [] });
    expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
      module: 'agents',
      action: 'list',
    }));
  });

  it('calls providers.list through hostInvoke', async () => {
    hostInvoke.mockResolvedValueOnce({ id: 'req', ok: true, data: [] });
    const { hostApi } = await import('@/lib/host-api');

    await expect(hostApi.providers.list()).resolves.toEqual([]);
    expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
      module: 'providers',
      action: 'list',
    }));
  });

  it('passes provider validation payload through hostInvoke', async () => {
    hostInvoke.mockResolvedValueOnce({ id: 'req', ok: true, data: { valid: true } });
    const { hostApi } = await import('@/lib/host-api');

    const input = { accountId: 'custom', apiKey: 'sk-test' };
    await expect(hostApi.providers.validateKey(input)).resolves.toEqual({ valid: true });
    expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
      module: 'providers',
      action: 'validateKey',
      payload: input,
    }));
  });

  it('passes provider OAuth requests through hostInvoke', async () => {
    hostInvoke
      .mockResolvedValueOnce({ id: 'req-1', ok: true, data: { success: true } })
      .mockResolvedValueOnce({ id: 'req-2', ok: true, data: { success: true } });
    const { hostApi } = await import('@/lib/host-api');

    await expect(hostApi.providers.requestOAuth({
      ['provider']: 'openai',
      accountId: 'openai',
      label: 'OpenAI',
    })).resolves.toEqual({ success: true });
    await expect(hostApi.providers.cancelOAuth()).resolves.toEqual({ success: true });
    expect(hostInvoke).toHaveBeenNthCalledWith(1, expect.objectContaining({
      module: 'providers',
      action: 'requestOAuth',
      payload: { ['provider']: 'openai', accountId: 'openai', label: 'OpenAI' },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(2, expect.objectContaining({
      module: 'providers',
      action: 'cancelOAuth',
    }));
  });

  it('calls chat.sendWithMedia through hostInvoke', async () => {
    hostInvoke.mockResolvedValueOnce({ id: 'req', ok: true, data: { success: true } });
    const { hostApi } = await import('@/lib/host-api');

    await hostApi.chat.sendWithMedia({ sessionKey: 'main', message: 'hello', idempotencyKey: 'k' });
    expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
      module: 'chat',
      action: 'sendWithMedia',
    }));
  });

  it('calls work provider APIs through hostInvoke', async () => {
    hostInvoke
      .mockResolvedValueOnce({ id: 'req-1', ok: true, data: { success: true, providers: [], capabilities: [], kitCapabilities: [], summary: {} } })
      .mockResolvedValueOnce({ id: 'req-2', ok: true, data: { success: true, output: { kind: 'csv' } } })
      .mockResolvedValueOnce({ id: 'req-3', ok: true, data: { success: true, valid: true, artifactType: 'csv' } });
    const { hostApi } = await import('@/lib/host-api');

    await hostApi.workProviders.status();
    await hostApi.workProviders.run({ capability: 'csv.read', input: { path: 'C:/workspace/data.csv' } });
    await hostApi.workProviders.validateArtifact({ path: 'C:/workspace/data.csv' });

    expect(hostInvoke).toHaveBeenNthCalledWith(1, expect.objectContaining({
      module: 'workProviders',
      action: 'status',
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(2, expect.objectContaining({
      module: 'workProviders',
      action: 'run',
      payload: { capability: 'csv.read', input: { path: 'C:/workspace/data.csv' } },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(3, expect.objectContaining({
      module: 'workProviders',
      action: 'validateArtifact',
      payload: { path: 'C:/workspace/data.csv' },
    }));
  });

  it('calls knowledge APIs through hostInvoke', async () => {
    hostInvoke.mockResolvedValue({ id: 'req', ok: true, data: { success: true } });
    const { hostApi } = await import('@/lib/host-api');

    await hostApi.knowledge.search({ query: 'project notes', corpus: 'wiki' });
    await hostApi.knowledge.applyDraft({ title: 'Decision', body: 'Use native wiki.', sourceIds: ['s1'] });
    await hostApi.knowledge.validateOkfBundle({ path: 'C:/okf' });
    await hostApi.knowledge.importOkfBundle({ path: 'C:/okf', conceptIds: ['alpha'] });
    await hostApi.knowledge.createInboxItem({ title: 'Candidate', body: 'Body', kind: 'chat-session' });
    await hostApi.knowledge.promoteInboxItemToDraft({ id: 'inbox-1' });
    await hostApi.knowledge.recordKnowledgeReference({ targetId: 'notes/a.md', reference: { kind: 'search', lookup: 'notes/a.md' } });
    await hostApi.knowledge.runtimeLessonsReport();

    expect(hostInvoke).toHaveBeenNthCalledWith(1, expect.objectContaining({
      module: 'knowledge',
      action: 'search',
      payload: { query: 'project notes', corpus: 'wiki' },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(2, expect.objectContaining({
      module: 'knowledge',
      action: 'applyDraft',
      payload: { title: 'Decision', body: 'Use native wiki.', sourceIds: ['s1'] },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(3, expect.objectContaining({
      module: 'knowledge',
      action: 'validateOkfBundle',
      payload: { path: 'C:/okf' },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(4, expect.objectContaining({
      module: 'knowledge',
      action: 'importOkfBundle',
      payload: { path: 'C:/okf', conceptIds: ['alpha'] },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(5, expect.objectContaining({
      module: 'knowledge',
      action: 'createInboxItem',
      payload: { title: 'Candidate', body: 'Body', kind: 'chat-session' },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(6, expect.objectContaining({
      module: 'knowledge',
      action: 'promoteInboxItemToDraft',
      payload: { id: 'inbox-1' },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(7, expect.objectContaining({
      module: 'knowledge',
      action: 'recordKnowledgeReference',
      payload: { targetId: 'notes/a.md', reference: { kind: 'search', lookup: 'notes/a.md' } },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(8, expect.objectContaining({
      module: 'knowledge',
      action: 'runtimeLessonsReport',
    }));
  });

  it('calls sessions.summaries through hostInvoke', async () => {
    hostInvoke.mockResolvedValueOnce({ id: 'req', ok: true, data: { success: true, summaries: [] } });
    const { hostApi } = await import('@/lib/host-api');

    await hostApi.sessions.summaries({ limit: 20 });
    expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
      module: 'sessions',
      action: 'summaries',
    }));
  });

  it('calls session compaction methods through hostInvoke', async () => {
    hostInvoke
      .mockResolvedValueOnce({ id: 'req-1', ok: true, data: { success: true, available: true, canCompact: true, inProgress: false, pressure: 'low', truncatedMessageCount: 0, warnings: [] } })
      .mockResolvedValueOnce({ id: 'req-2', ok: true, data: { success: true, entries: [] } })
      .mockResolvedValueOnce({ id: 'req-3', ok: true, data: { success: true, available: true, queueCount: 1, warnings: [] } })
      .mockResolvedValueOnce({ id: 'req-4', ok: true, data: { success: true, events: [] } })
      .mockResolvedValueOnce({ id: 'req-5', ok: true, data: { success: true, checkpoints: [] } })
      .mockResolvedValueOnce({ id: 'req-6', ok: true, data: { success: true, drained: false, queueCount: 0 } })
      .mockResolvedValueOnce({ id: 'req-7', ok: true, data: { success: true, compacted: true } })
      .mockResolvedValueOnce({ id: 'req-8', ok: true, data: { success: true, draft: 'handoff' } })
      .mockResolvedValueOnce({ id: 'req-9', ok: true, data: { success: true, sessionKey: 'agent:main:fork' } })
      .mockResolvedValueOnce({ id: 'req-10', ok: true, data: { success: true, ok: true, payload: 'archived output', diagnostics: [] } })
      .mockResolvedValueOnce({ id: 'req-11', ok: true, data: { success: true, ok: false, diagnostics: [{ code: 'missing_selector', message: 'missing selector' }] } });
    const { hostApi } = await import('@/lib/host-api');

    await hostApi.sessions.compactionStatus({ sessionKey: 'agent:main:main' });
    await hostApi.sessions.compactionHistory({ sessionKey: 'agent:main:main', limit: 3 });
    await hostApi.sessions.longTaskControlStatus({ sessionKey: 'agent:main:main' });
    await hostApi.sessions.longTaskControlHistory({ sessionKey: 'agent:main:main', limit: 4 });
    await hostApi.sessions.resumeCheckpoints({ sessionKey: 'agent:main:main', limit: 2 });
    await hostApi.sessions.queueDrain({ sessionKey: 'agent:main:main' });
    await hostApi.sessions.compact({ sessionKey: 'agent:main:main', customInstructions: 'preserve decisions' });
    await hostApi.sessions.prepareHandoff({ sessionKey: 'agent:main:main', workspaceId: 'default' });
    await hostApi.sessions.fork({ sessionKey: 'agent:main:main', workspaceId: 'default' });
    await hostApi.sessions.recallOriginal({
      sessionKey: 'agent:main:main',
      archiveHandle: {
        uri: 'context-archive://session-1/tool.context-archive.json',
        checksum: `sha256:${'a'.repeat(64)}`,
        byteLength: 15,
      },
    });
    await hostApi.sessions.expandSelector({
      sessionKey: 'agent:main:main',
      resourceId: 'resource:demo',
      selector: 'selector:demo',
      checksum: `sha256:${'b'.repeat(64)}`,
    });

    expect(hostInvoke).toHaveBeenNthCalledWith(1, expect.objectContaining({
      module: 'sessions',
      action: 'compactionStatus',
      payload: { sessionKey: 'agent:main:main' },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(2, expect.objectContaining({
      module: 'sessions',
      action: 'compactionHistory',
      payload: { sessionKey: 'agent:main:main', limit: 3 },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(3, expect.objectContaining({
      module: 'sessions',
      action: 'longTaskControlStatus',
      payload: { sessionKey: 'agent:main:main' },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(4, expect.objectContaining({
      module: 'sessions',
      action: 'longTaskControlHistory',
      payload: { sessionKey: 'agent:main:main', limit: 4 },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(5, expect.objectContaining({
      module: 'sessions',
      action: 'resumeCheckpoints',
      payload: { sessionKey: 'agent:main:main', limit: 2 },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(6, expect.objectContaining({
      module: 'sessions',
      action: 'queueDrain',
      payload: { sessionKey: 'agent:main:main' },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(7, expect.objectContaining({
      module: 'sessions',
      action: 'compact',
      payload: { sessionKey: 'agent:main:main', customInstructions: 'preserve decisions' },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(8, expect.objectContaining({
      module: 'sessions',
      action: 'prepareHandoff',
      payload: { sessionKey: 'agent:main:main', workspaceId: 'default' },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(9, expect.objectContaining({
      module: 'sessions',
      action: 'fork',
      payload: { sessionKey: 'agent:main:main', workspaceId: 'default' },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(10, expect.objectContaining({
      module: 'sessions',
      action: 'recallOriginal',
      payload: expect.objectContaining({ sessionKey: 'agent:main:main' }),
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(11, expect.objectContaining({
      module: 'sessions',
      action: 'expandSelector',
      payload: expect.objectContaining({
        sessionKey: 'agent:main:main',
        resourceId: 'resource:demo',
        selector: 'selector:demo',
      }),
    }));
  });

  it('calls clawGraph methods through hostInvoke', async () => {
    hostInvoke
      .mockResolvedValueOnce({ id: 'req-1', ok: true, data: { success: true, workflows: [] } })
      .mockResolvedValueOnce({ id: 'req-2', ok: true, data: { success: true, compile: { ok: true, diagnostics: [] } } })
      .mockResolvedValueOnce({ id: 'req-3', ok: true, data: { success: true, snapshot: null } })
      .mockResolvedValueOnce({ id: 'req-4', ok: true, data: { success: true, events: [] } });
    const { hostApi } = await import('@/lib/host-api');

    await hostApi.clawGraph.listWorkflows({ workspaceId: 'workspace' });
    await hostApi.clawGraph.compile({ workspaceId: 'workspace', sourcePath: '/workspace/.verse-claw/clawgraph/a.yaml' });
    await hostApi.clawGraph.status({ runId: 'clawgraph_1' });
    await hostApi.clawGraph.events({ runId: 'clawgraph_1', limit: 20 });

    expect(hostInvoke).toHaveBeenNthCalledWith(1, expect.objectContaining({
      module: 'clawGraph',
      action: 'listWorkflows',
      payload: { workspaceId: 'workspace' },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(2, expect.objectContaining({
      module: 'clawGraph',
      action: 'compile',
      payload: { workspaceId: 'workspace', sourcePath: '/workspace/.verse-claw/clawgraph/a.yaml' },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(3, expect.objectContaining({
      module: 'clawGraph',
      action: 'status',
      payload: { runId: 'clawgraph_1' },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(4, expect.objectContaining({
      module: 'clawGraph',
      action: 'events',
      payload: { runId: 'clawgraph_1', limit: 20 },
    }));
  });

  it('calls cron.list through hostInvoke', async () => {
    hostInvoke.mockResolvedValueOnce({ id: 'req', ok: true, data: [] });
    const { hostApi } = await import('@/lib/host-api');

    await hostApi.cron.list();
    expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
      module: 'cron',
      action: 'list',
    }));
  });

  it('calls skills.clawhubList through hostInvoke', async () => {
    hostInvoke.mockResolvedValueOnce({ id: 'req', ok: true, data: { success: true, results: [] } });
    const { hostApi } = await import('@/lib/host-api');

    await hostApi.skills.clawhubList();
    expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
      module: 'skills',
      action: 'clawhubList',
    }));
  });

  it('calls usage.recentTokenHistory through hostInvoke', async () => {
    hostInvoke.mockResolvedValueOnce({ id: 'req', ok: true, data: [] });
    const { hostApi } = await import('@/lib/host-api');

    await hostApi.usage.recentTokenHistory(25);
    expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
      module: 'usage',
      action: 'recentTokenHistory',
      payload: { limit: 25 },
    }));
  });

  it('calls observability queryTraces through hostInvoke', async () => {
    hostInvoke.mockResolvedValueOnce({
      id: 'req',
      ok: true,
      data: { generatedAt: 1, items: [], total: 0, page: 1, pageSize: 20, facets: { status: [], agent: [], role: [], model: [], sourceStatus: [] } },
    });
    const { hostApi } = await import('@/lib/host-api');

    await hostApi.observability.queryTraces({ hasErrors: true, pageSize: 20 });
    expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
      module: 'observability',
      action: 'queryTraces',
      payload: { hasErrors: true, pageSize: 20 },
    }));
  });

  it('calls observability reportTrace through hostInvoke', async () => {
    hostInvoke.mockResolvedValueOnce({
      id: 'req',
      ok: true,
      data: { success: true, traceId: 'trace_capability_test' },
    });
    const { hostApi } = await import('@/lib/host-api');
    const trace = {
      id: 'trace_capability_test',
      name: 'Capability management',
      status: 'completed' as const,
      startedAt: 1,
      endedAt: 2,
      updatedAt: 2,
      durationMs: 1,
      mode: 'capability-management',
      tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costUsd: 0 },
      metrics: { actions: 1 },
      tags: ['capability-management'],
      spans: [],
      events: [],
    };

    await expect(hostApi.observability.reportTrace(trace)).resolves.toEqual({
      success: true,
      traceId: 'trace_capability_test',
    });
    expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
      module: 'observability',
      action: 'reportTrace',
      payload: { trace },
    }));
  });

  it('keeps hostApi response types on facade methods instead of call-site generics', () => {
    const srcRoot = join(process.cwd(), 'src');
    const files: string[] = [];
    const collect = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          collect(fullPath);
        } else if (/\.(ts|tsx)$/.test(entry)) {
          files.push(fullPath);
        }
      }
    };
    collect(srcRoot);

    const violations = files.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      const matches = text.match(/hostApi\.(?!gateway\.rpc\b)[A-Za-z0-9_]+\.[A-Za-z0-9_]+</g) ?? [];
      return matches.map((match) => `${file.replace(`${process.cwd()}/`, '')}: ${match}`);
    });

    expect(violations).toEqual([]);
  });

  it('uses a function-shaped host API contract to type host invocations', () => {
    const contract = readFileSync(join(process.cwd(), 'shared/host-api/contract.ts'), 'utf8');
    const client = readFileSync(join(process.cwd(), 'src/lib/host-api-client.ts'), 'utf8');
    const facade = readFileSync(join(process.cwd(), 'src/lib/host-api.ts'), 'utf8');
    const mainContract = readFileSync(join(process.cwd(), 'electron/main/ipc/host-contract.ts'), 'utf8');

    expect(contract).toContain('export type HostApiContract = {');
    expect(contract).toMatch(/openClawDoctor:\s*\(payload:/);
    expect(contract).not.toMatch(/\binput\s*:[^;]+;\s*output\s*:/s);

    expect(client).not.toContain('export async function invokeHost<T>(');
    expect(client).not.toContain('module: string,\n  action: string,\n  payload?: unknown,');
    expect(facade).not.toContain('invokeHost<');
    expect(mainContract).not.toContain('HostServiceAction = (payload?: unknown) => Promise<unknown> | unknown');
  });

  it('keeps async handler flexibility out of the renderer-facing host API contract', () => {
    const contract = readFileSync(join(process.cwd(), 'shared/host-api/contract.ts'), 'utf8');
    const mainContract = readFileSync(join(process.cwd(), 'electron/main/ipc/host-contract.ts'), 'utf8');

    expect(contract).not.toContain('MaybePromise');
    expect(contract).toContain('version: () => string;');
    expect(mainContract).toContain('type MaybePromise<T> = T | Promise<T>;');
    expect(mainContract).toContain('MaybePromise<Awaited<Result>>');
  });

  it('keeps production main, preload, renderer, and shared imports on their side of the boundary', () => {
    const collectFiles = (root: string): string[] => {
      const files: string[] = [];
      const collect = (dir: string) => {
        for (const entry of readdirSync(dir)) {
          const fullPath = join(dir, entry);
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            collect(fullPath);
          } else if (/\.(ts|tsx)$/.test(entry)) {
            files.push(fullPath);
          }
        }
      };
      collect(join(process.cwd(), root));
      return files;
    };

    const findViolations = (root: string, patterns: RegExp[]): string[] => collectFiles(root).flatMap((file) => {
      const relative = file.replace(`${process.cwd()}/`, '');
      const text = readFileSync(file, 'utf8');
      return patterns.flatMap((pattern) => (
        [...text.matchAll(pattern)].map((match) => `${relative}: ${match[0]}`)
      ));
    });

    const electronToRenderer = findViolations('electron', [
      /\bfrom\s+['"][^'"]*src\//g,
      /\bimport\(\s*['"][^'"]*src\//g,
      /\brequire\(\s*['"][^'"]*src\//g,
    ]);
    const rendererToElectron = findViolations('src', [
      /\bfrom\s+['"]electron['"]/g,
      /\bfrom\s+['"]@electron\//g,
      /\bfrom\s+['"][^'"]*(?:electron\/|dist-electron|preload|ipc-handlers|host-contract)/g,
      /\bimport\(\s*['"][^'"]*(?:@electron\/|electron\/|dist-electron|preload|ipc-handlers|host-contract)/g,
      /\brequire\(\s*['"][^'"]*(?:@electron\/|electron\/|dist-electron|preload|ipc-handlers|host-contract)/g,
    ]);
    const sharedToAppLayer = findViolations('shared', [
      /\bfrom\s+['"]@\//g,
      /\bfrom\s+['"]@electron\//g,
      /\bfrom\s+['"][^'"]*(?:src\/|electron\/|dist-electron|preload|ipc-handlers|host-contract)/g,
      /\bimport\(\s*['"][^'"]*(?:@\/|@electron\/|src\/|electron\/|dist-electron|preload|ipc-handlers|host-contract)/g,
      /\brequire\(\s*['"][^'"]*(?:@\/|@electron\/|src\/|electron\/|dist-electron|preload|ipc-handlers|host-contract)/g,
    ]);

    expect({
      electronToRenderer,
      rendererToElectron,
      sharedToAppLayer,
      oldHostApiContractPathExists: existsSync(join(process.cwd(), 'src/lib/host-api-contract.ts')),
      oldHostApiTypesPathExists: existsSync(join(process.cwd(), 'src/lib/host-api-types.ts')),
      oldI18nLocalesPathExists: existsSync(join(process.cwd(), 'src/i18n/locales')),
    }).toEqual({
      electronToRenderer: [],
      rendererToElectron: [],
      sharedToAppLayer: [],
      oldHostApiContractPathExists: false,
      oldHostApiTypesPathExists: false,
      oldI18nLocalesPathExists: false,
    });
  });

  it('lets service handlers inherit payload types from the host API contract', () => {
    const servicesRoot = join(process.cwd(), 'electron/services');
    const files = readdirSync(servicesRoot)
      .filter((entry) => /-api\.ts$/.test(entry))
      .map((entry) => join(servicesRoot, entry));

    const violations = files.flatMap((file) => {
      const relative = file.replace(`${process.cwd()}/`, '');
      const text = readFileSync(file, 'utf8');
      const localIsRecord = text.match(/^function isRecord\(/m) ? [`${relative}: use shared payload-utils isRecord`] : [];
      const unknownHandlers = [...text.matchAll(/^\s{4}[A-Za-z][A-Za-z0-9_]*:\s*(?:async\s*)?\(payload\?: unknown\)/gm)]
        .map((match) => `${relative}: ${match[0].trim()}`);
      return [...localIsRecord, ...unknownHandlers];
    });

    expect(violations).toEqual([]);
  });

  it('does not keep hostApi-covered legacy direct IPC channels registered', () => {
    const mainIpcHandlers = readFileSync(join(process.cwd(), 'electron/main/ipc-handlers.ts'), 'utf8');
    const preload = readFileSync(join(process.cwd(), 'electron/preload/index.ts'), 'utf8');
    const hostApiCoveredLegacyChannels = [
      'channel:saveConfig',
      'channel:getConfig',
      'channel:getFormValues',
      'channel:deleteConfig',
      'channel:listConfigured',
      'channel:setEnabled',
      'channel:validate',
      'channel:validateCredentials',
      'channel:requestWhatsAppQr',
      'channel:cancelWhatsAppQr',
      'chat:sendWithMedia',
      'clawhub:search',
      'clawhub:install',
      'clawhub:uninstall',
      'clawhub:list',
      'clawhub:openSkillReadme',
      'cron:list',
      'cron:create',
      'cron:update',
      'cron:delete',
      'cron:toggle',
      'cron:trigger',
      'file:stage',
      'file:stageBuffer',
      'log:getRecent',
      'log:readFile',
      'log:getFilePath',
      'log:getDir',
      'log:listFiles',
      'media:getThumbnails',
      'media:saveImage',
      'provider:listVendors',
      'provider:listAccounts',
      'provider:getAccount',
      'provider:requestOAuth',
      'provider:cancelOAuth',
      'session:delete',
      'session:rename',
      'skill:updateConfig',
      'skill:getConfig',
      'skill:getAllConfigs',
    ];

    const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const violations = hostApiCoveredLegacyChannels.flatMap((channel) => {
      const mainRegistration = new RegExp(`ipcMain\\.handle\\(\\s*['"]${escapeRegExp(channel)}['"]`).test(mainIpcHandlers)
        ? [`electron/main/ipc-handlers.ts: remove legacy ${channel} handler`]
        : [];
      const preloadAllowlist = preload.includes(`'${channel}'`)
        ? [`electron/preload/index.ts: remove legacy ${channel} allowlist entry`]
        : [];
      return [...mainRegistration, ...preloadAllowlist];
    });

    expect(violations).toEqual([]);
  });

  it('does not keep uninvoked direct IPC channels registered', () => {
    const mainIpcHandlers = readFileSync(join(process.cwd(), 'electron/main/ipc-handlers.ts'), 'utf8');
    const preload = readFileSync(join(process.cwd(), 'electron/preload/index.ts'), 'utf8');
    const uninvokedChannels = [
      'app:getPath',
      'app:quit',
      'app:relaunch',
      'dialog:save',
      'gateway:isConnected',
      'gateway:start',
      'gateway:stop',
      'gateway:restart',
      'gateway:getControlUiUrl',
      'gateway:health',
      'openclaw:isReady',
      'openclaw:getDir',
      'openclaw:getConfigDir',
      'uv:check',
    ];

    const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const violations = uninvokedChannels.flatMap((channel) => {
      const mainRegistration = new RegExp(`ipcMain\\.handle\\(\\s*['"]${escapeRegExp(channel)}['"]`).test(mainIpcHandlers)
        ? [`electron/main/ipc-handlers.ts: remove uninvoked ${channel} handler`]
        : [];
      const preloadAllowlist = preload.includes(`'${channel}'`)
        ? [`electron/preload/index.ts: remove uninvoked ${channel} allowlist entry`]
        : [];
      return [...mainRegistration, ...preloadAllowlist];
    });

    expect(violations).toEqual([]);
  });

  it('does not keep the legacy unified app:request client path', () => {
    const mainIpcHandlers = readFileSync(join(process.cwd(), 'electron/main/ipc-handlers.ts'), 'utf8');
    const apiClientPath = join(process.cwd(), 'src/lib/api-client.ts');

    const violations = [
      ...(existsSync(apiClientPath) ? ['src/lib/api-client.ts: remove legacy unified API client'] : []),
      ...(mainIpcHandlers.includes("case 'cron':")
        ? ['electron/main/ipc-handlers.ts: remove legacy app:request cron module']
        : []),
    ];

    expect(violations).toEqual([]);
  });

  it('does not keep legacy IPC helper exports or production call sites', () => {
    const srcRoot = join(process.cwd(), 'src');
    const files: string[] = [];
    const collect = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          collect(fullPath);
        } else if (/\.(ts|tsx)$/.test(entry)) {
          files.push(fullPath);
        }
      }
    };
    collect(srcRoot);

    const violations = files.flatMap((file) => {
      const relative = file.replace(`${process.cwd()}/`, '');
      const text = readFileSync(file, 'utf8');
      const legacyIpcHelper = `${'invoke'}${'Ipc'}`;
      const legacyApiHelper = `${'invoke'}${'Api'}`;
      const matches = text.match(new RegExp(
        `\\b${legacyIpcHelper}(?:WithRetry)?\\b|\\b${legacyApiHelper}\\b`,
        'g',
      )) ?? [];
      return matches.map((match) => `${relative}: remove ${match} and route through hostApi`);
    });

    expect(violations).toEqual([]);
  });

  it('keeps hostApi response shapes imported from the facade instead of redeclared by consumers', () => {
    const forbiddenDeclarations = [
      {
        file: 'src/pages/Settings/index.tsx',
        pattern: /const \[doctorResult, setDoctorResult\] = useState<\{/,
        replacement: 'OpenClawDoctorResult',
      },
      {
        file: 'src/stores/chat.ts',
        pattern: /type SessionLabelSummary = \{/,
        replacement: 'SessionLabelSummary',
      },
      {
        file: 'src/stores/skills.ts',
        pattern: /type GatewaySkillStatus = \{/,
        replacement: 'SkillsStatusResult',
      },
      {
        file: 'src/stores/skills.ts',
        pattern: /type ClawHubListResult = \{/,
        replacement: 'ClawHubInstalledSkill',
      },
      {
        file: 'src/pages/Agents/index.tsx',
        pattern: /interface Channel(?:Account|Group)Item \{/,
        replacement: 'ChannelGroupItem',
      },
      {
        file: 'src/pages/Channels/index.tsx',
        pattern: /interface Channel(?:Account|Group)Item \{/,
        replacement: 'ChannelGroupItem',
      },
      {
        file: 'src/pages/Channels/index.tsx',
        pattern: /type ChannelsResponse = \{/,
        replacement: 'ChannelAccountsResult',
      },
      {
        file: 'src/pages/Cron/index.tsx',
        pattern: /interface (?:DeliveryChannelAccount|DeliveryChannelGroup|ChannelTargetOption) \{/,
        replacement: 'DeliveryChannelGroup and ChannelTargetOption',
      },
    ];

    const violations = forbiddenDeclarations.flatMap(({ file, pattern, replacement }) => {
      const text = readFileSync(join(process.cwd(), file), 'utf8');
      return pattern.test(text) ? [`${file}: import ${replacement} from host-api instead of redeclaring it`] : [];
    });

    expect(violations).toEqual([]);
  });

  it('keeps diagnostics on the extension-contributed host API path', () => {
    const mainIpcHandlers = readFileSync(join(process.cwd(), 'electron/main/ipc-handlers.ts'), 'utf8');
    const builtinIndex = readFileSync(join(process.cwd(), 'electron/extensions/builtin/index.ts'), 'utf8');
    const diagnosticsExtension = readFileSync(join(process.cwd(), 'electron/extensions/builtin/diagnostics.ts'), 'utf8');

    expect(mainIpcHandlers).not.toContain('diagnostics: createDiagnosticsApi');
    expect(builtinIndex).toContain("import { createDiagnosticsExtension } from './diagnostics';");
    expect(builtinIndex).toContain("registerBuiltinExtension('builtin/diagnostics', createDiagnosticsExtension);");
    expect(diagnosticsExtension).toContain('getHostApiContributions');
    expect(diagnosticsExtension).not.toContain('HostApiRouteExtension');
  });
});
