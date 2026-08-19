/**
 * R2: PID-reuse detection on the two P1-P5 lock paths.
 *
 * Both `session-write-lock.ts` and `infra/stale-lock-file.ts` defaulted to the
 * Linux-only `/proc` start-time reader, which returns null everywhere else. The
 * consequence was not a crash but a silent downgrade: on Windows and macOS a
 * recycled PID was indistinguishable from the original owner, so a lock held by
 * a dead process whose PID had been reassigned stayed "alive" until its age
 * bound expired. Neither module had a test file, which is how that survived.
 *
 * These tests pin the two properties that matter:
 *   1. the DEFAULT provider is platform-capable (not the injected seam);
 *   2. a mismatched token means stale, and an unknown token never does.
 *
 * Property 2 is the load-bearing asymmetry: "cannot prove reuse" must fall back
 * to the age bound, never be read as "reused". Treating null as reuse would
 * reclaim locks from live owners.
 */
import { describe, expect, it } from "vitest";
import { shouldRemoveDeadOwnerOrExpiredLock } from "./stale-lock-file.js";
import {
  getCachedProcessStartTime,
  processStartTimeProviderAvailable,
} from "../shared/process-start-time.js";

const PROVIDER_AVAILABLE = processStartTimeProviderAvailable();

describe("the default start-time provider is cross-platform", () => {
  it("resolves a start-time token for this process on a supported platform", () => {
    // linux / win32 / darwin all have a provider. If this ever fails on a
    // supported platform, PID-reuse detection has silently degraded again.
    expect(PROVIDER_AVAILABLE).toBe(
      process.platform === "linux" || process.platform === "win32" || process.platform === "darwin",
    );
    if (!PROVIDER_AVAILABLE) return;
    expect(getCachedProcessStartTime(process.pid)).toBeTypeOf("number");
  });

  it("uses that provider by default in the stale-lock decision, with nothing injected", () => {
    if (!PROVIDER_AVAILABLE) return;
    // No `getProcessStartTime` override: this exercises the module default. A
    // deliberately wrong stored token for a live PID must read as reuse.
    expect(
      shouldRemoveDeadOwnerOrExpiredLock({
        payload: { pid: process.pid, starttime: 1, createdAt: new Date().toISOString() },
        staleMs: 60 * 60 * 1000,
      }),
    ).toBe(true);
  });

  it("keeps a live owner whose stored token matches, with nothing injected", () => {
    if (!PROVIDER_AVAILABLE) return;
    const starttime = getCachedProcessStartTime(process.pid);
    expect(starttime).not.toBeNull();
    expect(
      shouldRemoveDeadOwnerOrExpiredLock({
        payload: {
          pid: process.pid,
          starttime: starttime!,
          createdAt: new Date().toISOString(),
        },
        staleMs: 60 * 60 * 1000,
      }),
    ).toBe(false);
  });
});

describe("an unknown token is never read as reuse", () => {
  it("falls back to liveness when the provider cannot answer", () => {
    // This is the pre-fix behavior on Windows/macOS, now reachable only when the
    // platform genuinely has no provider. A live owner must be kept.
    expect(
      shouldRemoveDeadOwnerOrExpiredLock({
        payload: { pid: process.pid, starttime: 1, createdAt: new Date().toISOString() },
        staleMs: 60 * 60 * 1000,
        getProcessStartTime: () => null,
        isPidDefinitelyDead: () => false,
      }),
    ).toBe(false);
  });

  it("removes a lock whose owner is definitely dead regardless of token", () => {
    expect(
      shouldRemoveDeadOwnerOrExpiredLock({
        payload: { pid: 999_999_999, starttime: 1, createdAt: new Date().toISOString() },
        staleMs: 60 * 60 * 1000,
        getProcessStartTime: () => null,
        isPidDefinitelyDead: () => true,
      }),
    ).toBe(true);
  });

  it("ignores a stored token of undefined and still honors liveness", () => {
    expect(
      shouldRemoveDeadOwnerOrExpiredLock({
        payload: { pid: process.pid, createdAt: new Date().toISOString() },
        staleMs: 60 * 60 * 1000,
        isPidDefinitelyDead: () => false,
      }),
    ).toBe(false);
  });
});

describe("a dead owner never costs a start-time probe", () => {
  /**
   * The provider's contract is that callers short-circuit on a dead pid, because
   * off Linux a probe is a subprocess (hundreds of ms). A dead owner is stale
   * either way, so probing first would put a PowerShell spawn on every
   * dead-owner lock cleanup and buy nothing.
   */
  it("decides on liveness without consulting the provider", () => {
    let probes = 0;
    expect(
      shouldRemoveDeadOwnerOrExpiredLock({
        payload: { pid: 999_999_999, starttime: 1, createdAt: new Date().toISOString() },
        staleMs: 60 * 60 * 1000,
        isPidDefinitelyDead: () => true,
        getProcessStartTime: () => {
          probes += 1;
          return null;
        },
      }),
    ).toBe(true);
    expect(probes).toBe(0);
  });

  it("still probes when the owner is alive", () => {
    let probes = 0;
    shouldRemoveDeadOwnerOrExpiredLock({
      payload: { pid: process.pid, starttime: 1, createdAt: new Date().toISOString() },
      staleMs: 60 * 60 * 1000,
      isPidDefinitelyDead: () => false,
      getProcessStartTime: () => {
        probes += 1;
        return 1;
      },
    });
    expect(probes).toBe(1);
  });
});

describe("locks written before this change stay readable", () => {
  it("skips the comparison when no token was recorded, whatever the provider says", () => {
    // Windows/macOS locks written by the old code never carried `starttime`,
    // because the Linux-only reader returned null and the writer guarded on it.
    // Those locks must not suddenly be judged by a differently-scaled token.
    const payloadWithoutToken = { pid: process.pid, createdAt: new Date().toISOString() };
    expect(
      shouldRemoveDeadOwnerOrExpiredLock({
        payload: payloadWithoutToken,
        staleMs: 60 * 60 * 1000,
        getProcessStartTime: () => 123456,
        isPidDefinitelyDead: () => false,
      }),
    ).toBe(false);
  });

  it("expires a payload with no pid purely on age", () => {
    const createdAt = new Date(Date.now() - 10_000).toISOString();
    expect(shouldRemoveDeadOwnerOrExpiredLock({ payload: { createdAt }, staleMs: 1_000 })).toBe(
      true,
    );
    expect(shouldRemoveDeadOwnerOrExpiredLock({ payload: { createdAt }, staleMs: 60_000 })).toBe(
      false,
    );
  });
});
