import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// chat.send inputMode（interrupt/guide/queue）分支直接单测
//
// 目标：不 mock 掉 chat.ts 本体，验证 inputMode 三分支的运行时行为：
//   - interrupt：checkpoint-then-abort 顺序、幂等键、门禁拒绝
//   - guide：steer 成功 steered 事件 / 被拒 fallback 降级
//   - queue：入队 + chat.queue-status 广播 + drain 竞态回滚
//
// Mock 策略（详见 docs/dev/codex-parity/runtime-interaction-maturity.md §6 P0-1）：
//   - auto-reply/dispatch.js：拦截 dispatchInboundMessage，防止进入主 dispatch
//   - gateway/chat-abort.js：abortChatRunById 无副作用化（真实 abort 会碰真实
//     状态与广播链），其余导出保留原样
//   - gateway/session-utils.js：loadSessionEntry 返回最小 cfg，防止读写真实
//     用户会话目录
// ---------------------------------------------------------------------------

vi.mock('../../openclaw_runtime/src/auto-reply/dispatch.js', () => ({
  dispatchInboundMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../openclaw_runtime/src/gateway/chat-abort.js', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    abortChatRunById: vi.fn(() => ({
      aborted: false,
      runId: 'ignored',
      stopReason: 'interrupt',
    })),
  };
});

vi.mock('../../openclaw_runtime/src/gateway/session-utils.js', () => ({
  capArrayByJsonBytes: (arr: unknown[]) => arr,
  buildGatewaySessionInfo: vi.fn(() => ({})),
  getSessionDefaults: vi.fn(() => ({})),
  loadSessionEntry: vi.fn(() => ({
    cfg: {},
    entry: undefined,
    canonicalKey: 'agent:main:test-session',
  })),
  listAgentsForGateway: vi.fn(() => []),
  readSessionMessageByIdAsync: vi.fn(),
  readSessionMessagesAsync: vi.fn(),
  readRecentSessionMessagesAsync: vi.fn(),
  resolveGatewayModelSupportsImages: vi.fn(() => false),
  resolveDeletedAgentIdFromSessionKey: vi.fn(() => null),
  resolveSessionModelRef: vi.fn(() => ({ provider: 'openai', model: 'test-model' })),
  resolveSessionStoreKey: vi.fn(() => 'agent:main'),
}));

// embedded-agent-runner/runs.js 仅在 chat.ts 中被动态 import（guide 分支与
// drain 回调），全 mock 以便可控地驱动 steering / drain 竞态。
vi.mock('../../openclaw_runtime/src/agents/embedded-agent-runner/runs.js', () => ({
  resolveActiveEmbeddedRunSessionId: vi.fn(() => undefined),
  queueEmbeddedAgentMessageWithOutcomeAsync: vi.fn(async () => ({ queued: false })),
}));

// clawgraph/runtime.js 的依赖链在 jsdom 下加载期崩溃
// （manifest-metadata-scan 的 new URL(import.meta.url)），chat.ts 仅需
// listClawGraphRunSnapshots 判断 clawGraphNodeActive，全 mock。
vi.mock('../../openclaw_runtime/src/agents/clawgraph/runtime.js', () => ({
  listClawGraphRunSnapshots: vi.fn(() => []),
}));

import { chatHandlers, drainQueuedUserMessagesForSession } from '../../openclaw_runtime/src/gateway/server-methods/chat';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';
import {
  listLongTaskCheckpoints,
  listLongTaskInterventions,
  listLongTaskQueuedMessages,
  recordLongTaskCheckpoint,
} from '../../openclaw_runtime/src/agents/long-task-control/store';
import { enqueueUserMessage } from '../../openclaw_runtime/src/agents/user-message-queue';

const ORIGINAL_STATE_DIR = process.env.OPENCLAW_STATE_DIR;
let testStateRoot: string | undefined;

beforeEach(() => {
  closeOpenClawStateDatabaseForTest();
  testStateRoot = mkdtempSync(path.join(tmpdir(), 'clawx-chat-input-mode-'));
  process.env.OPENCLAW_STATE_DIR = testStateRoot;
});

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  if (testStateRoot) {
    rmSync(testStateRoot, { recursive: true, force: true });
    testStateRoot = undefined;
  }
  if (ORIGINAL_STATE_DIR === undefined) {
    delete process.env.OPENCLAW_STATE_DIR;
  } else {
    process.env.OPENCLAW_STATE_DIR = ORIGINAL_STATE_DIR;
  }
});

const SESSION_KEY = 'agent:main:test-session';
const RUN_ID = 'chat-run-test-1';

function makeAbortEntry(sessionKey: string) {
  return {
    controller: new AbortController(),
    sessionId: 'session-1',
    sessionKey,
    startedAtMs: Date.now() - 1000,
    expiresAtMs: Date.now() + 60_000,
  };
}

function makeContext() {
  return {
    chatAbortControllers: new Map<string, ReturnType<typeof makeAbortEntry>>(),
    chatAbortedRuns: new Map<string, number>(),
    chatRunBuffers: new Map<string, unknown>(),
    dedupe: new Map<string, unknown>(),
    agentRunSeq: new Map<string, number>(),
    broadcast: vi.fn(),
    broadcastToConnIds: vi.fn(),
    nodeSendToSession: vi.fn(),
    logGateway: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    getRuntimeConfig: () => ({}),
    getApprovalClientConnIds: () => new Set<string>(),
  };
}

function callChatSend(
  context: ReturnType<typeof makeContext>,
  respond: ReturnType<typeof vi.fn>,
  params: Record<string, unknown>,
) {
  return chatHandlers['chat.send']({
    params,
    respond,
    context,
    client: null,
    isWebchatConnect: () => false,
  } as never);
}

describe('chat.send inputMode gate', () => {
  it('rejects explicit inputMode without an active /loop Task Ledger root', async () => {
    const respond = vi.fn();
    const context = makeContext();
    context.chatAbortControllers.set(RUN_ID, makeAbortEntry(SESSION_KEY));

    await callChatSend(context, respond, {
      sessionKey: SESSION_KEY,
      message: 'hello',
      idempotencyKey: RUN_ID,
      inputMode: 'interrupt',
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      expect.anything(),
      expect.objectContaining({ code: 'INVALID_REQUEST' }),
    );
    const errorPayload = respond.mock.calls[0]?.[2] as { code?: string; message?: string } | undefined;
    expect(errorPayload?.code).toBe('INVALID_REQUEST');
    // 必须命中 /loop root 门禁（而非更早的协议校验）
    expect(errorPayload?.message).toContain('inputMode requires an active /loop Task Ledger root');
  });

  it('rejects unknown inputMode values at the protocol layer', async () => {
    const respond = vi.fn();
    const context = makeContext();
    context.chatAbortControllers.set(RUN_ID, makeAbortEntry(SESSION_KEY));

    await callChatSend(context, respond, {
      sessionKey: SESSION_KEY,
      message: 'hello',
      idempotencyKey: RUN_ID,
      inputMode: 'bogus-mode',
    });

    // gateway-protocol schema 层拒绝非法 inputMode 值（协议契约保护，
    // 与 /loop root 门禁是两条独立的 INVALID_REQUEST 路径）
    const errorPayload = respond.mock.calls[0]?.[2] as { code?: string; message?: string } | undefined;
    expect(errorPayload?.code).toBe('INVALID_REQUEST');
    expect(errorPayload?.message).toContain('invalid chat.send params');
    expect(errorPayload?.message).not.toContain('inputMode requires');
  });
});

// ---------------------------------------------------------------------------
// 三分支用例：interrupt / guide / queue
// ---------------------------------------------------------------------------

const LEDGER_ROOT = 'tlroot_test';

/** 预置 /loop Task Ledger root（getLatestLongTaskLedgerRootId 查询真实 SQLite）。 */
function seedLedgerRoot(sessionKey: string) {
  return recordLongTaskCheckpoint({
    idempotencyKey: `seed-root-${sessionKey}`,
    sessionKey,
    agentId: 'main',
    workspaceId: 'workspace',
    taskLedgerRootId: LEDGER_ROOT,
    trigger: 'guide',
    activeTask: 'seed loop root',
  });
}

describe('chat.send inputMode: interrupt', () => {
  it('checkpoints before aborting, records checkpointed event, and responds ok', async () => {
    seedLedgerRoot(SESSION_KEY);
    const respond = vi.fn();
    const context = makeContext();
    context.chatAbortControllers.set(RUN_ID, makeAbortEntry(SESSION_KEY));

    await callChatSend(context, respond, {
      sessionKey: SESSION_KEY,
      message: 'change course',
      idempotencyKey: RUN_ID,
      inputMode: 'interrupt',
    });

    // ① checkpoint 先于 abort 写入（trigger:'interrupt' + 幂等键）
    const checkpoints = listLongTaskCheckpoints(SESSION_KEY);
    const interruptCheckpoint = checkpoints.find((c) => c.trigger === 'interrupt');
    expect(interruptCheckpoint).toBeDefined();
    expect(interruptCheckpoint?.idempotencyKey).toBe(`chat:${RUN_ID}:interrupt:checkpoint`);
    expect(interruptCheckpoint?.checkpoint.taskLedgerRootId).toBe(LEDGER_ROOT);

    // ② intervention event 'checkpointed'
    const interventions = listLongTaskInterventions(SESSION_KEY);
    expect(
      interventions.some((i) => i.mode === 'interrupt' && i.status === 'checkpointed'),
    ).toBe(true);

    // ③ abort 路径被触发（chat-abort mock 的 abortChatRunById 被调用）
    const { abortChatRunById } = await import(
      '../../openclaw_runtime/src/gateway/chat-abort'
    );
    expect(abortChatRunById).toHaveBeenCalled();

    // ④ 分支 fall-through 后因 active run 仍在 → in_flight（非错误）
    expect(respond.mock.calls[0]?.[0]).toBe(true);
  });
});

describe('chat.send inputMode: guide', () => {
  it('steers the active run and records steered evidence', async () => {
    seedLedgerRoot(SESSION_KEY);
    const respond = vi.fn();
    const context = makeContext();
    context.chatAbortControllers.set(RUN_ID, makeAbortEntry(SESSION_KEY));
    const { resolveActiveEmbeddedRunSessionId, queueEmbeddedAgentMessageWithOutcomeAsync } =
      await import('../../openclaw_runtime/src/agents/embedded-agent-runner/runs.js');
    vi.mocked(resolveActiveEmbeddedRunSessionId).mockReturnValue('session-1');
    vi.mocked(queueEmbeddedAgentMessageWithOutcomeAsync).mockResolvedValue({
      queued: true,
    } as never);

    await callChatSend(context, respond, {
      sessionKey: SESSION_KEY,
      message: 'please focus on tests',
      idempotencyKey: RUN_ID,
      inputMode: 'guide',
    });

    // 注入调用参数正确
    expect(queueEmbeddedAgentMessageWithOutcomeAsync).toHaveBeenCalledWith(
      'session-1',
      'please focus on tests',
      { steeringMode: 'all', debounceMs: 0 },
    );
    // steered 响应
    expect(respond.mock.calls[0]?.[0]).toBe(true);
    expect(respond.mock.calls[0]?.[1]).toMatchObject({
      ok: true,
      steered: true,
      mode: 'guide',
    });
    // checkpoint + steered 事件
    const checkpoints = listLongTaskCheckpoints(SESSION_KEY);
    expect(checkpoints.find((c) => c.trigger === 'guide')).toBeDefined();
    const interventions = listLongTaskInterventions(SESSION_KEY);
    expect(
      interventions.some((i) => i.mode === 'guide' && i.status === 'steered'),
    ).toBe(true);
  });

  it('falls back to a normal send when steering is rejected', async () => {
    seedLedgerRoot(SESSION_KEY);
    const respond = vi.fn();
    const context = makeContext();
    context.chatAbortControllers.set(RUN_ID, makeAbortEntry(SESSION_KEY));
    const { resolveActiveEmbeddedRunSessionId, queueEmbeddedAgentMessageWithOutcomeAsync } =
      await import('../../openclaw_runtime/src/agents/embedded-agent-runner/runs.js');
    vi.mocked(resolveActiveEmbeddedRunSessionId).mockReturnValue('session-1');
    vi.mocked(queueEmbeddedAgentMessageWithOutcomeAsync).mockResolvedValue({
      queued: false,
      reason: 'run_ended',
    } as never);

    await callChatSend(context, respond, {
      sessionKey: SESSION_KEY,
      message: 'steer rejected case',
      idempotencyKey: RUN_ID,
      inputMode: 'guide',
    });

    // fallback 事件被记录（而非 steered）
    const interventions = listLongTaskInterventions(SESSION_KEY);
    expect(
      interventions.some((i) => i.mode === 'guide' && i.status === 'fallback'),
    ).toBe(true);
    expect(
      interventions.some((i) => i.status === 'steered'),
    ).toBe(false);
    // 降级后走主 dispatch：active run 仍在 → in_flight（非错误、非 steered）
    expect(respond.mock.calls[0]?.[0]).toBe(true);
    expect(respond.mock.calls[0]?.[1]).not.toMatchObject({ steered: true });
  });
});

describe('chat.send inputMode: queue', () => {
  it('persists the queued message and broadcasts queue status', async () => {
    seedLedgerRoot(SESSION_KEY);
    const respond = vi.fn();
    const context = makeContext();
    context.chatAbortControllers.set(RUN_ID, makeAbortEntry(SESSION_KEY));

    await callChatSend(context, respond, {
      sessionKey: SESSION_KEY,
      message: 'queue this follow-up',
      idempotencyKey: RUN_ID,
      inputMode: 'queue',
    });

    // queued 响应
    expect(respond.mock.calls[0]?.[0]).toBe(true);
    expect(respond.mock.calls[0]?.[1]).toMatchObject({
      ok: true,
      queued: true,
      mode: 'queue',
      queuePosition: 1,
    });
    // SQLite 持久化入队
    const queued = listLongTaskQueuedMessages(SESSION_KEY);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.text).toBe('queue this follow-up');
    expect(queued[0]?.idempotencyKey).toBe(`chat:${RUN_ID}:queue:item`);
    // chat.queue-status 广播（enqueue，含 dropIfSlow 选项）
    expect(context.broadcast).toHaveBeenCalledWith(
      'chat.queue-status',
      expect.objectContaining({ action: 'enqueue', queueCount: 1 }),
      { dropIfSlow: true },
    );
  });

  it('drain restores claimed rows when a new run started before drain', async () => {
    seedLedgerRoot(SESSION_KEY);
    enqueueUserMessage(SESSION_KEY, {
      text: 'follow-up after restart',
      source: 'queue',
      idempotencyKey: 'drain-race-1',
    });
    // 模拟：drain 检查时已有新 run 启动
    const { resolveActiveEmbeddedRunSessionId } = await import(
      '../../openclaw_runtime/src/agents/embedded-agent-runner/runs.js'
    );
    vi.mocked(resolveActiveEmbeddedRunSessionId).mockReturnValue('session-new-run');

    const context = makeContext();
    const result = await drainQueuedUserMessagesForSession(context as never, SESSION_KEY);

    expect(result.drained).toBe(false);
    expect(result.reason).toBe('active_run_started_before_queue_drain');
    // 已 claim 的条目被 restore 回 pending，不丢消息
    expect(listLongTaskQueuedMessages(SESSION_KEY)).toHaveLength(1);
    const restored = listLongTaskQueuedMessages(SESSION_KEY)[0];
    expect(restored?.text).toBe('follow-up after restart');
  });
});
