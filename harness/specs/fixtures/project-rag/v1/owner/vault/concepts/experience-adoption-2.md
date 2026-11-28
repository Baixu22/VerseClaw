---
title: experience-adoption / openclaw_runtime/src/knowledge/sekb/feature-flags.ts
revision: 1
status: active
trust: confirmed
verifiedAt: "2026-11-09T22:32:47.090Z"
acl:
  read: [operator]
scope:
  workspaceId: rag-corpus-workspace
retention:
  policy: source-coupled
actor: codex/project-rag-corpus-author
driven_by: agent
---

# Repository source snapshot

Origin: openclaw_runtime/src/knowledge/sekb/feature-flags.ts
Commit: 1a4cc531ee050794b89dc8d7e49ac7c7a1c71ec0

~~~typescript
/**
 * Pure SEKB feature-flag resolution shared by runtime, host reporter, and ops CLI.
 * Shadow, batch assistants, and Phase C would_trigger always require the master SEKB
 * gate and default off. Phase C never mutates trajectory/principle/candidate pool.
 */
export type SekbFlagConfig = {
  runtime?: {
    contextBlock?: {
      sekb?: {
        enabled?: boolean;
        shadowEvaluation?: { enabled?: boolean };
        batchDistillationAssistant?: { enabled?: boolean };
        phaseCWouldTrigger?: {
          enabled?: boolean;
          owner?: string;
          timeoutMs?: number;
        };
      };
    };
  };
};

function envTriState(env: NodeJS.ProcessEnv, name: string): boolean | undefined {
  const raw = env[name]?.trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") {
    return true;
  }
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") {
    return false;
  }
  return undefined;
}

/** Explicit SEKB enablement: env wins when set, otherwise config flag. Default off. */
export function isSekbEnabled(
  cfg?: SekbFlagConfig,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const fromEnv = envTriState(env, "OPENCLAW_SEKB_ENABLED");
  if (fromEnv !== undefined) {
    return fromEnv;
  }
  return cfg?.runtime?.contextBlock?.sekb?.enabled === true;
}

/** Shadow metadata is opt-in and cannot activate the SEKB runtime on its own. */
export function isSekbShadowEvaluationEnabled(
  cfg?: SekbFlagConfig,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isSekbEnabled(cfg, env)) {
    return false;
  }
  const fromEnv = envTriState(env, "OPENCLAW_SEKB_SHADOW_EVALUATION_ENABLED");
  if (fromEnv !== undefined) {
    return fromEnv;
  }
  return cfg?.runtime?.contextBlock?.sekb?.shadowEvaluation?.enabled === true;
}

/**
 * Batch assistant has its own env override but still requires the SEKB master gate.
 * It is only constructed by an explicit caller.
 */
export function isSekbBatchDistillationAssistantEnabled(
  cfg?: SekbFlagConfig,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isSekbEnabled(cfg, env)) {
    return false;
  }
  const fromEnv = envTriState(env, "OPENCLAW_SEKB_BATCH_DISTILLATION_ASSISTANT_ENABLED");
  if (fromEnv !== undefined) {
    return fromEnv;
  }
  return cfg?.runtime?.contextBlock?.sekb?.batchDistillationAssistant?.enabled === true;
}

/**
 * Phase C (D1) mutation-free would_trigger evidence. Dedicated default-off flag.
 * Requires master SEKB; never authorizes capture filtering or durable writes.
 */
export function isSekbPhaseCWouldTriggerEnabled(
  cfg?: SekbFlagConfig,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isSekbEnabled(cfg, env)) {
    return false;
  }
  const fromEnv = envTriState(env, "OPENCLAW_SEKB_PHASE_C_WOULD_TRIGGER_ENABLED");
  if (fromEnv !== undefined) {
    return fromEnv;
  }
  return cfg?.runtime?.contextBlock?.sekb?.phaseCWouldTrigger?.enabled === true;
}

export function resolveSekbPhaseCWouldTriggerOwner(
  cfg?: SekbFlagConfig,
): string {
  const owner = cfg?.runtime?.contextBlock?.sekb?.phaseCWouldTrigger?.owner?.trim();
  return owner && owner.length > 0 ? owner : "sekb-phase-c-would-trigger";
}

export function resolveSekbPhaseCWouldTriggerTimeoutMs(
  cfg?: SekbFlagConfig,
): number {
  const raw = cfg?.runtime?.contextBlock?.sekb?.phaseCWouldTrigger?.timeoutMs;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 1 && raw <= 60_000) {
    return Math.floor(raw);
  }
  return 5_000;
}
~~~
