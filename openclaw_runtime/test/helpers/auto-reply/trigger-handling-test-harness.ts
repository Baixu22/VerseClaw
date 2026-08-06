/**
 * Test harness for the auto-reply trigger-handling shared cases
 * (src/auto-reply/*.cases.ts). The cases register shared scenarios that are
 * invoked by channel-specific reply tests; this helper provides the temp-home
 * config and mocks those tests need.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import type { OpenClawConfig } from "../../../src/config/types.openclaw.js";

export function getProviderUsageMocks() {
  return { loadProviderUsageSummary: vi.fn() };
}

export function getRunEmbeddedAgentMock() {
  return vi.fn();
}

export async function withTempHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const home = mkdtempSync(join(tmpdir(), "auto-reply-trigger-handling-"));
  return fn(home);
}

export function makeCfg(home: string): OpenClawConfig {
  return {
    session: { store: join(home, "sessions.json") },
  } as OpenClawConfig;
}

export function requireSessionStorePath(cfg: OpenClawConfig): string {
  const store = cfg.session?.store;
  if (!store) throw new Error("session.store is required");
  return store;
}
