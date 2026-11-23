import { AsyncLocalStorage } from "node:async_hooks";

type Verification = (result: unknown) => Promise<unknown>;
const verificationQueue = new AsyncLocalStorage<Verification[]>();

/** Queue trusted write verification until Task and checkout mutation receipts settle. */
export function deferWriteVerification(verify: Verification): boolean {
  const queue = verificationQueue.getStore();
  if (!queue) return false;
  queue.push(verify);
  return true;
}

export async function withDeferredWriteVerification<T>(execute: () => Promise<T>): Promise<T> {
  const queue: Verification[] = [];
  let result: unknown = await verificationQueue.run(queue, execute);
  for (const verify of queue) result = await verify(result);
  return result as T;
}
