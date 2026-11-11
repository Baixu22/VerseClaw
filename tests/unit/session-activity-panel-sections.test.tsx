// The status card's contract: the four requested sections in a fixed order,
// sub-agent and runtime-process rows openable, host-projected rows inert.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SessionActivityPanel } from '@/pages/Chat/SessionActivityPanel';
import { createEmptySessionActivitySnapshot } from '@shared/types/session-activity';
import type { SessionActivitySnapshot } from '@shared/types/session-activity';
import type { RunProcessSurface } from '@/components/tool-ui/run-surfaces';
import type { RunPlanSurface } from '@/pages/Chat/run-surface-promotion';

const worktreesMock = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true, worktrees: [] }));
vi.mock('@/lib/host-api', () => ({ hostApi: { git: { worktrees: worktreesMock } } }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: Record<string, unknown>) => {
    if (opts && typeof opts.count === 'number') return `${key}:${opts.count}`;
    if (opts && typeof opts.code === 'number') return `${key}:${opts.code}`;
    return key;
  } }),
}));

// The avatar pipeline renders dicebear SVGs; identity is covered by its own test.
vi.mock('@/components/agents/AgentAvatar', () => ({
  AgentAvatar: ({ name }: { name: string }) => <span data-testid={`avatar-${name}`} />,
}));

function snapshotWith(patch: Partial<SessionActivitySnapshot>): SessionActivitySnapshot {
  return { ...createEmptySessionActivitySnapshot('session-a'), ...patch };
}

const PLAN: RunPlanSurface = {
  id: 'plan-1',
  todos: [
    { id: 't1', content: 'first', status: 'completed' } as never,
    { id: 't2', content: 'second', status: 'in_progress' } as never,
  ],
};

const RUNTIME_PROCESS: RunProcessSurface = {
  type: 'process',
  id: 'call-1',
  command: 'pnpm vitest run',
  cwd: 'C:/w',
  output: 'ok\n',
  status: 'completed',
  exitCode: 0,
  truncated: false,
};

describe('SessionActivityPanel', () => {
  it('shows linked checkout identity and drops it when the snapshot root changes', async () => {
    worktreesMock.mockResolvedValueOnce({ success: true, worktrees: [{ path: 'C:/main' }, { path: 'C:/linked' }] });
    const git = { isRepository: true, workspaceRoot: 'C:/linked', repoRoot: 'C:/linked', branch: 'feature/cards', ahead: 0, behind: 0,
      clean: true, hasConflicts: false, stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0, changes: [] };
    const view = render(<SessionActivityPanel snapshot={snapshotWith({ git })} />);
    expect(await screen.findByTestId('session-activity-worktree-kind')).toHaveTextContent('composer.git.kindWorktree');
    view.rerender(<SessionActivityPanel snapshot={snapshotWith({ git: { ...git, repoRoot: 'C:/another', workspaceRoot: 'C:/another' } })} />);
    expect(screen.queryByTestId('session-activity-worktree-kind')).toBeNull();
  });
  it('summarises sources as one Connectors row and keeps the list and tool names behind disclosure', () => {
    render(<SessionActivityPanel
      snapshot={snapshotWith({})}
      statusPending
      sources={[
        ...Array.from({ length: 5 }, (_, index) => ({
          id: `mcp:source-${index}`, kind: 'mcp' as const,
          name: `source-${index}`, tools: [`tool-${index}`],
        })),
        { id: 'skill:review', kind: 'skill' as const, name: 'review', tools: [] },
      ]}
    />);
    const toggle = screen.getByTestId('session-activity-sources-toggle');
    expect(toggle).toHaveTextContent('sessionActivity.overview.connectors');
    expect(toggle).toHaveTextContent('sessionActivity.overview.connectorsValue:5');
    expect(toggle).toHaveTextContent('sessionActivity.overview.skillsValue:1');
    expect(screen.getByText('source-0')).not.toBeVisible();
    expect(screen.queryByTestId('session-activity-alert')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText('source-0')).toBeVisible();
    expect(screen.getByText('tool-0')).not.toBeVisible();
    expect(screen.getByText('source-3')).not.toBeVisible();
    fireEvent.click(screen.getByText('source-0'));
    expect(screen.getByText('tool-0')).toBeVisible();
    fireEvent.click(screen.getByTestId('session-activity-more-sources').querySelector('summary')!);
    expect(screen.getByText('source-4')).toBeVisible();
  });

  it('draws the Context row only from a real reading, with a meter when the window is known', () => {
    const git = { isRepository: true, workspaceRoot: 'C:/w', branch: 'main', ahead: 0, behind: 0, clean: false, hasConflicts: false,
      stagedCount: 1, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0,
      changes: [{ path: 'a.ts', absolutePath: 'C:/w/a.ts', status: 'M', staged: true, unstaged: false, untracked: false, conflicted: false, bucket: 'staged' as const, additions: 1, deletions: 1 }] };
    const view = render(<SessionActivityPanel snapshot={snapshotWith({ git })}
      context={{ usedTokens: null, maxTokens: 200_000, utilisation: null }} />);
    expect(screen.queryByTestId('session-activity-context')).toBeNull();
    view.rerender(<SessionActivityPanel snapshot={snapshotWith({ git })}
      context={{ usedTokens: 46_200, maxTokens: 200_000, utilisation: 0.231, cacheReadTokens: 31_200, warmTurnHitRate: 0.82 }} />);
    const toggle = screen.getByTestId('session-activity-context-toggle');
    expect(toggle).toHaveTextContent('23%');
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '23');
    fireEvent.click(toggle);
    expect(screen.getByTestId('session-activity-context')).toHaveTextContent('46k / 200k');
    expect(screen.getByTestId('session-activity-context')).toHaveTextContent('82%');
    view.rerender(<SessionActivityPanel snapshot={snapshotWith({ git })}
      context={{ usedTokens: 12_000, maxTokens: null, utilisation: null }} />);
    expect(screen.getByTestId('session-activity-context-toggle')).toHaveTextContent('12k');
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('tints the Context meter from the owner pressure, not only from the percentage', () => {
    render(<SessionActivityPanel
      snapshot={snapshotWith({ continuity: { queueCount: 0, contextPressure: 'high' }, subagents: [
        { id: 'n1', status: 'started', updatedAt: 1, source: 'event' },
      ] })}
      context={{ usedTokens: 40_000, maxTokens: 200_000, utilisation: 0.2 }} />);
    expect(screen.getByRole('meter')).toHaveAttribute('data-state', 'error');
  });

  it('keeps active workers ahead of completed history and retains all workers on demand', () => {
    const snapshot = snapshotWith({ subagents: Array.from({ length: 8 }, (_, index) => ({
      id: `worker-${index}`, childSessionKey: `agent:worker:child-${index}`,
      status: index === 0 ? 'started' as const : 'completed' as const,
      updatedAt: index, source: 'event' as const,
    })) });
    render(<SessionActivityPanel snapshot={snapshot} />);
    expect(screen.getByTestId('session-activity-subagent-worker-0')).toBeVisible();
    expect(screen.getByTestId('session-activity-subagent-worker-1')).not.toBeVisible();
    fireEvent.click(screen.getByTestId('session-activity-more-subagents').querySelector('summary')!);
    expect(screen.getByTestId('session-activity-subagent-worker-1')).toBeVisible();
  });

  it('renders configured policy without dressing it up as effective', () => {
    render(
      <SessionActivityPanel
        snapshot={snapshotWith({
          policy: {
            schemaVersion: 'SessionEffectivePolicy/v1',
            generatedAt: '2026-10-23T08:00:00.000Z',
            scope: {
              workspaceId: 'workspace-a',
              sessionKey: 'agent:main:main',
              agentId: 'main',
              sessionId: 'session-1',
              runId: null,
            },
            generation: {
              state: 'missing',
              runtimeGeneration: null,
              capabilityProfileGeneration: null,
              observedAt: null,
              reason: 'no-current-run-capability-profile',
            },
            backend: {
              configured: {
                value: {
                  runtime: 'codex',
                  kind: 'native',
                  ownsNativeCompaction: true,
                  provider: 'openai',
                  model: 'gpt-5.4',
                },
                status: 'configured',
                source: 'session.runtime',
                reason: null,
              },
              effective: {
                value: null,
                status: 'unverified',
                source: 'runtime.observation',
                reason: 'no-current-run-capability-profile',
              },
            },
            harness: {
              configured: { value: { id: 'codex', kind: 'native' }, status: 'configured', source: 'session.runtime', reason: null },
              effective: { value: null, status: 'unverified', source: 'runtime.observation', reason: 'no-current-run-capability-profile' },
            },
            model: {
              configured: {
                value: { provider: 'openai', model: 'gpt-5.4', effort: 'high' },
                status: 'configured',
                source: 'session.model',
                reason: null,
              },
              effective: {
                value: null,
                status: 'unverified',
                source: 'runtime.observation',
                reason: 'no-current-run-capability-profile',
              },
            },
            grants: {
              configured: { value: null, status: 'unverified', source: 'runtime', reason: null },
              effective: {
                value: {
                  total: 3,
                  allowed: 1,
                  requiresApproval: 1,
                  denied: 1,
                  unknown: 0,
                  actions: [
                    { actionId: 'exec', authorization: 'allowed', grantState: 'active' },
                    { actionId: 'write', authorization: 'requires-approval', grantState: null },
                    { actionId: 'browser', authorization: 'denied', grantState: 'revoked' },
                  ],
                },
                status: 'effective',
                source: 'runtime-effective-capability.observation',
                reason: null,
              },
            },
            context: {
              configured: { value: { contextTokens: null, contextPressure: null }, status: 'unverified', source: 'config', reason: null },
              effective: { value: null, status: 'unverified', source: 'session', reason: null },
            },
            queue: {
              configured: { value: { mode: null, cap: null, drop: null, debounceMs: null, queuedCount: 0 }, status: 'unverified', source: 'session', reason: null },
              effective: { value: { mode: null, cap: null, drop: null, debounceMs: null, queuedCount: 0 }, status: 'effective', source: 'session', reason: null },
            },
            resources: {
              configured: { value: { maxConcurrentRuns: null, maxConcurrentSubagents: null, maxSpawnDepth: null, maxChildrenPerAgent: null, maxProcesses: null, maxRssMb: null, maxBackgroundTerminals: null, maxWorktrees: null, idleTtlMs: null, keepOnLeave: null }, status: 'unverified', source: 'config', reason: null },
              effective: { value: null, status: 'unverified', source: 'runtime', reason: null },
            },
            schedule: {
              configured: { value: { cronEnabled: null, cronMaxConcurrentRuns: null, sessionRetention: null }, status: 'unverified', source: 'config', reason: null },
              effective: { value: null, status: 'unverified', source: 'runtime', reason: null },
            },
            compatibility: [
              {
                backend: 'codex',
                parameter: 'compaction.reserveTokens',
                status: 'unsupported',
                reason: 'native compaction does not consume OpenClaw reserve-token arguments',
              },
            ],
            sources: ['session.entry', 'runtime-effective-capability.observation'],
          },
        })}
      />,
    );

    expect(screen.getByTestId('session-activity-policy')).toBeTruthy();
    expect(screen.getByTestId('session-activity-policy-backend').textContent).toContain('configured');
    expect(screen.getByTestId('session-activity-policy-backend').textContent).toContain('session.runtime');
    expect(screen.getByTestId('session-activity-policy-harness').textContent).toContain('codex');
    expect(screen.getByTestId('session-activity-policy-harness').textContent).toContain('unverified');
    expect(screen.getByTestId('session-activity-policy-effective').textContent).toContain('unverified');
    expect(screen.getByTestId('session-activity-policy-effort').textContent).toContain('high');
    expect(screen.getByTestId('session-activity-policy-actions').textContent).toContain('actionSummary');
    expect(screen.getByTestId('session-activity-policy-sources').textContent).toContain('runtime-effective-capability.observation');
    expect(screen.getByTestId('session-activity-policy-compatibility').textContent).toContain('unsupported');
    expect(screen.getByTestId('session-activity-policy-compatibility').textContent).toContain('reasons.nativeReserveTokens');
    expect(screen.getByTestId('session-activity-policy-action-details').textContent).toContain('requiresApproval');
    expect(screen.getByTestId('session-activity-policy-boundaries').textContent).toContain('boundaries.abort.title');
    expect(screen.getByTestId('session-activity-policy-boundaries').textContent).toContain('boundaries.fork.description');
  });

  it('orders the four sections: environment, plan, sub-agents, processes', () => {
    render(
      <SessionActivityPanel
        snapshot={snapshotWith({
          git: {
            isRepository: true, workspaceRoot: 'C:/w', branch: 'main', ahead: 0, behind: 0,
            clean: false, hasConflicts: false, stagedCount: 1, unstagedCount: 0, untrackedCount: 0,
            conflictedCount: 0,
            changes: [{ path: 'a.ts', absolutePath: 'C:/w/a.ts', status: 'M', staged: true, unstaged: false, untracked: false, conflicted: false, bucket: 'staged', additions: 12, deletions: 3 }],
          },
          subagents: [{ id: 'n1', role: 'explorer', status: 'started', childSessionKey: 'agent:explorer:c1', updatedAt: 1, source: 'event' }],
        })}
        plan={PLAN}
        processes={[RUNTIME_PROCESS]}
      />,
    );

    const order = Array.from(document.querySelectorAll('[data-testid^="session-activity-"]'))
      .map((n) => n.getAttribute('data-testid'))
      .filter((id): id is string => Boolean(id) && [
        'session-activity-environment', 'session-activity-plan',
        'session-activity-subagents', 'session-activity-processes',
      ].includes(id!));

    expect(order).toEqual([
      'session-activity-environment',
      'session-activity-plan',
      'session-activity-subagents',
      'session-activity-processes',
    ]);
  });

  it('reports changed lines as a signed delta', () => {
    render(
      <SessionActivityPanel
        snapshot={snapshotWith({
          git: {
            isRepository: true, workspaceRoot: 'C:/w', branch: 'main', ahead: 0, behind: 0,
            clean: false, hasConflicts: false, stagedCount: 1, unstagedCount: 0, untrackedCount: 0,
            conflictedCount: 0,
            changes: [
              { path: 'a.ts', absolutePath: 'C:/w/a.ts', status: 'M', staged: true, unstaged: false, untracked: false, conflicted: false, bucket: 'staged', additions: 1200, deletions: 40 },
              { path: 'b.ts', absolutePath: 'C:/w/b.ts', status: 'M', staged: true, unstaged: false, untracked: false, conflicted: false, bucket: 'staged', additions: 10, deletions: 7 },
            ],
          },
        })}
      />,
    );

    const delta = screen.getByTestId('session-activity-git-delta');
    expect(delta).toHaveTextContent('+1,210');
    expect(delta).toHaveTextContent('−47');
    expect(screen.getByTestId('session-activity-git-branch')).toHaveTextContent('main');
    expect(screen.getByTestId('session-activity-git-branch')).toHaveTextContent('sessionActivity.git.changes:2');
  });

  it('opens the review from the Changes row and marks it while the review tab is on screen', () => {
    const onOpenEnvironment = vi.fn();
    const git = { isRepository: true, workspaceRoot: 'C:/w', branch: 'main', ahead: 0, behind: 0, clean: false, hasConflicts: false,
      stagedCount: 1, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0,
      changes: [{ path: 'a.ts', absolutePath: 'C:/w/a.ts', status: 'M', staged: true, unstaged: false, untracked: false, conflicted: false, bucket: 'staged' as const, additions: 3, deletions: 1 }] };
    const view = render(<SessionActivityPanel snapshot={snapshotWith({ git })} onOpenEnvironment={onOpenEnvironment} />);
    fireEvent.click(screen.getByTestId('session-activity-review'));
    expect(onOpenEnvironment).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('session-activity-review')).toHaveAttribute('aria-pressed', 'false');
    view.rerender(<SessionActivityPanel snapshot={snapshotWith({ git })} onOpenEnvironment={onOpenEnvironment}
      activeWorkspaceSubject={{ kind: 'review' }} />);
    expect(screen.getByTestId('session-activity-review')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('session-activity-git-delta')).toHaveClass('is-active');
  });

  it('groups workers and commands under Background tasks with the running total', () => {
    render(<SessionActivityPanel
      snapshot={snapshotWith({ subagents: [{ id: 'n1', role: 'explorer', status: 'started', updatedAt: 1, source: 'event' }] })}
      processes={[{ ...RUNTIME_PROCESS, id: 'call-live', status: 'running', startedAt: Date.now() - 65_000 }]}
    />);
    const group = screen.getByTestId('session-activity-background');
    expect(group).toContainElement(screen.getByTestId('session-activity-subagents'));
    expect(group).toContainElement(screen.getByTestId('session-activity-processes'));
    expect(group).toHaveTextContent('sessionActivity.runningCount:2');
    expect(screen.getByTestId('session-activity-process-elapsed-call-live')).toHaveTextContent('1m');
  });

  it('opens a sub-agent by its child session, and only when it has one', () => {
    const onOpenSubagent = vi.fn();
    render(
      <SessionActivityPanel
        snapshot={snapshotWith({
          subagents: [
            { id: 'n1', role: 'explorer', status: 'started', childSessionKey: 'agent:explorer:c1', updatedAt: 1, source: 'event' },
            { id: 'n2', role: 'reviewer', status: 'started', updatedAt: 2, source: 'event' },
          ],
        })}
        onOpenSubagent={onOpenSubagent}
      />,
    );

    fireEvent.click(screen.getByTestId('session-activity-subagent-n1'));
    expect(onOpenSubagent).toHaveBeenCalledWith('agent:explorer:c1');

    // A worker with no child session is listed but not openable — clicking it
    // would land on an empty transcript pane.
    expect(screen.getByTestId('session-activity-subagent-n2').tagName).toBe('DIV');
  });

  it('opens a runtime process with its command, for the tab label', () => {
    const onOpenProcess = vi.fn();
    render(
      <SessionActivityPanel
        snapshot={snapshotWith({})}
        processes={[RUNTIME_PROCESS]}
        onOpenProcess={onOpenProcess}
      />,
    );

    expect(screen.getByTestId('session-activity-process-call-1')).not.toBeVisible();
    fireEvent.click(screen.getByTestId('session-activity-recent-processes').querySelector('summary')!);
    fireEvent.click(screen.getByTestId('session-activity-process-open-call-1'));
    expect(onOpenProcess).toHaveBeenCalledWith('call-1', 'pnpm vitest run');
  });

  it('expands a process in place to show the tail of its output', () => {
    render(
      <SessionActivityPanel
        snapshot={snapshotWith({})}
        processes={[{ ...RUNTIME_PROCESS, output: 'line one\nline two\n' }]}
        onOpenProcess={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('session-activity-recent-processes').querySelector('summary')!);
    expect(screen.queryByTestId('session-activity-process-output-call-1')).toBeNull();
    fireEvent.click(screen.getByTestId('session-activity-process-toggle-call-1'));
    expect(screen.getByTestId('session-activity-process-output-call-1')).toHaveTextContent('line two');
  });

  it('marks the process whose page is the active workspace tab', () => {
    render(
      <SessionActivityPanel
        snapshot={snapshotWith({})}
        processes={[{ ...RUNTIME_PROCESS, status: 'running', exitCode: undefined }]}
        activeWorkspaceSubject={{ kind: 'process', subject: 'call-1' }}
        onOpenProcess={vi.fn()}
      />,
    );

    expect(screen.getByTestId('session-activity-process-call-1')).toHaveClass('is-active');
    // The newest running process opens its console without a click.
    expect(screen.getByTestId('session-activity-process-output-call-1')).toBeInTheDocument();
  });

  it('leaves host-projected processes inert — they are redacted, with no output to open', () => {
    render(
      <SessionActivityPanel
        snapshot={snapshotWith({
          processes: [{ id: 'bash-1', kind: 'bash', label: 'bash-1', status: 'completed', updatedAt: 1 }],
        })}
        onOpenProcess={vi.fn()}
      />,
    );

    const section = screen.getByTestId('session-activity-processes');
    expect(section.querySelectorAll('button')).toHaveLength(0);
    expect(screen.getByTestId('session-activity-snapshot-process-bash-1').tagName).toBe('DIV');
  });

  it('keeps running and failed processes visible even after many completed commands', () => {
    render(<SessionActivityPanel snapshot={snapshotWith({})} processes={[
      { ...RUNTIME_PROCESS, id: 'active', status: 'running', exitCode: undefined },
      { ...RUNTIME_PROCESS, id: 'failed', status: 'failed', exitCode: 1 },
      ...Array.from({ length: 10 }, (_, index) => ({ ...RUNTIME_PROCESS, id: `done-${index}` })),
    ]} />);
    expect(screen.getByTestId('session-activity-process-active')).toBeVisible();
    expect(screen.getByTestId('session-activity-process-failed')).toBeVisible();
    expect(screen.getByTestId('session-activity-process-done-0')).not.toBeVisible();
    fireEvent.click(screen.getByTestId('session-activity-recent-processes').querySelector('summary')!);
    expect(screen.getByTestId('session-activity-process-done-0')).toBeVisible();
    expect(screen.getByTestId('session-activity-process-done-9')).toBeVisible();
  });

  it('prefers the runtime row when both sources describe one process', () => {
    render(
      <SessionActivityPanel
        snapshot={snapshotWith({
          processes: [{ id: 'call-1', kind: 'bash', label: 'redacted', status: 'completed', updatedAt: 1 }],
        })}
        processes={[RUNTIME_PROCESS]}
        onOpenProcess={vi.fn()}
      />,
    );

    expect(screen.getByTestId('session-activity-process-call-1')).toBeInTheDocument();
    expect(screen.queryByTestId('session-activity-snapshot-process-call-1')).toBeNull();
  });

  it('renders nothing when every source is empty', () => {
    const snapshot = snapshotWith({});
    snapshot.availability = { git: true, tasks: true, subagents: true, terminals: true, continuity: true };
    const { container } = render(<SessionActivityPanel snapshot={snapshot} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('surfaces a run failure even though it has no section of its own', () => {
    render(
      <SessionActivityPanel
        snapshot={snapshotWith({
          session: { ...createEmptySessionActivitySnapshot('session-a').session, status: 'failed', error: 'boom' },
        })}
      />,
    );

    expect(screen.getByTestId('session-activity-alert')).toHaveTextContent('boom');
  });
});
