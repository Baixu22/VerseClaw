#!/usr/bin/env node
/**
 * chain-audit Gateway 生命周期管理
 * 负责：启动真实 gateway（带 env/key）、健康检查、优雅停止、日志采集。
 * 可复用：任何链路测试都从这里拿一个健康的 gateway 实例。
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const RUNTIME_ROOT = resolve(__dirname, "../../../openclaw_runtime");
export const DEFAULT_PORT = 18799;
export const DEFAULT_TOKEN = "chain-audit-token";

/**
 * 启动真实 gateway。
 * @param {object} opts
 * @param {number} opts.port
 * @param {string} opts.token
 * @param {Record<string,string>} opts.env  额外环境变量（如 DEEPSEEK_API_KEY）
 * @param {boolean} opts.skipChannels
 * @returns {Promise<{proc, port, token, logPath, stop()}>}
 */
export async function startGateway(opts = {}) {
  const {
    port = DEFAULT_PORT,
    token = DEFAULT_TOKEN,
    env = {},
    skipChannels = true,
  } = opts;

  const entry = resolve(RUNTIME_ROOT, "dist/entry.js");
  if (!existsSync(entry)) {
    throw new Error(
      `Runtime entry not built: ${entry}. Run \`pnpm build:runtime\` (openclaw_runtime) first.`,
    );
  }

  const logPath = resolve(process.cwd(), "artifacts/chain-audit/evidence/gateway.log");
  const logHandle = await import("node:fs/promises").then(({ open, mkdir }) =>
    mkdir(dirname(logPath), { recursive: true }).then(() => open(logPath, "w")),
  );

  const childEnv = {
    ...process.env,
    ...env,
    OPENCLAW_SKIP_CHANNELS: skipChannels ? "1" : "0",
  };
  const proc = spawn("node", [entry, "--port", String(port), "--token", token], {
    cwd: RUNTIME_ROOT,
    env: childEnv,
    stdio: ["ignore", logHandle, logHandle],
    windowsHide: true,
  });

  // 等待就绪
  const ready = await waitForReady(port, 45_000);
  if (!ready) {
    proc.kill();
    throw new Error(`Gateway failed to become ready on port ${port} within 45s. Log: ${logPath}`);
  }

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    try { proc.kill(); } catch { /* already dead */ }
    try { await logHandle.close(); } catch { /* ignore */ }
  };

  return { proc, port, token, logPath, stop };
}

/** 轮询 health 直到就绪或超时。 */
export async function waitForReady(port = DEFAULT_PORT, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch { /* not ready yet */ }
    await sleep(1000);
  }
  return false;
}

/** 读取 gateway 日志尾部（用于错误分析）。 */
export function tailGatewayLog(logPath, lines = 40) {
  try {
    const content = readFileSync(logPath, "utf8");
    return content.split("\n").slice(-lines).join("\n");
  } catch {
    return "(gateway log unavailable)";
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

