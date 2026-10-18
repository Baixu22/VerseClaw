// Hook trust helpers decide whether discovered hook code may execute.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import type { HookSource } from "./types.js";

export type HookTrustSource = "bundled" | "managed" | "plugin" | "workspace";
export type HookTrustState = "trusted" | "untrusted" | "changed" | "disabled";

export type HookTrustDecision = {
  source: HookTrustSource;
  managed: boolean;
  state: HookTrustState;
  hash: string | null;
  expectedHash: string | null;
  reason: string;
};

export type HookTrustAuditEvent = {
  ts: string;
  action: "trust" | "untrust" | "enable" | "disable";
  hookKey: string;
  source: HookTrustSource;
  previousHash: string | null;
  newHash: string | null;
  actor: "agent" | "user";
};

export function normalizeHookTrustSource(source: HookSource): HookTrustSource {
  switch (source) {
    case "openclaw-bundled": return "bundled";
    case "openclaw-managed": return "managed";
    case "openclaw-plugin": return "plugin";
    case "openclaw-workspace": return "workspace";
  }
}

export function hashHookFile(filePath: string): string | null {
  try {
    const bytes = readFileSync(filePath);
    return createHash("sha256").update(bytes).digest("hex");
  } catch {
    return null;
  }
}

export function resolveHookTrust(input: {
  source: HookTrustSource;
  enabledByConfig: boolean;
  trusted: boolean;
  trustedHash: string | null;
  hash: string | null;
}): HookTrustDecision {
  const managed = input.source !== "workspace";
  const base = {
    source: input.source,
    managed,
    hash: input.hash,
    expectedHash: input.trustedHash,
  } as const;
  if (!input.enabledByConfig) {
    return { ...base, state: "disabled", reason: "disabled in config" };
  }
  if (input.trustedHash && input.hash !== input.trustedHash) {
    return {
      ...base,
      state: "changed",
      reason: input.hash
        ? "hook handler changed since it was trusted"
        : "hook handler is no longer readable",
    };
  }
  if (!managed && !input.trusted) {
    return { ...base, state: "untrusted", reason: "workspace hook has not been trusted" };
  }
  return { ...base, state: "trusted", reason: "owner trust policy satisfied" };
}

export function hookTrustAllowsExecution(decision: HookTrustDecision): boolean {
  return decision.state === "trusted";
}

export function appendHookTrustAudit(path: string, event: HookTrustAuditEvent): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(event) + "\n", "utf8");
}
