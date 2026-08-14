/**
 * Writable DCS production flag control plane (TASK-P0-01).
 * Allowlist only — never invent paths. Defaults remain fail-closed.
 */
import {
  DCS_PROD_FLAGS,
  type DcsProdFlagEntry,
  type DcsProdFlagKind,
} from './prod-flags-catalog';

export type DcsProdFlagApplyStatus =
  | 'applied'
  | 'pending-restart'
  | 'error'
  | 'read-only'
  | 'unsupported'
  // FP-P0-04 acknowledgement states. `applied` is no longer reachable from
  // "write succeeded + restart() resolved"; it requires a complete child ack.
  | 'saved'
  | 'restarting'
  | 'runtime-acknowledged'
  | 'failed';

/**
 * FP-P0-04: ordered acknowledgement lifecycle.
 * saved → pending-restart → restarting → runtime-acknowledged → applied | failed
 */
export const DCS_FLAG_ACK_STATES = [
  'saved',
  'pending-restart',
  'restarting',
  'runtime-acknowledged',
  'applied',
  'failed',
] as const;

export type DcsFlagAckState = (typeof DCS_FLAG_ACK_STATES)[number];

/** The seven ack fields; `applied` requires all of them. */
export const DCS_FLAG_ACK_REQUIRED_FIELDS = [
  'gatewayGeneration',
  'childPid',
  'effectiveFlags',
  'configSource',
  'runtimeBuildOrConfigHash',
  'turnEffectProbe',
  'degradedReason',
] as const;

export type DcsFlagAckRequiredField = (typeof DCS_FLAG_ACK_REQUIRED_FIELDS)[number];

/** Child-reported acknowledgement, mirrored from the runtime `runtime.flags.ack` payload. */
export type DcsFlagRuntimeAck = {
  gatewayGeneration: string;
  childPid: number;
  effectiveFlags: Record<string, boolean | string>;
  /**
   * FP-P1-10: why each flag holds its value. Optional so an older child
   * (which never sends it) is not treated as degraded.
   */
  flagAttribution?: Record<string, {
    value: boolean | string;
    origin: 'env' | 'config' | 'default' | 'kill';
    key?: string;
  }>;
  configSource: { path: string; exists: boolean; origin?: string };
  runtimeBuildOrConfigHash: string;
  turnEffectProbe: {
    wouldChangeTurn: boolean;
    killSwitchEngaged?: boolean;
    activeSurfaces?: string[];
  };
  degradedReason: string | null;
  rejectedFlags?: Array<{ id: string; requested: boolean; effective: boolean; reason: string }>;
  answeredAt?: string;
};

/** Why a flag set did not reach `applied`. Drives the operator-facing hint. */
export type DcsFlagAckFailureReason =
  | 'restart-failed'
  | 'ack-timeout'
  | 'ack-incomplete'
  | 'ack-stale-generation'
  | 'gateway-not-running'
  | 'flag-rejected';

/** Returns the ack fields missing or malformed in `payload`. */
export function missingDcsFlagAckFields(payload: unknown): DcsFlagAckRequiredField[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return [...DCS_FLAG_ACK_REQUIRED_FIELDS];
  }
  const record = payload as Record<string, unknown>;
  const missing: DcsFlagAckRequiredField[] = [];
  for (const field of DCS_FLAG_ACK_REQUIRED_FIELDS) {
    if (!(field in record)) {
      missing.push(field);
      continue;
    }
    const value = record[field];
    if (field === 'gatewayGeneration' || field === 'runtimeBuildOrConfigHash') {
      if (typeof value !== 'string' || value.trim() === '') missing.push(field);
    } else if (field === 'childPid') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) missing.push(field);
    } else if (field === 'effectiveFlags') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) missing.push(field);
    } else if (field === 'configSource') {
      const cs = value as { path?: unknown; exists?: unknown } | null;
      if (!cs || typeof cs !== 'object' || typeof cs.path !== 'string' || typeof cs.exists !== 'boolean') {
        missing.push(field);
      }
    } else if (field === 'turnEffectProbe') {
      const probe = value as { wouldChangeTurn?: unknown } | null;
      if (!probe || typeof probe !== 'object' || typeof probe.wouldChangeTurn !== 'boolean') {
        missing.push(field);
      }
    } else if (field === 'degradedReason') {
      // Explicit null means "no degradation" and is valid; undefined is not.
      if (value !== null && typeof value !== 'string') missing.push(field);
    }
  }
  return missing;
}

/** True only when every required ack field is present and well-formed. */
export function isCompleteDcsFlagAck(payload: unknown): payload is DcsFlagRuntimeAck {
  return missingDcsFlagAckFields(payload).length === 0;
}

export type DcsProdFlagControlKind = Extract<DcsProdFlagKind, 'env' | 'config'>;

export type DcsWritableFlagSpec = {
  id: string;
  catalog: DcsProdFlagEntry;
  controlKind: DcsProdFlagControlKind;
  /** AppSettings key storing UI override (boolean). */
  storeKey: string;
  /**
   * For kind=config: dotted path under openclaw.json (e.g. runtime.coding.staleWriteGuard.enabled).
   * For kind=env: primary env var name.
   */
  targetKey: string;
  /** Optional alias env var (set/cleared with primary). */
  envAlias?: string;
  defaultEnabled: boolean;
  /** When set, the switch is surfaced but disabled (negative-effect wiring not yet fixed). */
  unavailableReason?: string;
};

/**
 * Boolean opt-in flags the Settings panel may toggle.
 * api-only / request-only / info / string backends stay read-only in UI.
 */
export const DCS_WRITABLE_FLAG_SPECS: readonly DcsWritableFlagSpec[] = [
  {
    id: 'context-view-tools',
    catalog: mustFlag('context-view-tools'),
    controlKind: 'env',
    storeKey: 'dcsContextViewToolsEnabled',
    targetKey: 'OPENCLAW_DCS_CONTEXT_VIEW_TOOLS',
    envAlias: 'OPENCLAW_DCS_CONTEXT_TOOLS',
    defaultEnabled: false,
  },
  {
    id: 'working-memory',
    catalog: mustFlag('working-memory'),
    controlKind: 'config',
    storeKey: 'dcsWorkingMemoryEnabled',
    targetKey: 'runtime.contextBlock.working-memory.enabled',
    defaultEnabled: false,
  },
  {
    id: 'tool-registry',
    catalog: mustFlag('tool-registry'),
    controlKind: 'config',
    storeKey: 'dcsToolRegistryEnabled',
    targetKey: 'runtime.contextBlock.tool-registry.enabled',
    defaultEnabled: false,
  },
  {
    id: 'stale-write-guard',
    catalog: mustFlag('stale-write-guard'),
    controlKind: 'config',
    storeKey: 'dcsStaleWriteGuardEnabled',
    targetKey: 'runtime.coding.staleWriteGuard.enabled',
    defaultEnabled: false,
  },
  {
    id: 'symbol-lease',
    catalog: mustFlag('symbol-lease'),
    controlKind: 'config',
    storeKey: 'dcsSymbolLeaseEnabled',
    targetKey: 'runtime.coding.symbolLease.enabled',
    defaultEnabled: false,
  },
  {
    id: 'routing-memo-shadow',
    catalog: mustFlag('routing-memo-shadow'),
    controlKind: 'config',
    storeKey: 'dcsRoutingMemoShadowEnabled',
    targetKey: 'runtime.coding.routingMemo.shadow',
    defaultEnabled: false,
  },
  {
    id: 'sekb-experience-shadow',
    catalog: mustFlag('sekb-experience-shadow'),
    controlKind: 'config',
    storeKey: 'dcsSekbExperienceShadowEnabled',
    targetKey: 'runtime.coding.sekb.experienceShadow',
    defaultEnabled: false,
  },
  {
    id: 'runtime-memory-persist',
    catalog: mustFlag('runtime-memory-persist'),
    controlKind: 'config',
    storeKey: 'dcsRuntimeMemoryPersistEnabled',
    targetKey: 'runtime.memory.persist',
    defaultEnabled: false,
    unavailableReason: 'R3-1 E-1 裁决: persist=true 构成 owner 漂移,fail-closed 拒绝。',
  },
  {
    id: 'runtime-memory-inject-pilot',
    catalog: mustFlag('runtime-memory-inject-pilot'),
    controlKind: 'config',
    storeKey: 'dcsRuntimeMemoryInjectPilotEnabled',
    targetKey: 'runtime.memory.injectPilot.enabled',
    defaultEnabled: false,
    unavailableReason: 'R3-1 审计: role-memory provider 不读此开关,接线断线。',
  },
  {
    id: 'runtime-memory-candidate-generation',
    catalog: mustFlag('runtime-memory-candidate-generation'),
    controlKind: 'config',
    storeKey: 'dcsRuntimeMemoryCandidateGenerationEnabled',
    targetKey: 'runtime.memory.candidateGeneration',
    defaultEnabled: false,
  },
  {
    id: 'compass-context-block',
    catalog: mustFlag('compass-context-block'),
    controlKind: 'config',
    storeKey: 'dcsCompassContextBlockEnabled',
    targetKey: 'runtime.contextBlock.compass.enabled',
    defaultEnabled: false,
    unavailableReason: 'R3-1 v3 审计: Assembler compass handler 无生产 inputs.compass(auto-reply compass 走旁路注入)。',
  },
  {
    id: 'role-memory',
    catalog: mustFlag('role-memory'),
    controlKind: 'config',
    storeKey: 'dcsRoleMemoryEnabled',
    targetKey: 'runtime.contextBlock.role-memory.enabled',
    defaultEnabled: false,
    unavailableReason: 'R3-1 审计: 假活面 + 负作用(开而 producer 未接会替换在跑 provider)。',
  },
] as const;

export type DcsWritableFlagId = (typeof DCS_WRITABLE_FLAG_SPECS)[number]['id'];

function mustFlag(id: string): DcsProdFlagEntry {
  const entry = DCS_PROD_FLAGS.find((f) => f.id === id);
  if (!entry) {
    throw new Error(`DCS_PROD_FLAGS missing id=${id}`);
  }
  return entry;
}

export function listWritableFlagSpecs(): readonly DcsWritableFlagSpec[] {
  return DCS_WRITABLE_FLAG_SPECS;
}

export function getWritableFlagSpec(id: string): DcsWritableFlagSpec | undefined {
  return DCS_WRITABLE_FLAG_SPECS.find((s) => s.id === id);
}

export function isWritableFlagId(id: string): id is DcsWritableFlagId {
  return DCS_WRITABLE_FLAG_SPECS.some((s) => s.id === id);
}

/** Dot-path get for openclaw.json trees. */
export function getConfigPathValue(root: unknown, path: string): unknown {
  if (!path || root == null || typeof root !== 'object') return undefined;
  const parts = path.split('.').filter(Boolean);
  let cur: unknown = root;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Dot-path set; creates intermediate plain objects. Does not mutate input. */
export function setConfigPathValue(
  root: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const parts = path.split('.').filter(Boolean);
  if (parts.length === 0) return { ...root };
  const clone: Record<string, unknown> = { ...root };
  let cur: Record<string, unknown> = clone;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i]!;
    const next = cur[key];
    const nextObj =
      next && typeof next === 'object' && !Array.isArray(next)
        ? { ...(next as Record<string, unknown>) }
        : {};
    cur[key] = nextObj;
    cur = nextObj;
  }
  cur[parts[parts.length - 1]!] = value;
  return clone;
}

export function asBooleanFlag(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const raw = value.trim().toLowerCase();
    if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off' || raw === '') return false;
  }
  if (typeof value === 'number') return value !== 0;
  return fallback;
}

export type DcsProdFlagStateRow = {
  id: string;
  writable: boolean;
  enabled: boolean;
  defaultEnabled: boolean;
  status: DcsProdFlagApplyStatus;
  controlKind?: DcsProdFlagControlKind;
  targetKey?: string;
  storeKey?: string;
  message?: string;
};

export type DcsProdFlagsSnapshot = {
  productionMode: 'opt-in';
  flags: DcsProdFlagStateRow[];
  gatewayState?: string;
  updatedAt: string;
  /** TASK-P2-04: productized observability snapshot (host-visible, not gateway in-process counters). */
  observability?: DcsProdObservabilitySnapshot;
};

/** Host-visible DCS/coding metrics keys + kill state for Settings panel. */
export type DcsProdObservabilitySnapshot = {
  schema: 'dcs-prod-observability/v1';
  killSwitchEngaged: boolean;
  killSwitchEnv: string;
  viewToolsEnvEngaged: boolean;
  enabledWritableFlagIds: string[];
  metricKeys: {
    writeSide: string[];
    waveSide: string[];
    shadowSide: string[];
    budgetSide: string[];
  };
  sources: string[];
  note: string;
};

export type DcsProdFlagSetPayload = {
  id: string;
  enabled: boolean;
  /** When true (default), restart gateway if running so env/config-sync apply. */
  restartGateway?: boolean;
};

export type DcsProdFlagSetResult = {
  success: boolean;
  id: string;
  enabled: boolean;
  status: DcsProdFlagApplyStatus;
  restartedGateway: boolean;
  error?: string;
  /** FP-P0-04: states this set actually passed through, in order. */
  ackTrail?: DcsFlagAckState[];
  /** FP-P0-04: the child's acknowledgement, when one was received. */
  runtimeAck?: DcsFlagRuntimeAck;
  /** Ack fields the child failed to supply (non-empty ⇒ not `applied`). */
  ackMissingFields?: DcsFlagAckRequiredField[];
  /** Why the set did not reach `applied`. */
  failureReason?: DcsFlagAckFailureReason;
  /** i18n key for an operator-actionable next step. */
  operatorHintKey?: string;
  /** Generation the host was waiting for; used to discard stale acks. */
  gatewayGeneration?: string;
  /** FP-P1-09: ms spent waiting for the child ack (excludes save + restart). */
  ackWaitMs?: number;
};

/**
 * FP-P1-09: result of re-querying the child ack WITHOUT saving or restarting.
 * Lets an operator recover from `ack-timeout` on a slow start by re-checking,
 * instead of flipping the flag again.
 */
export type DcsProdFlagAckRequeryResult = {
  success: boolean;
  status: DcsProdFlagApplyStatus;
  ackTrail?: DcsFlagAckState[];
  runtimeAck?: DcsFlagRuntimeAck;
  ackMissingFields?: DcsFlagAckRequiredField[];
  failureReason?: DcsFlagAckFailureReason;
  operatorHintKey?: string;
  gatewayGeneration?: string;
  ackWaitMs?: number;
  error?: string;
};

/**
 * FP-P1-03: the "DCS Coding Preview" first-product capability combo.
 *
 * One product switch that composes exactly these writable flags:
 *  - context-view-tools: context read/search/view tools
 *  - working-memory + tool-registry: the two coding context blocks
 *  - stale-write-guard: write-side safety for the controlled-write loop
 *
 * Deliberately NOT in the combo (hard lock: no exclusion smuggling):
 *  - routing-memo-shadow / sekb-experience-shadow (shadow-only diagnostics)
 *  - symbol-lease (multi-writer concurrency, not needed for the single-user
 *    first product)
 *  - VToken / RM inject / SEKB writeback / Browser (not writable flags here at
 *    all — excluded components stay excluded)
 * write-journal / undo are baseline-on and not part of any switch.
 */
export const DCS_PREVIEW_COMBO_FLAG_IDS = [
  'context-view-tools',
  'working-memory',
  'tool-registry',
  'stale-write-guard',
] as const satisfies readonly DcsWritableFlagId[];

export type DcsPreviewPrereq = 'providerVerified' | 'workspaceSelected' | 'permissionChosen';

export type DcsPreviewState = {
  /** All combo flags are on in the persisted control plane (store view). */
  enabled: boolean;
  /** Some but not all combo flags are on (expert drift; UI shows it). */
  partial: boolean;
  comboFlagIds: readonly string[];
  /** Prerequisites still missing; enabling is refused while non-empty. */
  missingPrereqs: DcsPreviewPrereq[];
};

export type DcsPreviewSetPayload = {
  enabled: boolean;
  /** When true (default outside E2E), restart gateway so config applies. */
  restartGateway?: boolean;
};

export type DcsPreviewSetResult = {
  success: boolean;
  enabled: boolean;
  status: DcsProdFlagApplyStatus;
  restartedGateway: boolean;
  comboFlagIds: readonly string[];
  missingPrereqs?: DcsPreviewPrereq[];
  ackTrail?: DcsFlagAckState[];
  runtimeAck?: DcsFlagRuntimeAck;
  ackMissingFields?: DcsFlagAckRequiredField[];
  failureReason?: DcsFlagAckFailureReason;
  operatorHintKey?: string;
  gatewayGeneration?: string;
  ackWaitMs?: number;
  error?: string;
};
