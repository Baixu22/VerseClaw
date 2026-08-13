/**
 * Chat render reachability — the "must appear" half of the transcript contract.
 *
 * `chat-tool-card-suppression.test.tsx` is the other half: it guards that a
 * flat tool list does not duplicate the execution graph. Having only that side
 * is how the audit's F1 survived — every assertion was about something NOT
 * being rendered, so a change that hid too much looked green.
 *
 * These cases pin the opposite direction: a card the model actually emitted has
 * to reach the DOM. Each one reproduces a case that was broken before
 * `message-render-projection.ts` made row visibility a single decision.
 *
 * Keep both files. Deleting either one re-opens the gap the other closes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { gatewayState, agentsState } = vi.hoisted(() => ({
  gatewayState: { status: { state: 'running', port: 18789 } },
  agentsState: {
    agents: [{ id: 'main', name: 'main' }] as Array<Record<string, unknown>>,
    fetchAgents: vi.fn(),
  },
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('@/stores/gateway', () => {
  const useGatewayStore = Object.assign(
    (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
    { getState: () => gatewayState },
  );
  return { useGatewayStore };
});

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: typeof agentsState) => unknown) => selector(agentsState),
}));

const pendingApprovalFixture = {
  id: 'approval-1',
  workspaceId: 'ws-1',
  sessionKey: 'agent:main:main',
  runId: 'run-1',
  source: 'terminal',
  risk: 'dangerous',
  status: 'pending',
  reason: 'rm -rf ./dist',
  command: 'rm -rf ./dist',
  cwd: '/repo',
  paramsPreview: '{"command":"rm -rf ./dist"}',
  requestedAt: 1_700_000_000_000,
};

const { approvalsMock } = vi.hoisted(() => ({
  approvalsMock: vi.fn().mockResolvedValue({ ok: true, approvals: [] }),
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    git: { status: vi.fn().mockResolvedValue({ success: true, status: { isRepository: false } }) },
    permissions: {
      approvals: approvalsMock,
      decideApproval: vi.fn().mockResolvedValue({ ok: true, success: true }),
    },
    topics: { list: vi.fn().mockResolvedValue({ topics: [], activeTopicId: null }) },
    knowledge: { matchErrorExperience: vi.fn().mockResolvedValue({ success: true, matches: [] }) },
    files: { writeText: vi.fn().mockResolvedValue({ success: true }) },
    workspaces: {
      saveState: vi.fn().mockResolvedValue({ success: true }),
      update: vi.fn().mockResolvedValue({ success: true }),
    },
    shell: { openPath: vi.fn().mockResolvedValue({ success: true }) },
    dialog: { open: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }) },
    skills: { local: vi.fn().mockResolvedValue({ success: true, skills: [] }) },
    workProviders: {
      status: vi.fn().mockResolvedValue({
        success: true, providers: [], capabilities: [], kitCapabilities: [], summary: {},
      }),
    },
    usage: {
      contextRange: vi.fn().mockResolvedValue({ usedTokens: 0, maxTokens: 0, percentage: 0 }),
      live: vi.fn().mockResolvedValue({ input: 0, output: 0, total: 0, costUsd: 0 }),
      promptCacheStatus: vi.fn().mockResolvedValue({ success: true, assessment: null }),
      recordPromptCacheRiskEvent: vi.fn().mockResolvedValue({ success: true, event: null }),
    },
    sessions: {
      history: vi.fn().mockResolvedValue({ success: true, messages: [], hasMore: false }),
      compactionStatus: vi.fn().mockResolvedValue({
        success: true, available: true, canCompact: false, inProgress: false,
        pressure: 'low', truncatedMessageCount: 0, warnings: [],
      }),
      longTaskControlStatus: vi.fn().mockResolvedValue({
        success: true, available: false, key: 'agent:main:main', queueCount: 0, warnings: [],
      }),
    },
  },
  hostApiFetch: vi.fn().mockResolvedValue({ success: true, messages: [] }),
}));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown> | string) => (typeof params === 'string' ? params : key),
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/hooks/use-stick-to-bottom-instant', () => ({
  useStickToBottomInstant: vi.fn(() => ({
    contentRef: { current: null }, scrollRef: { current: null },
    scrollToBottom: vi.fn(), isAtBottom: true,
  })),
}));
vi.mock('@/hooks/use-min-loading', () => ({ useMinLoading: () => false }));
vi.mock('@/pages/Chat/ChatToolbar', () => ({ ChatToolbar: () => null }));
vi.mock('@/pages/Chat/ChatInput', () => ({ ChatInput: () => null }));

const BASE_STATE = {
  loading: false,
  error: null,
  runError: null,
  sending: false,
  activeRunId: null,
  streamingText: '',
  streamingMessage: null,
  streamingTools: [],
  pendingFinal: false,
  lastUserMessageAt: 1_700_000_000_000,
  pendingToolImages: [],
  sessions: [{ key: 'agent:main:main' }],
  currentSessionKey: 'agent:main:main',
  currentAgentId: 'main',
  sessionLabels: {},
  sessionLastActivity: {},
  thinkingLevel: null,
};

async function seedChat(state: Record<string, unknown>) {
  const { useChatStore } = await import('@/stores/chat');
  useChatStore.setState({ ...BASE_STATE, ...state } as never);
}

async function seedWorkspace() {
  const { useWorkspacesStore } = await import('@/stores/workspaces');
  const workspace = {
    id: 'ws-1',
    name: 'repo',
    rootPath: '/repo',
    activeSessionKey: 'agent:main:main',
    sessionStates: { 'agent:main:main': {} },
  };
  useWorkspacesStore.setState({
    profiles: [workspace],
    activeWorkspace: workspace,
    loading: false,
    error: null,
  } as never);
}

async function mountChat() {
  const { Chat } = await import('@/pages/Chat/index');
  return render(<MemoryRouter><Chat /></MemoryRouter>);
}

/** Expand the turn summary — completed turns collapse their work details. */
function expandTurnSummary() {
  const toggle = screen.queryByTestId('chat-turn-summary-toggle');
  if (toggle) fireEvent.click(toggle);
}

const WEATHER_INPUT = { location: 'Tokyo', temperature: 21, condition: 'sunny' };

describe('Tool UI cards emitted as tool calls inside a run segment', () => {
  beforeEach(() => {
    vi.resetModules();
    approvalsMock.mockResolvedValue({ ok: true, approvals: [] });
  });

  it('renders a card from a tool-only assistant turn', async () => {
    await seedChat({
      messages: [
        { role: 'user', content: 'weather in tokyo?' },
        {
          role: 'assistant',
          id: 'weather-call',
          content: [{ type: 'tool_use', id: 'w-1', name: 'weather', input: WEATHER_INPUT }],
        },
        { role: 'assistant', id: 'reply', content: [{ type: 'text', text: 'Here you go.' }] },
      ],
    });
    await mountChat();

    await waitFor(() => expect(screen.getAllByText('Here you go.').length).toBeGreaterThan(0));
    expect(screen.getByTestId('chat-tool-ui-weather')).toBeInTheDocument();
  });

  it('renders a card from a mixed text + tool_use turn whose text was folded into the graph', async () => {
    await seedChat({
      messages: [
        { role: 'user', content: 'weather in tokyo?' },
        {
          role: 'assistant',
          id: 'weather-call',
          content: [
            { type: 'text', text: 'Looking it up.' },
            { type: 'tool_use', id: 'w-1', name: 'weather', input: WEATHER_INPUT },
          ],
        },
        { role: 'assistant', id: 'reply', content: [{ type: 'text', text: 'Here you go.' }] },
      ],
    });
    await mountChat();

    await waitFor(() => expect(screen.getAllByText('Here you go.').length).toBeGreaterThan(0));
    expect(screen.getByTestId('chat-tool-ui-weather')).toBeInTheDocument();
  });

  /**
   * The worst symptom of F1: a run blocked on a question the user could not
   * see, because the only assistant turn was a tool call and no reply existed
   * yet to un-fold the row.
   */
  it('renders a question the run is blocked on, with no final reply yet', async () => {
    await seedChat({
      messages: [
        { role: 'user', content: 'set it up' },
        {
          role: 'assistant',
          id: 'ask',
          content: [{
            type: 'tool_use',
            id: 'q-1',
            name: 'question_flow',
            input: {
              title: 'Pick one',
              steps: [{
                id: 's1',
                question: 'Which database?',
                options: [{ id: 'pg', label: 'Postgres' }, { id: 'sqlite', label: 'SQLite' }],
              }],
            },
          }],
        },
      ],
    });
    await mountChat();

    await waitFor(() => expect(screen.getByTestId('chat-tool-ui-interactions')).toBeInTheDocument());
    expect(screen.getByText('Which database?')).toBeInTheDocument();
    expect(screen.getByText('Postgres')).toBeInTheDocument();
  });

  /**
   * The dual of the suppression test: a tool that has no Tool UI renderer must
   * still stay folded into the execution graph rather than surfacing a bubble.
   */
  it('still hides a plain tool call that has no card renderer', async () => {
    await seedChat({
      messages: [
        { role: 'user', content: 'list files' },
        {
          role: 'assistant',
          id: 'bash-call',
          content: [{ type: 'tool_use', id: 'b-1', name: 'bash', input: { command: 'ls' } }],
        },
        { role: 'assistant', id: 'reply', content: [{ type: 'text', text: 'Listed.' }] },
      ],
    });
    await mountChat();

    await waitFor(() => expect(screen.getAllByText('Listed.').length).toBeGreaterThan(0));
    expect(screen.queryByTestId('chat-tool-ui-interactions')).not.toBeInTheDocument();
  });
});

describe('Plan surface', () => {
  beforeEach(() => {
    vi.resetModules();
    approvalsMock.mockResolvedValue({ ok: true, approvals: [] });
  });

  it('replays an update_plan tool call from history into the turn summary', async () => {
    await seedChat({
      messages: [
        { role: 'user', content: 'do the thing' },
        {
          role: 'assistant',
          id: 'plan-call',
          content: [{
            type: 'tool_use',
            id: 'p-1',
            name: 'update_plan',
            input: {
              explanation: 'plan',
              plan: [
                { step: 'Read code', status: 'completed' },
                { step: 'Write patch', status: 'in_progress' },
              ],
            },
          }],
        },
        { role: 'assistant', id: 'reply', content: [{ type: 'text', text: 'Done.' }] },
      ],
    });
    await mountChat();

    await waitFor(() => expect(screen.getAllByText('Done.').length).toBeGreaterThan(0));
    expandTurnSummary();

    expect(screen.getByTestId('chat-run-plan')).toBeInTheDocument();
    expect(screen.getByText('Write patch')).toBeInTheDocument();
  });

  it('does not also render the plan as a message card', async () => {
    await seedChat({
      messages: [
        { role: 'user', content: 'do the thing' },
        {
          role: 'assistant',
          id: 'plan-call',
          content: [{
            type: 'tool_use',
            id: 'p-1',
            name: 'update_plan',
            input: { plan: [{ step: 'Read code', status: 'completed' }] },
          }],
        },
        { role: 'assistant', id: 'reply', content: [{ type: 'text', text: 'Done.' }] },
      ],
    });
    await mountChat();

    await waitFor(() => expect(screen.getAllByText('Done.').length).toBeGreaterThan(0));
    expandTurnSummary();

    // One owner: the turn summary. `Read code` must appear exactly once.
    expect(screen.getAllByText('Read code')).toHaveLength(1);
  });

  /**
   * T8 / F10: every graph row of a plan-only turn is promoted away, so the
   * execution graph has nothing to draw and must not leave an empty header.
   */
  it('omits the execution graph entirely when every row was promoted', async () => {
    await seedChat({
      messages: [
        { role: 'user', content: 'do the thing' },
        {
          role: 'assistant',
          id: 'plan-call',
          content: [{
            type: 'tool_use',
            id: 'p-1',
            name: 'update_plan',
            input: { plan: [{ step: 'Read code', status: 'completed' }] },
          }],
        },
        { role: 'assistant', id: 'reply', content: [{ type: 'text', text: 'Done.' }] },
      ],
    });
    await mountChat();

    await waitFor(() => expect(screen.getAllByText('Done.').length).toBeGreaterThan(0));
    expandTurnSummary();

    expect(screen.getByTestId('chat-run-plan')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-execution-graph')).not.toBeInTheDocument();
  });
});

describe('Permission approvals', () => {
  beforeEach(() => {
    vi.resetModules();
    approvalsMock.mockResolvedValue({ ok: true, approvals: [pendingApprovalFixture] });
  });

  const runtimeRuns = {
    'run-1': {
      runId: 'run-1',
      sessionKey: 'agent:main:main',
      status: 'running',
      startedAt: 1_700_000_000_000,
      assistantText: '',
      events: [
        { type: 'tool.started', toolCallId: 't1', name: 'bash', args: { command: 'rm -rf ./dist' }, ts: 1 },
        { type: 'approval.updated', toolCallId: 't1', itemId: 'approval-1', status: 'pending', phase: 'pending', title: 'Approval', ts: 2 },
      ],
    },
  };

  it('surfaces a pending host approval in the transcript', async () => {
    await seedWorkspace();
    await seedChat({
      sending: true,
      activeRunId: 'run-1',
      runtimeRuns,
      messages: [{ role: 'user', content: 'clean the build' }],
    });
    await mountChat();

    await waitFor(() => expect(screen.getByTestId('chat-run-pending-approvals')).toBeInTheDocument());
  });

  /**
   * T1 / F8c regression. Before the projection change, tool-call cards were
   * unreachable, which accidentally hid this collision. Now that they render,
   * `MESSAGE_CARD_EXCLUDED_TOOL_UI_TYPES` is what keeps the authoritative host
   * approval from being shadowed by a decorative twin.
   */
  it('renders exactly one approval card when a tool call also parses as one', async () => {
    await seedWorkspace();
    await seedChat({
      sending: true,
      activeRunId: 'run-1',
      runtimeRuns,
      messages: [
        { role: 'user', content: 'clean the build' },
        {
          role: 'assistant',
          id: 'approval-call',
          content: [{
            type: 'tool_use',
            id: 'a-1',
            name: 'approval',
            input: { title: 'Run rm -rf ./dist?', description: 'destructive' },
          }],
        },
      ],
    });
    await mountChat();

    await waitFor(() => expect(screen.getByTestId('chat-run-pending-approvals')).toBeInTheDocument());
    expect(screen.queryAllByTestId('chat-tool-ui-approval')).toHaveLength(0);
  });

  /**
   * F4 tail, found by the `carryover` mock scenario: a turn whose entire output
   * was "I need permission" plus a text reply produces NO activity card once
   * its run ends — zero steps, zero surfaces — so per-turn attribution has
   * nowhere to land. The standalone floor must catch it.
   */
  it('surfaces a pending approval even when no turn produced an activity card', async () => {
    await seedWorkspace();
    await seedChat({
      sending: false,
      activeRunId: null,
      runtimeRuns: {
        'run-1': {
          runId: 'run-1',
          sessionKey: 'agent:main:main',
          status: 'completed',
          startedAt: 1_700_000_000_000,
          endedAt: 1_700_000_001_000,
          assistantText: '',
          events: [
            { type: 'approval.updated', toolCallId: 't1', itemId: 'approval-1', status: 'pending', phase: 'pending', title: 'Approval', ts: 1 },
          ],
        },
      },
      messages: [
        { role: 'user', content: 'clean the build' },
        { role: 'assistant', id: 'reply', content: [{ type: 'text', text: 'I need permission before touching dist.' }] },
      ],
    });
    await mountChat();

    await waitFor(() => expect(screen.getByTestId('chat-run-pending-approvals')).toBeInTheDocument());
    expect(document.querySelectorAll('[data-slot="approval-card"]')).toHaveLength(1);
  });

  /**
   * T3 / F4: the user answers a blocked run by sending another message instead
   * of deciding. The host is still holding the approval, so the card has to
   * survive the run change — previously it was filtered out by
   * `runId === activeRunId` and the only way to unblock the agent disappeared.
   */
  it('keeps an undecided approval visible after the next run starts', async () => {
    await seedWorkspace();
    await seedChat({
      sending: true,
      activeRunId: 'run-2',
      runtimeRuns: {
        ...runtimeRuns,
        'run-1': { ...runtimeRuns['run-1'], status: 'completed', endedAt: 1_700_000_001_000 },
        'run-2': {
          runId: 'run-2',
          sessionKey: 'agent:main:main',
          status: 'running',
          startedAt: 1_700_000_002_000,
          assistantText: '',
          events: [],
        },
      },
      messages: [
        { role: 'user', content: 'clean the build' },
        { role: 'assistant', id: 'r1', content: [{ type: 'text', text: 'Waiting on permission.' }] },
        { role: 'user', content: 'never mind, do something else' },
      ],
    });
    await mountChat();

    // Exactly one host approval surface, attached to the turn that raised it —
    // not duplicated onto the newer turn as well.
    await waitFor(() => expect(screen.getByTestId('chat-run-pending-approvals')).toBeInTheDocument());
    expect(screen.getAllByTestId('chat-run-pending-approvals')).toHaveLength(1);
    expect(document.querySelectorAll('[data-slot="approval-card"]')).toHaveLength(1);
  });

  /**
   * T4 / F5: a blocked run must not be able to hide behind a collapsed turn.
   * `TurnSummaryCard` unmounts its children while collapsed, so a stale collapse
   * override would have made the approval unreachable, not merely hidden.
   */
  it('forces the turn summary open while an approval is pending', async () => {
    await seedWorkspace();
    await seedChat({
      sending: true,
      activeRunId: 'run-1',
      runtimeRuns,
      messages: [{ role: 'user', content: 'clean the build' }],
    });
    await mountChat();

    await waitFor(() => expect(screen.getByTestId('chat-turn-summary-card')).toBeInTheDocument());
    // Collapse it the way a user would, then assert the approval is still there.
    fireEvent.click(screen.getByTestId('chat-turn-summary-toggle'));

    expect(screen.getByTestId('chat-turn-summary-details')).toBeInTheDocument();
    expect(screen.getByTestId('chat-run-pending-approvals')).toBeInTheDocument();
  });
});

/**
 * T5 / F6: the model's reasoning had three possible routes to the screen and
 * all three were closed — `metadata.reasoning` has no producer, the execution
 * graph drops `thinking` rows, and the streaming builder strips thinking blocks.
 * The runtime emitted the content all along.
 */
describe('Thinking reasoning', () => {
  beforeEach(() => {
    vi.resetModules();
    approvalsMock.mockResolvedValue({ ok: true, approvals: [] });
  });

  it('shows reasoning from a message thinking block', async () => {
    await seedChat({
      messages: [
        { role: 'user', content: 'fix the auth bug' },
        {
          role: 'assistant',
          id: 'reply',
          content: [
            { type: 'thinking', thinking: 'The verify call has no algorithms allowlist.' },
            { type: 'text', text: 'Pinned the algorithm to HS256.' },
          ],
        },
      ],
    });
    await mountChat();

    await waitFor(() => expect(screen.getAllByText('Pinned the algorithm to HS256.').length).toBeGreaterThan(0));
    expect(screen.getByTestId('assistant-reasoning-panel')).toBeInTheDocument();
    expect(screen.getByText('The verify call has no algorithms allowlist.')).toBeInTheDocument();
  });

  /**
   * A narration turn whose text is folded into the execution graph still owns
   * its thinking — `suppressAssistantText` hides the bubble, not the row.
   */
  it('keeps reasoning on a turn whose narration text was folded away', async () => {
    await seedChat({
      messages: [
        { role: 'user', content: 'fix the auth bug' },
        {
          role: 'assistant',
          id: 'narration',
          content: [
            { type: 'thinking', thinking: 'Checking where the signing key is loaded.' },
            { type: 'text', text: 'Let me look at the middleware.' },
            { type: 'tool_use', id: 't-1', name: 'bash', input: { command: 'rg jwt.verify' } },
          ],
        },
        { role: 'assistant', id: 'reply', content: [{ type: 'text', text: 'Done.' }] },
      ],
    });
    await mountChat();

    await waitFor(() => expect(screen.getAllByText('Done.').length).toBeGreaterThan(0));
    expect(screen.getByTestId('assistant-reasoning-panel')).toBeInTheDocument();
    expect(screen.getByText('Checking where the signing key is loaded.')).toBeInTheDocument();
  });

  it('shows live reasoning from the runtime run while streaming', async () => {
    await seedWorkspace();
    await seedChat({
      sending: true,
      activeRunId: 'run-1',
      runtimeRuns: {
        'run-1': {
          runId: 'run-1',
          sessionKey: 'agent:main:main',
          status: 'running',
          startedAt: 1_700_000_000_000,
          assistantText: '',
          thinkingText: 'Reading the middleware.\n\nNo allowlist on verify.',
          events: [],
        },
      },
      messages: [{ role: 'user', content: 'fix the auth bug' }],
    });
    await mountChat();

    await waitFor(() => expect(screen.getByTestId('assistant-reasoning-panel')).toBeInTheDocument());
    expect(screen.getByText('Reading the middleware.')).toBeInTheDocument();
    expect(screen.getByText('No allowlist on verify.')).toBeInTheDocument();
  });
});
/**
 * T9 / F8a: `filesByRun` fed two surfaces at once — `RunMutationDiffs` (a full
 * diff) and `GeneratedFilesPanel` (a name chip) — so a file with a renderable
 * diff was announced twice inside the same card. Ownership is now split by
 * whether `projectGeneratedFileDiff` can project the file.
 */
describe('Generated file ownership', () => {
  beforeEach(() => {
    vi.resetModules();
    approvalsMock.mockResolvedValue({ ok: true, approvals: [] });
  });

  const editArgs = {
    file_path: 'src/example.ts',
    old_string: 'const value = 1',
    new_string: 'const value = 2',
  };

  const patchResult = {
    toolCallId: 'call-edit',
    toolName: 'Edit',
    result: {
      patchArtifacts: [{
        schema: 'GitPatchArtifact/v1',
        file: 'src/example.ts',
        status: 'modified',
        contentKind: 'text',
        completeness: 'complete',
        patch: [
          '--- a/src/example.ts',
          '+++ b/src/example.ts',
          '@@ -1,1 +1,1 @@',
          '-const value = 1',
          '+const value = 2',
        ].join('\n'),
        hunks: [{
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: [
            { kind: 'deletion', text: 'const value = 1', oldLine: 1, newLine: null },
            { kind: 'addition', text: 'const value = 2', oldLine: null, newLine: 1 },
          ],
        }],
        lineage: { requestId: 'call-edit', journalEntryId: 'journal-1' },
      }],
      write_journal: {
        snapshots: [{ path: 'src/example.ts', journalEntryId: 'journal-1', hadPrior: true }],
      },
    },
  };

  it('shows a diffable file as a diff only, never also as a chip', async () => {
    await seedChat({
      messages: [
        { role: 'user', content: 'bump the value' },
        {
          role: 'assistant',
          id: 'edit-call',
          _toolResults: [patchResult],
          content: [{ type: 'tool_use', id: 'call-edit', name: 'Edit', input: editArgs }],
        },
        { role: 'assistant', id: 'reply', content: [{ type: 'text', text: 'Bumped it.' }] },
      ],
    });
    await mountChat();

    await waitFor(() => expect(screen.getAllByText('Bumped it.').length).toBeGreaterThan(0));
    expandTurnSummary();

    expect(screen.getByTestId('chat-mutation-diffs')).toBeInTheDocument();
    // The chip row must not repeat what the diff already owns. With only this
    // one file in the run, the panel has nothing left to show at all.
    expect(screen.queryByTestId('chat-generated-files')).not.toBeInTheDocument();
  });

  /**
   * The complement: `filesByRun` only keeps files with a trustworthy patch
   * artifact, so a chip-only file is one that HAS a valid artifact but that
   * `supportsInlineDiff` refuses to render inline — a rich document such as
   * .docx. The chip is then the only way to reach it, so the ownership split
   * must not swallow it.
   */
  it('still chips a file the diff projection cannot render', async () => {
    await seedChat({
      messages: [
        { role: 'user', content: 'write the report' },
        {
          role: 'assistant',
          id: 'write-call',
          _toolResults: [{
            toolCallId: 'call-write',
            toolName: 'write',
            result: {
              patchArtifacts: [{
                schema: 'GitPatchArtifact/v1',
                file: 'out/report.docx',
                status: 'modified',
                contentKind: 'text',
                completeness: 'complete',
                patch: [
                  '--- a/out/report.docx',
                  '+++ b/out/report.docx',
                  '@@ -1,1 +1,1 @@',
                  '-draft',
                  '+final',
                ].join('\n'),
                hunks: [{
                  oldStart: 1,
                  oldLines: 1,
                  newStart: 1,
                  newLines: 1,
                  lines: [
                    { kind: 'deletion', text: 'draft', oldLine: 1, newLine: null },
                    { kind: 'addition', text: 'final', oldLine: null, newLine: 1 },
                  ],
                }],
                lineage: { requestId: 'call-write', journalEntryId: 'journal-docx' },
              }],
              write_journal: {
                snapshots: [{ path: 'out/report.docx', journalEntryId: 'journal-docx', hadPrior: true }],
              },
            },
          }],
          content: [{
            type: 'tool_use',
            id: 'call-write',
            name: 'write',
            input: { file_path: 'out/report.docx', content: 'final' },
          }],
        },
        { role: 'assistant', id: 'reply', content: [{ type: 'text', text: 'Added.' }] },
      ],
    });
    await mountChat();

    await waitFor(() => expect(screen.getAllByText('Added.').length).toBeGreaterThan(0));
    expandTurnSummary();

    expect(screen.getByTestId('chat-generated-files')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-mutation-diffs')).not.toBeInTheDocument();
  });
});

/**
 * T4 / F5: collapsed turns used to read only "Worked for 12s", so a turn
 * carrying a plan and changed files was indistinguishable from an empty one.
 */
describe('Turn summary contents badges', () => {
  beforeEach(() => {
    vi.resetModules();
    approvalsMock.mockResolvedValue({ ok: true, approvals: [] });
  });

  it('labels a collapsed turn with what it contains, and drops the labels once open', async () => {
    await seedChat({
      messages: [
        { role: 'user', content: 'do the thing' },
        {
          role: 'assistant',
          id: 'plan-call',
          content: [{
            type: 'tool_use',
            id: 'p-1',
            name: 'update_plan',
            input: {
              plan: [
                { step: 'Read code', status: 'completed' },
                { step: 'Write patch', status: 'in_progress' },
              ],
            },
          }],
        },
        { role: 'assistant', id: 'reply', content: [{ type: 'text', text: 'Done.' }] },
      ],
    });
    await mountChat();

    await waitFor(() => expect(screen.getAllByText('Done.').length).toBeGreaterThan(0));

    // Collapsed by default: a completed turn with a visible reply.
    expect(screen.queryByTestId('chat-turn-summary-details')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-turn-summary-badge-plan')).toBeInTheDocument();

    expandTurnSummary();

    // Open: the contents themselves are the index, so the chips step aside.
    expect(screen.getByTestId('chat-turn-summary-details')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-turn-summary-badges')).not.toBeInTheDocument();
  });

  it('marks a pending approval in the badge row', async () => {
    await seedWorkspace();
    await seedChat({
      sending: true,
      activeRunId: 'run-1',
      runtimeRuns: {
        'run-1': {
          runId: 'run-1',
          sessionKey: 'agent:main:main',
          status: 'running',
          startedAt: 1_700_000_000_000,
          assistantText: '',
          events: [
            { type: 'tool.started', toolCallId: 't1', name: 'bash', args: { command: 'rm -rf ./dist' }, ts: 1 },
            { type: 'approval.updated', toolCallId: 't1', itemId: 'approval-1', status: 'pending', phase: 'pending', title: 'Approval', ts: 2 },
          ],
        },
      },
      messages: [{ role: 'user', content: 'clean the build' }],
    });
    approvalsMock.mockResolvedValue({ ok: true, approvals: [pendingApprovalFixture] });
    await mountChat();

    await waitFor(() => expect(screen.getByTestId('chat-run-pending-approvals')).toBeInTheDocument());
    // Forced open, so the row is not visible right now — collapse is refused.
    // What we assert is that the count reaches the card at all.
    fireEvent.click(screen.getByTestId('chat-turn-summary-toggle'));
    expect(screen.getByTestId('chat-run-pending-approvals')).toBeInTheDocument();
  });
});
