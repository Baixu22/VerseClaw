import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkContextBar } from '@/components/assistant-render/WorkContextBar';
import type { TurnWorkModel } from '@/components/assistant-render/turn-work-model';
import type { GitRepositoryStatus } from '@shared/types/git';
import type { TaskLedgerSnapshot } from '@shared/types/task-ledger';

const hostApiMock = vi.hoisted(() => ({
  shell: {
    openExternal: vi.fn(),
  },
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: hostApiMock,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'workContext.title': 'Work context',
        'workContext.sections.plan': 'Task log / plan',
        'workContext.sections.ledger': 'Task Ledger',
        'workContext.sections.environment': 'Environment',
        'workContext.sections.artifacts': 'Artifacts',
        'workContext.sections.sources': 'Sources',
        'workContext.environment.workspace': 'Workspace',
        'workContext.environment.branch': 'Branch',
        'workContext.environment.changes': 'Changes',
        'workContext.actions.viewChanges': 'View changes',
        'workContext.actions.commitOrPush': 'Commit or push',
        'workContext.actions.createPr': 'Create PR',
        'workContext.empty.sources': 'No sources yet',
        'workContext.git.clean': 'Clean',
        'turnWork.report.created': 'Created',
        'turnWork.report.modified': 'Modified',
        'turnWork.tabs.tasks': 'Tasks',
      };
      if (key === 'workContext.environment.changeCounts') {
        return `${String(params?.count)} changes`;
      }
      if (key === 'workContext.environment.delta') {
        return `+${String(params?.added)} -${String(params?.removed)}`;
      }
      if (key === 'workContext.ledger.counts') {
        return `${String(params?.active)} active / ${String(params?.review)} review / ${String(params?.blocked)} blocked`;
      }
      if (key === 'toolUi.plan.progress') {
        return `${String(params?.completed ?? '')} of ${String(params?.total ?? '')} complete`;
      }
      return translations[key] ?? key;
    },
  }),
}));

function gitStatus(overrides: Partial<GitRepositoryStatus> = {}): GitRepositoryStatus {
  return {
    isRepository: true,
    workspaceRoot: '/workspace/demo',
    repoRoot: '/workspace/demo',
    branch: 'feature/context-bar',
    ahead: 0,
    behind: 0,
    clean: false,
    hasConflicts: false,
    changes: [{
      path: 'src/demo.ts',
      absolutePath: '/workspace/demo/src/demo.ts',
      status: 'M',
      staged: false,
      unstaged: true,
      untracked: false,
      conflicted: false,
      bucket: 'unstaged',
      additions: 3,
      deletions: 1,
    }],
    stagedCount: 0,
    unstagedCount: 1,
    untrackedCount: 0,
    conflictedCount: 0,
    ...overrides,
  };
}

function workModel(overrides: Partial<TurnWorkModel> = {}): TurnWorkModel {
  return {
    id: 'run-1',
    status: 'running',
    primaryKind: 'tasks',
    tasks: [
      { id: 'read', label: 'Read existing chat layout', status: 'completed', kind: 'tool' },
      { id: 'patch', label: 'Build top work context', status: 'running', kind: 'tool', detail: 'Use compact plan view.' },
    ],
    reports: [{
      id: 'report-1',
      fileName: 'summary.md',
      filePath: '/workspace/demo/summary.md',
      action: 'created',
      contentType: 'document',
      file: {
        fileName: 'summary.md',
        filePath: '/workspace/demo/summary.md',
        ext: '.md',
        mimeType: 'text/markdown',
        contentType: 'document',
        action: 'created',
        fullContent: '# Summary',
        lastSeenIndex: 2,
      },
    }],
    sources: [{
      id: 'source-1',
      url: 'https://example.com/docs',
      domain: 'example.com',
      label: 'web_fetch',
      status: 'completed',
    }],
    ...overrides,
  };
}

function ledgerSnapshot(): TaskLedgerSnapshot {
  const now = '2026-07-06T00:00:00.000Z';
  return {
    schemaVersion: 1,
    workspaceId: 'workspace-demo',
    generatedAt: now,
    nodes: [
      { id: 'goal', title: 'Ship context bar', kind: 'goal', status: 'doing', createdAt: now, updatedAt: now },
      { id: 'review', title: 'Review visual state', kind: 'review', status: 'review', createdAt: now, updatedAt: now },
      { id: 'blocked', title: 'Need validation', kind: 'risk', status: 'blocked', createdAt: now, updatedAt: now },
    ],
    edges: [],
    sessionLinks: [],
    rootNodeIds: ['goal'],
    activeNodeIds: ['goal'],
    reviewNodeIds: ['review'],
    blockedNodeIds: ['blocked'],
    currentGoalId: 'goal',
    recentDecisions: [],
    eventsCount: 3,
    warnings: [],
  };
}

describe('WorkContextBar', () => {
  it('renders environment-only workspace and Git summary without making Git the main content', () => {
    const onOpenGit = vi.fn();

    render(
      <WorkContextBar
        visible
        workspace={{ name: 'Demo Workspace', rootPath: '/workspace/demo' }}
        gitStatus={gitStatus()}
        workModel={null}
        taskLedgerSnapshot={null}
        onOpenGit={onOpenGit}
        onOpenReport={vi.fn()}
      />,
    );

    const panel = screen.getByTestId('work-context-bar');
    expect(panel).toHaveClass('bg-surface-modal');
    expect(panel).toHaveClass('isolate');
    expect(panel).not.toHaveClass('backdrop-blur');
    expect(panel).toHaveClass('motion-safe:animate-in');
    expect(panel).toHaveTextContent('Environment');
    expect(panel).toHaveTextContent('Demo Workspace');
    expect(panel).toHaveTextContent('feature/context-bar');
    expect(panel).toHaveTextContent('1 changes');
    expect(panel).toHaveTextContent('+3 -1');

    fireEvent.click(screen.getByTestId('work-context-view-changes'));
    expect(onOpenGit).toHaveBeenCalledTimes(1);
  });

  it('prioritizes task plan content above artifacts and sources when a run has steps', () => {
    const { container } = render(
      <WorkContextBar
        visible
        workspace={{ name: 'Demo Workspace', rootPath: '/workspace/demo' }}
        gitStatus={gitStatus()}
        workModel={workModel()}
        taskLedgerSnapshot={ledgerSnapshot()}
        onOpenGit={vi.fn()}
        onOpenReport={vi.fn()}
      />,
    );

    expect(screen.getByTestId('work-context-plan')).toHaveTextContent('Read existing chat layout');
    expect(screen.getByTestId('work-context-plan')).toHaveTextContent('Build top work context');
    expect(container.textContent?.indexOf('Task log / plan')).toBeLessThan(container.textContent?.indexOf('Artifacts') ?? -1);
    expect(container.textContent?.indexOf('Task log / plan')).toBeLessThan(container.textContent?.indexOf('Sources') ?? -1);
  });

  it('shows Task Ledger summary when no run plan is available', () => {
    render(
      <WorkContextBar
        visible
        workspace={{ name: 'Demo Workspace', rootPath: '/workspace/demo' }}
        gitStatus={null}
        workModel={workModel({ tasks: [], reports: [], sources: [], primaryKind: null })}
        taskLedgerSnapshot={ledgerSnapshot()}
        onOpenGit={vi.fn()}
        onOpenReport={vi.fn()}
      />,
    );

    expect(screen.getByTestId('work-context-ledger')).toHaveTextContent('Ship context bar');
    expect(screen.getByTestId('work-context-ledger')).toHaveTextContent('1 active / 1 review / 1 blocked');
  });

  it('opens artifacts through the caller and source links through hostApi', () => {
    const onOpenReport = vi.fn();

    render(
      <WorkContextBar
        visible
        workspace={{ name: 'Demo Workspace', rootPath: '/workspace/demo' }}
        gitStatus={null}
        workModel={workModel()}
        taskLedgerSnapshot={null}
        onOpenGit={vi.fn()}
        onOpenReport={onOpenReport}
      />,
    );

    fireEvent.click(screen.getByTestId('work-context-artifact-report-1'));
    expect(onOpenReport).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'summary.md' }));

    fireEvent.click(screen.getByTestId('work-context-source-source-1'));
    expect(hostApiMock.shell.openExternal).toHaveBeenCalledWith('https://example.com/docs');
  });

  it('hides itself when disabled or when no contextual content exists', () => {
    const { rerender } = render(
      <WorkContextBar
        visible={false}
        workspace={{ name: 'Demo Workspace', rootPath: '/workspace/demo' }}
        gitStatus={gitStatus()}
        workModel={workModel()}
        taskLedgerSnapshot={ledgerSnapshot()}
        onOpenGit={vi.fn()}
        onOpenReport={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('work-context-bar')).not.toBeInTheDocument();

    rerender(
      <WorkContextBar
        visible
        workspace={null}
        gitStatus={null}
        workModel={null}
        taskLedgerSnapshot={null}
        onOpenGit={vi.fn()}
        onOpenReport={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('work-context-bar')).not.toBeInTheDocument();
  });
});
