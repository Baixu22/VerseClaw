import { describe, expect, it } from 'vitest';
import {
  cleanupContextArchiveArtifacts,
  ContextItemRegistry,
  createContextArchiveHandleForPayload,
  InMemoryContextItemStore,
  createContextItemId,
  createLifecycleEventId,
  createShadowContextItemRegistry,
  createShadowIngestion,
  createTransformationLifecycleEvents,
  getContextFamilyLifecycleAuditSnapshot,
  recordContextFamilyLifecycleEvents,
  resetContextFamilyLifecycleAudit,
  stableContentHash,
  verifyContextArchiveHandle,
} from '../../openclaw_runtime/src/context-engine/registry/context-item-registry';
import { truncateOversizedToolResultsInMessages } from '../../openclaw_runtime/src/agents/embedded-agent-runner/tool-result-truncation';
import {
  buildPreemptiveRouteLifecycleEvents,
  shouldPreemptivelyCompactBeforePrompt,
} from '../../openclaw_runtime/src/agents/embedded-agent-runner/run/preemptive-compaction';

const CHECKSUM = `sha256:${'c'.repeat(64)}`;

describe('ContextItemRegistry shadow mode', () => {
  it('registers metadata-only items, lifecycle events, queries, and status snapshots', async () => {
    const store = new InMemoryContextItemStore();
    const registry = new ContextItemRegistry({ store });

    const registered = await registry.register({
      id: 'ctx:session-1/observation/tool-call-1',
      schemaVersion: 1,
      kind: 'observation',
      lifecycleState: 'active',
      source: {
        type: 'tool_call',
        sessionId: 'session-1',
        toolCallId: 'tool-call-1',
      },
      projection: {
        mode: 'index_only',
        tokenEstimate: 12,
      },
      provenance: {
        producer: 'context-item-registry-test',
      },
      contentHash: CHECKSUM,
      metadata: {
        byteLength: 128,
      },
    });
    if (!registered.ok) {
      throw new Error(`registration failed: ${registered.diagnostics[0]?.message ?? 'unknown'}`);
    }

    const event = await registry.recordLifecycleEvent({
      id: 'evt:session-1/tool-call-1/evict',
      itemId: registered.item.id,
      from: 'active',
      to: 'evicted',
      reason: 'shadow registry eviction check',
      actor: 'context-item-registry-test',
    });
    const queried = await registry.query({
      sessionId: 'session-1',
      kind: 'observation',
      lifecycleState: 'evicted',
    });
    const snapshot = await registry.snapshot({ sessionId: 'session-1' });

    expect(event.ok).toBe(true);
    expect(queried.map((item) => item.id)).toEqual([registered.item.id]);
    expect(snapshot.totalItems).toBe(1);
    expect(snapshot.countsByKind.observation).toBe(1);
    expect(snapshot.countsByLifecycleState.evicted).toBe(1);
    expect(JSON.stringify(await store.dump())).not.toContain('rawPayload');
  });

  it('rejects large payload-shaped fields in registry records', async () => {
    const registry = new ContextItemRegistry();

    const result = await registry.register({
      id: 'ctx:session-1/observation/too-large',
      schemaVersion: 1,
      kind: 'observation',
      lifecycleState: 'active',
      source: {
        type: 'tool_call',
        sessionId: 'session-1',
      },
      projection: {
        mode: 'index_only',
      },
      provenance: {},
      metadata: {
        content: 'x'.repeat(4097),
      },
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('registry_large_payload');
    expect(await registry.query({ sessionId: 'session-1' })).toEqual([]);
  });

  it('bounds shadow-mode failures as diagnostics', async () => {
    const registry = createShadowContextItemRegistry({
      store: {
        async upsertItem() {
          throw new Error('store unavailable');
        },
        async appendLifecycleEvent() {
          throw new Error('store unavailable');
        },
        async queryItems() {
          throw new Error('store unavailable');
        },
        async getItem() {
          throw new Error('store unavailable');
        },
      },
    });

    const result = await registry.register({
      id: 'ctx:session-1/user/1',
      schemaVersion: 1,
      kind: 'user_intent',
      lifecycleState: 'active',
      source: {
        type: 'transcript',
        sessionId: 'session-1',
        entryId: 'entry-1',
      },
      projection: {
        mode: 'verbatim',
      },
      provenance: {},
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('registry_shadow_failure');
  });
});

describe('Context Family shadow ingestion helpers', () => {
  it('records representative runtime inputs as ContextItems without raw payload storage', async () => {
    const registry = createShadowContextItemRegistry();
    const ingestion = createShadowIngestion(registry);

    const results = await Promise.all([
      ingestion.registerToolResult({
        sessionId: 'session-1',
        toolCallId: 'tool-1',
        content: 'tool output',
        byteLength: 11,
      }),
      ingestion.registerInstructionFile({
        sessionId: 'session-1',
        path: 'AGENTS.md',
        content: 'instructions',
      }),
      ingestion.registerUserMessage({
        sessionId: 'session-1',
        entryId: 'entry-user',
        content: 'please continue',
      }),
      ingestion.registerAssistantMessage({
        sessionId: 'session-1',
        entryId: 'entry-assistant',
        content: 'I will continue.',
      }),
      ingestion.registerCompactionSummary({
        sessionId: 'session-1',
        checkpointId: 'checkpoint-1',
        content: 'summary',
      }),
      ingestion.registerCompressionArtifact({
        sessionId: 'session-1',
        artifactId: 'artifact-1',
        content: JSON.stringify({ schemaVersion: 1 }),
      }),
    ]);

    const snapshot = await registry.snapshot({ sessionId: 'session-1' });
    const stored = await registry.query({ sessionId: 'session-1' });

    expect(results.every((result) => result.ok)).toBe(true);
    expect(snapshot.countsByKind).toEqual({
      derived: 1,
      instruction: 1,
      ledger: 1,
      observation: 1,
      reasoning: 1,
      user_intent: 1,
    });
    expect(stored.every((item) => item.contentHash ?? item.metadata?.hashUnavailableReason)).toBe(true);
    expect(JSON.stringify(stored)).not.toContain('tool output');
  });

  it('creates stable item ids and content hashes for ingestion metadata', () => {
    expect(createContextItemId('session 1', 'tool/result')).toBe('ctx:session-1/tool-result');
    expect(stableContentHash('same')).toBe(stableContentHash('same'));
    expect(stableContentHash('same')).not.toBe(stableContentHash('different'));
  });
});

describe('Context Family lifecycle audit helpers', () => {
  it('records lifecycle events from runtime transformation paths into the shared audit snapshot', () => {
    resetContextFamilyLifecycleAudit();
    const messages = [
      { role: 'user', content: 'inspect the output' },
      {
        role: 'toolResult',
        id: 'tool-large',
        toolCallId: 'tool-large',
        content: [{ type: 'text', text: 'x'.repeat(12_000) }],
      },
    ] as never[];

    const truncation = truncateOversizedToolResultsInMessages(
      messages,
      2_000,
      1_000,
      1_000,
      { sessionId: 'session-audit' },
    );
    const route = shouldPreemptivelyCompactBeforePrompt({
      messages,
      prompt: 'continue',
      contextTokenBudget: 1_000,
      reserveTokens: 0,
      toolResultMaxChars: 1_000,
    });
    recordContextFamilyLifecycleEvents(buildPreemptiveRouteLifecycleEvents({
      result: route,
      sessionId: 'session-audit',
      provider: 'test-provider',
      modelId: 'test-model',
      messageCount: messages.length,
      contextTokenBudget: 1_000,
      reserveTokens: 0,
    }));
    recordContextFamilyLifecycleEvents(createTransformationLifecycleEvents({
      sessionId: 'session-audit',
      itemId: createContextItemId('session-audit', 'derived', 'checkpoint-1'),
      from: 'active',
      to: 'compacted',
      reason: 'runtime_compaction',
      actor: 'compact',
      source: {
        type: 'compaction',
        sessionId: 'session-audit',
        ownerId: 'checkpoint-1',
      },
      metadata: {
        sourceItemCount: messages.length,
        tokensBefore: 2_000,
        tokensAfter: 500,
        summaryChars: 64,
      },
    }));

    const snapshot = getContextFamilyLifecycleAuditSnapshot({ sessionId: 'session-audit' });

    expect(truncation.truncatedCount).toBe(1);
    expect(snapshot.events.map((event) => event.reason)).toEqual(expect.arrayContaining([
      'tool_result_truncation',
      'preemptive_route_decision',
      'runtime_compaction',
    ]));
    expect(snapshot.status.countsByLifecycleState.evicted).toBeGreaterThanOrEqual(1);
    expect(snapshot.status.countsByLifecycleState.compacted).toBeGreaterThanOrEqual(1);
    expect(snapshot.status.countsByKind.observation).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(snapshot.events)).not.toContain('x'.repeat(100));
  });

  it('records bounded truncation lifecycle metadata without raw payloads', async () => {
    const store = new InMemoryContextItemStore();
    const registry = createShadowContextItemRegistry({ store });
    const itemId = createContextItemId('session-1', 'observation', 'tool-call-1');
    await registry.register({
      id: itemId,
      schemaVersion: 1,
      kind: 'observation',
      lifecycleState: 'active',
      source: {
        type: 'tool_call',
        sessionId: 'session-1',
        toolCallId: 'tool-call-1',
      },
      projection: {
        mode: 'index_only',
      },
      provenance: {
        producer: 'context-item-registry-test',
      },
      contentHash: CHECKSUM,
    });

    const [event] = createTransformationLifecycleEvents({
      sessionId: 'session-1',
      itemId,
      from: 'active',
      to: 'evicted',
      reason: 'tool_result_truncation',
      actor: 'tool-result-truncation',
      source: {
        type: 'tool_call',
        sessionId: 'session-1',
        toolCallId: 'tool-call-1',
      },
      metadata: {
        originalChars: 12000,
        projectedChars: 4000,
        truncatedChars: 8000,
        maxChars: 4000,
        aggregateBudgetChars: 7000,
        replacementKind: 'oversized',
        rawPayload: 'x'.repeat(64),
      },
    });
    const result = await registry.recordLifecycleEvent(event);
    const dump = await store.dump();

    expect(result.ok).toBe(true);
    expect(dump.lifecycleEvents).toHaveLength(1);
    expect(dump.lifecycleEvents[0]).toMatchObject({
      itemId,
      from: 'active',
      to: 'evicted',
      reason: 'tool_result_truncation',
      actor: 'tool-result-truncation',
      metadata: {
        originalChars: 12000,
        projectedChars: 4000,
        truncatedChars: 8000,
        maxChars: 4000,
        aggregateBudgetChars: 7000,
        replacementKind: 'oversized',
      },
    });
    expect(JSON.stringify(dump.lifecycleEvents)).not.toContain('rawPayload');
  });

  it('records route, compaction, and checkpoint lifecycle events as audit metadata', async () => {
    const routeEvent = createTransformationLifecycleEvents({
      sessionId: 'session-1',
      itemId: createContextItemId('session-1', 'ledger', 'route-1'),
      to: 'active',
      reason: 'preemptive_route_decision',
      actor: 'preemptive-compaction',
      source: {
        type: 'other',
        sessionId: 'session-1',
        label: 'pre-prompt-estimate',
      },
      metadata: {
        route: 'compact_then_truncate',
        estimatedPromptTokens: 1900,
        promptBudgetBeforeReserve: 1200,
        overflowTokens: 700,
        toolResultReducibleChars: 2048,
        shouldCompact: true,
      },
    });
    const compactionEvents = createTransformationLifecycleEvents({
      sessionId: 'session-1',
      itemId: createContextItemId('session-1', 'derived', 'checkpoint-1'),
      from: 'active',
      to: 'compacted',
      reason: 'runtime_compaction',
      actor: 'compact',
      source: {
        type: 'compaction',
        sessionId: 'session-1',
        ownerId: 'checkpoint-1',
      },
      derivedItemIds: [
        createContextItemId('session-1', 'derived', 'summary-1'),
      ],
      metadata: {
        tokensBefore: 3000,
        tokensAfter: 900,
        sourceItemCount: 14,
        summaryChars: 512,
      },
    });
    const checkpointEvent = createTransformationLifecycleEvents({
      sessionId: 'session-1',
      itemId: createContextItemId('session-1', 'ledger', 'checkpoint-1'),
      to: 'active',
      reason: 'compaction_checkpoint_created',
      actor: 'session-compaction-checkpoints',
      source: {
        type: 'resume_checkpoint',
        sessionId: 'session-1',
        ownerId: 'checkpoint-1',
      },
      metadata: {
        checkpointId: 'checkpoint-1',
        checkpointRole: 'recovery_index',
        losslessArchive: false,
        preCompactionLeafId: 'leaf-before',
        postCompactionLeafId: 'leaf-after',
      },
    });

    expect(routeEvent).toHaveLength(1);
    expect(routeEvent[0]?.metadata).toMatchObject({
      route: 'compact_then_truncate',
      overflowTokens: 700,
    });
    expect(compactionEvents).toHaveLength(2);
    expect(compactionEvents.map((event) => event.itemId)).toEqual([
      'ctx:session-1/derived/checkpoint-1',
      'ctx:session-1/derived/summary-1',
    ]);
    expect(checkpointEvent[0]).toMatchObject({
      reason: 'compaction_checkpoint_created',
      metadata: {
        checkpointRole: 'recovery_index',
        losslessArchive: false,
      },
    });
  });

  it('creates deterministic lifecycle event ids', () => {
    expect(createLifecycleEventId('session 1', 'tool/result', 'truncate')).toBe(
      'evt:session-1/tool-result/truncate',
    );
  });
});

describe('Context Family archive handle MVP', () => {
  it('creates checksum-backed handles and verifies archived payloads', async () => {
    const archive = await createContextArchiveHandleForPayload({
      sessionId: 'session-1',
      itemId: createContextItemId('session-1', 'observation', 'tool-call-1'),
      payload: 'full tool result payload',
      source: {
        type: 'tool_call',
        sessionId: 'session-1',
        toolCallId: 'tool-call-1',
      },
    });

    await expect(verifyContextArchiveHandle(archive)).resolves.toMatchObject({
      ok: true,
      payload: 'full tool result payload',
    });
    expect(archive.uri).toMatch(/^context-archive:\/\/session-1\//);
    expect(archive.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(archive.byteLength).toBe(Buffer.byteLength('full tool result payload', 'utf8'));
    expect(archive.source).toMatchObject({
      type: 'tool_call',
      sessionId: 'session-1',
      toolCallId: 'tool-call-1',
    });
  });

  it('fails closed when an archived payload checksum no longer matches', async () => {
    const archive = await createContextArchiveHandleForPayload({
      sessionId: 'session-1',
      itemId: createContextItemId('session-1', 'derived', 'range-1'),
      payload: 'original message range',
      source: {
        type: 'transcript',
        sessionId: 'session-1',
        range: { start: 1, end: 3 },
      },
    });
    const corrupted = {
      ...archive,
      checksum: `sha256:${'0'.repeat(64)}`,
    };

    await expect(verifyContextArchiveHandle(corrupted)).resolves.toMatchObject({
      ok: false,
      reason: 'checksum_mismatch',
    });
  });

  it('removes session archive artifacts during hard-delete cleanup', async () => {
    const archive = await createContextArchiveHandleForPayload({
      sessionId: 'session-cleanup',
      itemId: createContextItemId('session-cleanup', 'observation', 'tool-call-1'),
      payload: 'payload to delete',
      source: {
        type: 'tool_call',
        sessionId: 'session-cleanup',
      },
    });

    const cleanup = await cleanupContextArchiveArtifacts({
      sessionIds: ['session-cleanup'],
    });
    const verify = await verifyContextArchiveHandle(archive);

    expect(cleanup.removed.length).toBeGreaterThanOrEqual(1);
    expect(cleanup.removed.some((file) => file.endsWith('.context-archive.json'))).toBe(true);
    expect(verify).toMatchObject({
      ok: false,
      reason: 'missing',
    });
  });
});
