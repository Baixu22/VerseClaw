// The status card's contract: the four requested sections in a fixed order,
// sub-agent and runtime-process rows openable, host-projected rows inert.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SessionActivityPanel } from '@/pages/Chat/SessionActivityPanel';
import { createEmptySessionActivitySnapshot } from '@shared/types/session-activity';
import type { SessionActivitySnapshot } from '@shared/types/session-activity';
import type { RunProcessSurface } from '@/components/tool-ui/run-surfaces';
import type { RunPlanSurface } from '@/pages/Chat/run-surface-promotion';

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

    fireEvent.click(screen.getByTestId('session-activity-process-call-1'));
    expect(onOpenProcess).toHaveBeenCalledWith('call-1', 'pnpm vitest run');
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
