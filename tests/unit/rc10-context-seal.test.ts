// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { buildEmbeddedExtensionFactories } from '../../openclaw_runtime/src/agents/embedded-agent-runner/extensions';
import { createEmbeddedAgentResourceLoader } from '../../openclaw_runtime/src/agents/embedded-agent-runner/resource-loader';
import { SettingsManager, SessionManager } from '../../openclaw_runtime/src/agents/sessions';
import { ReceiptStore } from '../../openclaw_runtime/src/agents/receipt-store';
import { closeOpenClawStateDatabase } from '../../openclaw_runtime/src/state/openclaw-state-db';

let root: string;
afterEach(() => { closeOpenClawStateDatabase(); vi.unstubAllEnvs(); if (root) rmSync(root, { recursive: true, force: true }); });
it('loads the real embedded context extension and seals its first model call', async () => {
  root = mkdtempSync(join(tmpdir(), 'rc10-context-'));
  vi.stubEnv('OPENCLAW_STATE_DIR', root);
  vi.stubEnv('OPENCLAW_HOME', root);
  vi.stubEnv('OPENCLAW_RC03_SEAL', '1');
  const sessionManager = SessionManager.inMemory(root);
  const settingsManager = SettingsManager.inMemory();
  const factories = buildEmbeddedExtensionFactories({
    cfg: { runtime: { rc03: { seal: true } } }, sessionManager,
    provider: 'openai', modelId: 'mock-coder', model: undefined,
    sessionId: 'test-session', sessionKey: 'agent:main:irc:group:#test',
    runId: 'rc10-test', injectionTurnId: 'rc10-test-turn', workspaceDir: root,
  });
  const loader = createEmbeddedAgentResourceLoader({ cwd: root, agentDir: root, settingsManager, extensionFactories: factories });
  await loader.reload();
  const loaded = loader.getExtensions();
  expect(loaded.errors).toEqual([]);
  for (const extension of loaded.extensions) {
    for (const handler of extension.handlers.get('before_agent_start') ?? []) {
      await handler({ type: 'before_agent_start', systemPrompt: 'test system', prompt: 'test request' } as never, {} as never);
    }
  }
  for (const extension of loaded.extensions) {
    for (const handler of extension.handlers.get('context') ?? []) {
      await handler({ type: 'context', messages: [{ role: 'user', content: 'hello', timestamp: 1 }] } as never, {} as never);
    }
  }
  expect(new ReceiptStore().list({ kind: 'context', runId: 'rc10-test' })).toHaveLength(1);
});

it('seals context through the real SDK before a provider request', async () => {
  const { AuthStorage, ModelRegistry, createAgentSession } = await import('../../openclaw_runtime/src/agents/sessions');
  root = mkdtempSync(join(tmpdir(), 'rc10-sdk-'));
  vi.stubEnv('OPENCLAW_STATE_DIR', root);
  vi.stubEnv('OPENCLAW_HOME', root);
  vi.stubEnv('OPENCLAW_RC03_SEAL', '1');
  const sessionManager = SessionManager.inMemory(root);
  const settingsManager = SettingsManager.inMemory();
  const factories = buildEmbeddedExtensionFactories({
    cfg: { runtime: { rc03: { seal: true }, contextBlock: { 'working-memory': { enabled: true }, 'tool-registry': { enabled: true } } } },
    sessionManager, provider: 'openai', modelId: 'mock-coder', model: undefined,
    sessionId: sessionManager.getSessionId(), sessionKey: 'agent:main:irc:group:#sdk',
    runId: 'rc10-sdk', injectionTurnId: 'rc10-sdk-turn', workspaceDir: root,
  });
  const loader = createEmbeddedAgentResourceLoader({ cwd: root, agentDir: root, settingsManager, extensionFactories: factories });
  await loader.reload();
  expect(loader.getExtensions().errors).toEqual([]);
  const auth = AuthStorage.inMemory({ openai: { type: 'api_key', key: 'test-only' } });
  const { session } = await createAgentSession({
    cwd: root, agentDir: root, resourceLoader: loader, sessionManager, settingsManager,
    authStorage: auth, modelRegistry: ModelRegistry.inMemory(auth), tools: [],
    model: { api: 'openai-completions', provider: 'openai', id: 'mock-coder', name: 'Mock',
      baseUrl: 'http://127.0.0.1:1', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 },
  });
  const errors: unknown[] = [];
  session.extensionRunner.onError((e) => errors.push(e));
  const send = vi.fn(() => { throw new Error('transport intentionally stopped after context'); });
  session.agent.streamFn = send;
  try {
    await session.prompt('hello').catch(() => {});
    expect(errors).toEqual([]);
    expect(send).toHaveBeenCalledOnce();
    expect(new ReceiptStore().list({ kind: 'context', runId: 'rc10-sdk' })).toHaveLength(1);
  } finally { session.dispose(); }
});

it('seals long real candidate IDs as bounded source references', async () => {
  const { createContextCandidate, collectContextCandidate } = await import('../../openclaw_runtime/src/context-engine/context-candidate');
  const { finalizeContextOrchestratorTurn } = await import('../../openclaw_runtime/src/context-engine/context-orchestrator');
  root = mkdtempSync(join(tmpdir(), 'rc10-long-ref-'));
  vi.stubEnv('OPENCLAW_STATE_DIR', root);
  vi.stubEnv('OPENCLAW_HOME', root);
  const candidate = createContextCandidate({
    authorityObjectId: 'private-authority:' + 'a'.repeat(300), authorityVersion: '1',
    sourceId: 'context-block:cvk:tool_registry', channel: 'tool_registry',
    target: 'message', text: 'Available bounded tools.',
  });
  collectContextCandidate('rc10-long-ref-turn', candidate);
  finalizeContextOrchestratorTurn({
    turnId: 'rc10-long-ref-turn', messages: [],
    cfg: { runtime: { rc03: { seal: true } } }, sessionKey: 'agent:main:main',
    runId: 'rc10-long-ref',
  });
  const rows = new ReceiptStore().list({ kind: 'context', runId: 'rc10-long-ref' });
  expect(rows).toHaveLength(1);
  const refs = JSON.parse(rows[0].selected_json ?? '[]') as string[];
  expect(refs).toHaveLength(1);
  expect(refs[0]).toContain('cvk');
  expect(refs[0].length).toBeLessThanOrEqual(256);
  expect(refs[0]).not.toContain('private-authority');
});
