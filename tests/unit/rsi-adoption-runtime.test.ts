// @vitest-environment node
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildEmbeddedExtensionFactories } from '../../openclaw_runtime/src/agents/embedded-agent-runner/extensions';
import { resolveEmbeddedSekbRuntime } from '../../openclaw_runtime/src/agents/embedded-agent-runner/sekb-runtime';
import { createEventBus } from '../../openclaw_runtime/src/agents/sessions/event-bus';
import { createExtensionRuntime, loadExtensionFromFactory } from '../../openclaw_runtime/src/agents/sessions/extensions/loader';
import { ExtensionRunner } from '../../openclaw_runtime/src/agents/sessions/extensions/runner';
import { SessionManager } from '../../openclaw_runtime/src/agents/sessions/session-manager';
import { AuthStorage } from '../../openclaw_runtime/src/agents/sessions/auth-storage';
import { ModelRegistry } from '../../openclaw_runtime/src/agents/sessions/model-registry';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';
import { clearTaskStateHandlerConfig } from '../../openclaw_runtime/src/agents/harness/lifecycle-hook-helpers';
import { getPrincipleVersion, type Principle } from '../../openclaw_runtime/src/knowledge/sekb/types';
import { createEditTool } from '../../openclaw_runtime/src/agents/sessions/tools/edit';

const oldStateDir = process.env.OPENCLAW_STATE_DIR;
const roots: string[] = [];
afterEach(() => {
  clearTaskStateHandlerConfig();
  closeOpenClawStateDatabaseForTest();
  if (oldStateDir === undefined) delete process.env.OPENCLAW_STATE_DIR;
  else process.env.OPENCLAW_STATE_DIR = oldStateDir;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function setup(enabled: boolean, experimental: boolean) {
  const root = mkdtempSync('D:/tmp/rsi-adoption-runtime-');
  roots.push(root);
  process.env.OPENCLAW_STATE_DIR = root;
  const cfg = { runtime: { contextBlock: { sekb: { enabled } } } };
  const sekb = resolveEmbeddedSekbRuntime({ cfg, env: {} });
  const principle: Principle = {
    principle_id: 'runtime-principle', created_at: '2026-11-08T00:00:00.000Z',
    updated_at: '2026-11-08T00:00:00.000Z', title: 'Verify TypeScript interfaces',
    condition: 'When implementing TypeScript code', action: 'Verify the exported public interface',
    reason: 'Public interfaces describe caller expectations', full_content: 'Verify TypeScript interfaces',
    task_types: ['code/task'], context_tags: ['code'], embedding: null, source_trajectories: [],
    created_by: 'agent', status: 'active', retrieval_count: 0, adoption_count: 0,
    post_adoption_success: 0, criticality: 'medium', pinned: false, metadata: {},
  };
  sekb?.store.save_principle(principle);
  const sessionManager = SessionManager.inMemory(root);
  const factories = buildEmbeddedExtensionFactories({
    cfg, sessionManager, provider: 'openai', modelId: 'gpt-5.5', model: undefined,
    runId: 'production-run', sessionId: 'production-session', sessionKey: 'agent:rsi:main',
    sekbRuntime: sekb,
    ...(experimental ? { sekbAttribution: { taskId: 'task-code', experimentId: 'agent-simulated-run', arm: 'on', repeat: 1 } } : {}),
  });
  const extensionRuntime = createExtensionRuntime();
  const bus = createEventBus();
  const extensions = [];
  for (const factory of factories) extensions.push(await loadExtensionFromFactory(factory, root, bus, extensionRuntime));
  const runner = new ExtensionRunner(extensions, extensionRuntime, root, sessionManager, ModelRegistry.inMemory(AuthStorage.inMemory()));
  const tool = runner.getToolDefinition('record_sekb_adoption');
  const start = () => runner.emitBeforeAgentStart('Implement a TypeScript function', undefined, 'System prompt', {
    cwd: root,
  });
  return { root, sekb, principle, runner, tool, start, bus };
}

describe('production SEKB adoption through real extension events', () => {
  it('binds a registered agent attribution tool, observed operation and unknown terminal outcome', async () => {
    const { root, sekb, principle, runner, tool, start } = await setup(true, true);
    expect(tool).toBeDefined();
    expect(tool?.writeRiskProfile).toMatchObject({ kind: 'durable_state', ownerStore: 'sekb_attribution_events', requiresApproval: false });
    const injected = await start();
    const version = getPrincipleVersion(sekb!.store.get_principle(principle.principle_id));
    expect(injected?.systemPrompt).toContain(`${principle.principle_id}@${version}`);
    expect(sekb!.store.get_principle(principle.principle_id).adoption_count).toBe(0);
    const invoke = (trigger: string, operationToolCallId?: string) => tool!.execute('attribution-call', {
      principleId: principle.principle_id, principleVersion: version, trigger,
      ...(operationToolCallId ? { operationToolCallId } : {}),
    }, undefined, undefined, runner.createContext());
    const aborted = new AbortController();
    aborted.abort();
    await expect(tool!.execute('cancelled-attribution', {
      principleId: principle.principle_id, principleVersion: version, trigger: 'cited',
    }, aborted.signal, undefined, runner.createContext())).rejects.toMatchObject({ name: 'AbortError' });
    expect(sekb!.store.list_adoption_events()).toHaveLength(1);
    await invoke('cited');
    expect((await invoke('adopted', 'not-observed')).details).toMatchObject({ status: 'rejected', reason: 'operation-not-observed' });
    expect((await invoke('adopted', 'edit-1')).details).toMatchObject({ status: 'rejected', reason: 'operation-not-observed' });
    const publicFile = join(root, 'public.ts');
    writeFileSync(publicFile, 'export const value = 1;\n');
    const beforeSha256 = createHash('sha256').update(readFileSync(publicFile)).digest('hex');
    const editInput = { path: 'public.ts', edits: [{ oldText: 'value = 1', newText: 'value = 2' }] };
    await runner.emitToolCall({ type: 'tool_call', toolCallId: 'edit-1', toolName: 'edit', input: editInput });
    const editResult = await createEditTool(root).execute('edit-1', editInput, undefined);
    expect(readFileSync(publicFile, 'utf8')).toBe('export const value = 2;\n');
    const afterSha256 = createHash('sha256').update(readFileSync(publicFile)).digest('hex');
    await runner.emitToolResult({ type: 'tool_result', toolCallId: 'edit-1', toolName: 'edit', input: editInput, ...editResult, isError: false });
    expect((await invoke('adopted', 'edit-1')).details).toMatchObject({ status: 'accepted', disposition: 'recorded' });
    expect((await invoke('adopted', 'edit-1')).details).toMatchObject({ disposition: 'duplicate', duplicateCount: 1 });
    await expect(tool!.execute('untrusted-coordinate', {
      principleId: principle.principle_id, principleVersion: version, trigger: 'cited', arm: 'off',
    }, undefined, undefined, runner.createContext())).rejects.toThrow(/arguments/);
    await runner.emit({ type: 'agent_end', messages: [] });
    const events = sekb!.store.list_adoption_events();
    expect(events.every((event) => event.evidence.runId === 'production-run' && event.evidence.taskId === 'task-code' && event.evidence.arm === 'on' && event.evidence.repeat === 1)).toBe(true);
    expect(events.find((event) => event.evidence.trigger === 'outcome')?.evidence).toMatchObject({ source: 'runtime', outcomeKind: 'operational', outcome: 'unknown' });
    expect(sekb!.store.get_principle(principle.principle_id)).toMatchObject({ adoption_count: 1, post_adoption_success: 0 });
    const adopted = events.find((event) => event.evidence.trigger === 'adopted' && event.status === 'accepted')!;
    sekb!.store.record_adoption(principle.principle_id, { ...adopted.evidence, trigger: 'outcome', source: 'grader', actor: 'codex/scripted-test-grader', outcomeKind: 'task', outcome: 'success', operation: null, observationId: 'scripted-independent-grade' });
    expect(sekb!.store.get_principle(principle.principle_id).post_adoption_success).toBe(1);
    const reportPath = process.env.RSI_ADOPTION_EVENT_REPORT;
    if (reportPath) writeFileSync(reportPath, JSON.stringify({
      schemaVersion: 'RsiAdoptionRuntimeReadback/v1', driven_by: 'agent', actor: 'codex/rsi-adoption-runtime-test',
      paidProviderCalls: 0, operation: { implementation: 'createEditTool', beforeSha256, afterSha256 },
      events: sekb!.store.list_adoption_events(), principle: sekb!.store.get_principle(principle.principle_id),
    }, null, 2) + '\n');
    const snapshotPath = process.env.RSI_ADOPTION_DB_SNAPSHOT;
    if (snapshotPath) {
      closeOpenClawStateDatabaseForTest();
      copyFileSync(join(root, 'state', 'openclaw.sqlite'), snapshotPath);
    }
  });

  it('keeps ordinary runs without experiment coordinates explicit and installs nothing when disabled', async () => {
    const enabled = await setup(true, false);
    expect(enabled.tool).toBeDefined();
    await enabled.start();
    await enabled.runner.emit({ type: 'agent_end', messages: [] });
    const receipt = enabled.sekb!.store.list_adoption_events().find((event) => event.evidence.trigger === 'retrieved')!;
    expect(receipt.evidence).toMatchObject({ runId: 'production-run', sessionId: 'production-session', taskId: null, experimentId: null, arm: null, repeat: null });
    closeOpenClawStateDatabaseForTest();
    const disabled = await setup(false, false);
    expect(disabled.tool).toBeUndefined();
    expect(disabled.sekb).toBeUndefined();
    expect(await disabled.start()).toBeUndefined();
  });
});
