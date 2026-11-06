import { AsyncLocalStorage } from 'node:async_hooks';

/** Callbacks keep physical dispatch and refusal attached to the existing spend owner. */
export type ProviderSpendWireTicket = { markSent(): void; rejectBeforeSend(): void };
const spendContext = new AsyncLocalStorage<() => ProviderSpendWireTicket>();
export function runWithProviderSpend<T>(beforeWire: () => ProviderSpendWireTicket, run: () => T): T {
  return spendContext.run(beforeWire, run);
}
export function admitProviderSpendWireAttempt(): ProviderSpendWireTicket | undefined {
  return spendContext.getStore()?.();
}
