---
title: shared/resources/singleflight.ts
revision: 1
status: active
trust: confirmed
verifiedAt: "2026-11-10T05:05:56.255Z"
acl:
  read: [operator]
scope:
  workspaceId: rag-corpus-workspace
retention:
  policy: source-coupled
actor: codex/project-rag-corpus-author
driven_by: agent
---

# Repository source snapshot

Origin: shared/resources/singleflight.ts
Commit: 1a4cc531ee050794b89dc8d7e49ac7c7a1c71ec0

~~~typescript
import { checkResourceWait, watchResourceWait, type ResourceWaitOptions } from './wait.js';

type Subscriber<V> = { finish: (result: PromiseSettledResult<V>) => void };
type Flight<V> = {
  promise: Promise<V>;
  controller: AbortController;
  subscribers: Set<Subscriber<V>>;
  unscoped: boolean;
};

/** Coalesce work while each scoped subscriber owns its cancellation/deadline. */
export class Singleflight<K, V> {
  private readonly inFlight = new Map<K, Flight<V>>();

  run(key: K, work: (signal: AbortSignal) => Promise<V>, options?: ResourceWaitOptions & { expired?: () => Error }): Promise<V> {
    try { checkResourceWait(options ?? {}, options?.expired); } catch (error) { return Promise.reject(error); }
    let flight = this.inFlight.get(key);
    if (!flight || flight.controller.signal.aborted) {
      const controller = new AbortController();
      const subscribers = new Set<Subscriber<V>>();
      const finish = (result: PromiseSettledResult<V>) => {
        // Abandoned work may settle after a replacement flight has started.
        if (this.inFlight.get(key) === flight) this.inFlight.delete(key);
        for (const subscriber of subscribers) subscriber.finish(result);
        subscribers.clear();
      };
      const promise = Promise.resolve().then(() => {
        checkResourceWait({ signal: controller.signal });
        return work(controller.signal);
      }).then(value => { finish({ status: 'fulfilled', value }); return value; }, reason => { finish({ status: 'rejected', reason }); throw reason; });
      // All subscribers may leave before the execution owner settles.
      void promise.catch(() => {});
      flight = { promise, controller, subscribers, unscoped: false };
      this.inFlight.set(key, flight);
    }
    const current = flight;
    if (current.controller.signal.aborted) return Promise.reject(current.controller.signal.reason);
    if (!options) { current.unscoped = true; return current.promise; }
    return new Promise<V>((resolve, reject) => {
      let settled = false;
      let cleanup = () => {};
      const subscriber: Subscriber<V> = { finish: result => {
        if (settled) return;
        settled = true;
        cleanup();
        current.subscribers.delete(subscriber);
        try { checkResourceWait(options, options.expired); } catch (reason) { result = { status: 'rejected', reason }; }
        if (result.status === 'rejected') reject(result.reason); else resolve(result.value);
      } };
      current.subscribers.add(subscriber);
      cleanup = watchResourceWait(options, error => {
        subscriber.finish({ status: 'rejected', reason: error });
        if (!current.unscoped && current.subscribers.size === 0) current.controller.abort(error);
      }, options.expired);
      if (settled) cleanup();
    });
  }

  get size(): number {
    return this.inFlight.size;
  }
}

~~~
