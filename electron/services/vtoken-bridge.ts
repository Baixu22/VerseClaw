/**
 * Verse Token bridge — long-lived Python host_rpc worker over stdio JSON-RPC.
 *
 * Product default ON (diagnostics). Production Working Context injects in gateway agent turns.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import type {
  VtokenAssembleHostResult,
  VtokenAssemblePayload,
  VtokenCloseResult,
  VtokenIngestMarkdownPayload,
  VtokenIngestMemoryPayload,
  VtokenIngestPathPayload,
  VtokenIngestResult,
  VtokenIngestToolsPayload,
  VtokenOpenPayload,
  VtokenOpenResult,
  VtokenPingResult,
  VtokenSetEnabledPayload,
  VtokenSetEnabledResult,
  VtokenStatsResult,
  VtokenStatusResult,
} from '@shared/vtoken/types';
import { checkUvInstalled, isPythonReady, setupManagedPython } from '../utils/uv-setup';
import { logger } from '../utils/logger';
import { needsWinShell, quoteForCmd } from '../utils/paths';

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const ASSEMBLE_TIMEOUT_MS = 15_000;
const MAX_RESTARTS = 3;
const RESTART_BACKOFF_MS = 400;

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  method: string;
};

type LastAssembleSummary = NonNullable<VtokenStatusResult['lastAssemble']>;

let enabledOverride: boolean | null = null;
let child: ChildProcessWithoutNullStreams | null = null;
let stdoutBuf = '';
let nextId = 1;
const pending = new Map<number, Pending>();
let startPromise: Promise<void> | null = null;
let restartCount = 0;
let intentionalStop = false;
let lastAssemble: LastAssembleSummary | null = null;
let lastWorkerError: string | undefined;

/**
 * Bridge enablement (diagnostics host-api).
 * Product default OFF (opt-in canary). Enable: VERSE_VTOKEN_BRIDGE_ENABLED=1 or setEnabled(true).
 * Kill-switch: VERSE_VTOKEN_BRIDGE_ENABLED=0|false|off.
 * Also disabled when VERSE_VTOKEN_ASSEMBLY_ENABLED is explicitly 0/false/off,
 * or when VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH is engaged.
 */
export function readVtokenBridgeEnabledFromEnv(): boolean {
  const enhancement = (process.env.VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH ?? '').trim().toLowerCase();
  if (enhancement === '1' || enhancement === 'true' || enhancement === 'yes' || enhancement === 'on') {
    return false;
  }
  const assembly = (process.env.VERSE_VTOKEN_ASSEMBLY_ENABLED ?? '').trim().toLowerCase();
  if (assembly === '0' || assembly === 'false' || assembly === 'no' || assembly === 'off') {
    return false;
  }
  const raw = (process.env.VERSE_VTOKEN_BRIDGE_ENABLED ?? '').trim().toLowerCase();
  // Explicit disable
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
  // Explicit enable (opt-in canary)
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
  // Product default: disabled (opt-in)
  return false;
}

export function isVtokenBridgeEnabled(): boolean {
  if (enabledOverride !== null) return enabledOverride;
  return readVtokenBridgeEnabledFromEnv();
}

export function setVtokenBridgeEnabled(enabled: boolean): void {
  enabledOverride = enabled;
  if (!enabled) {
    void stopVtokenWorker();
  }
}

export function resolveVtokenPackageRoot(): string | null {
  if (app.isPackaged) {
    const packaged = join(process.resourcesPath, 'vtoken');
    if (existsSync(join(packaged, 'src', 'vtoken'))) return packaged;
    return existsSync(packaged) ? packaged : null;
  }
  const dev = join(process.cwd(), 'packages', 'vtoken');
  if (existsSync(join(dev, 'src', 'vtoken'))) return dev;
  return null;
}

export function resolveVtokenPythonPath(): string | null {
  const root = resolveVtokenPackageRoot();
  if (!root) return null;
  return join(root, 'src');
}

function resolveUvBin(): string {
  const platform = process.platform;
  const arch = process.arch;
  const target = `${platform}-${arch}`;
  const binName = platform === 'win32' ? 'uv.exe' : 'uv';
  if (app.isPackaged) {
    const bundled = join(process.resourcesPath, 'bin', binName);
    if (existsSync(bundled)) return bundled;
  } else {
    const bundled = join(process.cwd(), 'resources', 'bin', target, binName);
    if (existsSync(bundled)) return bundled;
  }
  return 'uv';
}

function disabledResult<T extends { success: boolean; disabled?: boolean; error?: string }>(
  extra: Partial<T> = {},
): T {
  return {
    success: false,
    disabled: true,
    error: 'vtoken bridge disabled (set VERSE_VTOKEN_BRIDGE_ENABLED=1 or call setEnabled)',
    ...extra,
  } as T;
}

function rejectAllPending(reason: string): void {
  for (const [id, p] of pending) {
    clearTimeout(p.timer);
    p.reject(new Error(reason));
    pending.delete(id);
  }
}

function handleStdoutLine(line: string): void {
  let msg: { id?: number; result?: unknown; error?: { message?: string; code?: number; data?: unknown } };
  try {
    msg = JSON.parse(line) as typeof msg;
  } catch (err) {
    logger.warn('[vtoken-bridge] invalid JSON from worker:', line.slice(0, 200), err);
    return;
  }
  const id = typeof msg.id === 'number' ? msg.id : Number(msg.id);
  if (!Number.isFinite(id) || !pending.has(id)) {
    logger.debug('[vtoken-bridge] unmatched response id:', msg.id);
    return;
  }
  const p = pending.get(id)!;
  pending.delete(id);
  clearTimeout(p.timer);
  if (msg.error) {
    const detail = msg.error.message || `RPC error code ${msg.error.code}`;
    p.reject(new Error(detail));
    return;
  }
  p.resolve(msg.result);
}

function onChildData(chunk: Buffer | string): void {
  stdoutBuf += chunk.toString('utf8');
  let idx = stdoutBuf.indexOf('\n');
  while (idx >= 0) {
    const line = stdoutBuf.slice(0, idx).replace(/\r$/, '');
    stdoutBuf = stdoutBuf.slice(idx + 1);
    if (line.trim()) handleStdoutLine(line);
    idx = stdoutBuf.indexOf('\n');
  }
}

async function ensurePythonReady(): Promise<void> {
  const uvOk = await checkUvInstalled();
  if (!uvOk) {
    throw new Error('uv is not available; cannot start vtoken worker');
  }
  const ready = await isPythonReady();
  if (!ready) {
    await setupManagedPython();
  }
}

function spawnWorker(): ChildProcessWithoutNullStreams {
  const packageRoot = resolveVtokenPackageRoot();
  const pythonPath = resolveVtokenPythonPath();
  if (!packageRoot || !pythonPath) {
    throw new Error('vtoken package not found (expected packages/vtoken/src or resources/vtoken/src)');
  }

  const uvBin = resolveUvBin();
  const args = ['run', '--python', '3.12', 'python', '-m', 'vtoken.host_rpc'];
  const useShell = needsWinShell(uvBin);
  const command = useShell ? quoteForCmd(uvBin) : uvBin;
  const spawnArgs = useShell ? args.map((a) => quoteForCmd(a)) : args;

  const env = {
    ...process.env,
    PYTHONPATH: pythonPath,
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
  };

  logger.info(
    `[vtoken-bridge] starting worker: ${command} ${args.join(' ')} PYTHONPATH=${pythonPath}`,
  );

  const proc = spawn(command, spawnArgs, {
    cwd: packageRoot,
    env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: useShell,
  }) as ChildProcessWithoutNullStreams;

  proc.stdout.on('data', onChildData);
  proc.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8').trim();
    if (text) logger.warn(`[vtoken-bridge:stderr] ${text}`);
  });
  proc.on('error', (err) => {
    lastWorkerError = err.message;
    logger.error('[vtoken-bridge] worker spawn error:', err);
  });
  proc.on('exit', (code, signal) => {
    logger.info(`[vtoken-bridge] worker exited code=${code} signal=${signal}`);
    child = null;
    stdoutBuf = '';
    rejectAllPending(`vtoken worker exited (code=${code}, signal=${signal})`);
    if (!intentionalStop && isVtokenBridgeEnabled() && restartCount < MAX_RESTARTS) {
      restartCount += 1;
      const delay = RESTART_BACKOFF_MS * restartCount;
      logger.info(`[vtoken-bridge] scheduling restart #${restartCount} in ${delay}ms`);
      setTimeout(() => {
        if (intentionalStop || !isVtokenBridgeEnabled()) return;
        startPromise = null;
        void ensureVtokenWorkerStarted().catch((err) => {
          lastWorkerError = String(err);
          logger.error('[vtoken-bridge] restart failed:', err);
        });
      }, delay);
    }
  });

  return proc;
}

export async function ensureVtokenWorkerStarted(): Promise<void> {
  if (!isVtokenBridgeEnabled()) {
    throw new Error('vtoken bridge disabled');
  }
  if (child && !child.killed) return;
  if (startPromise) return startPromise;

  startPromise = (async () => {
    await ensurePythonReady();
    intentionalStop = false;
    child = spawnWorker();
    // Quick health check
    await rpcCall('vt.ping', {}, 5_000);
    restartCount = 0;
    lastWorkerError = undefined;
  })();

  try {
    await startPromise;
  } catch (err) {
    startPromise = null;
    await stopVtokenWorker();
    throw err;
  } finally {
    // Allow a later ensure() after exit/restart; concurrent callers already awaited.
    startPromise = null;
  }
}

export async function stopVtokenWorker(): Promise<void> {
  intentionalStop = true;
  startPromise = null;
  rejectAllPending('vtoken worker stopped');
  const proc = child;
  child = null;
  stdoutBuf = '';
  if (!proc) return;
  try {
    // Best-effort graceful close of store
    try {
      await rpcCallOnProcess(proc, 'vt.close', {}, 2_000);
    } catch {
      // ignore
    }
    proc.stdin.end();
    proc.kill();
  } catch (err) {
    logger.debug('[vtoken-bridge] stop error:', err);
  }
}

function rpcCallOnProcess(
  proc: ChildProcessWithoutNullStreams,
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  const id = nextId++;
  const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`vtoken RPC timeout after ${timeoutMs}ms: ${method}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer, method });
    try {
      proc.stdin.write(`${payload}\n`);
    } catch (err) {
      clearTimeout(timer);
      pending.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

async function rpcCall(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  if (!child || child.killed) {
    await ensureVtokenWorkerStarted();
  }
  if (!child) throw new Error('vtoken worker not running');
  return rpcCallOnProcess(child, method, params, timeoutMs);
}

async function withEnabledGate<T extends { success: boolean }>(
  fn: () => Promise<T>,
): Promise<T | ReturnType<typeof disabledResult>> {
  if (!isVtokenBridgeEnabled()) {
    return disabledResult();
  }
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    lastWorkerError = message;
    logger.error('[vtoken-bridge]', message);
    return { success: false, error: message } as unknown as T;
  }
}

export async function vtokenPing(): Promise<VtokenPingResult> {
  return withEnabledGate(async () => {
    const result = (await rpcCall('vt.ping', {}, 5_000)) as Record<string, unknown>;
    return {
      success: true,
      enabled: true,
      running: Boolean(child && !child.killed),
      workerPid: child?.pid ?? null,
      ok: Boolean(result.ok),
      version: typeof result.version === 'string' ? result.version : undefined,
      opened: Boolean(result.opened),
    };
  }) as Promise<VtokenPingResult>;
}

export async function vtokenOpen(payload: VtokenOpenPayload = {}): Promise<VtokenOpenResult> {
  return withEnabledGate(async () => {
    const result = (await rpcCall('vt.open', {
      doc_sources: payload.docSources ?? [],
      session_dir: payload.sessionDir,
      session: payload.session,
    })) as Record<string, unknown>;
    return {
      success: true,
      ok: Boolean(result.ok),
      doc_sources: result.doc_sources as string[] | undefined,
      session: (result.session as string | null | undefined) ?? null,
      stats: result.stats as VtokenOpenResult['stats'],
    };
  }) as Promise<VtokenOpenResult>;
}

export async function vtokenIngestPath(payload: VtokenIngestPathPayload): Promise<VtokenIngestResult> {
  return withEnabledGate(async () => {
    const result = (await rpcCall('vt.ingest_path', {
      path: payload.path,
      source_type: payload.sourceType ?? 'auto',
    })) as Record<string, unknown>;
    return {
      success: true,
      ok: Boolean(result.ok),
      nodes_added: Number(result.nodes_added ?? 0),
      stats: result.stats as VtokenIngestResult['stats'],
    };
  }) as Promise<VtokenIngestResult>;
}

export async function vtokenIngestMarkdown(
  payload: VtokenIngestMarkdownPayload,
): Promise<VtokenIngestResult> {
  return withEnabledGate(async () => {
    const result = (await rpcCall('vt.ingest_markdown', {
      text: payload.text,
      source_path: payload.sourcePath ?? 'inline.md',
    })) as Record<string, unknown>;
    return {
      success: true,
      ok: Boolean(result.ok),
      nodes_added: Number(result.nodes_added ?? 0),
      stats: result.stats as VtokenIngestResult['stats'],
    };
  }) as Promise<VtokenIngestResult>;
}

export async function vtokenIngestTools(
  payload: VtokenIngestToolsPayload,
): Promise<VtokenIngestResult> {
  return withEnabledGate(async () => {
    const result = (await rpcCall('vt.ingest_tools', {
      schemas: payload.schemas,
      server_name: payload.serverName ?? 'default',
    })) as Record<string, unknown>;
    return {
      success: true,
      ok: Boolean(result.ok),
      nodes_added: Number(result.nodes_added ?? 0),
      stats: result.stats as VtokenIngestResult['stats'],
    };
  }) as Promise<VtokenIngestResult>;
}

export async function vtokenIngestMemory(
  payload: VtokenIngestMemoryPayload,
): Promise<VtokenIngestResult> {
  return withEnabledGate(async () => {
    const result = (await rpcCall('vt.ingest_memory', {
      entries: payload.entries,
    })) as Record<string, unknown>;
    return {
      success: true,
      ok: Boolean(result.ok),
      nodes_added: Number(result.nodes_added ?? 0),
      stats: result.stats as VtokenIngestResult['stats'],
    };
  }) as Promise<VtokenIngestResult>;
}

export async function vtokenAssemble(
  payload: VtokenAssemblePayload,
): Promise<VtokenAssembleHostResult> {
  return withEnabledGate(async () => {
    const started = Date.now();
    const result = (await rpcCall(
      'vt.assemble',
      {
        task_hint: payload.taskHint,
        budget_tokens: payload.budgetTokens ?? 32_000,
        render_mode: payload.renderMode ?? 'compact',
        slots: payload.slots,
      },
      ASSEMBLE_TIMEOUT_MS,
    )) as Record<string, unknown>;
    const durationMs = Date.now() - started;
    const assembled = result.result as VtokenAssembleHostResult['result'];
    if (assembled) {
      lastAssemble = {
        tokens_used: assembled.tokens_used,
        tokens_budget: assembled.tokens_budget,
        nodes_included: assembled.nodes_included?.length ?? 0,
        nodes_evicted: assembled.nodes_evicted?.length ?? 0,
        durationMs,
        at: new Date().toISOString(),
      };
      logger.info(
        `[vtoken-bridge] assemble tokens=${assembled.tokens_used}/${assembled.tokens_budget} ` +
          `included=${lastAssemble.nodes_included} evicted=${lastAssemble.nodes_evicted} ${durationMs}ms`,
      );
    }
    return {
      success: true,
      ok: Boolean(result.ok),
      result: assembled,
      durationMs,
    };
  }) as Promise<VtokenAssembleHostResult>;
}

export async function vtokenStats(): Promise<VtokenStatsResult> {
  return withEnabledGate(async () => {
    const result = (await rpcCall('vt.stats')) as Record<string, unknown>;
    return {
      success: true,
      ok: Boolean(result.ok),
      stats: result.stats as VtokenStatsResult['stats'],
    };
  }) as Promise<VtokenStatsResult>;
}

export async function vtokenClose(): Promise<VtokenCloseResult> {
  return withEnabledGate(async () => {
    try {
      const result = (await rpcCall('vt.close', {}, 5_000)) as Record<string, unknown>;
      return { success: true, ok: Boolean(result.ok) };
    } finally {
      // Keep worker alive after close so subsequent open is cheap; store is cleared.
    }
  }) as Promise<VtokenCloseResult>;
}

export async function vtokenEnsureStarted(): Promise<VtokenStatusResult> {
  if (!isVtokenBridgeEnabled()) {
    return {
      success: false,
      disabled: true,
      enabled: false,
      running: false,
      workerPid: null,
      opened: false,
      error: 'vtoken bridge disabled',
    } as VtokenStatusResult & { disabled?: boolean };
  }
  try {
    await ensureVtokenWorkerStarted();
    return vtokenGetStatus();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      enabled: true,
      running: false,
      workerPid: null,
      opened: false,
      error: message,
      packageRoot: resolveVtokenPackageRoot(),
    };
  }
}

export async function vtokenGetStatus(): Promise<VtokenStatusResult> {
  const enabled = isVtokenBridgeEnabled();
  const running = Boolean(child && !child.killed);
  let opened = false;
  let version: string | undefined;
  if (enabled && running) {
    try {
      const ping = (await rpcCall('vt.ping', {}, 3_000)) as Record<string, unknown>;
      opened = Boolean(ping.opened);
      version = typeof ping.version === 'string' ? ping.version : undefined;
    } catch (err) {
      lastWorkerError = err instanceof Error ? err.message : String(err);
    }
  }
  return {
    success: true,
    enabled,
    running,
    workerPid: child?.pid ?? null,
    opened,
    version,
    lastAssemble,
    packageRoot: resolveVtokenPackageRoot(),
    error: lastWorkerError,
  };
}

export function vtokenSetEnabled(payload: VtokenSetEnabledPayload): VtokenSetEnabledResult {
  setVtokenBridgeEnabled(Boolean(payload?.enabled));
  return { success: true, enabled: isVtokenBridgeEnabled() };
}

/** App shutdown hook. */
export function disposeVtokenBridge(): void {
  void stopVtokenWorker();
}

/** Test-only reset. */
export function resetVtokenBridgeForTests(): void {
  enabledOverride = null;
  lastAssemble = null;
  lastWorkerError = undefined;
  restartCount = 0;
  intentionalStop = true;
  void stopVtokenWorker();
}
