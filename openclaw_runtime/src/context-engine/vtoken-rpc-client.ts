/**
 * Portable Verse Token stdio JSON-RPC client for the OpenClaw gateway process.
 *
 * Spawns `python -m vtoken.host_rpc` (via uv when available) and keeps a single
 * long-lived worker. Electron Main has a sibling bridge for host-api diagnostics;
 * this client is the production assembly path used on agent turns.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export const VTOKEN_PACK_REQUEST_SCHEMA = "VtokenPackRequest/v1" as const;
export const VTOKEN_PACK_RESULT_SCHEMA = "VtokenPackResult/v1" as const;
export const VTOKEN_PACK_ESTIMATE_METHOD = "chars_div_4" as const;

export type VtokenPackCandidate =
  | { candidateId: string; kind: "markdown"; sourcePath: string; text: string }
  | {
      candidateId: string;
      kind: "tool_schema";
      serverName: string;
      toolSchema: Record<string, unknown>;
    }
  | { candidateId: string; kind: "memory"; entry: Record<string, unknown> };

export type VtokenRpcPackResult = {
  schema: typeof VTOKEN_PACK_RESULT_SCHEMA;
  prompt: string;
  estimatedTokens: number;
  allowanceTokens: number;
  estimateMethod: typeof VTOKEN_PACK_ESTIMATE_METHOD;
  slot_breakdown: Record<string, unknown>;
  nodes_included: string[];
  nodes_evicted: string[];
  dedup_count: number;
  candidateCount: number;
};

export type VtokenRpcClientOptions = {
  packageRoot?: string;
  uvBin?: string;
  requestTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  method: string;
};

type VtokenPackWireResult = {
  schema: typeof VTOKEN_PACK_RESULT_SCHEMA;
  prompt: string;
  estimated_tokens: number;
  allowance_tokens: number;
  estimate_method: typeof VTOKEN_PACK_ESTIMATE_METHOD;
  slot_breakdown: Record<string, unknown>;
  nodes_included: string[];
  nodes_evicted: string[];
  dedup_count: number;
  candidate_count: number;
};

function toWireCandidate(candidate: VtokenPackCandidate): Record<string, unknown> {
  if (candidate.kind === "markdown") {
    return {
      candidate_id: candidate.candidateId,
      kind: candidate.kind,
      source_path: candidate.sourcePath,
      text: candidate.text,
    };
  }
  if (candidate.kind === "tool_schema") {
    return {
      candidate_id: candidate.candidateId,
      kind: candidate.kind,
      server_name: candidate.serverName,
      tool_schema: candidate.toolSchema,
    };
  }
  return {
    candidate_id: candidate.candidateId,
    kind: candidate.kind,
    entry: candidate.entry,
  };
}

function isPackWireResult(value: unknown): value is VtokenPackWireResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<VtokenPackWireResult>;
  return (
    result.schema === VTOKEN_PACK_RESULT_SCHEMA &&
    result.estimate_method === VTOKEN_PACK_ESTIMATE_METHOD &&
    typeof result.prompt === "string" &&
    typeof result.estimated_tokens === "number" &&
    typeof result.allowance_tokens === "number" &&
    typeof result.slot_breakdown === "object" &&
    Array.isArray(result.nodes_included) &&
    Array.isArray(result.nodes_evicted) &&
    typeof result.dedup_count === "number" &&
    typeof result.candidate_count === "number"
  );
}

const DEFAULT_TIMEOUT_MS = 15_000;

function envTruthy(raw: string | undefined): boolean | null {
  if (raw == null || raw.trim() === "") return null;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return null;
}

/** Resolve packages/vtoken root from env or common monorepo layouts. */
export function resolveVtokenPackageRootFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string | null {
  const fromEnv = env.VERSE_VTOKEN_PACKAGE_ROOT?.trim();
  if (fromEnv) {
    if (existsSync(path.join(fromEnv, "src", "vtoken"))) return fromEnv;
    if (existsSync(path.join(fromEnv, "vtoken"))) return fromEnv;
  }

  const candidates = [
    path.join(cwd, "packages", "vtoken"),
    path.join(cwd, "..", "packages", "vtoken"),
    path.join(cwd, "..", "..", "packages", "vtoken"),
    // Packaged extraResources layout: resources/vtoken
    path.join(cwd, "vtoken"),
    env.VERSE_RESOURCES_PATH ? path.join(env.VERSE_RESOURCES_PATH, "vtoken") : "",
  ].filter(Boolean);

  for (const root of candidates) {
    if (existsSync(path.join(root, "src", "vtoken"))) return root;
  }
  return null;
}

function resolveUvBin(env: NodeJS.ProcessEnv): string {
  const fromEnv = env.VERSE_VTOKEN_UV_BIN?.trim() || env.UV_BIN?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  return "uv";
}

function needsWinShell(bin: string): boolean {
  return process.platform === "win32" && !bin.toLowerCase().endsWith(".exe");
}

export class VtokenRpcClient {
  #child: ChildProcessWithoutNullStreams | null = null;
  #stdoutBuf = "";
  #nextId = 1;
  #pending = new Map<number, Pending>();
  #startPromise: Promise<void> | null = null;
  #options: VtokenRpcClientOptions;

  constructor(options: VtokenRpcClientOptions = {}) {
    this.#options = options;
  }

  get running(): boolean {
    return Boolean(this.#child && !this.#child.killed);
  }

  get pid(): number | null {
    return this.#child?.pid ?? null;
  }

  async ensureStarted(): Promise<void> {
    if (this.#child && !this.#child.killed) return;
    if (this.#startPromise) return this.#startPromise;

    this.#startPromise = (async () => {
      const env = this.#options.env ?? process.env;
      const packageRoot = this.#options.packageRoot ?? resolveVtokenPackageRootFromEnv(env);
      if (!packageRoot) {
        throw new Error(
          "vtoken package not found (set VERSE_VTOKEN_PACKAGE_ROOT or install packages/vtoken)",
        );
      }
      const pythonPath = path.join(packageRoot, "src");
      if (!existsSync(path.join(pythonPath, "vtoken"))) {
        throw new Error(`vtoken sources missing under ${pythonPath}`);
      }

      const uvBin = this.#options.uvBin ?? resolveUvBin(env);
      const args = ["run", "--python", "3.12", "python", "-m", "vtoken.host_rpc"];
      const useShell = needsWinShell(uvBin);
      const spawnEnv = {
        ...env,
        PYTHONPATH: pythonPath,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
      };

      this.#options.log?.(`[vtoken-rpc] starting worker packageRoot=${packageRoot} uv=${uvBin}`);

      const child = spawn(uvBin, args, {
        cwd: packageRoot,
        env: spawnEnv,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        shell: useShell,
      }) as ChildProcessWithoutNullStreams;

      this.#child = child;
      this.#stdoutBuf = "";

      child.stdout.on("data", (chunk: Buffer | string) => {
        this.#onData(chunk);
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        const text = chunk.toString("utf8").trim();
        if (text) this.#options.log?.(`[vtoken-rpc:stderr] ${text}`);
      });
      child.on("error", (err) => {
        this.#options.log?.(`[vtoken-rpc] spawn error: ${err.message}`);
      });
      child.on("exit", (code, signal) => {
        this.#options.log?.(`[vtoken-rpc] worker exited code=${code} signal=${signal}`);
        this.#child = null;
        this.#stdoutBuf = "";
        this.#rejectAll(`vtoken worker exited (code=${code}, signal=${signal})`);
        this.#startPromise = null;
      });

      await this.call("vt.ping", {}, 5_000);
    })();

    try {
      await this.#startPromise;
    } catch (err) {
      this.#startPromise = null;
      await this.stop();
      throw err;
    } finally {
      this.#startPromise = null;
    }
  }

  async stop(): Promise<void> {
    this.#startPromise = null;
    this.#rejectAll("vtoken worker stopped");
    const proc = this.#child;
    this.#child = null;
    this.#stdoutBuf = "";
    if (!proc) return;
    try {
      proc.stdin.end();
      proc.kill();
    } catch {
      // ignore
    }
  }

  async pack(params: {
    taskHint: string;
    allowanceTokens: number;
    renderMode?: "compact" | "dense" | "verbose";
    candidates: VtokenPackCandidate[];
  }): Promise<VtokenRpcPackResult> {
    await this.ensureStarted();
    const result = (await this.call(
      "vt.pack",
      {
        schema: VTOKEN_PACK_REQUEST_SCHEMA,
        task_hint: params.taskHint,
        allowance_tokens: params.allowanceTokens,
        estimate_method: VTOKEN_PACK_ESTIMATE_METHOD,
        render_mode: params.renderMode ?? "compact",
        candidates: params.candidates.map(toWireCandidate),
      },
      this.#options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    )) as unknown;
    if (!isPackWireResult(result)) {
      throw new Error("vt.pack returned an invalid VtokenPackResult/v1");
    }
    return {
      schema: VTOKEN_PACK_RESULT_SCHEMA,
      prompt: result.prompt,
      estimatedTokens: result.estimated_tokens,
      allowanceTokens: result.allowance_tokens,
      estimateMethod: VTOKEN_PACK_ESTIMATE_METHOD,
      slot_breakdown: result.slot_breakdown,
      nodes_included: result.nodes_included,
      nodes_evicted: result.nodes_evicted,
      dedup_count: result.dedup_count,
      candidateCount: result.candidate_count,
    };
  }

  async call(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<unknown> {
    if (!this.#child || this.#child.killed) {
      await this.ensureStarted();
    }
    if (!this.#child) throw new Error("vtoken worker not running");
    return this.#callOnProcess(this.#child, method, params, timeoutMs);
  }

  #callOnProcess(
    proc: ChildProcessWithoutNullStreams,
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    const id = this.#nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`vtoken RPC timeout after ${timeoutMs}ms: ${method}`));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer, method });
      try {
        proc.stdin.write(`${payload}\n`);
      } catch (err) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  #onData(chunk: Buffer | string): void {
    this.#stdoutBuf += chunk.toString("utf8");
    let idx = this.#stdoutBuf.indexOf("\n");
    while (idx >= 0) {
      const line = this.#stdoutBuf.slice(0, idx).replace(/\r$/, "");
      this.#stdoutBuf = this.#stdoutBuf.slice(idx + 1);
      if (line.trim()) this.#handleLine(line);
      idx = this.#stdoutBuf.indexOf("\n");
    }
  }

  #handleLine(line: string): void {
    let msg: {
      id?: number;
      result?: unknown;
      error?: { message?: string; code?: number };
    };
    try {
      msg = JSON.parse(line) as typeof msg;
    } catch {
      this.#options.log?.(`[vtoken-rpc] invalid JSON: ${line.slice(0, 200)}`);
      return;
    }
    const id = typeof msg.id === "number" ? msg.id : Number(msg.id);
    if (!Number.isFinite(id) || !this.#pending.has(id)) return;
    const p = this.#pending.get(id)!;
    this.#pending.delete(id);
    clearTimeout(p.timer);
    if (msg.error) {
      p.reject(new Error(msg.error.message || `RPC error code ${msg.error.code}`));
      return;
    }
    p.resolve(msg.result);
  }

  #rejectAll(reason: string): void {
    for (const [id, p] of this.#pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
      this.#pending.delete(id);
    }
  }
}

let sharedClient: VtokenRpcClient | null = null;

export function getSharedVtokenRpcClient(options?: VtokenRpcClientOptions): VtokenRpcClient {
  if (!sharedClient) {
    sharedClient = new VtokenRpcClient(options);
  }
  return sharedClient;
}

export async function disposeSharedVtokenRpcClient(): Promise<void> {
  if (!sharedClient) return;
  await sharedClient.stop();
  sharedClient = null;
}

/** Test helper: reset singleton. */
export async function resetSharedVtokenRpcClientForTests(): Promise<void> {
  await disposeSharedVtokenRpcClient();
}

/** Env kill-switch for production assembly path (default enabled). */
/**
 * Env kill-switch for VT assembly. Explicit 0/false/off disables.
 * Unset does NOT mean product default ON — product default is opt-in via
 * `runtime.vtoken.assembly.enabled=true` or {@link isVtokenAssemblyEnvForcedOn}.
 */
export function isVtokenAssemblyEnvEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = envTruthy(env.VERSE_VTOKEN_ASSEMBLY_ENABLED);
  // Only explicit 0/false/off disables. Unset leaves config-level opt-in free.
  if (raw === false) return false;
  return true;
}

/** Explicit env canary: VERSE_VTOKEN_ASSEMBLY_ENABLED=1|true|on|yes. */
export function isVtokenAssemblyEnvForcedOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return envTruthy(env.VERSE_VTOKEN_ASSEMBLY_ENABLED) === true;
}
