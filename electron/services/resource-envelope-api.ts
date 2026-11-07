import type { RuntimeResourceEnvelopeState } from '@shared/host-api/contract';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { getAggregatedResourceEnvelopeSnapshot, type MainEnvelopeOwners } from './resource-envelope';

export function createResourceEnvelopeApi(owners: MainEnvelopeOwners = {}): CompleteHostServiceRegistry['resourceEnvelope'] {
  return {
    getState: async (): Promise<RuntimeResourceEnvelopeState> => {
      const snapshot = await getAggregatedResourceEnvelopeSnapshot(owners);
      return {
        measured: snapshot.entries.length > 0,
        snapshot: snapshot.entries.length > 0 ? snapshot : null,
      };
    },
  };
}
