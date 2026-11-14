import { resolve } from 'node:path';

/** The test harness may stage a medium-integrity copy of its Electron runtime. */
export function resolveE2EElectronExecutable(
  defaultPath: string,
  explicitPath?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (explicitPath) return explicitPath;
  const stagedPath = env.CLAWX_E2E_EXECUTABLE_PATH?.trim();
  return stagedPath ? resolve(stagedPath) : defaultPath;
}
