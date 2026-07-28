/**
 * Pure env merge for DCS Settings-controlled flags (no GatewayManager import).
 * Used by config-sync prelaunch to avoid circular deps.
 */
import type { AppSettings } from '../utils/store';
import {
  asBooleanFlag,
  DCS_WRITABLE_FLAG_SPECS,
  type DcsWritableFlagSpec,
} from '../../shared/dcs/prod-flags-control';

function storeEnabled(settings: AppSettings, spec: DcsWritableFlagSpec): boolean {
  const key = spec.storeKey as keyof AppSettings;
  const value = settings[key];
  return asBooleanFlag(value, spec.defaultEnabled);
}

/**
 * Merge UI-controlled DCS env flags into gateway forkEnv.
 * Explicit process.env kill (0/false/off) always wins.
 */
export function applyDcsProdFlagsToGatewayEnv(
  env: Record<string, string | undefined>,
  settings: AppSettings,
): Record<string, string | undefined> {
  const next = { ...env };

  for (const spec of DCS_WRITABLE_FLAG_SPECS) {
    if (spec.controlKind !== 'env') continue;
    const enabled = storeEnabled(settings, spec);
    const existing = (next[spec.targetKey] ?? process.env[spec.targetKey] ?? '')
      .trim()
      .toLowerCase();
    if (existing === '0' || existing === 'false' || existing === 'no' || existing === 'off') {
      next[spec.targetKey] = '0';
      if (spec.envAlias) next[spec.envAlias] = '0';
      continue;
    }
    if (enabled) {
      next[spec.targetKey] = '1';
      if (spec.envAlias) next[spec.envAlias] = '1';
    } else {
      delete next[spec.targetKey];
      if (spec.envAlias) delete next[spec.envAlias];
    }
  }

  return next;
}
