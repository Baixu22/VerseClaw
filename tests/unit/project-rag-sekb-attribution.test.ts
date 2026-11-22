// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeStore } from '../../openclaw_runtime/src/knowledge/sekb/knowledge-store';
import { DistillationTool } from '../../openclaw_runtime/src/knowledge/sekb/distillation-tool';
import { RetrievalEngine } from '../../openclaw_runtime/src/knowledge/sekb/retrieval-engine';
import { TrajectoryCapture } from '../../openclaw_runtime/src/knowledge/sekb/trajectory-capture';
import { installSekbHarnessHooks, type SekbHarnessHookTarget } from '../../openclaw_runtime/src/knowledge/sekb/harness-integration';
import { getPrincipleVersion, isConfirmedPrinciple, type Principle, type SekbAdoptionEvidence } from '../../openclaw_runtime/src/knowledge/sekb/types';
import { buildSekbOperatorReport } from '../../openclaw_runtime/src/knowledge/sekb/operator-report';
import { executeSessionCascadeDelete, createKnowledgeStoreCascadeAdapter } from '../../openclaw_runtime/src/knowledge/sekb/session-cascade-delete';
import { SekbChatKnowledgeSourceAdapter } from '../../openclaw_runtime/src/context-engine/chat-knowledge-source-adapters';
import { resolveChatKnowledgeIntent } from '../../openclaw_runtime/src/context-engine/chat-knowledge-intent';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';
import { upsertSessionEntry } from '../../openclaw_runtime/src/config/sessions/store';
import { closeSqliteSessionStoreDatabase } from '../../openclaw_runtime/src/config/sessions/store-sqlite';
import type { SourceRefV2 } from '../../shared/knowledge/owner-read-contract';
import { roleOrchestrationHandlers } from '../../openclaw_runtime/src/gateway/server-methods/role-orchestration-methods';

let root: string, store: KnowledgeStore, principle: Principle;
const priorState = process.env.OPENCLAW_STATE_DIR;
const priorEnabled = process.env.OPENCLAW_SEKB_ENABLED;
const sessionKey = 'agent:main:rag14';
const cfg = () => ({ agents: { defaults: { workspace: root } }, session: { store: join(root, 'sessions.json') },
  runtime: { contextBlock: { sekb: { enabled: true } } } });
const identity = () => ({ workspaceId: 'rag14-workspace', workspaceDir: root, agentSessionKey: sessionKey,
  sessionId: '11111111-1111-4111-8111-111111111111', egressProviderRefs: [] });
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'rag14-'));
  process.env.OPENCLAW_STATE_DIR = root;
  delete process.env.OPENCLAW_SEKB_ENABLED;
  store = new KnowledgeStore();
  const id = new DistillationTool({ store }).confirm_and_save({ cluster_summary: 'confirmed retrieval', source_trajectory_ids: [], confidence: 1,
    suggested_principle: { title: 'Check nebula invariants', condition: 'When changing nebula code', action: 'Verify nebula contracts',
      reason: 'The caller depends on nebula invariants', task_types: ['chat'], context_tags: ['nebula'] } }, null,
    { sessionId: identity().sessionId, sourceSystem: 'ui-confirm', drivenBy: 'agent', actor: 'rag14-test' });
  principle = store.get_principle(id);
  await upsertSessionEntry({ agentId: 'main', storePath: cfg().session.store, sessionKey,
    entry: { sessionId: identity().sessionId, workspaceId: identity().workspaceId, workspaceDir: root, updatedAt: Date.now() } });
});
afterEach(() => {
  closeSqliteSessionStoreDatabase(cfg().session.store);
  closeOpenClawStateDatabaseForTest();
  if (priorState === undefined) delete process.env.OPENCLAW_STATE_DIR; else process.env.OPENCLAW_STATE_DIR = priorState;
  if (priorEnabled === undefined) delete process.env.OPENCLAW_SEKB_ENABLED; else process.env.OPENCLAW_SEKB_ENABLED = priorEnabled;
  rmSync(root, { recursive: true, force: true });
});
const adapter = () => new SekbChatKnowledgeSourceAdapter(store, { cfg: cfg(), identity: identity() });
const ref = () => ({ id: 'selected', title: principle.title, lookup: `sekb:${principle.principle_id}`, corpus: 'all' as const });
const evidence = (patch: Partial<SekbAdoptionEvidence> = {}): SekbAdoptionEvidence => ({
  schemaVersion: 'RsiExperienceAttribution/v1', principleVersion: getPrincipleVersion(principle), taskId: 'task14', runId: 'run14',
  sessionId: identity().sessionId, sessionKey, experimentId: null, arm: null, repeat: null, trajectoryId: null,
  trigger: 'context-exposure', source: 'runtime', outcome: 'unknown', outcomeKind: null, observationId: null, operation: null,
  actor: 'rag14-test', driven_by: 'agent', ...patch,
});

describe('Project RAG confirmed experience lane', () => {
  it('retrieves confirmed relevant content without promoting title, tags or ranking metadata', () => {
    const engine = new RetrievalEngine({ store, confirmedOnly: true });
    expect(engine.retrieve_for_task('nebula', 'chat', []).map(p => p.principle_id)).toEqual([principle.principle_id]);
    store.update_principle(principle.principle_id, { title: 'unrelatedquery', context_tags: ['unrelatedquery'], pinned: true, criticality: 'critical' });
    expect(engine.retrieve_for_task('unrelatedquery', 'chat', [])).toEqual([]);
    for (const metadata of [{}, { ...principle.metadata, confirmIntegrity: 'advisory' }]) {
      store.update_principle(principle.principle_id, { metadata });
      expect(engine.retrieve_for_task('nebula', 'chat', [])).toEqual([]);
    }
    expect(store.get_principle(principle.principle_id).adoption_count).toBe(0);
  });

  it('binds canonical ID, owner namespace and content version while counters leave pins valid', async () => {
    expect(isConfirmedPrinciple(principle)).toBe(true);
    const first = await adapter().resolve(ref());
    if (first.status !== 'resolved') throw Error('Fixture did not resolve');
    const pin = first.resolved.ownerSnapshot!.source;
    expect(pin.revision).toBe(getPrincipleVersion(principle));
    const read = () => adapter().resolve({ ...ref(), sourceRef: pin });
    store.increment_retrieval_count(principle.principle_id);
    expect((await read()).status).toBe('resolved');
    expect((await adapter().resolve({ ...ref(), lookup: principle.title })).status).toBe('denied');
    expect((await adapter().resolve({ ...ref(), id: principle.principle_id, lookup: 'sekb:missing' })).status).toBe('denied');
    expect(await adapter().resolve({ ...ref(), sourceRef: { ...pin, namespaceId: 'foreign' } }))
      .toMatchObject({ status: 'denied', reason: 'namespace_mismatch' });
    store.update_principle(principle.principle_id, { action: 'Changed public action', updated_at: principle.updated_at });
    expect(await read()).toMatchObject({ status: 'denied', reason: 'revision_mismatch' });
    store.delete_principle(principle.principle_id);
    expect((await read()).status).toBe('denied');
  });

  it.each(['staging', 'archived', 'unconfirmed', 'secret', 'revoked', 'scope', 'disabled'])(
    'rejects %s before experience enters context', async kind => {
      const config = cfg();
      if (kind === 'disabled') config.runtime.contextBlock.sekb.enabled = false;
      else if (kind === 'staging' || kind === 'archived') store.update_principle(principle.principle_id, { status: kind });
      else store.update_principle(principle.principle_id, { metadata: kind === 'unconfirmed' ? {} : { ...principle.metadata,
        ...(kind === 'secret' ? { sensitivity: 'secret' } : kind === 'revoked' ? { status: 'revoked' } : { scope: { workspaceId: 'another' } }) } });
      expect((await new SekbChatKnowledgeSourceAdapter(store, { cfg: config, identity: identity() }).resolve(ref())).status).toBe('denied');
    });

  it.each(['wiki', 'memory'])('rejects an explicit experience prefix conflicting with %s corpus', async corpus => {
    const result = await resolveChatKnowledgeIntent({ scope: 'all', mode: 'manual', references: [{ ...ref(), corpus }], adapters: [adapter()] });
    expect(result.admitted).toEqual([]);
    expect(result.denied[0].reason).toBe('unsupported_owner');
  });

  it('records UI exposure separately and requires actual context exposure before adoption', () => {
    const operation = { toolCallId: 'edit14', toolName: 'edit', observed: true, succeeded: true };
    expect(store.record_adoption(principle.principle_id, evidence({ trigger: 'ui-exposure' })).status).toBe('accepted');
    expect(store.record_adoption(principle.principle_id, evidence({ trigger: 'adopted', source: 'agent', operation })).reason).toBe('principle-not-exposed');
    store.record_adoption(principle.principle_id, evidence());
    store.record_adoption(principle.principle_id, evidence({ trigger: 'operation', operation }));
    store.record_adoption(principle.principle_id, evidence({ trigger: 'cited', source: 'agent' }));
    store.record_adoption(principle.principle_id, evidence({ trigger: 'adopted', source: 'agent', operation }));
    store.record_adoption(principle.principle_id, evidence({ trigger: 'adopted', source: 'agent', operation }));
    store.record_adoption(principle.principle_id, evidence({ trigger: 'outcome', outcomeKind: 'operational', outcome: 'success', observationId: 'end' }));
    expect(store.get_principle(principle.principle_id)).toMatchObject({ adoption_count: 1, post_adoption_success: 0 });
    store.record_adoption(principle.principle_id, evidence({ trigger: 'outcome', source: 'grader', outcomeKind: 'task', outcome: 'failure', observationId: 'grade' }));
    expect(buildSekbOperatorReport(store).attribution).toMatchObject({ uiExposures: 1, contextExposures: 1, citations: 1, adoptions: 1, operationalOutcomes: 1, taskGrades: 1 });
    store.record_adoption(principle.principle_id, evidence({ trigger: 'retrieved', runId: 'historical-hook-run' }));
    expect(buildSekbOperatorReport(store).attribution.contextExposures).toBe(1);
    store.delete_principle(principle.principle_id);
    expect(store.list_adoption_events()).toEqual([]);
  });

  it('removes session UI receipts while retaining a principle confirmed in another session', () => {
    const other = evidence({ runId: 'ui:other', sessionId: 'other-session', sessionKey: 'agent:main:other' });
    const operation = { toolCallId: 'other-operation', toolName: 'write', observed: true, succeeded: true };
    store.record_adoption(principle.principle_id, { ...other, trigger: 'ui-exposure' });
    store.record_adoption(principle.principle_id, other);
    store.record_adoption(principle.principle_id, { ...other, trigger: 'operation', operation });
    store.record_adoption(principle.principle_id, { ...other, trigger: 'adopted', source: 'agent', operation });
    store.record_adoption(principle.principle_id, { ...other, trigger: 'outcome', source: 'grader', outcomeKind: 'task', outcome: 'success', observationId: 'grade' });
    const result = executeSessionCascadeDelete('other-session', createKnowledgeStoreCascadeAdapter(store));
    expect(result.success).toBe(true);
    expect(store.list_adoption_events()).toEqual([]);
    expect(store.get_principle(principle.principle_id)).toMatchObject({ adoption_count: 0, post_adoption_success: 0 });
  });

  it.each([false, true])('uses DCS retained pins for real hook adoption, retained=%s', async retained => {
    const read = await adapter().resolve(ref());
    if (read.status !== 'resolved') throw Error('Fixture did not resolve');
    const pin = read.resolved.ownerSnapshot!.source;
    const handlers = new Map<string, (event: unknown) => unknown>();
    let tool: Parameters<NonNullable<SekbHarnessHookTarget['registerTool']>>[0] | undefined;
    const target: SekbHarnessHookTarget = { on: (name, fn) => { handlers.set(name, fn); return () => {}; }, registerTool: definition => { tool = definition; } };
    const injector = new RetrievalEngine({ store }).create_context_injector();
    const injection = vi.spyOn(injector, 'for_task');
    let pins: SourceRefV2[] = [];
    const cleanup = installSekbHarnessHooks(target, { enabled: true, capture: new TrajectoryCapture({ store }), injector, store,
      identity: evidence(), retainedExperience: () => pins });
    await handlers.get('before_agent_start')!({ prompt: 'Verify nebula', systemPrompt: 'system' });
    expect(injection).not.toHaveBeenCalled();
    pins = retained ? [pin] : [];
    await handlers.get('context')!({ messages: [] });
    expect(store.list_adoption_events().filter(row => row.evidence.trigger === 'context-exposure')).toHaveLength(retained ? 1 : 0);
    await handlers.get('tool_call')!({ toolCallId: 'edit14', toolName: 'edit', input: {} });
    await handlers.get('tool_result')!({ toolCallId: 'edit14', toolName: 'edit', input: {}, content: [{ type: 'text', text: 'changed' }], isError: false });
    const result = await tool!.execute('attribution', { principleId: principle.principle_id, principleVersion: getPrincipleVersion(principle), trigger: 'adopted', operationToolCallId: 'edit14' }, undefined, undefined, {} as never);
    expect(result.details).toMatchObject({ status: retained ? 'accepted' : 'rejected' });
    await handlers.get('agent_end')!({ success: true });
    expect(store.get_principle(principle.principle_id).adoption_count).toBe(retained ? 1 : 0);
    expect(store.get_principle(principle.principle_id).post_adoption_success).toBe(0);
    store.update_principle(principle.principle_id, { metadata: { ...principle.metadata, status: 'revoked' } });
    expect((await tool!.execute('late', { principleId: principle.principle_id, principleVersion: getPrincipleVersion(principle), trigger: 'cited' }, undefined, undefined, {} as never)).details)
      .toMatchObject({ status: 'rejected' });
    cleanup();
  });

  it('serves pinned confirmed candidates through the backend-only Gateway route', async () => {
    const call = async (scopes: string[], query = 'nebula') => {
      const respond = vi.fn();
      await roleOrchestrationHandlers['sekb.retrieve']({ params: { query, taskType: 'chat', readIdentity: identity() }, respond,
        context: { getRuntimeConfig: cfg }, client: { connect: { client: { mode: 'backend' }, scopes } } } as never);
      return respond.mock.calls[0];
    };
    expect((await call(['operator.read']))[0]).toBe(false);
    const result = (await call(['operator.admin']))[1];
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].sourceRef).toMatchObject({ domain: 'experience', authorityId: 'sekb', revision: getPrincipleVersion(principle) });
    expect(store.list_adoption_events()).toEqual([]);
    const respond = vi.fn();
    await roleOrchestrationHandlers['sekb.recordExposure']({ params: { requestId: result.requestId,
      sourceRefs: [result.candidates[0].sourceRef], readIdentity: identity() }, respond,
      context: { getRuntimeConfig: cfg }, client: { connect: { client: { mode: 'backend' }, scopes: ['operator.admin'] } } } as never);
    expect(respond.mock.calls[0][1]).toMatchObject({ success: true, recorded: 1 });
    expect(store.list_adoption_events().map(row => row.evidence.trigger)).toEqual(['ui-exposure']);
  });
});
