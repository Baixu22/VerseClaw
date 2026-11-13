import { resolve } from 'node:path';

/** The test harness may stage a medium-integrity copy of its Electron runtime. */
export function resolveE2EElectronExecutable(explicitPath, env = process.env) {
  if (explicitPath) return explicitPath;
  const stagedPath = env.CLAWX_E2E_EXECUTABLE_PATH?.trim();
  return stagedPath ? resolve(stagedPath) : env.CLAWX_E2E_DEFAULT_EXECUTABLE;
}
