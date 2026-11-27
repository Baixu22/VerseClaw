// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createOllamaStreamFn } from '../../openclaw_runtime/extensions/ollama/runtime-api';
import { materialToolResult, withMaterialPromptUse } from '../../openclaw_runtime/src/agents/session-collaboration-material-prompt';
import type { StreamFn } from '../../openclaw_runtime/src/agents/runtime/index';
import { normalizeRunScope, type AutonomySessionScope } from '../../shared/types/identity-scope';
import { emptyMaterialPage, type SessionCollaborationMaterial } from '../../shared/types/session-collaboration-material';

const { fetchGuard } = vi.hoisted(() => ({ fetchGuard: vi.fn() }));
vi.mock('../../openclaw_runtime/src/infra/net/fetch-guard', () => ({ fetchWithSsrFGuard: fetchGuard }));
afterEach(() => vi.clearAllMocks());

it.each(['valid', 'revoked'] as const)('sends only qualified %s material through native Ollama after the payload hook resolves', async state => {
  const scope = { workspaceId: 'workspace', projectId: 'workspace', sessionKey: 'agent:main:reader',
    sessionGeneration: 'generation' } as AutonomySessionScope;
  const material: SessionCollaborationMaterial = {
    id: 'native-material', version: 1, authorityId: 'owner', taskNodeId: 'task' as SessionCollaborationMaterial['taskNodeId'],
    taskRevision: 1, taskDigest: 'a'.repeat(64), contentDigest: 'b'.repeat(64), sourceGeneration: scope.sessionGeneration,
    sourceRun: normalizeRunScope({ scope, runId: 'publish' }), kind: 'claim', state: 'claim',
    summary: 'Material bytes delivered through native Ollama.', sensitivity: 'internal', evidenceRefs: [], createdAt: 1,
  };
  const page = { ...emptyMaterialPage({ requester: scope }, 'ready'), detail: { material, state: 'claim' as const } };
  const envelope = await materialToolResult(page, 'native-tool', { runId: 'native-run' });
  const record = vi.fn();
  const release = vi.fn();
  fetchGuard.mockImplementation(async () => ({ release, response: new Response(JSON.stringify({
    model: 'llama-test', message: { role: 'assistant', content: 'Result' }, done: true,
    done_reason: 'stop', prompt_eval_count: 10, eval_count: 1,
  }) + '\n') }));
  let changed = false;
  let unblock!: () => void;
  let entered!: () => void;
  const pending = new Promise<void>(resolve => { unblock = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const stream = withMaterialPromptUse(createOllamaStreamFn('http://localhost:11434'), {
    runId: 'native-run', modelCallId: 'native-model-call', record,
    read: async () => ({ material, state: changed && state === 'revoked' ? 'revoked' : 'claim' }),
    readFinal: async () => [{ material, state: changed && state === 'revoked' ? 'revoked' : 'claim' }],
  });
  const context: Parameters<StreamFn>[1] = { messages: [{ role: 'toolResult', toolName: 'sessions_list', toolCallId: 'native-tool',
    timestamp: 1, isError: false, content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] }] };
  const model = { id: 'llama-test', provider: 'ollama', api: 'ollama', reasoning: false,
    contextWindow: 4096, maxTokens: 512 } as Parameters<StreamFn>[0];
  const result = await stream(model, context, { onPayload: async payload => {
    entered();
    await pending;
    changed = true;
    return { ...payload as Record<string, unknown>, hookApplied: true };
  } });
  let sentBeforeHookCompleted: boolean;
  try {
    await started;
    sentBeforeHookCompleted = fetchGuard.mock.calls.length > 0;
  } finally { unblock(); }
  expect((await result.result()).stopReason).toBe('stop');
  expect(sentBeforeHookCompleted).toBe(false);
  expect(fetchGuard).toHaveBeenCalledOnce();
  const body = JSON.parse(fetchGuard.mock.calls[0][0].init.body);
  expect(body.hookApplied).toBe(true);
  if (state === 'valid') {
    expect(JSON.stringify(body)).toContain(material.summary);
    expect(record).toHaveBeenCalledOnce();
    expect(record.mock.calls[0][0].map((item: { phase: string }) => item.phase)).toEqual(['prompt-used', 'outcome']);
  } else {
    expect(JSON.stringify(body)).not.toContain(material.summary);
    expect(record).not.toHaveBeenCalled();
  }
  expect(release).toHaveBeenCalledOnce();
});
