// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { materialToolResult, withMaterialPromptUse as wrapMaterialPrompt } from '../../openclaw_runtime/src/agents/session-collaboration-material-prompt';
import type { StreamFn } from '../../openclaw_runtime/src/agents/runtime/index';
import { wrapStreamFnWithDiagnosticModelCallEvents } from '../../openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.model-diagnostic-events';
import { areDiagnosticsEnabledForProcess, onInternalDiagnosticEvent, setDiagnosticsEnabledForProcess,
  type DiagnosticEventPayload } from '../../openclaw_runtime/src/infra/diagnostic-events';
import { createDiagnosticTraceContext } from '../../openclaw_runtime/src/infra/diagnostic-trace-context';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import { TaskSystemStore } from '../../shared/task-system/store';
import type { TaskMaterialObservation } from '../../shared/task-system/trace';
import { normalizeRunScope, type AutonomySessionScope } from '../../shared/types/identity-scope';
import { materialReference, emptyMaterialPage, type SessionCollaborationMaterial } from '../../shared/types/session-collaboration-material';

const scope = { workspaceId: 'workspace-a', projectId: 'workspace-a',
  sessionKey: 'agent:main:consumer', sessionGeneration: 'generation' } as AutonomySessionScope;
const source = { ...scope, sessionKey: 'agent:main:source' as AutonomySessionScope['sessionKey'] };
const runId = 'actual-reading-run';
const material: SessionCollaborationMaterial = {
  id: 'finding', version: 1, authorityId: 'original-task-owner', taskNodeId: 'source-task' as SessionCollaborationMaterial['taskNodeId'],
  taskRevision: 1, taskDigest: 'a'.repeat(64), contentDigest: 'b'.repeat(64), sourceGeneration: source.sessionGeneration,
  sourceRun: normalizeRunScope({ scope: source, runId: 'publish-run' }), kind: 'claim', state: 'claim',
  summary: 'Only the final qualified request gets these bytes.', sensitivity: 'internal', evidenceRefs: [], createdAt: 1,
};

function withMaterialPromptUse(stream: StreamFn, params: Omit<Parameters<typeof wrapMaterialPrompt>[1], 'readFinal'> &
  Partial<Pick<Parameters<typeof wrapMaterialPrompt>[1], 'readFinal'>>) {
  return wrapMaterialPrompt(stream, { ...params, readFinal: params.readFinal ?? (selections => Promise.all(selections.map(params.read))) });
}

function capturingProvider() {
  const message = { role: 'assistant', content: [{ type: 'text', text: 'Result' }], stopReason: 'stop' } as
    Awaited<ReturnType<Awaited<ReturnType<StreamFn>>['result']>>;
  let outbound: unknown;
  const provider: StreamFn = async (model, context, options) => {
    const payload = { messages: context.messages };
    outbound = await options?.onPayload?.(payload, model) ?? payload;
    return {
      async *[Symbol.asyncIterator]() { yield { type: 'done' as const, reason: 'stop' as const, message }; },
      async result() { return message; },
    };
  };
  return { provider, payload: () => outbound };
}

it('hydrates an intact current tool result and records only bytes delivered with a successful response', async () => {
  const reader = { ...emptyMaterialPage({ requester: scope }, 'ready'), scanned: 1, detail: { material, state: 'claim' as const } };
  const detail = vi.fn().mockResolvedValue(reader.detail);
  const record = vi.fn();
  const { provider, payload: outbound } = capturingProvider();
  const stream = withMaterialPromptUse(provider, { runId, modelCallId: 'provider-call-1', read: detail, record });
  const payload = await materialToolResult(reader, 'tool-1', { runId });
  const text = JSON.stringify(payload, null, 2);
  expect(text).not.toContain(material.summary);
  const context: Parameters<StreamFn>[1] = { messages: [{ role: 'toolResult', toolName: 'sessions_list', toolCallId: 'tool-1',
    timestamp: 1, isError: false, content: [{ type: 'text', text }] }] };
  const model = {} as Parameters<StreamFn>[0];
  const first = await stream(model, context);
  expect(JSON.stringify(outbound())).toContain(material.summary);
  expect(JSON.parse((outbound() as { messages: Array<{ content: Array<{ text: string }> }> }).messages[0].content[0].text))
    .toMatchObject({ state: 'claim' });
  for await (const event of first) expect(event.type).toBe('done');
  await first.result();
  expect(record).toHaveBeenCalledTimes(1);
  expect(record.mock.calls[0][0]).toMatchObject([{ phase: 'prompt-used', modelCallId: 'provider-call-1' },
    { phase: 'outcome', responseDigest: expect.stringMatching(/^[a-f0-9]{64}$/) }]);
  expect(JSON.stringify(context)).not.toContain(material.summary);

  detail.mockResolvedValueOnce({ ...reader.detail, state: 'revoked' });
  await (await stream(model, context)).result();
  expect(JSON.stringify(outbound())).not.toContain(material.summary);
  await (await stream(model, context, { onPayload: () => ({ messages: [] }) })).result();
  expect(record).toHaveBeenCalledTimes(1);
  const old = withMaterialPromptUse(provider, { runId: 'later-run', modelCallId: 'different-call', read: detail, record });
  await (await old(model, context)).result();
  expect(JSON.stringify(outbound())).not.toContain(material.summary);
  expect(record).toHaveBeenCalledTimes(1);
});

it.each(['tool_call', 'tool_search_code', 'exec', 'wait'])('uses the recorded inner tool selection in %s', async toolName => {
  const page = { ...emptyMaterialPage({ requester: scope }, 'ready'), scanned: 1, detail: { material, state: 'claim' as const } };
  const innerId = 'real-inner-call';
  const envelope = await materialToolResult(page, innerId, { runId });
  const result = { details: envelope, content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
  const called = { tool: { name: 'sessions_list' }, result };
  const wrapper = toolName === 'tool_call' ? called
    : toolName === 'tool_search_code' ? { ok: true, value: called, logs: [] }
    : { status: 'completed', value: called, output: [] };
  const context: Parameters<StreamFn>[1] = { messages: [{ role: 'toolResult', toolName, toolCallId: 'outer-call',
    timestamp: 1, isError: false, content: [{ type: 'text', text: JSON.stringify(wrapper, null, 2) }] }] };
  const { provider, payload: outbound } = capturingProvider();
  const read = vi.fn().mockResolvedValue(page.detail);
  const record = vi.fn();
  const model = {} as Parameters<StreamFn>[0];
  const params = { runId, modelCallId: 'wrapped-model-call', read, record };
  await (await withMaterialPromptUse(provider, params)(model, context)).result();
  expect(read).not.toHaveBeenCalled();
  expect(JSON.stringify(outbound())).not.toContain(material.summary);

  const projections = [{ toolName: 'sessions_list', toolCallId: innerId,
    parentToolCallId: toolName === 'wait' ? 'earlier-exec' : 'outer-call', input: {}, result }];
  await (await withMaterialPromptUse(provider, { ...params, projections })(model, context)).result();
  expect(read).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(outbound()).split(material.summary)).toHaveLength(2);
  expect(JSON.stringify(context)).not.toContain(material.summary);
  expect(record.mock.calls[0][0]).toMatchObject([{ phase: 'prompt-used', id: innerId }, { phase: 'outcome', id: innerId }]);
});

it('iterates a provider stream whose iterator exposes only next()', async () => {
  const page = { ...emptyMaterialPage({ requester: scope }, 'ready'), detail: { material, state: 'claim' as const } };
  const envelope = await materialToolResult(page, 'tool-plain-iterator', { runId });
  const { provider } = capturingProvider();
  const plainProvider: StreamFn = async (...args) => {
    const stream = await provider(...args);
    const original = stream[Symbol.asyncIterator].bind(stream);
    stream[Symbol.asyncIterator] = () => {
      const iterator = original();
      return { next: iterator.next.bind(iterator) };
    };
    return stream;
  };
  const record = vi.fn();
  const wrapped = withMaterialPromptUse(plainProvider, { runId, modelCallId: 'plain-iterator-call',
    read: async () => page.detail, record });
  const stream = await wrapped({} as Parameters<StreamFn>[0], { messages: [{ role: 'toolResult', toolName: 'sessions_list',
    toolCallId: 'tool-plain-iterator', timestamp: 1, isError: false, content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] }] });
  for await (const event of stream) expect(event.type).toBe('done');
  expect(record).toHaveBeenCalledOnce();
});

it.each(['owner-read', 'payload-hook'])('drops material that expires during %s before sending the final request', async boundary => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  try {
    const expiring = { ...material, id: 'expiring', expiresAt: 10_010, summary: 'Expires during payload preparation' };
    const stable = { ...material, id: 'stable', summary: 'Remains available' };
    const messages: Parameters<StreamFn>[1]['messages'] = [];
    for (const selected of [stable, expiring]) {
      const page = { ...emptyMaterialPage({ requester: scope }, 'ready'), detail: { material: selected, state: 'claim' as const } };
      messages.push({ role: 'toolResult', toolName: 'sessions_list', toolCallId: selected.id, timestamp: 1, isError: false,
        content: [{ type: 'text', text: JSON.stringify(await materialToolResult(page, selected.id, { runId }), null, 2) }] });
    }
    const { provider, payload } = capturingProvider();
    const record = vi.fn();
    const wrapped = withMaterialPromptUse(provider, { runId, modelCallId: 'expiry-call', record,
      read: async selection => {
        if (selection.id === 'stable' && boundary === 'owner-read') vi.setSystemTime(10_020);
        return { material: selection.id === 'stable' ? stable : expiring, state: 'claim' };
      } });
    await (await wrapped({} as Parameters<StreamFn>[0], { messages }, { onPayload: async () => {
      await Promise.resolve();
      if (boundary === 'payload-hook') vi.setSystemTime(10_020);
    } })).result();
    expect(JSON.stringify(payload())).not.toContain(expiring.summary);
    expect(JSON.stringify(payload())).toContain(stable.summary);
    expect(record).toHaveBeenCalledOnce();
    expect(record.mock.calls[0][0].map((item: TaskMaterialObservation) => item.id)).toEqual(['stable', 'stable']);
  } finally { vi.useRealTimers(); }
});

it.each(['revoked', 'missing'] as const)('rechecks material that becomes %s during an asynchronous payload hook', async state => {
  const page = { ...emptyMaterialPage({ requester: scope }, 'ready'), detail: { material, state: 'claim' as const } };
  const envelope = await materialToolResult(page, 'changed-after-read', { runId });
  let changed = false;
  const { provider, payload } = capturingProvider();
  const record = vi.fn();
  const wrapped = withMaterialPromptUse(provider, { runId, modelCallId: 'revalidate-call', record,
    read: async () => changed ? state === 'missing' ? null : { material, state: 'revoked' } : page.detail });
  await (await wrapped({} as Parameters<StreamFn>[0], { messages: [{ role: 'toolResult', toolName: 'sessions_list',
    toolCallId: 'changed-after-read', timestamp: 1, isError: false, content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] }] },
  { onPayload: async () => { await Promise.resolve(); changed = true; } })).result();
  expect(JSON.stringify(payload())).not.toContain(material.summary);
  expect(record).not.toHaveBeenCalled();
});

it('keeps replacement markers literal when one selected material in a wrapper expires', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  try {
    const stable = { ...material, id: 'stable-marker', summary: "Literal $& $` $' $$ markers" };
    const expiring = { ...material, id: 'expired-marker', summary: 'Private expired bytes', expiresAt: 10_010 };
    const projections = await Promise.all([stable, expiring].map(async item => {
      const page = { ...emptyMaterialPage({ requester: scope }, 'ready'), detail: { material: item, state: 'claim' as const } };
      return { toolName: 'sessions_list', toolCallId: item.id, parentToolCallId: 'batch', input: {},
        result: await materialToolResult(page, item.id, { runId }) };
    }));
    const text = JSON.stringify({ results: projections.map(entry => entry.result) }, null, 2);
    const { provider, payload } = capturingProvider();
    const record = vi.fn();
    const wrapped = withMaterialPromptUse(provider, { runId, modelCallId: 'literal-call', projections, record,
      read: async selection => ({ material: selection.id === stable.id ? stable : expiring, state: 'claim' }) });
    await (await wrapped({} as Parameters<StreamFn>[0], { messages: [{ role: 'toolResult', toolName: 'exec', toolCallId: 'batch',
      timestamp: 1, isError: false, content: [{ type: 'text', text }] }] },
    { onPayload: async () => { await Promise.resolve(); vi.setSystemTime(10_020); } })).result();
    const sent = JSON.stringify(payload());
    expect(sent).toContain(stable.summary);
    expect(sent).not.toContain(expiring.summary);
    expect(record.mock.calls[0][0].map((item: TaskMaterialObservation) => item.id)).toEqual([stable.id, stable.id]);
  } finally { vi.useRealTimers(); }
});

it('uses the newest distinct reusable selections after skipping a revoked material', async () => {
  const materials = Array.from({ length: 6 }, (_, index) => ({
    ...material, id: `finding-${index + 1}`, contentDigest: String(index + 1).repeat(64), summary: `Selected result ${index + 1}`,
  }));
  const messages: Parameters<StreamFn>[1]['messages'] = [];
  for (const [index, entry] of [...materials, materials[4]].entries()) {
    const page = { ...emptyMaterialPage({ requester: scope }, 'ready'), detail: { material: entry, state: 'claim' as const } };
    const id = `tool-${index + 1}`;
    const selection = await materialToolResult(page, id, { runId });
    messages.push({ role: 'toolResult', toolName: 'sessions_list', toolCallId: id, isError: false,
      timestamp: index + 1, content: [{ type: 'text', text: JSON.stringify(selection, null, 2) }] });
  }
  const { provider, payload: outbound } = capturingProvider();
  const read = vi.fn(async ({ ref }: { ref: { id: string } }) => ({
    material: materials.find(entry => entry.id === ref.id)!, state: ref.id === 'finding-6' ? 'revoked' as const : 'claim' as const,
  }));
  const record = vi.fn();
  const wrapped = withMaterialPromptUse(provider, { runId, modelCallId: 'recent-selections', read, record });
  await (await wrapped({} as Parameters<StreamFn>[0], { messages })).result();
  expect(read.mock.calls.map(([selection]) => selection.ref.id)).toEqual(['finding-5', 'finding-6', 'finding-4', 'finding-3', 'finding-2', 'finding-5', 'finding-4', 'finding-3', 'finding-2']);
  const output = JSON.stringify(outbound()) ?? '';
  for (const index of [2, 3, 4, 5]) expect(output.split(`Selected result ${index}`)).toHaveLength(2);
  for (const index of [1, 6]) expect(output).not.toContain(`Selected result ${index}`);
  expect(record.mock.calls[0][0].filter((item: TaskMaterialObservation) => item.phase === 'prompt-used')
    .map((item: TaskMaterialObservation) => item.ref.id)).toEqual(['finding-5', 'finding-4', 'finding-3', 'finding-2']);
});

it('records presentation and model observations in the original consumer task without a writer change', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'collaboration-material-observation-'));
  const store = new TaskSystemStore(resolveTaskDomain(workspace));
  try {
    const { task } = store.create({ objective: 'Reuse one result', target: 'result.txt', constraints: [],
      acceptance: [{ id: 'result', description: 'Check result', verification: { kind: 'owner-receipt', owner: 'fixture' } }],
    }, 'create');
    const claim = store.claim(task.contract.taskNodeId, scope.sessionKey, scope.sessionGeneration, 'claim').claim!;
    const observation: TaskMaterialObservation = { id: 'display-1', phase: 'presented', run: null, ref: materialReference(material), reader: scope, source };
    store.recordMaterialObservations([observation, observation]);
    const run = normalizeRunScope({ scope, runId });
    store.recordMaterialObservations([{ ...observation, id: 'tool-1', run, phase: 'candidate' }]);
    expect(store.traceSnapshot(claim.taskNodeId).events.filter(event => event.kind === 'material_observation')
      .map(event => event.payload)).toEqual([observation, { ...observation, id: 'tool-1', run, phase: 'candidate' }]);
    expect(store.get(claim.taskNodeId).claim).toEqual(claim);
  } finally {
    store.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

it('keeps a completed material request on its original task after the same reader selects another task', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'collaboration-material-original-call-'));
  const store = new TaskSystemStore(resolveTaskDomain(workspace));
  try {
    const create = (id: string) => store.create({ objective: id, target: 'result.txt', constraints: [],
      acceptance: [{ id: 'receipt', description: 'Original receipt', verification: { kind: 'owner-receipt', owner: 'fixture' } }],
    }, id).task;
    const first = create('Original consumer');
    const claim = store.claim(first.contract.taskNodeId, scope.sessionKey, scope.sessionGeneration, 'first-claim').claim!;
    const modelCallId = 'original-material-model-call';
    store.beginModelCall(claim, { callId: modelCallId, runId, provider: 'fixture', model: 'fixture-model' });
    store.control(claim, 'release');
    const second = create('Later consumer');
    store.claim(second.contract.taskNodeId, scope.sessionKey, scope.sessionGeneration, 'second-claim');
    const observation: TaskMaterialObservation = { id: 'original-tool', phase: 'prompt-used',
      run: normalizeRunScope({ scope, runId }), modelCallId, ref: materialReference(material), reader: scope, source };
    store.recordMaterialObservations([observation]);
    expect(store.traceSnapshot(first.contract.taskNodeId).events.filter(event => event.kind === 'material_observation')
      .map(event => event.payload)).toEqual([observation]);
    expect(store.traceSnapshot(second.contract.taskNodeId).events.filter(event => event.kind === 'material_observation')).toEqual([]);
    expect(() => store.recordMaterialObservations([{ ...observation, run: normalizeRunScope({ scope, runId: 'other-run' }) }]))
      .toThrow('MATERIAL_OBSERVATION_CALL_MISMATCH');
  } finally {
    store.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

it.each((['valid', 'revoked', 'missing', 'expired'] as const).flatMap(state =>
  ['pretty', 'whitespace', 'encoded'].map(format => ({ state, format }))))('qualifies $state material after $format envelope serialization', async ({ state, format }) => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  try {
    const selected = { ...material, expiresAt: 10_010 };
    const page = { ...emptyMaterialPage({ requester: scope }, 'ready'), detail: { material: selected, state: 'claim' as const } };
    const envelope = await materialToolResult(page, 'reserialized', { runId });
    let changed = false;
    const { provider, payload } = capturingProvider();
    const record = vi.fn();
    const wrapped = withMaterialPromptUse(provider, { runId, modelCallId: 'reserialized-call', record,
      read: async () => changed && state === 'missing' ? null : { material: selected,
        state: changed && state === 'revoked' ? 'revoked' : 'claim' } });
    const context: Parameters<StreamFn>[1] = { messages: [{ role: 'toolResult', toolName: 'sessions_list', toolCallId: 'reserialized',
      timestamp: 1, isError: false, content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] }] };
    await (await wrapped({} as Parameters<StreamFn>[0], context, { onPayload: async value => {
      await Promise.resolve();
      changed = true;
      if (state === 'expired') vi.setSystemTime(10_020);
      const output = structuredClone(value) as { messages: Array<{ content: Array<{ text: string }> }> };
      for (const message of output.messages) for (const block of message.content) {
        block.text = JSON.stringify(JSON.parse(block.text), null, 4);
        if (format === 'whitespace') block.text = '\n \t\r' + block.text + '\n';
        if (format === 'encoded') block.text = JSON.stringify(block.text);
      }
      return output;
    } })).result();
    if (state === 'valid') {
      expect(JSON.stringify(payload())).toContain(material.summary);
      expect(record).toHaveBeenCalledOnce();
    } else {
      expect(JSON.stringify(payload())).not.toContain(material.summary);
      expect(record).not.toHaveBeenCalled();
    }
  } finally { vi.useRealTimers(); }
});

it.each(['size', 'depth'] as const)('stops the request when post-hook material inspection exceeds the %s limit', async boundary => {
  const page = { ...emptyMaterialPage({ requester: scope }, 'ready'), detail: { material, state: 'claim' as const } };
  const envelope = await materialToolResult(page, 'bounded-scan', { runId });
  let revoked = false;
  const { provider, payload } = capturingProvider();
  const record = vi.fn();
  const wrapped = withMaterialPromptUse(provider, { runId, modelCallId: 'bounded-call', record,
    read: async () => ({ material, state: revoked ? 'revoked' : 'claim' }) });
  const context: Parameters<StreamFn>[1] = { messages: [{ role: 'toolResult', toolName: 'sessions_list', toolCallId: 'bounded-scan',
    timestamp: 1, isError: false, content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] }] };
  await expect(wrapped({} as Parameters<StreamFn>[0], context, { onPayload: value => {
    revoked = true;
    const output = structuredClone(value) as { messages: Array<{ content: Array<{ text: string }> }> };
    for (const message of output.messages) for (const block of message.content) {
      let data: unknown = JSON.parse(block.text);
      if (boundary === 'size') data = { material: data, padding: 'x'.repeat(64_000) };
      else for (let index = 0; index < 13; index++) data = { nested: data };
      block.text = JSON.stringify(data);
    }
    return output;
  } })).rejects.toThrow('MATERIAL_PAYLOAD_SCAN_INCOMPLETE');
  expect(payload()).toBeUndefined();
  expect(record).not.toHaveBeenCalled();
});

it.each(['prefix', 'suffix', 'flatten'] as const)('keeps material bytes out of a hook that changes the envelope to %s text', async format => {
  const page = { ...emptyMaterialPage({ requester: scope }, 'ready'), detail: { material, state: 'claim' as const } };
  const envelope = await materialToolResult(page, 'hook-order', { runId });
  const { provider, payload } = capturingProvider();
  const record = vi.fn();
  let revoked = false;
  let hookInput: unknown;
  const wrapped = withMaterialPromptUse(provider, { runId, modelCallId: 'hook-order-call', record,
    read: async () => ({ material, state: revoked ? 'revoked' : 'claim' }) });
  await (await wrapped({} as Parameters<StreamFn>[0], { messages: [{ role: 'toolResult', toolName: 'sessions_list',
    toolCallId: 'hook-order', timestamp: 1, isError: false, content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] }] },
  { onPayload: async value => {
    hookInput = structuredClone(value);
    await Promise.resolve();
    revoked = true;
    const output = structuredClone(value) as { messages: Array<{ content: Array<{ text: string }> }> };
    for (const message of output.messages) for (const block of message.content) {
      block.text = format === 'prefix' ? 'JSON payload: ' + block.text
        : format === 'suffix' ? block.text + '\nEnd of payload'
          : String(JSON.parse(block.text).summary ?? 'Reference only');
    }
    return output;
  } })).result();
  expect(JSON.stringify(hookInput)).not.toContain(material.summary);
  expect(JSON.stringify(payload())).not.toContain(material.summary);
  expect(record).not.toHaveBeenCalled();
});

it('hydrates an authorized reference that a hook converts to a native object', async () => {
  const page = { ...emptyMaterialPage({ requester: scope }, 'ready'), detail: { material, state: 'claim' as const } };
  const envelope = await materialToolResult(page, 'native-object', { runId });
  const { provider, payload } = capturingProvider();
  const record = vi.fn();
  const wrapped = withMaterialPromptUse(provider, { runId, modelCallId: 'native-object-call', record, read: async () => page.detail });
  await (await wrapped({} as Parameters<StreamFn>[0], { messages: [{ role: 'toolResult', toolName: 'sessions_list',
    toolCallId: 'native-object', timestamp: 1, isError: false, content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] }] },
  { onPayload: value => ({ response: JSON.parse((value as { messages: Array<{ content: Array<{ text: string }> }> }).messages[0].content[0].text) }) })).result();
  expect(payload()).toMatchObject({ response: { provenance: 'session-material', summary: material.summary } });
  expect(record).toHaveBeenCalledOnce();
});

it('measures the final material payload after call wrappers finish hydration', async () => {
  const enabled = areDiagnosticsEnabledForProcess();
  const events: DiagnosticEventPayload[] = [];
  setDiagnosticsEnabledForProcess(true);
  const unsubscribe = onInternalDiagnosticEvent(event => { if (event.type === 'model.call.completed') events.push(event); });
  try {
    const page = { ...emptyMaterialPage({ requester: scope }, 'ready'), detail: { material, state: 'claim' as const } };
    const envelope = await materialToolResult(page, 'diagnostic-tool', { runId });
    const { provider, payload } = capturingProvider();
    const wrapped = wrapStreamFnWithDiagnosticModelCallEvents(provider, {
      runId, provider: 'fixture', model: 'fixture', trace: createDiagnosticTraceContext(), nextCallId: () => 'diagnostic-call',
      wrapCall: (stream, modelCallId) => withMaterialPromptUse(stream, { runId, modelCallId, read: async () => page.detail, record: vi.fn() }),
    });
    const result = await wrapped({} as Parameters<StreamFn>[0], { messages: [{ role: 'toolResult', toolName: 'sessions_list',
      toolCallId: 'diagnostic-tool', timestamp: 1, isError: false, content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] }] });
    for await (const event of result) expect(event.type).toBe('done');
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(JSON.stringify(payload())).toContain(material.summary);
    expect(events[0]).toMatchObject({ requestPayloadBytes: Buffer.byteLength(JSON.stringify(payload())) });
  } finally { unsubscribe(); setDiagnosticsEnabledForProcess(enabled); }
});

it('qualifies selected materials in one final owner batch after asynchronous preparation', async () => {
  const a = { ...material, id: 'batch-a', summary: 'Revoked during the other owner wait' };
  const b = { ...material, id: 'batch-b', summary: 'The other current material' };
  let revoked = false;
  const reads = new Map<string, number>();
  const detail = (id: string) => ({ material: id === a.id ? a : b,
    state: id === a.id && revoked ? 'revoked' as const : 'claim' as const });
  const { provider, payload } = capturingProvider();
  const record = vi.fn();
  const readFinal = vi.fn(async (selections: readonly { id: string }[]) => {
    await Promise.resolve();
    revoked = true;
    return selections.map(selection => detail(selection.id));
  });
  const wrapped = withMaterialPromptUse(provider, { runId, modelCallId: 'final-batch', record, readFinal,
    read: async selection => {
      const count = (reads.get(selection.id) ?? 0) + 1;
      reads.set(selection.id, count);
      if (selection.id === b.id && count > 1) { await Promise.resolve(); revoked = true; }
      return detail(selection.id);
    } });
  const messages: Parameters<StreamFn>[1]['messages'] = [];
  for (const value of [b, a]) {
    const page = { ...emptyMaterialPage({ requester: scope }, 'ready'), detail: { material: value, state: 'claim' as const } };
    messages.push({ role: 'toolResult', toolName: 'sessions_list', toolCallId: value.id, timestamp: 1, isError: false,
      content: [{ type: 'text', text: JSON.stringify(await materialToolResult(page, value.id, { runId }), null, 2) }] });
  }
  await (await wrapped({} as Parameters<StreamFn>[0], { messages })).result();
  expect(JSON.stringify(payload())).not.toContain(a.summary);
  expect(JSON.stringify(payload())).toContain(b.summary);
  expect(readFinal).toHaveBeenCalledOnce();
  expect(record.mock.calls[0][0].map((item: TaskMaterialObservation) => item.id)).toEqual([b.id, b.id]);
});

it.each(['A'.repeat(2048), '\\"\n'.repeat(600), '汉'.repeat(1000)])('omits material that would expand an already budgeted provider block (%#)', async longSummary => {
  const longMaterial = { ...material, id: 'long-finding', summary: longSummary };
  const page = { ...emptyMaterialPage({ requester: scope }, 'ready'), detail: { material: longMaterial, state: 'claim' as const } };
  const selection = await materialToolResult(page, 'tool-long', { runId });
  const messages: Parameters<StreamFn>[1]['messages'] = [{
    role: 'toolResult', toolName: 'sessions_list', toolCallId: 'tool-long', isError: false,
    timestamp: 1, content: [{ type: 'text', text: JSON.stringify(selection, null, 2) }],
  }];
  const { provider, payload: outbound } = capturingProvider();
  const read = vi.fn(async () => ({ material: longMaterial, state: 'claim' as const }));
  const record = vi.fn();
  const wrapped = withMaterialPromptUse(provider, { runId, modelCallId: 'long-summary-call', read, record });
  await (await wrapped({} as Parameters<StreamFn>[0], { messages })).result();
  const output = JSON.stringify(outbound()) ?? '';
  expect(output).not.toContain(longSummary);
  expect(output).toContain('material-use-unavailable');
  expect(Buffer.byteLength(output)).toBeLessThanOrEqual(Buffer.byteLength(JSON.stringify({ messages })));
  expect(record).not.toHaveBeenCalled();
});
