import type { GeneratedFile } from '@/lib/generated-files';
import { supportsInlineDiff } from '@/lib/generated-files';
import type { TaskStep } from '@/pages/Chat/task-visualization';
import type { ChatRuntimeRunState } from '@/stores/chat/types';
import type { PermissionApprovalEvent } from '@shared/types/workspace';

export const MAX_TERMINAL_OUTPUT_CHARS = 32 * 1024;
export const MAX_CODE_DIFF_CHARS = 256 * 1024;

export type RunApprovalSurface = {
  type: 'approval';
  id: string;
  source: PermissionApprovalEvent['source'];
  risk: PermissionApprovalEvent['risk'];
  title: string;
  description?: string;
  command?: string;
  cwd?: string;
  paths?: string[];
  status: PermissionApprovalEvent['status'];
};

export type RunTerminalSurface = {
  type: 'terminal';
  id: string;
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

export type RunToolSurface =
  | RunApprovalSurface
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

  const tools = new Map<string, { command?: string; cwd?: string }>();
  const surfaces = new Map<string, RunTerminalSurface & { rawOutput: string }>();

  for (const event of runState.events) {
    if (event.type === 'tool.started') {
      const args = asRecord(event.args);
      tools.set(event.toolCallId, {
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

export function projectApprovalSurface(approval: PermissionApprovalEvent): RunApprovalSurface {
  return {
    type: 'approval',
    id: approval.id,
    source: approval.source,
    risk: approval.risk,
    title: approval.reason || approval.command || approval.paths?.[0] || approval.source,
    description: approval.paramsPreview,
    command: approval.command,
    cwd: approval.cwd,
    paths: approval.paths,
    status: approval.status,
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
