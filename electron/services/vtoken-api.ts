import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import {
  disposeVtokenBridge,
  vtokenAssemble,
  vtokenClose,
  vtokenEnsureStarted,
  vtokenGetStatus,
  vtokenIngestMarkdown,
  vtokenIngestMemory,
  vtokenIngestPath,
  vtokenIngestTools,
  vtokenOpen,
  vtokenPing,
  vtokenSetEnabled,
  vtokenStats,
} from './vtoken-bridge';

export function createVtokenApi(): CompleteHostServiceRegistry['vtoken'] {
  return {
    ping: () => vtokenPing(),
    open: (payload) => vtokenOpen(payload ?? {}),
    ingestPath: (payload) => vtokenIngestPath(payload),
    ingestMarkdown: (payload) => vtokenIngestMarkdown(payload),
    ingestTools: (payload) => vtokenIngestTools(payload),
    ingestMemory: (payload) => vtokenIngestMemory(payload),
    assemble: (payload) => vtokenAssemble(payload),
    stats: () => vtokenStats(),
    close: () => vtokenClose(),
    getStatus: () => vtokenGetStatus(),
    setEnabled: (payload) => vtokenSetEnabled(payload),
    ensureStarted: () => vtokenEnsureStarted(),
  };
}

export { disposeVtokenBridge };
