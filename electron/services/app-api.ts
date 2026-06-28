import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { app } from 'electron';
import { runOpenClawDoctor, runOpenClawDoctorFix } from '../utils/openclaw-doctor';
import { isRecord } from './payload-utils';
import { buildSandboxStatus } from './sandbox-api';

type OpenClawDoctorPayload = {
  mode?: unknown;
};

export function createAppApi(): CompleteHostServiceRegistry['app'] {
  return {
    version: () => app.getVersion(),
    openClawDoctor: async (payload) => {
      const body = isRecord(payload) ? payload as OpenClawDoctorPayload : {};
      const result = body.mode === 'fix' ? await runOpenClawDoctorFix() : await runOpenClawDoctor();
      try {
        return { ...result, sandbox: await buildSandboxStatus() };
      } catch {
        return result;
      }
    },
  };
}
