import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionActivityPanel } from '@/pages/Chat/SessionActivityPanel';
import { createEmptySessionActivitySnapshot } from '@shared/types/session-activity';
import type { SessionEffectivePolicy } from '@shared/types/session-effective-policy';

const translations: Record<string, string> = {
  'sessionActivity.title': 'Session activity',
  'sessionActivity.sections.goals': 'Goals & waits',
  'sessionActivity.sections.processes': 'Processes',
  'sessionActivity.sections.lineage': 'Lineage',
  'sessionActivity.goalStatus.running': 'Running',
  'sessionActivity.goalStatus.waiting': 'Waiting',
  'sessionActivity.processStatus.running': 'Running',
  'sessionActivity.processStatus.completed': 'Done',
  'sessionActivity.lineageStatus.started': 'Running',
  'sessionActivity.background.unknown': 'Background activity is unknown — the last status read failed.',
  'sessionActivity.background.stale': 'Showing the last successful read; these facts may be out of date.',
  'sessionPolicy.title': 'Session policy',
  'sessionPolicy.unavailable': 'Effective policy is unavailable — the last session status read failed.',
  'sessionPolicy.source': 'Source: {{source}}',
  'sessionPolicy.configured': 'Configured',
  'sessionPolicy.states.configured': 'Configured',
  'sessionPolicy.states.effective': 'Effective',
  'sessionPolicy.states.unverified': 'Unverified',
  'sessionPolicy.states.unsupported': 'Unsupported',
  'sessionPolicy.states.ignored': 'Ignored',
  'sessionPolicy.states.unknown': 'Unknown',
  'sessionPolicy.generation.current': 'Current',
  'sessionPolicy.generation.stale': 'Stale',
  'sessionPolicy.generation.missing': 'Not observed',
  'sessionPolicy.generation.mismatch': 'Generation mismatch',
  'sessionPolicy.generation.unverified': 'Unverified',
  'sessionPolicy.backend': 'Backend',
  'sessionPolicy.binding': 'Native binding',
  'sessionPolicy.model': 'Model & effort',
  'sessionPolicy.grant': 'Access',
  'sessionPolicy.limits': 'Limits',
  'sessionPolicy.queue': 'Queue',
  'sessionPolicy.resources': 'Resources',
  'sessionPolicy.schedule': 'Schedule',
  'sessionPolicy.compaction': 'Compaction',
  'sessionPolicy.compactionOwner.openclaw': 'OpenClaw owns compaction',
  'sessionPolicy.compactionOwner.backend': 'Native backend owns compaction',
  'sessionPolicy.compactionOwner.unknown': 'Compaction ownership unknown',
  'sessionPolicy.actionCount': '{{allowed}} allowed · {{approval}} approval · {{unknown}} unknown',
  'sessionPolicy.lifecycle.title': 'Action boundaries',
  'sessionPolicy.lifecycle.abort': 'Abort stops only the current run; session stop clears queued work and drains runtime resources.',
  'sessionPolicy.lifecycle.retention': 'Activity retention affects this UI view only; transcript and resource TTL stay owner-controlled.',
  'sessionPolicy.lifecycle.fork': 'Fork copies transcript context; worktree isolation remains a separate resource boundary.',
  'sessionRail.git.unavailable': 'Git status is temporarily unavailable.',
  'sessionRail.terminal.unavailable': 'Terminal status is temporarily unavailable.',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'sessionActivity.duration' && options?.count !== undefined) return String(options.count);
      let text = translations[key] ?? key;
      for (const [name, value] of Object.entries(options ?? {})) {
        if (name !== 'defaultValue') text = text.replaceAll(`{{${name}}}`, String(value));
      }
      return text;
    },
  }),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

function projectedSnapshot() {
  const snapshot = createEmptySessionActivitySnapshot('agent:main:main');
  snapshot.goals = [
    {
      id: 'mission-phase5-unit',
      kind: 'mission',
      label: 'Mission mission-phase5-unit',
      status: 'running',
      phase: 'execute',
      progress: 0.4,
      updatedAt: Date.now() - 1_000,
    },
    {
      id: 'flow-phase5-unit',
      kind: 'flow',
      label: 'Goal wait flow-phase5-unit',
      status: 'waiting',
      digest: 'sha256:unitdigest000000000000000000000000000000000',
      updatedAt: Date.now() - 2_000,
    },
  ];
  snapshot.processes = [
    {
      id: 'bash-phase5-unit',
      kind: 'bash',
      label: 'Process bash-phase5-unit',
      status: 'running',
      pid: 4242,
      updatedAt: Date.now() - 1_000,
    },
    {
      id: 'goal-owned-phase5-unit',
      kind: 'goalOwned',
      label: 'Goal process goal-owned-phase5-unit',
      status: 'completed',
      digest: 'unitdigest00000000',
      updatedAt: Date.now() - 4_000,
    },
  ];
  snapshot.lineage = [
    {
      id: 'child-phase5-unit',
      kind: 'child',
      sessionKey: 'agent:explorer:child-phase5-unit',
      role: 'explorer',
      status: 'started',
      updatedAt: Date.now() - 500,
    },
  ];
  return snapshot;
}


function policyFixture(): SessionEffectivePolicy {
  const fact = <T,>(state: 'configured' | 'effective' | 'unverified' | 'unsupported' | 'ignored' | 'unknown', value: T | null, source: string) => ({ state, value, source, reason: null, observedAt: null });
  return {
    schemaVersion: 'SessionEffectivePolicy/v1', generatedAt: '2026-10-23T02:00:00.000Z',
    scope: { workspaceId: 'workspace-a', sessionKey: 'agent:main:main', sessionId: 'session-a', agentId: 'main', permissionMode: 'acceptEdits' },
    generation: { state: 'current', runtimeGeneration: 'gateway-b1', runId: 'run-a', profileObservedAt: '2026-10-23T02:00:00.000Z' },
    backend: { configured: fact('configured', 'openclaw', 'session'), effective: fact('effective', { id: 'openclaw-embedded', kind: 'openclaw-embedded', modelProvider: 'openai', model: 'gpt-5.4', nativeThreadId: null, nativeSessionId: null }, 'runtime'), binding: fact('effective', { kind: 'session', id: 'session-a' }, 'runtime'), compatibility: { nativeCompactionOwner: 'openclaw', parameters: [{ path: 'agents.defaults.compaction', state: 'effective', reason: null }] } },
    model: { configured: fact('configured', { provider: 'openai', model: 'gpt-5.4' }, 'session'), effective: fact('effective', { provider: 'openai', model: 'gpt-5.4' }, 'runtime'), effort: fact('effective', 'high', 'session') },
    grant: { mode: fact('effective', 'acceptEdits', 'main'), effectiveActions: fact('effective', { allowed: ['exec'], requiresApproval: [], denied: [], unknown: [] }, 'runtime') },
    limits: { context: fact('effective', { usedTokens: 12, contextTokenBudget: 128, reserveTokens: 8, overflowTokens: 0 }, 'session'), queue: fact('configured', { mode: 'followup', cap: 12, debounceMs: 250, drop: 'summarize' }, 'session'), resources: fact('configured', { spawnDepth: 0, subagentControlScope: 'children', inheritedToolAllowCount: 1, inheritedToolDenyCount: 1 }, 'session'), schedule: fact('unsupported', null, 'cron-workboard') },
    diagnostics: [],
  };
}

describe('SessionActivityPanel', () => {

  it('renders effective policy provenance and lifecycle boundaries', () => {
    const snapshot = projectedSnapshot();
    snapshot.policy = policyFixture();
    snapshot.availability.policy = true;
    render(<SessionActivityPanel snapshot={snapshot} />);
    const policy = screen.getByTestId('session-policy-summary');
    expect(within(policy).getByTestId('session-policy-generation')).toHaveTextContent('Current');
    expect(within(policy).getByTestId('session-policy-backend')).toHaveTextContent('openclaw-embedded');
    expect(within(policy).getByTestId('session-policy-backend')).toHaveTextContent('Source: runtime');
    expect(within(policy).getByTestId('session-policy-grant')).toHaveTextContent('1 allowed');
    expect(within(policy).getByTestId('session-policy-lifecycle-help')).toHaveTextContent('Abort stops only the current run');
  });

  it('renders policy unknown when the policy read failed', () => {
    const snapshot = createEmptySessionActivitySnapshot('agent:main:policy-failed');
    snapshot.policy = null;
    snapshot.availability.policy = false;
    render(<SessionActivityPanel snapshot={snapshot} />);
    expect(screen.getByTestId('session-policy-unavailable')).toHaveTextContent('Effective policy is unavailable');
  });

  it('renders goal, process, and lineage states from the read-only snapshot', () => {
    render(<SessionActivityPanel snapshot={projectedSnapshot()} />);

    const goals = screen.getByTestId('session-activity-goals');
    const processes = screen.getByTestId('session-activity-processes');
    const lineage = screen.getByTestId('session-activity-lineage');

    expect(within(goals).getByText('Goals & waits')).toBeInTheDocument();
    expect(within(goals).getByText('sessionActivity.goalKinds.mission Mission mission-phase5-unit')).toBeInTheDocument();
    expect(within(goals).getAllByText('Running').length).toBeGreaterThan(0);
    expect(within(goals).getByText('sessionActivity.goalKinds.flow Goal wait flow-phase5-unit')).toBeInTheDocument();
    expect(within(goals).getByText('Waiting')).toBeInTheDocument();

    expect(within(processes).getByText('Processes')).toBeInTheDocument();
    expect(within(processes).getByText('sessionActivity.processKinds.bash Process bash-phase5-unit')).toBeInTheDocument();
    expect(within(processes).getByText('sessionActivity.processKinds.goalOwned Goal process goal-owned-phase5-unit')).toBeInTheDocument();
    expect(within(processes).getByText('Done')).toBeInTheDocument();

    expect(within(lineage).getByText('Lineage')).toBeInTheDocument();
    expect(within(lineage).getByText('explorer')).toBeInTheDocument();
    expect(within(lineage).getByText('Running')).toBeInTheDocument();
  });

  it('exposes no lifecycle buttons or actions in the projection sections', () => {
    render(<SessionActivityPanel snapshot={projectedSnapshot()} />);

    expect(within(screen.getByTestId('session-activity-goals')).queryByRole('button')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('session-activity-processes')).queryByRole('button')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('session-activity-lineage')).queryByRole('button')).not.toBeInTheDocument();
  });

  it('returns nothing for an empty snapshot', () => {
    const snapshot = createEmptySessionActivitySnapshot('agent:main:empty');
    snapshot.availability = { git: true, tasks: true, subagents: true, terminals: true, continuity: true };
    const { container } = render(
      <SessionActivityPanel snapshot={snapshot} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('surfaces an unavailable Git query instead of treating it as no repository', () => {
    const snapshot = createEmptySessionActivitySnapshot('agent:main:git-unavailable');
    snapshot.git = null;
    snapshot.availability.git = false;

    render(<SessionActivityPanel snapshot={snapshot} />);

    expect(screen.getByTestId('session-activity-alert')).toHaveTextContent(
      'Git status is temporarily unavailable.',
    );
  });

  it('surfaces an unavailable terminal query instead of treating it as no terminal', () => {
    const snapshot = createEmptySessionActivitySnapshot('agent:main:terminal-unavailable');
    snapshot.terminals = [];
    snapshot.availability.terminals = false;

    render(<SessionActivityPanel snapshot={snapshot} />);

    expect(screen.getByTestId('session-activity-alert')).toHaveTextContent(
      'Terminal status is temporarily unavailable.',
    );
  });

  it('keeps retry semantics for unavailable status queries', () => {
    const onRetryStatus = vi.fn();
    const snapshot = createEmptySessionActivitySnapshot('agent:main:retry');
    snapshot.availability.git = false;

    render(<SessionActivityPanel snapshot={snapshot} onRetryStatus={onRetryStatus} />);

    fireEvent.click(screen.getByTestId('session-activity-retry'));
    expect(onRetryStatus).toHaveBeenCalledTimes(1);
  });
});

/*
 * "The background read failed" and "there is genuinely no background activity"
 * are different states, and only the first one may warn (#121). The unknown
 * warning reuses the card's existing retry affordance; the stale line marks
 * rows that survived a failed re-read.
 */
describe('SessionActivityPanel background read state', () => {
  const BACKGROUND_CASES = [
    {
      name: 'shows a warning with the last-read data marked stale after a failed re-read',
      backgroundRead: { state: 'unknown' as const, readAt: 5_000, failedAt: 6_000 },
      unknown: true,
      stale: true,
    },
    {
      name: 'keeps a first read that never happened silent instead of alarming',
      backgroundRead: { state: 'unknown' as const, readAt: null, failedAt: null },
      unknown: false,
      stale: false,
    },
    {
      name: 'shows the normal empty state for a successful empty read',
      backgroundRead: { state: 'known' as const, readAt: 6_000, failedAt: null },
      unknown: false,
      stale: false,
    },
  ];

  it.each(BACKGROUND_CASES)('$name', ({ backgroundRead, unknown, stale }) => {
    const snapshot = createEmptySessionActivitySnapshot('agent:main:background');
    snapshot.availability = { git: true, tasks: true, subagents: true, terminals: true, continuity: true };
    snapshot.backgroundRead = backgroundRead;
    const onRetryStatus = vi.fn();

    const { container } = render(
      <SessionActivityPanel snapshot={snapshot} onRetryStatus={onRetryStatus} />,
    );

    if (!unknown) {
      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByTestId('session-activity-background-unknown')).toBeNull();
      expect(screen.queryByTestId('session-activity-alert')).toBeNull();
      return;
    }

    expect(screen.getByTestId('session-activity-background-unknown')).toHaveTextContent(
      'Background activity is unknown — the last status read failed.',
    );
    if (stale) {
      expect(screen.getByTestId('session-activity-background-stale')).toHaveTextContent(
        'Showing the last successful read; these facts may be out of date.',
      );
    } else {
      expect(screen.queryByTestId('session-activity-background-stale')).toBeNull();
    }
    fireEvent.click(screen.getByTestId('session-activity-retry'));
    expect(onRetryStatus).toHaveBeenCalledTimes(1);
  });
});
