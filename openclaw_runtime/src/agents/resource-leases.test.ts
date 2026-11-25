/**
 * Acceptance tests for the workspace resource lease kernel (issue #167).
 *
 * Covers the workspace-level budget that lanes and per-agent fan-out limits do
 * not provide: search/exec capacity, path-scoped mutation serialization, cross
 * workspace isolation, idempotent release, and timeout slot reclaim.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ResourceLeaseManager,
  ResourceLeaseTimeoutError,
  isResourceLeaseTimeoutError,
  normalizeWorkspaceLeaseKey,
  resetResourceLeasesForTest,
  withWorkspaceResourceLease,
} from "./resource-leases.js";
import { getResourceEnvelopeLedger, resetResourceEnvelopeLedgerForTest } from "../resources/resource-envelope.js";
import { admitManagedProcess } from "./verseshell/managed-process-capacity.js";

afterEach(() => {
  resetResourceLeasesForTest();
  resetResourceEnvelopeLedgerForTest();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("workspace resource leases", () => {
  it('keeps advisory lease cleanup working when the native budget database is unavailable', async () => {
    const manager = new ResourceLeaseManager();
    const one = await manager.acquire('workspaceExec', 'db-read-failure');
    const two = await manager.acquire('workspaceExec', 'db-read-failure');
    const queued = manager.acquire('workspaceExec', 'db-read-failure');
    vi.stubEnv('CLAWX_EXECUTION_STATE_PATH', 'relative-execution.sqlite');
    expect(() => one.release()).not.toThrow();
    const three = await queued;
    expect(() => admitManagedProcess()).toThrow('execution_state_path_not_absolute');
    two.release(); three.release();
    expect(manager.getDiagnostics().active).toBe(0);
  });

  it('cancels a queued request without waiting for the holder or invoking its effect', async () => {
    const hold = deferred();
    const controller = new AbortController();
    let effect = false;
    const first = withWorkspaceResourceLease('workspaceWriter', 'cancel-queued', () => hold.promise);
    const second = withWorkspaceResourceLease('workspaceWriter', 'cancel-queued', async () => { effect = true; },
      { signal: controller.signal }).then(() => 'executed', () => 'aborted');
    await flush();
    controller.abort();
    const outcome = await Promise.race([second, new Promise(resolve => setTimeout(() => resolve('still-waiting'), 25))]);
    hold.resolve();
    await Promise.all([first, second]);
    expect(outcome).toBe('aborted');
    expect(effect).toBe(false);
  });

  it('checks cancellation again between granting a slot and starting the callback', async () => {
    const controller = new AbortController();
    let effect = false;
    const request = withWorkspaceResourceLease('workspaceWriter', 'cancel-granted', async () => { effect = true; },
      { signal: controller.signal });
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(effect).toBe(false);
  });

  it('keeps an already-started operation holding capacity until its owner settles', async () => {
    const hold = deferred();
    const controller = new AbortController();
    let started = false, follower = false;
    const first = withWorkspaceResourceLease('workspaceWriter', 'cancel-active', async () => {
      started = true;
      await hold.promise;
    }, { signal: controller.signal });
    await flush();
    expect(started).toBe(true);
    controller.abort();
    const second = withWorkspaceResourceLease('workspaceWriter', 'cancel-active', async () => { follower = true; });
    await flush();
    expect(follower).toBe(false);
    hold.resolve();
    await Promise.all([first, second]);
    expect(follower).toBe(true);
  });

  it("caps workspaceSearch at 2 and queues the third with queuedMs > 0", async () => {
    const gate = deferred();
    const started: number[] = [];
    const queued: number[] = [];
    let active = 0;
    let peak = 0;
    const hold = (id: number) =>
      withWorkspaceResourceLease("workspaceSearch", "ws", async (lease) => {
        started.push(id);
        queued.push(lease.queuedMs);
        peak = Math.max(peak, ++active);
        await gate.promise;
        active -= 1;
      });

    const runs = [hold(1), hold(2), hold(3)];
    await flush();
    expect(started).toEqual([1, 2]);

    await new Promise((resolve) => setTimeout(resolve, 5));
    gate.resolve();
    await Promise.all(runs);

    expect(started).toEqual([1, 2, 3]);
    expect(peak).toBe(2);
    expect(active).toBe(0);
    expect(queued[2]).toBeGreaterThan(0);
  });

  it("serializes overlapping fileMutation paths and runs disjoint paths in parallel", async () => {
    const one = deferred();
    const two = deferred();
    const events: string[] = [];
    const sameFile = normalizeWorkspaceLeaseKey("lease-fixture/one.txt");
    const otherFile = normalizeWorkspaceLeaseKey("lease-fixture/two.txt");

    const first = withWorkspaceResourceLease("fileMutation", sameFile, async () => {
      events.push("one:start");
      await one.promise;
      events.push("one:end");
    });
    const other = withWorkspaceResourceLease("fileMutation", otherFile, async () => {
      events.push("two:start");
      await two.promise;
      events.push("two:end");
    });
    const second = withWorkspaceResourceLease("fileMutation", sameFile, async () => {
      events.push("one-again:start");
    });

    await flush();
    // Disjoint path proceeds while the first path is still held.
    expect(events).toContain("two:start");
    // Same path must wait for the earlier holder.
    expect(events).not.toContain("one-again:start");

    one.resolve();
    await first;
    await second;
    expect(events.indexOf("one:end")).toBeLessThan(events.indexOf("one-again:start"));

    two.resolve();
    await other;
  });

  it("serializes overlapping subtreeMutation paths and runs disjoint subtrees in parallel", async () => {
    const outer = deferred();
    const other = deferred();
    const events: string[] = [];
    const subtree = normalizeWorkspaceLeaseKey("lease-fixture/tree");
    const nested = normalizeWorkspaceLeaseKey("lease-fixture/tree/nested");
    const sibling = normalizeWorkspaceLeaseKey("lease-fixture/sibling");

    const parent = withWorkspaceResourceLease("subtreeMutation", subtree, async () => {
      events.push("parent:start");
      await outer.promise;
      events.push("parent:end");
    });
    const child = withWorkspaceResourceLease("subtreeMutation", nested, async () => {
      events.push("child:start");
    });
    const disjoint = withWorkspaceResourceLease("subtreeMutation", sibling, async () => {
      events.push("sibling:start");
      await other.promise;
      events.push("sibling:end");
    });

    await flush();
    expect(events).toContain("sibling:start");
    expect(events).not.toContain("child:start");

    outer.resolve();
    await parent;
    await child;
    expect(events.indexOf("parent:end")).toBeLessThan(events.indexOf("child:start"));

    other.resolve();
    await disjoint;
  });

  it("keeps different workspace keys independent", async () => {
    const gate = deferred();
    const started: string[] = [];
    const a = withWorkspaceResourceLease("workspaceExec", "ws-a", async () => {
      started.push("a");
      await gate.promise;
    });
    const b = withWorkspaceResourceLease("workspaceExec", "ws-b", async () => {
      started.push("b");
      await gate.promise;
    });
    await flush();
    expect(started.sort()).toEqual(["a", "b"]);
    gate.resolve();
    await Promise.all([a, b]);
  });

  it("caps 8 concurrent workspaceExec acquisitions at the workspace budget", async () => {
    const gate = deferred();
    let active = 0;
    let peak = 0;
    const runs = Array.from({ length: 8 }, (_, id) =>
      withWorkspaceResourceLease("workspaceExec", "ws-fanout", async () => {
        peak = Math.max(peak, ++active);
        await Promise.resolve();
        await gate.promise;
        active -= 1;
        return id;
      }),
    );
    await flush();
    expect(active).toBe(2);
    gate.resolve();
    await Promise.all(runs);
    expect(peak).toBe(2);
    expect(active).toBe(0);
  });

  it("releases idempotently without over-admitting the next batch", async () => {
    const manager = new ResourceLeaseManager();
    const first = await manager.acquire("workspaceWriter", "ws");
    first.release();
    first.release();

    const gate = deferred();
    let active = 0;
    let peak = 0;
    const runs = Array.from({ length: 4 }, () =>
      manager.acquire("workspaceWriter", "ws", 5_000).then(async (lease) => {
        peak = Math.max(peak, ++active);
        await gate.promise;
        active -= 1;
        lease.release();
      }),
    );
    await flush();
    expect(active).toBe(1);
    gate.resolve();
    await Promise.all(runs);
    expect(peak).toBe(1);
    expect(active).toBe(0);
  });

  it("records gateway leases in the shadow resource envelope", async () => {
    const gate = deferred();
    const runs = [1, 2, 3].map((id) =>
      withWorkspaceResourceLease("workspaceExec", "ws-envelope", async () => {
        if (id <= 2) await gate.promise;
      }),
    );
    await flush();
    const entry = getResourceEnvelopeLedger().get("gateway:workspaceExec:ws-envelope");
    expect(entry).toMatchObject({
      activeSlots: 2,
      queuedCount: 1,
      kind: "runtime-bash",
      owner: "gateway",
    });
    gate.resolve();
    await Promise.all(runs);
    expect(getResourceEnvelopeLedger().get("gateway:workspaceExec:ws-envelope")).toBeUndefined();
  });
  it("rejects with a typed timeout error and reclaims the slot after release", async () => {
    const manager = new ResourceLeaseManager();
    const held = [
      await manager.acquire("workspaceExec", "ws-timeout", 5_000),
      await manager.acquire("workspaceExec", "ws-timeout", 5_000),
    ];

    const error = await manager
      .acquire("workspaceExec", "ws-timeout", 20)
      .catch((e) => e as unknown);
    expect(isResourceLeaseTimeoutError(error)).toBe(true);
    expect(error).toBeInstanceOf(ResourceLeaseTimeoutError);
    expect(error).toMatchObject({
      code: "RESOURCE_LEASE_TIMEOUT",
      leaseKind: "workspaceExec",
      leaseKey: "ws-timeout",
      timeoutMs: 20,
    });
    expect((error as ResourceLeaseTimeoutError).queuedMs).toBeGreaterThanOrEqual(0);

    // Release the held slots and confirm the queue drained with no leak.
    held.forEach((lease) => lease.release());
    const next = await manager.acquire("workspaceExec", "ws-timeout", 5_000);
    next.release();
  });
});
