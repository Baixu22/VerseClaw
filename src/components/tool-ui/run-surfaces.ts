import { computeLineStats, supportsInlineDiff, type FileLineStats, type GeneratedFile } from '@/lib/generated-files';
import type { TaskStep } from '@/pages/Chat/task-visualization';
import type { ChatRuntimeRunState } from '@/stores/chat/types';
import type { PermissionApprovalEvent } from '@shared/types/workspace';

export const MAX_TERMINAL_OUTPUT_CHARS = 32 * 1024;
export const MAX_CODE_DIFF_CHARS = 256 * 1024;

export type RunTerminalSurface = {
  type: 'terminal';
  id: string;
  eventOrder?: number;
  startedAt?: number;
  toolCallId?: string;
  command: string;
  cwd?: string;
  output: string;
  status: 'running' | 'completed' | 'failed';
  exitCode?: number;
  durationMs?: number;
  truncated: boolean;
};

export type RunCodeDiffSurface = {
  type: 'code-diff';
  id: string;
  filePath: string;
  language: string;
  patch?: string;
  original?: string;
  modified?: string;
  lineStats?: FileLineStats | null;
  mode: 'full' | 'snippet';
  confidence: 'trusted';
};

export type RunProgressStep = {
  id: string;
  label: string;
  description?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
};

export type RunProgressSurface = {
  type: 'progress-tracker';
  id: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  steps: RunProgressStep[];
  receipt?: {
    outcome: 'success' | 'partial' | 'failed' | 'cancelled';
    summary: string;
    at: string;
  };
};

export type RunProcessSurface = {
  type: 'process';
  /** The tool call that launched it — stable for the whole life of the process. */
  id: string;
  toolCallId?: string;
  command: string;
  cwd?: string;
  output: string;
  status: 'running' | 'completed' | 'failed';
  exitCode?: number;
  durationMs?: number;
  truncated: boolean;
  startedAt?: number;
  updatedAt?: number;
};

export type RunToolSurface =
  | RunTerminalSurface
  | RunCodeDiffSurface
  | RunProgressSurface;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function commandStatus(input: {
  status?: string;
  phase?: string;
  exitCode?: number;
}): RunTerminalSurface['status'] {
  const status = input.status?.toLowerCase();
  const phase = input.phase?.toLowerCase();
  if (status === 'failed' || status === 'error' || (input.exitCode != null && input.exitCode !== 0)) {
    return 'failed';
  }
  if (
    status === 'completed'
    || status === 'complete'
    || status === 'success'
    || phase === 'end'
    || phase === 'complete'
    || phase === 'completed'
  ) {
    return 'completed';
  }
  return 'running';
}

function mergeCommandOutput(previous: string, next: string | undefined): string {
  if (!next) return previous;
  if (!previous) return next;
  if (next.startsWith(previous)) return next;
  if (previous.endsWith(next)) return previous;
  return `${previous}${next}`;
}

function terminalDisplayOutput(output: string): Pick<RunTerminalSurface, 'output' | 'truncated'> {
  if (output.length <= MAX_TERMINAL_OUTPUT_CHARS) {
    return { output, truncated: false };
  }
  return {
    output: output.slice(-MAX_TERMINAL_OUTPUT_CHARS),
    truncated: true,
  };
}

export function projectCommandSurfaces(runState: ChatRuntimeRunState | null | undefined): RunTerminalSurface[] {
  if (!runState) return [];

  const tools = new Map<string, { command?: string; cwd?: string; order: number; startedAt?: number }>();
  const surfaces = new Map<string, RunTerminalSurface & { rawOutput: string }>();

  for (const [order, event] of runState.events.entries()) {
    if (event.type === 'tool.started') {
      const args = asRecord(event.args);
      tools.set(event.toolCallId, {
        order,
        startedAt: event.ts,
        command: nonEmptyString(args?.command) ?? nonEmptyString(args?.cmd),
        cwd: nonEmptyString(args?.cwd),
      });
      continue;
    }
    if (event.type !== 'command.output') continue;

    const id = event.itemId || event.toolCallId || `${event.name || 'command'}:output`;
    const tool = event.toolCallId ? tools.get(event.toolCallId) : undefined;
    const existing = surfaces.get(id);
    const rawOutput = mergeCommandOutput(existing?.rawOutput ?? '', event.output);
    const display = terminalDisplayOutput(rawOutput);
    const command = existing?.command
      || tool?.command
      || event.title
      || event.name
      || 'command';
    surfaces.set(id, {
      type: 'terminal',
      id,
      eventOrder: existing?.eventOrder ?? tool?.order ?? order,
      startedAt: existing?.startedAt ?? tool?.startedAt ?? event.ts,
      toolCallId: event.toolCallId ?? existing?.toolCallId,
      command,
      cwd: event.cwd ?? existing?.cwd ?? tool?.cwd,
      output: display.output,
      status: commandStatus(event),
      exitCode: event.exitCode ?? existing?.exitCode,
      durationMs: event.durationMs ?? existing?.durationMs,
      truncated: display.truncated,
      rawOutput,
    });
  }

  return Array.from(surfaces.values(), ({ rawOutput: _rawOutput, ...surface }) => surface);
}

/**
 * Every shell process this run has launched, running ones included.
 *
 * HOW THIS DIFFERS FROM `projectCommandSurfaces` ABOVE, AND WHY BOTH EXIST.
 * That one creates a surface only when `command.output` arrives, because it
 * feeds the transcript's terminal cards and a card with no output yet is a card
 * with nothing in it. This one seeds the process at `tool.started`, because the
 * question it answers — "what is running right now" — is only interesting
 * BEFORE the output lands. Widening the transcript's projection instead would
 * have grown an empty terminal card in the conversation for every command the
 * agent starts, which is a change to a surface nobody asked to change.
 *
 * WHAT COUNTS AS A PROCESS. A `tool.started` whose args carry a `command` or
 * `cmd` string. That is the same signal `projectCommandSurfaces` already uses to
 * recover the command text, and it beats an allowlist of tool names: the host
 * names its shell tool differently across runtimes (`bash`, `command`,
 * `run_terminal_cmd`), but a tool that takes a command in its arguments is a
 * shell tool in all of them.
 *
 * A process is running until something settles it: `command.output` reporting a
 * terminal status or a non-zero exit, or the matching `tool.completed`.
 */
export function projectRunProcesses(runState: ChatRuntimeRunState | null | undefined): RunProcessSurface[] {
  if (!runState) return [];

  const processes = new Map<string, RunProcessSurface & { rawOutput: string }>();
  /** `command.output` is keyed by `itemId`, so map it back to its tool call. */
  const idByToolCall = new Map<string, string>();

  const upsert = (id: string, patch: Partial<RunProcessSurface & { rawOutput: string }>) => {
    const existing = processes.get(id);
    const rawOutput = mergeCommandOutput(existing?.rawOutput ?? '', patch.rawOutput);
    const display = terminalDisplayOutput(rawOutput);
    processes.set(id, {
      type: 'process',
      id,
      /* Existing first. `tool.started` carries the real command from the tool's
       * arguments; the later `command.output` events often carry only a generic
       * tool `name` ("command"), so letting the patch win would relabel a known
       * invocation as "command" the moment it printed anything. */
      command: existing?.command || patch.command || 'command',
      toolCallId: patch.toolCallId ?? existing?.toolCallId,
      cwd: existing?.cwd ?? patch.cwd,
      status: patch.status ?? existing?.status ?? 'running',
      exitCode: patch.exitCode ?? existing?.exitCode,
      durationMs: patch.durationMs ?? existing?.durationMs,
      startedAt: existing?.startedAt ?? patch.startedAt,
      updatedAt: patch.updatedAt ?? existing?.updatedAt,
      output: display.output,
      truncated: display.truncated,
      rawOutput,
    });
  };

  for (const event of runState.events) {
    if (event.type === 'tool.started') {
      const args = asRecord(event.args);
      const command = nonEmptyString(args?.command) ?? nonEmptyString(args?.cmd);
      if (!command) continue;
      idByToolCall.set(event.toolCallId, event.toolCallId);
      upsert(event.toolCallId, {
        toolCallId: event.toolCallId,
        command,
        cwd: nonEmptyString(args?.cwd),
        status: 'running',
        startedAt: event.ts,
        updatedAt: event.ts,
      });
      continue;
    }

    if (event.type === 'command.output') {
      // Prefer the tool call so the row started above is the row settled here;
      // `itemId` is only a fallback for hosts that omit `toolCallId`.
      const id = (event.toolCallId && idByToolCall.get(event.toolCallId))
        || event.toolCallId
        || event.itemId;
      if (!id) continue;
      upsert(id, {
        toolCallId: event.toolCallId,
        command: nonEmptyString(event.title) ?? nonEmptyString(event.name),
        cwd: nonEmptyString(event.cwd),
        status: commandStatus(event),
        exitCode: event.exitCode,
        durationMs: event.durationMs,
        updatedAt: event.ts,
        rawOutput: event.output,
      });
      continue;
    }

    if (event.type === 'tool.completed') {
      const id = idByToolCall.get(event.toolCallId);
      // Only settle a process this projection already knows about — a
      // `tool.completed` for `read_file` must not invent a process row.
      if (!id) continue;
      const result = asRecord(event.result);
      const exitCode = typeof result?.exitCode === 'number' ? result.exitCode : undefined;
      upsert(id, {
        status: event.isError || (exitCode != null && exitCode !== 0) ? 'failed' : 'completed',
        exitCode,
        durationMs: typeof result?.durationMs === 'number' ? result.durationMs : undefined,
        updatedAt: event.ts,
        // NOT `nonEmptyString` — that trims, and stdout's trailing newline is
        // content, not padding. Only the emptiness check is wanted here.
        rawOutput: typeof result?.output === 'string' && result.output ? result.output : undefined,
      });
    }
  }

  return Array.from(processes.values(), ({ rawOutput: _rawOutput, ...surface }) => surface);
}

/**
 * Adapt a transcript terminal card into a process row.
 *
 * The two projections overlap by design but answer different questions, and they
 * survive different things: `projectRunProcesses` sees running commands but only
 * while the runtime run state is in memory, whereas the transcript's terminal
 * surfaces are rebuilt from history and so outlive the run. The status card wants
 * both — live rows while a run is in flight, history rows afterwards — so the
 * caller merges them and this makes the shapes comparable.
 */
export function processFromTerminalSurface(surface: RunTerminalSurface): RunProcessSurface {
  return {
    type: 'process',
    id: surface.toolCallId || surface.id,
    toolCallId: surface.toolCallId,
    command: surface.command,
    cwd: surface.cwd,
    output: surface.output,
    status: surface.status,
    exitCode: surface.exitCode,
    durationMs: surface.durationMs,
    truncated: surface.truncated,
  };
}

/**
 * Merge live and history-backed process rows, newest source winning.
 *
 * `runtime` rows win on collision: they carry the command recovered from the
 * tool's own arguments and a `running` status the history projection cannot
 * produce. Ordering follows first appearance so a row does not jump position
 * when its status settles.
 */
export function mergeProcessSurfaces(
  runtime: readonly RunProcessSurface[],
  history: readonly RunProcessSurface[],
): RunProcessSurface[] {
  const merged = new Map<string, RunProcessSurface>();
  for (const entry of history) merged.set(entry.id, entry);
  for (const entry of runtime) {
    const existing = merged.get(entry.id);
    // Keep whatever output the history row had if the live row has none yet.
    merged.set(entry.id, existing && !entry.output && existing.output
      ? { ...entry, output: existing.output, truncated: existing.truncated }
      : entry);
  }
  return Array.from(merged.values());
}

function languageFromFile(file: GeneratedFile): string {
  const language = file.ext.replace(/^\./, '').toLowerCase();
  if (language === 'ts') return 'typescript';
  if (language === 'js') return 'javascript';
  if (language === 'md') return 'markdown';
  if (language === 'yml') return 'yaml';
  return language || 'text';
}

function joinEditSide(file: GeneratedFile, side: 'old' | 'new'): string {
  return (file.edits ?? []).map((edit) => edit[side] ?? '').join('\n\n');
}

export function projectGeneratedFileDiff(file: GeneratedFile): RunCodeDiffSurface | null {
  if (!supportsInlineDiff(file)) return null;

  if (file.patchProjection) {
    if (file.patchProjection.status !== 'ok') return null;
    const artifact = file.patchProjection.artifact;
    if (
      artifact.completeness !== 'complete'
      || artifact.contentKind !== 'text'
      || !artifact.patch
      || artifact.patch.length > MAX_CODE_DIFF_CHARS
    ) {
      return null;
    }
    return {
      type: 'code-diff',
      id: `${artifact.lineage?.requestId}:${artifact.lineage?.journalEntryId}:${artifact.file}`,
      filePath: artifact.file,
      language: languageFromFile(file),
      patch: artifact.patch,
      lineStats: computeLineStats(file),
      mode: 'full',
      confidence: 'trusted',
    };
  }

  let original: string;
  let modified: string;
  let mode: RunCodeDiffSurface['mode'];

  if (file.edits?.length) {
    original = joinEditSide(file, 'old');
    modified = joinEditSide(file, 'new');
    mode = 'snippet';
  } else if (file.fullContent != null && file.baseline?.status === 'ok') {
    original = file.baseline.content;
    modified = file.fullContent;
    mode = 'full';
  } else if (
    file.action === 'created'
    && file.fullContent != null
    && file.baseline?.status === 'missing'
  ) {
    original = '';
    modified = file.fullContent;
    mode = 'full';
  } else {
    return null;
  }

  if (original.length + modified.length > MAX_CODE_DIFF_CHARS) return null;

  return {
    type: 'code-diff',
    id: `${file.filePath}:${file.lastSeenIndex}`,
    filePath: file.filePath,
    language: languageFromFile(file),
    original,
    modified,
    lineStats: computeLineStats(file),
    mode,
    confidence: 'trusted',
  };
}

export function projectProgressSurface(
  id: string,
  steps: TaskStep[],
  active: boolean,
): RunProgressSurface | null {
  if (steps.length === 0) return null;

  const projectedSteps: RunProgressStep[] = steps.map((step) => ({
    id: step.id,
    label: step.label,
    description: step.detail,
    status: step.status === 'error' ? 'failed' : step.status,
  }));
  const hasFailure = projectedSteps.some((step) => step.status === 'failed');
  const status: RunProgressSurface['status'] = active
    ? 'running'
    : hasFailure
      ? 'failed'
      : 'completed';

  return {
    type: 'progress-tracker',
    id,
    status,
    steps: projectedSteps,
    receipt: active
      ? undefined
      : {
        outcome: hasFailure ? 'failed' : 'success',
        summary: hasFailure ? 'Run completed with errors' : 'Run completed',
        at: new Date().toISOString(),
      },
  };
}

/**
 * Every approval the host is still holding for this session.
 *
 * Deliberately NOT filtered by run id. Approvals used to be matched against the
 * active run, which meant that sending the next message silently dropped an
 * undecided approval from the UI while the host went on holding it — the user
 * lost the only affordance that could unblock it, with no trace. A pending
 * approval stays actionable until somebody decides it, so it stays visible.
 *
 * `activeRunId` only affects ORDER: approvals belonging to the run in flight
 * sort first, so the one the user is currently waiting on leads.
 */
export function selectPendingApprovals(
  approvals: PermissionApprovalEvent[],
  input: {
    workspaceId: string;
    sessionKey: string;
    activeRunId?: string | null;
  },
): PermissionApprovalEvent[] {
  const pending = approvals.filter((approval) => (
    approval.status === 'pending'
    && approval.workspaceId === input.workspaceId
    && approval.sessionKey === input.sessionKey
  ));
  if (!input.activeRunId) return pending;

  // Stable partition rather than a sort — equal-priority approvals keep the
  // host's ordering, which is the order they were requested in.
  const active: PermissionApprovalEvent[] = [];
  const rest: PermissionApprovalEvent[] = [];
  for (const approval of pending) {
    (approval.runId === input.activeRunId ? active : rest).push(approval);
  }
  return [...active, ...rest];
}
