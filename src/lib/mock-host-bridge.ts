/**
 * mock-host-bridge.ts — browser-only mock Host API for UI development.
 *
 * The renderer talks to Electron through `window.verseClaw.hostInvoke`.
 * When developing UI in a plain browser (no Electron), that bridge is
 * undefined and every host call fails — the app falls into setup, the
 * gateway reads "stopped", the composer is disabled, and none of the
 * surfaces you are trying to style can be exercised.
 *
 * This module installs a fixture-backed `window.verseClaw.hostInvoke` that
 * answers the host calls the UI actually makes with benign, realistic
 * fixtures. It is gated by `?mock=1` (or `--mock` via the npm script) so it
 * can never leak into normal dev or production runs.
 *
 * Usage:
 *   pnpm dev:mock            # vite + this bridge, seeded fixtures
 *   pnpm dev:mock -- --port 5199
 *
 * The bridge intentionally keeps the REQUEST/RESPONSE path real: the app's
 * stores, IPC plumbing (`invokeHost`), and UI all run their actual code —
 * only the transport endpoint is replaced. Extend `FIXTURES` below for new
 * host surfaces; everything the app probes is handled or returns a safe
 * empty-state.
 */

import type { HostRequest } from '@shared/host-api/types';
import { OPENCLAW_GATEWAY_PORT } from '@shared/gateway-endpoint';
import { emitMockAbort, runMockScript, type MockScenario } from './mock-run-script';

/** Shape of the staged-file payload the composer sends. */
type StageBufferPayload = {
  base64?: string;
  fileName?: string;
  mimeType?: string;
};

/* ────────────────────────────────────────────────────────────────────────────
 * In-memory IPC bus.
 *
 * Runtime events reach the renderer through `window.electron.ipcRenderer`
 * (see src/lib/host-events.ts). Stubbing that out — as this bridge used to —
 * silently disables every streaming surface: execution graph, terminal cards,
 * approvals, plan, token counters. The bus below re-enables them by letting the
 * scripted run publish on the very channels the real preload uses.
 * ──────────────────────────────────────────────────────────────────────────── */

type BusHandler = (...args: unknown[]) => void;
const busListeners = new Map<string, Set<BusHandler>>();

function busOn(channel: string, handler: BusHandler): () => void {
  const existing = busListeners.get(channel) ?? new Set<BusHandler>();
  existing.add(handler);
  busListeners.set(channel, existing);
  return () => {
    existing.delete(handler);
  };
}

function busEmit(channel: string, payload: unknown): void {
  const handlers = busListeners.get(channel);
  if (!handlers) return;
  for (const handler of Array.from(handlers)) {
    try {
      handler(payload);
    } catch (error) {
      console.warn(`[mock-bus] handler for ${channel} threw`, error);
    }
  }
}

function ok<T>(id: string | undefined, data: T) {
  return { id, ok: true as const, data };
}

function fail(id: string | undefined, message: string) {
  return { id, ok: false as const, error: { message } };
}

const NOW = 1_781_900_000_000;

/** A gradient PNG data URL — stands in for a staged image preview. */
function makeGradientPreview(): string {
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 96;
  const cx = c.getContext('2d');
  if (!cx) return 'data:image/png;base64,';
  const g = cx.createLinearGradient(0, 0, 96, 96);
  g.addColorStop(0, '#ff6b6b');
  g.addColorStop(0.5, '#4ecdc4');
  g.addColorStop(1, '#45b7d1');
  cx.fillStyle = g;
  cx.fillRect(0, 0, 96, 96);
  return c.toDataURL('image/png');
}

/* ────────────────────────────────────────────────────────────────────────────
 * Workspace + session fixtures.
 *
 * MUTABLE on purpose. The sidebar's folder tree cannot be exercised against a
 * frozen fixture: asserting "renaming a nested workgroup does not rename its
 * ancestor" (the audit's F2) requires the rename to actually land somewhere.
 * The folder fixtures below mutate this state and answer with the same
 * `{ profiles, activeWorkspaceId, activeWorkspace }` snapshot shape the real
 * host returns, which is what `stores/workspaces.ts#applySnapshot` consumes.
 * ──────────────────────────────────────────────────────────────────────────── */

type MockSessionFolder = {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
  kind: 'workgroup';
  createdAt: number;
  updatedAt: number;
};

/** root-a → child-a1 → grandchild-a2, plus a flat sibling — mirrors the F2 regression tree. */
const workspaceFolders: MockSessionFolder[] = [
  { id: 'folder-root-a', name: '渲染修复', parentId: null, order: 0, kind: 'workgroup', createdAt: NOW, updatedAt: NOW },
  { id: 'folder-child-a1', name: '审计回归', parentId: 'folder-root-a', order: 1, kind: 'workgroup', createdAt: NOW + 1, updatedAt: NOW + 1 },
  { id: 'folder-grandchild-a2', name: '深层用例', parentId: 'folder-child-a1', order: 2, kind: 'workgroup', createdAt: NOW + 2, updatedAt: NOW + 2 },
  { id: 'folder-root-b', name: '发布准备', parentId: null, order: 3, kind: 'workgroup', createdAt: NOW + 3, updatedAt: NOW + 3 },
];

/** One session nested deep (exercises F3's way-back-out) and one mid-level. */
const sessionFolderAssignments: Record<string, string> = {
  'agent:main:audit-regression': 'folder-child-a1',
  'agent:main:deep-case': 'folder-grandchild-a2',
  'agent:main:mock-catalogue': 'folder-root-b',
  'agent:main:release-notes': 'folder-root-b',
};

/**
 * Timestamps are relative to the real clock so the unfiled area's time
 * slices (today / this week / earlier) all materialize; `release-notes`
 * forked from `mock-catalogue` inside the same stream drives the lineage
 * thread; `idle-scratch` forked from `main` drives it in the unfiled area.
 */
const SESSION_NOW = Date.now();
const DEMO_SESSIONS = [
  { key: 'agent:main:main', displayName: '主会话', updatedAt: SESSION_NOW, status: 'active' },
  { key: 'agent:main:audit-regression', displayName: '审计回归验证', updatedAt: SESSION_NOW - 60_000, status: 'active' },
  { key: 'agent:main:deep-case', displayName: '深层嵌套用例', updatedAt: SESSION_NOW - 120_000, status: 'active' },
  { key: 'agent:main:mock-catalogue', displayName: 'Mock 场景目录', updatedAt: SESSION_NOW - 3 * 3_600_000, status: 'active' },
  { key: 'agent:main:release-notes', displayName: '发布说明草稿', updatedAt: SESSION_NOW - 2 * 86_400_000, status: 'active', parentSessionKey: 'agent:main:mock-catalogue', forkedFromParent: true },
  { key: 'agent:main:probe-archive', displayName: '发布回溯', updatedAt: SESSION_NOW - 3 * 86_400_000, status: 'active' },
  { key: 'agent:main:idle-scratch', displayName: '闲置草稿', updatedAt: SESSION_NOW - 30 * 86_400_000, status: 'active', parentSessionKey: 'agent:main:main', forkedFromParent: true },
];

let folderSeq = workspaceFolders.length;

/**
 * `?sessions=rich` adds the session list's harder cases, opt-in so the default
 * fixture stays what other walkthroughs expect:
 *  - a title far wider than a row, for the hover marquee;
 *  - a session with a run in flight, for the row orb and the header bell's
 *    live ring and "Running" section;
 *  - a session blocked on the user, for the amber "needs you" state.
 */
const RICH_SESSIONS = [
  { key: 'agent:main:long-title', displayName: '侧边栏会话区域的交互与视觉打磨：悬停跑马灯、操作收纳与活动中心', updatedAt: SESSION_NOW - 30_000, status: 'active' },
  { key: 'agent:main:live-run', displayName: '后台构建与回归测试', updatedAt: SESSION_NOW - 10_000, status: 'running', hasActiveRun: true },
  { key: 'agent:main:needs-input', displayName: '数据库迁移审批', updatedAt: SESSION_NOW - 20_000, status: 'waiting_approval', hasActiveRun: true },
];

function richSessionsRequested(): boolean {
  return stickyMockParam('sessions') === 'rich';
}

/** Keys archived through the sidebar; `sessions.restore` brings them back. */
const archivedSessionKeys = new Set<string>();

/** Every session this workspace owns, before archive filtering. */
function workspaceSessions() {
  return richSessionsRequested() ? [...DEMO_SESSIONS, ...RICH_SESSIONS] : DEMO_SESSIONS;
}

/** The workspace snapshot is derived per call so folder mutations are visible. */
function currentWorkspace() {
  return {
    id: 'ws-mock-demo',
    name: 'mock-workspace',
    rootPath: 'C:\\mock\\workspace',
    agentId: 'agent-mock',
    activeSessionKey: 'agent:main:main',
    permissionMode: 'fullAccess',
    createdAt: NOW,
    updatedAt: NOW,
    lastOpenedAt: NOW,
    state: 'active',
    sessionStates: Object.fromEntries(workspaceSessions().map((session) => [session.key, {}])),
    sessionFolders: workspaceFolders.map((folder) => ({ ...folder })),
    sessionFolderAssignments: { ...sessionFolderAssignments },
  };
}

/**
 * A SECOND workspace, behind `?workspaces=2`.
 *
 * The sidebar hides the workspace row when there is only one — a lone workspace
 * is context, not a tree node, and its folder-icon column was charging the whole
 * tree a level of indent. That conditional has two branches and only one of them
 * was reachable from this fixture, so the hidden branch could regress silently.
 * The second workspace owns one session and no groups; that is enough to prove
 * the row reappears and the sessions file under the right heading.
 */
const SECOND_WORKSPACE_SESSION = {
  key: 'agent:main:sandbox-probe',
  displayName: '沙箱探针',
  updatedAt: SESSION_NOW - 5 * 3_600_000,
  status: 'active',
} as const;

function secondWorkspaceRequested(): boolean {
  return stickyMockParam('workspaces') === '2';
}

function secondWorkspace() {
  return {
    id: 'ws-mock-sandbox',
    name: 'sandbox-workspace',
    rootPath: 'C:\\mock\\sandbox',
    agentId: 'agent-mock',
    activeSessionKey: SECOND_WORKSPACE_SESSION.key,
    permissionMode: 'fullAccess',
    createdAt: NOW,
    updatedAt: NOW,
    lastOpenedAt: NOW - 60_000,
    state: 'active',
    sessionStates: { [SECOND_WORKSPACE_SESSION.key]: {} },
    sessionFolders: [],
    sessionFolderAssignments: {},
  };
}

/** The second workspace's session has to be resolvable, or its group renders empty. */
function listedSessions() {
  const sessions = secondWorkspaceRequested()
    ? [...workspaceSessions(), SECOND_WORKSPACE_SESSION]
    : workspaceSessions();
  return sessions.filter((session) => !archivedSessionKeys.has(session.key));
}

function workspaceSnapshot(extra?: Record<string, unknown>) {
  const workspace = currentWorkspace();
  return {
    ok: true,
    profiles: secondWorkspaceRequested() ? [workspace, secondWorkspace()] : [workspace],
    activeWorkspaceId: workspace.id,
    activeWorkspace: workspace,
    ...(extra ?? {}),
  };
}

const DEMO_WORKSPACE = currentWorkspace();

/** One enabled provider account, so the composer's first-send gate opens. */
const DEMO_ACCOUNT = {
  id: 'acc-mock',
  vendorId: 'anthropic',
  label: 'Mock Anthropic',
  authMode: 'api_key',
  // Keep one concrete model in the browser fixture so the composer can
  // exercise the model picker without requiring provider setup.
  model: 'claude-sonnet-4',
  enabled: true,
  isDefault: true,
  createdAt: new Date(NOW).toISOString(),
  updatedAt: new Date(NOW).toISOString(),
} as const;

const DEMO_AGENT = {
  id: 'main',
  name: 'Main',
  isDefault: true,
  modelDisplay: 'claude-sonnet-4',
  modelRef: 'anthropic/claude-sonnet-4',
  overrideModelRef: null,
  inheritedModel: false,
  reasoningEffort: 'auto',
  workspace: DEMO_WORKSPACE.rootPath,
  agentDir: `${DEMO_WORKSPACE.rootPath}\\.openclaw\\agents\\main`,
  mainSessionKey: 'agent:main:main',
  channelTypes: [],
} as const;

/**
 * Git fixture for the session status rail.
 *
 * The rail sums `additions`/`deletions` across `changes` to show the line
 * delta, so a fixture without those numbers would exercise the "no line stats"
 * arm only. One binary file is included on purpose: the delta must still count
 * the measurable files rather than collapsing to null.
 */
const DEMO_GIT_CHANGES = [
  { path: 'src/pages/Chat/index.tsx', additions: 285, deletions: 39, bucket: 'unstaged' as const },
  { path: 'src/styles/codex-session-rail.css', additions: 297, deletions: 0, bucket: 'untracked' as const },
  { path: 'shared/i18n/locales/zh/chat.json', additions: 127, deletions: 8, bucket: 'staged' as const },
  { path: 'reports/assets/rail.png', additions: null, deletions: null, bucket: 'unstaged' as const, binary: true },
].map((entry) => ({
  path: entry.path,
  absolutePath: `${DEMO_WORKSPACE.rootPath}\\${entry.path.replace(/\//g, '\\')}`,
  status: entry.bucket === 'untracked' ? '??' : 'M',
  staged: entry.bucket === 'staged',
  unstaged: entry.bucket === 'unstaged',
  untracked: entry.bucket === 'untracked',
  conflicted: false,
  bucket: entry.bucket,
  additions: entry.additions,
  deletions: entry.deletions,
  binary: entry.binary ?? false,
}));

function demoGitStatus() {
  return {
    isRepository: true,
    workspaceRoot: DEMO_WORKSPACE.rootPath,
    repoRoot: DEMO_WORKSPACE.rootPath,
    branch: 'codex/ui-polish',
    detached: false,
    upstream: 'origin/codex/ui-polish',
    ahead: 2,
    behind: 0,
    clean: false,
    hasConflicts: false,
    changes: DEMO_GIT_CHANGES,
    stagedCount: DEMO_GIT_CHANGES.filter((change) => change.staged).length,
    unstagedCount: DEMO_GIT_CHANGES.filter((change) => change.unstaged).length,
    untrackedCount: DEMO_GIT_CHANGES.filter((change) => change.untracked).length,
    conflictedCount: 0,
  };
}

/**
 * Sub-agent transcripts, keyed by the `childSessionKey` the `rail` scenario
 * publishes on `agent:subagent-lifecycle`. The Agents tab reads these through
 * `sessions.history`, so without them clicking a roster row lands on an empty
 * pane and the tab looks broken rather than unpopulated.
 */
const DEMO_CHILD_TRANSCRIPTS: Record<string, Array<Record<string, unknown>>> = {
  'agent:explorer:rail-scout': [
    {
      role: 'user',
      id: 'child-explorer-task',
      timestamp: NOW / 1000,
      content: [{ type: 'text', text: '检索 rail 相关渲染路径与既有组件' }],
    },
    {
      role: 'assistant',
      id: 'child-explorer-reply',
      timestamp: NOW / 1000 + 12,
      content: [{
        type: 'text',
        text: '已定位 3 处可复用组件：ToolUiPlanView（进程清单）、AgentRoleIdentity（头像+角色徽标）、WelcomeBranchPicker（分支切换）。均无需新建。',
      }],
    },
  ],
  'agent:reviewer:rail-review': [
    {
      role: 'user',
      id: 'child-reviewer-task',
      timestamp: NOW / 1000 + 2,
      content: [{ type: 'text', text: '核对 rail 与 composer 下拉的样式一致性' }],
    },
    {
      role: 'assistant',
      id: 'child-reviewer-progress',
      timestamp: NOW / 1000 + 18,
      content: [{
        type: 'text',
        text: '正在比对：圆角、阴影、背景三项已确认复用 codex-composer-menu 的配方；行高与 gutter 仍在核对。',
      }],
    },
  ],
  /* The third worker the `rail` script starts late and leaves running. Present
   * so opening a live worker lands on a populated page rather than the
   * "no transcript" arm — a running worker has already said something. */
  'agent:builder:rail-build': [
    {
      role: 'user',
      id: 'child-builder-task',
      timestamp: NOW / 1000 + 4,
      content: [{ type: 'text', text: '把进程与子智能体接到工作空间标签' }],
    },
    {
      role: 'assistant',
      id: 'child-builder-progress',
      timestamp: NOW / 1000 + 24,
      content: [{
        type: 'text',
        text: '标签模型已按 kind + subject 匹配，同一种类可以开多个实例；子智能体标签取头像与生成名，进程标签取命令摘要。正在接进程输出页的实时尾随。',
      }],
    },
  ],
};

/** Ledger fixture: the rail's fallback when the run carries no plan. */
function demoTaskLedgerSnapshot() {
  const node = (id: string, title: string, status: string, kind: string) => ({
    id,
    workspaceId: DEMO_WORKSPACE.id,
    kind,
    title,
    status,
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
  });
  const nodes = [
    node('goal-1', '会话状态第三栏', 'doing', 'goal'),
    node('task-1', '接线 Chat 页三栏布局', 'doing', 'task'),
    node('task-2', '补纯函数单测', 'review', 'task'),
    node('task-3', '底部状态条瘦身', 'todo', 'task'),
  ];
  return {
    schemaVersion: 1,
    workspaceId: DEMO_WORKSPACE.id,
    generatedAt: new Date(NOW).toISOString(),
    nodes,
    edges: [],
    sessionLinks: [],
    rootNodeIds: ['goal-1'],
    reviewNodeIds: ['task-2'],
    activeNodeIds: ['task-1'],
    blockedNodeIds: [],
    currentGoalId: 'goal-1',
    recentDecisions: [],
    eventsCount: nodes.length,
    warnings: [],
  };
}


/* ────────────────────────────────────────────────────────────────────────────
 * Scripted run state.
 *
 * The transcript is authoritative for `chat.history`: `run.ended` triggers a
 * history reload, and returning an empty list there would wipe the very run the
 * user just watched.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Seed transcript — five completed user turns, served as `chat.history` before
 * the user sends anything.
 *
 * Two surfaces need PRIOR history to exist at all, and neither could be walked
 * from an empty transcript:
 *
 *   - The left message-nav rail only appears from the third user message on, so
 *     an empty mock would have required sending three prompts and waiting out
 *     three scripted runs before the thing under test showed up.
 *   - The process disclosure is only interesting NEXT to a final answer. Turn 4
 *     carries `thinking` blocks + tool calls + a separate summary reply, turn 5
 *     carries `thinking` with NO tools — the reasoning-only shape that must
 *     still get its own collapsed box.
 *
 * Lengths are deliberately uneven (turn 2 overflows the rail's 64-char preview,
 * turn 3 is two characters) so truncation and the minimum bar hit-area are both
 * exercised rather than assumed.
 *
 * `?seed=0` starts empty — that is the only way back to the welcome watermark
 * and the empty-state chips, so the flag has to stay.
 */
function seedTranscript(): Array<Record<string, unknown>> {
  const t = NOW / 1000;
  const user = (id: string, at: number, text: string) => ({
    role: 'user',
    id: `seed-${id}`,
    timestamp: t + at,
    content: [{ type: 'text', text }],
  });
  const assistant = (id: string, at: number, content: Array<Record<string, unknown>>) => ({
    role: 'assistant',
    id: `seed-${id}`,
    timestamp: t + at,
    content,
  });
  const text = (value: string) => ({ type: 'text', text: value });
  const thinking = (value: string) => ({ type: 'thinking', thinking: value });

  return [
    user('q1', 0, '侧边栏的会话分组是怎么实现的？'),
    assistant('a1', 8, [text(
      '分组落在项目内部：`SessionFolderTree.tsx` 负责拖放与重命名交互，`stores/workspaces.ts` 的 `groupSessions` 只允许同一项目中的会话互相归组。所有工作组都归一为项目下的一层列表；切换到时间排序后则直接显示按最近活动时间排列的会话。',
    )]),

    user('q2', 60, '我想确认一下：如果我把一个已经归组的会话拖到另一个组的成员上，它是会从原来的组里移出去并入新组，还是会同时留在两个组里？另外删除一个组之后，组里那些会话会跟着消失吗，还是退回到未归线区域？这两种情况我都担心会丢会话。'),
    assistant('a2', 72, [text(
      '都不会丢。归属是一张项目内的 `sessionFolderAssignments` 单值映射，一个会话同时只能属于一个组，所以拖过去等于改写那一个键；删除组只会解除归属，组内会话回到未归线区域，会话本身不受影响。',
    )]),

    user('q3', 900, '继续'),
    assistant('a3', 908, [text('分组内部只保留一级会话行，不再根据会话来源追加第二层缩进，也不绘制树状连接线。这样项目、工作组和会话的层级关系只表达一次。')]),

    user('q4', 1800, '把思考和处理过程折起来，我不想为了看上面的提示词滑很久'),
    assistant('a4-work', 1806, [
      thinking('先确认现在的渲染顺序：用户气泡 → 处理卡片 → 助手消息（思考面板 + 正文）。三者是同级兄弟，所以处理过程展开时会把提示词整块推走。'),
      thinking('思考面板挂在助手消息上，处理卡片挂在用户消息上，两者跨行。要合并的话得把思考往上搬进卡片，而不是把卡片往下搬。'),
      text('先读一下渲染投影，确认思考是从哪个字段取的。'),
      { type: 'tool_use', id: 'seed-tool-read', name: 'read_file', input: { path: 'src/pages/Chat/message-render-projection.ts' } },
    ]),
    assistant('a4-work2', 1812, [
      thinking('`extractAssistantReasoning` 走 thinking 内容块，投影里有缓存，搬动它不需要改抽取逻辑。'),
      { type: 'tool_use', id: 'seed-tool-grep', name: 'search', input: { pattern: 'runActivityKeepExpandedOnComplete' } },
    ]),
    assistant('a4', 1824, [text([
      '### 折叠方案',
      '',
      '1. `TurnSummaryCard` 成为唯一的处理过程容器，思考流搬进它的展开区；',
      '2. 助手消息只留最终正文 —— 折叠头一行，提示词和答案之间不再有第三块；',
      '3. `runActivityKeepExpandedOnComplete` 默认改为 `false`，已完成回合默认收起。',
      '',
      '折叠态标题行仍带角标，不展开也能知道里面有多少段思考、几个文件、几条命令。',
    ].join('\n'))]),

    user('q5', 2700, '总结一下这次一共改了哪些文件'),
    assistant('a5', 2712, [
      thinking('这一轮没有跑工具，纯粹是回顾。即便如此，这段推理也应该有自己的折叠框，而不是裸挂在正文上方。'),
      thinking('清单按阶段分：mock 框架、折叠框、导航条、i18n。'),
      text('四组改动：mock 框架（`mock-host-bridge.ts` + `mock-run-script.ts`）、处理过程折叠框（`TurnSummaryCard.tsx`、`message-render-projection.ts`、`Chat/index.tsx`）、左侧导航条（`MessageNavRail.tsx`）、四语文案。'),
    ]),
  ];
}

/** `?seed=0` opts out, leaving the empty/welcome state reachable. */
function seedRequested(): boolean {
  return stickyMockParam('seed') !== '0';
}

const transcript: Array<Record<string, unknown>> = seedRequested() ? seedTranscript() : [];

const ACTIVE_SESSION_KEY = 'agent:main:main';

/**
 * History per session key.
 *
 * The seeded transcript belongs to the ACTIVE session only. Serving it for every
 * key made each sidebar row derive the same title from its first user message,
 * so four differently-named sessions rendered as four copies of one question —
 * a fixture artifact that reads exactly like a grouping bug. Non-active sessions
 * get a single message echoing their own display name, which is enough for the
 * derived title to agree with the row.
 */
function transcriptForSession(sessionKey: string | undefined): Array<Record<string, unknown>> {
  if (!sessionKey || sessionKey === ACTIVE_SESSION_KEY) return transcript;
  const child = DEMO_CHILD_TRANSCRIPTS[sessionKey];
  if (child) return child;
  const session = listedSessions().find((candidate) => candidate.key === sessionKey);
  if (!session) return [];
  return [{
    role: 'user',
    id: `${sessionKey}-opening`,
    timestamp: session.updatedAt / 1000,
    content: [{ type: 'text', text: session.displayName }],
  }];
}
let runSeq = 0;
let currentRun: { runId: string; sessionKey: string } | null = null;
const abortedRunIds = new Set<string>();
let pendingApproval: Record<string, unknown> | null = null;
let approvalResolver: ((decision: 'approved' | 'denied') => void) | null = null;
/** Flipped by `terminal.open` / `terminal.close`, read by `terminal.status`. */
let mockTerminalOpen = false;

const MOCK_SCENARIOS: ReadonlySet<MockScenario> = new Set<MockScenario>([
  'full', 'approval', 'abort', 'toolui', 'toolcall', 'ask', 'planonly', 'carryover', 'thinking', 'deepseek', 'rail',
]);

/**
 * Read a mock query param, latching it for later loads.
 *
 * Same reason as `isMockModeEnabled`: a browser-driving tool that reloads the
 * origin would otherwise silently reset `?script=deepseek` back to the default
 * scenario, and the walkthrough would quietly be testing something else.
 */
function stickyMockParam(name: string): string | null {
  const key = `verse-claw-mock-${name}`;
  const requested = new URLSearchParams(window.location.search).get(name);
  try {
    if (requested != null) {
      window.localStorage.setItem(key, requested);
      return requested;
    }
    return window.localStorage.getItem(key);
  } catch {
    return requested;
  }
}

function activeScenario(): MockScenario {
  const requested = stickyMockParam('script');
  return requested && MOCK_SCENARIOS.has(requested as MockScenario)
    ? requested as MockScenario
    : 'full';
}

/**
 * `?slowStartup=<ms>` stalls the first `chat.history` RPC. Useful for holding
 * history-dependent loading states open long enough to inspect. Note that the
 * cold-start path can settle through cached summaries without ever reaching
 * this call, in which case the chat startup skeleton still will not appear.
 */
let firstHistoryServed = false;
function startupDelayMs(): number {
  if (firstHistoryServed) return 0;
  const raw = new URLSearchParams(window.location.search).get('slowStartup');
  if (raw == null) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 30_000) : 4_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function startScriptedRun(sessionKey: string, userText: string): string {
  runSeq += 1;
  const runId = `mock-run-${runSeq}`;
  currentRun = { runId, sessionKey };
  transcript.push({
    role: 'user',
    id: `${runId}-user`,
    timestamp: Date.now() / 1000,
    content: [{ type: 'text', text: userText }],
  });

  void runMockScript({
    runId,
    sessionKey,
    userText,
    emit: busEmit,
    appendMessage: (message) => {
      transcript.push(message);
    },
    setPendingApproval: (approval) => {
      pendingApproval = approval;
    },
    hasPendingApproval: () => pendingApproval != null,
    setTerminalRunning: (running) => {
      mockTerminalOpen = running;
    },
    waitForApproval: () => new Promise<'approved' | 'denied'>((resolve) => {
      if (!pendingApproval) {
        resolve('approved');
        return;
      }
      approvalResolver = resolve;
    }),
    isAborted: () => abortedRunIds.has(runId),
  }, activeScenario()).catch((error) => {
    console.warn('[mock-run] script failed', error);
  });

  return runId;
}

/**
 * Fixtures keyed by `module.action`. Anything not listed returns a safe
 * empty-state via the default arm — the UI must never crash on a missing
 * fixture, it should just render its empty/loading state.
 */
const FIXTURES: Record<string, (req: HostRequest) => unknown> = {
  'app.version': () => ({ version: '0.0.0-mock' }),
  'openclaw.status': () => ({ ok: true, running: true }),

  'gateway.status': () => ({ state: 'running', gatewayReady: true, port: OPENCLAW_GATEWAY_PORT }),

  'settings.getAll': () => ({
    setupComplete: true,
    devModeUnlocked: true,
    theme: 'dark',
    language: 'zh-CN',
  }),
  'settings.get': () => ({}),
  'settings.set': () => ({ ok: true }),

  'workspaces.getActive': () => workspaceSnapshot(),
  'workspaces.list': () => workspaceSnapshot(),

  /*
   * Folder mutations really mutate. Answering with a frozen snapshot here
   * would make the sidebar look correct while silently dropping every rename —
   * the exact "mock only walks the happy path" failure the audit called out.
   */
  'workspaces.createFolder': (req) => {
    const payload = (req.payload ?? {}) as { name?: string; parentId?: string | null };
    folderSeq += 1;
    const folder: MockSessionFolder = {
      id: `folder-created-${folderSeq}`,
      name: payload.name || `Workgroup ${folderSeq}`,
      parentId: payload.parentId ?? null,
      order: folderSeq,
      kind: 'workgroup',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    workspaceFolders.push(folder);
    return workspaceSnapshot({ folder });
  },
  'workspaces.renameFolder': (req) => {
    const payload = (req.payload ?? {}) as { folderId?: string; name?: string };
    const folder = workspaceFolders.find((candidate) => candidate.id === payload.folderId);
    if (folder && payload.name) {
      folder.name = payload.name;
      folder.updatedAt = Date.now();
    }
    return workspaceSnapshot();
  },
  'workspaces.deleteFolder': (req) => {
    const payload = (req.payload ?? {}) as { folderId?: string };
    if (payload.folderId) {
      // Delete the folder AND its subtree; orphaned assignments fall to root.
      const doomed = new Set<string>([payload.folderId]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const folder of workspaceFolders) {
          if (folder.parentId && doomed.has(folder.parentId) && !doomed.has(folder.id)) {
            doomed.add(folder.id);
            grew = true;
          }
        }
      }
      for (let i = workspaceFolders.length - 1; i >= 0; i -= 1) {
        if (doomed.has(workspaceFolders[i].id)) workspaceFolders.splice(i, 1);
      }
      for (const [sessionKey, folderId] of Object.entries(sessionFolderAssignments)) {
        if (doomed.has(folderId)) delete sessionFolderAssignments[sessionKey];
      }
    }
    return workspaceSnapshot();
  },
  'workspaces.moveSessionToFolder': (req) => {
    const payload = (req.payload ?? {}) as { sessionKey?: string; folderId?: string | null };
    if (payload.sessionKey) {
      if (payload.folderId) sessionFolderAssignments[payload.sessionKey] = payload.folderId;
      else delete sessionFolderAssignments[payload.sessionKey];
    }
    return workspaceSnapshot();
  },

  'sessions.list': () => ({ ok: true, sessions: listedSessions() }),
  'sessions.summaries': () => [],
  /* Rename and archive really mutate, for the same reason folders do: the
   * sidebar's ⋯ menu cannot be exercised against answers that never land. */
  'sessions.rename': (req) => {
    const payload = (req.payload ?? {}) as { id?: string; title?: string };
    const title = payload.title?.trim();
    const session = [...workspaceSessions(), SECOND_WORKSPACE_SESSION].find((entry) => entry.key === payload.id) as
      | { displayName: string }
      | undefined;
    if (!session || !title) return { success: false, error: 'unknown session' };
    session.displayName = title;
    return { success: true };
  },
  'sessions.archive': (req) => {
    const payload = (req.payload ?? {}) as { id?: string };
    if (payload.id) archivedSessionKeys.add(payload.id);
    return { success: true };
  },
  'sessions.restore': (req) => {
    const payload = (req.payload ?? {}) as { id?: string };
    if (payload.id) archivedSessionKeys.delete(payload.id);
    return { success: true };
  },
  /* A child sessionKey gets that sub-agent's own transcript; anything else
   * gets the main one. Answering the parent transcript for every key would make
   * the Agents tab look wired while showing the wrong conversation. */
  'sessions.history': (req) => {
    const payload = (req.payload ?? {}) as { sessionKey?: string };
    return { success: true, messages: transcriptForSession(payload.sessionKey) };
  },

  'gateway.rpc': async (req) => {
    const payload = (req.payload ?? {}) as { method?: string; params?: Record<string, unknown> };
    // The sidebar's session list loads through gateway.rpc('sessions.list'),
    // not hostApi.sessions.list — answering only on the latter left the mock
    // sidebar permanently empty and untestable.
    if (payload.method === 'sessions.list') {
      return { sessions: listedSessions() };
    }
    if (payload.method === 'chat.history') {
      const delay = startupDelayMs();
      firstHistoryServed = true;
      if (delay > 0) await sleep(delay);
      const key = (payload.params as { sessionKey?: string } | undefined)?.sessionKey;
      return { messages: transcriptForSession(key), thinkingLevel: null };
    }
    if (payload.method === 'chat.abort') {
      for (let seq = 1; seq <= runSeq; seq += 1) abortedRunIds.add(`mock-run-${seq}`);
      pendingApproval = null;
      approvalResolver?.('denied');
      approvalResolver = null;
      if (currentRun) emitMockAbort({ ...currentRun, emit: busEmit });
      return { ok: true };
    }
    return {};
  },

  'chat.sendWithMedia': (req) => {
    const payload = (req.payload ?? {}) as { sessionKey?: string; message?: string };
    const sessionKey = payload.sessionKey || 'agent:main:main';
    const runId = startScriptedRun(sessionKey, payload.message || '');
    return { success: true, result: { runId } };
  },

  'providers.accounts': () => [DEMO_ACCOUNT],
  'providers.vendors': () => [],
  'providers.list': () => [],
  'providers.getDefaultAccount': () => ({ accountId: DEMO_ACCOUNT.id }),
  'providers.accountKeyInfo': () => [
    { accountId: DEMO_ACCOUNT.id, hasKey: true, keyMasked: 'sk-••••mock' },
  ],
  'providers.getAccount': () => DEMO_ACCOUNT,
  'providers.hasAccountApiKey': () => true,

  'agents.list': () => ({
    agents: [DEMO_AGENT],
    defaultAgentId: DEMO_AGENT.id,
    defaultModelRef: DEMO_AGENT.modelRef,
    configuredChannelTypes: [],
    channelOwners: {},
    channelAccountOwners: {},
  }),

  'taskLedger.snapshot': () => ({ success: true, snapshot: demoTaskLedgerSnapshot() }),

  /* The session status rail reads these three. Without them the rail renders
   * its "not a repository" / "no terminal" arms and the whole column is
   * untestable in the browser.
   *
   * `success` — not `ok` — is what `HostSuccess` declares and what consumers
   * gate on (`chat.ts` drops a ledger snapshot whose `success` is falsy). */
  'git.status': () => ({ success: true, status: demoGitStatus() }),
  'git.branches': () => ({
    success: true,
    branches: [
      { name: 'codex/ui-polish', current: true },
      { name: 'main', current: false },
      { name: 'codex/session-rail', current: false },
    ],
  }),
  /* Terminal state is a live fact in the real host: it exists only after the
   * user opens a shell. Mirroring that here keeps the rail's "no terminal
   * section until one is running" rule exercisable — `terminal.open` flips it. */
  'terminal.status': () => (mockTerminalOpen
    ? {
      success: true,
      sessionId: 'mock-term-1',
      workspaceId: DEMO_WORKSPACE.id,
      sessionKey: 'agent:main:main',
      cwd: DEMO_WORKSPACE.rootPath,
      pid: 24680,
      status: 'running',
    }
    : { success: true, sessionId: null, status: 'idle', pid: null }),
  'terminal.open': () => {
    mockTerminalOpen = true;
    return {
      success: true,
      sessionId: 'mock-term-1',
      workspaceId: DEMO_WORKSPACE.id,
      sessionKey: 'agent:main:main',
      cwd: DEMO_WORKSPACE.rootPath,
      pid: 24680,
      status: 'running',
      cols: 80,
      rows: 24,
    };
  },
  'terminal.close': () => {
    mockTerminalOpen = false;
    return { success: true };
  },

  'permissions.approvals': () => ({ ok: true, approvals: pendingApproval ? [pendingApproval] : [] }),
  'permissions.decideApproval': (req) => {
    const payload = (req.payload ?? {}) as { id?: string; decision?: 'approved' | 'denied' };
    const decided = pendingApproval;
    pendingApproval = null;
    approvalResolver?.(payload.decision === 'denied' ? 'denied' : 'approved');
    approvalResolver = null;
    return {
      ok: true,
      success: true,
      approval: decided ? { ...decided, status: payload.decision ?? 'approved' } : undefined,
    };
  },
  'permissions.decisionEvents': () => ({ ok: true, events: [] }),
  'agentBrowser.tasks': () => [],
  'channels.accounts': () => [],
  'channels.targets': () => [],
  'resourceTracker.list': () => [],

  'files.stageBuffer': (req) => {
    const payload = (req.payload ?? {}) as StageBufferPayload;
    const isImage = typeof payload.mimeType === 'string' && payload.mimeType.startsWith('image/');
    return {
      id: 'mock-' + Math.random().toString(36).slice(2, 10),
      fileName: payload.fileName || 'file.bin',
      mimeType: payload.mimeType || 'application/octet-stream',
      fileSize: 4096,
      stagedPath: `C:\\mock\\outbound\\${payload.fileName || 'file.bin'}`,
      preview: isImage ? makeGradientPreview() : null,
    };
  },
  'files.stagePaths': (req) => {
    const paths = Array.isArray((req.payload as { filePaths?: unknown } | undefined)?.filePaths)
      ? ((req.payload as { filePaths: string[] }).filePaths)
      : [];
    return paths.map((p) => ({
      id: 'mockp-' + Math.random().toString(36).slice(2, 10),
      fileName: String(p).split(/[\\/]/).pop() || 'file.bin',
      mimeType: 'image/png',
      fileSize: 4096,
      stagedPath: String(p),
      preview:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAIAAAElUaGXAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAIElEQVR4nO3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAAAAAvg0YAAABhGmA2QAAAABJRU5ErkJggg==',
    }));
  },

  /**
   * Native file-picker stand-in: the composer's "添加文件" flow opens a real
   * dialog in Electron; here it returns one pre-selected demo path so the
   * whole attach → stage → preview → send chain is exercisable.
   */
  'dialog.open': () => ({
    canceled: false,
    filePaths: ['C:\\mock\\demo\\gradient.png', 'C:\\mock\\demo\\notes.txt'],
  }),
};

/**
 * Install the mock bridge. Idempotent; refuses to run when the real
 * Electron bridge is already present (never mask a real host).
 */
export function installMockHostBridge(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.verseClaw?.hostInvoke) return false;

  const handler = async (request: HostRequest) => {
    const { id, module, action } = request;
    const key = `${module}.${action}`;
    const fixture = FIXTURES[key];
    if (fixture) {
      try {
        return ok(id, await fixture(request));
      } catch (err) {
        return fail(id, `mock fixture error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // Default arm: benign empty-state so unknown probes never crash the UI.
    return ok(id, {});
  };

  window.verseClaw = { hostInvoke: handler };

  // Runtime events travel over `window.electron.ipcRenderer`, not the host
  // bridge. Wiring it to the in-memory bus is what makes the execution graph,
  // terminal cards, approvals and token counters reachable in the browser.
  if (!window.electron) {
    window.electron = {
      platform: 'win32',
      versions: { chrome: '', electron: '' },
      ipcRenderer: {
        invoke: async () => ({}),
        on: (channel: string, callback: (...args: unknown[]) => void) => busOn(channel, callback),
        once: (channel: string, callback: (...args: unknown[]) => void) => {
          const off = busOn(channel, (...args: unknown[]) => {
            off();
            callback(...args);
          });
        },
        off: (channel: string, callback?: (...args: unknown[]) => void) => {
          if (!callback) {
            busListeners.delete(channel);
            return;
          }
          busListeners.get(channel)?.delete(callback);
        },
        removeAllListeners: (channel: string) => {
          busListeners.delete(channel);
        },
      },
    } as unknown as Window['electron'];
  }

  return true;
}

/**
 * Sticky mock-mode flag.
 *
 * `?mock=1` alone is not enough in practice: browser-driving tools navigate to
 * the server ORIGIN (no query) on reload, and the app's own router rewrites the
 * URL on its setup redirect. Either one silently drops the flag, the real bridge
 * is then missing, and the session lands on /setup mid-walkthrough looking like
 * an app bug. Latching the flag in localStorage makes a mock session survive
 * both. `?mock=0` clears it.
 */
const MOCK_MODE_KEY = 'verse-claw-mock-mode';

/** `?mock=1` to enter (and latch), `?mock=0` to leave. */
export function isMockModeEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const requested = new URLSearchParams(window.location.search).get('mock');
  try {
    if (requested === '1') {
      window.localStorage.setItem(MOCK_MODE_KEY, '1');
      return true;
    }
    if (requested === '0') {
      window.localStorage.removeItem(MOCK_MODE_KEY);
      return false;
    }
    return window.localStorage.getItem(MOCK_MODE_KEY) === '1';
  } catch {
    // Private mode / storage disabled — the query flag still works for one load.
    return requested === '1';
  }
}

/**
 * Seed the persisted settings store so the app boots past Setup before the
 * async `settings.getAll` round-trip lands. The settings store hydrates from
 * `verse-claw-settings` in localStorage synchronously; without this, the
 * setup redirect (running on the first frame) fires before `init()` resolves
 * and bounces the mock session to /setup.
 */
export function seedMockPersistedSettings(): void {
  try {
    const existing = window.localStorage.getItem('verse-claw-settings');
    if (existing) return;
    window.localStorage.setItem(
      'verse-claw-settings',
      JSON.stringify({
        state: { setupComplete: true, devModeUnlocked: true, theme: 'dark', language: 'zh-CN' },
        version: 0,
      }),
    );
  } catch {
    // localStorage unavailable — fall back to the async settings.getAll path.
  }
}
