import { afterEach, expect, it, vi } from "vitest";

const recovery = vi.hoisted(() => ({
  clean: vi.fn(),
  mark: vi.fn(),
  schedule: vi.fn(),
}));
vi.mock("../agents/session-dirs.js", () => ({
  resolveAgentSessionDirs: async () => ["C:/state/agents/main/sessions"],
}));
vi.mock("../agents/session-write-lock.js", () => ({ cleanStaleLockFiles: recovery.clean }));
vi.mock("../agents/main-session-restart-recovery.js", () => ({
  markRestartAbortedMainSessionsFromLocks: recovery.mark,
  scheduleRestartAbortedMainSessionRecovery: recovery.schedule,
}));
import { startGatewaySidecars } from "./server-startup-post-attach.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it.each([false, true])(
  "schedules recovery after marking, unless shutdown starts: %s",
  async (stopDuringCleanup) => {
    vi.useFakeTimers();
    vi.stubEnv("OPENCLAW_SKIP_CHANNELS", "1");
    let releaseCleanup!: () => void;
    let releaseMarker!: () => void;
    const cleanup = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    const marker = new Promise<void>((resolve) => {
      releaseMarker = resolve;
    });
    recovery.clean.mockImplementation(async () => {
      await cleanup;
      return { cleaned: [{ lockPath: "C:/state/session.jsonl.lock" }] };
    });
    recovery.mark.mockImplementation(async () => {
      await marker;
      return { marked: 1, skipped: 0 };
    });
    const runtime = await startGatewaySidecars({
      cfg: {},
      pluginRegistry: { plugins: [] },
      defaultWorkspaceDir: "C:/state",
      deps: {},
      startChannels: vi.fn(),
      shouldStartPluginServices: () => false,
      log: { warn: vi.fn() },
      logHooks: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      logChannels: { info: vi.fn(), error: vi.fn() },
    } as never);
    await vi.advanceTimersByTimeAsync(0);
    expect(recovery.clean).toHaveBeenCalledOnce();
    expect(recovery.schedule).not.toHaveBeenCalled();
    releaseCleanup();
    await vi.advanceTimersByTimeAsync(0);
    expect(recovery.mark).toHaveBeenCalledOnce();
    expect(recovery.schedule).not.toHaveBeenCalled();
    if (stopDuringCleanup)
      await Promise.all(
        runtime.postReadySidecars.map(async (sidecar) => {
          await sidecar.stop();
        }),
      );
    releaseMarker();
    await vi.advanceTimersByTimeAsync(0);
    expect(recovery.schedule).toHaveBeenCalledTimes(stopDuringCleanup ? 0 : 1);
  },
);
