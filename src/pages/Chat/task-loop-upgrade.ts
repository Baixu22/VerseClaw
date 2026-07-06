import {
  createTaskLoopUpgradeSuggestion,
  type TaskLoopUpgradeSuggestion,
} from '@shared/product-semantics';

const IMPLEMENTATION_TERMS = [
  /修复/u,
  /实现/u,
  /开发/u,
  /补齐/u,
  /落地/u,
  /重构/u,
  /改造/u,
  /\b(fix|implement|build|ship|refactor|migrate)\b/iu,
];

const VALIDATION_TERMS = [
  /测试/u,
  /验证/u,
  /通过/u,
  /\b(unit|e2e|test|tests|typecheck|lint|build|verify)\b/iu,
];

const CONTROL_TERMS = [
  /按照顺序/u,
  /必须/u,
  /失败/u,
  /完成.*继续/u,
  /不能.*继续/u,
  /\b(sequence|checkpoint|repair|blocked|done|failure|pass|green)\b/iu,
];

const PROJECT_TERMS = [
  /项目/u,
  /技术债/u,
  /应用层/u,
  /架构/u,
  /\bp[01]\b/iu,
  /\b(project|workflow|runtime|architecture|debt)\b/iu,
];

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function extractTaskTitle(text: string): string {
  const normalized = text.trim().replace(/\s+/g, ' ');
  const implementationMatch = normalized.match(/(?:修复|实现|开发|补齐|落地|重构|改造)[^，。,.；;!?]{2,40}/u);
  if (implementationMatch?.[0]) return implementationMatch[0].trim();

  const englishMatch = normalized.match(/\b(?:fix|implement|build|ship|refactor|migrate)\b[^，。,.；;!?]{2,60}/iu);
  if (englishMatch?.[0]) return englishMatch[0].trim();

  return normalized.slice(0, 80);
}

export function detectTaskLoopUpgradeSuggestion(input: {
  text: string;
  sessionId: string | null | undefined;
}): TaskLoopUpgradeSuggestion | null {
  const text = input.text.trim();
  const sessionId = input.sessionId?.trim();
  if (!text || !sessionId) return null;

  const signals = [
    hasAny(text, IMPLEMENTATION_TERMS),
    hasAny(text, VALIDATION_TERMS),
    hasAny(text, CONTROL_TERMS),
    hasAny(text, PROJECT_TERMS),
  ].filter(Boolean).length;

  if (signals < 3 || text.length < 24) return null;

  return createTaskLoopUpgradeSuggestion({
    sessionId,
    taskTitle: extractTaskTitle(text),
    reason: 'Detected implementation, validation, and sequencing constraints suited to Task Loop.',
  });
}

type GatewayRpc = <T = unknown>(method: string, params?: unknown, timeoutMs?: number) => Promise<T>;

export type TaskLoopUpgradeRunResult = {
  loopRunId: string;
  status: string;
  phase: string;
  rawLoop: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readLoopPayload(result: unknown): Record<string, unknown> {
  const record = isRecord(result) ? result : {};
  if (record.success === false) {
    throw new Error(String(record.error ?? 'Task Loop run was rejected'));
  }
  const data = isRecord(record.data) ? record.data : record;
  const loop = isRecord(data.loop) ? data.loop : data;
  return loop;
}

export async function startTaskLoopUpgradeRun(input: {
  rpc: GatewayRpc;
  suggestion: TaskLoopUpgradeSuggestion;
  taskText: string;
  sessionKey: string | null | undefined;
  agentId: string | null | undefined;
  workspaceId?: string | null;
}): Promise<TaskLoopUpgradeRunResult> {
  const task = input.taskText.trim() || input.suggestion.taskTitle.trim();
  const sessionKey = input.sessionKey?.trim();
  if (!task) throw new Error('Task Loop upgrade requires a task');
  if (!sessionKey) throw new Error('Task Loop upgrade requires a session');

  const params = {
    task,
    sessionKey,
    ...(input.agentId?.trim() ? { agentId: input.agentId.trim() } : {}),
    ...(input.workspaceId?.trim() ? { workspaceId: input.workspaceId.trim() } : {}),
  };

  const result = await input.rpc('task_loop.run', params, 600000);
  const loop = readLoopPayload(result);
  return {
    loopRunId: String(loop.loopRunId ?? ''),
    status: String(loop.status ?? ''),
    phase: String(loop.phase ?? ''),
    rawLoop: loop,
  };
}
