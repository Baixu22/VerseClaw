import type { ScopedRunId } from './types/identity-scope.js';

/** Correlation owned by WorktreeService; task/session/permission authority is checked separately. */
export type CheckoutWriterIdentity =
  | { kind: 'run'; run: ScopedRunId; agentId: string; sessionGeneration: string; bindingRevision: number;
      task?: { authorityId: string; taskNodeId: string; epoch: number; contractRevision: number } }
  | { kind: 'maintenance'; operation: 'merge' | 'freeze' | 'cleanup'; operationId: string };
export type CheckoutWriterBasis = { root: string; incarnation: string; generation: string };
export type CheckoutWriterCredential = CheckoutWriterBasis & { epoch: number; token: string; owner: CheckoutWriterIdentity };
export type CheckoutWriteReceipt = { outcome: 'completed' | 'not-applied'; ownerReceipt: string };
export type CheckoutWriterTerminalReceipt = { runId: string; sessionGeneration: string; endedAt: number; ownerReceipt: string };
