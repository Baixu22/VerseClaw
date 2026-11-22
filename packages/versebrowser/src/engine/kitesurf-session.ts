import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer, request } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { removeSession, saveSessionRecord, sessionDir } from './persistent-sessions.ts';
import { createPlaywrightHostApi } from './playwright-host-api.ts';
import { assertKitesurfLoopback, KITESURF_METHODS } from './kitesurf-cdp.ts';
import type { AgentBrowserHostApi, AgentBrowserOpenPayload, AgentBrowserSessionResult } from '../types/host-api.ts';

type Lease = { secret: string; pid: number; endpoint: string };
const METHODS = new Set([...KITESURF_METHODS, 'uploadFiles', 'downloadFile', 'runtimeInspectGlobals', 'open']);
const controlFile = (id: string, root: string) => `${sessionDir(id, root)}/kitesurf-control.json`;

async function lease(id: string, root: string): Promise<Lease> {
  const value = JSON.parse(await readFile(controlFile(id, root), 'utf8')) as Lease;
  if (typeof value.secret !== 'string' || value.secret.length !== 64 || !Number.isInteger(value.pid) || value.pid <= 0 || typeof value.endpoint !== 'string') throw new Error('E_KITESURF_CONTROL: invalid lease');
  return value;
}

async function call<T>(id: string, root: string, method: string, payload: unknown, timeoutMs = 65_000): Promise<T> {
  let auth: Lease;
  try { auth = await lease(id, root); }
  catch { throw Object.assign(new Error(`E_NO_SESSION: Kitesurf session ${id} is not live`), { code: 'E_NO_SESSION' }); }
  const result = await new Promise<{ status?: number; body: string }>((resolve, reject) => {
    const deadline = AbortSignal.timeout(timeoutMs);
    const req = request(new URL('/call', auth.endpoint), { method: 'POST', signal: deadline, headers: { authorization: `Bearer ${auth.secret}`, 'content-type': 'application/json' } }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', error => reject(deadline.aborted ? new Error('E_KITESURF_CONTROL: request timed out') : error));
    req.end(JSON.stringify({ method, payload }));
  });
  const response = JSON.parse(result.body) as { value?: T; error?: { message?: string; code?: string } };
  if (result.status !== 200) throw Object.assign(new Error(response.error?.message ?? 'Kitesurf control request failed'), { code: response.error?.code });
  return response.value as T;
}

export function createKitesurfHostApi(id: string, root: string): AgentBrowserHostApi {
  const api = {} as Record<string, unknown>;
  for (const method of METHODS) api[method] = (payload: unknown) => call(id, root, method, method === 'status' ? { sessionId: id } : payload);
  return api as AgentBrowserHostApi;
}

export async function openKitesurfSession(payload: AgentBrowserOpenPayload, root: string): Promise<AgentBrowserSessionResult> {
  if (payload.browser !== 'kitesurf' || !payload.cdpEndpoint) throw new Error('E_KITESURF_ENDPOINT: --kitesurf requires a loopback --cdp endpoint');
  assertKitesurfLoopback(payload.cdpEndpoint);
  const id = randomUUID();
  const secret = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
  const source = fileURLToPath(import.meta.url);
  const worker = source.endsWith('.ts') ? source : source.replace(/\.js$/i, '.js');
  const child = spawn(process.execPath, [worker], {
    detached: true, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, VERSEBROWSER_KITESURF_CONTROL_SECRET: secret, VERSEBROWSER_WORKSPACE: root, VERSEBROWSER_KITESURF_SESSION_ID: id },
  });
  if (!child.pid) throw new Error('E_KITESURF_CONTROL: failed to start the control process');
  child.unref();
  let diagnostics = '';
  child.stderr?.on('data', chunk => { diagnostics = `${diagnostics}${chunk}`.slice(-4000); });
  child.once('exit', (code, signal) => { diagnostics += `\nexit code=${code} signal=${signal}`; });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await lease(id, root).catch(() => null)) {
      try {
        const opened = await call<AgentBrowserSessionResult>(id, root, 'open', payload, Math.max(1, deadline - Date.now()));
        await saveSessionRecord({ schemaVersion: 1, id, pid: child.pid, endpoint: payload.cdpEndpoint, port: Number(new URL(payload.cdpEndpoint).port), mode: 'headless', createdAt: opened.session.createdAt, profileDir: sessionDir(id, root), external: true, engine: 'kitesurf', url: opened.session.url, title: opened.session.title }, root);
        return opened;
      } catch (error) {
        await call(id, root, 'shutdown', {}, 1_000).catch(() => undefined);
        child.kill();
        await removeSession(id, root);
        throw new Error(`${error instanceof Error ? error.message : String(error)}${diagnostics ? `; ${diagnostics}` : ''}`, { cause: error });
      }
    }
    if (child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  child.kill();
  await removeSession(id, root);
  throw new Error(`E_KITESURF_CONTROL: control process did not become ready${diagnostics ? `: ${diagnostics}` : ''}`);
}

export async function runKitesurfWorker(): Promise<void> {
  const root = process.env.VERSEBROWSER_WORKSPACE;
  const secret = process.env.VERSEBROWSER_KITESURF_CONTROL_SECRET;
  const id = process.env.VERSEBROWSER_KITESURF_SESSION_ID;
  if (!root || !secret || !id) throw new Error('E_KITESURF_CONTROL: missing worker credentials');
  const api = await createPlaywrightHostApi({ workspaceRoot: root, kitesurfSessionId: id, kitesurf: true });
  let opened = false;
  const exitWorker = () => setImmediate(async () => {
    try { await api.close({ sessionId: id }); }
    finally { await removeSession(id, root); server.close(); process.exit(0); }
  });
  const server = createServer(async (req, res) => {
    const send = (status: number, value: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
    try {
      if (req.headers.authorization !== `Bearer ${secret}`) { send(403, { error: { message: 'forbidden' } }); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 1_048_576) throw new Error('E_ARG: request exceeds 1 MiB'); chunks.push(chunk); }
      const { method, payload } = JSON.parse(Buffer.concat(chunks).toString()) as { method: string; payload: Record<string, unknown> };
      if (method === 'shutdown') { send(200, { value: { success: true } }); setImmediate(() => process.exit(0)); return; }
      if (!METHODS.has(method)) throw new Error('E_CAPABILITY_UNAVAILABLE: unsupported control method');
      if (method === 'open') {
        if (opened) throw new Error('E_KITESURF_CONTROL: this worker already owns a session');
        const result = await api.open(payload);
        opened = true;
        send(200, { value: result });
        return;
      }
      if (!opened || payload.sessionId !== id) throw Object.assign(new Error('E_NO_SESSION: Kitesurf control session mismatch'), { code: 'E_NO_SESSION' });
      const value = method === 'status' ? (api.status as () => unknown)() : await (api[method as keyof AgentBrowserHostApi] as (input: unknown) => Promise<unknown>)(payload);
      send(200, { value });
      if (method === 'close') exitWorker();
    } catch (error) {
      send(400, { error: { message: error instanceof Error ? error.message : String(error), code: (error as { code?: string }).code } });
      if (opened && !(await api.status()).sessions.some(session => session.id === id)) exitWorker();
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('E_KITESURF_CONTROL: no loopback port');
  await mkdir(dirname(controlFile(id, root)), { recursive: true });
  await writeFile(controlFile(id, root), JSON.stringify({ secret, pid: process.pid, endpoint: `http://127.0.0.1:${address.port}` }), { mode: 0o600 });
  const expiry = setTimeout(() => { server.close(); process.exit(0); }, 30 * 60_000);
  expiry.unref();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runKitesurfWorker().catch(error => { console.error(error); process.exit(1); });
}
