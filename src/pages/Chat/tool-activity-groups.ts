import type { RawMessage } from '@/stores/chat';
import type { GeneratedFile } from '@/lib/generated-files';
import type { RunCodeDiffSurface, RunTerminalSurface } from '@/components/tool-ui/run-surfaces';
import { extractText, extractToolUse, isInternalProcessNarration } from './message-utils';
import type { UserRunCard, UserRunStatus } from './execution-projection';
import type { TaskStep } from './task-visualization';
import { deriveTaskSteps } from './task-visualization';
import { isPlanToolName } from './run-surface-promotion';
import { isToolResultRole } from '@/stores/chat/helpers';

export type ToolActivityKind = 'read' | 'write' | 'edit' | 'search' | 'web' | 'command' | 'other';
export type ToolActivityEntry = { id: string; name: string; kind: ToolActivityKind; target?: string; running: boolean; order: number };
export type ToolActivityGroupModel = {
  id: string;
  runKey: string;
  anchorIndex: number;
  agentLabel: string;
  status: UserRunStatus;
  steps: TaskStep[];
  terminals: RunTerminalSurface[];
  files: GeneratedFile[];
  diffs: RunCodeDiffSurface[];
  entries: ToolActivityEntry[];
  current?: ToolActivityEntry;
  isCurrent?: boolean;
  pendingResult?: boolean;
  traceId?: UserRunCard['traceId'];
  codingRunView?: UserRunCard['codingRunView'];
};

export function inferToolActivityKind(name: string): ToolActivityKind {
  const tool = name.toLowerCase();
  if (/(search|grep|find|lookup)/.test(tool)) return 'search';
  if (/(web_fetch|browse|fetch_url|open_url|navigate|visit)/.test(tool)) return 'web';
  if (/(edit|patch|replace|modify)/.test(tool)) return 'edit';
  if (/(write|create_file|save_file)/.test(tool)) return 'write';
  if (/(read|view_file|file_view|open_file|list_files|file_list|file_stat|file_hash)/.test(tool)) return 'read';
  if (/(exec|bash|shell|command|terminal|process|run)/.test(tool)) return 'command';
  return 'other';
}

export function toolActivityTarget(step: Pick<TaskStep, 'target' | 'inputDetail' | 'detail'>): string | undefined {
  if (step.target) return step.target.replace(/\s+/g, ' ').trim();
  const text = step.inputDetail ?? step.detail;
  if (!text) return undefined;
  try {
    const input = JSON.parse(text) as Record<string, unknown> | null;
    if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
    return ['file_path', 'filePath', 'path', 'command', 'cmd', 'pattern', 'query', 'url', 'title']
      .map(key => input[key])
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
      ?.replace(/\s+/g, ' ').trim();
  } catch {
    return text.replace(/\s+/g, ' ').trim();
  }
}

export function toolActivityKind(step: Pick<TaskStep, 'label' | 'inputDetail' | 'detail'>): ToolActivityKind {
  const kind = inferToolActivityKind(step.label);
  if (kind === 'web' && /browser|browse/i.test(step.label)) {
    try {
      const input = JSON.parse(step.inputDetail ?? step.detail ?? '{}');
      if (input?.action === 'search') return 'search';
    } catch { /* Keep the named tool's category when its arguments are partial. */ }
  }
  return kind;
}

function timestamp(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n < 1e12 ? n * 1000 : n : undefined;
}

/** Display groups use the call's slot; late results keep that call's group. */
export function buildToolActivityGroups(
  card: UserRunCard,
  messages: RawMessage[],
  files: GeneratedFile[] = [],
  diffs: RunCodeDiffSurface[] = [],
  excludedToolIds: ReadonlySet<string> = new Set(),
  disclosureKey: string = card.runKey,
): ToolActivityGroupModel[] {
  const callAnchors = new Map<string, number>();
  const callOrders = new Map<string, number>();
  const rawResults = new Map<string, string>();
  const textAnchors: { index: number; ts?: number }[] = [];
  const unmatched = card.steps.filter(step => step.kind === 'tool');
  let anchor = card.triggerIndex;
  for (let index = card.triggerIndex + 1; index <= Math.min(card.segmentEnd, messages.length - 1); index++) {
    const message = messages[index];
    const tools = extractToolUse(message);
    const resultText = message.details ?? message.content;
    if (isToolResultRole(message.role) && message.toolCallId && typeof resultText === 'string') rawResults.set(message.toolCallId, resultText);
    for (const result of message._toolResults ?? []) if (result.toolCallId && typeof result.result === 'string') rawResults.set(result.toolCallId, result.result);
    if (message.role === 'assistant' && !isInternalProcessNarration(extractText(message))
      && (card.active || index !== card.replyIndex || tools.length > 0)) {
      anchor = index;
      textAnchors.push({ index, ts: timestamp(message.timestamp) });
    }
    for (const tool of tools) {
      const id = tool.id || unmatched.find(step => step.label === tool.name && !callAnchors.has(step.id))?.id;
      if (id) { callAnchors.set(id, anchor); callOrders.set(id, callOrders.size); }
    }
  }

  const historySteps = deriveTaskSteps({ messages: messages.slice(card.triggerIndex + 1, card.segmentEnd + 1), streamingMessage: null, streamingTools: [] });
  const currentById = new Map(card.steps.map(step => [step.id, step]));
  const terminalCalls = new Set(card.surfaces.terminals.map(terminal => terminal.toolCallId).filter(Boolean));
  const retained = historySteps.filter(step => {
    const callId = step.id.startsWith('tool-result-') ? step.id.slice(12) : step.id;
    return (step.kind === 'tool' || step.id.startsWith('tool-result-'))
      && !currentById.has(step.id) && !terminalCalls.has(callId) && !isPlanToolName(step.label)
      && !card.surfaces.promotedStepIds.has(callId) && !excludedToolIds.has(callId);
  });
  const historyById = new Map(historySteps.filter(step => step.kind === 'tool').map(step => [step.id, step]));
  const steps = [...retained, ...card.steps.filter(step => !excludedToolIds.has(step.id)
    && !excludedToolIds.has(step.id.startsWith('tool-result-') ? step.id.slice(12) : step.id))
    .map(step => historyById.has(step.id) && step.kind === 'tool'
      ? { ...step, inputDetail: historyById.get(step.id)!.detail } : step)]
    .map(step => step.id.startsWith('tool-result-') && rawResults.has(step.id.slice(12))
      ? { ...step, detail: rawResults.get(step.id.slice(12)) } : step);
  const orderFor = (id: string, fallback: number) => (callOrders.get(id.startsWith('tool-result-') ? id.slice(12) : id) ?? callOrders.size + fallback)
    + (id.startsWith('tool-result-') ? .25 : 0);
  const groups = new Map<number, ToolActivityGroupModel>();
  const timeline = [
    ...steps.filter(step => step.kind !== 'message').map((step, index) => ({ step, order: orderFor(step.id, step.eventOrder ?? index) + (step.id.startsWith('tool-result-') ? 0.5 : 0) })),
    ...card.surfaces.terminals.map((terminal, index) => ({ terminal, order: orderFor(terminal.toolCallId ?? terminal.id, terminal.eventOrder ?? steps.length + index) })),
  ].sort((a, b) => a.order - b.order);
  let previousAnchor = card.triggerIndex;
  const groupFor = (index: number) => {
    let group = groups.get(index);
    if (!group) {
      group = { id: `${disclosureKey}:activity:${index - card.triggerIndex}`, runKey: card.runKey, anchorIndex: index, agentLabel: card.agentLabel,
        status: 'completed', steps: [], terminals: [], files: [], diffs: [], entries: [] };
      groups.set(index, group);
    }
    return group;
  };
  const entryAnchors = new Map<string, number>();
  // Register calls first so a result arriving earlier in the stored array can still join its owner.
  for (const item of timeline) {
    const step = 'step' in item ? item.step : undefined;
    const terminal = 'terminal' in item ? item.terminal : undefined;
    const id = terminal?.toolCallId ?? terminal?.id ?? step?.id;
    if (step?.kind === 'tool' || terminal) {
      const at = timestamp(step?.startedAt ?? terminal?.startedAt);
      const index = (id ? callAnchors.get(id) : undefined)
        ?? (at != null ? textAnchors.findLast(row => row.ts != null && row.ts <= at)?.index : undefined)
        ?? anchor;
      if (id) entryAnchors.set(id, index);
    }
  }
  for (const item of timeline) {
    const step = 'step' in item ? item.step : undefined;
    const terminal = 'terminal' in item ? item.terminal : undefined;
    const id = step?.id ?? terminal!.id;
    const callId = terminal?.toolCallId ?? (id.startsWith('tool-result-') ? id.slice(12) : id);
    const index = entryAnchors.get(callId) ?? callAnchors.get(callId)
      ?? (step?.parentId ? entryAnchors.get(step.parentId) : undefined)
      ?? (step?.kind === 'system' ? previousAnchor : anchor);
    const group = groupFor(index);
    if (step) group.steps.push({ ...step, eventOrder: item.order }); else group.terminals.push({ ...terminal!, eventOrder: item.order });
    if (step?.kind === 'tool' || terminal || (step?.kind === 'system' && !id.startsWith('tool-result-'))) {
      group.entries.push({ id: callId, name: terminal?.command ?? step!.label,
        kind: terminal ? 'command' : toolActivityKind(step!),
        target: terminal?.command ?? toolActivityTarget(step!),
        running: card.active && (terminal?.status === 'running' || step?.status === 'running'),
        order: step?.eventOrder ?? terminal?.eventOrder ?? item.order });
      previousAnchor = index;
    }
  }
  const result = [...groups.values()].sort((a, b) => a.anchorIndex - b.anchorIndex);
  for (const group of result) {
    const results = new Map(group.steps.filter(step => step.id.startsWith('tool-result-')).map(step => [step.id.slice(12), step]));
    group.steps = group.steps.map(step => step.kind === 'tool' && results.has(step.id)
      ? { ...step, status: results.get(step.id)!.status } : step);
    for (const entry of group.entries) if (results.has(entry.id)) entry.running = false;
    group.current = group.entries.findLast(entry => entry.running);
    const failed = group.steps.some(step => step.status === 'error') || group.terminals.some(terminal => terminal.status === 'failed');
    group.status = failed ? 'error' : group.current ? 'running' : card.status === 'aborted' && group.steps.some(step => step.status === 'running') ? 'aborted' : 'completed';
    group.pendingResult = !card.active && (group.steps.some(step => step.status === 'running') || group.terminals.some(terminal => terminal.status === 'running'));
    if (card.status === 'error' && group.pendingResult) group.status = 'error';
    if (card.status === 'aborted' && group.pendingResult) group.status = 'aborted';
    if (!group.entries.length) group.entries.push({ id: group.id, name: group.steps[0]?.label ?? '', kind: 'other', running: false, order: 0 });
  }
  const currentGroup = result.filter(group => group.current).sort((a, b) => a.current!.order - b.current!.order).at(-1);
  if (currentGroup) currentGroup.isCurrent = true;
  const lastGroup = result.at(-1);
  if (lastGroup) { lastGroup.traceId = card.traceId; lastGroup.codingRunView = card.codingRunView; }
  return attachToolActivityArtifacts(result, files, diffs);
}

export function attachToolActivityArtifacts(groups: ToolActivityGroupModel[], files: GeneratedFile[], diffs: RunCodeDiffSurface[]): ToolActivityGroupModel[] {
  const result = groups.map(group => ({ ...group, files: [] as GeneratedFile[], diffs: [] as RunCodeDiffSurface[] }));
  const pathKey = (value: string) => value.replace(/\\/g, '/').toLowerCase();
  const fileOwner = (path: string) => result.findLast(group => group.entries.some(entry => entry.target && (
    pathKey(path) === pathKey(entry.target) || pathKey(path).endsWith(`/${pathKey(entry.target)}`)
  ))) ?? result.at(-1);
  for (const file of files) fileOwner(file.filePath)?.files.push(file);
  for (const diff of diffs) fileOwner(diff.filePath)?.diffs.push(diff);
  return result;
}
