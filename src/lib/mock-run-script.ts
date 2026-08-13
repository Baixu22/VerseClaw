/**
 * mock-run-script.ts — scripted agent runs for browser-only UI development.
 *
 * The renderer receives run data over TWO independent channels, and every
 * transcript surface depends on one or the other:
 *
 *   - `gateway:notification` → `handleChatEvent` → assistant text, streaming
 *     state, and the messages array (which is what `extractGeneratedFiles`,
 *     `parseToolUiContent` and the reply bubble read).
 *   - `chat:runtime-event`   → `handleRuntimeEvent` → the execution graph and,
 *     via run-surface-promotion.ts, the terminal / plan / approval cards.
 *
 * A script that only emitted one of them would leave half the UI dark, which is
 * exactly the state mock mode was in before this file existed.
 *
 * Timings are wall-clock so the streaming affordances (shimmer, elapsed
 * counter, orb states) are actually exercised rather than snapping to done.
 */
import { HOST_EVENT_CHANNELS } from '@shared/host-events/contract';
import type { ChatRuntimeEvent } from '@shared/chat-runtime-events';

export type MockScenario =
  | 'full'
  | 'approval'
  | 'abort'
  | 'toolui'
  /** Tool-call twins of the `toolui` fences — the path the audit's F1 broke. */
  | 'toolcall'
  /** A run blocked on a question_flow tool call, with no final reply. */
  | 'ask'
  /** Only update_plan — the graph has zero rows left after promotion (F10). */
  | 'planonly'
  /** Round 1 raises an approval and finishes without resolving it (F4). */
  | 'carryover'
  /** Reasoning through real thinking deltas + thinking content blocks (F6). */
  | 'thinking'
  /**
   * The session status rail's three conditional sections at once: a
   * `todo_write` plan, a sub-agent fan-out over `agent:subagent-lifecycle`, and
   * a terminal command. Without live data for all three the rail only ever
   * shows Git, so its show-when-real rule is otherwise unverifiable.
   */
  | 'rail';

export type MockRunContext = {
  runId: string;
  sessionKey: string;
  userText: string;
  emit: (channel: string, payload: unknown) => void;
  /** Appends to the mock transcript so `chat.history` reloads stay consistent. */
  appendMessage: (message: Record<string, unknown>) => void;
  setPendingApproval: (approval: Record<string, unknown> | null) => void;
  /** True while an approval is registered and undecided (drives `carryover`). */
  hasPendingApproval: () => boolean;
  /** Resolves once the user approves/denies, or immediately if nothing is pending. */
  waitForApproval: () => Promise<'approved' | 'denied'>;
  /**
   * Marks the workspace terminal session open or closed.
   *
   * `terminal.status()` reports the workspace's own xterm, which is a separate
   * fact from the `command` tool calls a run makes — an agent running commands
   * does not open the user's terminal panel. The rail reads the former, so a
   * scenario that wants its Terminal section has to say so.
   */
  setTerminalRunning: (running: boolean) => void;
  isAborted: () => boolean;
};

const WORKSPACE = 'C:/mock/workspace';

/** `Omit` collapses unions — distribute so each event variant keeps its fields. */
type RuntimeEventInput = ChatRuntimeEvent extends infer Variant
  ? Variant extends ChatRuntimeEvent
    ? Omit<Variant, 'runId' | 'sessionKey'>
    : never
  : never;

function fence(payload: Record<string, unknown>): string {
  return ['```tool-ui', JSON.stringify(payload, null, 2), '```'].join('\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Every Tool UI card type, so one scripted run exercises the whole catalogue. */
function toolUiShowcase(): string {
  return [
    '### Tool UI 卡片总览',
    '',
    '下面覆盖渲染层支持的全部结构化卡片。',
    '',
    fence({
      type: 'plan',
      id: 'showcase-plan',
      title: 'Release checklist',
      todos: [
        { id: 'p1', label: 'Audit render pipeline', status: 'completed' },
        { id: 'p2', label: 'Wire runtime surfaces', status: 'in_progress' },
        { id: 'p3', label: 'Ship mock harness', status: 'pending' },
      ],
    }),
    fence({
      type: 'option-list',
      id: 'showcase-options',
      title: '选择部署目标',
      options: [
        { id: 'staging', label: 'Staging', description: '内部验收环境' },
        { id: 'prod', label: 'Production', description: '面向用户' },
      ],
      selectionMode: 'single',
    }),
    fence({
      type: 'question-flow',
      id: 'showcase-question',
      title: '发布前确认',
      steps: [
        { id: 'q1', question: '是否已跑过单测？', options: [{ id: 'yes', label: '是' }, { id: 'no', label: '否' }] },
        { id: 'q2', question: '是否需要回滚方案？', options: [{ id: 'need', label: '需要' }, { id: 'skip', label: '不需要' }] },
      ],
    }),
    fence({
      type: 'preferences-panel',
      id: 'showcase-preferences',
      title: '渲染偏好',
      preferences: [
        { id: 'inlineDiff', label: '内联 diff', type: 'boolean', value: true },
        { id: 'density', label: '密度', type: 'select', value: 'comfortable', options: [{ value: 'compact', label: '紧凑' }, { value: 'comfortable', label: '舒适' }] },
      ],
    }),
    fence({
      type: 'table',
      id: 'showcase-table',
      title: '渲染器职责',
      columns: [{ key: 'surface', label: 'Surface' }, { key: 'owner', label: 'Renderer' }],
      rows: [
        { surface: 'command.output', owner: 'Terminal card' },
        { surface: 'approval.updated', owner: 'ApprovalCard' },
        { surface: 'update_plan', owner: 'PlanView' },
      ],
    }),
    fence({
      type: 'weather-widget',
      id: 'showcase-weather',
      location: 'Kansas City, MO',
      condition: 'Heavy rain',
      temperature: 72,
      tempMax: 78,
      tempMin: 65,
      unit: 'fahrenheit',
      windSpeed: 12,
      precipitationLevel: 'heavy',
      localTimeOfDay: 22,
      forecast: [
        { day: 'TUE', condition: 'Rain', high: 75, low: 62 },
        { day: 'WED', condition: 'Rain', high: 70, low: 58 },
        { day: 'THU', condition: 'Cloudy', high: 68, low: 55 },
        { day: 'FRI', condition: 'Partly cloudy', high: 72, low: 52 },
        { day: 'SAT', condition: 'Sunny', high: 76, low: 58 },
      ],
    }),
    fence({ type: 'directive-text', id: 'showcase-directive', variant: 'info', text: '所有结构化卡片都从同一个解析器产出。' }),
    fence({
      type: 'source',
      id: 'showcase-source',
      title: '引用',
      sources: [
        { id: 's1', title: 'run-surface-promotion.ts', url: 'https://example.com/promotion' },
        { id: 's2', title: 'agent-interactions.tsx', url: 'https://example.com/interactions' },
      ],
    }),
    fence({ type: 'progress', id: 'showcase-progress', label: '索引构建', value: 72, max: 100, status: 'running' }),
    fence({
      type: 'status-grid',
      id: 'showcase-status-grid',
      items: [
        { id: 'gateway', label: 'Gateway', value: 'running', status: 'ok' },
        { id: 'index', label: 'Index', value: 'stale', status: 'warning' },
        { id: 'queue', label: 'Queue', value: '0', status: 'ok' },
      ],
    }),
    fence({ type: 'alert', id: 'showcase-alert', variant: 'warning', title: '注意', message: '这是 mock 数据，不代表真实运行结果。' }),
    fence({
      type: 'key-value',
      id: 'showcase-kv',
      title: '运行元数据',
      entries: [
        { key: 'runId', value: 'mock-run' },
        { key: 'workspace', value: WORKSPACE },
      ],
    }),
    fence({
      type: 'chart',
      id: 'showcase-chart',
      title: '每轮耗时',
      labels: ['T1', 'T2', 'T3', 'T4'],
      series: [{ name: 'seconds', data: [12, 9, 15, 7] }],
    }),
    fence({
      type: 'image-gallery',
      id: 'showcase-gallery',
      title: '截图',
      images: [
        { id: 'g1', url: 'https://placehold.co/240x160/png', alt: 'before' },
        { id: 'g2', url: 'https://placehold.co/240x160/png', alt: 'after' },
      ],
    }),
    fence({ type: 'code-block', id: 'showcase-code', language: 'typescript', code: 'export const answer = 42;\n' }),
    fence({
      type: 'test-results',
      id: 'showcase-tests',
      title: 'vitest',
      suites: [{
        name: 'run-surface-promotion',
        status: 'passed',
        tests: [
          { name: 'promotes command output', status: 'passed', durationMs: 12 },
          { name: 'drops promoted graph rows', status: 'passed', durationMs: 8 },
        ],
      }],
    }),
    fence({
      type: 'stack-trace',
      id: 'showcase-stack',
      errorType: 'TypeError',
      message: "Cannot read properties of undefined (reading 'todos')",
      stack: 'at parsePlan (agent-interactions.tsx:551)\nat promoteRunSurfaces (run-surface-promotion.ts:120)',
      source: { file: 'src/components/tool-ui/agent-interactions.tsx', line: 551 },
    }),
    fence({
      type: 'chain-of-thought',
      id: 'showcase-cot',
      title: '推理链',
      steps: [
        { title: '定位断层', status: 'complete' },
        { title: '建立职责表', status: 'complete' },
        { title: '接线富卡片', status: 'active' },
      ],
    }),
    fence({
      type: 'task',
      id: 'showcase-task',
      title: '本轮改动',
      items: [
        { label: '新建 promotion 表', files: [{ path: 'src/pages/Chat/run-surface-promotion.ts', status: 'created' }] },
        { label: '接线审批', files: [{ path: 'src/pages/Chat/use-run-approvals.ts', status: 'created' }] },
      ],
    }),
    fence({ type: 'reasoning', id: 'showcase-reasoning', title: '为什么这样拆', text: '同一事件只允许一个渲染器，否则两个视图会各自演化。', summary: '单一职责' }),
    fence({
      type: 'approval-card',
      id: 'showcase-approval',
      title: '发布到 staging？',
      description: '这是模型自述的审批卡（与主机权限审批不同来源）。',
      icon: 'shield-alert',
      confirmLabel: '批准',
      cancelLabel: '拒绝',
      metadata: [{ key: 'target', value: 'staging' }],
    }),
    fence({
      type: 'terminal',
      id: 'showcase-terminal',
      command: 'pnpm vitest run tests/unit/run-surface-promotion.test.ts',
      cwd: WORKSPACE,
      stdout: '✓ tests/unit/run-surface-promotion.test.ts (4)\n\nTest Files  1 passed (1)\n     Tests  4 passed (4)',
      exitCode: 0,
      durationMs: 1840,
    }),
    fence({
      type: 'code-diff',
      id: 'showcase-diff',
      filename: 'src/pages/Chat/execution-projection.ts',
      language: 'typescript',
      oldCode: 'export function sanitizeGraphSteps(steps: TaskStep[]) {\n',
      newCode: 'export function sanitizeGraphSteps(steps: TaskStep[], promotedStepIds?: ReadonlySet<string>) {\n',
    }),
    fence({
      type: 'progress-tracker',
      id: 'showcase-tracker',
      steps: [
        { id: 'audit', label: '审计渲染链路', status: 'completed' },
        { id: 'wire', label: '接线运行时事件', status: 'completed' },
        { id: 'verify', label: '浏览器验收', status: 'in-progress' },
      ],
      choice: { outcome: 'partial', summary: '接线完成，等待验收', at: '2026-08-09T00:00:00.000Z' },
    }),
  ].join('\n\n');
}

const REPLY_PROSE = [
  '我已经把这一轮的执行结果整理好了。',
  '',
  '- 计划卡来自 `update_plan` 运行时事件，不再退化成灰色文本行',
  '- 终端卡来自 `command.output`，执行图里对应的行已被抑制',
  '- 内联 diff 来自 `Edit` 工具产生的 `GeneratedFile` 投影',
  '- 权限审批直接在会话里可批可拒',
  '',
].join('\n');

/**
 * A schema-valid `GitPatchArtifact/v1`. The inline-diff path is deliberately
 * fail-closed: `mutationPatchProjection` refuses to render a diff unless the
 * mutation's tool result carries a complete, lineage-matched patch artifact
 * plus a journal snapshot for the same file. Anything less shows the file chip
 * only. Reproducing that contract here is what makes the mock prove the real
 * path rather than a lookalike.
 */
const PATCH_FILE = 'src/pages/Chat/execution-projection.ts';
const JOURNAL_ENTRY_ID = 'journal-entry-mock-1';

const PATCH_ARTIFACT = {
  schema: 'GitPatchArtifact/v1',
  file: PATCH_FILE,
  status: 'modified',
  contentKind: 'text',
  completeness: 'complete',
  patch: [
    `--- a/${PATCH_FILE}`,
    `+++ b/${PATCH_FILE}`,
    '@@ -120,3 +120,4 @@',
    '-export function sanitizeGraphSteps(steps: TaskStep[]): TaskStep[] {',
    '+export function sanitizeGraphSteps(steps: TaskStep[], promotedStepIds?: ReadonlySet<string>): TaskStep[] {',
    '   return steps.filter((step) => {',
    "     if (step.kind === 'thinking') return false;",
    '+    if (promotedStepIds?.has(step.id)) return false;',
    '',
  ].join('\n'),
  hunks: [{
    oldStart: 120,
    oldLines: 3,
    newStart: 120,
    newLines: 4,
    heading: 'sanitizeGraphSteps',
    lines: [
      { kind: 'deletion', oldLine: 120, newLine: null, text: 'export function sanitizeGraphSteps(steps: TaskStep[]): TaskStep[] {' },
      { kind: 'addition', oldLine: null, newLine: 120, text: 'export function sanitizeGraphSteps(steps: TaskStep[], promotedStepIds?: ReadonlySet<string>): TaskStep[] {' },
      { kind: 'context', oldLine: 121, newLine: 121, text: '  return steps.filter((step) => {' },
      { kind: 'context', oldLine: 122, newLine: 122, text: "    if (step.kind === 'thinking') return false;" },
      { kind: 'addition', oldLine: null, newLine: 123, text: '    if (promotedStepIds?.has(step.id)) return false;' },
    ],
  }],
  lineage: { requestId: 'call-edit', journalEntryId: JOURNAL_ENTRY_ID },
};

const PATCH_TOOL_RESULT_DETAILS = {
  patchArtifacts: [PATCH_ARTIFACT],
  write_journal: {
    snapshots: [{ journalEntryId: JOURNAL_ENTRY_ID, path: PATCH_FILE }],
  },
};

/**
 * Mirror what a real gateway sends when the user hits Stop: an `aborted`
 * message state plus a terminal `run.ended`. Without the latter the run state
 * stays `running` and the turn summary settles as "completed" instead of
 * "stopped".
 */
export function emitMockAbort({
  runId,
  sessionKey,
  emit,
}: Pick<MockRunContext, 'runId' | 'sessionKey' | 'emit'>): void {
  emit(HOST_EVENT_CHANNELS.gateway.notification, {
    method: 'chat',
    params: { runId, sessionKey, seq: Number.MAX_SAFE_INTEGER - 1, state: 'aborted' },
  });
  emit(HOST_EVENT_CHANNELS.chat.runtimeEvent, {
    type: 'run.ended',
    status: 'aborted',
    runId,
    sessionKey,
    seq: Number.MAX_SAFE_INTEGER,
    endedAt: Date.now(),
  } as ChatRuntimeEvent);
}

export async function runMockScript(ctx: MockRunContext, scenario: MockScenario): Promise<void> {
  const { runId, sessionKey, emit } = ctx;
  // The gateway dedupe key is [runId, sessionKey, seq, state] — two events that
  // share a state and carry no seq collapse into one. A real gateway always
  // sends seq; omitting it here silently swallowed the second `final` and left
  // the run hanging forever.
  let seq = 0;
  const runtime = (event: RuntimeEventInput) => {
    seq += 1;
    emit(HOST_EVENT_CHANNELS.chat.runtimeEvent, { ...event, runId, sessionKey, seq, ts: Date.now() } as ChatRuntimeEvent);
  };
  const gateway = (state: string, message?: Record<string, unknown>) => {
    seq += 1;
    emit(HOST_EVENT_CHANNELS.gateway.notification, {
      method: 'chat',
      params: { runId, sessionKey, seq, state, ...(message ? { message } : {}) },
    });
  };
  const stopped = () => ctx.isAborted();

  /** Sub-agent lifecycle travels on its own channel, not the chat run's. */
  const subagent = (event: Record<string, unknown>) => {
    emit(HOST_EVENT_CHANNELS.subagent.lifecycle, {
      runId,
      sessionKey,
      ts: Date.now(),
      ...event,
    });
  };

  runtime({ type: 'run.started', startedAt: Date.now() });
  gateway('started');

  /**
   * Append an assistant turn that is a bare TOOL CALL — the shape the audit's
   * F1 made invisible. `appendMessage` keeps `chat.history` consistent;
   * `gateway('final', …)` is how a real gateway lands an intermediate
   * tool-use turn in the transcript.
   */
  const toolCallTurn = (id: string, name: string, input: Record<string, unknown>) => {
    const turn = {
      role: 'assistant',
      id: `${runId}-${id}`,
      timestamp: Date.now() / 1000,
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id, name, input }],
    };
    ctx.appendMessage(turn);
    gateway('final', turn);
    runtime({ type: 'tool.started', toolCallId: id, name, args: input });
  };

  const finishRun = (finalMessage: Record<string, unknown>) => {
    ctx.appendMessage(finalMessage);
    gateway('final', finalMessage);
    runtime({
      type: 'run.ended',
      status: 'completed',
      endedAt: Date.now(),
      tokenUsage: { input: 1180, output: 460, cacheRead: 200, total: 1840 },
    });
  };

  // ── F1 contrast group: the same cards `toolui` sends as fences, as calls ──
  if (scenario === 'toolcall') {
    await sleep(300);
    if (stopped()) return;
    toolCallTurn('call-weather', 'weather', {
      location: 'Kansas City, MO',
      temperature: 72,
      condition: 'Heavy rain',
      tempMax: 78,
      tempMin: 65,
      unit: 'f',
    });
    await sleep(240);
    if (stopped()) return;
    runtime({ type: 'tool.completed', toolCallId: 'call-weather', name: 'weather', result: 'shown' });
    toolCallTurn('call-table', 'table', {
      title: '渲染器职责',
      columns: [{ key: 'surface', label: 'Surface' }, { key: 'owner', label: 'Renderer' }],
      rows: [
        { surface: 'command.output', owner: 'Terminal card' },
        { surface: 'update_plan', owner: 'PlanView' },
      ],
    });
    await sleep(240);
    if (stopped()) return;
    runtime({ type: 'tool.completed', toolCallId: 'call-table', name: 'table', result: 'shown' });
    toolCallTurn('call-chart', 'chart', {
      title: '每轮耗时',
      labels: ['T1', 'T2', 'T3', 'T4'],
      series: [{ name: 'seconds', data: [12, 9, 15, 7] }],
    });
    await sleep(240);
    if (stopped()) return;
    runtime({ type: 'tool.completed', toolCallId: 'call-chart', name: 'chart', result: 'shown' });

    finishRun({
      role: 'assistant',
      id: `${runId}-reply`,
      timestamp: Date.now() / 1000,
      stop_reason: 'end_turn',
      content: [{
        type: 'text',
        text: '上面三张卡片都是以工具调用（tool_use block）发出的 —— 与 `?script=toolui` 的围栏路径互为对照组。',
      }],
    });
    return;
  }

  // ── F1 worst symptom: a run BLOCKED on a question the user must see ──
  if (scenario === 'ask') {
    await sleep(300);
    if (stopped()) return;
    runtime({ type: 'thinking.delta', delta: '两个部署目标都可行，需要用户拍板…' });
    await sleep(360);
    if (stopped()) return;
    toolCallTurn('call-ask', 'question_flow', {
      title: '发布前确认',
      steps: [{
        id: 'target',
        question: '要发布到哪个环境？',
        options: [
          { id: 'staging', label: 'Staging', description: '内部验收' },
          { id: 'prod', label: 'Production', description: '面向用户' },
        ],
      }],
    });
    // Deliberately NO final reply and NO run.ended: the run is waiting on the
    // user. If the question card is not visible, this run looks hung — which
    // is exactly what production did before the F1 fix.
    return;
  }

  /* ── Session status rail: plan + sub-agents + terminal, all live ──
   *
   * Ordered so each rail section appears in turn: the plan lands first (Process
   * section), then two workers start and settle (Sub-agents), then a command
   * runs (Terminal). Worker events carry `childSessionKey` so the rail can hand
   * a transcript to the Agents tab; without it the row would open an empty pane.
   */
  if (scenario === 'rail') {
    await sleep(280);
    if (stopped()) return;

    const todos = [
      { content: '梳理审计发现', status: 'completed' },
      { content: '拆分子智能体任务', status: 'completed' },
      { content: '并行核对渲染回归', status: 'in_progress' },
      { content: '固化门禁与证据', status: 'pending' },
    ];
    // `todo_write` rather than `update_plan`: both promote to the same plan
    // surface, and this exercises the alias the rail's source list declares.
    runtime({ type: 'tool.started', toolCallId: 'call-rail-plan', name: 'todo_write', args: { todos } });
    await sleep(240);
    if (stopped()) return;
    runtime({ type: 'tool.completed', toolCallId: 'call-rail-plan', name: 'todo_write', result: { todos } });

    const workers = [
      { roleName: 'explorer', task: '检索 rail 相关渲染路径与既有组件', childSessionKey: 'agent:explorer:rail-scout' },
      { roleName: 'reviewer', task: '核对 rail 与 composer 下拉的样式一致性', childSessionKey: 'agent:reviewer:rail-review' },
    ];
    for (const [index, worker] of workers.entries()) {
      await sleep(220);
      if (stopped()) return;
      subagent({
        ...worker,
        taskNodeId: `rail-node-${index + 1}`,
        agentId: worker.roleName,
        status: 'started',
      });
    }

    await sleep(420);
    if (stopped()) return;
    subagent({
      ...workers[0],
      taskNodeId: 'rail-node-1',
      agentId: workers[0].roleName,
      status: 'completed',
      summary: '已定位 3 处可复用组件',
    });

    await sleep(260);
    if (stopped()) return;
    // The rail's Terminal section reads the workspace shell, not this tool call.
    ctx.setTerminalRunning(true);
    runtime({
      type: 'tool.started',
      toolCallId: 'call-rail-term',
      name: 'command',
      args: { command: 'pnpm vitest run tests/unit/session-status-rail.test.ts', cwd: WORKSPACE },
    });
    await sleep(360);
    if (stopped()) return;
    runtime({
      type: 'tool.completed',
      toolCallId: 'call-rail-term',
      name: 'command',
      result: { command: 'pnpm vitest run tests/unit/session-status-rail.test.ts', exitCode: 0, output: 'Tests  15 passed (15)' },
    });

    finishRun({
      role: 'assistant',
      id: `${runId}-reply`,
      timestamp: Date.now() / 1000,
      stop_reason: 'end_turn',
      content: [{
        type: 'text',
        text: '会话状态栏应显示四段：Git、进程（3/4）、子智能体（explorer 已完成 / reviewer 运行中）、终端。reviewer 仍在运行，因此折叠态角标为 1。',
      }],
    });
    return;
  }

  // ── F10: every graph row promoted away; the plan is the only surface ──
  if (scenario === 'planonly') {
    await sleep(300);
    if (stopped()) return;
    const planArgs = {
      explanation: '只有计划，没有命令和文件改动',
      plan: [
        { step: '梳理审计发现', status: 'completed' },
        { step: '定位职责表缺口', status: 'in_progress' },
        { step: '固化回归测试', status: 'pending' },
      ],
    };
    runtime({ type: 'tool.started', toolCallId: 'call-plan-only', name: 'update_plan', args: planArgs });
    await sleep(280);
    if (stopped()) return;
    runtime({ type: 'tool.completed', toolCallId: 'call-plan-only', name: 'update_plan', result: planArgs });

    finishRun({
      role: 'assistant',
      id: `${runId}-reply`,
      timestamp: Date.now() / 1000,
      stop_reason: 'end_turn',
      content: [{
        type: 'text',
        text: '这一轮只产出了计划。折叠头应有「计划」角标；展开后只有计划卡，不应出现空的执行图壳。',
      }],
    });
    return;
  }

  // ── F4: an approval raised and left UNDECIDED across turns ──
  if (scenario === 'carryover') {
    await sleep(300);
    if (stopped()) return;
    if (!ctx.hasPendingApproval()) {
      // Round 1: raise the approval, then finish WITHOUT resolving it. The
      // host is still holding it, so the card must survive the next turn.
      ctx.setPendingApproval({
        id: `approval-${runId}`,
        workspaceId: 'ws-mock-demo',
        sessionKey,
        runId,
        source: 'terminal',
        risk: 'dangerous',
        status: 'pending',
        mode: 'fullAccess',
        reason: '需要删除 dist 目录 —— 本轮故意不解决，验证跨轮存活',
        command: 'rm -rf ./dist',
        cwd: WORKSPACE,
        paths: [`${WORKSPACE}/dist`],
        paramsPreview: '{"command":"rm -rf ./dist"}',
        requestedAt: Date.now(),
      });
      runtime({
        type: 'approval.updated',
        itemId: `approval-${runId}`,
        toolCallId: 'call-blocked',
        title: 'Permission required',
        phase: 'pending',
        status: 'pending',
        message: 'rm -rf ./dist',
      });
      await sleep(300);
      if (stopped()) return;
      finishRun({
        role: 'assistant',
        id: `${runId}-reply`,
        timestamp: Date.now() / 1000,
        stop_reason: 'end_turn',
        content: [{
          type: 'text',
          text: '权限请求已挂起且**未决**。现在发送下一条消息 —— 审批卡片必须仍然可见、可决策（F4 回归）。',
        }],
      });
      return;
    }
    // Round 2+: a plain reply. The undecided approval from round 1 must still
    // be visible even though this run never touches it.
    await sleep(400);
    if (stopped()) return;
    finishRun({
      role: 'assistant',
      id: `${runId}-reply`,
      timestamp: Date.now() / 1000,
      stop_reason: 'end_turn',
      content: [{
        type: 'text',
        text: '这是新的一轮。上一轮的审批仍未决 —— 卡片如果消失了，就是 F4 复发。',
      }],
    });
    return;
  }

  // ── F6: reasoning through the REAL channels — deltas live, blocks in history ──
  if (scenario === 'thinking') {
    const thoughts = [
      '先读 auth 中间件，定位 jwt.verify 的调用点。',
      'verify 没有设置 algorithms 白名单，弱算法 token 可能被接受。',
      '准备把算法固定为 HS256，并补一条拒绝未签名 token 的回归测试。',
    ];
    let accumulated = '';
    for (const thought of thoughts) {
      await sleep(420);
      if (stopped()) return;
      accumulated = accumulated ? `${accumulated}\n\n${thought}` : thought;
      runtime({ type: 'thinking.delta', text: accumulated });
    }
    await sleep(420);
    if (stopped()) return;
    const replyText = '已定位问题并准备好补丁。推理过程通过真实的 `thinking` 内容块承载 —— 不再依赖不存在的 `metadata.reasoning`。';
    runtime({ type: 'assistant.delta', text: replyText, replace: true });
    gateway('delta', {
      role: 'assistant',
      timestamp: Date.now() / 1000,
      content: [{ type: 'text', text: replyText }],
    });
    await sleep(300);
    if (stopped()) return;
    finishRun({
      role: 'assistant',
      id: `${runId}-reply`,
      timestamp: Date.now() / 1000,
      stop_reason: 'end_turn',
      content: [
        ...thoughts.map((thinking) => ({ type: 'thinking', thinking })),
        { type: 'text', text: replyText },
      ],
    });
    return;
  }

  await sleep(220);
  if (stopped()) return;
  runtime({ type: 'thinking.delta', delta: '先看一遍执行图和卡片的接线状态…' });

  if (scenario !== 'toolui') {
    // ── Plan ────────────────────────────────────────────────────────────
    await sleep(420);
    if (stopped()) return;
    const planArgs = {
      explanation: '把这轮要验证的渲染面拆成三步',
      plan: [
        { step: '跑通运行时事件 → 富卡片', status: 'in_progress' },
        { step: '确认执行图不再重复渲染', status: 'pending' },
        { step: '核对 Tool UI 卡片全量', status: 'pending' },
      ],
    };
    runtime({ type: 'tool.started', toolCallId: 'call-plan', name: 'update_plan', args: planArgs });
    await sleep(320);
    if (stopped()) return;
    runtime({ type: 'tool.completed', toolCallId: 'call-plan', name: 'update_plan', result: planArgs });

    // ── Command ─────────────────────────────────────────────────────────
    await sleep(280);
    if (stopped()) return;
    const command = 'pnpm vitest run tests/unit/run-surface-promotion.test.ts';
    runtime({ type: 'tool.started', toolCallId: 'call-bash', name: 'bash', args: { command, cwd: WORKSPACE } });
    await sleep(360);
    if (stopped()) return;
    runtime({
      type: 'command.output',
      itemId: 'cmd-1',
      toolCallId: 'call-bash',
      name: 'bash',
      title: command,
      cwd: WORKSPACE,
      output: '$ pnpm vitest run tests/unit/run-surface-promotion.test.ts\n\n RUN  v3.0.0\n',
      phase: 'delta',
      status: 'running',
    });
    await sleep(520);
    if (stopped()) return;
    runtime({
      type: 'command.output',
      itemId: 'cmd-1',
      toolCallId: 'call-bash',
      name: 'bash',
      title: command,
      cwd: WORKSPACE,
      output: '$ pnpm vitest run tests/unit/run-surface-promotion.test.ts\n\n RUN  v3.0.0\n\n ✓ tests/unit/run-surface-promotion.test.ts (4)\n\n Test Files  1 passed (1)\n      Tests  4 passed (4)\n   Duration  1.84s\n',
      phase: 'end',
      status: 'completed',
      exitCode: 0,
      durationMs: 1840,
    });
    runtime({ type: 'tool.completed', toolCallId: 'call-bash', name: 'bash', result: 'exit 0' });
  }

  // ── Host permission approval ──────────────────────────────────────────
  if (scenario === 'full' || scenario === 'approval') {
    await sleep(320);
    if (stopped()) return;
    ctx.setPendingApproval({
      id: 'approval-mock-1',
      workspaceId: 'ws-mock-demo',
      sessionKey,
      runId,
      source: 'terminal',
      risk: 'dangerous',
      status: 'pending',
      mode: 'fullAccess',
      reason: '需要在工作区外执行 `rm -rf ./dist` ——请确认',
      command: 'rm -rf ./dist',
      cwd: WORKSPACE,
      paths: [`${WORKSPACE}/dist`],
      paramsPreview: '{"command":"rm -rf ./dist"}',
      requestedAt: Date.now(),
    });
    runtime({
      type: 'approval.updated',
      itemId: 'approval-mock-1',
      toolCallId: 'call-bash-2',
      title: 'Permission required',
      phase: 'pending',
      status: 'pending',
      message: 'rm -rf ./dist',
    });

    const decision = await ctx.waitForApproval();
    if (stopped()) return;
    runtime({
      type: 'approval.updated',
      itemId: 'approval-mock-1',
      toolCallId: 'call-bash-2',
      title: 'Permission required',
      phase: 'resolved',
      status: decision,
      message: `user ${decision}`,
    });
  }

  if (scenario === 'abort') {
    // The composer's Stop button drives the abort; idle here so the user can
    // actually reach it, then let the abort path finalize the run.
    await sleep(20_000);
    return;
  }

  // ── File mutation → inline diff ───────────────────────────────────────
  if (scenario !== 'toolui') {
    await sleep(260);
    if (stopped()) return;
    const editArgs = {
      file_path: PATCH_FILE,
      old_string: 'export function sanitizeGraphSteps(steps: TaskStep[]): TaskStep[] {',
      new_string: 'export function sanitizeGraphSteps(steps: TaskStep[], promotedStepIds?: ReadonlySet<string>): TaskStep[] {',
    };
    runtime({ type: 'tool.started', toolCallId: 'call-edit', name: 'Edit', args: editArgs });
    // Tool-only assistant turn: keeps the run open AND puts the tool_use into
    // `messages`, which is where `extractGeneratedFiles` reads mutations from.
    const toolTurn = {
      role: 'assistant',
      id: `${runId}-tool-edit`,
      timestamp: Date.now() / 1000,
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'call-edit', name: 'Edit', input: editArgs }],
    };
    ctx.appendMessage(toolTurn);
    gateway('final', toolTurn);
    await sleep(320);
    if (stopped()) return;
    // The tool result carries the patch artifact + journal snapshot the inline
    // diff gate requires. History folds it onto the assistant turn above.
    const toolResult = {
      role: 'toolresult',
      id: `${runId}-tool-edit-result`,
      timestamp: Date.now() / 1000,
      toolCallId: 'call-edit',
      toolName: 'Edit',
      details: PATCH_TOOL_RESULT_DETAILS,
      content: [{ type: 'text', text: '1 file changed' }],
    };
    ctx.appendMessage(toolResult);
    gateway('final', toolResult);
    runtime({ type: 'tool.completed', toolCallId: 'call-edit', name: 'Edit', result: 'ok' });
    runtime({
      type: 'patch.completed',
      itemId: 'patch-1',
      toolCallId: 'call-edit',
      name: 'Edit',
      title: 'src/pages/Chat/execution-projection.ts',
      summary: '1 file changed, +2 -1',
      modified: 1,
    });
  }

  // ── Assistant reply ───────────────────────────────────────────────────
  await sleep(280);
  if (stopped()) return;
  const replyText = scenario === 'toolui'
    ? toolUiShowcase()
    : `${REPLY_PROSE}\n${toolUiShowcase()}`;

  const chunkSize = Math.max(48, Math.ceil(replyText.length / 24));
  for (let cursor = 0; cursor < replyText.length; cursor += chunkSize) {
    if (stopped()) return;
    const partial = replyText.slice(0, cursor + chunkSize);
    runtime({ type: 'assistant.delta', text: partial, replace: true });
    gateway('delta', {
      role: 'assistant',
      timestamp: Date.now() / 1000,
      content: [{ type: 'text', text: partial }],
    });
    await sleep(70);
  }

  if (stopped()) return;
  const finalMessage = {
    role: 'assistant',
    id: `${runId}-reply`,
    timestamp: Date.now() / 1000,
    stop_reason: 'end_turn',
    content: [
      /*
       * Reasoning rides REAL `thinking` content blocks — the channel the
       * runtime actually emits. This used to be a fake `metadata.reasoning`
       * list, which made the mock prove a producer that never existed and
       * masked the audit's F6 for as long as it stood.
       */
      { type: 'thinking', thinking: '读取请求与当前选区，定位 auth 中间件里的 jwt.verify 调用。' },
      { type: 'thinking', thinking: 'verify 没有设置 algorithms 白名单，用 none 或弱算法签名的 token 可能被接受。' },
      { type: 'thinking', thinking: '准备把算法固定为 HS256，附一条拒绝篡改、过期与未签名 token 的回归测试。' },
      { type: 'text', text: replyText },
    ],
  };
  ctx.appendMessage(finalMessage);
  gateway('final', finalMessage);
  runtime({
    type: 'run.ended',
    status: 'completed',
    endedAt: Date.now(),
    tokenUsage: { input: 4210, output: 1180, cacheRead: 900, total: 6290 },
  });
}
