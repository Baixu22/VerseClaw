import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc, thumbnails, originals } = vi.hoisted(() => ({ rpc: vi.fn(), thumbnails: vi.fn(), originals: new Map<string, unknown[]>() }));
vi.mock('@/stores/gateway', () => ({ useGatewayStore: { getState: () => ({ rpc, status: { state: 'running', gatewayReady: true } }) } }));
vi.mock('@/stores/agents', () => ({ useAgentsStore: { getState: () => ({ agents: [] }) } }));
vi.mock('@/stores/workspaces', () => ({ useWorkspacesStore: { getState: () => ({ activeWorkspaceId: null }) } }));
vi.mock('@/lib/host-api', () => ({ hostApi: { media: { thumbnails }, sessions: {
  history: vi.fn(async (input: { sessionKey: string }) => ({ success: true, messages: originals.get(input.sessionKey) ?? [] })),
  summaries: vi.fn(async () => ({ summaries: [] })),
} } }));
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); window.localStorage.clear(); originals.clear();
  rpc.mockReset().mockImplementation(async (method, input) => method === 'chat.history' ? { messages: originals.get(input.sessionKey) ?? [] } : {});
  thumbnails.mockReset().mockResolvedValue({ '/saved/image.png': { preview: 'data:image/png;base64,restored', fileSize: 123 } });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('chat history cold reads after shared budget eviction', () => {
  it('reloads an evicted session and image from their original owner references', async () => {
    const { useChatStore } = await import('@/stores/chat');
    const { chatCacheDiagnostics } = await import('@/stores/chat/content-cache');
    const loadHistory = useChatStore.getState().loadHistory;
    const first = 'agent:main:budget-0';
    const messages = [{ id: 'request', role: 'user', content: 'Read', timestamp: 1000 },
      { id: 'original', role: 'assistant', content: 'x'.repeat(2 * 1024 * 1024), timestamp: 1001,
        _attachedFiles: [{ filePath: '/saved/image.png', fileName: 'image.png', mimeType: 'image/png', fileSize: 0, preview: null }] }];
    originals.set(first, messages);
    useChatStore.setState({ currentSessionKey: first, messages, loadHistory: vi.fn().mockResolvedValue(undefined),
      refreshTaskLedger: vi.fn().mockResolvedValue(undefined), sessionLabels: {}, sessionLastActivity: {}, sending: false, loading: false });
    for (let index = 1; index <= 10; index++) {
      useChatStore.getState().switchSession('agent:main:budget-' + index);
      useChatStore.setState({ messages: [{ id: 'body-' + index, role: 'assistant', content: String(index) + 'x'.repeat(2 * 1024 * 1024) }], loading: false });
    }
    useChatStore.getState().switchSession(first);
    expect(useChatStore.getState().messages).toHaveLength(0);
    expect(chatCacheDiagnostics().bytes).toBeLessThanOrEqual(chatCacheDiagnostics().maxBytes);
    useChatStore.setState({ loadHistory });
    await loadHistory();
    expect(useChatStore.getState().messages.find(message => message.id === 'original')?.content).toBe(messages[1].content);
    expect(rpc).toHaveBeenCalledWith('chat.history', expect.objectContaining({ sessionKey: first }), expect.anything());
    await vi.advanceTimersByTimeAsync(1);
    expect(thumbnails).toHaveBeenCalled();
    expect(useChatStore.getState().messages.find(message => message.id === 'original')?._attachedFiles?.[0].preview).toContain('restored');
  });
  it('keeps active run identity after its large streaming snapshot is evicted', async () => {
    const { useChatStore } = await import('@/stores/chat');
    const { clearChatContentCache } = await import('@/stores/chat/content-cache');
    const first = 'agent:main:active-budget';
    useChatStore.setState({ currentSessionKey: first, messages: [], sending: true, activeRunId: 'live',
      streamingText: 'x'.repeat(20 * 1024 * 1024), loadHistory: vi.fn().mockResolvedValue(undefined),
      refreshTaskLedger: vi.fn().mockResolvedValue(undefined), sessionLabels: { [first]: 'Active' } });
    useChatStore.getState().switchSession('agent:main:other'); clearChatContentCache();
    useChatStore.getState().switchSession(first);
    expect(useChatStore.getState().sending).toBe(true); expect(useChatStore.getState().activeRunId).toBe('live');
    expect(useChatStore.getState().streamingText).toBe('');
  });
});
