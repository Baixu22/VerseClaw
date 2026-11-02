# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agent-first-product-effect.spec.ts >> agent-driven real product effects in isolated profile 1
- Location: tests\e2e\agent-first-product-effect.spec.ts:22:7

# Error details

```
Error: gateway never became ready
```

# Test source

```ts
  1   | /**
  2   |  * Shared FP-P1 E2E harness: host-invoke bridge, gateway bring-up, and the
  3   |  * scripted local OpenAI-compatible LLM endpoint (FP-P1-07 route A — real
  4   |  * gateway + local mock provider endpoint; the LLM decisions are scripted, the
  5   |  * runtime/tools/journal under test are production code).
  6   |  */
  7   | import { createServer as createHttpServer, type Server } from 'node:http';
  8   | import { createServer as createNetServer } from 'node:net';
  9   | import type { ElectronApplication } from '@playwright/test';
  10  |
  11  | export type HostResponse<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string } };
  12  | export type GatewayStatus = { state?: string; port?: number; gatewayReady?: boolean };
  13  | export type HostSuccess = { success: boolean };
  14  |
  15  | export const MOCK_MODEL_ID = 'mock-coder';
  16  |
  17  | export async function allocatePort(): Promise<number> {
  18  |   return await new Promise((resolve, reject) => {
  19  |     const server = createNetServer();
  20  |     server.once('error', reject);
  21  |     server.listen(0, '127.0.0.1', () => {
  22  |       const address = server.address();
  23  |       if (!address || typeof address === 'string') {
  24  |         server.close(() => reject(new Error('port allocation failed')));
  25  |         return;
  26  |       }
  27  |       server.close((err) => (err ? reject(err) : resolve(address.port)));
  28  |     });
  29  |   });
  30  | }
  31  |
  32  | export async function hostInvoke<T>(
  33  |   app: ElectronApplication,
  34  |   module: string,
  35  |   action: string,
  36  |   payload: Record<string, unknown> | null = null,
  37  | ): Promise<T> {
  38  |   const response = (await app.evaluate(async (_electron, request) => {
  39  |     const { ipcMain, BrowserWindow } = process.mainModule!.require(
  40  |       'electron',
  41  |     ) as typeof import('electron');
  42  |     const handler = (
  43  |       ipcMain as unknown as {
  44  |         _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
  45  |       }
  46  |     )._invokeHandlers?.get('host:invoke');
  47  |     if (!handler) throw new Error('host:invoke handler is not registered');
  48  |     const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
  49  |     if (!win) throw new Error('No BrowserWindow available for host:invoke sender auth');
  50  |     const sender = win.webContents;
  51  |     const event = {
  52  |       sender,
  53  |       senderFrame: { url: typeof sender.getURL === 'function' ? sender.getURL() : '' },
  54  |     };
  55  |     return await handler(event, { id: `fp-p1-${Date.now()}-${Math.random()}`, ...request });
  56  |   }, { module, action, payload })) as HostResponse<T>;
  57  |   if (!response.ok) {
  58  |     throw new Error(`[${response.error?.code ?? 'HOST'}] ${response.error?.message ?? 'failed'}`);
  59  |   }
  60  |   return response.data as T;
  61  | }
  62  |
  63  | export async function startGateway(app: ElectronApplication, options: { port?: number } = {}): Promise<number> {
  64  |   const port = options.port ?? await allocatePort();
  65  |   await hostInvoke<HostSuccess>(app, 'settings', 'set', { key: 'gatewayPort', value: port });
  66  |   const deadline = Date.now() + 240_000;
  67  |   let attempts = 0;
  68  |   while (Date.now() < deadline) {
  69  |     try {
  70  |       const status = await hostInvoke<GatewayStatus>(app, 'gateway', 'status');
  71  |       if (status.gatewayReady === true || status.state === 'running') return port;
  72  |       if (status.state !== 'starting' && attempts < 10) {
  73  |         attempts += 1;
  74  |         await hostInvoke<HostSuccess>(app, 'gateway', 'start').catch(() => undefined);
  75  |       }
  76  |     } catch {
  77  |       // retry
  78  |     }
  79  |     await new Promise((resolve) => setTimeout(resolve, 2_000));
  80  |   }
> 81  |   throw new Error('gateway never became ready');
      |         ^ Error: gateway never became ready
  82  | }
  83  |
  84  | export type ToolCallSpec = { id: string; name: string; args: Record<string, unknown> };
  85  |
  86  | export type LlmRequestLog = {
  87  |   turn: string;
  88  |   toolResults: Record<string, string>;
  89  |   issued: string | null;
  90  | };
  91  |
  92  | export type LlmScript = (
  93  |   userText: string,
  94  |   toolResults: Record<string, string>,
  95  |   requestIndex: number,
  96  | ) => { toolCall?: ToolCallSpec; text?: string };
  97  |
  98  | /**
  99  |  * Scripted OpenAI-compatible chat/completions endpoint. The script decides the
  100 |  * next tool call from which of its own call-ids already have tool results in
  101 |  * the transcript. Supports streaming (SSE) and non-streaming clients.
  102 |  */
  103 | export function startScriptedLlm(script: LlmScript): Promise<{
  104 |   server: Server;
  105 |   port: number;
  106 |   log: LlmRequestLog[];
  107 |   /** Requests the mock saw but could not answer usefully; see `recordAnomaly`. */
  108 |   anomalies: string[];
  109 | }> {
  110 |   const log: LlmRequestLog[] = [];
  111 |   /**
  112 |    * Requests the mock answered nothing useful for, or never saw at all.
  113 |    *
  114 |    * Without this, a request that misses an endpoint or throws inside the
  115 |    * completions handler leaves no trace: `log` only records requests the script
  116 |    * actually answered, so the caller sees a shorter transcript and the runtime
  117 |    * reports a bare "the model did not respond" 120 seconds later. Record and
  118 |    * print, so the failure names itself.
  119 |    */
  120 |   const anomalies: string[] = [];
  121 |   const recordAnomaly = (detail: string): void => {
  122 |     anomalies.push(detail);
  123 |     process.stderr.write(`[fp-p1-harness] ${detail}\n`);
  124 |   };
  125 |   return new Promise((resolve) => {
  126 |     const server = createHttpServer((req, res) => {
  127 |       if (!(req.url ?? '').includes('/chat/completions')) {
  128 |         if ((req.url ?? '').includes('/models')) {
  129 |           res.writeHead(200, { 'content-type': 'application/json' });
  130 |           res.end(JSON.stringify({ data: [{ id: MOCK_MODEL_ID }] }));
  131 |           return;
  132 |         }
  133 |         // A runtime that switches endpoint mid-turn lands here and would
  134 |         // otherwise be invisible.
  135 |         recordAnomaly(
  136 |           `unmatched ${req.method ?? '?'} ${req.url ?? '?'} (log entries so far: ${log.length})`,
  137 |         );
  138 |         res.writeHead(404, { 'content-type': 'application/json' });
  139 |         res.end(JSON.stringify({ error: { message: 'not found' } }));
  140 |         return;
  141 |       }
  142 |       let body = '';
  143 |       req.on('data', (chunk) => { body += chunk; });
  144 |       req.on('end', () => {
  145 |         try {
  146 |         let parsed: {
  147 |           stream?: boolean;
  148 |           messages?: Array<{
  149 |             role: string;
  150 |             content?: unknown;
  151 |             tool_call_id?: string;
  152 |             toolCallId?: string;
  153 |             toolName?: string;
  154 |           }>;
  155 |         } = {};
  156 |         try { parsed = JSON.parse(body); } catch { /* ignore */ }
  157 |         if (log.length > 80) {
  158 |           res.writeHead(500, { 'content-type': 'application/json' });
  159 |           res.end(JSON.stringify({
  160 |             error: { message: `scripted-llm loop guard: ${log.length} requests without progress` },
  161 |           }));
  162 |           return;
  163 |         }
  164 |         const messages = parsed.messages ?? [];
  165 |         // DCS may append its own user-role context block after the driving
  166 |         // prompt. Preserve the complete user transcript so scripts can still
  167 |         // locate the latest explicit turn marker.
  168 |         const userText = messages
  169 |           .filter((message) => message.role === 'user')
  170 |           .map((message) => typeof message.content === 'string'
  171 |             ? message.content
  172 |             : JSON.stringify(message.content ?? ''))
  173 |           .join('\n');
  174 |         const toolResults: Record<string, string> = {};
  175 |         for (const message of messages) {
  176 |           if (message.role !== 'tool' && message.role !== 'toolResult') continue;
  177 |           const toolCallId = message.tool_call_id ?? message.toolCallId;
  178 |           if (!toolCallId) continue;
  179 |           toolResults[toolCallId] = typeof message.content === 'string'
  180 |             ? message.content
  181 |             : JSON.stringify(message.content ?? '');
```