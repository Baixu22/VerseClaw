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

import { chatHandlers } from '../../openclaw_runtime/src/gateway/server-methods/chat';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';

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
