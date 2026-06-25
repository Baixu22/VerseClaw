// Shared Vitest environment helpers for runtime tests.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME_ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "OPENCLAW_HOME",
  "OPENCLAW_STATE_DIR",
  "OPENCLAW_TEST_HOME",
] as const;

type EnvKey = typeof HOME_ENV_KEYS[number];

type EnvSnapshot = Record<EnvKey, string | undefined>;

export type IsolatedTestHome = {
  cleanup: () => void;
  tempHome: string;
};

function snapshotEnv(): EnvSnapshot {
  const snapshot = {} as EnvSnapshot;
  for (const key of HOME_ENV_KEYS) {
    snapshot[key] = process.env[key];
  }
  return snapshot;
}

function restoreEnv(snapshot: EnvSnapshot): void {
  for (const key of HOME_ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function setWindowsHomeParts(home: string): void {
  if (process.platform !== "win32") {
    return;
  }
  const match = home.match(/^([A-Za-z]:)(.*)$/);
  if (!match) {
    return;
  }
  process.env.HOMEDRIVE = match[1];
  process.env.HOMEPATH = match[2] || "\\";
}

export function withIsolatedTestHome(_options?: { loadProfileEnv?: boolean }): IsolatedTestHome {
  const snapshot = snapshotEnv();
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-vitest-home-"));
  const stateDir = path.join(tempHome, ".openclaw");
  fs.mkdirSync(path.join(stateDir, "agents", "main", "sessions"), { recursive: true });

  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  process.env.OPENCLAW_TEST_HOME = tempHome;
  delete process.env.OPENCLAW_HOME;
  process.env.OPENCLAW_STATE_DIR = stateDir;
  setWindowsHomeParts(tempHome);

  let cleaned = false;
  return {
    tempHome,
    cleanup: () => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      restoreEnv(snapshot);
      fs.rmSync(tempHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    },
  };
}

export function installTestEnv(options?: { loadProfileEnv?: boolean }): IsolatedTestHome {
  return withIsolatedTestHome(options);
}
