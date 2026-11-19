// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, writeFile, unlink, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenClawConfig } from '../../openclaw_runtime/src/config/types.openclaw';
import type { MemoryCard } from '../../openclaw_runtime/src/memory/types';
import { clearMemoryCards, setMemoryStorePath, storeMemoryCard } from '../../openclaw_runtime/src/memory/memory-store';
import { closeOpenClawStateDatabase } from '../../openclaw_runtime/src/state/openclaw-state-db';
import { upsertSessionEntry } from '../../openclaw_runtime/src/config/sessions/store';
import { closeSqliteSessionStoreDatabase } from '../../openclaw_runtime/src/config/sessions/store-sqlite';
import { registerMemoryRuntimeForPlugin, registerMemoryPromptSectionForPlugin, registerMemoryCapability, getMemoryCapabilityRegistration, restoreMemoryPluginState, clearMemoryPluginState } from '../../openclaw_runtime/src/plugins/memory-state';
import { getActiveMemorySearchManager } from '../../openclaw_runtime/src/plugins/memory-runtime';
import { readMemoryFile } from '../../openclaw_runtime/packages/memory-host-sdk/src/host/read-file';
import { digestOwnerReadContent, isSourceRefV2 } from '../../openclaw_runtime/src/runtime-core/knowledge-owner-read';
import { clearAgentRunContext, getAgentRunContext, registerAgentRunContext, resetAgentRunContextForTest } from '../../openclaw_runtime/src/infra/agent-events';
import { readNativeMemorySource } from '../../openclaw_runtime/src/memory/native-memory-source';
import { createProductionChatKnowledgeSourceAdapters, NativeMemoryChatKnowledgeSourceAdapter,
  RoleMemoryChatKnowledgeSourceAdapter, revalidateChatKnowledgeRefs } from '../../openclaw_runtime/src/context-engine/chat-knowledge-source-adapters';
import { resolveChatKnowledgeIntent } from '../../openclaw_runtime/src/context-engine/chat-knowledge-intent';
import type { MemoryPluginRuntime } from '../../openclaw_runtime/src/plugins/memory-state';
import { runAgentAttempt } from '../../openclaw_runtime/src/agents/command/attempt-execution';

vi.mock('../../openclaw_runtime/src/agents/embedded-agent', () => ({ runEmbeddedAgent: vi.fn() }));

let root: string, cfg: OpenClawConfig;
const sessionKey = 'agent:main:rag13';
const identity = () => ({ workspaceId: 'rag13-owner', workspaceDir: join(root, 'workspace'),
  agentSessionKey: sessionKey, sessionId: '11111111-1111-4111-8111-111111111111', egressProviderRefs: [] });
const raw = (value: string, metadata = '') => `---\ntrust: confirmed\nupdatedAt: "2026-11-16T00:00:00Z"\n${metadata}---\n${value}\r\n`;
function runtime(beforeRead?: () => Promise<void> | void, ownerRoot = () => identity().workspaceDir): MemoryPluginRuntime {
  const manager = {
    readFile: async (input: { relPath: string; raw?: boolean }) => {
      await beforeRead?.();
      return readMemoryFile({ workspaceDir: identity().workspaceDir, ...input });
    },
    search: async () => [], status: () => ({ backend: 'builtin' as const, provider: 'fixture', workspaceDir: ownerRoot() }),
    probeEmbeddingAvailability: async () => ({ ok: true }), probeVectorAvailability: async () => true,
  };
  return { getMemorySearchManager: async () => ({ manager }), resolveMemoryBackendConfig: () => ({ backend: 'builtin' }) };
}
function card(id = 'shared.md', content = 'ROLE13_BODY'): MemoryCard {
  const at = new Date().toISOString();
  return { id, type: 'fact', scope: 'workspace', scopeKey: identity().workspaceId, roleTags: [], content,
    evidence: [], confidence: 1, importance: 1, lastAccessedAt: at, createdAt: at, updatedAt: at,
    accessCount: 0, version: 1, status: 'active', sensitivity: 'normal' };
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'rag13-memory-'));
  await mkdir(join(root, 'workspace/memory'), { recursive: true });
  cfg = { agents: { defaults: { workspace: identity().workspaceDir, memorySearch: { enabled: true } } },
    plugins: { slots: { memory: 'memory-core' }, entries: { 'memory-core': { enabled: true } } },
    session: { store: join(root, 'sessions.json') } };
  await upsertSessionEntry({ agentId: 'main', storePath: cfg.session!.store, sessionKey,
    entry: { sessionId: identity().sessionId, updatedAt: Date.now(), workspaceDir: identity().workspaceDir } });
  registerMemoryRuntimeForPlugin('memory-core', runtime());
  setMemoryStorePath(join(root, 'role-memory.sqlite'));
});
afterEach(async () => {
  resetAgentRunContextForTest();
  clearMemoryPluginState();
  clearMemoryCards();
  setMemoryStorePath(undefined);
  closeSqliteSessionStoreDatabase(cfg.session!.store!);
  closeOpenClawStateDatabase();
  await rm(root, { recursive: true, force: true });
});

describe('Project RAG independent memory owners', () => {
  it.each(['native-memory', 'memory-slot'])('rejects a %s bootstrap prefix conflicting with wiki corpus before reading', async owner => {
    await writeFile(join(root, 'workspace/memory/source.md'), raw('CONFLICT_NATIVE_BODY'));
    storeMemoryCard(card('role', 'CONFLICT_ROLE_BODY'));
    const adapters = createProductionChatKnowledgeSourceAdapters(cfg, { identity: identity() });
    const reads = adapters.map(adapter => vi.spyOn(adapter, 'resolve'));
    const result = await resolveChatKnowledgeIntent({ scope: 'all', mode: 'manual', adapters,
      references: [{ id: 'conflict', title: 'conflict', corpus: 'wiki',
        lookup: owner === 'native-memory' ? 'native-memory:memory/source.md' : 'memory-slot:role' }] });
    expect(result.admitted).toEqual([]);
    expect(result.denied).toEqual([expect.objectContaining({ reason: 'unsupported_owner' })]);
    for (const read of reads) expect(read).not.toHaveBeenCalled();
  });

  it('keeps the runtime owner distinct from a public-artifact bridge', async () => {
    const read = vi.fn();
    registerMemoryRuntimeForPlugin('memory-core', runtime(read));
    registerMemoryCapability('bridge-memory', { publicArtifacts: { listArtifacts: async () => [] } });
    registerMemoryPromptSectionForPlugin('bridge-memory', () => ['Bridge prompt']);
    const capability = getMemoryCapabilityRegistration();
    clearMemoryPluginState();
    restoreMemoryPluginState({ capability, corpusSupplements: [], promptSupplements: [] });
    await writeFile(join(root, 'workspace/memory/source.md'), raw('RUNTIME_OWNER_BODY'));
    expect(await readNativeMemorySource({ cfg, identity: identity(), lookup: 'memory/source.md' }))
      .toMatchObject({ status: 'admitted' });
    read.mockClear();
    cfg.plugins!.slots!.memory = 'bridge-memory';
    expect(await readNativeMemorySource({ cfg, identity: identity(), lookup: 'memory/source.md' }))
      .toMatchObject({ status: 'denied' });
    expect(read).not.toHaveBeenCalled();
    expect((await getActiveMemorySearchManager({ cfg, agentId: 'main' })).manager).not.toBeNull();
  });

  it.each([[], ['operator.read'], ['operator.write']].map(scopes => [scopes]))('denies backend owner snapshots without admin scope %j', async scopes => {
    await writeFile(join(root, 'workspace/memory/source.md'), raw('ADMIN_ONLY_MEMORY_BODY'));
    const read = await readNativeMemorySource({ cfg, identity: identity(), lookup: 'memory/source.md' });
    if (read.status !== 'admitted') throw Error('memory fixture failed');
    const { roleOrchestrationHandlers } = await import('../../openclaw_runtime/src/gateway/server-methods/role-orchestration-methods');
    const respond = vi.fn();
    await roleOrchestrationHandlers['memory.readSource']({
      params: { sourceRef: read.snapshot.source, readIdentity: identity() }, respond,
      context: { getRuntimeConfig: () => cfg }, client: { connect: { client: { mode: 'backend' }, scopes } },
    } as never);
    expect(respond.mock.calls[0][0]).toBe(false);
    expect(JSON.stringify(respond.mock.calls)).not.toContain('ADMIN_ONLY_MEMORY_BODY');
  });

  it('binds a plain native file to the configured owner workspace and agent', async () => {
    await writeFile(join(root, 'workspace/memory/plain.md'), 'PLAIN_NATIVE_BODY');
    const read = await readNativeMemorySource({ cfg, identity: identity(), lookup: 'memory/plain.md' });
    expect(read).toMatchObject({ status: 'admitted', snapshot: { content: 'PLAIN_NATIVE_BODY',
      policy: { scope: { workspaceId: identity().workspaceId, agentId: 'main' } } } });
  });

  it.each(['absolute-outside', 'relative-outside', 'workspace-nonmemory'])('rejects an unpinned native lookup at %s', async kind => {
    const outside = join(root, 'outside.md'), unowned = join(root, 'workspace/notes/unowned.md');
    await mkdir(join(root, 'workspace/notes'));
    await writeFile(outside, 'OUTSIDE_OWNER_BODY');
    await writeFile(unowned, 'NONMEMORY_BODY');
    const lookup = kind === 'absolute-outside' ? outside : kind === 'relative-outside' ? '../outside.md' : 'notes/unowned.md';
    const result = await new NativeMemoryChatKnowledgeSourceAdapter({ cfg, identity: identity() }).resolve({
      id: 'n', title: 'n', lookup: 'native-memory:' + lookup, corpus: 'memory' });
    expect(result.status).toBe('denied');
    expect(JSON.stringify(result)).not.toContain('_BODY');
  });

  it.each(['reverse', 'past-eof', 'fractional', 'wrong-line', 'split-utf8'])('rejects a native pin with %s coordinates', async kind => {
    const content = raw('中文😀');
    await writeFile(join(root, 'workspace/memory/range.md'), content);
    const full = await readNativeMemorySource({ cfg, identity: identity(), lookup: 'memory/range.md' });
    if (full.status !== 'admitted') throw Error('memory fixture failed');
    const locator = { ...full.snapshot.source.locator! };
    if (kind === 'reverse') { locator.startByte = 10; locator.endByteExclusive = 5; }
    if (kind === 'past-eof') { locator.startByte = Buffer.byteLength(content) + 1; locator.endByteExclusive = locator.startByte; }
    if (kind === 'fractional') locator.startByte = 0.5;
    if (kind === 'wrong-line') locator.startLine += 1;
    if (kind === 'split-utf8') locator.endByteExclusive = Buffer.byteLength(content.slice(0, content.indexOf('中文'))) + 1;
    const pin = { ...full.snapshot.source, locator };
    if (['reverse', 'fractional'].includes(kind)) expect(isSourceRefV2(pin)).toBe(false);
    const result = await readNativeMemorySource({ cfg, identity: identity(), lookup: 'memory/range.md', sourceRef: pin });
    expect(result.status).toBe('denied');
    expect(JSON.stringify(result)).not.toContain('中文');
  });

  it.each(['success', 'error', 'rebind'] as const)('releases only its own internal read binding after attempt %s', async outcome => {
    await writeFile(join(root, 'workspace/memory/source.md'), raw('ATTEMPT_OWNER_BODY'));
    const internalIdentity = { ...identity(), agentSessionKey: 'agent:main:knowledge-attempt', sessionId: '33333333-3333-4333-8333-333333333333' };
    const runId = 'knowledge:rag13-attempt';
    const { runEmbeddedAgent } = await import('../../openclaw_runtime/src/agents/embedded-agent');
    const read = () => readNativeMemorySource({ cfg, identity: internalIdentity, internalRunId: runId, lookup: 'memory/source.md' });
    registerAgentRunContext(runId, { sessionId: internalIdentity.sessionId, sessionKey: internalIdentity.agentSessionKey });
    vi.mocked(runEmbeddedAgent).mockImplementationOnce(async input => {
      expect(input.chatKnowledgeRefs?.[0].content).toContain('ATTEMPT_OWNER_BODY');
      expect(await read()).toMatchObject({ status: 'admitted' });
      if (outcome === 'rebind') registerAgentRunContext(runId, { internalKnowledgeRead: { ...internalIdentity,
        sessionKey: internalIdentity.agentSessionKey, sessionId: 'new-generation' } });
      if (outcome === 'error') throw Error('embedded attempt failed');
      return { payloads: [], meta: { durationMs: 0 } };
    });
    const attempt = runAgentAttempt({ providerOverride: 'fixture', originalProvider: 'fixture', modelOverride: 'fixture',
      cfg, sessionId: internalIdentity.sessionId, sessionKey: internalIdentity.agentSessionKey, sessionAgentId: 'main',
      sessionFile: join(root, 'internal.jsonl'), workspaceDir: identity().workspaceDir, body: 'Review memory',
      isFallbackRetry: false, resolvedThinkLevel: 'off', timeoutMs: 10_000, runId,
      opts: { modelRun: true, sessionEffects: 'internal', runId, workspaceId: identity().workspaceId,
        knowledgeReferences: [{ id: 'native', title: 'Native', lookup: 'native-memory:memory/source.md', corpus: 'memory' }] },
      runContext: {}, authProfileProvider: 'fixture', agentDir: join(root, 'agent'), onAgentEvent: () => undefined,
    } as never);
    if (outcome === 'error') await expect(attempt).rejects.toThrow('embedded attempt failed');
    else await attempt;
    expect(getAgentRunContext(runId)?.sessionId).toBe(internalIdentity.sessionId);
    if (outcome === 'rebind') expect(getAgentRunContext(runId)?.internalKnowledgeRead?.sessionId).toBe('new-generation');
    else expect(getAgentRunContext(runId)?.internalKnowledgeRead).toBeUndefined();
    expect(await read()).toMatchObject({ status: 'denied', reason: 'invalid_context' });
  });


  it.each([0x80, 0x81])('rejects invalid UTF8 byte %i before assigning an owner digest or pin', async byte => {
    const data = Buffer.concat([Buffer.from(raw('INVALID_UTF8_BODY')), Buffer.from([byte])]);
    await writeFile(join(root, 'workspace/memory/source.md'), data);
    await expect(readMemoryFile({ workspaceDir: identity().workspaceDir, relPath: 'memory/source.md', raw: true }))
      .rejects.toThrow();
    const read = await readNativeMemorySource({ cfg, identity: identity(), lookup: 'memory/source.md' });
    expect(read).toMatchObject({ status: 'denied', reason: 'denied' });
    expect(JSON.stringify(read)).not.toContain('INVALID_UTF8_BODY');
    expect((await readMemoryFile({ workspaceDir: identity().workspaceDir, relPath: 'memory/source.md' })).text)
      .toContain('\uFFFD');
  });

  it('rereads a non-default agent from that agent provider and rejects a conflicting session', async () => {
    const other = join(root, 'other-agent');
    await mkdir(join(other, 'memory'), { recursive: true });
    await writeFile(join(root, 'workspace/memory/shared.md'), raw('DEFAULT_AGENT_PRIVATE_BODY'));
    await writeFile(join(other, 'memory/shared.md'), raw('OTHER_AGENT_BODY'));
    cfg.agents!.list = [{ id: 'main', default: true, workspace: identity().workspaceDir }, { id: 'other', workspace: other }];
    registerMemoryRuntimeForPlugin('memory-core', {
      getMemorySearchManager: async ({ agentId }) => {
        const workspaceDir = agentId === 'other' ? other : identity().workspaceDir;
        return { manager: {
          search: async () => [],
          readFile: input => readMemoryFile({ workspaceDir, ...input }),
          status: () => ({ backend: 'builtin', provider: 'fixture', workspaceDir }),
          probeEmbeddingAvailability: async () => ({ ok: true }), probeVectorAvailability: async () => true,
        } };
      },
      resolveMemoryBackendConfig: () => ({ backend: 'builtin' }),
    });
    const read = await readNativeMemorySource({ cfg, agentId: 'other', lookup: 'memory/shared.md' });
    expect(read).toMatchObject({ status: 'admitted', snapshot: { context: { agentId: 'other' } } });
    expect(JSON.stringify(read)).toContain('OTHER_AGENT_BODY');
    expect(JSON.stringify(read)).not.toContain('DEFAULT_AGENT_PRIVATE_BODY');
    expect(await readNativeMemorySource({ cfg, agentId: 'other', identity: identity(), lookup: 'memory/shared.md' }))
      .toMatchObject({ status: 'denied', reason: 'scope_mismatch' });
  });

  it('binds internal memory to the registered run while ordinary missing sessions stay denied', async () => {
    await writeFile(join(root, 'workspace/memory/source.md'), raw('INTERNAL_RUN_BODY'));
    const internalIdentity = { ...identity(), agentSessionKey: 'agent:main:knowledge-rag13', sessionId: '33333333-3333-4333-8333-333333333333' };
    const runId = 'knowledge:rag13';
    const read = () => readNativeMemorySource({ cfg, identity: internalIdentity, internalRunId: runId, lookup: 'memory/source.md' });
    expect(await read()).toMatchObject({ status: 'denied', reason: 'invalid_context' });
    registerAgentRunContext(runId, { internalKnowledgeRead: { ...internalIdentity, sessionKey: internalIdentity.agentSessionKey } });
    const refs = (await resolveChatKnowledgeIntent({ scope: 'memory', mode: 'manual',
      references: [{ id: 'native', title: 'Native', lookup: 'native-memory:memory/source.md' }],
      adapters: createProductionChatKnowledgeSourceAdapters(cfg, { identity: internalIdentity, internalRunId: runId }) })).admitted;
    expect(refs).toHaveLength(1);
    expect(await revalidateChatKnowledgeRefs({ cfg, refs, identity: internalIdentity, internalRunId: runId })).toHaveLength(1);
    expect(await readNativeMemorySource({ cfg, identity: internalIdentity, lookup: 'memory/source.md' }))
      .toMatchObject({ status: 'denied', reason: 'invalid_context' });
    clearAgentRunContext(runId);
    expect(await read()).toMatchObject({ status: 'denied', reason: 'invalid_context' });
  });

  it.each(['end', 'rebind'] as const)('withholds internal memory when its run owner changes by %s during IO', async change => {
    await writeFile(join(root, 'workspace/memory/source.md'), raw('STALE_INTERNAL_RUN_BODY'));
    const runId = 'knowledge:rag13-late';
    const internalIdentity = { ...identity(), agentSessionKey: 'agent:main:knowledge-late', sessionId: '33333333-3333-4333-8333-333333333333' };
    const binding = { ...internalIdentity, sessionKey: internalIdentity.agentSessionKey };
    registerAgentRunContext(runId, { internalKnowledgeRead: binding });
    registerMemoryRuntimeForPlugin('memory-core', runtime(() => {
      if (change === 'end') clearAgentRunContext(runId);
      else registerAgentRunContext(runId, { internalKnowledgeRead: { ...binding, sessionId: 'another-generation' } });
    }));
    const read = await readNativeMemorySource({ cfg, identity: internalIdentity, internalRunId: runId, lookup: 'memory/source.md' });
    expect(read).toMatchObject({ status: 'denied', reason: 'invalid_context' });
    expect(JSON.stringify(read)).not.toContain('STALE_INTERNAL_RUN_BODY');
  });

  it('forwards validated backend egress providers and rejects malformed provider selectors', async () => {
    await writeFile(join(root, 'workspace/memory/source.md'), raw('EGRESS_MEMORY_BODY'));
    const read = await readNativeMemorySource({ cfg, identity: identity(), lookup: 'memory/source.md' });
    if (read.status !== 'admitted') throw Error('memory fixture failed');
    const { roleOrchestrationHandlers } = await import('../../openclaw_runtime/src/gateway/server-methods/role-orchestration-methods');
    const respond = vi.fn();
    const call = (egressProviderRefs: unknown) => roleOrchestrationHandlers['memory.readSource']({
      params: { sourceRef: read.snapshot.source, readIdentity: { ...identity(), egressProviderRefs } }, respond,
      context: { getRuntimeConfig: () => cfg }, client: { connect: { client: { mode: 'backend' }, scopes: ['operator.admin', 'operator.read'] } },
    } as never);
    await call(['embedding-provider']);
    expect(respond.mock.calls[0]).toMatchObject([true, { status: 'admitted', snapshot: { context: { egressProviderRefs: ['embedding-provider'] } } }]);
    respond.mockClear();
    await call('embedding-provider');
    expect(respond.mock.calls[0][0]).toBe(false);
    expect(JSON.stringify(respond.mock.calls)).not.toContain('EGRESS_MEMORY_BODY');
  });

  it('resolves native and role refs with the same ID to separate bodies and namespaces', async () => {
    await writeFile(join(root, 'workspace/memory/shared.md'), raw('NATIVE13_BODY'));
    storeMemoryCard(card());
    const native = await new NativeMemoryChatKnowledgeSourceAdapter({ cfg, identity: identity() }).resolve({
      id: 'n', title: 'Native', lookup: 'native-memory:memory/shared.md', corpus: 'memory' });
    const role = await new RoleMemoryChatKnowledgeSourceAdapter({ cfg, identity: identity() }).resolve({
      id: 'r', title: 'Role', lookup: 'memory-slot:shared.md', corpus: 'memory' });
    expect(native.status).toBe('resolved'); expect(role.status).toBe('resolved');
    if (native.status !== 'resolved' || role.status !== 'resolved') throw Error('owner read failed');
    expect(native.resolved.content).toContain('NATIVE13_BODY');
    expect(role.resolved.content).toBe('ROLE13_BODY');
    expect(native.resolved.ownerSnapshot!.source.domain).toBe('native-memory');
    expect(role.resolved.ownerSnapshot!.source.domain).toBe('role-memory');
    expect(native.resolved.ownerSnapshot!.source.namespaceId).not.toBe(role.resolved.ownerSnapshot!.source.namespaceId);
  });

  it('preserves raw UTF8/CRLF bytes and fences correction, deletion, scope and slot changes', async () => {
    const file = join(root, 'workspace/memory/source.md'), original = raw('NATIVE13 中文😀\r\nnext');
    await writeFile(file, original);
    const adapters = createProductionChatKnowledgeSourceAdapters(cfg, { identity: identity() });
    const refs = (await resolveChatKnowledgeIntent({ scope: 'memory', mode: 'manual', adapters,
      references: [{ id: 'native', title: 'Native', lookup: 'native-memory:memory/source.md', corpus: 'memory' }] })).admitted;
    expect(refs[0].content).toBe(original);
    expect((await readFile(file, 'utf8'))).toBe(original);
    expect(await revalidateChatKnowledgeRefs({ refs, cfg, identity: identity() })).toHaveLength(1);
    await writeFile(file, raw('CORRECTED'));
    expect(await revalidateChatKnowledgeRefs({ refs, cfg, identity: identity() })).toEqual([]);
    await writeFile(file, original);
    expect(await revalidateChatKnowledgeRefs({ refs, cfg, identity: { ...identity(), workspaceDir: join(root, 'other') } })).toEqual([]);
    cfg.plugins!.slots!.memory = 'runtime-memory';
    expect(await revalidateChatKnowledgeRefs({ refs, cfg, identity: identity() })).toEqual([]);
    cfg.plugins!.slots!.memory = 'memory-core';
    await unlink(file);
    expect(await revalidateChatKnowledgeRefs({ refs, cfg, identity: identity() })).toEqual([]);
  });

  it.each(['acl:\n  read: [someone-else]\n', 'sensitivity: secret\n', 'status: revoked\n', 'scope:\n  workspaceId: other-workspace\n',
    'retention:\n  policy: source-coupled\n  expiresAt: "2020-01-01T00:00:00Z"\n'])(
    'rejects owner policy %s before returning native content', async metadata => {
      await writeFile(join(root, 'workspace/memory/source.md'), raw('REJECTED13_BODY', metadata));
      const result = await new NativeMemoryChatKnowledgeSourceAdapter({ cfg, identity: identity() }).resolve({
        id: 'n', title: 'Native', lookup: 'native-memory:memory/source.md', corpus: 'memory' });
      expect(result.status).toBe('denied');
      expect(JSON.stringify(result)).not.toContain('REJECTED13_BODY');
    });

  it('does not read the previous role store under a foreign namespace pin', async () => {
    storeMemoryCard(card('same', 'FIRST_ROLE_BODY'));
    const adapter = new RoleMemoryChatKnowledgeSourceAdapter({ cfg, identity: identity() });
    const first = await adapter.resolve({ id: 'same', title: 'same', lookup: 'memory-slot:same', corpus: 'memory' });
    if (first.status !== 'resolved') throw Error('owner read failed');
    setMemoryStorePath(join(root, 'new-role-memory.sqlite'));
    storeMemoryCard(card('same', 'SECOND_ROLE_BODY'));
    const result = await adapter.resolve({ id: 'same', title: 'same', lookup: 'same', sourceRef: first.resolved.ownerSnapshot!.source });
    expect(result).toMatchObject({ status: 'denied', reason: 'namespace_mismatch' });
  });

  it('uses the explicit role lookup without falling back to a conflicting reference ID', async () => {
    storeMemoryCard(card('shadow', 'SHADOW_ROLE_BODY'));
    storeMemoryCard(card('selected', 'SELECTED_ROLE_BODY'));
    const adapter = new RoleMemoryChatKnowledgeSourceAdapter({ cfg, identity: identity() });
    const result = await adapter.resolve({ id: 'shadow', title: 'selected', lookup: 'memory-slot:selected', corpus: 'memory' });
    if (result.status !== 'resolved') throw Error('explicit role read failed');
    expect(result.resolved.subjectId).toBe('selected');
    expect(result.resolved.content).toBe('SELECTED_ROLE_BODY');
    const missing = await adapter.resolve({ id: 'shadow', title: 'missing', lookup: 'memory-slot:missing', corpus: 'memory' });
    expect(missing).toMatchObject({ status: 'denied', reason: 'not_found' });
    expect(JSON.stringify(missing)).not.toContain('SHADOW_ROLE_BODY');
  });

  it('rejects a disabled selected memory owner instead of reading the previous plugin', async () => {
    await writeFile(join(root, 'workspace/memory/source.md'), raw('PREVIOUS_PLUGIN_BODY'));
    const adapter = new NativeMemoryChatKnowledgeSourceAdapter({ cfg, identity: identity() });
    cfg.plugins!.slots!.memory = 'runtime-memory';
    expect((await adapter.resolve({ id: 'n', title: 'n', lookup: 'native-memory:memory/source.md' })).status).toBe('denied');
    cfg.plugins!.slots!.memory = 'memory-core';
    cfg.plugins!.entries!['memory-core'].enabled = false;
    expect((await adapter.resolve({ id: 'n', title: 'n', lookup: 'native-memory:memory/source.md' })).status).toBe('denied');
  });

  it('rereads the provider canonical path when the initial lookup contains an alias segment', async () => {
    await writeFile(join(root, 'workspace/memory/normalized.md'), raw('NORMALIZED13_BODY'));
    const adapter = new NativeMemoryChatKnowledgeSourceAdapter({ cfg, identity: identity() });
    const first = await adapter.resolve({ id: 'n', title: 'n', lookup: 'native-memory:memory/./normalized.md' });
    if (first.status !== 'resolved') throw Error('canonical path read failed');
    expect(first.resolved.subjectId).toBe('memory/normalized.md');
    expect((await adapter.resolve({ id: 'n', title: 'n', lookup: first.resolved.subjectId,
      sourceRef: first.resolved.ownerSnapshot!.source })).status).toBe('resolved');
  });

  it('binds a provider junction and the captured physical workspace to one namespace', async () => {
    await writeFile(join(root, 'workspace/memory/source.md'), raw('JUNCTION13_BODY'));
    const adapter = new NativeMemoryChatKnowledgeSourceAdapter({ cfg, identity: identity() });
    const initial = await adapter.resolve({ id: 'n', title: 'n', lookup: 'native-memory:memory/source.md' });
    if (initial.status !== 'resolved') throw Error('physical owner read failed');
    const alias = join(root, 'workspace-alias');
    await symlink(identity().workspaceDir, alias, 'junction');
    cfg.agents!.defaults!.workspace = alias;
    registerMemoryRuntimeForPlugin('memory-core', runtime(undefined, () => alias));
    const result = await adapter.resolve({ id: 'n', title: 'n', lookup: initial.resolved.subjectId,
      sourceRef: initial.resolved.ownerSnapshot!.source });
    if (result.status !== 'resolved') throw Error('junction owner read failed');
    expect(result.resolved.content).toContain('JUNCTION13_BODY');
    expect(result.resolved.ownerSnapshot!.source.namespaceId).toBe(initial.resolved.ownerSnapshot!.source.namespaceId);
  });

  it('withholds content when the provider workspace changes during file IO', async () => {
    await writeFile(join(root, 'workspace/memory/source.md'), raw('OLD_ROOT13_BODY'));
    const other = join(root, 'other-workspace');
    await mkdir(other);
    let reportedRoot = identity().workspaceDir;
    registerMemoryRuntimeForPlugin('memory-core', runtime(() => { reportedRoot = other; }, () => reportedRoot));
    const result = await readNativeMemorySource({ cfg, identity: identity(), lookup: 'memory/source.md' });
    expect(result).toMatchObject({ status: 'denied', reason: 'scope_mismatch' });
    expect(JSON.stringify(result)).not.toContain('OLD_ROOT13_BODY');
  });

  it.each(['metadata', 'provider-io'])('returns a source denial for invalid %s', async failure => {
    await writeFile(join(root, 'workspace/memory/source.md'), '---\ntrust: [broken\n---\nINVALID13_BODY');
    if (failure === 'provider-io') registerMemoryRuntimeForPlugin('memory-core', runtime(() => { throw Error('provider read failed'); }));
    const result = await readNativeMemorySource({ cfg, identity: identity(), lookup: 'memory/source.md' });
    expect(result).toMatchObject({ status: 'denied', reason: 'denied' });
    expect(JSON.stringify(result)).not.toContain('INVALID13_BODY');
  });

  it.each(['workspace-id', 'workspace-root'])('fences a session %s rebind during the read', async rebind => {
    await writeFile(join(root, 'workspace/memory/source.md'), raw('PREVIOUS_SESSION_SCOPE_BODY'));
    const other = join(root, 'session-other-workspace');
    await mkdir(other);
    registerMemoryRuntimeForPlugin('memory-core', runtime(async () => {
      await upsertSessionEntry({ agentId: 'main', storePath: cfg.session!.store, sessionKey,
        entry: { sessionId: identity().sessionId, updatedAt: Date.now(),
          workspaceDir: rebind === 'workspace-root' ? other : identity().workspaceDir,
          ...(rebind === 'workspace-id' ? { workspaceId: 'other-workspace' } : {}) } });
    }));
    const result = await readNativeMemorySource({ cfg, identity: identity(), lookup: 'memory/source.md' });
    expect(result.status).toBe('denied');
    expect(JSON.stringify(result)).not.toContain('PREVIOUS_SESSION_SCOPE_BODY');
  });

  it.each(['slot', 'disable', 'search-disable', 'runtime', 'session', 'cancel'])(
    'withholds content when %s changes during the owner read', async change => {
      await writeFile(join(root, 'workspace/memory/source.md'), raw('IN_FLIGHT13_BODY'));
      const controller = new AbortController();
      registerMemoryRuntimeForPlugin('memory-core', runtime(async () => {
        if (change === 'slot') cfg.plugins!.slots!.memory = 'runtime-memory';
        if (change === 'disable') cfg.plugins!.entries!['memory-core'].enabled = false;
        if (change === 'search-disable') cfg.agents!.defaults!.memorySearch!.enabled = false;
        if (change === 'runtime') registerMemoryRuntimeForPlugin('other-memory', runtime());
        if (change === 'cancel') controller.abort();
        if (change === 'session') await upsertSessionEntry({ agentId: 'main', storePath: cfg.session!.store,
          sessionKey, entry: { sessionId: '22222222-2222-4222-8222-222222222222', updatedAt: Date.now(),
            workspaceDir: identity().workspaceDir } });
      }));
      const result = await new NativeMemoryChatKnowledgeSourceAdapter({ cfg, identity: identity(), signal: controller.signal })
        .resolve({ id: 'n', title: 'n', lookup: 'native-memory:memory/source.md' });
      expect(result.status).toBe('denied');
      expect(JSON.stringify(result)).not.toContain('IN_FLIGHT13_BODY');
    });

  it('preserves the default tool page while raw owner reads retain the full file', async () => {
    const content = Array.from({ length: 250 }, (_, i) => `line ${i} 中文😀\r\n`).join('');
    await writeFile(join(root, 'workspace/memory/source.md'), content);
    const page = await readMemoryFile({ workspaceDir: identity().workspaceDir, relPath: 'memory/source.md', lines: 2 });
    const original = await readMemoryFile({ workspaceDir: identity().workspaceDir, relPath: 'memory/source.md', raw: true });
    expect(page.text).toContain('line 0'); expect(page.text).not.toContain('line 2 ');
    expect(original.text).toBe(content);
  });

  it('rereads a late native range with the whole-file version', async () => {
    const head = raw(Array.from({ length: 220 }, (_, i) => `noise ${i} ${'x'.repeat(30)}\r\n`).join(''));
    const hitText = 'RAG13_LATE_QUERY 中文😀\r\n', content = head + hitText + 'after\r\n';
    expect(head.length).toBeGreaterThan(4000);
    const hitLine = 1 + (head.match(/\n/g)?.length ?? 0);
    await writeFile(join(root, 'workspace/memory/long.md'), content);
    const adapter = new NativeMemoryChatKnowledgeSourceAdapter({ cfg, identity: identity() });
    const full = await adapter.resolve({ id: 'n', title: 'n', lookup: 'native-memory:memory/long.md' });
    if (full.status !== 'resolved') throw Error('owner read failed');
    const pin = { ...full.resolved.ownerSnapshot!.source, locator: { coordinateSpace: 'raw-source-utf8-v1' as const,
      startByte: Buffer.byteLength(head, 'utf8'), endByteExclusive: Buffer.byteLength(head + hitText, 'utf8'),
      startLine: hitLine, endLine: hitLine } };
    const reread = await adapter.resolve({ id: 'n', title: 'n', lookup: 'memory/long.md', sourceRef: pin });
    if (reread.status !== 'resolved') throw Error('search pin reread failed');
    expect(reread.resolved.content).toBe(hitText);
    expect(reread.resolved.ownerSnapshot!.source.sourceDigest).toBe(digestOwnerReadContent(content));
    await writeFile(join(root, 'workspace/memory/long.md'), `changed prefix\r\n${content}`);
    expect((await adapter.resolve({ id: 'n', title: 'n', lookup: 'memory/long.md', sourceRef: pin })).status).toBe('denied');
  });
});
