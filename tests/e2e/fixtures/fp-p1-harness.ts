/**
 * Shared FP-P1 E2E harness: host-invoke bridge, gateway bring-up, and the
 * scripted local OpenAI-compatible LLM endpoint (FP-P1-07 route A — real
 * gateway + local mock provider endpoint; the LLM decisions are scripted, the
 * runtime/tools/journal under test are production code).
 */
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import type { ElectronApplication } from '@playwright/test';

export type HostResponse<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string } };
export type GatewayStatus = { state?: string; port?: number; gatewayReady?: boolean };
export type HostSuccess = { success: boolean };

export const MOCK_MODEL_ID = 'mock-coder';

export async function allocatePort(): Promise<number> {
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

export async function hostInvoke<T>(
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
    return await handler(event, { id: `fp-p1-${Date.now()}-${Math.random()}`, ...request });
  }, { module, action, payload })) as HostResponse<T>;
  if (!response.ok) {
    throw new Error(`[${response.error?.code ?? 'HOST'}] ${response.error?.message ?? 'failed'}`);
  }
  return response.data as T;
}

export async function startGateway(app: ElectronApplication, options: { port?: number } = {}): Promise<number> {
  const port = options.port ?? await allocatePort();
  await hostInvoke<HostSuccess>(app, 'settings', 'set', { key: 'gatewayPort', value: port });
  const deadline = Date.now() + 240_000;
  let attempts = 0;
  while (Date.now() < deadline) {
    try {
      const status = await hostInvoke<GatewayStatus>(app, 'gateway', 'status');
      if (status.gatewayReady === true || status.state === 'running') return port;
      if (status.state !== 'starting' && attempts < 10) {
        attempts += 1;
        await hostInvoke<HostSuccess>(app, 'gateway', 'start').catch(() => undefined);
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error('gateway never became ready');
}

export type ToolCallSpec = { id: string; name: string; args: Record<string, unknown> };

export type LlmRequestLog = {
  turn: string;
  toolResults: Record<string, string>;
  issued: string | null;
};

export type LlmScript = (
  userText: string,
  toolResults: Record<string, string>,
  requestIndex: number,
) => { toolCall?: ToolCallSpec; text?: string } | Promise<{ toolCall?: ToolCallSpec; text?: string }>;

/**
 * Scripted OpenAI-compatible chat/completions endpoint. The script decides the
 * next tool call from which of its own call-ids already have tool results in
 * the transcript. Supports streaming (SSE) and non-streaming clients.
 */
export function startScriptedLlm(script: LlmScript): Promise<{
  server: Server;
  port: number;
  log: LlmRequestLog[];
  /** Requests the mock saw but could not answer usefully; see `recordAnomaly`. */
  anomalies: string[];
}> {
  const log: LlmRequestLog[] = [];
  /**
   * Requests the mock answered nothing useful for, or never saw at all.
   *
   * Without this, a request that misses an endpoint or throws inside the
   * completions handler leaves no trace: `log` only records requests the script
   * actually answered, so the caller sees a shorter transcript and the runtime
   * reports a bare "the model did not respond" 120 seconds later. Record and
   * print, so the failure names itself.
   */
  const anomalies: string[] = [];
  const recordAnomaly = (detail: string): void => {
    anomalies.push(detail);
    process.stderr.write(`[fp-p1-harness] ${detail}\n`);
  };
  return new Promise((resolve) => {
    const server = createHttpServer((req, res) => {
      if (!(req.url ?? '').includes('/chat/completions')) {
        if ((req.url ?? '').includes('/models')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: [{ id: MOCK_MODEL_ID }] }));
          return;
        }
        // A runtime that switches endpoint mid-turn lands here and would
        // otherwise be invisible.
        recordAnomaly(
          `unmatched ${req.method ?? '?'} ${req.url ?? '?'} (log entries so far: ${log.length})`,
        );
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'not found' } }));
        return;
      }
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        try {
        let parsed: {
          stream?: boolean;
          messages?: Array<{
            role: string;
            content?: unknown;
            tool_call_id?: string;
            toolCallId?: string;
            toolName?: string;
          }>;
        } = {};
        try { parsed = JSON.parse(body); } catch { /* ignore */ }
        if (log.length > 80) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            error: { message: `scripted-llm loop guard: ${log.length} requests without progress` },
          }));
          return;
        }
        const messages = parsed.messages ?? [];
        // DCS may append its own user-role context block after the driving
        // prompt. Preserve the complete user transcript so scripts can still
        // locate the latest explicit turn marker.
        const userText = messages
          .filter((message) => message.role === 'user')
          .map((message) => typeof message.content === 'string'
            ? message.content
            : JSON.stringify(message.content ?? ''))
          .join('\n');
        const toolResults: Record<string, string> = {};
        for (const message of messages) {
          if (message.role !== 'tool' && message.role !== 'toolResult') continue;
          const toolCallId = message.tool_call_id ?? message.toolCallId;
          if (!toolCallId) continue;
          toolResults[toolCallId] = typeof message.content === 'string'
            ? message.content
            : JSON.stringify(message.content ?? '');
        }
        // A filtered tool never produces a result frame. Let the scripted
        // control terminate from the request count in that case.
        const action = await script(userText, toolResults, log.length);
        log.push({
          turn: userText.slice(0, 60),
          toolResults,
          issued: action.toolCall ? action.toolCall.id : `text:${action.text?.slice(0, 40)}`,
        });

        const usage = { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 };
        const finishReason = action.toolCall ? 'tool_calls' : 'stop';

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
              model: MOCK_MODEL_ID,
              choices: [{ index: 0, delta, finish_reason: finish }],
              ...(finish ? { usage } : {}),
            })}\n\n`;
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
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            id: 'chatcmpl-mock',
            object: 'chat.completion',
            created: 1,
            model: MOCK_MODEL_ID,
            choices: [{ index: 0, message: assistantMessage, finish_reason: finishReason }],
            usage,
          }));
        }
        } catch (error) {
          recordAnomaly(
            `completions handler threw after ${log.length} answered request(s): ${String(error)}\n${(error as Error)?.stack ?? ''}`,
          );
          try {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(
              JSON.stringify({ error: { message: `scripted-llm handler error: ${String(error)}` } }),
            );
          } catch { /* response already committed */ }
        }
      });
    });
    /*
     * Connection-level evidence. `log` records only requests the script
     * answered, so "the model did not respond" is ambiguous between a request
     * that never arrived and one whose handler never replied. Counting raw
     * connections separates the two.
     */
    let connectionCount = 0;
    server.on('connection', () => {
      connectionCount += 1;
      process.stderr.write(`[fp-p1-harness] connection #${connectionCount}\n`);
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('llm port failed');
      resolve({ server, port: address.port, log, anomalies });
    });
  });
}

/** openclaw.json for a scripted-LLM coding session in `workspaceDir`. */
export function buildMockProviderConfig(llmPort: number, workspaceDir: string, extraRuntime: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    gateway: { mode: 'local', controlUi: { enabled: false } },
    models: {
      mode: 'merge',
      providers: {
        openai: {
          api: 'openai-completions',
          apiKey: 'test-key-ok',
          baseUrl: `http://127.0.0.1:${llmPort}/v1`,
          models: [{
            id: MOCK_MODEL_ID,
            name: MOCK_MODEL_ID,
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
        'working-memory': { enabled: true },
        'tool-registry': { enabled: true },
      },
      coding: { staleWriteGuard: { enabled: true } },
      ...extraRuntime,
    },
    agents: {
      defaults: {
        model: { primary: `openai/${MOCK_MODEL_ID}`, fallbacks: [] },
        workspace: workspaceDir,
        skipBootstrap: true,
      },
      list: [{ id: 'main', default: true }],
    },
    skills: { allowBundled: [] },
  };
}

export async function sendTurn(
  app: ElectronApplication,
  log: LlmRequestLog[],
  message: string,
  finalMarker: string,
): Promise<void> {
  await hostInvoke<Record<string, unknown>>(app, 'chat', 'sendWithMedia', {
    sessionKey: 'agent:main:main',
    message,
    idempotencyKey: `fp-p1-${Date.now()}-${Math.random()}`,
  });
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (log.some((entry) =>
      entry.issued?.startsWith('text:') && entry.issued.includes(finalMarker.slice(0, 18)))) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`turn did not reach its final response: ${message}`);
}
