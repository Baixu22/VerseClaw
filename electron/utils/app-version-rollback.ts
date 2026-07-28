import { app } from 'electron';
import { join } from 'path';
import { readJsonAtomic, writeJsonAtomic } from './atomic-write';
import { readOpenClawConfig, writeOpenClawConfig } from './channel-config';
import { withConfigLock } from './config-mutex';
import * as logger from './logger';
import { setSetting, type AppSettings } from './store';
import {
  DCS_WRITABLE_FLAG_SPECS,
  setConfigPathValue,
} from '../../shared/dcs/prod-flags-control';

export const APP_VERSION_STATE_SCHEMA = 'verse-claw-app-version-state/1' as const;
export const APP_VERSION_STATE_FILE = 'app-version-state.json';

export type AppVersionState = {
  schema: typeof APP_VERSION_STATE_SCHEMA;
  lastStartedVersion: string;
  updatedAt: string;
  lastDowngrade?: {
    fromVersion: string;
    toVersion: string;
    forcedOffFlagIds: string[];
    occurredAt: string;
  };
};

type ParsedVersion = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
};

function parseVersion(raw: string | null | undefined): ParsedVersion | null {
  const match = raw?.trim().match(
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/,
  );
  if (!match) return null;
  return {
    major: Number.parseInt(match[1]!, 10),
    minor: Number.parseInt(match[2]!, 10),
    patch: Number.parseInt(match[3]!, 10),
    prerelease: match[4]?.split('.').filter(Boolean) ?? [],
  };
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 && right.length > 0) return 1;
  if (left.length > 0 && right.length === 0) return -1;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === b) continue;
    const aNumber = /^\d+$/.test(a) ? Number.parseInt(a, 10) : null;
    const bNumber = /^\d+$/.test(b) ? Number.parseInt(b, 10) : null;
    if (aNumber !== null && bNumber !== null) return aNumber < bNumber ? -1 : 1;
    if (aNumber !== null) return -1;
    if (bNumber !== null) return 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

export function compareAppVersions(
  left: string | null | undefined,
  right: string | null | undefined,
): number | null {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  return comparePrerelease(a.prerelease, b.prerelease);
}

export function forceDcsConfigOff(
  config: Record<string, unknown>,
): Record<string, unknown> {
  let next = { ...config };
  for (const spec of DCS_WRITABLE_FLAG_SPECS) {
    if (spec.controlKind === 'config') {
      next = setConfigPathValue(next, spec.targetKey, false);
    }
  }
  return next;
}

async function readState(path: string): Promise<AppVersionState | null> {
  try {
    const result = await readJsonAtomic<AppVersionState | null>(path, { fallback: null });
    return result.data?.schema === APP_VERSION_STATE_SCHEMA ? result.data : null;
  } catch (error) {
    logger.warn('Failed to read app version state; treating this launch as unversioned:', error);
    return null;
  }
}

/**
 * FP-P1-05: an older app binary may keep ordinary user data, but preview flags
 * must fail closed before any gateway child can launch.
 */
export async function reconcileAppVersionRollback(): Promise<{
  downgraded: boolean;
  previousVersion?: string;
  currentVersion: string;
  forcedOffFlagIds: string[];
}> {
  const currentVersion = app.getVersion();
  const statePath = join(app.getPath('userData'), APP_VERSION_STATE_FILE);
  const previousState = await readState(statePath);
  const previousVersion = previousState?.lastStartedVersion;
  const downgraded = compareAppVersions(previousVersion, currentVersion) === 1;
  const forcedOffFlagIds = downgraded
    ? DCS_WRITABLE_FLAG_SPECS.map((spec) => spec.id)
    : [];

  if (downgraded) {
    for (const spec of DCS_WRITABLE_FLAG_SPECS) {
      await setSetting(spec.storeKey as keyof AppSettings, false as never);
      if (spec.controlKind === 'env') {
        process.env[spec.targetKey] = '0';
        if (spec.envAlias) process.env[spec.envAlias] = '0';
      }
    }

    await withConfigLock(async () => {
      const config = await readOpenClawConfig() as Record<string, unknown>;
      await writeOpenClawConfig(forceDcsConfigOff(config));
    });

    logger.warn(
      `[app-version-rollback] detected ${previousVersion} -> ${currentVersion}; `
      + `forced off ${forcedOffFlagIds.join(', ')}`,
    );
  }

  const now = new Date().toISOString();
  const nextState: AppVersionState = {
    schema: APP_VERSION_STATE_SCHEMA,
    lastStartedVersion: currentVersion,
    updatedAt: now,
    ...(downgraded && previousVersion
      ? {
          lastDowngrade: {
            fromVersion: previousVersion,
            toVersion: currentVersion,
            forcedOffFlagIds,
            occurredAt: now,
          },
        }
      : previousState?.lastDowngrade
        ? { lastDowngrade: previousState.lastDowngrade }
        : {}),
  };
  await writeJsonAtomic(statePath, nextState);

  return {
    downgraded,
    ...(previousVersion ? { previousVersion } : {}),
    currentVersion,
    forcedOffFlagIds,
  };
}
