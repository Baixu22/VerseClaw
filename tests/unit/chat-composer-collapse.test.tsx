import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { HashRouter } from 'react-router-dom';
import { ChatInput } from '@/pages/Chat/ChatInput';
import { TooltipProvider } from '@/components/ui/tooltip';

const hostApiFetchMock = vi.hoisted(() => vi.fn());
const { agentsState, chatState, gatewayState, providersState, mcpState, settingsState, artifactPanelMocks, permissionMocks, taskLedgerMocks } = vi.hoisted(() => ({
  agentsState: {
    agents: [] as Array<Record<string, unknown>>,
    defaultModelRef: null as string | null,
    updateAgentModel: vi.fn(),
  },
  chatState: {
    currentAgentId: 'main',
    currentSessionKey: 'agent:main:main',
    sessions: [] as Array<Record<string, unknown>>,
    sessionLabels: {} as Record<string, string>,
    messages: [] as Array<Record<string, unknown>>,
    streamingText: '',
    streamingMessage: null as unknown,
    streamingTools: [] as Array<Record<string, unknown>>,
    pendingFinal: false,
    pendingMessages: [] as Array<Record<string, unknown>>,
    activeTaskNodeId: null as string | null,
    queuePendingMessage: vi.fn(),
    switchSession: vi.fn(async () => undefined),
    renameSession: vi.fn(async () => undefined),
    archiveSession: vi.fn(async () => undefined),
    deleteSession: vi.fn(async () => undefined),
    newSession: vi.fn(),
    clearSessionView: vi.fn(),
  },
  gatewayState: {
    status: { state: 'running', port: 18789 },
  },
  providersState: {
    accounts: [] as Array<Record<string, unknown>>,
    statuses: [] as Array<Record<string, unknown>>,
    defaultAccountId: null as string | null,
    refreshProviderSnapshot: vi.fn(),
  },
  mcpState: {
    servers: [] as Array<Record<string, unknown>>,
    loading: false,
    error: null as string | null,
    fetchServers: vi.fn(),
  },
  settingsState: {
    uiDepthMode: 'basic' as 'basic' | 'advanced',
  },
  artifactPanelMocks: {
    openWorkspacePanel: vi.fn(),
    openPreview: vi.fn(),
  },
  permissionMocks: {
    approvals: vi.fn(),
    decideApproval: vi.fn(),
  },
  taskLedgerMocks: {
    createNode: vi.fn(),
    linkSession: vi.fn(),
  },
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: typeof agentsState) => unknown) => selector(agentsState),
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: Object.assign(
    (selector: (state: typeof chatState) => unknown) => selector(chatState),
    {
      getState: () => chatState,
      setState: (patch: Partial<typeof chatState>) => {
        Object.assign(chatState, patch);
      },
    },
  ),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/stores/providers', () => ({
  useProviderStore: (selector: (state: typeof providersState) => unknown) => selector(providersState),
}));

vi.mock('@/stores/mcp', () => ({
  useMcpStore: (selector: (state: typeof mcpState) => unknown) => selector(mcpState),
}));

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
}));

vi.mock('@/stores/artifact-panel', () => ({
  useArtifactPanel: (selector: (state: typeof artifactPanelMocks) => unknown) => selector(artifactPanelMocks),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: hostApiFetchMock,
  hostApi: {
    files: {
      stagePaths: (input: unknown) => hostApiFetchMock('/api/files/stage-paths', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
      stageBuffer: (input: unknown) => hostApiFetchMock('/api/files/stage-buffer', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    },
    skills: {
      quickAccess: (input: unknown) => hostApiFetchMock('/api/skills/quick-access', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
      local: () => hostApiFetchMock('/api/skills/local', { method: 'GET' }),
    },
    capabilities: {
      publications: (input: unknown) => hostApiFetchMock('/api/capabilities/publications', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    },
    mcp: {
      listServers: () => hostApiFetchMock('/api/mcp/list', { method: 'GET' }),
    },
    permissions: {
      approvals: permissionMocks.approvals,
      decideApproval: permissionMocks.decideApproval,
    },
    taskLedger: {
      createNode: taskLedgerMocks.createNode,
      linkSession: taskLedgerMocks.linkSession,
    },
    gateway: {
      status: () => Promise.resolve({ state: 'running', port: 18789 }),
    },
    knowledge: {
      search: (input: unknown) => hostApiFetchMock('/api/knowledge/search', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
      routeContext: (input: unknown) => hostApiFetchMock('/api/knowledge/route-context', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
      recordKnowledgeReference: (input: unknown) => hostApiFetchMock('/api/knowledge/reference', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    },
    usage: {
      promptCacheStatus: () => Promise.resolve({ success: true, assessment: null }),
      recordPromptCacheRiskEvent: () => Promise.resolve({ success: true, event: null }),
    },
    shell: {
      openExternal: vi.fn(),
      openPath: vi.fn(),
    },
  },
}));

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
    }),
  };
});

function setProviderReady() {
  const now = '2026-01-01T00:00:00.000Z';
  providersState.accounts = [{
    id: 'test-provider',
    vendorId: 'custom',
    label: 'Test Provider',
    authMode: 'api_key',
    baseUrl: 'http://127.0.0.1:1/v1',
    model: 'custom-test-provider/test-model',
    enabled: true,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  }];
  providersState.statuses = [{
    id: 'test-provider',
    name: 'Test Provider',
    type: 'custom',
    hasKey: true,
    keyMasked: 'sk-***',
    enabled: true,
    createdAt: now,
    updatedAt: now,
  }];
  providersState.defaultAccountId = 'test-provider';
}

const LONG_TEXT = Array.from({ length: 20 }, (_, index) => 'pasted line ' + (index + 1)).join('\n');

function pasteText(text: string) {
  fireEvent.paste(screen.getByTestId('chat-composer-input'), {
    clipboardData: {
      items: [],
      getData: (type: string) => (type === 'text' ? text : ''),
    },
  });
}

function renderHarness(onSend = vi.fn()) {
  function Harness() {
    const [collapsed, setCollapsed] = useState<string | null>(null);
    return (
      <ChatInput
        onSend={onSend}
        collapsedDraftValue={collapsed}
        onCollapsedDraftChange={setCollapsed}
      />
    );
  }
  render(
    <HashRouter>
      <TooltipProvider>
        <Harness />
      </TooltipProvider>
    </HashRouter>,
  );
  return onSend;
}

beforeEach(() => {
  setProviderReady();
  hostApiFetchMock.mockReset();
  hostApiFetchMock.mockResolvedValue({ success: true, skills: [] });
});

describe('composer long-text paste collapse', () => {
  it('collapses a long paste into the chip and keeps the textarea empty', () => {
    renderHarness();
    pasteText(LONG_TEXT);
    expect(screen.getByTestId('chat-composer-collapse-chip')).toBeTruthy();
    expect(screen.getByTestId('chat-composer-collapse-expand')).toBeTruthy();
    expect(screen.getByTestId('chat-composer-collapse-dismiss')).toBeTruthy();
    const textarea = screen.getByTestId('chat-composer-input') as HTMLTextAreaElement;
    expect(textarea.value).toBe('');
  });

  it('does not collapse short pastes', () => {
    renderHarness();
    pasteText('short paste');
    // jsdom does not perform the default clipboard insertion; the assertion
    // that matters is that the handler did NOT intercept with the chip.
    expect(screen.queryByTestId('chat-composer-collapse-chip')).toBeNull();
    const textarea = screen.getByTestId('chat-composer-input') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'short paste' } });
    expect(screen.queryByTestId('chat-composer-collapse-chip')).toBeNull();
    expect(textarea.value).toBe('short paste');
  });

  it('expands the chip back into the textarea', () => {
    renderHarness();
    pasteText(LONG_TEXT);
    fireEvent.click(screen.getByTestId('chat-composer-collapse-expand'));
    expect(screen.queryByTestId('chat-composer-collapse-chip')).toBeNull();
    const textarea = screen.getByTestId('chat-composer-input') as HTMLTextAreaElement;
    expect(textarea.value).toBe(LONG_TEXT);
  });

  it('dismiss discards the collapsed buffer', () => {
    renderHarness();
    pasteText(LONG_TEXT);
    fireEvent.click(screen.getByTestId('chat-composer-collapse-dismiss'));
    expect(screen.queryByTestId('chat-composer-collapse-chip')).toBeNull();
    const textarea = screen.getByTestId('chat-composer-input') as HTMLTextAreaElement;
    expect(textarea.value).toBe('');
  });

  it('sends collapsed buffer before typed text', async () => {
    const onSend = renderHarness();
    pasteText(LONG_TEXT);
    const textarea = screen.getByTestId('chat-composer-input') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'question' } });
    fireEvent.click(screen.getByTestId('chat-composer-send'));
    await vi.waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    const sentText = vi.mocked(onSend).mock.calls[0][0] as string;
    expect(sentText).toBe(LONG_TEXT + '\n\nquestion');
  });
});
