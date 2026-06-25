import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { getOpenClawCliCommand } from '../utils/openclaw-cli';
import { ensureDir, getOpenClawSkillsDir, getOpenClawStatus, isOpenClawRuntimeEnabled } from '../utils/paths';
import { existsSync } from 'node:fs';

export function createOpenClawApi(): CompleteHostServiceRegistry['openclaw'] {
  return {
    status: () => getOpenClawStatus(),
    getSkillsDir: () => {
      const dir = getOpenClawSkillsDir();
      ensureDir(dir);
      return dir;
    },
    getCliCommand: () => {
      const status = getOpenClawStatus();
      if (!status.packageExists) {
        return { success: false, error: `OpenClaw package not found at: ${status.dir}` };
      }
      if (!existsSync(status.entryPath)) {
        return { success: false, error: `OpenClaw entry script not found at: ${status.entryPath}` };
      }
      return { success: true, command: getOpenClawCliCommand() };
    },
    runtimeFlags: () => {
      const sourceRuntime = isOpenClawRuntimeEnabled();
      return {
        runtimeMode: sourceRuntime ? 'source' : 'npm',
        mockProviderEnabled: process.env.OPENCLAW_TEST_ENABLE_MOCK_PROVIDER === '1'
          && typeof process.env.VERSE_CLAW_USER_DATA_DIR === 'string'
          && process.env.VERSE_CLAW_USER_DATA_DIR.trim().length > 0
          && process.env.VERSE_CLAW_OPENCLAW_RUNTIME === 'source',
      };
    },
  };
}
