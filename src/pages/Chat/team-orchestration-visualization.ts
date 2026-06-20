import type { ChatRuntimeRunState, ContentBlock, RawMessage } from '@/stores/chat';
import { extractText, extractToolUse, normalizeMessageRole } from './message-utils';

type AnyRecord = Record<string, unknown>;

export type TeamOrchestrationNodeView = {
  taskNodeId: string;
  roleName: string;
  phase?: string;
  status?: string;
  task?: string;
  dependsOn: string[];
  isVerifier: boolean;
};

export type TeamOrchestrationWaveView = {
  wave: number;
  taskNodeIds: string[];
  roles: string[];
};

export type TeamOrchestrationAlertView = {
  kind: 'failure' | 'repair' | 'followup' | 'reroute';
  label?: string;
  detail?: string;
};

export type TeamOrchestrationView = {
  id: string;
  toolCallId?: string;
  orchestrationRunId?: string;
  status: string;
  graphStatus?: string;
  task?: string;
  templateId?: string;
  graphMode?: string;
  nextAction?: string;
  pendingVerifier?: boolean;
  nodes: TeamOrchestrationNodeView[];
  waves: TeamOrchestrationWaveView[];
  alerts: TeamOrchestrationAlertView[];
  workerCount: number;
  verifierCount: number;
  failureCount: number;
  pendingCount: number;
  routeReasons: string[];
  raw?: AnyRecord;
};

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : null;
}

function textFromContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  const parts: string[] = [];
  for (const block of value as Array<{ type?: string; text?: string; content?: unknown }>) {
    if (typeof block?.text === 'string') parts.push(block.text);
    if (block?.content != null) {
      const nested = textFromContent(block.content);
      if (nested) parts.push(nested);
    }
  }
  return parts.join('\n');
}

function parseJsonLike(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim() ?? trimmed;
  const candidates = [fenced];
  const firstBrace = fenced.indexOf('{');
  const lastBrace = fenced.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(fenced.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Keep trying looser candidates.
    }
  }
  return null;
}

function hasOrchestrationShape(record: AnyRecord): boolean {
  return typeof record.orchestrationRunId === 'string'
    || typeof record.runId === 'string'
    || record.taskGraph != null
    || record.executionWaves != null
    || record.expectedChildren != null
    || record.children != null
    || record.pendingVerifier != null
    || record.routeDiagnostics != null
    || record.repairNodes != null
    || record.rerouteRecommendations != null;
}

function unwrapPayload(value: unknown, depth = 0): AnyRecord | null {
  if (depth > 4 || value == null) return null;
  if (typeof value === 'string') {
    const parsed = parseJsonLike(value);
    return unwrapPayload(parsed, depth + 1);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = unwrapPayload(item, depth + 1);
      if (parsed) return parsed;
    }
    const text = textFromContent(value);
    return text ? unwrapPayload(text, depth + 1) : null;
  }
  const record = asRecord(value);
  if (!record) return null;
  if (hasOrchestrationShape(record)) return record;

  const nestedKeys = ['data', 'result', 'output', 'content', 'payload', 'value'];
  for (const key of nestedKeys) {
    if (!(key in record)) continue;
    const parsed = unwrapPayload(record[key], depth + 1);
    if (parsed) return parsed;
  }
  return null;
}

function parseBundleText(text: string): AnyRecord | null {
  if (!/Team Result Bundle/i.test(text)) return null;
  const runId = text.match(/orchestrationRunId:\s*([^\s]+)/i)?.[1]?.trim();
  if (!runId) return null;
  return {
    orchestrationRunId: runId,
    status: text.match(/\bstatus:\s*([a-z_]+)/i)?.[1]?.trim() ?? 'completed',
  };
}

function arrayOfRecords(value: unknown): AnyRecord[] {
  return Array.isArray(value) ? value.map(asRecord).filter((item): item is AnyRecord => !!item) : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function normalizeStatus(value: unknown, fallback = 'running'): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function readString(record: AnyRecord | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function toNodes(payload: AnyRecord | null): TeamOrchestrationNodeView[] {
  const graph = asRecord(payload?.taskGraph);
  return arrayOfRecords(graph?.nodes).map((node, index) => ({
    taskNodeId: readString(node, 'taskNodeId') ?? `node-${index + 1}`,
    roleName: readString(node, 'roleName') ?? 'worker',
    phase: readString(node, 'phase'),
    status: readString(node, 'status'),
    task: readString(node, 'task'),
    dependsOn: stringArray(node.dependsOn),
    isVerifier: node.isVerifier === true,
  }));
}

function toWaves(payload: AnyRecord | null): TeamOrchestrationWaveView[] {
  return arrayOfRecords(payload?.executionWaves).map((wave, index) => ({
    wave: typeof wave.wave === 'number' ? wave.wave : index + 1,
    taskNodeIds: stringArray(wave.taskNodeIds),
    roles: stringArray(wave.roles),
  }));
}

function countChildren(payload: AnyRecord | null): number {
  const children = arrayOfRecords(payload?.children);
  if (children.length > 0) return children.length;
  const expected = arrayOfRecords(payload?.expectedChildren);
  if (expected.length > 0) return expected.length;
  const workers = arrayOfRecords(asRecord(payload?.plan)?.workers);
  if (workers.length > 0) return workers.length;
  return 0;
}

function toAlerts(payload: AnyRecord | null): TeamOrchestrationAlertView[] {
  const alerts: TeamOrchestrationAlertView[] = [];
  for (const failure of arrayOfRecords(payload?.failures)) {
    alerts.push({
      kind: 'failure',
      label: readString(failure, 'roleName') ?? readString(failure, 'childRunId'),
      detail: readString(failure, 'error') ?? readString(failure, 'reason'),
    });
  }
  for (const repair of arrayOfRecords(payload?.repairNodes)) {
    alerts.push({
      kind: 'repair',
      label: readString(repair, 'roleName') ?? readString(repair, 'taskNodeId'),
      detail: readString(repair, 'reason') ?? readString(repair, 'task'),
    });
  }
  for (const followup of arrayOfRecords(payload?.pendingGraphNodes)) {
    alerts.push({
      kind: 'followup',
      label: readString(followup, 'roleName') ?? readString(followup, 'taskNodeId'),
      detail: readString(followup, 'task'),
    });
  }
  for (const reroute of arrayOfRecords(payload?.rerouteRecommendations)) {
    alerts.push({
      kind: 'reroute',
      label: readString(reroute, 'roleName') ?? readString(reroute, 'sourceTaskNodeId'),
      detail: readString(reroute, 'reason'),
    });
  }
  return alerts;
}

function routeReasons(payload: AnyRecord | null): string[] {
  const route = asRecord(payload?.routeDiagnostics);
  return stringArray(route?.reasons).slice(0, 3);
}

function viewFromPayload(payload: AnyRecord | null, fallback: Partial<TeamOrchestrationView>): TeamOrchestrationView {
  const nodes = toNodes(payload);
  const waves = toWaves(payload);
  const alerts = toAlerts(payload);
  const graph = asRecord(payload?.taskGraph);
  const runId = readString(payload, 'orchestrationRunId') ?? readString(payload, 'runId') ?? fallback.orchestrationRunId;
  const verifierCount = nodes.filter((node) => node.isVerifier).length
    || (readString(asRecord(payload?.plan), 'verifierRole') ? 1 : 0);
  const workerCount = Math.max(
    nodes.filter((node) => !node.isVerifier).length,
    countChildren(payload),
    fallback.workerCount ?? 0,
  );

  return {
    id: runId ?? fallback.toolCallId ?? fallback.id ?? 'team-orchestration',
    toolCallId: fallback.toolCallId,
    orchestrationRunId: runId,
    status: normalizeStatus(payload?.status, fallback.status ?? 'running'),
    graphStatus: readString(payload, 'graphStatus') ?? readString(graph, 'status') ?? fallback.graphStatus,
    task: readString(payload, 'task') ?? fallback.task,
    templateId: readString(payload, 'templateId') ?? fallback.templateId,
    graphMode: readString(payload, 'graphMode') ?? readString(graph, 'mode') ?? fallback.graphMode,
    nextAction: readString(payload, 'nextAction') ?? fallback.nextAction,
    pendingVerifier: typeof payload?.pendingVerifier === 'boolean' ? payload.pendingVerifier : fallback.pendingVerifier,
    nodes,
    waves,
    alerts,
    workerCount,
    verifierCount,
    failureCount: arrayOfRecords(payload?.failures).length,
    pendingCount: arrayOfRecords(payload?.pendingGraphNodes).length,
    routeReasons: routeReasons(payload),
    raw: payload ?? fallback.raw,
  };
}

function mergeViews(current: TeamOrchestrationView | undefined, next: TeamOrchestrationView): TeamOrchestrationView {
  if (!current) return next;
  return {
    ...current,
    ...next,
    toolCallId: next.toolCallId ?? current.toolCallId,
    orchestrationRunId: next.orchestrationRunId ?? current.orchestrationRunId,
    task: next.task ?? current.task,
    templateId: next.templateId ?? current.templateId,
    graphMode: next.graphMode ?? current.graphMode,
    graphStatus: next.graphStatus ?? current.graphStatus,
    nextAction: next.nextAction ?? current.nextAction,
    pendingVerifier: next.pendingVerifier ?? current.pendingVerifier,
    nodes: next.nodes.length > 0 ? next.nodes : current.nodes,
    waves: next.waves.length > 0 ? next.waves : current.waves,
    alerts: next.alerts.length > 0 ? next.alerts : current.alerts,
    routeReasons: next.routeReasons.length > 0 ? next.routeReasons : current.routeReasons,
    workerCount: Math.max(next.workerCount, current.workerCount),
    verifierCount: Math.max(next.verifierCount, current.verifierCount),
    failureCount: Math.max(next.failureCount, current.failureCount),
    pendingCount: Math.max(next.pendingCount, current.pendingCount),
    raw: next.raw ?? current.raw,
  };
}

function collectToolResultPayloads(message: RawMessage): Array<{ toolCallId?: string; payload: AnyRecord }> {
  const payloads: Array<{ toolCallId?: string; payload: AnyRecord }> = [];
  const content = message.content;
  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if (block.type !== 'tool_result' && block.type !== 'toolResult') continue;
      const payload = unwrapPayload(block.content ?? block.text);
      if (payload) payloads.push({ toolCallId: block.id, payload });
    }
  }

  const role = normalizeMessageRole(message.role);
  if (role === 'toolresult' || role === 'tool_result') {
    const payload = unwrapPayload(message.content);
    if (payload) payloads.push({ toolCallId: message.toolCallId, payload });
  }

  const textBundle = parseBundleText(extractText(message));
  if (textBundle) payloads.push({ payload: textBundle });
  return payloads;
}

export function deriveTeamOrchestrationViews(
  messages: RawMessage[],
  runtimeRun?: ChatRuntimeRunState | null,
): TeamOrchestrationView[] {
  const byKey = new Map<string, TeamOrchestrationView>();
  const toolCallKeyById = new Map<string, string>();

  const add = (view: TeamOrchestrationView) => {
    const key = view.orchestrationRunId ?? view.toolCallId ?? view.id;
    const previousToolKey = view.toolCallId ? toolCallKeyById.get(view.toolCallId) : undefined;
    const previousToolView = previousToolKey ? byKey.get(previousToolKey) : undefined;
    const existing = previousToolKey && previousToolKey !== key
      ? mergeViews(previousToolView, byKey.get(key) ?? view)
      : byKey.get(key);
    if (previousToolKey && previousToolKey !== key) {
      byKey.delete(previousToolKey);
    }
    byKey.set(key, mergeViews(existing, view));
    if (view.toolCallId) toolCallKeyById.set(view.toolCallId, key);
  };

  for (const message of messages) {
    for (const tool of extractToolUse(message)) {
      if (tool.name !== 'team_orchestrate') continue;
      const input = asRecord(tool.input);
      const view = viewFromPayload(null, {
        id: tool.id || `team-orchestrate-${byKey.size + 1}`,
        toolCallId: tool.id || undefined,
        status: 'running',
        task: readString(input, 'task'),
        templateId: readString(input, 'templateId'),
        graphMode: readString(input, 'graphMode'),
        workerCount: typeof input?.maxWorkers === 'number' ? input.maxWorkers : 0,
      });
      add(view);
    }

    for (const result of collectToolResultPayloads(message)) {
      const fallbackKey = result.toolCallId ? toolCallKeyById.get(result.toolCallId) : undefined;
      const current = fallbackKey ? byKey.get(fallbackKey) : undefined;
      const view = viewFromPayload(result.payload, {
        id: fallbackKey ?? result.toolCallId ?? readString(result.payload, 'orchestrationRunId') ?? `team-orchestrate-${byKey.size + 1}`,
        toolCallId: result.toolCallId,
        task: current?.task,
        templateId: current?.templateId,
        graphMode: current?.graphMode,
        status: current?.status,
      });
      add(view);
    }

    for (const result of message._toolResults ?? []) {
      if (result.toolName && result.toolName !== 'team_orchestrate') continue;
      const payload = unwrapPayload(result.result);
      if (!payload) continue;
      const fallbackKey = result.toolCallId ? toolCallKeyById.get(result.toolCallId) : undefined;
      const current = fallbackKey ? byKey.get(fallbackKey) : undefined;
      const view = viewFromPayload(payload, {
        id: fallbackKey ?? result.toolCallId ?? readString(payload, 'orchestrationRunId') ?? `team-orchestrate-${byKey.size + 1}`,
        toolCallId: result.toolCallId,
        task: current?.task,
        templateId: current?.templateId,
        graphMode: current?.graphMode,
        status: current?.status,
      });
      add(view);
    }
  }

  for (const event of runtimeRun?.events ?? []) {
    if ((event.type !== 'tool.started' && event.type !== 'tool.completed' && event.type !== 'tool.updated')
      || event.name !== 'team_orchestrate') {
      continue;
    }
    const args = event.type === 'tool.started' ? asRecord(event.args) : null;
    const payload = event.type === 'tool.completed' ? unwrapPayload(event.result) : null;
    const currentKey = toolCallKeyById.get(event.toolCallId);
    const current = currentKey ? byKey.get(currentKey) : undefined;
    const view = viewFromPayload(payload, {
      id: currentKey ?? event.toolCallId,
      toolCallId: event.toolCallId,
      status: event.type === 'tool.completed' ? (event.isError ? 'error' : 'completed') : 'running',
      task: readString(args, 'task') ?? current?.task,
      templateId: readString(args, 'templateId') ?? current?.templateId,
      graphMode: readString(args, 'graphMode') ?? current?.graphMode,
      workerCount: current?.workerCount,
    });
    add(view);
  }

  return Array.from(byKey.values()).filter((view) =>
    view.toolCallId
    || view.orchestrationRunId
    || view.nodes.length > 0
    || view.waves.length > 0,
  );
}
