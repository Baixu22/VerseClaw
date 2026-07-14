import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, CircleDot, ExternalLink, Loader2, Play, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { hostApi } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import { cn } from '@/lib/utils';
import type { SubagentRuntimeLifecycleEvent } from '@shared/host-events/contract';
import { subagentLifecycleIdentityKey } from '@shared/subagent-lifecycle';
import { useAgentsStore } from '@/stores/agents';
import { AgentRoleIdentity, RoleBadge } from './AgentAvatar';

type RunnerPresetId = 'explorer' | 'reviewer' | 'tester' | 'compare';

type RunnerWorker = {
  roleName: string;
  task: string;
  label?: string;
};

type RunnerResult = {
  status: 'idle' | 'running' | 'complete' | 'error';
  orchestrationRunId?: string;
  goal?: string;
  preset?: RunnerPresetId;
  workers: RunnerWorker[];
  spawnedRunIds: string[];
  failures: Array<{ roleName: string; status?: string; error?: string }>;
  traceId?: string;
  error?: string;
};

type LabelTranslator = (key: string, defaultValue: string) => string;

type LifecycleEntry = {
  id: string;
  agentId?: string;
  taskNodeId?: string;
  roleName: string;
  label?: string;
  task: string;
  status: SubagentRuntimeLifecycleEvent['status'];
  error?: string;
  runId?: string;
  ts: number;
};

type RunnerLifecycleEvent = SubagentRuntimeLifecycleEvent & {
  childRunId?: string;
};

type UnwrapResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; message: string };

const PRESET_IDS: RunnerPresetId[] = ['explorer', 'reviewer', 'tester', 'compare'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function unwrapRpc(result: unknown): UnwrapResult {
  if (!isRecord(result)) {
    return { ok: false, message: 'Empty gateway response' };
  }
  if (result.success === false) {
    return { ok: false, message: String(result.error ?? 'Gateway request was rejected') };
  }
  return { ok: true, data: result };
}

function workerKey(worker: Pick<RunnerWorker, 'roleName' | 'task'>): string {
  return `${worker.roleName}\n${worker.task}`;
}

function readFailures(value: unknown): RunnerResult['failures'] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    return [{
      roleName: String(entry.roleName ?? 'unknown'),
      status: typeof entry.status === 'string' ? entry.status : undefined,
      error: typeof entry.error === 'string' ? entry.error : undefined,
    }];
  });
}

function readSpawnedRunIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function runnerStatusLabel(status: RunnerResult['status'], label: LabelTranslator): string {
  if (status === 'running') return label('roles.runnerStatus.running', 'running');
  if (status === 'complete') return label('roles.runnerStatus.complete', 'complete');
  if (status === 'error') return label('roles.runnerStatus.error', 'failed');
  return label('roles.runnerStatus.idle', 'idle');
}

function lifecycleStatusLabel(status: LifecycleEntry['status'], label: LabelTranslator): string {
  if (status === 'started') return label('roles.runnerEventStatus.started', 'started');
  if (status === 'completed') return label('roles.runnerEventStatus.completed', 'completed');
  if (status === 'verified') return label('roles.runnerEventStatus.verified', 'verified');
  if (status === 'aborted') return label('roles.runnerEventStatus.aborted', 'aborted');
  return label('roles.runnerEventStatus.error', 'failed');
}

function buildGoalTask(preset: RunnerPresetId, goal: string): string {
  if (preset === 'reviewer') return `Review the current diff for: ${goal}`;
  if (preset === 'tester') return `Find test gaps for: ${goal}`;
  if (preset === 'compare') return `Compare three implementation approaches for: ${goal}`;
  return `Explore solution options for: ${goal}`;
}

function buildPresetWorkers(preset: RunnerPresetId, goal: string, label: LabelTranslator, diff?: string): RunnerWorker[] {
  if (preset === 'reviewer') {
    return [{
      roleName: 'reviewer',
      label: label('roles.runnerLabel.diffReview', 'Diff review'),
      task: [
        `Review the current workspace diff for: ${goal}`,
        'Focus on correctness, regressions, missing tests, and unnecessary complexity.',
        'Do not edit files or propose automatic merges.',
        '',
        '```diff',
        diff?.trim() ?? '',
        '```',
      ].join('\n'),
    }];
  }
  if (preset === 'tester') {
    return [
      {
        roleName: 'tester',
        label: label('roles.runnerLabel.testGaps', 'Test gaps'),
        task: `Identify missing tests and verification gaps for: ${goal}. Do not edit files.`,
      },
      {
        roleName: 'reviewer',
        label: label('roles.runnerLabel.coverageReview', 'Coverage review'),
        task: `Review likely regression risks and test coverage blind spots for: ${goal}. Do not edit files.`,
      },
    ];
  }
  if (preset === 'compare') {
    return [
      {
        roleName: 'architect',
        label: label('roles.runnerLabel.conservative', 'Conservative'),
        task: `Design a conservative, minimal-change implementation approach for: ${goal}.`,
      },
      {
        roleName: 'architect',
        label: label('roles.runnerLabel.modular', 'Modular'),
        task: `Design a modular implementation approach with clear boundaries for: ${goal}.`,
      },
      {
        roleName: 'architect',
        label: label('roles.runnerLabel.integrationFirst', 'Integration-first'),
        task: `Design an integration-first implementation approach that prioritizes existing flows for: ${goal}.`,
      },
    ];
  }
  return [
    {
      roleName: 'planner',
      label: label('roles.runnerLabel.options', 'Options'),
      task: `Find viable solution options for: ${goal}. Include constraints, tradeoffs, and acceptance criteria. Do not edit files.`,
    },
    {
      roleName: 'architect',
      label: label('roles.runnerLabel.architecture', 'Architecture'),
      task: `Identify architecture boundaries, risks, and the recommended implementation shape for: ${goal}. Do not edit files.`,
    },
  ];
}

async function readCurrentDiff(): Promise<{ patch: string; error?: string }> {
  const [unstaged, staged] = await Promise.all([
    hostApi.git.diff({ mode: 'unstaged' }),
    hostApi.git.diff({ mode: 'staged' }),
  ]);
  const errors = [unstaged.error, staged.error].filter(Boolean).join('\n');
  const patch = [
    unstaged.patch ? `# Unstaged diff\n${unstaged.patch}` : '',
    staged.patch ? `# Staged diff\n${staged.patch}` : '',
  ].filter(Boolean).join('\n\n');
  return { patch, error: errors || undefined };
}

export function SubagentRunnerPanel({
  anchorSession,
  anchorAgentId,
}: {
  anchorSession: string;
  anchorAgentId: string;
}) {
  const { t } = useTranslation('agents');
  const tt = useCallback(
    (key: string, defaultValue: string, vars?: Record<string, unknown>) =>
      t(key, { defaultValue, ...(vars ?? {}) }),
    [t],
  );
  const [preset, setPreset] = useState<RunnerPresetId>('explorer');
  const [goal, setGoal] = useState('');
  const [running, setRunning] = useState(false);
  const agents = useAgentsStore((state) => state.agents);
  const anchorAgent = agents.find((agent) => agent.id === anchorAgentId) ?? null;
  const activeWorkerKeysRef = useRef<Set<string>>(new Set());
  const [events, setEvents] = useState<Record<string, LifecycleEntry>>({});
  const [result, setResult] = useState<RunnerResult>({
    status: 'idle',
    workers: [],
    spawnedRunIds: [],
    failures: [],
  });

  const selectedPresetLabel = tt(`roles.runnerPreset.${preset}`, preset);
  const canRun = goal.trim().length > 0 && !running;

  const setActiveKeys = useCallback((keys: Set<string>) => {
    activeWorkerKeysRef.current = keys;
  }, []);

  useEffect(() => {
    const unsubscribe = hostEvents.onSubagentLifecycle((rawEvent) => {
      const event = rawEvent as RunnerLifecycleEvent;
      const roleName = event.roleName;
      const task = event.task;
      if (!roleName || !task) return;
      const key = workerKey({ roleName, task });
      if (!activeWorkerKeysRef.current.has(key)) return;
      const id = subagentLifecycleIdentityKey(event);
      setEvents((prev) => ({
        ...prev,
        [id]: {
          id,
          agentId: event.agentId || anchorAgentId,
          taskNodeId: event.taskNodeId,
          roleName,
          label: result.workers.find((worker) => workerKey(worker) === key)?.label,
          task,
          status: event.status,
          error: event.error,
          runId: typeof event.runId === 'string' ? event.runId : typeof event.childRunId === 'string' ? event.childRunId : undefined,
          ts: event.ts ?? Date.now(),
        },
      }));
    });
    return unsubscribe;
  }, [anchorAgentId, result.workers]);

  const resolveTraceId = useCallback(async (orchestrationRunId: string): Promise<string | undefined> => {
    try {
      const traces = await hostApi.observability.queryTraces({ runId: orchestrationRunId, pageSize: 1 });
      return traces.items[0]?.id;
    } catch {
      return undefined;
    }
  }, []);

  const runPreset = useCallback(async () => {
    const trimmedGoal = goal.trim();
    if (!trimmedGoal) {
      toast.error(tt('roles.runnerGoalRequired', 'Enter a goal first'));
      return;
    }
    if (!anchorSession) {
      toast.error(tt('roles.noSession', 'No session available for orchestration. Create or select an Agent first.'));
      return;
    }

    setRunning(true);
    setEvents({});
    try {
      const diff = preset === 'reviewer' ? await readCurrentDiff() : undefined;
      if (diff?.error) {
        throw new Error(diff.error);
      }
      if (preset === 'reviewer' && !diff?.patch.trim()) {
        throw new Error(tt('roles.runnerNoDiff', 'No staged or unstaged diff is available to review.'));
      }
      const workers = buildPresetWorkers(preset, trimmedGoal, tt, diff?.patch);
      setActiveKeys(new Set(workers.map(workerKey)));
      setResult({
        status: 'running',
        preset,
        goal: trimmedGoal,
        workers,
        spawnedRunIds: [],
        failures: [],
      });
      const response = await hostApi.gateway.rpc('orchestrator.run', {
        task: buildGoalTask(preset, trimmedGoal),
        sessionKey: anchorSession,
        agentId: anchorAgentId,
        workers,
        includeVerifier: false,
        workerCommunication: 'none',
      });
      const unwrapped = unwrapRpc(response);
      if (!unwrapped.ok) {
        throw new Error(unwrapped.message);
      }
      const orchestrationRunId = typeof unwrapped.data.orchestrationRunId === 'string'
        ? unwrapped.data.orchestrationRunId
        : undefined;
      const failures = readFailures(unwrapped.data.failures);
      const spawnedRunIds = readSpawnedRunIds(unwrapped.data.spawnedRunIds);
      const traceId = orchestrationRunId ? await resolveTraceId(orchestrationRunId) : undefined;
      setResult({
        status: failures.length > 0 ? 'error' : 'complete',
        preset,
        goal: trimmedGoal,
        workers,
        spawnedRunIds,
        failures,
        orchestrationRunId,
        traceId,
        error: failures[0]?.error,
      });
      if (failures.length > 0) {
        toast.error(tt('roles.runnerFailed', '{{preset}} failed: {{reason}}', {
          preset: selectedPresetLabel,
          reason: failures[0]?.error ?? failures[0]?.status ?? 'unknown',
        }));
      } else {
        toast.success(tt('roles.runnerStarted', '{{preset}} finished: {{count}} workers', {
          preset: selectedPresetLabel,
          count: spawnedRunIds.length,
        }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setActiveKeys(new Set());
      setResult((prev) => ({
        ...prev,
        status: 'error',
        preset,
        goal: trimmedGoal,
        error: message,
        failures: prev.failures.length ? prev.failures : [{ roleName: preset, error: message }],
      }));
      toast.error(message);
    } finally {
      setRunning(false);
    }
  }, [anchorAgentId, anchorSession, goal, preset, resolveTraceId, selectedPresetLabel, setActiveKeys, tt]);

  const orderedEvents = useMemo(
    () => Object.values(events).sort((left, right) => left.ts - right.ts),
    [events],
  );

  return (
    <div data-testid="subagent-runner-panel" className="rounded-xl border border-border/60 bg-surface-input p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CircleDot className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-foreground">{tt('roles.runnerTitle', 'Lightweight Subagent Runner')}</span>
          </div>
          <p className="mt-1 text-2xs text-muted-foreground">
            {tt('roles.runnerHint', 'Launch common role-first workflows without writing ClawGraph YAML.')}
          </p>
        </div>
        <Badge variant="outline" className="rounded-full text-2xs">
          {tt('roles.runnerNoMerge', 'no auto-merge')}
        </Badge>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-[220px_minmax(0,1fr)_auto]">
        <Select value={preset} onValueChange={(value) => setPreset(value as RunnerPresetId)}>
          <SelectTrigger data-testid="subagent-runner-preset" size="sm" className="bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRESET_IDS.map((id) => (
              <SelectItem key={id} value={id}>
                {tt(`roles.runnerPreset.${id}`, id)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Textarea
          data-testid="subagent-runner-goal"
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          placeholder={tt('roles.runnerGoalPlaceholder', 'Describe what the subagents should investigate')}
          className="min-h-[72px] resize-none bg-background text-xs"
        />
        <Button data-testid="subagent-runner-start" onClick={() => void runPreset()} disabled={!canRun} className="h-8 self-start">
          {running ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Play className="mr-1 h-4 w-4" />}
          {tt('roles.runnerStart', 'Start')}
        </Button>
      </div>

      {result.status !== 'idle' && (
        <div data-testid="subagent-runner-result" className="mt-3 rounded-lg border border-border/60 bg-background/70 p-3">
          <div className="flex flex-wrap items-center gap-2">
            {result.status === 'running' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
            ) : result.status === 'complete' ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <XCircle className="h-3.5 w-3.5 text-red-500" />
            )}
            <span className="text-xs font-medium text-foreground">
              {tt('roles.runnerSummary', '{{preset}} {{status}} for {{goal}}', {
                preset: result.preset ? tt(`roles.runnerPreset.${result.preset}`, result.preset) : selectedPresetLabel,
                status: runnerStatusLabel(result.status, tt),
                goal: result.goal ?? goal,
              })}
            </span>
            <Badge variant="secondary" className="rounded-full text-2xs">
              {tt('roles.runnerWorkerCount', '{{count}} roles', { count: result.workers.length })}
            </Badge>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {result.workers.map((worker, index) => (
              <div key={`${worker.roleName}:${worker.label ?? index}`} className="flex min-w-0 items-center gap-2 rounded-xl border border-border/60 bg-surface-input px-2.5 py-2">
                {anchorAgent ? (
                  <AgentRoleIdentity agentId={anchorAgent.id} name={anchorAgent.name} avatar={anchorAgent.avatar} roleName={worker.roleName} size={32} />
                ) : <RoleBadge roleName={worker.roleName} size={24} />}
                <span className="min-w-0 text-2xs text-muted-foreground">
                  {worker.label && <span className="block truncate">{worker.label}</span>}
                  <span className="block truncate font-medium text-foreground">{worker.roleName}</span>
                </span>
              </div>
            ))}
          </div>

          {orderedEvents.length > 0 && (
            <div data-testid="subagent-runner-events" className="mt-3 space-y-1">
              {orderedEvents.map((event) => (
                <div key={event.id} data-testid="subagent-runner-event" className="flex items-center gap-2 rounded-lg px-1 py-1">
                  {anchorAgent ? (
                    <AgentRoleIdentity agentId={event.agentId ?? anchorAgent.id} name={anchorAgent.name} avatar={anchorAgent.avatar} roleName={event.roleName} size={28} />
                  ) : <RoleBadge roleName={event.roleName} size={22} />}
                  {event.status === 'started' ? (
                    <Loader2 className="h-3 w-3 shrink-0 animate-spin text-blue-500" />
                  ) : event.status === 'completed' || event.status === 'verified' ? (
                    <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
                  ) : (
                    <XCircle className="h-3 w-3 shrink-0 text-red-500" />
                  )}
                  <span className="truncate text-2xs font-medium text-foreground">
                    {event.label ? `${event.label}: ` : ''}{event.roleName}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      'rounded-full text-2xs',
                      event.status === 'started' && 'border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-400',
                      (event.status === 'completed' || event.status === 'verified') && 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
                      (event.status === 'error' || event.status === 'aborted') && 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400',
                    )}
                  >
                    {lifecycleStatusLabel(event.status, tt)}
                  </Badge>
                  {event.error && <span className="truncate text-2xs text-muted-foreground">{event.error}</span>}
                </div>
              ))}
            </div>
          )}

          {result.failures.length > 0 && (
            <div data-testid="subagent-runner-failure" className="mt-2 text-2xs text-red-700 dark:text-red-400">
              {result.error ?? result.failures.map((failure) => failure.error ?? failure.status ?? failure.roleName).join(', ')}
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
            {result.orchestrationRunId && (
              <span data-testid="subagent-runner-run-id" className="font-mono">{result.orchestrationRunId}</span>
            )}
            {result.traceId && (
              <a
                data-testid="subagent-runner-trace"
                href={`#/observability?traceId=${encodeURIComponent(result.traceId)}`}
                className="inline-flex items-center gap-1 text-blue-700 hover:underline dark:text-blue-400"
              >
                {tt('roles.runnerTrace', 'View trace')}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
