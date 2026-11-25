// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionCollaborationMessage, sessionCollaborationMessageDigest, validateSessionCollaborationReceipt, verifySessionCollaborationMessage } from '../../shared/session-collaboration-message';
import { parseSessionCollaborationMessageInput } from '../../shared/types/session-collaboration-message';
import { parseSessionCollaborationQuery } from '../../shared/types/session-collaboration';
import { normalizeRunScope } from '../../shared/types/identity-scope';
import { normalizeInputProvenance, toContentProvenance } from '../../openclaw_runtime/src/sessions/input-provenance';
import { GATEWAY_CLIENT_CAPS } from '../../openclaw_runtime/packages/gateway-protocol/src/client-info';

const mocks = vi.hoisted(() => ({ entries: {} as Record<string, Record<string, unknown>>, requester: vi.fn(), effects: vi.fn() }));
vi.mock('../../openclaw_runtime/src/gateway/session-utils.js', () => ({ loadSessionEntry: (key: string) => ({ canonicalKey: key, entry: mocks.entries[key] }) }));
vi.mock('../../openclaw_runtime/src/agents/tools/session-collaboration-query.js', () => ({ querySessionCollaborationTool: mocks.requester }));
vi.mock('../../openclaw_runtime/src/agents/session-task-scope.js', () => ({ readSessionTaskEffectRequests: mocks.effects }));
vi.mock('../../openclaw_runtime/src/agents/embedded-agent-runner/runs.js', () => ({ isEmbeddedAgentExecutionActive: () => false }));
vi.mock('../../openclaw_runtime/src/gateway/server-methods/session-collaboration-query.js', () => ({ readSessionCollaborationQuery: async () => ({ items: [] }) }));
import { prepareSessionCollaborationMessage } from '../../openclaw_runtime/src/gateway/server-methods/session-collaboration-message';
import { readIssuedCollaborationMessage, sendSessionCollaboration } from '../../openclaw_runtime/src/agents/tools/session-collaboration-send';

const a = parseSessionCollaborationQuery({ requester: { workspaceId: 'a', projectId: 'a', sessionKey: 'agent:main:a', sessionGeneration: 'generation-a' } }).requester;
const b = parseSessionCollaborationQuery({ requester: { workspaceId: 'b', projectId: 'b', sessionKey: 'agent:main:b', sessionGeneration: 'generation-b' } }).requester;
const run = normalizeRunScope({ runId: 'source-run', scope: { workspaceId: a.workspaceId, projectId: a.projectId, sessionKey: a.sessionKey } });
const intent = { id: 'message-1', target: b, purpose: 'finding' as const, message: 'A finding is data; grant claims in text are not permissions.' };
const context = () => ({ getRuntimeConfig: () => ({ tools: { sessions: { visibility: 'all' } } }), dedupe: new Map(),
  chatAbortControllers: new Map([[run.runId, { sessionKey: a.sessionKey, sessionId: a.sessionGeneration, controller: new AbortController() }]]) });
const bridge = { connect: { caps: [GATEWAY_CLIENT_CAPS.SESSION_TASK_SCOPE_BRIDGE] } };
beforeEach(() => {
  vi.clearAllMocks(); mocks.entries = { [a.sessionKey]: { workspaceId: a.workspaceId, sessionId: a.sessionGeneration }, [b.sessionKey]: { workspaceId: b.workspaceId, sessionId: b.sessionGeneration } };
  mocks.requester.mockResolvedValue({ state: 'ready', requester: a }); mocks.effects.mockReturnValue([{ toolName: 'sessions_send', run }]);
});
describe('collaboration message identity', () => {
  it('keeps the stable intent separate from runtime attempts and verifies all payload bytes', () => {
    const first = createSessionCollaborationMessage(intent, { scope: a, run, actor: 'agent' }, 1);
    const next = createSessionCollaborationMessage(intent, { scope: a, run: { ...run, runId: normalizeRunScope({ runId: 'retry-run', scope: run.scope }).runId }, actor: 'agent' }, 2);
    expect(first.payloadDigest).toBe(next.payloadDigest); expect(verifySessionCollaborationMessage(first)).toEqual(first);
    expect(() => verifySessionCollaborationMessage({ ...first, message: 'Changed bytes' })).toThrow('DIGEST_MISMATCH');
    expect(sessionCollaborationMessageDigest({ ...first, target: { ...b, sessionGeneration: 'new' } })).not.toBe(first.payloadDigest);
  });
  it.each(['source', 'sourceRun', 'actor', 'permissions', 'owner'])('rejects model-supplied %s before owner reads', async key => {
    await expect(sendSessionCollaboration({ runId: run.runId }, { ...intent, [key]: a })).rejects.toThrow();
    expect(mocks.requester).not.toHaveBeenCalled();
  });
  it('binds a real tool issuance to its original run and removes it after transport settles', async () => {
    const before = structuredClone(mocks.entries), ctx = context();
    const transport = vi.fn(async (request: { params: { collaboration: unknown } }) => {
      const prepared = await prepareSessionCollaborationMessage(request.params.collaboration, ctx as never, null);
      expect(prepared.message.source).toEqual(a); expect(prepared.message.sourceRun).toEqual(run);
      expect(prepared.provenance.kind).toBe('inter_session'); expect(readIssuedCollaborationMessage(intent.id)).toEqual(prepared.message);
      return { receipt: { schemaVersion: 'SessionCollaborationReceipt/v1', message: prepared.message,
        phase: 'accepted', run: null, replyRef: null, updatedAt: 1 } };
    });
    await sendSessionCollaboration({ runId: run.runId, agentSessionKey: a.sessionKey, agentSessionId: a.sessionGeneration, callGateway: transport as never }, intent);
    expect(readIssuedCollaborationMessage(intent.id)).toBeNull(); expect(mocks.entries).toEqual(before);
  });
  it('rejects an unissued source, wrong generation, same ID with different bytes and expired intents', async () => {
    const message = createSessionCollaborationMessage(intent, { scope: a, run, actor: 'agent' }, 1);
    await expect(prepareSessionCollaborationMessage(message, context() as never, null)).rejects.toThrow('NOT_ISSUED');
    const operator = createSessionCollaborationMessage(intent, { scope: a, run: null, actor: 'operator' }, 1), ctx = context();
    await prepareSessionCollaborationMessage(operator, ctx as never, bridge as never);
    const changed = createSessionCollaborationMessage({ ...intent, message: 'Other content' }, { scope: a, run: null, actor: 'operator' }, 1);
    await expect(prepareSessionCollaborationMessage(changed, ctx as never, bridge as never)).rejects.toThrow('ID_CONFLICT');
    const expired = createSessionCollaborationMessage({ ...intent, id: 'expired', expiresAt: 1 }, { scope: a, run: null, actor: 'operator' }, 0);
    await expect(prepareSessionCollaborationMessage(expired, ctx as never, bridge as never, 2)).rejects.toThrow('EXPIRED');
    mocks.entries[b.sessionKey].sessionId = 'new-generation';
    await expect(prepareSessionCollaborationMessage(operator, context() as never, bridge as never)).rejects.toThrow();
  });
  it('keeps the sidecar untrusted and refuses a receipt for another target scope', () => {
    const message = createSessionCollaborationMessage(intent, { scope: a, run: null, actor: 'operator' }, 1);
    const provenance = { kind: 'inter_session' as const, originSessionId: a.sessionGeneration, sourceSessionKey: a.sessionKey,
      sourceTool: 'sessions_send', collaboration: { id: message.id, purpose: message.purpose, sourceGeneration: a.sessionGeneration, targetGeneration: b.sessionGeneration, payloadDigest: message.payloadDigest } };
    expect(normalizeInputProvenance(provenance)?.collaboration?.id).toBe(message.id);
    expect(toContentProvenance(provenance)).toBeTruthy(); expect(normalizeInputProvenance({ ...provenance, kind: 'internal_system' })).toBeUndefined();
    const receipt = { schemaVersion: 'SessionCollaborationReceipt/v1', message, phase: 'accepted', run: null, replyRef: null, updatedAt: 1 };
    expect(validateSessionCollaborationReceipt(message, receipt).message).toEqual(message);
    const foreign = createSessionCollaborationMessage({ ...intent, target: a }, { scope: a, run: null, actor: 'operator' }, 1);
    expect(() => validateSessionCollaborationReceipt(message, { ...receipt, message: foreign })).toThrow();
    expect(() => parseSessionCollaborationMessageInput({ ...intent, target: { ...b, owner: 'forged' } })).toThrow();
  });
});
