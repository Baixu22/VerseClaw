/**
 * Session status card — the chat toolbar's 会话状态 dropdown.
 *
 * ## What it shows, and why only this
 *
 * Four sections, in this order, because that is the order you ask the questions
 * in: what state is the workspace in, what is the plan, who is working, what is
 * running.
 *
 *   环境      — the workspace's Git state: branch, changed lines, conflicts.
 *   开发任务  — the run's own plan.
 *   子 Agent  — the workers this run spawned, each openable.
 *   进程      — the shell processes this run launched, each openable.
 *
 * Everything is live host state. There is no fixture path and no section that
 * renders a placeholder: a section with nothing to report is absent, because an
 * empty section spends vertical space to say nothing.
 *
 * ## Sourcing
 *
 * Git comes from the session-activity snapshot (`git.status()`). The plan and the
 * processes come from the chat runtime run state — the same event stream the
 * transcript reads — via `promoteRunSurfaces` and `projectRunProcesses`, so the
 * plan here and the plan in the conversation cannot drift, and a process row and
 * its output page are the same object. Sub-agents come from
 * `agent:subagent-lifecycle` through the snapshot.
 *
 * Processes deliberately do NOT come from `SessionActivitySnapshot.processes`:
 * that projection is redacted by contract ("Never carries raw argv, command,
 * cwd, or env text"), so it can list a process but never show one.
 *
 * ## Styling
 *
 * All of it is in styles/codex-session-activity.css, which resolves its colour
 * through the semantic roles in codex-tokens.css like every other panel in the
 * app. Inline Tailwind colour/spacing utilities are what made this card read as
 * foreign next to the composer menus; there are none here. Read that file's
 * header for the layout contract before adding a row.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, FilePlus2, GitBranch, GitCommitHorizontal, Loader2, RotateCcw, Target, TerminalSquare } from 'lucide-react';
import { AgentAvatar } from '@/components/agents/AgentAvatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ToolUiPlanView } from '@/components/tool-ui/plan-view';
import type { RunProcessSurface } from '@/components/tool-ui/run-surfaces';
import type { RunPlanSurface } from '@/pages/Chat/run-surface-promotion';
import { cn } from '@/lib/utils';
import { subagentIdentity } from '@shared/subagent-identity';
import { backgroundReadFailed } from '@shared/types/session-activity';
import type {
  SessionActivitySnapshot,
  SessionActivitySubagent,
} from '@shared/types/session-activity';
import type { SessionPolicyFactStatus } from '@shared/types/session-effective-policy';

type SessionActivityPanelProps = {
  snapshot: SessionActivitySnapshot;
  /** The run's plan, projected from the same events the transcript renders. */
  plan?: RunPlanSurface | null;
  /** Shell processes this run launched, running ones included. */
  processes?: RunProcessSurface[];
  compact?: boolean;
  className?: string;
  onOpenRecovery?: () => void;
  onCreateMemoryDraft?: () => void;
  /** Opens the Git review tab. */
  onOpenEnvironment?: () => void;
  /** Opens one worker's own page, keyed by its child session. */
  onOpenSubagent?: (childSessionKey: string) => void;
  /** Opens one process's own page, keyed by its launching tool call. */
  onOpenProcess?: (processId: string, command?: string) => void;
  /** Retries the host queries that produced unavailable Git/terminal status. */
  onRetryStatus?: () => void;
  showGit?: boolean;
  showCommands?: boolean;
  /** View-only row retention; transcript/resource TTLs remain owner facts. */
  activityRetentionMinutes?: 0 | 5 | 15;
};

/**
 * Five visual states, one attribute. The stylesheet owns the colours, so a new
 * runtime status cannot arrive with a hand-picked hue attached.
 */
type RowState = 'idle' | 'running' | 'ok' | 'warn' | 'error';

function rowState(status: string): RowState {
  if (status === 'running' || status === 'started' || status === 'starting') return 'running';
  if (status === 'completed' || status === 'verified' || status === 'exited') return 'ok';
  if (status === 'review' || status === 'waiting_approval' || status === 'waiting' || status === 'paused') return 'warn';
  if (status === 'failed' || status === 'error' || status === 'blocked' || status === 'aborted' || status === 'killed' || status === 'lost') return 'error';
  return 'idle';
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

/**
 * One titled group. The title sits in the gutter; actions hug the right edge.
 *
 * `title` is optional: the plan section's content is a card that already carries
 * its own header (progress ring, `n/total`, collapse chevron), and stacking the
 * panel's head on top of it produced the count twice.
 */
function Section({
  title,
  summary,
  actions,
  testId,
  children,
}: {
  title?: string;
  summary?: React.ReactNode;
  actions?: React.ReactNode;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <section className="codex-session-activity__section" data-testid={testId}>
      {title != null && (
        <div className="codex-session-activity__section-head">
          <span className="codex-session-activity__section-title">{title}</span>
          {actions
            ? <span className="codex-session-activity__section-actions">{actions}</span>
            : summary != null
              ? <span className="codex-session-activity__section-summary">{summary}</span>
              : null}
        </div>
      )}
      <div className="codex-session-activity__section-body">{children}</div>
    </section>
  );
}

/**
 * A section whose body is secondary detail — policy facts, lifecycle notes.
 *
 * Native `<details>` so the content stays in the DOM (and in the accessibility
 * tree once expanded) without the card spending a dozen rows on it by default.
 * The summary reuses the section head so a collapsed section still reads as a
 * peer of the others rather than as a footnote.
 */
function CollapsibleSection({
  title,
  summary,
  summaryState,
  testId,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: React.ReactNode;
  summaryState?: RowState;
  testId: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      className="codex-session-activity__section codex-session-activity__collapsible"
      data-testid={testId}
      open={defaultOpen || undefined}
    >
      <summary className="codex-session-activity__section-head is-toggle" data-testid={`${testId}-toggle`}>
        <ChevronRight className="codex-session-activity__collapse-icon h-3 w-3" aria-hidden="true" />
        <span className="codex-session-activity__section-title">{title}</span>
        {summary != null ? (
          <span className="codex-session-activity__section-summary" data-state={summaryState}>{summary}</span>
        ) : null}
      </summary>
      <div className="codex-session-activity__section-body">{children}</div>
    </details>
  );
}

/**
 * One row. `onOpen` makes it a button; the trailing chevron column exists either
 * way so values keep a single right edge across sections.
 */
function Row({
  icon,
  label,
  sublabel,
  value,
  state,
  tall,
  stacked,
  title,
  onOpen,
  testId,
}: {
  icon?: React.ReactNode;
  label: React.ReactNode;
  sublabel?: React.ReactNode;
  value?: React.ReactNode;
  state?: RowState;
  tall?: boolean;
  stacked?: boolean;
  title?: string;
  onOpen?: () => void;
  testId?: string;
}) {
  const body = (
    <>
      <span className="codex-session-activity__row-icon">{icon}</span>
      {sublabel != null ? (
        <span className="codex-session-activity__row-stack">
          <span className="codex-session-activity__row-label">{label}</span>
          <span className="codex-session-activity__row-sublabel">{sublabel}</span>
        </span>
      ) : (
        <span className="codex-session-activity__row-label">{label}</span>
      )}
      <span className="codex-session-activity__row-value" data-state={state}>{value}</span>
      <span className="codex-session-activity__row-trail">
        {onOpen ? <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /> : null}
      </span>
    </>
  );
  const className = cn(
    'codex-session-activity__row',
    tall && 'is-tall',
    stacked && 'is-stacked',
    onOpen && 'is-interactive',
  );
  if (!onOpen) {
    return <div className={className} data-testid={testId} title={title}>{body}</div>;
  }
  return (
    <button type="button" className={className} onClick={onOpen} data-testid={testId} title={title}>
      {body}
    </button>
  );
}

function HeaderAction({
  label,
  icon,
  onClick,
  testId,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  testId: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="codex-session-activity__action"
          aria-label={label}
          onClick={onClick}
          data-testid={testId}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" collisionPadding={8}>{label}</TooltipContent>
    </Tooltip>
  );
}

function PolicyNote({
  title,
  body,
  testId,
}: {
  title: string;
  body: string;
  testId: string;
}) {
  return (
    <div className="codex-session-activity__policy-note" data-testid={testId}>
      <span className="codex-session-activity__policy-note-title">{title}</span>
      <span className="codex-session-activity__policy-note-body">{body}</span>
    </div>
  );
}

function subagentTestId(agent: SessionActivitySubagent): string {
  return `session-activity-subagent-${agent.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

/** The command's leading word or two — a chip label, not the whole invocation. */
function commandDigest(command: string): string {
  const compact = command.replace(/\s+/g, ' ').trim();
  return compact.length <= 42 ? compact : `${compact.slice(0, 41)}…`;
}

function policyState(status: SessionPolicyFactStatus): RowState {
  if (status === 'effective') return 'ok';
  if (status === 'configured' || status === 'ignored' || status === 'unsupported') return 'warn';
  return 'idle';
}

const POLICY_REASON_KEY_BY_VALUE: Readonly<Record<string, string>> = {
  'no-current-run-capability-profile': 'missingProfile',
  'capability-profile-outside-observation-ttl': 'staleProfile',
  'session-generation-mismatch': 'sessionMismatch',
  'run-generation-mismatch': 'runMismatch',
  'runtime-generation-unknown': 'runtimeUnknown',
  'gateway-generation-mismatch': 'gatewayMismatch',
  'capability-profile-fallback': 'profileFallback',
  'grants are owned by runtime facts': 'grantsUnavailable',
  'grants unavailable': 'grantsUnavailable',
  'no fresh context-budget observation for the current generation': 'contextUnavailable',
  'current scheduler admission was not read by this snapshot': 'resourcesUnavailable',
  'current schedule state is not part of this read': 'scheduleUnavailable',
  'no persisted queue override': 'noQueueOverride',
  'the native backend owns automatic compaction': 'nativeAutomaticCompaction',
  'provider selection belongs to the native transcript backend': 'nativeProvider',
  'model selection belongs to the native transcript backend': 'nativeModel',
  'manual compaction routes through the native backend': 'nativeManualCompaction',
  'native compaction does not consume OpenClaw reserve-token arguments': 'nativeReserveTokens',
  'runtime backend is not registered or its compaction ownership is unknown': 'runtimeCompactionUnknown',
};

const POLICY_PARAMETER_KEY_BY_VALUE: Readonly<Record<string, string>> = {
  'automatic-compaction': 'automaticCompaction',
  'manual-compaction': 'manualCompaction',
  'compaction.provider': 'provider',
  'compaction.model': 'model',
  'compaction.reserveTokens': 'reserveTokens',
};

const POLICY_ACTION_KEY_BY_VALUE: Readonly<Record<string, string>> = {
  exec: 'exec',
  read: 'read',
  write: 'write',
  browser: 'browser',
};

const POLICY_AUTHORIZATION_KEY_BY_VALUE: Readonly<Record<string, string>> = {
  allowed: 'allowed',
  'requires-approval': 'requiresApproval',
  denied: 'denied',
  'not-applicable': 'notApplicable',
  unknown: 'unknown',
};

export function SessionActivityPanel({
  snapshot,
  plan,
  processes = [],
  compact = false,
  className,
  onOpenRecovery,
  onCreateMemoryDraft,
  onOpenEnvironment,
  onOpenSubagent,
  onOpenProcess,
  onRetryStatus,
  showGit = true,
  showCommands = true,
  activityRetentionMinutes = 5,
}: SessionActivityPanelProps) {
  const { t } = useTranslation('chat');

  const git = showGit ? snapshot.git : null;
  const hasGit = Boolean(git && git.isRepository);
  const hasPlan = (plan?.todos.length ?? 0) > 0;
  const hasSubagents = snapshot.subagents.length > 0;
  const visibleProcesses = useMemo(
    () => (showCommands ? processes : []),
    [processes, showCommands],
  );
  /**
   * Host-projected processes with no runtime counterpart.
   *
   * When both sources describe the same process the runtime row wins: it carries
   * the real command and can open its output, where the snapshot row is redacted
   * by contract. Keyed by id, which both sides derive from the launching call.
   */
  const snapshotOnlyProcesses = useMemo(() => {
    if (!showCommands) return [];
    const runtimeIds = new Set(visibleProcesses.map((entry) => entry.id));
    return snapshot.processes.filter((entry) => !runtimeIds.has(entry.id));
  }, [showCommands, snapshot.processes, visibleProcesses]);
  const hasProcesses = visibleProcesses.length > 0 || snapshotOnlyProcesses.length > 0;
  const policy = snapshot.policy;
  const configuredBackend = policy?.backend.configured;
  const effectiveBackend = policy?.backend.effective;
  const configuredHarness = policy?.harness?.configured;
  const effectiveHarness = policy?.harness?.effective;
  const configuredModel = policy?.model.configured;
  const effectiveModel = policy?.model.effective;
  const grantSummary = policy?.grants.effective.value;
  const grantActions = grantSummary?.actions ?? [];
  const retentionLabel = t(`sessionActivity.policy.retention.${activityRetentionMinutes}`);
  const policyReason = (reason: string | null | undefined): string | null => {
    if (!reason) return null;
    const key = POLICY_REASON_KEY_BY_VALUE[reason];
    return key
      ? t(`sessionActivity.policy.reasons.${key}`, { defaultValue: reason })
      : reason;
  };
  const policyParameter = (parameter: string): string => {
    const key = POLICY_PARAMETER_KEY_BY_VALUE[parameter];
    return key
      ? t(`sessionActivity.policy.parameters.${key}`, { defaultValue: parameter })
      : parameter;
  };
  const grantActionLabel = (actionId: string): string => {
    const key = POLICY_ACTION_KEY_BY_VALUE[actionId];
    return key
      ? t(`sessionActivity.policy.grantActions.${key}`, { defaultValue: actionId })
      : actionId;
  };
  const authorizationLabel = (authorization: string): string => {
    const key = POLICY_AUTHORIZATION_KEY_BY_VALUE[authorization];
    return key
      ? t(`sessionActivity.policy.authorization.${key}`, { defaultValue: authorization })
      : authorization;
  };
  const configuredContextValue = policy?.context.configured.value?.contextTokens
    ? t('sessionActivity.policy.tokens', { count: policy.context.configured.value.contextTokens })
    : t(`sessionActivity.policy.status.${policy?.context.configured.status ?? 'unverified'}`);
  const effectiveContextValue = policy?.context.effective.value?.contextTokens
    ? t('sessionActivity.policy.tokens', { count: policy.context.effective.value.contextTokens })
    : t(`sessionActivity.policy.status.${policy?.context.effective.status ?? 'unverified'}`);
  const configuredQueueValue = [
    policy?.queue.configured.value?.mode,
    policy?.queue.configured.value?.cap != null
      ? t('sessionActivity.policy.queueCap', { count: policy.queue.configured.value.cap })
      : null,
  ].filter(Boolean).join(' · ') || t('sessionActivity.policy.notReported');
  const effectiveQueueValue = t('sessionActivity.policy.queueValue', {
    mode: policy?.queue.effective.value?.mode ?? t('sessionActivity.policy.notReported'),
    count: policy?.queue.effective.value?.queuedCount ?? 0,
  });
  const unverifiedFacts = policy ? [
    { label: t('sessionActivity.policy.effectiveBackend'), reason: effectiveBackend?.reason },
    { label: t('sessionActivity.policy.harness'), reason: effectiveHarness?.reason },
    { label: t('sessionActivity.policy.effort'), reason: effectiveModel?.reason },
    { label: t('sessionActivity.policy.context'), reason: policy.context.effective.reason },
    { label: t('sessionActivity.policy.actions'), reason: policy.grants.effective.reason },
    { label: t('sessionActivity.policy.queue'), reason: policy.queue.effective.reason },
    { label: t('sessionActivity.policy.resources'), reason: policy.resources.effective.reason },
    { label: t('sessionActivity.policy.schedule'), reason: policy.schedule.effective.reason },
  ].filter((fact) => Boolean(fact.reason)) : [];

  /* The recovery affordance is not a section — it is an action on the card. It
   * appears only when there is something to recover, which is the same signal
   * that used to gate a Continuity section nobody asked for. */
  const hasContinuity = snapshot.continuity.queueCount > 0
    || Boolean(snapshot.continuity.contextPressure && snapshot.continuity.contextPressure !== 'low')
    || Boolean(snapshot.continuity.checkpoint)
    || Boolean(snapshot.continuity.blockedReason);
  const availabilityErrors = [
    showGit && !snapshot.availability.git ? t('sessionRail.git.unavailable') : null,
    showCommands && !snapshot.availability.terminals ? t('sessionRail.terminal.unavailable') : null,
  ].filter(Boolean);
  /**
   * "The background read failed" is not "there is no background activity".
   *
   * Without an alert for it, a failed first read renders as an empty card —
   * and because an empty card has no content the panel would not even mount,
   * so the user never learns that the status is unknown rather than idle. The
   * warning deliberately comes from `backgroundReadFailed`, not from
   * `state === 'unknown'`: a snapshot that has not been read yet is unknown
   * too, and warning about it would fire on every first paint.
   */
  const backgroundUnknown = backgroundReadFailed(snapshot.backgroundRead);
  /* A failed read after a good one keeps its rows; say that they are old. */
  const backgroundStale = backgroundUnknown && snapshot.backgroundRead.readAt != null;
  const alert = [snapshot.session.error, snapshot.continuity.blockedReason, ...availabilityErrors]
    .filter(Boolean)
    .join(' · ') || null;

  const gitStats = useMemo(() => {
    if (!git) return null;
    return {
      changes: git.changes.length,
      additions: git.changes.reduce((sum, change) => sum + (change.additions ?? 0), 0),
      deletions: git.changes.reduce((sum, change) => sum + (change.deletions ?? 0), 0),
    };
  }, [git]);

  const runningSubagents = snapshot.subagents.filter((agent) => agent.status === 'started').length;
  const runningProcesses = visibleProcesses.filter((entry) => entry.status === 'running').length;
  const runningTotal = runningSubagents + runningProcesses;

  if (!hasGit && !hasPlan && !hasSubagents && !hasProcesses && !policy
    && snapshot.goals.length === 0 && snapshot.lineage.length === 0 && !alert && !backgroundUnknown) return null;

  return (
    <aside
      className={cn('codex-session-activity', className)}
      data-testid="session-activity-panel"
      aria-label={t('sessionActivity.title')}
    >
      <div className={cn('codex-session-activity__body', compact && 'is-scrollable')}>
        {/* ── Head ───────────────────────────────────────────────────────
         * Title, a live "n running" pill, and the card-level actions. The
         * actions used to live on the Git section head, so a session outside a
         * repository could never reach recovery or the memory draft. */}
        <header className="codex-session-activity__head">
          <span className="codex-session-activity__head-title">{t('sessionActivity.title')}</span>
          {runningTotal > 0 ? (
            <span className="codex-session-activity__pill" data-state="running" data-testid="session-activity-running">
              <span className="codex-session-activity__pulse" aria-hidden="true" />
              {t('sessionActivity.runningCount', { count: runningTotal })}
            </span>
          ) : null}
          <span className="codex-session-activity__section-actions">
            {onCreateMemoryDraft ? (
              <HeaderAction
                label={t('sessionActivity.createMemoryDraft')}
                icon={<FilePlus2 className="h-3.5 w-3.5" />}
                onClick={onCreateMemoryDraft}
                testId="session-activity-create-memory-draft"
              />
            ) : null}
            {onOpenRecovery && hasContinuity ? (
              <HeaderAction
                label={t('sessionActivity.openRecovery')}
                icon={<RotateCcw className="h-3.5 w-3.5" />}
                onClick={onOpenRecovery}
                testId="session-activity-open-recovery"
              />
            ) : null}
          </span>
        </header>

        {alert || backgroundUnknown ? (
          <div className="codex-session-activity__alerts" role="status">
            {/* A failure must not be silently dropped just because it has no section
             * of its own. It leads the card — a scrolled-away error is a hidden one —
             * and it only renders when present, so a healthy run has no empty slot. */}
            {alert ? (
              <p className="codex-session-activity__empty" data-state="error" data-testid="session-activity-alert">
                {alert}
              </p>
            ) : null}
            {backgroundUnknown ? (
              <p
                className="codex-session-activity__empty"
                data-state="error"
                data-testid="session-activity-background-unknown"
              >
                {t('sessionActivity.background.unknown')}
              </p>
            ) : null}
            {backgroundStale ? (
              <p
                className="codex-session-activity__empty"
                data-state="warn"
                data-testid="session-activity-background-stale"
              >
                {t('sessionActivity.background.stale')}
              </p>
            ) : null}
            {(availabilityErrors.length > 0 || backgroundUnknown) && onRetryStatus ? (
              <button
                type="button"
                className="codex-session-activity__retry"
                onClick={onRetryStatus}
                data-testid="session-activity-retry"
              >
                {t('retry')}
              </button>
            ) : null}
          </div>
        ) : null}

        {/* ── 环境 ─────────────────────────────────────────────────────── */}
        {hasGit && gitStats ? (
          <Section
            title={t('sessionActivity.sections.environment')}
            testId="session-activity-environment"
            summary={git?.hasConflicts ? t('sessionActivity.git.conflicts') : undefined}
          >
            <Row
              icon={<GitBranch className="h-3.5 w-3.5" aria-hidden="true" />}
              label={(
                <span className="codex-session-activity__mono">
                  {git?.branch ?? t('sessionActivity.git.detached')}
                </span>
              )}
              title={git?.branch ?? t('sessionActivity.git.detached')}
              value={git?.clean
                ? t('sessionActivity.git.clean')
                : t('sessionActivity.git.changes', { count: gitStats.changes })}
              state={git?.hasConflicts ? 'error' : 'idle'}
              onOpen={onOpenEnvironment}
              testId="session-activity-git-branch"
            />
            {!git?.clean ? (
              <Row
                icon={<GitCommitHorizontal className="h-3.5 w-3.5" aria-hidden="true" />}
                label={(
                  <span className="codex-session-activity__delta">
                    <span className="codex-session-activity__delta-add">+{formatCount(gitStats.additions)}</span>
                    <span className="codex-session-activity__delta-remove">−{formatCount(gitStats.deletions)}</span>
                  </span>
                )}
                value={git?.hasConflicts ? t('sessionActivity.git.conflicts') : undefined}
                state={git?.hasConflicts ? 'error' : undefined}
                onOpen={onOpenEnvironment}
                testId="session-activity-git-delta"
              />
            ) : null}
          </Section>
        ) : null}

        {/* ── 开发任务 ─────────────────────────────────────────────────── */}
        {hasPlan && plan ? (
          <Section testId="session-activity-plan">
            <div className="codex-session-activity__plan">
              {/* The shared task list, not a second copy of it: the transcript
               * renders the same component from the same projection. It brings
               * its own header — progress ring, `n/total`, collapse chevron —
               * which is why this section supplies no head of its own. */}
              <ToolUiPlanView
                title={t('sessionActivity.sections.plan')}
                todos={plan.todos}
                maxVisibleTodos={6}
                compact
                showTitle
                testId="session-activity-plan-view"
              />
            </div>
          </Section>
        ) : null}

        {/* ── 子 Agent ─────────────────────────────────────────────────── */}
        {hasSubagents ? (
          <Section
            title={t('sessionActivity.sections.subagents')}
            summary={runningSubagents > 0
              ? t('sessionActivity.runningCount', { count: runningSubagents })
              : formatCount(snapshot.subagents.length)}
            testId="session-activity-subagents"
          >
            {snapshot.subagents.slice(-6).map((agent) => {
              const childSessionKey = agent.childSessionKey;
              const identity = subagentIdentity(childSessionKey ?? agent.agentId ?? agent.id);
              const state = rowState(agent.status);
              return (
                <Row
                  key={agent.id}
                  tall
                  testId={subagentTestId(agent)}
                  icon={(
                    <AgentAvatar
                      agentId={identity.avatarId}
                      name={identity.name}
                      avatar={identity.avatar}
                      size={24}
                    />
                  )}
                  label={identity.name}
                  sublabel={[agent.role ?? t('sessionActivity.subagents.unknown'), agent.task]
                    .filter(Boolean)
                    .join(' · ')}
                  value={agent.status === 'started'
                    ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                    : t(`sessionActivity.subagentStatus.${agent.status}`, { defaultValue: agent.status })}
                  state={state}
                  title={childSessionKey
                    ? t('sessionActivity.subagents.openTranscript', { role: identity.name })
                    : agent.task || identity.name}
                  onOpen={childSessionKey && onOpenSubagent
                    ? () => onOpenSubagent(childSessionKey)
                    : undefined}
                />
              );
            })}
          </Section>
        ) : null}

        {/* ── 进程 ─────────────────────────────────────────────────────── */}
        {hasProcesses ? (
          <Section
            title={t('sessionActivity.sections.processes')}
            summary={runningProcesses > 0
              ? t('sessionActivity.runningCount', { count: runningProcesses })
              : formatCount(visibleProcesses.length + snapshotOnlyProcesses.length)}
            testId="session-activity-processes"
          >
            {visibleProcesses.slice(-6).map((entry) => (
              <Row
                key={entry.id}
                testId={`session-activity-process-${entry.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`}
                icon={<TerminalSquare className="h-3.5 w-3.5" aria-hidden="true" />}
                label={<span className="codex-session-activity__mono">{commandDigest(entry.command)}</span>}
                value={entry.status === 'running'
                  ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  : entry.exitCode != null
                    ? t('processPanel.exitCode', { code: entry.exitCode })
                    : t(`processPanel.status.${entry.status}`)}
                state={rowState(entry.status)}
                title={onOpenProcess
                  ? t('sessionActivity.processes.openOutput', { command: entry.command })
                  : entry.command}
                onOpen={onOpenProcess ? () => onOpenProcess(entry.id, entry.command) : undefined}
              />
            ))}
            {/* Host-projected processes. Deliberately INERT: this projection is
             * redacted by contract, so the row can report that a process exists
             * but there is no output behind it to open. Offering a chevron here
             * would promise a pane that cannot be filled. */}
            {snapshotOnlyProcesses.slice(-6).map((entry) => (
              <Row
                key={entry.id}
                testId={`session-activity-snapshot-process-${entry.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`}
                icon={<TerminalSquare className="h-3.5 w-3.5" aria-hidden="true" />}
                label={`${t(`sessionActivity.processKinds.${entry.kind}`, { defaultValue: entry.kind })} ${entry.label}`}
                sublabel={entry.digest}
                value={t(`sessionActivity.processStatus.${entry.status}`, { defaultValue: entry.status })}
                state={rowState(entry.status)}
                title={entry.pid != null ? `PID ${entry.pid}` : entry.label}
              />
            ))}
          </Section>
        ) : null}

        {/* ── Host-projected read models ────────────────────────────────────
         *
         * Goals and lineage come from the host's own session projection and have
         * no runtime counterpart to open, so both are read-only like the
         * snapshot processes above. They appear only when the host supplies
         * them, which is why they are below the four sections the card is
         * organised around rather than interleaved with them. */}
        {snapshot.goals.length > 0 ? (
          <Section
            title={t('sessionActivity.sections.goals')}
            summary={formatCount(snapshot.goals.length)}
            testId="session-activity-goals"
          >
            {snapshot.goals.slice(-6).map((goal) => (
              <Row
                key={goal.id}
                testId={`session-activity-goal-${goal.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`}
                icon={<Target className="h-3.5 w-3.5" aria-hidden="true" />}
                label={`${t(`sessionActivity.goalKinds.${goal.kind}`, { defaultValue: goal.kind })} ${goal.label}`}
                sublabel={goal.digest}
                value={t(`sessionActivity.goalStatus.${goal.status}`, { defaultValue: goal.status })}
                state={rowState(goal.status)}
              />
            ))}
          </Section>
        ) : null}

        {snapshot.lineage.length > 0 ? (
          <Section
            title={t('sessionActivity.sections.lineage')}
            summary={formatCount(snapshot.lineage.length)}
            testId="session-activity-lineage"
          >
            {snapshot.lineage.slice(-6).map((entry) => (
              <Row
                key={entry.id}
                testId={`session-activity-lineage-${entry.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`}
                icon={<GitBranch className="h-3.5 w-3.5" aria-hidden="true" />}
                label={entry.role ?? t(`sessionActivity.lineage.${entry.kind}`, { defaultValue: entry.kind })}
                sublabel={t(`sessionActivity.lineage.${entry.kind}`, { defaultValue: entry.kind })}
                value={t(`sessionActivity.lineageStatus.${entry.status}`, { defaultValue: entry.status })}
                state={rowState(entry.status)}
                title={entry.sessionKey}
              />
            ))}
          </Section>
        ) : null}

        {/* ── 运行策略 / 生命周期边界 ─────────────────────────────────────
         * Reference detail, not live state: collapsed by default and last, so
         * it can no longer push the processes section below the fold. */}
        {policy ? (
          <CollapsibleSection
            title={t('sessionActivity.sections.policy')}
            testId="session-activity-policy"
            summary={t(`sessionActivity.policy.generation.${policy.generation.state}`, {
              defaultValue: policy.generation.state,
            })}
            summaryState={policy.generation.state === 'effective' ? 'ok' : 'warn'}
          >
            <Row
              testId="session-activity-policy-backend"
              stacked
              label={t('sessionActivity.policy.backend')}
              sublabel={`${t(`sessionActivity.policy.status.${configuredBackend?.status ?? 'unverified'}`)} · ${configuredBackend?.source ?? t('sessionActivity.policy.notReported')}`}
              value={configuredBackend?.value
                ? [configuredBackend.value.runtime, configuredBackend.value.provider, configuredBackend.value.model].filter(Boolean).join(' · ')
                : t('sessionActivity.policy.notReported')}
              state={configuredBackend ? policyState(configuredBackend.status) : 'idle'}
            />
            <Row
              testId="session-activity-policy-harness"
              stacked
              label={t('sessionActivity.policy.harness')}
              sublabel={[
                configuredHarness?.source,
                policyReason(effectiveHarness?.reason ?? null) ?? t('sessionActivity.policy.currentRunObservation'),
              ].filter(Boolean).join(' · ')}
              value={[
                configuredHarness?.value?.id,
                effectiveHarness?.value?.id ?? t(`sessionActivity.policy.status.${effectiveHarness?.status ?? 'unverified'}`),
              ].filter(Boolean).join(' → ') || t('sessionActivity.policy.notReported')}
              state={effectiveHarness?.status === 'effective' ? 'ok' : effectiveHarness ? 'warn' : 'idle'}
            />
            <Row
              testId="session-activity-policy-effective"
              stacked
              label={t('sessionActivity.policy.effectiveBackend')}
              sublabel={policyReason(effectiveBackend?.reason ?? null) ?? t('sessionActivity.policy.currentRunObservation')}
              value={effectiveBackend?.value
                ? [effectiveBackend.value.runtime, effectiveBackend.value.provider, effectiveBackend.value.model].filter(Boolean).join(' · ')
                : t(`sessionActivity.policy.status.${effectiveBackend?.status ?? 'unverified'}`)}
              state={effectiveBackend ? policyState(effectiveBackend.status) : 'idle'}
            />
            <Row
              testId="session-activity-policy-effort"
              stacked
              label={t('sessionActivity.policy.effort')}
              sublabel={[configuredModel?.source, policyReason(effectiveModel?.reason ?? null)].filter(Boolean).join(' · ')}
              value={[configuredModel?.value?.effort, effectiveModel?.value?.effort].filter(Boolean).join(' → ') || t('sessionActivity.policy.notReported')}
              state={effectiveModel?.status === 'effective' ? 'ok' : 'warn'}
            />
            <Row
              testId="session-activity-policy-context"
              stacked
              label={t('sessionActivity.policy.context')}
              sublabel={[policy.context.configured.source, policy.context.effective.source, policyReason(policy.context.effective.reason)].filter(Boolean).join(' · ')}
              value={`${configuredContextValue} → ${effectiveContextValue}`}
              state={policyState(policy.context.effective.status)}
            />
            <Row
              testId="session-activity-policy-actions"
              stacked
              label={t('sessionActivity.policy.actions')}
              sublabel={policy.grants.effective.reason
                ? policyReason(policy.grants.effective.reason)
                : t('sessionActivity.policy.actionCount', { count: grantSummary?.total ?? 0 })}
              value={grantSummary
                ? t('sessionActivity.policy.actionSummary', {
                    allowed: grantSummary.allowed,
                    approval: grantSummary.requiresApproval,
                    denied: grantSummary.denied,
                    unknown: grantSummary.unknown,
                  })
                : t(`sessionActivity.policy.status.${policy.grants.effective.status}`)}
              state={policyState(policy.grants.effective.status)}
            />
            {grantActions.length > 0 ? (
              <details className="codex-session-activity__policy-details" data-testid="session-activity-policy-action-details">
                <summary>{t('sessionActivity.policy.showActions')}</summary>
                <div className="codex-session-activity__policy-detail-body">
                  {grantActions.map((action) => (
                    <div className="codex-session-activity__policy-detail-row" key={action.actionId}>
                      <span>{grantActionLabel(action.actionId)}</span>
                      <span data-state={action.authorization === 'allowed'
                        ? 'ok'
                        : action.authorization === 'denied'
                          ? 'error'
                          : action.authorization === 'unknown'
                            ? 'idle'
                            : 'warn'}>
                        {authorizationLabel(action.authorization)}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
            <Row
              testId="session-activity-policy-queue"
              stacked
              label={t('sessionActivity.policy.queue')}
              sublabel={policyReason(policy.queue.effective.reason) ?? policy.queue.effective.source}
              value={`${configuredQueueValue} → ${effectiveQueueValue}`}
              state={policyState(policy.queue.effective.status)}
            />
            <Row
              testId="session-activity-policy-resources"
              stacked
              label={t('sessionActivity.policy.resources')}
              sublabel={policyReason(policy.resources.effective.reason)}
              value={t(`sessionActivity.policy.status.${policy.resources.effective.status}`)}
              state={policyState(policy.resources.effective.status)}
            />
            <Row
              testId="session-activity-policy-schedule"
              stacked
              label={t('sessionActivity.policy.schedule')}
              sublabel={policyReason(policy.schedule.effective.reason)}
              value={t(`sessionActivity.policy.status.${policy.schedule.effective.status}`)}
              state={policyState(policy.schedule.effective.status)}
            />
            <details className="codex-session-activity__policy-details" data-testid="session-activity-policy-details">
              <summary>{t('sessionActivity.policy.showDetails')}</summary>
              <div className="codex-session-activity__policy-detail-body">
                <div className="codex-session-activity__policy-detail-heading">{t('sessionActivity.policy.sources')}</div>
                <ul className="codex-session-activity__policy-source-list" data-testid="session-activity-policy-sources">
                  {policy.sources.map((source) => <li key={source}>{source}</li>)}
                </ul>
                {policy.generation.reason ? (
                  <div className="codex-session-activity__policy-detail-row">
                    <span>{t('sessionActivity.policy.generationReason')}</span>
                    <span>{policyReason(policy.generation.reason)}</span>
                  </div>
                ) : null}
                {unverifiedFacts.length > 0 ? (
                  <>
                    <div className="codex-session-activity__policy-detail-heading">{t('sessionActivity.policy.unverifiedFacts')}</div>
                    <div data-testid="session-activity-policy-unverified-facts">
                      {unverifiedFacts.map((fact) => (
                        <div className="codex-session-activity__policy-detail-row is-multiline" key={fact.label}>
                          <span>{fact.label}</span>
                          <span data-state="idle">{t('sessionActivity.policy.status.unverified')}</span>
                          <p>{policyReason(fact.reason)}</p>
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
                <div className="codex-session-activity__policy-detail-heading">{t('sessionActivity.policy.compatibility')}</div>
                <div data-testid="session-activity-policy-compatibility">
                  {policy.compatibility.map((row) => (
                    <div className="codex-session-activity__policy-detail-row is-multiline" key={`${row.backend}:${row.parameter}`}>
                      <span>{policyParameter(row.parameter)}</span>
                      <span data-state={policyState(row.status)}>{t(`sessionActivity.policy.status.${row.status}`)}</span>
                      {policyReason(row.reason) ? <p>{policyReason(row.reason)}</p> : null}
                    </div>
                  ))}
                </div>
              </div>
            </details>
          </CollapsibleSection>
        ) : null}

        {policy ? (
          <CollapsibleSection
            title={t('sessionActivity.policy.boundaries.title')}
            testId="session-activity-policy-boundaries"
          >
            <PolicyNote
              title={t('sessionActivity.policy.boundaries.abort.title')}
              body={t('sessionActivity.policy.boundaries.abort.description')}
              testId="session-activity-boundary-abort"
            />
            <PolicyNote
              title={t('sessionActivity.policy.boundaries.stop.title')}
              body={t('sessionActivity.policy.boundaries.stop.description')}
              testId="session-activity-boundary-stop"
            />
            <PolicyNote
              title={t('sessionActivity.policy.boundaries.activity.title')}
              body={t('sessionActivity.policy.boundaries.activity.description', { retention: retentionLabel })}
              testId="session-activity-boundary-activity"
            />
            <PolicyNote
              title={t('sessionActivity.policy.boundaries.fork.title')}
              body={t('sessionActivity.policy.boundaries.fork.description')}
              testId="session-activity-boundary-fork"
            />
          </CollapsibleSection>
        ) : null}

      </div>
    </aside>
  );
}
