/**
 * Cross-process browser sessions (TF-0097).
 *
 * The CLI builds a facade per process, so an in-process session map cannot
 * survive `vb open` → `vb nav`. Rather than running a daemon of our own, `open`
 * starts the bundled Chromium **detached** with a remote-debugging port and
 * records that CDP endpoint under `<workspace>/.ae/sessions/<id>/`; later
 * commands attach over CDP, and `close` terminates the real browser.
 *
 * Everything here is process-product: `<workspace>/.ae/` is gitignored, and a
 * session is a local observation window, never archived evidence.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { getWorkspaceSessionDir, getWorkspaceSessionsRoot } from '../host/workspace-paths.ts';
import { assertInsideRoot } from '../evidence/path-guard.ts';
import { assertBrowserRuntime } from './runtime-compatibility.ts';

/** One captured request, shaped like the host-api network row. */
export type WindowRequest = {
  id: string;
  url: string;
  method: string;
  status?: number;
  failed?: boolean;
  error?: string;
};

export type WindowConsoleLine = { type?: string; text?: string };

/**
 * The observation window of the *current page* (TF-0095 semantics), persisted so
 * a later process can judge the page it did not itself drive.
 */
export type ObservedWindow = {
  schemaVersion: 1;
  at: string;
  url?: string;
  requests: WindowRequest[];
  consoleLines: WindowConsoleLine[];
};

export type PersistentSessionRecord = {
  schemaVersion: 1;
  id: string;
  pid: number;
  /** CDP HTTP endpoint, e.g. http://127.0.0.1:51234 */
  endpoint: string;
  port: number;
  mode: 'headless' | 'visible';
  createdAt: string;
  profileDir: string;
  /** True when the browser belongs to somebody else (attached via `--cdp`). */
  external?: boolean;
  /** Native page identity selected by open; stable across CDP reattachments. */
  targetId?: string;
  url?: string;
  title?: string;
};

export function sessionsRoot(workspaceRoot?: string): string {
  return getWorkspaceSessionsRoot(workspaceRoot);
}

export function sessionDir(sessionId: string, workspaceRoot?: string): string {
  // An opaque identity must be rejected, not sanitized into an alias of another id.
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(sessionId) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(sessionId)) {
    throw Object.assign(new Error('invalid persistent session id: expected a non-reserved 1-64 character alphanumeric, hyphen or underscore id'), { code: 'E_ARG' });
  }
  return assertInsideRoot(sessionsRoot(workspaceRoot), getWorkspaceSessionDir(sessionId, workspaceRoot), 'session directory');
}

const RECORD = 'session.json';
const WINDOW = 'window.json';

function sessionFile(sessionId: string, name: string, workspaceRoot?: string): string {
  return assertInsideRoot(sessionsRoot(workspaceRoot), join(sessionDir(sessionId, workspaceRoot), name), 'session file');
}

export async function saveSessionRecord(record: PersistentSessionRecord, workspaceRoot?: string): Promise<void> {
  const dir = sessionDir(record.id, workspaceRoot);
  await mkdir(dir, { recursive: true });
  await writeFile(sessionFile(record.id, RECORD, workspaceRoot), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

export async function loadSessionRecord(sessionId: string, workspaceRoot?: string): Promise<PersistentSessionRecord | null> {
  try {
    const raw = await readFile(sessionFile(sessionId, RECORD, workspaceRoot), 'utf8');
    const parsed = JSON.parse(raw) as PersistentSessionRecord;
    return parsed?.schemaVersion === 1 && parsed.id === sessionId &&
      Number.isInteger(parsed.pid) && parsed.pid >= 0 &&
      typeof parsed.endpoint === 'string' && parsed.endpoint.length > 0 &&
      Number.isInteger(parsed.port) && parsed.port >= 0 && parsed.port <= 65535 &&
      (parsed.mode === 'headless' || parsed.mode === 'visible') &&
      typeof parsed.createdAt === 'string' && Number.isFinite(Date.parse(parsed.createdAt)) &&
      typeof parsed.profileDir === 'string' && parsed.profileDir.length > 0 &&
      (parsed.external === undefined || typeof parsed.external === 'boolean') &&
      (parsed.targetId === undefined || (typeof parsed.targetId === 'string' && parsed.targetId.trim().length > 0 && parsed.targetId.length <= 256)) &&
      (parsed.url === undefined || typeof parsed.url === 'string') &&
      (parsed.title === undefined || typeof parsed.title === 'string') ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveWindow(sessionId: string, window: ObservedWindow, workspaceRoot?: string): Promise<void> {
  const dir = sessionDir(sessionId, workspaceRoot);
  await mkdir(dir, { recursive: true });
  await writeFile(sessionFile(sessionId, WINDOW, workspaceRoot), `${JSON.stringify(window, null, 2)}\n`, 'utf8');
}

export async function loadWindow(sessionId: string, workspaceRoot?: string): Promise<ObservedWindow | null> {
  try {
    const raw = await readFile(sessionFile(sessionId, WINDOW, workspaceRoot), 'utf8');
    const parsed = JSON.parse(raw) as ObservedWindow;
    return parsed?.schemaVersion === 1 && typeof parsed.at === 'string' &&
      (parsed.url === undefined || typeof parsed.url === 'string') &&
      Array.isArray(parsed.requests) && parsed.requests.every(row => row &&
        typeof row.id === 'string' && typeof row.url === 'string' && typeof row.method === 'string' &&
        (row.status === undefined || typeof row.status === 'number') &&
        (row.failed === undefined || typeof row.failed === 'boolean') &&
        (row.error === undefined || typeof row.error === 'string')) &&
      Array.isArray(parsed.consoleLines) && parsed.consoleLines.every(line => line &&
        (line.type === undefined || typeof line.type === 'string') &&
        (line.text === undefined || typeof line.text === 'string')) ? parsed : null;
  } catch {
    return null;
  }
}

export async function listSessionRecords(workspaceRoot?: string): Promise<PersistentSessionRecord[]> {
  let entries: string[] = [];
  try {
    // TF-0167: honour the caller workspace. This used to call sessionsRoot() with no
    // argument, so a session listing always read the DEFAULT workspace and another
    // workspace's profile-backed sessions could leak into the result.
    entries = await readdir(sessionsRoot(workspaceRoot));
  } catch {
    return [];
  }
  const records: PersistentSessionRecord[] = [];
  for (const entry of entries) {
    const record = await loadSessionRecord(entry, workspaceRoot);
    if (record) records.push(record);
  }
  return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Remove a session directory (record + window + profile). Retries a locked profile. */
export async function removeSession(sessionId: string, workspaceRoot?: string): Promise<void> {
  const dir = sessionDir(sessionId, workspaceRoot);
  const record = await loadSessionRecord(sessionId, workspaceRoot);
  let lastError: unknown;
  try {
    // Chromium helpers can release Windows profile locks after CDP goes down.
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    if (!existsSync(dir)) return;
  } catch (error) {
    lastError = error;
  }
  // Recursive removal may delete session.json before hitting a locked profile.
  // Keep the remaining resources addressable when cleanup needs to be retried.
  if (record) await saveSessionRecord(record, workspaceRoot);
  throw new Error(`persistent session cleanup failed for ${sessionId}: ${lastError instanceof Error ? lastError.message : String(lastError ?? 'directory still exists')}`, { cause: lastError });
}

/**
 * Is the session's browser still answering? Probe the CDP endpoint rather than
 * the recorded pid: Chromium's launcher process hands off to the real browser
 * process, so the pid we spawned can be gone while the browser is alive (and
 * vice versa), which would make stale-sweeping delete live sessions.
 */
async function endpointState(endpoint: string, timeoutMs: number): Promise<'responding' | 'refused' | 'unknown'> {
  assertBrowserRuntime();
  try {
    const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(Math.max(1, timeoutMs)) });
    await response.body?.cancel();
    return response.ok ? 'responding' : 'unknown';
  } catch (error) {
    // A timeout or HTTP failure does not establish that the browser exited.
    return (error as { cause?: { code?: string } })?.cause?.code === 'ECONNREFUSED' ? 'refused' : 'unknown';
  }
}

export async function probeEndpoint(endpoint: string, timeoutMs = 800): Promise<boolean> {
  return (await endpointState(endpoint, timeoutMs)) === 'responding';
}

/** True when the pid exists (EPERM still means "alive but not ours"). Diagnostic only. */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Drop session directories whose browser no longer answers. Returns removed ids. */
export async function sweepDeadSessions(workspaceRoot?: string): Promise<string[]> {
  const removed: string[] = [];
  // TF-0167: the sweep must stay inside the caller workspace, otherwise cleaning one
  // workspace would delete another workspace's profile-backed session directories.
  for (const record of await listSessionRecords(workspaceRoot)) {
    if ((await endpointState(record.endpoint, 800)) === 'refused' && !isProcessAlive(record.pid)) {
      await removeSession(record.id, workspaceRoot);
      removed.push(record.id);
    }
  }
  return removed;
}

/** Ask the OS for a free TCP port (used for --remote-debugging-port). */
export async function allocatePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error('could not allocate a port'))));
    });
  });
}

export type LaunchDetachedOptions = {
  executablePath: string;
  profileDir: string;
  port: number;
  headless: boolean;
  url?: string;
};

export type DetachedBrowserProcess = {
  pid: number;
  child: ChildProcess;
  stderrPath: string;
};

/**
 * Start Chromium as its own process so it outlives this CLI invocation.
 * No daemon of ours is involved: the browser *is* the server, reachable over CDP.
 */
export async function launchDetachedBrowser(options: LaunchDetachedOptions): Promise<DetachedBrowserProcess> {
  assertBrowserRuntime();
  const args = [
    `--remote-debugging-port=${options.port}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${options.profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    ...(options.headless ? ['--headless=new'] : []),
    options.url ?? 'about:blank',
  ];
  const stderrPath = join(dirname(options.profileDir), 'browser-stderr.log');
  await mkdir(dirname(stderrPath), { recursive: true });
  const stderr = await open(stderrPath, 'a');
  let child: ChildProcess;
  try {
    // A file handle survives the CLI exiting; a stderr pipe would not.
    child = spawn(options.executablePath, args, { detached: true, stdio: ['ignore', 'ignore', stderr.fd] });
    await once(child, 'spawn');
  } finally {
    await stderr.close();
  }
  child.unref();
  if (!child.pid) throw new Error('failed to start the browser process');
  return { pid: child.pid, child, stderrPath };
}

async function startupDiagnostics(process: DetachedBrowserProcess): Promise<string> {
  let tail = '';
  const log = await open(process.stderrPath, 'r').catch(() => undefined);
  if (log) {
    try {
      const { size } = await log.stat();
      const buffer = Buffer.alloc(Math.min(size, 4096));
      const { bytesRead } = await log.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length));
      tail = buffer.subarray(0, bytesRead).toString('utf8').trim();
    } finally { await log.close(); }
  }
  return `pid=${process.pid}; exitCode=${process.child.exitCode ?? 'pending'}; signal=${process.child.signalCode ?? 'none'}` +
    (tail ? `; browser stderr (last 4096 bytes): ${tail}` : '');
}

export function cdpEndpoint(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/** Poll `/json/version` until the detached browser answers CDP. */
export async function waitForCdpEndpoint(endpoint: string, timeoutMs = 20_000, process?: DetachedBrowserProcess): Promise<void> {
  assertBrowserRuntime();
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no response';
  let exitedEarly = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${endpoint}/json/version`, {
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      });
      await response.body?.cancel();
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      const cause = (error as { cause?: { code?: string } })?.cause?.code;
      if (cause) lastError += ` (${cause})`;
    }
    // Exit 0 may be a launcher handing off to another browser process.
    if (process && ((process.child.exitCode !== null && process.child.exitCode !== 0) || process.child.signalCode !== null)) {
      exitedEarly = true;
      break;
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(200, remaining)));
  }
  const reason = exitedEarly
    ? `browser process exited before CDP endpoint ${endpoint} became ready`
    : `browser CDP endpoint ${endpoint} was not ready within ${timeoutMs}ms`;
  throw new Error(`${reason} (${lastError})${process ? `; ${await startupDiagnostics(process)}` : ''}`);
}

/** Is a session directory present on disk? */
export function sessionExists(sessionId: string): boolean {
  return existsSync(sessionDir(sessionId));
}

/** Wait until the CDP endpoint stops answering. */
export async function waitForEndpointDown(endpoint: string, timeoutMs = 8_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await endpointState(endpoint, Math.min(500, deadline - Date.now()))) === 'refused') return true;
    const remaining = deadline - Date.now();
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(250, remaining)));
  }
  return false;
}

/**
 * Terminate a detached browser for real.
 *
 * Playwright's `browser.close()` on a `connectOverCDP` connection only
 * **disconnects** — the browser keeps serving (measured 2026-09-30: endpoint
 * still answered `/json/version` after close). The only reliable shutdown is the
 * CDP `Browser.close` command, sent over the browser's own websocket.
 */
export async function closeBrowserThroughCdp(endpoint: string, timeoutMs = 8_000): Promise<boolean> {
  assertBrowserRuntime();
  const deadline = Date.now() + timeoutMs;
  let wsUrl: string | undefined;
  try {
    const response = await fetch(`${endpoint}/json/version`, {
      signal: AbortSignal.timeout(Math.max(1, Math.min(1500, deadline - Date.now()))),
    });
    if (!response.ok) { await response.body?.cancel(); return false; }
    const version = (await response.json()) as { webSocketDebuggerUrl?: string };
    wsUrl = version.webSocketDebuggerUrl;
  } catch (error) {
    return (error as { cause?: { code?: string } })?.cause?.code === 'ECONNREFUSED';
  }
  if (!wsUrl) return false;

  await new Promise<void>((resolve) => {
    let settled = false;
    let socket: WebSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket?.close();
      resolve();
    };
    try {
      socket = new WebSocket(wsUrl);
      socket.addEventListener('open', () => {
        socket!.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
      });
      socket.addEventListener('error', finish);
      socket.addEventListener('close', finish);
      timer = setTimeout(finish, Math.max(1, Math.min(1000, deadline - Date.now())));
    } catch {
      finish();
    }
  });
  return await waitForEndpointDown(endpoint, Math.max(0, deadline - Date.now()));
}
