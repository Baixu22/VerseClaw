/**
 * SessionStatusRail — the chat's third column.
 *
 * A read-mostly view of what this session is doing right now. Every section is
 * live host state: git from `git.status()`, the plan from the run's own
 * `update_plan` surface, the sub-agent roster from `agent:subagent-lifecycle`
 * events, the terminal from `terminal.status()`. Nothing here is a fixture.
 *
 * Git is the one always-present section — a workspace either is a repository or
 * says so. The other three appear only once they have something to report: no
 * plan and no ledger means no Process section at all, rather than a row saying
 * "nothing running". An empty section is worse than an absent one; it spends
 * vertical space to tell you nothing.
 *
 * Sections collapse into their own header buttons rather than sitting open in a
 * flush-bottom stack, so the column reads as a set of dropdowns. Git starts
 * open; the rest start shut and are opened by the user.
 *
 * Detail views live in the workspace panel, not here: clicking an agent opens
 * the Agents tab focused on that transcript, and the terminal row opens the
 * Terminal tab. The rail links out; it does not host.
 */
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  GitCommitHorizontal,
  Loader2,
  PanelRightClose,
  SquareTerminal,
} from 'lucide-react';
import { WelcomeBranchPicker } from '@/components/chat/WelcomeBranchPicker';
import { AgentRoleIdentity } from '@/components/agents/AgentAvatar';
import { ToolUiPlanView, type ToolUiPlanTodo } from '@/components/tool-ui/plan-view';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { AsyncSurfaceState } from '@/lib/async-surface-state';
import { useAgentsStore } from '@/stores/agents';
import type { LongTaskControlStatus } from '@shared/types/long-task-control';
import type { TeamOrchestrationView } from '@/pages/Chat/team-orchestration-visualization';
import {
  useSessionStatus,
  type SessionGitSummary,
  type SessionSubagentEntry,
  type SessionTerminalSummary,
} from '@/pages/Chat/use-session-status';

export type SessionStatusRailProps = {
  workspaceId?: string | null;
  sessionKey: string;
  refreshSignal?: number;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  planTitle?: string;
  planTodos: ToolUiPlanTodo[];
  orchestrations: TeamOrchestrationView[];
  longTaskControlStatus?: LongTaskControlStatus | null;
  queueDrainBusy?: boolean;
  runActive?: boolean;
  showCompactionArtifact?: boolean;
  onOpenGit: () => void;
  onOpenTerminal: () => void;
  onOpenAgents: (childSessionKey?: string) => void;
  onGitStash?: () => void | Promise<void>;
  onGitCommit?: (message: string) => void | Promise<void>;
  onGitPush?: () => void | Promise<void>;
  onDrainQueuedFollowup?: () => void | Promise<void>;
  onViewCompactionArtifact?: () => void;
};

function formatCount(value: number): string {
  return value.toLocaleString();
}

/** `agent:<id>:<session>` — the child's own agent id, for its avatar. */
function agentIdFromSessionKey(sessionKey: string | undefined): string | null {
  if (!sessionKey) return null;
  const parts = sessionKey.split(':');
  return parts.length >= 2 && parts[0] === 'agent' ? parts[1] : null;
}

/**
 * One collapsible section. The header is the whole affordance — a button with
 * a chevron and an optional summary that stays readable while shut, so the
 * column still reports state without being expanded.
 */
function RailSection({
  title,
  summary,
  open,
  onOpenChange,
  testId,
  children,
}: {
  title: string;
  summary?: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <section className="codex-session-rail__section" data-testid={testId} data-open={open}>
      <button
        type="button"
        className="codex-session-rail__section-head"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        data-testid={`${testId}-toggle`}
      >
        <ChevronDown
          className={cn('codex-session-rail__section-chevron', !open && '-rotate-90')}
          aria-hidden="true"
        />
        <span className="codex-session-rail__section-title">{title}</span>
        {summary != null && <span className="codex-session-rail__section-summary">{summary}</span>}
      </button>
      {open && <div className="codex-session-rail__section-body">{children}</div>}
    </section>
  );
}

/** A tappable row: label left, value right, chevron on hover. */
function RailRow({
  icon,
  label,
  value,
  testId,
  onClick,
  title,
}: {
  icon?: React.ReactNode;
  label: string;
  value?: React.ReactNode;
  testId?: string;
  onClick?: () => void;
  title?: string;
}) {
  const content = (
    <>
      {icon && <span className="codex-session-rail__row-icon">{icon}</span>}
      <span className="codex-session-rail__row-label">{label}</span>
      {value != null && <span className="codex-session-rail__row-value">{value}</span>}
    </>
  );
  if (!onClick) {
    return (
      <div className="codex-session-rail__row" data-testid={testId} title={title}>{content}</div>
    );
  }
  return (
    <button
      type="button"
      className="codex-session-rail__row is-interactive"
      data-testid={testId}
      onClick={onClick}
      title={title}
    >
      {content}
    </button>
  );
}

const GitSection = memo(function GitSection({
  git,
  gitState,
  open,
  onOpenChange,
  onOpenGit,
  onBranchChanged,
  onStash,
  onCommit,
  onPush,
}: {
  git: SessionGitSummary | null;
  gitState: AsyncSurfaceState<SessionGitSummary | null>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenGit: () => void;
  onBranchChanged: () => void;
  onStash?: () => void | Promise<void>;
  onCommit?: (message: string) => void | Promise<void>;
  onPush?: () => void | Promise<void>;
}) {
  const { t } = useTranslation('chat');
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [committing, setCommitting] = useState(false);

  const handleCommitClick = useCallback(() => {
    setCommitDialogOpen(true);
    setCommitMessage('');
  }, []);

  const handleCommitSubmit = useCallback(async () => {
    if (!commitMessage.trim() || !onCommit) return;
    setCommitting(true);
    try {
      await onCommit(commitMessage.trim());
      setCommitDialogOpen(false);
      setCommitMessage('');
    } finally {
      setCommitting(false);
    }
  }, [commitMessage, onCommit]);

  const handleStashClick = useCallback(() => {
    void onStash?.();
  }, [onStash]);

  const handlePushClick = useCallback(() => {
    void onPush?.();
  }, [onPush]);

  const delta = git && git.added != null && git.removed != null
    ? (
      <span className="codex-session-rail__delta">
        <span className="codex-session-rail__delta-add">+{formatCount(git.added)}</span>
        <span className="codex-session-rail__delta-remove">−{formatCount(git.removed)}</span>
      </span>
    )
    : null;

  const summary = !git
    ? undefined
    : git.clean
      ? <span className="codex-session-rail__row-muted">{t('sessionRail.git.clean')}</span>
      : delta ?? <span className="codex-session-rail__row-muted">{formatCount(git.changeCount)}</span>;

  return (
    <RailSection
      title={t('sessionRail.git.title')}
      summary={summary}
      open={open}
      onOpenChange={onOpenChange}
      testId="session-status-rail-git"
    >
      {gitState.status === 'loading' ? (
        <p className="codex-session-rail__empty">{t('sessionRail.git.loading')}</p>
      ) : gitState.status === 'failed' || gitState.status === 'unavailable' ? (
        <div className="codex-session-rail__empty" data-testid="session-status-rail-git-error">
          <p>{t(gitState.error.messageKey)}</p>
          {gitState.error.errorId ? (
            <p className="codex-session-rail__row-muted">
              {t('common:errorBoundary.errorReference')} {gitState.error.errorId}
            </p>
          ) : null}
          {gitState.error.retry ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={gitState.error.retry}
              data-testid="session-status-rail-git-retry"
            >
              {t('retry')}
            </Button>
          ) : null}
        </div>
      ) : !git ? (
        <p className="codex-session-rail__empty">{t('sessionRail.git.notARepository')}</p>
      ) : (
        <>
          <RailRow
            label={t('sessionRail.git.changes')}
            value={git.clean
              ? <span className="codex-session-rail__row-muted">{t('sessionRail.git.clean')}</span>
              : delta ?? <span className="codex-session-rail__row-muted">{t('sessionRail.git.noLineStats')}</span>}
            testId="session-status-rail-changes"
            onClick={onOpenGit}
            title={t('sessionRail.git.changeCount', { count: git.changeCount })}
          />
          <div className="codex-session-rail__branch">
            <WelcomeBranchPicker
              branch={git.branch ?? ''}
              detached={git.detached}
              onChanged={onBranchChanged}
            />
            {(git.ahead > 0 || git.behind > 0) && (
              <span className="codex-session-rail__row-muted" data-testid="session-status-rail-tracking">
                {t('sessionRail.git.tracking', { ahead: git.ahead, behind: git.behind })}
              </span>
            )}
          </div>

          {/* Git action buttons */}
          {!git.clean && (
            <div className="flex gap-2 px-3 pb-2">
              {git.unstagedCount > 0 && onStash && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 flex-1 text-xs"
                  onClick={handleStashClick}
                  data-testid="session-status-rail-git-stash"
                >
                  {t('sessionRail.git.stash')}
                </Button>
              )}
              {git.stagedCount > 0 && onCommit && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 flex-1 text-xs"
                  onClick={handleCommitClick}
                  data-testid="session-status-rail-git-commit"
                >
                  {t('sessionRail.git.commit')}
                </Button>
              )}
              {git.ahead > 0 && onPush && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 flex-1 text-xs"
                  onClick={handlePushClick}
                  data-testid="session-status-rail-git-push"
                >
                  {t('sessionRail.git.push')}
                </Button>
              )}
            </div>
          )}

          <RailRow
            icon={<GitCommitHorizontal className="h-3.5 w-3.5" aria-hidden="true" />}
            label={t('sessionRail.git.commitOrPush')}
            testId="session-status-rail-commit-row"
            onClick={onOpenGit}
          />
        </>
      )}

      {/* Commit dialog */}
      <Dialog open={commitDialogOpen} onOpenChange={setCommitDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <div className="space-y-4">
            <div className="space-y-2">
              <DialogTitle>{t('sessionRail.git.commit')}</DialogTitle>
              <DialogDescription>
                {t('sessionRail.git.commitMessagePlaceholder')}
              </DialogDescription>
            </div>
            <Input
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder={t('sessionRail.git.commitMessagePlaceholder')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && commitMessage.trim()) {
                  e.preventDefault();
                  void handleCommitSubmit();
                }
              }}
              autoFocus
              data-testid="session-status-rail-commit-input"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setCommitDialogOpen(false)}
                disabled={committing}
              >
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button
                onClick={handleCommitSubmit}
                disabled={!commitMessage.trim() || committing}
                data-testid="session-status-rail-commit-submit"
              >
                {committing ? t('common.committing', 'Committing...') : t('sessionRail.git.commit')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </RailSection>
  );
});

/**
 * Process — the run's own plan.
 *
 * Fed by the `update_plan` / `todo_write` surface the transcript already
 * promotes, and rendered with the same `ToolUiPlanView` the conversation uses,
 * so the plan in the rail and the plan in the transcript cannot drift. The task
 * ledger is deliberately NOT the source here: the ledger is a durable
 * project-level record, while this section answers "what is this run doing
 * right now".
 */
const ProcessSection = memo(function ProcessSection({
  planTitle,
  planTodos,
  longTaskControlStatus,
  queueDrainBusy,
  runActive,
  open,
  onOpenChange,
  onDrainQueuedFollowup,
}: {
  planTitle?: string;
  planTodos: ToolUiPlanTodo[];
  longTaskControlStatus?: LongTaskControlStatus | null;
  queueDrainBusy?: boolean;
  runActive?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDrainQueuedFollowup?: () => void | Promise<void>;
}) {
  const { t } = useTranslation('chat');
  const queued = longTaskControlStatus?.queueCount ?? 0;
  const warnings = longTaskControlStatus?.warnings?.length ?? 0;
  const checkpoint = longTaskControlStatus?.latestCheckpoint?.trigger;
  const hasPlan = planTodos.length > 0;
  const hasControl = queued > 0 || warnings > 0 || Boolean(checkpoint);

  // No plan and no control signal means this run has nothing to report.
  if (!hasPlan && !hasControl) return null;

  const doneCount = planTodos.filter((todo) => todo.status === 'completed').length;
  const summary = hasPlan
    ? (
      <span className={cn(
        'codex-session-rail__progress',
        doneCount === planTodos.length && 'is-complete',
      )}>
        {doneCount}/{planTodos.length}
      </span>
    )
    : <span className="codex-session-rail__row-muted">{t('sessionRail.process.queued', { count: queued })}</span>;

  return (
    <RailSection
      title={t('sessionRail.process.title')}
      summary={summary}
      open={open}
      onOpenChange={onOpenChange}
      testId="session-status-rail-process"
    >
      {hasPlan && (
        <ToolUiPlanView
          title={planTitle || t('sessionRail.process.planTitle')}
          todos={planTodos}
          maxVisibleTodos={6}
          compact
          showTitle={false}
          testId="session-status-rail-plan"
        />
      )}
      {hasControl && (
        <div className="codex-session-rail__control" data-testid="session-status-rail-long-task">
          <span className="codex-session-rail__row-muted">
            {[
              queued > 0 ? t('sessionRail.process.queued', { count: queued }) : null,
              checkpoint
                ? t('sessionRail.process.checkpoint', {
                  trigger: t(`composer.longTaskControl.trigger.${checkpoint}`, { defaultValue: checkpoint }),
                })
                : null,
              warnings > 0 ? t('sessionRail.process.warnings', { count: warnings }) : null,
            ].filter(Boolean).join(' · ')}
          </span>
          {queued > 0 && onDrainQueuedFollowup && (
            <button
              type="button"
              className="codex-session-rail__action"
              data-testid="session-status-rail-drain"
              disabled={runActive || queueDrainBusy}
              onClick={() => void onDrainQueuedFollowup()}
            >
              {queueDrainBusy
                ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                : t('sessionRail.process.drain')}
            </button>
          )}
        </div>
      )}
    </RailSection>
  );
});

const AgentsSection = memo(function AgentsSection({
  subagents,
  runningCount,
  orchestrations,
  open,
  onOpenChange,
  onOpenAgents,
}: {
  subagents: SessionSubagentEntry[];
  runningCount: number;
  orchestrations: TeamOrchestrationView[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenAgents: (childSessionKey?: string) => void;
}) {
  const { t } = useTranslation('chat');
  const agents = useAgentsStore((s) => s.agents);
  const orchestrationTotals = useMemo(() => orchestrations.reduce(
    (totals, entry) => ({
      workers: totals.workers + entry.workerCount,
      pending: totals.pending + entry.pendingCount,
      failures: totals.failures + entry.failureCount,
    }),
    { workers: 0, pending: 0, failures: 0 },
  ), [orchestrations]);

  // No sub-agents and no orchestration means this session never spawned one.
  if (subagents.length === 0 && orchestrationTotals.workers === 0) return null;

  return (
    <RailSection
      title={t('sessionRail.agents.title')}
      summary={runningCount > 0
        ? <span className="codex-session-rail__row-muted">{t('sessionRail.agents.running', { count: runningCount })}</span>
        : <span className="codex-session-rail__row-muted">{subagents.length}</span>}
      open={open}
      onOpenChange={onOpenChange}
      testId="session-status-rail-agents"
    >
      {subagents.map((entry) => {
        const childAgentId = entry.agentId ?? agentIdFromSessionKey(entry.childSessionKey) ?? entry.roleName;
        const avatar = agents.find((agent) => agent.id === childAgentId)?.avatar;
        return (
          <button
            key={entry.key}
            type="button"
            className="codex-session-rail__agent-row"
            onClick={() => onOpenAgents(entry.childSessionKey)}
            data-testid={`session-status-rail-agent-${entry.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`}
            title={entry.task || entry.roleName}
          >
            <AgentRoleIdentity
              agentId={childAgentId}
              name={entry.roleName}
              avatar={avatar}
              roleName={entry.roleName}
              size={24}
            />
            <span className="codex-session-rail__agent-text">
              <span className="codex-session-rail__row-label">{entry.roleName}</span>
              <span className={cn(
                'codex-session-rail__row-muted',
                entry.status === 'error' && 'codex-session-rail__status-error',
                entry.status === 'completed' && 'codex-session-rail__status-done',
              )}>
                {t(`sessionRail.agents.status.${entry.status}`, { defaultValue: entry.status })}
              </span>
            </span>
            {entry.status === 'started' && (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" />
            )}
          </button>
        );
      })}
      {orchestrationTotals.workers > 0 && (
        <p className="codex-session-rail__empty" data-testid="session-status-rail-orchestration">
          {t('sessionRail.agents.orchestration', orchestrationTotals)}
        </p>
      )}
    </RailSection>
  );
});

const TerminalSection = memo(function TerminalSection({
  terminal,
  terminalState,
  open,
  onOpenChange,
  onOpenTerminal,
}: {
  terminal: SessionTerminalSummary | null;
  terminalState: AsyncSurfaceState<SessionTerminalSummary | null>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenTerminal: () => void;
}) {
  const { t } = useTranslation('chat');
  // R2: a failed status query is NOT "no terminal" — show it with retry.
  if (terminalState.status === 'failed' || terminalState.status === 'unavailable') {
    return (
      <RailSection
        title={t('sessionRail.terminal.title')}
        summary={<span className="codex-session-rail__row-muted">{t('sessionRail.terminal.unavailable')}</span>}
        open={open}
        onOpenChange={onOpenChange}
        testId="session-status-rail-terminal"
      >
        <div className="codex-session-rail__empty" data-testid="session-status-rail-terminal-error">
          <p>{t(terminalState.error.messageKey)}</p>
          {terminalState.error.errorId ? (
            <p className="codex-session-rail__row-muted">
              {t('common:errorBoundary.errorReference')} {terminalState.error.errorId}
            </p>
          ) : null}
          {terminalState.error.retry ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={terminalState.error.retry}
              data-testid="session-status-rail-terminal-retry"
            >
              {t('retry')}
            </Button>
          ) : null}
        </div>
      </RailSection>
    );
  }
  // An idle or absent terminal is not worth a section; the `+` menu in the
  // workspace panel is how you start one.
  if (!terminal || terminal.state === 'idle' || terminal.state === 'exited') return null;

  const stateLabel = t(`sessionRail.terminal.state.${terminal.state}`, { defaultValue: terminal.state });
  return (
    <RailSection
      title={t('sessionRail.terminal.title')}
      summary={<span className="codex-session-rail__row-muted">{stateLabel}</span>}
      open={open}
      onOpenChange={onOpenChange}
      testId="session-status-rail-terminal"
    >
      <RailRow
        icon={<SquareTerminal className="h-3.5 w-3.5" aria-hidden="true" />}
        label={stateLabel}
        value={terminal.pid != null
          ? <span className="codex-session-rail__row-muted">{t('sessionRail.terminal.pid', { pid: terminal.pid })}</span>
          : undefined}
        testId="session-status-rail-terminal-row"
        onClick={onOpenTerminal}
      />
    </RailSection>
  );
});

type SectionId = 'git' | 'process' | 'agents' | 'terminal';

export function SessionStatusRail({
  workspaceId,
  sessionKey,
  refreshSignal,
  collapsed,
  onCollapsedChange,
  planTitle,
  planTodos,
  orchestrations,
  longTaskControlStatus,
  queueDrainBusy = false,
  runActive = false,
  showCompactionArtifact = false,
  onOpenGit,
  onOpenTerminal,
  onOpenAgents,
  onGitStash,
  onGitCommit,
  onGitPush,
  onDrainQueuedFollowup,
  onViewCompactionArtifact,
}: SessionStatusRailProps) {
  const { t } = useTranslation('chat');
  const status = useSessionStatus({ workspaceId, sessionKey, refreshSignal });
  // Git leads because it is the only section that is always present.
  const [openSections, setOpenSections] = useState<Record<SectionId, boolean>>({
    git: true,
    process: false,
    agents: false,
    terminal: false,
  });
  const setSectionOpen = useCallback((id: SectionId, open: boolean) => {
    setOpenSections((current) => ({ ...current, [id]: open }));
  }, []);

  if (collapsed) {
    return (
      <aside
        className="codex-session-rail codex-session-rail--collapsed"
        data-testid="session-status-rail"
        data-collapsed="true"
        aria-label={t('sessionRail.title')}
      >
        <button
          type="button"
          className="codex-session-rail__toggle"
          data-testid="session-status-rail-toggle"
          aria-expanded={false}
          aria-label={t('sessionRail.expand')}
          title={t('sessionRail.expand')}
          onClick={() => onCollapsedChange(false)}
        >
          <PanelRightClose className="h-4 w-4 rotate-180" aria-hidden="true" />
        </button>
        {status.runningSubagentCount > 0 && (
          <span className="codex-session-rail__collapsed-badge" data-testid="session-status-rail-collapsed-badge">
            {status.runningSubagentCount}
          </span>
        )}
      </aside>
    );
  }

  return (
    <aside
      className="codex-session-rail"
      data-testid="session-status-rail"
      data-collapsed="false"
      aria-label={t('sessionRail.title')}
    >
      <div className="codex-session-rail__head">
        <h2 className="codex-session-rail__title">{t('sessionRail.title')}</h2>
        <button
          type="button"
          className="codex-session-rail__toggle"
          data-testid="session-status-rail-toggle"
          aria-expanded
          aria-label={t('sessionRail.collapse')}
          title={t('sessionRail.collapse')}
          onClick={() => onCollapsedChange(true)}
        >
          <PanelRightClose className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="codex-session-rail__body">
        <GitSection
          git={status.git}
          gitState={status.gitState}
          open={openSections.git}
          onOpenChange={(open) => setSectionOpen('git', open)}
          onOpenGit={onOpenGit}
          onBranchChanged={status.refreshGit}
          onStash={onGitStash}
          onCommit={onGitCommit}
          onPush={onGitPush}
        />
        <ProcessSection
          planTitle={planTitle}
          planTodos={planTodos}
          longTaskControlStatus={longTaskControlStatus}
          queueDrainBusy={queueDrainBusy}
          runActive={runActive}
          open={openSections.process}
          onOpenChange={(open) => setSectionOpen('process', open)}
          onDrainQueuedFollowup={onDrainQueuedFollowup}
        />
        <AgentsSection
          subagents={status.subagents}
          runningCount={status.runningSubagentCount}
          orchestrations={orchestrations}
          open={openSections.agents}
          onOpenChange={(open) => setSectionOpen('agents', open)}
          onOpenAgents={onOpenAgents}
        />
        <TerminalSection
          terminal={status.terminal}
          terminalState={status.terminalState}
          open={openSections.terminal}
          onOpenChange={(open) => setSectionOpen('terminal', open)}
          onOpenTerminal={onOpenTerminal}
        />
        {showCompactionArtifact && onViewCompactionArtifact && (
          <button
            type="button"
            className="codex-session-rail__footer-link"
            data-testid="session-status-rail-compaction-artifact"
            onClick={onViewCompactionArtifact}
          >
            {t('composer.compaction.viewEvidence')}
          </button>
        )}
      </div>
    </aside>
  );
}
