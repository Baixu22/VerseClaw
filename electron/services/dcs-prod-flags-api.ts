/**
 * Main-process DCS production flag control plane.
 * Writes AppSettings + openclaw.json runtime paths and injects env into gateway forkEnv.
 */
import type { GatewayManager } from '../gateway/manager';
import { readOpenClawConfig, writeOpenClawConfig } from '../utils/channel-config';
import { withConfigLock } from '../utils/config-mutex';
import * as logger from '../utils/logger';
import {
  getAllSettings,
  setSetting,
  type AppSettings,
} from '../utils/store';
import {
  DCS_PROD_FLAGS,
  DCS_PROD_METRIC_EXPORT,
  type DcsProdFlagEntry,
} from '../../shared/dcs/prod-flags-catalog';
import { getCurrentGatewayGeneration } from '../gateway/generation';
import { collectRuntimeFlagAck, resolveDcsFlagAckTuning } from './dcs-flag-ack';
import {
  asBooleanFlag,
  DCS_PREVIEW_COMBO_FLAG_IDS,
  WORKSPACE_CONTEXT_FLAG_IDS,
  type WorkspaceContextSetPayload,
  type WorkspaceContextSetResult,
  type WorkspaceContextState,
  getConfigPathValue,
  getWritableFlagSpec,
  isWritableFlagId,
  listWritableFlagSpecs,
  setConfigPathValue,
  type DcsPreviewPrereq,
  type DcsPreviewSetPayload,
  type DcsPreviewSetResult,
  type DcsPreviewState,
  type DcsProdFlagApplyStatus,
  type DcsProdFlagAckRequeryResult,
  type DcsProdFlagSetPayload,
  type DcsProdFlagSetResult,
  type DcsProdFlagStateRow,
  type DcsProdFlagsSnapshot,
  type DcsProdObservabilitySnapshot,
  type DcsWritableFlagSpec,
} from '../../shared/dcs/prod-flags-control';
import { buildWorkspaceContextProfile } from '../../shared/dcs/workspace-context-profile';
import { getActiveWorkspaceProfile } from './workspaces-api';
import { listProviderAccounts } from './providers/provider-store';

/**
 * FP-P1-09: ack tuning resolved from AppSettings overrides (0/absent = the
 * measured defaults in dcs-flag-ack.ts).
 */
async function readAckTuning() {
  const settings = await getAllSettings();
  return resolveDcsFlagAckTuning({
    timeoutMs: settings.dcsFlagAckTimeoutMs,
    pollIntervalMs: settings.dcsFlagAckPollInitialMs,
  });
}

/**
 * Wait out a transient `starting` state before deciding whether the gateway is
 * up. A flag write trips config-sync's watcher, which launches its own restart,
 * so the gateway is briefly `starting` right when the DCS control plane checks
 * it. Returns the settled state ('running' once ready, or 'stopped'/'error' if
 * the (re)start failed); gives up after `timeoutMs` and returns whatever state
 * it last saw.
 */
async function waitForGatewaySettled(
  gatewayManager: GatewayManager,
  timeoutMs = 15_000,
): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs;
  let state = gatewayManager.getStatus().state;
  while (state === 'starting' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    state = gatewayManager.getStatus().state;
  }
  return state;
}

/**
 * Restart the gateway but fail closed within the host-action budget. A restart
 * onto an unreadable/broken config leaves the child unable to become ready, and
 * `waitForGatewayReady`'s 90s hard limit outlasts the 60s host-action timeout —
 * so `setFlag`/`setPreview` would hang past the caller's deadline instead of
 * returning an explainable `restart-failed` (FP-P1-05 S6). Bounding it here
 * turns that hang into a prompt, catchable rejection. A successful restart is
 * ~5s, so this ceiling only ever bites a genuinely stuck one.
 */
const DCS_RESTART_BUDGET_MS = 40_000;

async function restartGatewayWithinBudget(gatewayManager: GatewayManager): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`gateway restart did not settle within ${DCS_RESTART_BUDGET_MS}ms`)),
      DCS_RESTART_BUDGET_MS,
    );
  });
  try {
    await Promise.race([gatewayManager.restart(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type OpenClawConfig = Record<string, unknown>;

function storeEnabled(
  settings: AppSettings,
  spec: DcsWritableFlagSpec,
): boolean {
  const key = spec.storeKey as keyof AppSettings;
  const value = settings[key];
  return asBooleanFlag(value, spec.defaultEnabled);
}

async function readConfigEnabled(spec: DcsWritableFlagSpec): Promise<boolean | undefined> {
  if (spec.controlKind !== 'config') return undefined;
  try {
    const config = (await readOpenClawConfig()) as OpenClawConfig;
    const raw = getConfigPathValue(config, spec.targetKey);
    if (raw === undefined) return undefined;
    return asBooleanFlag(raw, spec.defaultEnabled);
  } catch (error) {
    logger.warn('[dcs-prod-flags] read openclaw config failed:', error);
    return undefined;
  }
}

async function writeConfigEnabled(spec: DcsWritableFlagSpec, enabled: boolean): Promise<void> {
  if (spec.controlKind !== 'config') return;
  await withConfigLock(async () => {
    const config = (await readOpenClawConfig()) as OpenClawConfig;
    const next = setConfigPathValue(config, spec.targetKey, enabled);
    await writeOpenClawConfig(next as Parameters<typeof writeOpenClawConfig>[0]);
  });
}

function buildRow(
  entry: DcsProdFlagEntry,
  settings: AppSettings,
  configValues: Map<string, boolean | undefined>,
  gatewayState: string | undefined,
): DcsProdFlagStateRow {
  const spec = getWritableFlagSpec(entry.id);
  if (!spec) {
    return {
      id: entry.id,
      writable: false,
      enabled: asBooleanFlag(entry.defaultValue, false),
      defaultEnabled: asBooleanFlag(entry.defaultValue, false),
      status: entry.risk === 'baseline-on' ? 'applied' : 'read-only',
      message:
        entry.risk === 'baseline-on'
          ? 'Baseline flag (not toggled here)'
          : 'Not writable from Settings (api/request/info only)',
    };
  }

  const fromStore = storeEnabled(settings, spec);
  let enabled = fromStore;
  let status: DcsProdFlagApplyStatus = 'applied';
  let message: string | undefined;

  if (spec.controlKind === 'config') {
    const fromConfig = configValues.get(spec.id);
    if (fromConfig === undefined) {
      // Store says on but config missing — pending until write/sync path runs.
      if (fromStore !== spec.defaultEnabled) {
        status = 'pending-restart';
        message = 'Saved in app settings; openclaw.json path not observed yet';
      }
    } else if (fromConfig !== fromStore) {
      status = 'pending-restart';
      message = 'App setting and openclaw.json disagree; restart gateway after save';
      enabled = fromStore;
    } else {
      enabled = fromConfig;
    }
  }

  if (status === 'applied' && gatewayState && gatewayState !== 'running' && fromStore) {
    status = 'pending-restart';
    message = message ?? 'Gateway not running; flag will apply on next start';
  }

  return {
    id: entry.id,
    writable: true,
    enabled,
    defaultEnabled: spec.defaultEnabled,
    status,
    controlKind: spec.controlKind,
    targetKey: spec.targetKey,
    storeKey: spec.storeKey,
    message,
  };
}

export async function getDcsProdFlagsSnapshot(
  gatewayManager?: GatewayManager,
): Promise<DcsProdFlagsSnapshot> {
  const settings = await getAllSettings();
  const gatewayState = gatewayManager?.getStatus()?.state;
  const configValues = new Map<string, boolean | undefined>();
  for (const spec of listWritableFlagSpecs()) {
    if (spec.controlKind === 'config') {
      configValues.set(spec.id, await readConfigEnabled(spec));
    }
  }

  const flags = DCS_PROD_FLAGS.map((entry) =>
    buildRow(entry, settings, configValues, gatewayState),
  );

  const observability = buildDcsProdObservability(flags);

  return {
    productionMode: 'opt-in',
    flags,
    gatewayState,
    updatedAt: new Date().toISOString(),
    observability,
  };
}

function envTruthy(raw: string | undefined): boolean {
  if (raw == null || raw.trim() === '') return false;
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function buildDcsProdObservability(
  flags: DcsProdFlagStateRow[],
): DcsProdObservabilitySnapshot {
  const enabledWritableFlagIds = flags
    .filter((f) => f.writable && f.enabled)
    .map((f) => f.id);
  return {
    schema: 'dcs-prod-observability/v1',
    killSwitchEngaged: envTruthy(process.env.VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH),
    killSwitchEnv: 'VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH',
    viewToolsEnvEngaged:
      envTruthy(process.env.OPENCLAW_DCS_CONTEXT_VIEW_TOOLS) ||
      envTruthy(process.env.OPENCLAW_DCS_CONTEXT_TOOLS),
    enabledWritableFlagIds,
    metricKeys: {
      writeSide: [...DCS_PROD_METRIC_EXPORT.writeSide],
      waveSide: [...DCS_PROD_METRIC_EXPORT.waveSide],
      shadowSide: [
        ...DCS_PROD_METRIC_EXPORT.shadowSide,
        'dcs.injection.budgetOverflows',
        'dcs.injection.budgetTruncations',
        'dcs.injection.budgetDrops',
      ],
      budgetSide: [
        'dcs.injection.budgetOverflows',
        'dcs.injection.budgetTruncations',
        'dcs.injection.budgetDrops',
        'dcs.injection.duplicateSuppressions',
      ],
    },
    sources: [...DCS_PROD_METRIC_EXPORT.sources],
    note:
      'Gateway in-process counters (codingObservability/dcsObservability) are not mirrored into Electron. This panel shows kill state, enabled opt-in flags, and the metric key catalog to scrape from runtime logs/exports.',
  };
}

export async function setDcsProdFlag(
  payload: DcsProdFlagSetPayload,
  gatewayManager: GatewayManager,
): Promise<DcsProdFlagSetResult> {
  const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
  if (!id || !isWritableFlagId(id)) {
    return {
      success: false,
      id: id || 'unknown',
      enabled: false,
      status: 'unsupported',
      restartedGateway: false,
      error: `Flag not writable from Settings: ${id || '(missing id)'}`,
    };
  }

  const enabled = Boolean(payload.enabled);
  // Default: restart gateway in product so env/config-sync apply.
  // E2E skips auto-restart (gateway is not auto-started); pass restartGateway:true to force.
  const restartGateway =
    typeof payload.restartGateway === 'boolean'
      ? payload.restartGateway
      : process.env.VERSE_CLAW_E2E !== '1';
  const spec = getWritableFlagSpec(id)!;
  if (spec.unavailableReason) {
    return {
      success: false,
      id,
      enabled,
      status: 'unsupported',
      restartedGateway: false,
      error: `Flag unavailable from Settings: ${spec.unavailableReason}`,
    };
  }

  try {
    await setSetting(spec.storeKey as keyof AppSettings, enabled as never);

    if (spec.controlKind === 'config') {
      await writeConfigEnabled(spec, enabled);
    }

    // Also mirror process.env for the Electron main process (diagnostics only).
    // Gateway children pick env up via applyDcsProdFlagsToGatewayEnv on next launch.
    if (spec.controlKind === 'env') {
      if (enabled) {
        process.env[spec.targetKey] = '1';
        if (spec.envAlias) process.env[spec.envAlias] = '1';
      } else {
        delete process.env[spec.targetKey];
        if (spec.envAlias) delete process.env[spec.envAlias];
      }
    }

    // FP-P0-04: the write only reaches `saved`. Everything past that has to be
    // proven by the child, so restart() resolving is no longer sufficient.
    // The write above trips config-sync's watcher into its own restart, so let
    // that transient `starting` settle before deciding — otherwise this guard
    // bails to `pending-restart` mid-reload and never collects the ack.
    let restartedGateway = false;
    const settledState = restartGateway
      ? await waitForGatewaySettled(gatewayManager)
      : gatewayManager.getStatus().state;
    if (!restartGateway || settledState !== 'running') {
      return {
        success: true,
        id,
        enabled,
        status: 'pending-restart',
        restartedGateway: false,
        ackTrail: ['saved', 'pending-restart'],
        failureReason: 'gateway-not-running',
        operatorHintKey: 'developer.dcsProdFlags.ackHint.gatewayNotRunning',
      };
    }

    try {
      await restartGatewayWithinBudget(gatewayManager);
      restartedGateway = true;
    } catch (error) {
      logger.warn('[dcs-prod-flags] gateway restart failed after flag set:', error);
      return {
        success: true,
        id,
        enabled,
        status: 'pending-restart',
        restartedGateway: false,
        ackTrail: ['saved', 'pending-restart'],
        failureReason: 'restart-failed',
        operatorHintKey: 'developer.dcsProdFlags.ackHint.restartFailed',
        error: `Saved but gateway restart failed: ${String(error)}`,
      };
    }

    const expectedGeneration = getCurrentGatewayGeneration();
    const tuning = await readAckTuning();
    const ackStartedAt = Date.now();
    const outcome = await collectRuntimeFlagAck({
      expectedGeneration: () => expectedGeneration,
      isRunning: () => gatewayManager.getStatus().state === 'running',
      requestAck: async () =>
        await gatewayManager.rpc('runtime.flags.ack', {
          requestedFlags: { [spec.targetKey]: enabled },
        }),
      ...tuning,
    });
    const ackWaitMs = Date.now() - ackStartedAt;

    return {
      success: true,
      id,
      enabled,
      status: outcome.state,
      restartedGateway,
      ackTrail: outcome.trail,
      gatewayGeneration: expectedGeneration,
      ackWaitMs,
      ...(outcome.ack ? { runtimeAck: outcome.ack } : {}),
      ...(outcome.missingFields ? { ackMissingFields: outcome.missingFields } : {}),
      ...(outcome.failureReason ? { failureReason: outcome.failureReason } : {}),
      ...(outcome.operatorHintKey ? { operatorHintKey: outcome.operatorHintKey } : {}),
    };
  } catch (error) {
    logger.error('[dcs-prod-flags] set failed:', error);
    return {
      success: false,
      id,
      enabled,
      status: 'error',
      restartedGateway: false,
      error: String(error),
    };
  }
}

/**
 * Merge UI-controlled DCS flags into gateway forkEnv.
 * Explicit process.env kill values still win when set to disable.
 */
export { applyDcsProdFlagsToGatewayEnv } from '../utils/dcs-prod-flags-env';

/**
 * FP-P1-09: re-query the current child's ack without saving anything and
 * without restarting. Recovery path for `ack-timeout` on slow starts: the flag
 * write already happened; only the confirmation was outstanding.
 */
export async function requeryDcsFlagAck(
  gatewayManager: GatewayManager,
): Promise<DcsProdFlagAckRequeryResult> {
  try {
    const expectedGeneration = getCurrentGatewayGeneration();
    const tuning = await readAckTuning();
    const ackStartedAt = Date.now();
    const outcome = await collectRuntimeFlagAck({
      expectedGeneration: () => expectedGeneration,
      isRunning: () => gatewayManager.getStatus().state === 'running',
      requestAck: async () => await gatewayManager.rpc('runtime.flags.ack', {}),
      ...tuning,
    });
    return {
      success: true,
      status: outcome.state,
      ackTrail: outcome.trail,
      gatewayGeneration: expectedGeneration,
      ackWaitMs: Date.now() - ackStartedAt,
      ...(outcome.ack ? { runtimeAck: outcome.ack } : {}),
      ...(outcome.missingFields ? { ackMissingFields: outcome.missingFields } : {}),
      ...(outcome.failureReason ? { failureReason: outcome.failureReason } : {}),
      ...(outcome.operatorHintKey ? { operatorHintKey: outcome.operatorHintKey } : {}),
    };
  } catch (error) {
    logger.error('[dcs-prod-flags] ack requery failed:', error);
    return { success: false, status: 'error', error: String(error) };
  }
}

/**
 * FP-P1-03: prerequisites for enabling the DCS Coding Preview combo.
 * Enabling is refused (not just discouraged) while any is missing.
 */
export async function resolveDcsPreviewPrereqs(): Promise<DcsPreviewPrereq[]> {
  const missing: DcsPreviewPrereq[] = [];
  const settings = await getAllSettings();
  const verifiedViaSetup = settings.setupProviderVerification?.status === 'verified';
  let verifiedViaAccount = false;
  if (!verifiedViaSetup) {
    try {
      const accounts = await listProviderAccounts();
      verifiedViaAccount = accounts.some(
        (account) => account.metadata?.validation?.status === 'valid',
      );
    } catch {
      verifiedViaAccount = false;
    }
  }
  if (!verifiedViaSetup && !verifiedViaAccount) missing.push('providerVerified');
  const workspace = await getActiveWorkspaceProfile();
  // The auto-created `default` profile (~/.openclaw/workspace) is not a user
  // choice — "workspace selected" means the user explicitly picked one
  // (Setup workspace step or workspaces UI), which also fixes the permission.
  const explicitlyChosen = Boolean(workspace?.rootPath) && workspace!.id !== 'default';
  if (!explicitlyChosen) {
    missing.push('workspaceSelected', 'permissionChosen');
  }
  // With an explicitly chosen workspace, permissionMode is always resolved
  // (readOnly-safe normalization) — the choice happened at workspace creation.
  return missing;
}

function previewComboSpecs(): DcsWritableFlagSpec[] {
  return DCS_PREVIEW_COMBO_FLAG_IDS.map((id) => getWritableFlagSpec(id)).filter(
    (spec): spec is DcsWritableFlagSpec => Boolean(spec),
  );
}

/** FP-P1-03: store-level view of the preview combo + prerequisites. */
export async function getDcsPreviewState(): Promise<DcsPreviewState> {
  const settings = await getAllSettings();
  const specs = previewComboSpecs();
  const enabledFlags = specs.map((spec) => storeEnabled(settings, spec));
  const enabled = enabledFlags.length > 0 && enabledFlags.every(Boolean);
  const partial = !enabled && enabledFlags.some(Boolean);
  return {
    enabled,
    partial,
    comboFlagIds: DCS_PREVIEW_COMBO_FLAG_IDS,
    missingPrereqs: await resolveDcsPreviewPrereqs(),
  };
}

/**
 * FP-P1-03: flip the whole preview combo with ONE restart and ONE child ack
 * covering every combo flag. `applied` still only comes from a complete
 * current-generation acknowledgement (FP-P0-04 semantics unchanged).
 */
type ComboFlagSetParams = {
  ids: readonly string[];
  specs: readonly DcsWritableFlagSpec[];
  enabled: boolean;
  restartGateway: boolean;
  gatewayManager: GatewayManager;
  logTag: string;
};

/** Apply a declared combo with one save/restart/ack sequence. */
async function setComboFlags(params: ComboFlagSetParams): Promise<WorkspaceContextSetResult> {
  const { ids, specs, enabled, restartGateway, gatewayManager, logTag } = params;
  try {
    for (const spec of specs) {
      await setSetting(spec.storeKey as keyof AppSettings, enabled as never);
      if (spec.controlKind === 'config') await writeConfigEnabled(spec, enabled);
      if (spec.controlKind === 'env') {
        if (enabled) {
          process.env[spec.targetKey] = '1';
          if (spec.envAlias) process.env[spec.envAlias] = '1';
        } else {
          delete process.env[spec.targetKey];
          if (spec.envAlias) delete process.env[spec.envAlias];
        }
      }
    }

    let restartedGateway = false;
    const settledState = restartGateway
      ? await waitForGatewaySettled(gatewayManager)
      : gatewayManager.getStatus().state;
    if (!restartGateway || settledState !== 'running') {
      return {
        success: true,
        enabled,
        status: 'pending-restart',
        restartedGateway: false,
        comboFlagIds: ids,
        ackTrail: ['saved', 'pending-restart'],
        failureReason: 'gateway-not-running',
        operatorHintKey: 'developer.dcsProdFlags.ackHint.gatewayNotRunning',
      };
    }

    try {
      await restartGatewayWithinBudget(gatewayManager);
      restartedGateway = true;
    } catch (error) {
      logger.warn(`[${logTag}] gateway restart failed after combo set:`, error);
      return {
        success: true,
        enabled,
        status: 'pending-restart',
        restartedGateway: false,
        comboFlagIds: ids,
        ackTrail: ['saved', 'pending-restart'],
        failureReason: 'restart-failed',
        operatorHintKey: 'developer.dcsProdFlags.ackHint.restartFailed',
        error: `Saved but gateway restart failed: ${String(error)}`,
      };
    }

    const expectedGeneration = getCurrentGatewayGeneration();
    const tuning = await readAckTuning();
    const requestedFlags = Object.fromEntries(specs.map((spec) => [spec.targetKey, enabled]));
    const ackStartedAt = Date.now();
    const outcome = await collectRuntimeFlagAck({
      expectedGeneration: () => expectedGeneration,
      isRunning: () => gatewayManager.getStatus().state === 'running',
      requestAck: async () => await gatewayManager.rpc('runtime.flags.ack', { requestedFlags }),
      ...tuning,
    });
    return {
      success: true,
      enabled,
      status: outcome.state,
      restartedGateway,
      comboFlagIds: ids,
      ackTrail: outcome.trail,
      gatewayGeneration: expectedGeneration,
      ackWaitMs: Date.now() - ackStartedAt,
      ...(outcome.ack ? { runtimeAck: outcome.ack } : {}),
      ...(outcome.missingFields ? { ackMissingFields: outcome.missingFields } : {}),
      ...(outcome.failureReason ? { failureReason: outcome.failureReason } : {}),
      ...(outcome.operatorHintKey ? { operatorHintKey: outcome.operatorHintKey } : {}),
    };
  } catch (error) {
    logger.error(`[${logTag}] combo set failed:`, error);
    return {
      success: false,
      enabled,
      status: 'error',
      restartedGateway: false,
      comboFlagIds: ids,
      error: String(error),
    };
  }
}

/** FP-P1-03: legacy developer preview combo. */
export async function setDcsPreview(
  payload: DcsPreviewSetPayload,
  gatewayManager: GatewayManager,
): Promise<DcsPreviewSetResult> {
  const enabled = Boolean(payload?.enabled);
  const restartGateway = typeof payload?.restartGateway === 'boolean'
    ? payload.restartGateway
    : process.env.VERSE_CLAW_E2E !== '1';
  if (enabled) {
    const missing = await resolveDcsPreviewPrereqs();
    if (missing.length > 0) {
      return {
        success: false,
        enabled: false,
        status: 'error',
        restartedGateway: false,
        comboFlagIds: DCS_PREVIEW_COMBO_FLAG_IDS,
        missingPrereqs: missing,
        error: `Preview prerequisites missing: ${missing.join(', ')}`,
      };
    }
  }
  return await setComboFlags({
    ids: DCS_PREVIEW_COMBO_FLAG_IDS,
    specs: previewComboSpecs(),
    enabled,
    restartGateway,
    gatewayManager,
    logTag: 'dcs-preview',
  });
}

function workspaceContextSpecs(): DcsWritableFlagSpec[] {
  return WORKSPACE_CONTEXT_FLAG_IDS.map((id) => getWritableFlagSpec(id)).filter(
    (spec): spec is DcsWritableFlagSpec => Boolean(spec),
  );
}

/** One user-level Workspace Context switch over recent actions + tool catalog. */
export async function getWorkspaceContextState(
  gatewayManager: GatewayManager,
): Promise<WorkspaceContextState> {
  const snapshot = await getDcsProdFlagsSnapshot(gatewayManager);
  const flagIds = new Set<string>(WORKSPACE_CONTEXT_FLAG_IDS);
  const flags = snapshot.flags.filter((flag) => flagIds.has(flag.id));
  const enabledCount = flags.filter((flag) => flag.enabled).length;
  const enabled = flags.length === WORKSPACE_CONTEXT_FLAG_IDS.length && enabledCount === flags.length;
  const partial = !enabled && enabledCount > 0;
  const profile = buildWorkspaceContextProfile({
    enabled,
    partial,
    comboFlagIds: WORKSPACE_CONTEXT_FLAG_IDS,
    flags,
    modelSummary: '',
  });
  return {
    enabled,
    partial,
    comboFlagIds: WORKSPACE_CONTEXT_FLAG_IDS,
    flags,
    modelSummary: profile.modelSummary,
  };
}

export async function setWorkspaceContext(
  payload: WorkspaceContextSetPayload,
  gatewayManager: GatewayManager,
): Promise<WorkspaceContextSetResult> {
  const enabled = Boolean(payload?.enabled);
  const restartGateway = typeof payload?.restartGateway === 'boolean'
    ? payload.restartGateway
    : process.env.VERSE_CLAW_E2E !== '1';
  return await setComboFlags({
    ids: WORKSPACE_CONTEXT_FLAG_IDS,
    specs: workspaceContextSpecs(),
    enabled,
    restartGateway,
    gatewayManager,
    logTag: 'workspace-context',
  });
}


export function createDcsProdFlagsApi(gatewayManager: GatewayManager) {
  return {
    getFlags: () => getDcsProdFlagsSnapshot(gatewayManager),
    setFlag: (payload: DcsProdFlagSetPayload) => setDcsProdFlag(payload, gatewayManager),
    requeryAck: () => requeryDcsFlagAck(gatewayManager),
    getPreview: () => getDcsPreviewState(),
    setPreview: (payload: DcsPreviewSetPayload) => setDcsPreview(payload, gatewayManager),
    getWorkspaceContext: () => getWorkspaceContextState(gatewayManager),
    setWorkspaceContext: (payload: WorkspaceContextSetPayload) => setWorkspaceContext(payload, gatewayManager),
  };
}
