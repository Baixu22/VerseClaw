/**
 * FP-P0-04 / FP-P0-01 G3: child-runtime acknowledgement payload.
 *
 * The Electron control plane used to treat "config written + restart() resolved"
 * as `applied`, which proves nothing about the child.  This module builds the
 * acknowledgement the child itself reports, so the host can only mark `applied`
 * after a real gateway child answered with the full seven-field payload.
 *
 * Every field is derived from *this* process (the gateway child), never from the
 * host's intent:
 *   gatewayGeneration        — restart generation the host asked for (env-stamped)
 *   childPid                 — process.pid of the answering child
 *   effectiveFlags           — flags as this child resolved them (config + env)
 *   configSource             — where the child actually read config from
 *   runtimeBuildOrConfigHash — hash over resolved flags + config mtime/size
 *   turnEffectProbe          — whether the resolved flags would change a turn
 *   degradedReason           — null, or why the answer is partial
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { resolveConfigPath } from "../config/paths.js";
import {
  isCodingParseOnTouchEnabled,
  isCodingPatchFlowDefault,
  isCodingRoutingMemoShadowEnabled,
  isCodingSekbExperienceShadowEnabled,
  isCodingStaleWriteGuardEnabled,
  isCodingSymbolLeaseEnabled,
  isCodingWriteJournalEnabled,
  resolveCodingAutoVerifyConfig,
  resolveSymbolLeaseMode,
  resolveWorktreeBackend,
} from "./coding-runtime-flags.js";
import { DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS } from "./assembler.js";
import { isContextEnhancementKillSwitchEngaged } from "./enhancement-kill-switch.js";
import { isDcsContextViewToolsEnabled } from "./dcs-context-tools-flags.js";
import { resolveVtokenAssemblyConfig } from "./chat-turn-vtoken-injection.js";
import { dcsObservability } from "./dcs-observability.js";
import {
  TURN_INJECTION_CHAR_BUDGET,
  TURN_INJECTION_DROP_ALERT_RATIO,
  getEffectiveTurnInjectionCharBudget,
  getEffectiveDropAlertRatio,
  TURN_INJECTION_PRECEDENCE,
} from "./turn-injection-budget.js";

/** Env var the host stamps with the restart generation it is waiting on. */
export const RUNTIME_FLAG_ACK_GENERATION_ENV = "VERSE_CLAW_GATEWAY_GENERATION";

/** Acknowledgement field names; `applied` requires every one to be present. */
export const RUNTIME_FLAG_ACK_REQUIRED_FIELDS = [
  "gatewayGeneration",
  "childPid",
  "effectiveFlags",
  "configSource",
  "runtimeBuildOrConfigHash",
  "turnEffectProbe",
  "degradedReason",
] as const;

export type RuntimeFlagAckField = (typeof RUNTIME_FLAG_ACK_REQUIRED_FIELDS)[number];

export type RuntimeFlagAckConfigSource = {
  /** Absolute path the child resolved for openclaw config. */
  path: string;
  /** Whether that path existed when the child answered. */
  exists: boolean;
  /** How the path was chosen: env override or state-dir default. */
  origin: "env-override" | "state-dir";
};

export type RuntimeFlagTurnEffectProbe = {
  /**
   * True when the resolved flags would actually change an agent turn
   * (some enhancement injects) — the honest "does this flag do anything" bit.
   */
  wouldChangeTurn: boolean;
  /** Enhancement kill switch state as this child resolved it. */
  killSwitchEngaged: boolean;
  /** Enhancement surfaces this child would inject from, in resolution order. */
  activeSurfaces: string[];
};

/**
 * FP-P0-01 G3 / FP-P0-03: the launch-contract env keys as seen *inside the child*.
 *
 * This is the honest way to prove "no opt-in ⇒ child env does not contain
 * VERSE_VTOKEN_ASSEMBLY_ENABLED=1": the child reports its own `process.env`, so no
 * host-side reconstruction is involved. `present: false` means the key is genuinely
 * absent from the spawned process.
 */
export type RuntimeFlagAckLaunchEnv = Record<string, { present: boolean; value?: string }>;

/** Env keys whose launch-layer contract is asserted by FP-P0-01 / FP-P0-03. */
export const RUNTIME_FLAG_ACK_LAUNCH_ENV_KEYS = [
  "VERSE_VTOKEN_ASSEMBLY_ENABLED",
  "VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH",
  "OPENCLAW_DCS_CONTEXT_VIEW_TOOLS",
  "OPENCLAW_DCS_CONTEXT_TOOLS",
] as const;

function readLaunchEnv(env: NodeJS.ProcessEnv): RuntimeFlagAckLaunchEnv {
  const out: RuntimeFlagAckLaunchEnv = {};
  for (const key of RUNTIME_FLAG_ACK_LAUNCH_ENV_KEYS) {
    const raw = env[key];
    out[key] = raw === undefined ? { present: false } : { present: true, value: raw };
  }
  return out;
}

export type RuntimeFlagAckPayload = {
  schema: "runtime-flag-ack/v1";
  gatewayGeneration: string;
  childPid: number;
  /** Launch-contract env as observed inside this child (FP-P0-01 G3 evidence). */
  launchEnv: RuntimeFlagAckLaunchEnv;
  /**
   * FP-P0-05 G3 evidence: the child's shared-injection-budget accounting, plus the
   * declared precedence order and thresholds it is enforcing. Lets an operator (and
   * the phase gate) confirm the budget is real inside the running process rather
   * than only in unit tests.
   */
  injectionBudget: {
    totalChars: number;
    precedence: readonly string[];
    dropAlertRatio: number;
    counters: {
      turns: number;
      killedTurns: number;
      appliedChars: number;
      requestedChars: number;
      droppedChars: number;
      truncatedChars: number;
      dropAlerts: number;
    };
    /**
     * FP-P1-11: the most recent turn's per-channel breakdown. Aggregate
     * counters cannot show WHICH sources charged a turn nor whether the
     * degradation order matched the declared precedence.
     */
    lastTurn: {
      turnId?: string;
      killed: boolean;
      charsApplied: number;
      charsRequested: number;
      charsDropped: number;
      charsTruncated: number;
      byChannel: Record<string, { requested: number; applied: number; disposition: string }>;
      degradationOrder: Array<{ channel: string; disposition: string }>;
    } | null;
  };
  effectiveFlags: Record<string, boolean | string>;
  /**
   * FP-P1-10: why each flag has its value — `env` / `config` / `default` /
   * `kill`. `configSource` only says which FILE was read, which cannot tell
   * an explicitly-disabled flag from an unset one, nor from a killed one.
   */
  flagAttribution: Record<string, RuntimeFlagAttribution>;
  configSource: RuntimeFlagAckConfigSource;
  runtimeBuildOrConfigHash: string;
  turnEffectProbe: RuntimeFlagTurnEffectProbe;
  /** null when the ack is complete; a short reason string when partial. */
  degradedReason: string | null;
  /** Flags the host asked for that this child did NOT adopt (partial reject). */
  rejectedFlags?: Array<{ id: string; requested: boolean; effective: boolean; reason: string }>;
  answeredAt: string;
};

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function resolveConfigSource(env: NodeJS.ProcessEnv): RuntimeFlagAckConfigSource {
  const origin: RuntimeFlagAckConfigSource["origin"] = env.OPENCLAW_CONFIG_PATH?.trim()
    ? "env-override"
    : "state-dir";
  let resolved: string;
  try {
    resolved = resolveConfigPath(env);
  } catch {
    return { path: "", exists: false, origin };
  }
  const exists = (() => {
    try {
      return fs.existsSync(resolved);
    } catch {
      return false;
    }
  })();
  return { path: resolved, exists, origin };
}

function configStamp(source: RuntimeFlagAckConfigSource): string {
  if (!source.exists || !source.path) return "absent";
  try {
    const stat = fs.statSync(source.path);
    return `${stat.size}:${Math.trunc(stat.mtimeMs)}`;
  } catch {
    return "unreadable";
  }
}

/**
 * Resolve the flags this child is actually running with.
 *
 * Context-block flags come from the DCS defaults merged with config, coding flags
 * from `resolveCodingFeatureFlags`, plus the two env-controlled surfaces
 * (view tools, VToken assembly).  Kill switch forces context-block flags off so
 * the reported values match what a turn would really see.
 */
export function resolveEffectiveRuntimeFlags(
  cfg?: OpenClawConfig,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, boolean | string> {
  return resolveEffectiveRuntimeFlagsWithSources(cfg, env).flags;
}

/**
 * FP-P1-10: per-flag provenance.
 *
 * `configSource` only ever answered "which FILE did the child read". That
 * cannot distinguish a flag that is off because the operator wrote `false`
 * from one that is off because nobody set it — or, worse, from one the kill
 * switch forced off. Those three have very different operational meanings when
 * a preview switch does not appear to take effect.
 */
export type RuntimeFlagOrigin = "env" | "config" | "default" | "kill";

export type RuntimeFlagAttribution = {
  value: boolean | string;
  origin: RuntimeFlagOrigin;
  /** env var name or config path that decided the value; absent for defaults. */
  key?: string;
};

export function resolveEffectiveRuntimeFlagsWithSources(
  cfg?: OpenClawConfig,
  env: NodeJS.ProcessEnv = process.env,
): {
  flags: Record<string, boolean | string>;
  attribution: Record<string, RuntimeFlagAttribution>;
} {
  const killed = isContextEnhancementKillSwitchEngaged(cfg, env);
  const attribution: Record<string, RuntimeFlagAttribution> = {};
  const contextBlock: Record<string, boolean> = {};
  for (const name of Object.keys(DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS)) {
    const key = name as keyof typeof DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS;
    const configured = readContextBlockFlagConfigured(cfg, key);
    const value = killed ? false : (configured ?? DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS[key]);
    contextBlock[name] = value;
    // Kill wins over everything, and saying so is the point: an operator who
    // set `true` needs to see `kill`, not a bare `false`.
    attribution[name] = killed
      ? { value, origin: "kill", key: "runtime.contextEnhancement.killSwitch" }
      : configured !== undefined
        ? { value, origin: "config", key: `runtime.contextBlock.${CONTEXT_BLOCK_CONFIG_PATH[key]}.enabled` }
        : { value, origin: "default" };
  }

  // Coding flags have one resolver per leaf; enumerate them explicitly so a new
  // leaf shows up as a compile error rather than silently missing from the ack.
  const codingFlat: Record<string, boolean | string> = {
    "runtime.coding.parseOnTouch.enabled": isCodingParseOnTouchEnabled(cfg),
    "runtime.coding.staleWriteGuard.enabled": isCodingStaleWriteGuardEnabled(cfg),
    "runtime.coding.writeJournal.enabled": isCodingWriteJournalEnabled(cfg),
    "runtime.coding.autoVerify.enabled": resolveCodingAutoVerifyConfig(cfg).enabled,
    "runtime.coding.worktree.backend": resolveWorktreeBackend(cfg),
    "runtime.coding.symbolLease.enabled": isCodingSymbolLeaseEnabled(cfg),
    "runtime.coding.symbolLease.mode": resolveSymbolLeaseMode(cfg),
    "runtime.coding.patchFlow.default": isCodingPatchFlowDefault(cfg),
    "runtime.coding.sekb.experienceShadow": isCodingSekbExperienceShadowEnabled(cfg),
    "runtime.coding.routingMemo.shadow": isCodingRoutingMemoShadowEnabled(cfg),
  };

  for (const [name, value] of Object.entries(codingFlat)) {
    // Coding leaves have one resolver each; provenance is config-vs-default and
    // is decided by whether the leaf is present in the config object.
    const present = isCodingLeafConfigured(cfg, name);
    attribution[name] = present
      ? { value, origin: "config", key: name }
      : { value, origin: "default" };
  }

  const vtoken = resolveVtokenAssemblyConfig(cfg).enabled;
  const viewTools = isDcsContextViewToolsEnabled(env);
  attribution["runtime.vtoken.assembly.enabled"] = isCodingLeafConfigured(
    cfg,
    "runtime.vtoken.assembly.enabled",
  )
    ? { value: vtoken, origin: "config", key: "runtime.vtoken.assembly.enabled" }
    : { value: vtoken, origin: "default" };
  attribution["dcs.contextViewTools.enabled"] = viewTools
    ? { value: viewTools, origin: "env", key: DCS_CONTEXT_VIEW_TOOLS_ENV }
    : { value: viewTools, origin: "default" };
  attribution["runtime.contextEnhancement.killSwitch"] = killed
    ? {
        value: true,
        origin: envTruthyLocal(env[CONTEXT_ENHANCEMENT_KILL_ENV]) ? "env" : "config",
        key: envTruthyLocal(env[CONTEXT_ENHANCEMENT_KILL_ENV])
          ? CONTEXT_ENHANCEMENT_KILL_ENV
          : "runtime.contextEnhancement.killSwitch",
      }
    : { value: false, origin: "default" };

  return {
    flags: {
      ...contextBlock,
      ...codingFlat,
      "runtime.vtoken.assembly.enabled": vtoken,
      "dcs.contextViewTools.enabled": viewTools,
      "runtime.contextEnhancement.killSwitch": killed,
    },
    attribution,
  };
}

const DCS_CONTEXT_VIEW_TOOLS_ENV = "OPENCLAW_DCS_CONTEXT_VIEW_TOOLS";
const CONTEXT_ENHANCEMENT_KILL_ENV = "VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH";

function envTruthyLocal(raw: string | undefined): boolean {
  if (!raw) return false;
  const value = raw.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

/** Walk a dotted config path; `undefined` means the operator never set it. */
function isCodingLeafConfigured(cfg: OpenClawConfig | undefined, dottedPath: string): boolean {
  let cursor: unknown = cfg;
  for (const segment of dottedPath.split(".")) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return false;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor !== undefined;
}

const CONTEXT_BLOCK_CONFIG_PATH: Record<
  keyof typeof DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS,
  string
> = {
  "runtime.contextBlock.compass.enabled": "compass",
  "runtime.contextBlock.role_memory.enabled": "role-memory",
  "runtime.contextBlock.working_memory.enabled": "working-memory",
  "runtime.contextBlock.tool_registry.enabled": "tool-registry",
};

/** Configured value, or `undefined` when the operator never set this leaf. */
function readContextBlockFlagConfigured(
  cfg: OpenClawConfig | undefined,
  flag: keyof typeof DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS,
): boolean | undefined {
  const blocks = cfg?.runtime?.contextBlock as Record<string, unknown> | undefined;
  const leaf = blocks?.[CONTEXT_BLOCK_CONFIG_PATH[flag]];
  if (leaf && typeof leaf === "object" && !Array.isArray(leaf)) {
    const enabled = (leaf as { enabled?: unknown }).enabled;
    if (typeof enabled === "boolean") return enabled;
  }
  return undefined;
}

/** Surfaces that, when on, actually alter an agent turn's prompt. */
const TURN_EFFECT_FLAGS = [
  "runtime.contextBlock.compass.enabled",
  "runtime.contextBlock.role_memory.enabled",
  "runtime.contextBlock.working_memory.enabled",
  "runtime.contextBlock.tool_registry.enabled",
  "runtime.vtoken.assembly.enabled",
  "dcs.contextViewTools.enabled",
] as const;

function buildTurnEffectProbe(
  effectiveFlags: Record<string, boolean | string>,
  killSwitchEngaged: boolean,
): RuntimeFlagTurnEffectProbe {
  const activeSurfaces = killSwitchEngaged
    ? []
    : TURN_EFFECT_FLAGS.filter((flag) => effectiveFlags[flag] === true);
  return {
    wouldChangeTurn: activeSurfaces.length > 0,
    killSwitchEngaged,
    activeSurfaces: [...activeSurfaces],
  };
}

/** FP-P0-05: read the live shared-budget config and counters from this child. */
function readInjectionBudgetEvidence(): RuntimeFlagAckPayload["injectionBudget"] {
  const counters = dcsObservability.snapshot();
  return {
    totalChars: getEffectiveTurnInjectionCharBudget(),
    precedence: [...TURN_INJECTION_PRECEDENCE],
    dropAlertRatio: getEffectiveDropAlertRatio(),
    counters: {
      turns: counters.turnInjectionTurns,
      killedTurns: counters.turnInjectionKilledTurns,
      appliedChars: counters.turnInjectionAppliedChars,
      requestedChars: counters.turnInjectionRequestedChars,
      droppedChars: counters.turnInjectionDroppedChars,
      truncatedChars: counters.turnInjectionTruncatedChars,
      dropAlerts: counters.turnInjectionDropAlerts,
    },
    lastTurn: counters.lastTurnInjection,
  };
}

/**
 * Map a host-side flag identifier onto the key used in `effectiveFlags`.
 *
 * The Electron control plane addresses context-block flags by their **openclaw
 * config path**, which is kebab (`runtime.contextBlock.working-memory.enabled` —
 * see `DCS_WRITABLE_FLAG_SPECS.targetKey`). The Assembler's flag names are snake
 * (`runtime.contextBlock.working_memory.enabled`). Without this mapping a perfectly
 * applied flag is reported as `unknown-to-runtime` / rejected, which would make the
 * ack state machine fail on a healthy set. The env-controlled and coding flags use
 * the same spelling on both sides and pass through unchanged.
 */
export function normalizeRequestedFlagId(id: string): string {
  const contextBlock = /^runtime\.contextBlock\.([a-z-]+)\.enabled$/.exec(id);
  if (contextBlock) {
    return `runtime.contextBlock.${contextBlock[1]!.replace(/-/g, "_")}.enabled`;
  }
  // Env-controlled surfaces are addressed by env var name by the control plane.
  if (id === "OPENCLAW_DCS_CONTEXT_VIEW_TOOLS" || id === "OPENCLAW_DCS_CONTEXT_TOOLS") {
    return "dcs.contextViewTools.enabled";
  }
  return id;
}

/** Builds the acknowledgement payload for this gateway child. */
export function buildRuntimeFlagAck(params: {
  cfg?: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
  /** Flags the host asked for, id → requested boolean (optional). */
  requestedFlags?: Record<string, boolean>;
} = {}): RuntimeFlagAckPayload {
  const env = params.env ?? process.env;
  const cfg = params.cfg;
  const configSource = resolveConfigSource(env);
  const resolved = resolveEffectiveRuntimeFlagsWithSources(cfg, env);
  const effectiveFlags = resolved.flags;
  const killSwitchEngaged = effectiveFlags["runtime.contextEnhancement.killSwitch"] === true;
  const turnEffectProbe = buildTurnEffectProbe(effectiveFlags, killSwitchEngaged);

  const degradedReasons: string[] = [];
  if (!configSource.exists) {
    degradedReasons.push("config-file-absent");
  }

  const rejectedFlags: NonNullable<RuntimeFlagAckPayload["rejectedFlags"]> = [];
  for (const [requestedId, requested] of Object.entries(params.requestedFlags ?? {})) {
    const id = normalizeRequestedFlagId(requestedId);
    if (!(id in effectiveFlags)) {
      rejectedFlags.push({
        id: requestedId,
        requested,
        effective: false,
        reason: "unknown-to-runtime",
      });
      continue;
    }
    const effective = effectiveFlags[id] === true;
    if (effective !== requested) {
      rejectedFlags.push({
        id: requestedId,
        requested,
        effective,
        reason: killSwitchEngaged ? "kill-switch-engaged" : "not-adopted-by-runtime",
      });
    }
  }
  if (rejectedFlags.length > 0) {
    degradedReasons.push("partial-flag-reject");
  }

  const runtimeBuildOrConfigHash = createHash("sha256")
    .update(
      stableStringify({
        flags: effectiveFlags,
        config: configStamp(configSource),
        origin: configSource.origin,
      }),
    )
    .digest("hex")
    .slice(0, 32);

  return {
    schema: "runtime-flag-ack/v1",
    gatewayGeneration: env[RUNTIME_FLAG_ACK_GENERATION_ENV]?.trim() || "unknown",
    childPid: process.pid,
    launchEnv: readLaunchEnv(env),
    injectionBudget: readInjectionBudgetEvidence(),
    effectiveFlags,
    flagAttribution: resolved.attribution,
    configSource,
    runtimeBuildOrConfigHash,
    turnEffectProbe,
    degradedReason: degradedReasons.length > 0 ? degradedReasons.join(",") : null,
    ...(rejectedFlags.length > 0 ? { rejectedFlags } : {}),
    answeredAt: new Date().toISOString(),
  };
}

/**
 * Returns the required ack fields that are missing/invalid in `payload`.
 *
 * `launchEnv` is deliberately NOT in the required set: it is evidence carried
 * alongside the ack for FP-P0-01/FP-P0-03, not one of the seven fields FP-P0-04
 * defines as gating `applied`. Keeping the required set at exactly seven keeps the
 * host and runtime validators in agreement.
 */
export function missingRuntimeFlagAckFields(payload: unknown): RuntimeFlagAckField[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [...RUNTIME_FLAG_ACK_REQUIRED_FIELDS];
  }
  const record = payload as Record<string, unknown>;
  const missing: RuntimeFlagAckField[] = [];
  for (const field of RUNTIME_FLAG_ACK_REQUIRED_FIELDS) {
    if (!(field in record)) {
      missing.push(field);
      continue;
    }
    const value = record[field];
    switch (field) {
      case "gatewayGeneration":
        if (typeof value !== "string" || value.trim() === "") missing.push(field);
        break;
      case "childPid":
        if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
          missing.push(field);
        }
        break;
      case "effectiveFlags":
        if (!value || typeof value !== "object" || Array.isArray(value)) missing.push(field);
        break;
      case "configSource":
        if (
          !value
          || typeof value !== "object"
          || Array.isArray(value)
          || typeof (value as RuntimeFlagAckConfigSource).path !== "string"
          || typeof (value as RuntimeFlagAckConfigSource).exists !== "boolean"
        ) {
          missing.push(field);
        }
        break;
      case "runtimeBuildOrConfigHash":
        if (typeof value !== "string" || value.trim() === "") missing.push(field);
        break;
      case "turnEffectProbe":
        if (
          !value
          || typeof value !== "object"
          || Array.isArray(value)
          || typeof (value as RuntimeFlagTurnEffectProbe).wouldChangeTurn !== "boolean"
        ) {
          missing.push(field);
        }
        break;
      case "degradedReason":
        // Explicit null is valid ("no degradation"); undefined is not.
        if (value !== null && typeof value !== "string") missing.push(field);
        break;
    }
  }
  return missing;
}

/** True only when every required ack field is present and well-formed. */
export function isCompleteRuntimeFlagAck(payload: unknown): payload is RuntimeFlagAckPayload {
  return missingRuntimeFlagAckFields(payload).length === 0;
}
