/**
 * FP-P0-02: request-level config source for the enhancement kill switch.
 *
 * The Assembler and the working-memory extension are long-lived: a config object
 * captured when they were constructed goes stale the moment an operator writes
 * `runtime.contextEnhancement.killSwitch=true`, which would make the config-form
 * kill switch an empty switch. So callers resolve config *per assemble()* through
 * this module instead of holding a snapshot.
 *
 * Reading `openclaw.json` on every turn would be a hot-path file read, so the
 * value is cached against the file's mtime+size stamp: a config write changes the
 * stamp and the next turn re-reads. A stat failure or a parse failure resolves to
 * the fail-closed sentinel, which the kill-switch helper reads as "engaged".
 */
import fs from "node:fs";
import { resolveConfigPath } from "../config/paths.js";

/**
 * Sentinel returned when config cannot be read or parsed. Passing it to
 * `isContextEnhancementKillSwitchEngaged` yields `true` (kill), because the
 * getter throws — which that helper catches as fail-closed.
 */
export const KILL_SWITCH_CONFIG_UNREADABLE: unknown = Object.freeze({
  get runtime(): never {
    throw new Error("kill-switch config source unreadable");
  },
});

type CacheEntry = { stamp: string; value: unknown };

let cache: CacheEntry | undefined;

function stampFor(configPath: string): string {
  const stat = fs.statSync(configPath);
  return `${stat.size}:${Math.trunc(stat.mtimeMs)}`;
}

/**
 * Resolve the runtime config the kill switch should evaluate for this request.
 *
 * Returns `undefined` when no config file exists (nothing to kill from config;
 * env-form kill still applies), the parsed config when readable, or
 * {@link KILL_SWITCH_CONFIG_UNREADABLE} when the file exists but cannot be
 * read/parsed.
 */
export function resolveKillSwitchConfig(env: NodeJS.ProcessEnv = process.env): unknown {
  let configPath: string;
  try {
    configPath = resolveConfigPath(env);
  } catch {
    return KILL_SWITCH_CONFIG_UNREADABLE;
  }
  let stamp: string;
  try {
    stamp = stampFor(configPath);
  } catch {
    // Missing file is a normal fresh install: nothing to kill from config.
    return undefined;
  }
  if (cache?.stamp === stamp) {
    return cache.value;
  }
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    value = KILL_SWITCH_CONFIG_UNREADABLE;
  }
  cache = { stamp, value };
  return value;
}

/** Test helper: drop the mtime-keyed cache. */
export function resetKillSwitchConfigCache(): void {
  cache = undefined;
}
