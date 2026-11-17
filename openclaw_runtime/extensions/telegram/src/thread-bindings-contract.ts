import os from "node:os";
import path from "node:path";
import { resolveStateDir } from "openclaw/plugin-sdk/state-paths";

export const TELEGRAM_THREAD_BINDINGS_NAMESPACE = "telegram.thread-bindings";
export const TELEGRAM_THREAD_BINDINGS_MAX_ENTRIES = 5_000;

export function resolveBindingsPath(
  accountId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const stateDir = resolveStateDir(env, os.homedir);
  return path.join(stateDir, "telegram", `thread-bindings-${accountId}.json`);
}
