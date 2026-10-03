import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadTaskLedgerSnapshotMock = vi.fn();

vi.mock('@electron/services/task-ledger-service', () => ({
  loadTaskLedgerSnapshot: (...args: unknown[]) => loadTaskLedgerSnapshotMock(...args),
}));

/**
 * `sendWithMedia` gates on the session's persisted token usage before it reaches
 * the Gateway, and the real reader walks `~/.openclaw` transcripts. Left
 * unmocked, this file passes on a fresh machine and fails on any machine whose
 * cumulative usage has crossed the 1,000,000-token default budget — the send is
 * rejected as `TOKEN_BUDGET_EXCEEDED` before any metadata is built. Budget
 * behaviour has its own coverage in `chat-resource-limits-p5-004.test.ts`; here
 * it is a dependency to hold still.
 */
vi.mock('@electron/utils/token-usage', () => ({
  getSessionTokenUsageSummary: vi.fn(async () => ({ totalTokens: 0, estimatedCostUsd: 0 })),
}));

describe('chat knowledge retrieval intent (KS-04)', () => {
  beforeEach(() => {
    loadTaskLedgerSnapshotMock.mockReset();
  });

  it('forwards wiki scope as typed retrieval intent without prompt metadata', async () => {
    const gatewayManager = {
      rpc: vi.fn(async (_method: string, _payload?: { message?: string; promptMode?: string }) => ({ runId: 'run-wiki' })),
      getStatus: vi.fn(() => ({ state: 'running', gatewayReady: true })),
    };
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({ gatewayManager: gatewayManager as never });

    await expect(api.sendWithMedia({
      sessionKey: 'agent:main:main',
      message: 'Use the project notes',
      idempotencyKey: 'idem-wiki',
      knowledgeScope: 'wiki',
      knowledgeMode: 'auto-read',
    })).resolves.toEqual({ success: true, result: { runId: 'run-wiki' } });

    const payload = gatewayManager.rpc.mock.calls[0]?.[1] as {
      message: string;
      knowledgeScope?: string;
      knowledgeMode?: string;
    };
    expect(payload.message).toBe('Use the project notes');
    expect(payload.message).not.toContain('Conversation info (untrusted metadata)');
    expect(payload.message).not.toContain('clawxKnowledgeScope');
    expect(payload.knowledgeScope).toBe('wiki');
    expect(payload.knowledgeMode).toBe('auto-read');
    expect(gatewayManager.rpc.mock.calls.every((call) => call[0] !== 'wiki.get')).toBe(true);
  });

  it('forwards selected references as typed refs and drops renderer snippets', async () => {
    const gatewayManager = {
      rpc: vi.fn(async (_method: string, _payload?: { message?: string; promptMode?: string }) => ({ runId: 'run-selected-knowledge' })),
      getStatus: vi.fn(() => ({ state: 'running', gatewayReady: true })),
    };
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({ gatewayManager: gatewayManager as never });

    await api.sendWithMedia({
      sessionKey: 'agent:main:main',
      message: 'Use the attached page',
      idempotencyKey: 'idem-selected-knowledge',
      knowledgeScope: 'wiki',
      knowledgeReferences: [{
        id: 'decision-page',
        title: 'Knowledge Hub decision',
        lookup: 'notes/decision.md',
        corpus: 'wiki',
        attachKind: 'auto',
        routingReason: 'project knowledge intent detected',
        confidence: 0.91,
        freshnessLevel: 'fresh',
        matchedClaimStatus: 'supported',
        pagePath: 'notes/decision.md',
        snippet: 'Keep Obsidian optional.',
      }],
    });

    const payload = gatewayManager.rpc.mock.calls[0]?.[1] as {
      message: string;
      knowledgeReferences?: Array<Record<string, unknown>>;
    };
    expect(payload.message).toBe('Use the attached page');
    expect(payload.message).not.toContain('selectedKnowledgeReferences');
    expect(payload.knowledgeReferences).toHaveLength(1);
    expect(payload.knowledgeReferences?.[0]).toEqual({
      id: 'decision-page',
      title: 'Knowledge Hub decision',
      lookup: 'notes/decision.md',
      corpus: 'wiki',
      attachKind: 'auto',
      routingReason: 'project knowledge intent detected',
      confidence: 0.91,
      freshnessLevel: 'fresh',
      matchedClaimStatus: 'supported',
      pagePath: 'notes/decision.md',
    });
    expect(JSON.stringify(payload.knowledgeReferences?.[0])).not.toContain('snippet');
    expect(JSON.stringify(payload.knowledgeReferences?.[0])).not.toContain('Keep Obsidian optional.');
    expect(gatewayManager.rpc.mock.calls.every((call) => call[0] !== 'wiki.get')).toBe(true);
  });

  it('does not pre-read selected references in Main for auto-read mode', async () => {
    const gatewayManager = {
      rpc: vi.fn(async (method: string, _payload?: { message?: string; promptMode?: string }) => {
        if (method === 'wiki.get') {
          return {
            found: true,
            pageId: 'page-1',
            pagePath: 'notes/decision.md',
            sourcePath: 'C:/project/notes/decision.md',
            content: 'Keep the Task Ledger projection durable and cite this page.',
          };
        }
        return { runId: 'run-auto-read' };
      }),
      getStatus: vi.fn(() => ({ state: 'running', gatewayReady: true })),
    };
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({ gatewayManager: gatewayManager as never });

    await api.sendWithMedia({
      sessionKey: 'agent:main:main',
      message: 'Use the decision page',
      idempotencyKey: 'idem-auto-read',
      knowledgeScope: 'wiki',
      knowledgeMode: 'auto-read',
      knowledgeReferences: [{
        id: 'decision-page',
        title: 'Knowledge Hub decision',
        lookup: 'notes/decision.md',
        corpus: 'wiki',
      }],
    });

    expect(gatewayManager.rpc.mock.calls[0]?.[0]).toBe('chat.send');
    expect(gatewayManager.rpc.mock.calls.every((call) => call[0] !== 'wiki.get')).toBe(true);
    const payload = gatewayManager.rpc.mock.calls[0]?.[1] as {
      message: string;
      knowledgeReferences?: Array<Record<string, unknown>>;
    };
    expect(payload.message).toBe('Use the decision page');
    expect(payload.message).not.toContain('Knowledge read citations');
    expect(payload.knowledgeReferences).toHaveLength(1);
    expect(payload.knowledgeReferences?.[0]?.lookup).toBe('notes/decision.md');
  });

  it('drops huge renderer snippets instead of injecting them', async () => {
    const hugeText = 'x'.repeat(50_000);
    const gatewayManager = {
      rpc: vi.fn(async (_method: string, _payload?: unknown) => ({ runId: 'run-bounded-context' })),
      getStatus: vi.fn(() => ({ state: 'running', gatewayReady: true })),
    };
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({ gatewayManager: gatewayManager as never });

    await api.sendWithMedia({
      sessionKey: 'agent:main:main',
      message: 'Use huge context',
      idempotencyKey: 'idem-bounded-context',
      knowledgeScope: 'wiki',
      knowledgeMode: 'auto-read',
      knowledgeReferences: Array.from({ length: 8 }, (_, index) => ({
        id: `huge-${index}`,
        title: `Huge ${index}`,
        lookup: `notes/huge-${index}.md`,
        corpus: 'wiki',
        snippet: hugeText,
      })),
    });

    const payload = gatewayManager.rpc.mock.calls[0]?.[1] as {
      message: string;
      knowledgeReferences?: Array<Record<string, unknown>>;
    };
    expect(payload.message).toBe('Use huge context');
    expect(payload.message).not.toContain(hugeText);
    expect(payload.knowledgeReferences).toHaveLength(8);
    expect(JSON.stringify(payload.knowledgeReferences)).not.toContain(hugeText);
  });

  it('ignores legacy workMode fields for ordinary chat sends', async () => {
    const gatewayManager = {
      rpc: vi.fn(async (_method: string, _payload?: { message?: string; promptMode?: string }) => ({ runId: 'run-plan' })),
      getStatus: vi.fn(() => ({ state: 'running', gatewayReady: true })),
    };
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({ gatewayManager: gatewayManager as never });

    const legacyPayload = {
      sessionKey: 'agent:main:main',
      message: 'Sketch the rollout',
      idempotencyKey: 'idem-plan',
      workMode: 'plan',
    } as unknown as Parameters<typeof api.sendWithMedia>[0];
    await api.sendWithMedia(legacyPayload);

    const payload = gatewayManager.rpc.mock.calls[0]?.[1] as unknown as { message: string; promptMode?: string };
    expect(payload.message).toBe('Sketch the rollout');
    expect(payload.message).not.toContain('Work mode info (untrusted metadata)');
    expect(payload.message).not.toContain('clawxWorkMode');
    expect(payload).not.toHaveProperty('promptMode');
  });

  it('injects selected Task Ledger context when an active node is provided', async () => {
    loadTaskLedgerSnapshotMock.mockResolvedValue({
      schemaVersion: 1,
      workspaceId: 'workspace-a',
      generatedAt: '2026-06-23T00:00:00.000Z',
      nodes: [
        {
          id: 'goal-1',
          title: 'Unify work tracking',
          kind: 'goal',
          status: 'doing',
          parentId: null,
          createdAt: '2026-06-23T00:00:00.000Z',
          updatedAt: '2026-06-23T00:00:00.000Z',
        },
        {
          id: 'task-1',
          title: 'Record every chat turn',
          kind: 'task',
          status: 'doing',
          parentId: 'goal-1',
          createdAt: '2026-06-23T00:00:00.000Z',
          updatedAt: '2026-06-23T00:00:00.000Z',
        },
      ],
      edges: [],
      sessionLinks: [],
      rootNodeIds: ['goal-1'],
      reviewNodeIds: [],
      activeNodeIds: ['goal-1', 'task-1'],
      blockedNodeIds: [],
      currentGoalId: 'goal-1',
      recentDecisions: [],
      eventsCount: 2,
      warnings: [],
    });
    const gatewayManager = {
      rpc: vi.fn(async (_method: string, _payload?: { message?: string; promptMode?: string }) => ({ runId: 'run-task-context' })),
      getStatus: vi.fn(() => ({ state: 'running', gatewayReady: true })),
    };
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({ gatewayManager: gatewayManager as never });

    await api.sendWithMedia({
      sessionKey: 'agent:main:main',
      workspaceId: 'workspace-a',
      message: 'Continue implementation',
      idempotencyKey: 'idem-task-context',
      activeTaskNodeId: 'task-1',
    });

    const payload = gatewayManager.rpc.mock.calls[0]?.[1] as unknown as { message: string };
    expect(loadTaskLedgerSnapshotMock).toHaveBeenCalledWith('workspace-a');
    expect(payload.message).toContain('Task Ledger context (untrusted metadata)');
    expect(payload.message).toContain('"activeTaskNodeId":"task-1"');
    expect(payload.message).toContain('"title":"Record every chat turn"');
    expect(payload.message).toContain('"parent":{"id":"goal-1"');
    expect(payload.message).toContain('Continue implementation');
  });

  it('does not inject metadata for none or unknown scope', async () => {
    const gatewayManager = {
      rpc: vi.fn(async (_method: string, _payload?: { message?: string; promptMode?: string }) => ({ runId: 'run-none' })),
      getStatus: vi.fn(() => ({ state: 'running', gatewayReady: true })),
    };
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({ gatewayManager: gatewayManager as never });

    await api.sendWithMedia({
      sessionKey: 'agent:main:main',
      message: 'Plain message',
      idempotencyKey: 'idem-none',
      knowledgeScope: 'none',
    });
    await api.sendWithMedia({
      sessionKey: 'agent:main:main',
      message: 'Unknown scope message',
      idempotencyKey: 'idem-unknown',
      knowledgeScope: 'obsidian' as never,
    });

    expect((gatewayManager.rpc.mock.calls[0]?.[1] as unknown as { message: string }).message).toBe('Plain message');
    expect((gatewayManager.rpc.mock.calls[1]?.[1] as unknown as { message: string }).message).toBe('Unknown scope message');
  });

  it('returns knowledgeDenials from the gateway ack when present', async () => {
    const gatewayManager = {
      rpc: vi.fn(async () => ({
        runId: 'run-denials',
        knowledgeDenials: [
          {
            id: 'denied-page',
            title: 'Denied page',
            lookup: 'notes/denied.md',
            reason: 'acl_denied',
            visibleReason: 'ACL denied for "Denied page".',
          },
        ],
      })),
      getStatus: vi.fn(() => ({ state: 'running', gatewayReady: true })),
    };
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({ gatewayManager: gatewayManager as never });

    await expect(api.sendWithMedia({
      sessionKey: 'agent:main:main',
      message: 'Use the denied page',
      idempotencyKey: 'idem-denials',
      knowledgeScope: 'wiki',
      knowledgeReferences: [{
        id: 'denied-page',
        title: 'Denied page',
        lookup: 'notes/denied.md',
        corpus: 'wiki',
      }],
    })).resolves.toEqual({
      success: true,
      result: { runId: 'run-denials' },
      knowledgeDenials: [
        {
          id: 'denied-page',
          title: 'Denied page',
          lookup: 'notes/denied.md',
          reason: 'acl_denied',
          visibleReason: 'ACL denied for "Denied page".',
        },
      ],
    });
  });
});
