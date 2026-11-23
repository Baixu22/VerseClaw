/**
 * FP-P1-04 G3: the first-product coding loop — read → write(diff) → verify →
 * undo — executed by a REAL agent turn in a REAL gateway child.
 *
 * The LLM is a scripted local OpenAI-compatible endpoint (FP-P1-07 route A:
 * real gateway + local mock provider endpoint). Everything else is production
 * code: the real agent runner, real tools (read/edit/bash/undo_write), the
 * real write journal, the real workspace. The mock only decides WHICH tool the
 * agent calls next; whether those tools actually work is what this spec proves.
 *
 * Turns:
 *  T1 happy loop: read → edit → full-file write (journal snapshots + rich diffs)
 *     → bash syntax check → done
 *  T2 undo: undo_write restores both pre-images and drains the journal
 *  T3 failure paths: read-miss (explicit not-found) + edit-mismatch (explicit error)
 *  T4 partial-undo hard lock: edit again, snapshot sabotaged on disk → undo
 *     reports failure + journalDir retained (never silent partial restore)
 */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile, readdir, unlink } from 'node:fs/promises';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { initializeIndependentGitWorkspace } from './fixtures/fp-p1-harness';
import { createSessionChainTask } from './fixtures/session-task-chain';

type HostResponse<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string } };
type GatewayStatus = { state?: string; port?: number; gatewayReady?: boolean };
type HostSuccess = { success: boolean };

const MODEL_ID = 'mock-coder';
const BUGGY = 'function add(a, b) {\n  return a - b;\n}\nmodule.exports = { add };\n';
const FIXED_LINE = '  return a + b;';
const SUMMARY_BEFORE = 'status: pending\n';
const SUMMARY_AFTER = 'status: fixed\n';

type ToolCallSpec = { id: string; name: string; args: Record<string, unknown> };
type DcsProjectionChannel = 'knowledge' | 'working_memory' | 'tool_registry';

type LlmRequestLog = {
  turn: string;
  toolResults: Record<string, string>;
  issued: string | null;
  projections: Record<DcsProjectionChannel, string[]>;
  systemKnowledge: string[];
};

/**
 * The Gateway envelopes an inbound user message with a `[Sat 2026-09-19 19:22
 * GMT+8] ` timestamp prefix, and the DCS projections arrive as `user` messages.
 * Their heading is therefore never at the start of a line, so the original
 * anchored `^## Knowledge$` never matched a real request: `measured[channel]`
 * read 0 for channels the ledger correctly reported as `applied`.
 *
 * Keep the line-anchored shape — a passing mention of the heading inside other
 * content must still not count — but tolerate the envelope prefix.
 */
const ENVELOPE_PREFIX_PATTERN = String.raw`(?:\[[^\]\n]*\]\s*)?`;

const DCS_PROJECTION_PATTERNS: Record<DcsProjectionChannel, RegExp> = {
  knowledge: new RegExp(`^${ENVELOPE_PREFIX_PATTERN}## Knowledge$`, 'm'),
  working_memory: new RegExp(`^${ENVELOPE_PREFIX_PATTERN}## Recent Actions$`, 'm'),
  tool_registry: new RegExp(`^${ENVELOPE_PREFIX_PATTERN}## Tools \\(\\d+ available\\)$`, 'm'),
};

/**
 * The ledger charges the projection text the assembler produced, before the
 * Gateway envelope prefixes it. Strip a leading envelope prefix so the measured
 * character count and `byChannel[channel].applied` are the same quantity.
 */
function stripEnvelopePrefix(content: string): string {
  return content.replace(/^\[[^\]\n]*\]\s*/, '');
}

/**
 * Scripted OpenAI-compatible chat/completions endpoint. Chooses the next tool
 * call from which of its own calls already have results in the transcript.
 *
 * NOTE: the runtime sanitizes tool_call_ids to strict alphanumerics
 * (`sanitizeToolCallId`, openclaw_runtime/src/agents/tool-call-id.ts) and
 * de-duplicates collisions with a numeric suffix, so `call-read` comes back as
 * `callread` / `callread2`. Keying on the raw id therefore never matches and
 * the script would re-issue the same call forever. Match on the sanitized
 * prefix instead — this mirrors what a real provider sees.
 */
function startScriptedLlm(options?: {
  /** Abort the final (text) response mid-stream to simulate a terminal disconnect. */
  abortFinalResponse?: boolean;
}): Promise<{ server: Server; port: number; log: LlmRequestLog[]; trace: string[]; abortedFinalResponses: number }> {
  const log: LlmRequestLog[] = [];
  const state = { abortedFinalResponses: 0 };

  /** `call-read` → `callread`, matching the runtime's sanitizer. */
  const sanitizeId = (id: string): string => id.replace(/[^a-zA-Z0-9]/g, "");

  /** True when a result for `callId` is present under any sanitized spelling. */
  const hasResult = (results: Record<string, string>, callId: string): boolean => {
    const wanted = sanitizeId(callId);
    return Object.keys(results).some(
      (key) => key === wanted || new RegExp(`^${wanted}\\d+$`).test(key),
    );
  };

  /** Fetch the result for `callId` under any sanitized spelling. */
  const resultFor = (results: Record<string, string>, callId: string): string | undefined => {
    const wanted = sanitizeId(callId);
    const key = Object.keys(results).find(
      (candidate) => candidate === wanted || new RegExp(`^${wanted}\\d+$`).test(candidate),
    );
    return key ? results[key] : undefined;
  };

  /**
   * Chat history is per-session, so turn N's transcript still carries turn 1's
   * user text. Dispatch on the marker that appears LAST, otherwise every turn
   * would re-run the first turn's script.
   */
  const MARKERS = [
    'FIX-THE-BUG',
    'UNDO-THE-CHANGE',
    'FAILURE-PATHS',
    'EDIT-AGAIN',
    'UNDO-AFTER-SABOTAGE',
  ] as const;

  const activeMarker = (userText: string): string | null => {
    let best: string | null = null;
    let bestAt = -1;
    for (const marker of MARKERS) {
      const at = userText.lastIndexOf(marker);
      if (at > bestAt) {
        bestAt = at;
        best = marker;
      }
    }
    return bestAt >= 0 ? best : null;
  };

  function nextAction(userText: string, results: Record<string, string>): {
    toolCall?: ToolCallSpec;
    text?: string;
  } {
    const marker = activeMarker(userText);
    if (marker === 'FIX-THE-BUG') {
      if (!hasResult(results, 'callread')) {
        return { toolCall: { id: 'callread', name: 'read', args: { path: 'util.js' } } };
      }
      if (!hasResult(results, 'calledit')) {
        return {
          toolCall: {
            id: 'calledit',
            name: 'edit',
            args: {
              path: 'util.js',
              edits: [{ oldText: '  return a - b;', newText: FIXED_LINE }],
            },
          },
        };
      }
      if (!hasResult(results, 'callwrite')) {
        return {
          toolCall: {
            id: 'callwrite',
            name: 'write',
            args: { path: 'summary.txt', content: SUMMARY_AFTER },
          },
        };
      }
      if (!hasResult(results, 'callbash')) {
        return {
          toolCall: {
            id: 'callbash',
            name: 'bash',
            args: { command: 'node --check util.js' },
          },
        };
      }
      return { text: 'Fixed add() and rewrote summary.txt; syntax check ran. Review both diffs above.' };
    }
    if (marker === 'UNDO-THE-CHANGE') {
      if (!hasResult(results, 'callundoone')) {
        return { toolCall: { id: 'callundoone', name: 'undo_write', args: { steps: 2 } } };
      }
      return { text: `Undo outcome: ${resultFor(results, 'callundoone') ?? 'unknown'}` };
    }
    if (marker === 'FAILURE-PATHS') {
      if (!hasResult(results, 'callreadmiss')) {
        return { toolCall: { id: 'callreadmiss', name: 'read', args: { path: 'missing.js' } } };
      }
      if (!hasResult(results, 'calleditbad')) {
        return {
          toolCall: {
            id: 'calleditbad',
            name: 'edit',
            args: {
              path: 'util.js',
              edits: [{ oldText: 'THIS TEXT DOES NOT EXIST', newText: 'x' }],
            },
          },
        };
      }
      return { text: 'Both failure paths reported explicit errors.' };
    }
    if (marker === 'EDIT-AGAIN') {
      if (!hasResult(results, 'calleditagain')) {
        return {
          toolCall: {
            id: 'calleditagain',
            name: 'edit',
            args: {
              path: 'util.js',
              edits: [{ oldText: '  return a - b;', newText: '  return a * b;' }],
            },
          },
        };
      }
      return { text: 'Edited again.' };
    }
    if (marker === 'UNDO-AFTER-SABOTAGE') {
      if (!hasResult(results, 'callundotwo')) {
        return { toolCall: { id: 'callundotwo', name: 'undo_write', args: { steps: 1 } } };
      }
      return { text: `Second undo outcome: ${resultFor(results, 'callundotwo') ?? 'unknown'}` };
    }
    return { text: 'No script for this prompt.' };
  }

  return new Promise((resolve) => {
    const trace: string[] = [];
    const record = (event: string): void => {
      trace.push(`${new Date().toISOString()} ${event}`);
      if (trace.length > 200) trace.splice(0, trace.length - 200);
    };
    const server = createHttpServer((req, res) => {
      const socketId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
      record(`request ${req.method} ${req.url} socket=${socketId} contentLength=${req.headers['content-length'] ?? '-'}`);
      req.on('aborted', () => record(`request-aborted socket=${socketId}`));
      res.on('close', () => record(`response-close socket=${socketId} writableEnded=${res.writableEnded}`));
      res.on('error', (error) => record(`response-error socket=${socketId} ${String(error)}`));
      if (!(req.url ?? '').includes('/chat/completions')) {
        if ((req.url ?? '').includes('/models')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: [{ id: MODEL_ID }] }));
          return;
        }
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'not found' } }));
        return;
      }
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        let parsed: {
          stream?: boolean;
          messages?: Array<{ role: string; content?: unknown; tool_call_id?: string }>;
        } = {};
        try { parsed = JSON.parse(body); } catch { /* ignore */ }
        // Guard: if the script keeps re-issuing the same call the transcript is
        // not carrying tool results back — fail fast instead of spinning.
        if (log.length > 40) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            error: { message: `scripted-llm loop guard: ${log.length} requests without progress` },
          }));
          return;
        }
        const messages = parsed.messages ?? [];
        // Concatenate ALL user turns, not just the last one: with the DCS
        // working-memory block enabled the runtime appends its own
        // "## Recent Actions" user message after each tool result, which would
        // otherwise hide the driving marker and strand the script mid-turn.
        // (That injection appearing here is itself evidence the block is live.)
        const userText = messages
          .filter((m) => m.role === 'user')
          .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')))
          .join('\n');
        const toolResults: Record<string, string> = {};
        for (const message of messages) {
          if (message.role === 'tool' && typeof message.tool_call_id === 'string') {
            toolResults[message.tool_call_id] = typeof message.content === 'string'
              ? message.content
              : JSON.stringify(message.content ?? '');
          }
        }
        const action = nextAction(userText, toolResults);
        if (process.env.CLAWX_FP_P1_04_DUMP_BODIES === '1') {
          console.log('[fp-p1-04-request]', JSON.stringify({
            index: log.length,
            stream: Boolean(parsed.stream),
            hasResult: {
              callread: hasResult(toolResults, 'callread'),
              calledit: hasResult(toolResults, 'calledit'),
              callwrite: hasResult(toolResults, 'callwrite'),
              callbash: hasResult(toolResults, 'callbash'),
            },
            chosen: action.toolCall ? action.toolCall.id : 'text',
          }));
        }
        const projections = Object.fromEntries(
          Object.entries(DCS_PROJECTION_PATTERNS).map(([channel, pattern]) => [
            channel,
            messages.flatMap((message) =>
              typeof message.content === 'string' && pattern.test(message.content)
                ? [stripEnvelopePrefix(message.content)]
                : [],
            ),
          ]),
        ) as Record<DcsProjectionChannel, string[]>;
        if (process.env.CLAWX_FP_P1_04_DUMP_BODIES === '1') {
          console.log('[fp-p1-04-body]', JSON.stringify({
            requestIndex: log.length,
            finished: Boolean(req.complete),
            roles: messages.map((m) => m.role),
            toolCallIds: messages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id),
            assistantToolCalls: messages
              .filter((m) => m.role === 'assistant')
              .flatMap((m) => ((m as { tool_calls?: Array<{ id?: string }> }).tool_calls ?? []).map((c) => c.id)),
            chosen: action.toolCall ? action.toolCall.id : 'text',
          }));
        }
        if (log.length < 3) {

          console.log('[fp-p1-04-transcript]', JSON.stringify(
            messages.map((m) => ({
              role: m.role,
              tool_call_id: m.tool_call_id,
              contentType: typeof m.content,
              preview: typeof m.content === 'string'
                ? m.content.slice(0, 120)
                : JSON.stringify(m.content ?? '').slice(0, 200),
            })),
          ).slice(0, 2000));
        }
        log.push({
          turn: userText.slice(0, 60),
          toolResults,
          issued: action.toolCall ? action.toolCall.id : `text:${action.text?.slice(0, 40)}`,
          projections,
          // Compass SSP now shares the knowledge ledger with the DCS message.
          // Measure its actual provider-visible system-prompt block as well.
          systemKnowledge: messages.flatMap((message) =>
            message.role === 'system' && typeof message.content === 'string'
              ? message.content.split('\n\n').filter((block) => block.startsWith('[Session State]\n'))
              : [],
          ),
        });

        const usage = { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 };
        const assistantMessage = action.toolCall
          ? {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: action.toolCall.id,
                type: 'function',
                function: {
                  name: action.toolCall.name,
                  arguments: JSON.stringify(action.toolCall.args),
                },
              }],
            }
          : { role: 'assistant', content: action.text ?? '' };
        const finishReason = action.toolCall ? 'tool_calls' : 'stop';

        if (!action.toolCall && options?.abortFinalResponse) {
          // Terminal disconnect works for both streaming and non-streaming
          // clients: destroy the socket before a complete response is sent.
          state.abortedFinalResponses += 1;
          record('forced-final-abort');
          console.log('[fp-p1-04-forced-abort]', JSON.stringify({ stream: Boolean(parsed.stream), index: log.length }));
          if (parsed.stream) {
            res.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive' });
            // Emit only a partial delta (never the full completion text): the
            // runtime must not be able to reconstruct a success-looking answer.
            res.write(`data: ${JSON.stringify({ id: 'chatcmpl-mock', object: 'chat.completion.chunk', created: 1, model: MODEL_ID, choices: [{ index: 0, delta: { role: 'assistant', content: (action.text ?? '').slice(0, 8) }, finish_reason: null }] })}\n\n`);
            setTimeout(() => res.destroy(), 0);
          } else {
            res.writeHead(200, { 'content-type': 'application/json', 'content-length': '4096' });
            res.write('{"id":"chatcmpl-mock"');
            setTimeout(() => res.destroy(), 0);
          }
          return;
        }

        if (parsed.stream) {
          res.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
          });
          const chunk = (delta: Record<string, unknown>, finish: string | null) =>
            `data: ${JSON.stringify({
              id: 'chatcmpl-mock',
              object: 'chat.completion.chunk',
              created: 1,
              model: MODEL_ID,
              choices: [{ index: 0, delta, finish_reason: finish }],
              ...(finish ? { usage } : {}),
            })}\n\n`;
          if (!action.toolCall && options?.abortFinalResponse) {
            // Terminal disconnect: emit a partial delta, then destroy the socket
            // without finish_reason or [DONE]. The runtime must surface a visible
            // failure instead of inventing a successful final answer.
            state.abortedFinalResponses += 1;
            record('forced-final-abort');
            res.write(chunk({ role: 'assistant', content: action.text ?? '' }, null));
            setTimeout(() => res.destroy(), 0);
            return;
          }
          if (action.toolCall) {
            res.write(chunk({
              role: 'assistant',
              tool_calls: [{
                index: 0,
                id: action.toolCall.id,
                type: 'function',
                function: {
                  name: action.toolCall.name,
                  arguments: JSON.stringify(action.toolCall.args),
                },
              }],
            }, null));
          } else {
            res.write(chunk({ role: 'assistant', content: action.text ?? '' }, null));
          }
          res.write(chunk({}, finishReason));
          res.write('data: [DONE]\n\n');
          res.end();
        } else {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            id: 'chatcmpl-mock',
            object: 'chat.completion',
            created: 1,
            model: MODEL_ID,
            choices: [{ index: 0, message: assistantMessage, finish_reason: finishReason }],
            usage,
          }));
        }
      });
    });
    server.on('connection', (socket) => {
      const socketId = `${socket.remoteAddress}:${socket.remotePort}`;
      record(`connection open socket=${socketId}`);
      socket.on('close', () => record(`connection close socket=${socketId}`));
      socket.on('error', (error) => record(`connection error socket=${socketId} ${String(error)}`));
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('llm port failed');
      resolve({ server, port: address.port, log, trace, get abortedFinalResponses() { return state.abortedFinalResponses; } });
    });
  });
}

/**
 * Find a tool result in the scripted-LLM log by the id the SPEC issued.
 * The runtime sanitizes ids (`call-read` -> `callread`/`callread2`), so an
 * exact-key lookup would silently return '' and make assertions vacuous.
 */
function toolResultFor(log: LlmRequestLog[], callId: string): string {
  const wanted = callId.replace(/[^a-zA-Z0-9]/g, '');
  const matches = (key: string): boolean =>
    key === wanted || new RegExp(`^${wanted}\\d+$`).test(key);
  for (const entry of log) {
    const key = Object.keys(entry.toolResults).find(matches);
    if (key) return entry.toolResults[key] ?? '';
  }
  return '';
}

async function allocatePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('port allocation failed')));
        return;
      }
      server.close((err) => (err ? reject(err) : resolve(address.port)));
    });
  });
}

async function hostInvoke<T>(
  app: ElectronApplication,
  module: string,
  action: string,
  payload: Record<string, unknown> | null = null,
): Promise<T> {
  const response = (await app.evaluate(async (_electron, request) => {
    const { ipcMain, BrowserWindow } = process.mainModule!.require(
      'electron',
    ) as typeof import('electron');
    const handler = (
      ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      }
    )._invokeHandlers?.get('host:invoke');
    if (!handler) throw new Error('host:invoke handler is not registered');
    const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (!win) throw new Error('No BrowserWindow available for host:invoke sender auth');
    const sender = win.webContents;
    const event = {
      sender,
      senderFrame: { url: typeof sender.getURL === 'function' ? sender.getURL() : '' },
    };
    return await handler(event, { id: `fp-p1-04-${Date.now()}-${Math.random()}`, ...request });
  }, { module, action, payload })) as HostResponse<T>;
  if (!response.ok) {
    throw new Error(`[${response.error?.code ?? 'HOST'}] ${response.error?.message ?? 'failed'}`);
  }
  return response.data as T;
}

async function startGateway(app: ElectronApplication): Promise<void> {
  const port = await allocatePort();
  await hostInvoke<HostSuccess>(app, 'settings', 'set', { key: 'gatewayPort', value: port });
  const deadline = Date.now() + 240_000;
  let attempts = 0;
  let lastStatus: GatewayStatus | undefined;
  let lastError: string | undefined;
  while (Date.now() < deadline) {
    try {
      lastStatus = await hostInvoke<GatewayStatus>(app, 'gateway', 'status');
      if (lastStatus.gatewayReady === true || lastStatus.state === 'running') return;
      if (lastStatus.state !== 'starting' && attempts < 10) {
        attempts += 1;
        try {
          await hostInvoke<HostSuccess>(app, 'gateway', 'start');
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  const snapshot = await hostInvoke<Record<string, unknown>>(
    app,
    'diagnostics',
    'gatewaySnapshot',
  ).catch((error) => ({ diagnosticError: error instanceof Error ? error.message : String(error) }));
  throw new Error(`gateway never became ready: ${JSON.stringify({
    port,
    attempts,
    lastStatus,
    lastError,
    snapshot,
  }).slice(0, 12_000)}`);
}

function seedCompassKnowledgeFixture(userDataDir: string): void {
  const databasePath = join(
    userDataDir,
    'openclaw-source-state',
    'state',
    'openclaw.sqlite',
  );
  const db = new DatabaseSync(databasePath);
  const now = Date.now();
  try {
    db.exec('PRAGMA busy_timeout = 30000;');
    db.prepare(`INSERT INTO context_blocks (
      block_id, block_type, source_system, session_id, summary, full_content,
      presence_json, mutability, role_scope, entities_json, entity_extraction_status,
      compression_depth, fallback_mode, retention_confidence, valid_at, invalid_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'fixture:fp-p2-06:knowledge:agent:main:main',
      'knowledge',
      'compass',
      'agent:main:main',
      'FP-P2-06 controlled fixture knowledge',
      'fixture: preserve the frozen controlled-preview boundaries',
      JSON.stringify({ always_on: false, background: true }),
      'system_managed',
      null,
      '[]',
      'empty',
      0,
      null,
      null,
      now - 1_000,
      null,
      now,
    );
  } finally {
    db.close();
  }
}

function measuredProjectionChars(
  log: LlmRequestLog[],
  channel: DcsProjectionChannel,
): { requestCount: number; messageCount: number; chars: number } {
  const requests = log.filter((entry) => entry.projections[channel].length > 0
    || (channel === 'knowledge' && entry.systemKnowledge.length > 0));
  const messages = requests.flatMap((entry) => entry.projections[channel]);
  // The same system prompt is resent with each tool-loop call, but the turn
  // ledger charges each SSP contribution once. DCS message accounting stays exact.
  if (channel === 'knowledge') messages.push(...new Set(requests.flatMap((entry) => entry.systemKnowledge)));
  return {
    requestCount: requests.length,
    messageCount: messages.length,
    chars: messages.reduce((sum, message) => sum + message.length, 0),
  };
}

async function sendTurn(
  app: ElectronApplication,
  workspaceId: string,
  log: LlmRequestLog[],
  message: string,
  finalMarker: string,
  trace: string[] = [],
): Promise<void> {
  const sendResult = await hostInvoke<Record<string, unknown>>(app, 'chat', 'sendWithMedia', {
    workspaceId,
    sessionKey: 'agent:main:main',
    message,
    idempotencyKey: `fp-p1-04-${Date.now()}-${Math.random()}`,
  });

  console.log('[fp-p1-04-send]', JSON.stringify(sendResult).slice(0, 400));
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (log.some((entry) => entry.issued?.startsWith(`text:${finalMarker.slice(0, 20)}`)
      || (entry.issued?.startsWith('text:') && entry.turn.includes(message.slice(0, 20))))) {
      // Give the runtime a moment to flush the final assistant message.
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  console.log('[fp-p1-04-stall]', JSON.stringify({
    llmRequests: log.length,
    issued: log.map((entry) => entry.issued),
    lastTurn: log.at(-1)?.turn,
    providerTrace: trace.slice(-40),
  }).slice(0, 4000));
  throw new Error(`turn did not reach its final response: ${message}`);
}

async function selectCodingLoopTask(app: ElectronApplication, workspaceId: string): Promise<void> {
  const task = await createSessionChainTask(app, workspaceId, 'fp-p1-04-coding-task', {
    objective: 'Exercise real coding diffs, verification, undo and explicit failure outcomes',
    target: 'util.js',
    constraints: ['Keep changes inside the independent fixture workspace', 'Retain snapshots after failed undo'],
    acceptance: [{ id: 'coding-loop', description: 'Real coding tool and journal receipts',
      verification: { kind: 'owner-receipt', owner: 'coding-tools',
        requires: ['read', 'edit', 'write', 'exec', 'undo_write'], files: ['util.js', 'summary.txt'] } }],
  });
  await hostInvoke(app, 'workspaces', 'selectSessionTask', {
    workspaceId, sessionKey: 'agent:main:main', taskNodeId: task.contract.taskNodeId,
  });
}

async function writeScriptedConfig(params: {
  homeDir: string;
  userDataDir: string;
  workspaceDir: string;
  llmPort: number;
}): Promise<void> {
  const config = {
    gateway: { mode: 'local', controlUi: { enabled: false } },
    models: {
      mode: 'merge',
      providers: {
        openai: {
          api: 'openai-completions',
          apiKey: 'test-key-ok',
          baseUrl: `http://127.0.0.1:${params.llmPort}/v1`,
          models: [{
            id: MODEL_ID,
            name: MODEL_ID,
            api: 'openai-completions',
            reasoning: false,
            input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 4096,
          }],
        },
      },
    },
    runtime: {
      contextBlock: {
        'compass': { enabled: true },
        'working-memory': { enabled: true },
        'tool-registry': { enabled: true },
      },
      coding: {
        staleWriteGuard: { enabled: true },
        autoVerify: { enabled: true, timeoutSeconds: 30 },
      },
    },
    tools: {
      profile: 'full',
      exec: { host: 'gateway', security: 'full', ask: 'off' },
    },
    agents: {
      defaults: {
        model: { primary: `openai/${MODEL_ID}`, fallbacks: [] },
        workspace: params.workspaceDir,
        skipBootstrap: true,
      },
      list: [{ id: 'main', default: true }],
    },
    skills: { allowBundled: [] },
  };
  const serialized = `${JSON.stringify(config, null, 2)}\n`;
  const openclawDir = join(params.homeDir, '.openclaw');
  const sourceStateDir = join(params.userDataDir, 'openclaw-source-state');
  await mkdir(openclawDir, { recursive: true });
  await mkdir(sourceStateDir, { recursive: true });
  await writeFile(join(openclawDir, 'openclaw.json'), serialized, 'utf8');
  await writeFile(join(sourceStateDir, 'openclaw.json'), serialized, 'utf8');
}

async function captureCodingLoopObservation(
  homeDir: string, userDataDir: string, workspaceDir: string, llm: { log: LlmRequestLog[]; trace: string[] },
): Promise<void> {
  const configs: Record<string, unknown> = {};
  for (const [name, path] of Object.entries({
    user: join(homeDir, '.openclaw/openclaw.json'),
    isolated: join(userDataDir, 'openclaw-source-state/openclaw.json'),
  })) {
    try {
      const config = JSON.parse(await readFile(path, 'utf8'));
      configs[name] = { runtime: config.runtime, workspace: config.agents?.defaults?.workspace };
    } catch (error) { configs[name] = { readError: String(error) }; }
  }
  let gitIdentity: string;
  try { gitIdentity = execFileSync('git', ['rev-parse', '--show-toplevel', 'HEAD'], { cwd: workspaceDir, encoding: 'utf8' }); }
  catch (error) { gitIdentity = String(error); }
  const path = test.info().outputPath('fp-p1-04-owner-observation.json');
  await writeFile(path, JSON.stringify({ driven_by: 'agent', actor: 'codex-fp-p1-04-observer',
    candidate: process.env.CLAWX_E2E_CANDIDATE ?? 'dirty-development', recordedAt: new Date().toISOString(),
    workspaceDir, gitIdentity, gitEnvKeys: Object.keys(process.env).filter(key => key.startsWith('GIT_')),
    configs, providerLog: llm.log, providerTrace: llm.trace,
  }, null, 2));
  await test.info().attach('fp-p1-04-owner-observation', { path, contentType: 'application/json' });
}

test.describe('FP-P1-04 coding loop (real agent turn, scripted local LLM)', () => {
  test('read → edit/write rich diffs → verify → undo, plus explicit failure paths', async ({
    homeDir,
    userDataDir,
    launchElectronApp,
  }) => {
    test.setTimeout(1_500_000);
    const llm = await startScriptedLlm();
    // The Gateway child runs at a different integrity level than this worker:
    // on Windows hosts whose TEMP lives under a guarded directory (D:\tmp) it
    // cannot create or write files there, so edit/write/exec all fail with
    // EPERM. Put the disposable workspace under the agent-owned E2E run root
    // (already writable by both sides) and keep tmpdir() only as a fallback.
    const workspaceBase = process.env.CLAWX_E2E_RUN_ROOT
      ? join(process.env.CLAWX_E2E_RUN_ROOT, 'fp-p1-04-workspace')
      : tmpdir();
    await mkdir(workspaceBase, { recursive: true });
    const workspaceDir = await mkdtemp(join(workspaceBase, 'clawx-fp-p1-04-'));
    await writeFile(join(workspaceDir, 'util.js'), BUGGY, 'utf8');
    await writeFile(join(workspaceDir, 'summary.txt'), SUMMARY_BEFORE, 'utf8');
    // A real workspace is a Git repository: the review Changes panel shows the
    // agent's edit as a true before/after diff (MonacoDiffViewer) only when
    // git state exists. Commit the buggy baseline so the fixed file diff is
    // visible after the run.
    await writeFile(
      join(workspaceDir, 'auto-verify.cjs'),
      [
        "const { appendFileSync, readFileSync } = require('node:fs');",
        "const source = readFileSync('util.js', 'utf8');",
        "const passed = source.includes('return a + b;');",
        "appendFileSync('auto-verify-runs.log', passed ? 'pass\\n' : 'fail\\n');",
        "console.log(passed ? 'AUTO_VERIFY_PASS' : 'AUTO_VERIFY_FAIL');",
        "if (!passed) process.exit(3);",
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(workspaceDir, 'package.json'),
      `${JSON.stringify({ scripts: { test: 'node auto-verify.cjs' } }, null, 2)}\n`,
      'utf8',
    );

    initializeIndependentGitWorkspace(workspaceDir);
    await writeScriptedConfig({ homeDir, userDataDir, workspaceDir, llmPort: llm.port });

    const app = await launchElectronApp({ skipSetup: true });
    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
      const workspace = await hostInvoke<{ activeWorkspace: { id: string } }>(app, 'workspaces', 'create', { name: 'FP-P1-04 coding', rootPath: workspaceDir,
        agentId: 'main', activeSessionKey: 'agent:main:main', permissionMode: 'fullAccess' });
      const workspaceId = workspace.activeWorkspace.id;
      await page.reload();
      await startGateway(app);
      await selectCodingLoopTask(app, workspaceId);
      // The production Compass producer requires a legacy pre-reply payload that
      // this scripted provider does not create before its first request. Seed one
      // explicitly labelled Block in the real child state DB; working memory and
      // tool registry remain production-generated by real tool/agent events.
      seedCompassKnowledgeFixture(userDataDir);

      // ---- T1: happy loop ----
      await sendTurn(app, workspaceId, llm.log, 'FIX-THE-BUG in util.js: add() subtracts.', 'Fixed add()', llm.trace);
      const fixed = await readFile(join(workspaceDir, 'util.js'), 'utf8');
      expect(fixed).toContain('return a + b;');
      // read really returned the file to the model:
      const readResult = toolResultFor(llm.log, 'callread');
      expect(readResult).toContain('return a - b;');
      // edit produced a diff for the model/UI (write segment evidence):
      const editResult = toolResultFor(llm.log, 'calledit');
      expect(editResult.length).toBeGreaterThan(0);
      const writeResult = toolResultFor(llm.log, 'callwrite');
      expect(writeResult.length).toBeGreaterThan(0);
      expect(await readFile(join(workspaceDir, 'summary.txt'), 'utf8')).toBe(SUMMARY_AFTER);
      // FP-P2-05: both successful mutations synchronously ran the detected npm
      // test through the canonical exec tool. The marker is written by the real
      // child process, not by the scripted model or test harness.
      expect(editResult).toMatch(/verify_tests: passed\(node\/npm\): npm test/);
      expect(editResult).toContain('AUTO_VERIFY_PASS');
      expect(writeResult).toMatch(/verify_tests: passed\(node\/npm\): npm test/);
      const automaticRuns = await readFile(join(workspaceDir, 'auto-verify-runs.log'), 'utf8');
      expect(automaticRuns.trim().split('\n')).toEqual(['pass', 'pass']);
      // verify segment ran and reported something (success or explainable denial):
      const bashResult = toolResultFor(llm.log, 'callbash');
      expect(bashResult.length).toBeGreaterThan(0);
      // journal holds both mutation snapshots, with lineage:
      const journalRoot = join(workspaceDir, '.openclaw', 'journal');
      const sessions = await readdir(journalRoot);
      expect(sessions.length).toBeGreaterThan(0);
      const sessionDir = join(journalRoot, sessions[0]);
      const metaFiles = (await readdir(sessionDir)).filter((name) => name.endsWith('.meta.json'));
      expect(metaFiles).toHaveLength(2);
      const metas = await Promise.all(metaFiles.map(async (metaFile) => JSON.parse(
        await readFile(join(sessionDir, metaFile), 'utf8'),
      ) as {
        relPath?: string; lineage?: { sessionId?: string; workspaceRoot?: string };
      }));
      expect(metas.map((meta) => meta.relPath).sort()).toEqual(['summary.txt', 'util.js']);
      expect(metas.every((meta) => (meta.lineage?.sessionId?.length ?? 0) > 0)).toBe(true);

      console.log('[fp-p1-04-t1]', JSON.stringify({
        fixedApplied: fixed.includes('return a + b;'),
        editResultPreview: editResult.slice(0, 200),
        bashResultPreview: bashResult.slice(0, 200),
        writeResultPreview: writeResult.slice(0, 200),
        journalMetas: metas,
      }));

      // ---- T1b: diff段 + verify段 are USER-VISIBLE, not just in logs ----
      // Ordinary tool details remain private. The display projection preserves
      // only strictly validated mutation artifacts and journal lineage, which
      // drive the CodeDiff surfaces below.
      // The turn summary card collapses its details by default; open it so the
      // per-tool work panel (which carries the diff/verify text) is rendered.
      const summaryToggle = page.getByTestId('chat-turn-summary-toggle').first();
      if (await summaryToggle.count() > 0) {
        /*
         * No `.catch()` on the click on purpose: swallowing it turned a failed
         * interaction into a silent `<no-activity>` log and then an unrelated
         * assertion failure two lines later. The toggle is a controlled
         * disclosure, so the panel only exists once the parent has committed the
         * new `expanded` value — wait for it instead of reading immediately.
         */
        // A live turn may still be marked active when sendTurn resolves. Active
        // cards are intentionally open by default, so only click when the
        // disclosure is currently closed; an unconditional click would hide
        // the details and make this assertion test the opposite behavior.
        if (await summaryToggle.getAttribute('aria-expanded') !== 'true') {
          await summaryToggle.click();
        }
        /*
         * `aria-expanded` is the component's own view of the disclosure state,
         * so asserting it first splits "the click never reached the state" from
         * "the state says expanded but the panel is not rendered".
         */
        await expect
          .poll(async () => summaryToggle.getAttribute('aria-expanded'), { timeout: 10_000 })
          .toBe('true');
        await expect(page.getByTestId('chat-turn-summary-details').first())
          .toBeVisible({ timeout: 15_000 });
      }
      const activity = page.getByTestId('chat-turn-summary-details').first();
      const activityText = (await activity.count()) > 0 ? await activity.innerText() : '<no-activity>';

      console.log('[fp-p1-04-activity]', JSON.stringify(activityText).slice(0, 2500));
      const chatText = await page.getByTestId('chat-message-layout').innerText();

      console.log('[fp-p1-04-chatdom]', JSON.stringify(chatText).slice(0, 3000));

      // The evidence the model received is the same text the product renders;
      // assert on the tool result that actually carried it.
      expect(editResult).toContain('diff:');
      expect(editResult).toContain('return a + b;');
      // verify段: the automatic test result and bounded output tail are carried
      // by the successful edit result, rather than relying on the later manual
      // bash call retained above for FP-P1-04 compatibility coverage.
      expect(editResult).toMatch(/verify_tests: passed\(node\/npm\)/);
      expect(editResult).toContain('verify_output_tail:');
      // ...and it is present in the rendered transcript, not only in the log.
      const rendered = `${activityText}\n${chatText}`;
      expect(rendered).toContain('util.js');
      expect(rendered).toContain('AUTO_VERIFY_PASS');

      // Text files with a complete patch are owned by the inline diff surface;
      // the generated-file chip row intentionally omits them to avoid
      // announcing the same mutation twice (see Generated file ownership).
      const mutationDiffs = page.getByTestId('chat-mutation-diffs');
      await expect(mutationDiffs).toBeVisible({ timeout: 30_000 });
      await expect(mutationDiffs).toContainText('util.js');
      await expect(mutationDiffs).toContainText('summary.txt');

      // Shared injection budget accounting after a REAL turn (FP-P1-11).
      const ack = await hostInvoke<Record<string, unknown>>(app, 'gateway', 'rpc', {
        method: 'runtime.flags.ack', params: {}, timeoutMs: 30_000,
      });
      const budget = (ack as {
        injectionBudget?: {
          precedence?: string[];
          counters?: Record<string, number>;
          lastTurn?: {
            killed?: boolean;
            charsApplied?: number;
            charsRequested?: number;
            charsDropped?: number;
            charsTruncated?: number;
            byChannel?: Record<string, { requested: number; applied: number; disposition: string }>;
            degradationOrder?: Array<{ channel: string; disposition: string }>;
          } | null;
        };
      }).injectionBudget;

      console.log('[fp-p1-04-budget]', JSON.stringify(budget));

      // FP-P1-11 AC1: a real turn produced non-zero accounting.
      const counters = budget?.counters ?? {};
      expect(counters.turns ?? 0).toBeGreaterThan(0);
      expect(counters.appliedChars ?? 0).toBeGreaterThan(0);

      // FP-P1-11 AC2: the books balance — applied + dropped + truncated == requested.
      // This is the assertion that catches "charged but injected something else".
      expect(
        (counters.appliedChars ?? 0) + (counters.droppedChars ?? 0) + (counters.truncatedChars ?? 0),
      ).toBe(counters.requestedChars ?? -1);

      // FP-P2-06: all three DCS projections now charge the same real attempt
      // ledger. The scripted endpoint measured every provider request
      // independently, so this comparison does not reuse the charge return value.
      const lastTurn = budget?.lastTurn ?? null;
      expect(lastTurn).not.toBeNull();
      const channels = Object.keys(lastTurn?.byChannel ?? {});
      const measured = Object.fromEntries(
        (Object.keys(DCS_PROJECTION_PATTERNS) as DcsProjectionChannel[]).map((channel) => [
          channel,
          measuredProjectionChars(llm.log, channel),
        ]),
      ) as Record<DcsProjectionChannel, ReturnType<typeof measuredProjectionChars>>;

      console.log('[fp-p1-11-bychannel]', JSON.stringify({
        channels,
        byChannel: lastTurn?.byChannel,
        degradationOrder: lastTurn?.degradationOrder,
        measured,
      }));
      expect(channels).toEqual(expect.arrayContaining([
        'knowledge',
        'working_memory',
        'tool_registry',
      ]));
      for (const channel of Object.keys(measured) as DcsProjectionChannel[]) {
        /*
         * FP-P2-06 acceptance (harness/specs/tasks/remote-forge-controlled-preview.md):
         * with the three DCS projections enabled, all three must be
         * provider-visible and each channel's measured characters must equal the
         * ledger's `applied`. A channel the ledger charged but that never
         * reached the request is the "charged but injected something else" bug
         * this comparison exists to catch.
         *
         * Do NOT relax this to "present only if the ledger applied > 0": that
         * would accept a dropped higher-precedence channel, which the same spec
         * forbids ("a prior low-priority CVK charge cannot consume reserved
         * higher-priority DCS capacity").
         */
        expect(measured[channel].requestCount, channel).toBeGreaterThan(0);
        expect(measured[channel].messageCount, channel).toBeGreaterThan(0);
        expect(lastTurn?.byChannel?.[channel]?.applied, channel).toBe(measured[channel].chars);
      }
      // Every charged channel must be a declared precedence entry — an unknown
      // channel would mean the ledger and the precedence table have drifted.
      for (const channel of channels) {
        expect(budget?.precedence ?? []).toContain(channel);
      }

      // Per-turn books balance too, not just the running totals.
      expect(
        (lastTurn?.charsApplied ?? 0)
        + (lastTurn?.charsDropped ?? 0)
        + (lastTurn?.charsTruncated ?? 0),
      ).toBe(lastTurn?.charsRequested ?? -1);

      // FP-P1-11 AC5: degradation followed the DECLARED precedence — whatever
      // was cut must sit no earlier than any channel that survived intact.
      const precedence = budget?.precedence ?? [];
      const degraded = lastTurn?.degradationOrder ?? [];
      if (degraded.length > 0) {
        const rank = (channel: string): number => {
          const at = precedence.indexOf(channel);
          return at < 0 ? precedence.length : at;
        };
        const intact = Object.entries(lastTurn?.byChannel ?? {})
          .filter(([, value]) => value.disposition === 'applied')
          .map(([channel]) => rank(channel));
        const worstIntact = intact.length > 0 ? Math.max(...intact) : -1;
        for (const entry of degraded) {
          expect(rank(entry.channel)).toBeGreaterThanOrEqual(worstIntact);
        }
      }

      // ---- T2: undo restores pre-edit content ----
      await sendTurn(app, workspaceId, llm.log, 'UNDO-THE-CHANGE please.', 'Undo outcome', llm.trace);
      const reverted = await readFile(join(workspaceDir, 'util.js'), 'utf8');
      expect(reverted).toBe(BUGGY);
      expect(await readFile(join(workspaceDir, 'summary.txt'), 'utf8')).toBe(SUMMARY_BEFORE);
      const undoResult = toolResultFor(llm.log, 'callundoone');

      console.log('[fp-p1-04-t2]', JSON.stringify({
        reverted: reverted === BUGGY,
        undoResult: undoResult.slice(0, 400),
      }));
      // Success is reported, not inferred. Tolerate JSON spacing/pretty-printing
      // but require an explicit positive ok — never accept a silent empty result.
      expect(undoResult.length).toBeGreaterThan(0);
      expect(undoResult.replace(/\s+/g, '')).toContain('"ok":true');

      // ---- T3: failure paths are explicit, not silent ----
      await sendTurn(app, workspaceId, llm.log, 'FAILURE-PATHS demo.', 'Both failure paths', llm.trace);
      const missResult = toolResultFor(llm.log, 'callreadmiss');
      const badEditResult = toolResultFor(llm.log, 'calleditbad');

      console.log('[fp-p1-04-t3]', JSON.stringify({
        missResult: missResult.slice(0, 200),
        badEditResult: badEditResult.slice(0, 200),
      }));
      expect(missResult.toLowerCase()).toMatch(/not found|enoent|no such|does not exist|error/);
      expect(badEditResult.toLowerCase()).toMatch(/not found|no match|failed|error|unable/);
      // The failed edit wrote nothing:
      expect(await readFile(join(workspaceDir, 'util.js'), 'utf8')).toBe(BUGGY);

      // ---- T4: partial-undo is a reported failure with the journal retained ----
      await sendTurn(app, workspaceId, llm.log, 'EDIT-AGAIN please.', 'Edited again', llm.trace);
      const afterEditAgain = await readFile(join(workspaceDir, 'util.js'), 'utf8');
      expect(afterEditAgain).toContain('return a * b;');
      const editAgainResult = toolResultFor(llm.log, 'calleditagain');
      expect(editAgainResult).toMatch(/verify_tests: failed\(node\/npm\): npm test/);
      expect(editAgainResult).toContain('AUTO_VERIFY_FAIL');
      // A failed verify is evidence, not a transaction rollback: the successful
      // edit and its journal entry remain authoritative.
      expect(await readFile(join(workspaceDir, 'util.js'), 'utf8')).toContain('return a * b;');
      // Sabotage: remove the newest snapshot from disk (simulates snapshot loss).
      const sessionsNow = await readdir(journalRoot);
      const sessionDirNow = join(journalRoot, sessionsNow[0]);
      const preFiles = (await readdir(sessionDirNow)).filter((name) => name.endsWith('.pre'));
      expect(preFiles.length).toBeGreaterThan(0);
      const newestPre = preFiles.sort().at(-1)!;
      await unlink(join(sessionDirNow, newestPre));

      await sendTurn(app, workspaceId, llm.log, 'UNDO-AFTER-SABOTAGE now.', 'Second undo outcome', llm.trace);
      const undo2Result = toolResultFor(llm.log, 'callundotwo');

      console.log('[fp-p1-04-t4]', JSON.stringify({ undo2Result: undo2Result.slice(0, 300) }));
      // HARD LOCK: partial restore is a reported FAILURE with recovery pointers.
      // Whitespace-insensitive on the JSON shape only; the failure itself, the
      // reason, and the recovery pointer are all still required verbatim.
      expect(undo2Result.length).toBeGreaterThan(0);
      expect(undo2Result.replace(/\s+/g, '')).toContain('"ok":false');
      expect(undo2Result).toContain('journal snapshot missing');
      expect(undo2Result).toContain('journalDir');
      // The file was NOT half-restored and the journal metadata survives on disk.
      expect(await readFile(join(workspaceDir, 'util.js'), 'utf8')).toContain('return a * b;');
      const metasAfter = (await readdir(sessionDirNow)).filter((name) => name.endsWith('.meta.json'));
      expect(metasAfter.length).toBeGreaterThan(0);
    } finally {
      try { await captureCodingLoopObservation(homeDir, userDataDir, workspaceDir, llm); }
      catch (error) { console.error('[fp-p1-04-owner-observation]', String(error)); }
      // Diagnostic: the child's own log explains a stalled turn far better than
      // the harness can from outside.
      try {
        const snapshot = await hostInvoke<Record<string, unknown>>(
          app, 'diagnostics', 'gatewaySnapshot',
        );
        const tail = (value: unknown): string =>
          typeof value === 'string' ? value.split('\n').slice(-40).join('\n') : '';

        console.log('[fp-p1-04-gateway-log]', tail(snapshot.gatewayLogTail).slice(-3000));

        console.log('[fp-p1-04-gateway-err]', tail(snapshot.gatewayErrLogTail).slice(-3000));
      } catch (error) {

        console.log('[fp-p1-04-gateway-log-unavailable]', String(error).slice(0, 300));
      }
      await closeElectronApp(app);
      await new Promise<void>((resolve) => llm.server.close(() => resolve()));
      await rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('terminal provider disconnect fails visibly and the next turn succeeds', async ({
    homeDir,
    userDataDir,
    launchElectronApp,
  }) => {
    test.setTimeout(600_000);
    const providerFault = { abortFinalResponse: true };
    const llm = await startScriptedLlm(providerFault);
    const workspaceBase = process.env.CLAWX_E2E_RUN_ROOT
      ? join(process.env.CLAWX_E2E_RUN_ROOT, 'fp-p1-04-workspace')
      : tmpdir();
    await mkdir(workspaceBase, { recursive: true });
    const workspaceDir = await mkdtemp(join(workspaceBase, 'clawx-fp-p1-04-abort-'));
    await writeFile(join(workspaceDir, 'util.js'), BUGGY, 'utf8');
    await writeFile(join(workspaceDir, 'summary.txt'), SUMMARY_BEFORE, 'utf8');

    initializeIndependentGitWorkspace(workspaceDir);
    await writeScriptedConfig({ homeDir, userDataDir, workspaceDir, llmPort: llm.port });

    const app = await launchElectronApp({ skipSetup: true });
    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
      const workspace = await hostInvoke<{ activeWorkspace: { id: string } }>(app, 'workspaces', 'create', { name: 'FP-P1-04 disconnect', rootPath: workspaceDir,
        agentId: 'main', activeSessionKey: 'agent:main:main', permissionMode: 'fullAccess' });
      const workspaceId = workspace.activeWorkspace.id;
      await page.reload();
      await startGateway(app);
      await selectCodingLoopTask(app, workspaceId);
      seedCompassKnowledgeFixture(userDataDir);

      await hostInvoke<Record<string, unknown>>(app, 'chat', 'sendWithMedia', {
        workspaceId,
        sessionKey: 'agent:main:main',
        message: 'FIX-THE-BUG in util.js: add() subtracts.',
        idempotencyKey: `fp-p1-04-abort-${Date.now()}`,
      });

      await expect
        .poll(() => llm.abortedFinalResponses, { timeout: 180_000 })
        .toBeGreaterThan(0);
      // The aborted turn must surface a failure, not a success-looking answer.
      // The UI renders this as "Needs attention" plus the CodingRun evidence
      // card; it must NOT render a fabricated final answer.
      await expect
        .poll(async () => {
          const text = await page.getByTestId('chat-message-layout').innerText();
          if (process.env.CLAWX_FP_P1_04_DUMP_BODIES === '1') {
            console.log('[fp-p1-04-abort-ui]', JSON.stringify(text.slice(0, 1200)));
          }
          return /needs attention|failed|error|network|connection/i.test(text);
        }, { timeout: 120_000 })
        .toBe(true);

      const afterAbort = await page.getByTestId('chat-message-layout').innerText();
      // No success-looking completion text from the aborted final response.
      expect(afterAbort).not.toContain('Fixed add() and rewrote summary.txt');
      const abortedResponses = llm.abortedFinalResponses;
      providerFault.abortFinalResponse = false;
      await sendTurn(app, workspaceId, llm.log, 'FAILURE-PATHS after the disconnected reply.', 'Both failure paths', llm.trace);
      await expect(page.getByTestId('chat-message-layout')).toContainText('Both failure paths reported explicit errors.');
      expect(llm.abortedFinalResponses).toBe(abortedResponses);
    } finally {
      try { await captureCodingLoopObservation(homeDir, userDataDir, workspaceDir, llm); }
      catch (error) { console.error('[fp-p1-04-owner-observation]', String(error)); }
      try {
        await closeElectronApp(app);
      } finally {
        await new Promise<void>((resolve) => llm.server.close(() => resolve()));
        await rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  });
});
