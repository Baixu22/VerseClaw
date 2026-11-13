/**
 * Session environment: changes, observed sources, plan, workers and processes.
 * Runtime calls and the host snapshot supply the same facts used by the chat.
 * Compact previews disclose detail on demand; policy and lineage stay secondary.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, ChevronRight, FilePlus2, FolderGit2, FolderOpen, GitBranch, GitCommitHorizontal, PanelRightOpen, Plug, RotateCcw, Target, TerminalSquare } from 'lucide-react';
import { X } from '@/components/icons/codex-icons';
import { AgentAvatar } from '@/components/agents/AgentAvatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ToolUiPlanView } from '@/components/tool-ui/plan-view';
import type { RunProcessSurface } from '@/components/tool-ui/run-surfaces';
import type { RunPlanSurface } from '@/pages/Chat/run-surface-promotion';
import { cn } from '@/lib/utils';
import { OrbStatus, type OrbStatusState } from '@/components/assistant-ui/orb-status';
import { hostApi } from '@/lib/host-api';
import { isLinkedWorktreePath, pathEquals } from '@/lib/git-ui';
import { subagentIdentity } from '@shared/subagent-identity';
import { backgroundReadFailed } from '@shared/types/session-activity';
import type {
  SessionActivitySnapshot,
  SessionActivitySubagent,
} from '@shared/types/session-activity';
import type { SessionPolicyFactStatus } from '@shared/types/session-effective-policy';
import type { SessionEnvironmentSource } from './session-environment';

type SessionActivityPanelProps = {
  snapshot: SessionActivitySnapshot;
  /** The run's plan, projected from the same events the transcript renders. */
  plan?: RunPlanSurface | null;
  /** Shell processes this run launched, running ones included. */
  processes?: RunProcessSurface[];
  sources?: SessionEnvironmentSource[];
  workspaceName?: string;
  onClose?: () => void;
  /** The card can receive live sources before its first host snapshot. */
  statusPending?: boolean;
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
  /** The workspace tab currently on screen, so the matching row can mark itself. */
  activeWorkspaceSubject?: ActiveWorkspaceSubject | null;
  /**
   * Context-window reading for the Context row: the same `LiveTokenUsage` /
   * `WorkspaceContextRange` facts the composer's pressure readout resolves.
   * Absent or unmeasured → the row is not drawn (no invented percentage).
   */
  context?: SessionContextUsage | null;
};

export type SessionContextUsage = {
  usedTokens: number | null;
  maxTokens: number | null;
  utilisation: number | null;
  cacheReadTokens?: number | null;
  warmTurnHitRate?: number | null;
};

export type ActiveWorkspaceSubject =
  | { kind: 'process' | 'subagent'; subject: string }
  | { kind: 'review' };

const PROCESS_PREVIEW_LINES = 8;

function outputTail(output: string): string {
  const lines = output.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  return lines.slice(-PROCESS_PREVIEW_LINES).join('\n');
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(value));
}

/** "12s", "4m", "1h 5m" — the elapsed figure a running background row carries. */
function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
}

/**
 * Five visual states, one attribute. The stylesheet owns the colours, so a new
 * runtime status cannot arrive with a hand-picked hue attached.
 */
type RowState = 'idle' | 'running' | 'ok' | 'warn' | 'error';

/** Row states drawn with the session list's own status glyph. */
const ROW_ORB: Record<RowState, OrbStatusState> = {
  running: 'streaming',
  ok: 'success',
  warn: 'waiting',
  error: 'error',
  idle: 'idle',
};

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
  active,
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
  active?: boolean;
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
    active && 'is-active',
  );
  if (!onOpen) {
    return <div className={className} data-testid={testId} title={title}>{body}</div>;
  }
  return (
    <button type="button" className={className} onClick={onOpen} data-testid={testId} title={title} aria-current={active || undefined}>
      {body}
    </button>
  );
}

/**
 * A process as a small console: the head row toggles a live tail of its output
 * in place, and a separate action opens the full page in the workspace.
 */
/** A one-second clock that ticks only while `active`; render stays pure. */
function useRunningClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function ProcessItem({
  entry,
  expanded,
  active,
  onToggle,
  onOpenInWorkspace,
}: {
  entry: RunProcessSurface;
  expanded: boolean;
  active: boolean;
  onToggle: () => void;
  onOpenInWorkspace?: () => void;
}) {
  const { t } = useTranslation('chat');
  const state = rowState(entry.status);
  const safeId = entry.id.replace(/[^a-zA-Z0-9_-]/g, '-');
  const tail = expanded ? outputTail(entry.output) : '';
  const now = useRunningClock(entry.status === 'running' && entry.startedAt != null);
  const meta = [
    entry.cwd,
    entry.durationMs != null ? t('sessionActivity.processes.duration', { seconds: (entry.durationMs / 1000).toFixed(1) }) : null,
  ].filter(Boolean).join(' · ');
  return (
    <div
      className={cn('codex-session-activity__process', expanded && 'is-expanded', active && 'is-active')}
      data-state={state}
      data-testid={`session-activity-process-${safeId}`}
    >
      <div className="codex-session-activity__process-head">
        <button
          type="button"
          className="codex-session-activity__process-toggle"
          onClick={onToggle}
          aria-expanded={expanded}
          title={expanded ? t('sessionActivity.processes.hideOutput') : t('sessionActivity.processes.showOutput')}
          data-testid={`session-activity-process-toggle-${safeId}`}
        >
          <OrbStatus state={ROW_ORB[state]} label={t(`processPanel.status.${entry.status}`, { defaultValue: entry.status })}
            className="codex-session-activity__process-dot size-3.5" />
          <span className="codex-session-activity__process-command" title={entry.command}>
            {commandDigest(entry.command)}
          </span>
          <span className="codex-session-activity__row-value" data-state={state}>
            {entry.status === 'running'
              ? (
                <span className="codex-session-activity__elapsed">
                  {entry.startedAt != null
                    ? <span data-testid={`session-activity-process-elapsed-${safeId}`}>{formatElapsed(now - entry.startedAt)}</span>
                    : t('processPanel.status.running')}
                </span>
              )
              : entry.exitCode != null && entry.exitCode !== 0
                ? t('processPanel.exitCode', { code: entry.exitCode })
                : t(`processPanel.status.${entry.status}`)}
          </span>
          <ChevronRight className="codex-session-activity__collapse-icon h-3 w-3" aria-hidden="true" />
        </button>
        {onOpenInWorkspace ? (
          <button
            type="button"
            className="codex-session-activity__action"
            aria-label={active ? t('sessionActivity.processes.inWorkspace') : t('sessionActivity.processes.openInWorkspace')}
            title={active ? t('sessionActivity.processes.inWorkspace') : t('sessionActivity.processes.openInWorkspace')}
            aria-pressed={active}
            onClick={onOpenInWorkspace}
            data-testid={`session-activity-process-open-${safeId}`}
          >
            <PanelRightOpen className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {expanded ? (
        <div className="codex-session-activity__console" data-testid={`session-activity-process-output-${safeId}`}>
          <pre className="codex-session-activity__console-output">
            {tail || <span className="codex-session-activity__console-empty">{t('sessionActivity.processes.noOutput')}</span>}
          </pre>
          {meta ? <div className="codex-session-activity__console-meta" title={meta}>{meta}</div> : null}
        </div>
      ) : null}
    </div>
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

/** Keep the first three rows readable; the remaining rows stay keyboard-accessible. */
function PreviewRows({ children, testId }: { children: React.ReactNode[]; testId: string }) {
  const { t } = useTranslation('chat');
  return <>
    {children.slice(0, 3)}
    {children.length > 3 && (
      <details className="codex-session-activity__recent" data-testid={testId}>
        <summary>
          <ChevronRight className="size-3 shrink-0" aria-hidden="true" />
          {t('sessionActivity.moreRows', { count: children.length - 3 })}
        </summary>
        <div className="codex-session-activity__overflow" tabIndex={0}>{children.slice(3)}</div>
      </details>
    )}
  </>;
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
  sources = [],
  workspaceName,
  onClose,
  statusPending = false,
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
  activeWorkspaceSubject = null,
  context = null,
}: SessionActivityPanelProps) {
  const { t } = useTranslation('chat');
  /* `undefined` = the user has not chosen yet, so the newest running process is open. */
  const [expandedProcessId, setExpandedProcessId] = useState<string | null | undefined>(undefined);
  const isActiveSubject = (kind: 'process' | 'subagent', subject: string) =>
    activeWorkspaceSubject?.kind === kind && activeWorkspaceSubject.subject === subject;
  const reviewActive = activeWorkspaceSubject?.kind === 'review';

  const git = showGit ? snapshot.git : null;
  const repoRoot = git?.isRepository ? git.repoRoot : undefined;
  const [checkout, setCheckout] = useState<{ root: string; linked: boolean } | null>(null);
  useEffect(() => {
    if (!repoRoot) return;
    let cancelled = false;
    void hostApi.git.worktrees().then((result) => {
      // The route follows the active workspace. Bind its answer to this
      // snapshot's root so a workspace switch cannot relabel an older card.
      if (!cancelled && result.success && result.worktrees.some((tree) => pathEquals(tree.path, repoRoot))) {
        setCheckout({ root: repoRoot, linked: isLinkedWorktreePath(result.worktrees, repoRoot) });
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [repoRoot]);
  const linkedWorktree = checkout?.root === repoRoot && checkout?.linked;
  const hasGit = Boolean(git?.isRepository && (!git.clean || git.hasConflicts));
  const hasPlan = (plan?.todos.length ?? 0) > 0;
  const hasSubagents = snapshot.subagents.length > 0;
  const orderedSubagents = useMemo(() => {
    const priority = (agent: SessionActivitySubagent) => ({ error: 0, running: 1, warn: 2, idle: 3, ok: 4 })[rowState(agent.status)];
    return [...snapshot.subagents].reverse().sort((left, right) => priority(left) - priority(right));
  }, [snapshot.subagents]);
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
    !statusPending && showGit && !snapshot.availability.git ? t('sessionRail.git.unavailable') : null,
    !statusPending && showCommands && !snapshot.availability.terminals ? t('sessionRail.terminal.unavailable') : null,
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
  /* A failed run or a blocked continuation is a fact about the session and
   * leads the card in error ink. A status query that is merely unavailable
   * right now is a fact about the panel: it stays a quiet line with a retry. */
  const hardAlert = Boolean(snapshot.session.error || snapshot.continuity.blockedReason);

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
  /* Context: a percentage only when both the used count and the window are
   * known; otherwise the used count alone, and no row at all when neither is. */
  const contextPercent = context?.utilisation != null && Number.isFinite(context.utilisation)
    ? Math.min(100, Math.max(0, Math.round(context.utilisation * 100)))
    : null;
  /* A zero count with no known window is "not measured yet", not a reading. */
  const showContext = Boolean(context && (contextPercent != null || (context.usedTokens ?? 0) > 0));
  const contextPressure = snapshot.continuity.contextPressure;
  const contextState: RowState = contextPressure === 'high' || (contextPercent ?? 0) >= 90
    ? 'error'
    : contextPressure === 'medium' || (contextPercent ?? 0) >= 70 ? 'warn' : 'idle';
  const skillSources = sources.filter((source) => source.kind === 'skill').length;
  const connectorSources = sources.length - skillSources;

  const defaultExpandedProcessId = [...visibleProcesses].reverse().find((entry) => entry.status === 'running')?.id ?? null;
  const effectiveExpandedProcessId = expandedProcessId === undefined ? defaultExpandedProcessId : expandedProcessId;
  const renderRuntimeProcess = (entry: RunProcessSurface) => (
    <ProcessItem
      key={entry.id}
      entry={entry}
      expanded={effectiveExpandedProcessId === entry.id}
      active={isActiveSubject('process', entry.id)}
      onToggle={() => setExpandedProcessId(effectiveExpandedProcessId === entry.id ? null : entry.id)}
      onOpenInWorkspace={onOpenProcess ? () => onOpenProcess(entry.id, entry.command) : undefined}
    />
  );
  const renderSnapshotProcess = (entry: SessionActivitySnapshot['processes'][number]) => (
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
  );
  const recentProcesses = visibleProcesses.filter((entry) => entry.status === 'completed');
  const recentSnapshotProcesses = snapshotOnlyProcesses.filter((entry) => entry.status === 'completed' || entry.status === 'exited');
  const recentCount = recentProcesses.length + recentSnapshotProcesses.length;

  if (!hasGit && !hasPlan && !hasSubagents && !hasProcesses && !policy && sources.length === 0
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
          <span className="codex-session-activity__head-icon" aria-hidden="true">
            <FolderOpen className="h-3.5 w-3.5" />
          </span>
          <span className="codex-session-activity__head-text">
            <span className="codex-session-activity__head-title" title={workspaceName}>{workspaceName || t('sessionActivity.title')}</span>
            {git?.isRepository ? (
              <span className="codex-session-activity__head-meta" data-testid="session-activity-head-branch" data-git-kind={linkedWorktree ? 'worktree' : 'branch'} title={git.repoRoot}>
                {linkedWorktree ? <FolderGit2 className="h-3 w-3 shrink-0" aria-hidden="true" /> : <GitBranch className="h-3 w-3 shrink-0" aria-hidden="true" />}
                {linkedWorktree && <span className="shrink-0" data-testid="session-activity-worktree-kind">{t('composer.git.kindWorktree')}</span>}
                <span className="codex-session-activity__mono" title={git.branch}>{git.detached ? t('sessionActivity.git.detached') : git.branch ?? t('composer.git.unknownBranch')}</span>
              </span>
            ) : null}
          </span>
          {runningTotal > 0 ? (
            /* A dot and a figure, not a sentence: the Background group below
             * spells the count out, and the workspace name needs the width. */
            <span
              className="codex-session-activity__pill"
              data-state="running"
              data-testid="session-activity-running"
              title={t('sessionActivity.runningCount', { count: runningTotal })}
              aria-label={t('sessionActivity.runningCount', { count: runningTotal })}
            >
              <OrbStatus state="streaming" label={t('sessionActivity.runningCount', { count: runningTotal })} className="codex-session-activity__pulse size-3.5" />
              <span aria-hidden="true">{runningTotal}</span>
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
            {onClose ? (
              <HeaderAction
                label={t('sessionActivity.close')}
                icon={<X className="h-3.5 w-3.5" />}
                onClick={() => {
                  onClose();
                  document.querySelector<HTMLButtonElement>('[data-testid="chat-session-activity-toggle"]')?.focus();
                }}
                testId="session-activity-close"
              />
            ) : null}
          </span>
        </header>

        {alert || backgroundUnknown ? (
          <div className="codex-session-activity__alerts" data-state={hardAlert ? 'error' : 'quiet'} role="status">
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
                data-state="warn"
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

        {/* ── Overview: 上下文 / 连接器 ───────────────────────────────────
         * Key–value rows in the reference client's shape: the label leads,
         * the reading sits on the right edge, and the detail folds open under
         * the row. Each row exists only when it has a real reading. */}
        {showContext || sources.length > 0 ? (
          <section className="codex-session-activity__section codex-session-activity__overview" data-testid="session-activity-overview">
            {showContext && context ? (
              <details className="codex-session-activity__kv" data-testid="session-activity-context" data-state={contextState}>
                <summary className="codex-session-activity__kv-head" data-testid="session-activity-context-toggle">
                  <span className="codex-session-activity__kv-label">{t('sessionActivity.overview.context')}</span>
                  <ChevronRight className="codex-session-activity__collapse-icon h-3 w-3" aria-hidden="true" />
                  <span className="codex-session-activity__kv-value" data-state={contextState}>
                    {contextPercent != null ? `${contextPercent}%` : formatTokens(context.usedTokens ?? 0)}
                    {contextPercent != null ? (
                      <span
                        className="codex-session-activity__meter"
                        role="meter"
                        aria-label={t('sessionActivity.overview.context')}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={contextPercent}
                        data-state={contextState}
                      >
                        <span style={{ width: `${Math.max(contextPercent, 2)}%` }} />
                      </span>
                    ) : null}
                  </span>
                </summary>
                <div className="codex-session-activity__kv-body">
                  <div className="codex-session-activity__kv-line">
                    <span>{t('sessionActivity.overview.contextUsed')}</span>
                    <span className="codex-session-activity__mono">
                      {context.usedTokens != null
                        ? context.maxTokens != null
                          ? `${formatTokens(context.usedTokens)} / ${formatTokens(context.maxTokens)}`
                          : formatTokens(context.usedTokens)
                        : '—'}
                    </span>
                  </div>
                  {context.cacheReadTokens != null ? (
                    <div className="codex-session-activity__kv-line">
                      <span>{t('sessionActivity.overview.cacheRead')}</span>
                      <span className="codex-session-activity__mono">{formatTokens(context.cacheReadTokens)}</span>
                    </div>
                  ) : null}
                  {context.warmTurnHitRate != null ? (
                    <div className="codex-session-activity__kv-line">
                      <span>{t('sessionActivity.overview.cacheHitRate')}</span>
                      <span className="codex-session-activity__mono">{Math.round(context.warmTurnHitRate * 100)}%</span>
                    </div>
                  ) : null}
                  {contextPressure ? (
                    <div className="codex-session-activity__kv-line">
                      <span>{t('sessionActivity.overview.pressure')}</span>
                      <span data-state={contextState}>{t(`sessionActivity.continuity.pressure.${contextPressure}`)}</span>
                    </div>
                  ) : null}
                </div>
              </details>
            ) : null}
            {sources.length > 0 ? (
              <details className="codex-session-activity__kv" data-testid="session-activity-sources">
                <summary className="codex-session-activity__kv-head" data-testid="session-activity-sources-toggle">
                  <span className="codex-session-activity__kv-label">{t('sessionActivity.overview.connectors')}</span>
                  <ChevronRight className="codex-session-activity__collapse-icon h-3 w-3" aria-hidden="true" />
                  <span className="codex-session-activity__kv-value">
                    {[
                      connectorSources > 0 ? t('sessionActivity.overview.connectorsValue', { count: connectorSources }) : null,
                      skillSources > 0 ? t('sessionActivity.overview.skillsValue', { count: skillSources }) : null,
                    ].filter(Boolean).join(' · ')}
                  </span>
                </summary>
                <div className="codex-session-activity__kv-body is-list">
                  <PreviewRows testId="session-activity-more-sources">
                    {sources.map((source) => source.kind === 'skill' ? (
                      <Row
                        key={source.id}
                        icon={<BookOpen className="h-3.5 w-3.5" aria-hidden="true" />}
                        label={source.name}
                        title={source.name}
                        value={t('sessionActivity.sourceKinds.skill')}
                      />
                    ) : (
                      <details className="codex-session-activity__source" key={source.id}>
                        <summary className="codex-session-activity__row is-interactive">
                          <Plug className="h-3.5 w-3.5 codex-session-activity__row-icon" aria-hidden="true" />
                          <span className="codex-session-activity__row-label" title={source.name}>{source.name}</span>
                          <span className="codex-session-activity__row-value">{t('sessionActivity.sourceKinds.mcp')}</span>
                          <ChevronRight className="h-3.5 w-3.5 codex-session-activity__collapse-icon" aria-hidden="true" />
                        </summary>
                        <div className="codex-session-activity__source-tools">
                          {source.tools.map((tool) => <code key={tool}>{tool}</code>)}
                        </div>
                      </details>
                    ))}
                  </PreviewRows>
                </div>
              </details>
            ) : null}
          </section>
        ) : null}

        {/* ── 变更 ─────────────────────────────────────────────────────────
         * One line: the signed delta with branch and file count beneath it,
         * and the review action on the right edge (the reference client's
         * "Changes … Create PR" row). */}
        {hasGit && gitStats ? (
          <Section
            title={t('sessionActivity.sections.environment')}
            testId="session-activity-environment"
            summary={git?.hasConflicts ? t('sessionActivity.git.conflicts') : undefined}
          >
            <div
              className={cn('codex-session-activity__change', reviewActive && 'is-active')}
              data-testid="session-activity-git-delta"
              data-state={git?.hasConflicts ? 'error' : undefined}
            >
              <span className="codex-session-activity__row-icon">
                <GitCommitHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <span className="codex-session-activity__row-stack">
                <span className="codex-session-activity__delta">
                  <span className="codex-session-activity__delta-add">+{formatCount(gitStats.additions)}</span>
                  <span className="codex-session-activity__delta-remove">−{formatCount(gitStats.deletions)}</span>
                </span>
                <span
                  className="codex-session-activity__row-sublabel"
                  data-testid="session-activity-git-branch"
                  title={git?.branch ?? t('sessionActivity.git.detached')}
                >
                  <span className="codex-session-activity__mono">{git?.branch ?? t('sessionActivity.git.detached')}</span>
                  {' · '}
                  {git?.hasConflicts ? t('sessionActivity.git.conflicts') : t('sessionActivity.git.changes', { count: gitStats.changes })}
                </span>
              </span>
              {onOpenEnvironment ? (
                <button
                  type="button"
                  className="codex-session-activity__chip-button"
                  onClick={onOpenEnvironment}
                  aria-pressed={reviewActive}
                  data-testid="session-activity-review"
                >
                  {t('sessionActivity.overview.review')}
                </button>
              ) : null}
            </div>
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
                maxVisibleTodos={3}
                compact
                showTitle
                testId="session-activity-plan-view"
              />
            </div>
          </Section>
        ) : null}

        {/* ── 后台任务 ─────────────────────────────────────────────────────
         * Workers and the commands this run launched, under one heading the
         * way the reference client lists background tasks; each keeps its
         * own sub-list, its open action and its "finished" disclosure. */}
        {hasSubagents || hasProcesses ? (
          <div className="codex-session-activity__group" data-testid="session-activity-background">
            <div className="codex-session-activity__section-head codex-session-activity__group-head">
              <span className="codex-session-activity__section-title">{t('sessionActivity.overview.background')}</span>
              <span className="codex-session-activity__section-summary" data-state={runningTotal > 0 ? 'running' : undefined}>
                {runningTotal > 0
                  ? t('sessionActivity.runningCount', { count: runningTotal })
                  : t('sessionActivity.overview.backgroundIdle')}
              </span>
            </div>

        {/* ── 子 Agent ─────────────────────────────────────────────────── */}
        {hasSubagents ? (
          <Section
            title={t('sessionActivity.sections.subagents')}
            summary={runningSubagents > 0
              ? t('sessionActivity.runningCount', { count: runningSubagents })
              : formatCount(snapshot.subagents.length)}
            testId="session-activity-subagents"
          >
            <PreviewRows testId="session-activity-more-subagents">
            {orderedSubagents.map((agent) => {
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
                    ? <OrbStatus state="streaming" label={t('sessionActivity.subagentStatus.started', { defaultValue: agent.status })} className="size-3.5" />
                    : t(`sessionActivity.subagentStatus.${agent.status}`, { defaultValue: agent.status })}
                  state={state}
                  active={Boolean(childSessionKey && isActiveSubject('subagent', childSessionKey))}
                  title={childSessionKey
                    ? t('sessionActivity.subagents.openTranscript', { role: identity.name })
                    : agent.task || identity.name}
                  onOpen={childSessionKey && onOpenSubagent
                    ? () => onOpenSubagent(childSessionKey)
                    : undefined}
                />
              );
            })}
            </PreviewRows>
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
            <PreviewRows testId="session-activity-more-processes">
              {[
                ...visibleProcesses.filter((entry) => entry.status !== 'completed').map(renderRuntimeProcess),
                ...snapshotOnlyProcesses.filter((entry) => entry.status !== 'completed' && entry.status !== 'exited').map(renderSnapshotProcess),
              ]}
            </PreviewRows>
            {recentCount > 0 && (
              <details className="codex-session-activity__recent" data-testid="session-activity-recent-processes">
                <summary>
                  <ChevronRight className="size-3 shrink-0" aria-hidden="true" />
                  {t('sessionActivity.processes.recent', { count: recentCount })}
                </summary>
                <div className="codex-session-activity__overflow" tabIndex={0}>
                  {recentProcesses.map(renderRuntimeProcess)}
                  {recentSnapshotProcesses.map(renderSnapshotProcess)}
                </div>
              </details>
            )}
          </Section>
        ) : null}
          </div>
        ) : null}

        {/* ── Host-projected read models ────────────────────────────────────
         *
         * Goals and lineage come from the host's own session projection and have
         * no runtime counterpart to open, so both are read-only like the
         * snapshot processes above. They appear only when the host supplies
         * them, which is why they are below the four sections the card is
         * organised around rather than interleaved with them. */}
        {snapshot.goals.length > 0 ? (
          <CollapsibleSection
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
          </CollapsibleSection>
        ) : null}

        {snapshot.lineage.length > 0 ? (
          <CollapsibleSection
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
          </CollapsibleSection>
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
