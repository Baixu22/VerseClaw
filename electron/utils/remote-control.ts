import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { App } from 'electron';
import type { AppSettings } from './store';

const DEFAULT_CDP_PORT = 9222;

let launchPort: number | null = null;
let launchEnvOverride = false;

function parsePort(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65535) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) return parsed;
  }
  return null;
}

function readPersistedRemoteControlSettings(app: App): Partial<AppSettings> {
  try {
    const settingsPath = join(app.getPath('userData'), 'settings.json');
    if (!existsSync(settingsPath)) return {};
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8')) as Partial<AppSettings>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function resolveRemoteDebuggingLaunchPort(app: App): number | null {
  const envPort = parsePort(process.env.VERSE_CLAW_REMOTE_DEBUGGING_PORT);
  if (envPort) {
    launchPort = envPort;
    launchEnvOverride = true;
    return envPort;
  }

  const settings = readPersistedRemoteControlSettings(app);
  if (settings.cdpRemoteControlEnabled !== true) {
    launchPort = null;
    launchEnvOverride = false;
    return null;
  }

  const settingsPort = parsePort(settings.cdpRemoteDebuggingPort) ?? DEFAULT_CDP_PORT;
  launchPort = settingsPort;
  launchEnvOverride = false;
  return settingsPort;
}

export function getRemoteControlLaunchState() {
  return {
    effectivePort: launchPort,
    effectiveEnabled: launchPort != null,
    envOverride: launchEnvOverride,
    endpoint: launchPort == null ? null : `http://127.0.0.1:${launchPort}/json/version`,
  };
}

export function normalizeRemoteDebuggingPort(value: unknown): number {
  return parsePort(value) ?? DEFAULT_CDP_PORT;
}
