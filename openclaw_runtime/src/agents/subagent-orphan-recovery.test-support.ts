import { afterEach, beforeEach, vi } from "vitest";
import type { SessionEntry } from "../config/sessions.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";

const state = vi.hoisted(() => ({
  store: {} as Record<string, SessionEntry>,
  runs: new Map<string, SubagentRunRecord>(),
  gateway: vi.fn(),
  writeFails: false,
  phaseEnabled: true,
  phase: "none" as "none" | "resume" | "reconcile",
  remap: true,
  steer: vi.fn(),
}));
export { state };
vi.mock("../config/config.js", () => ({ getRuntimeConfig: () => ({}) }));
vi.mock("../config/sessions.js", () => ({
  loadSessionStore: () => state.store,
  resolveAgentIdFromSessionKey: () => "main",
  resolveStorePath: () => "agent-store",
  updateSessionStore: async (_path: string, mutate: (store: typeof state.store) => unknown) => {
    if (state.writeFails) throw new Error("injected durable admission failure");
    return mutate(state.store);
  },
  updateSessionStoreAtomic: async (
    _path: string,
    mutate: (store: typeof state.store) => unknown,
  ) => {
    if (state.writeFails) throw new Error("injected durable admission failure");
    return mutate(state.store);
  },
}));
vi.mock("../gateway/call.js", () => ({ callGateway: state.gateway }));
vi.mock("../gateway/session-utils.fs.js", () => ({
  readSessionMessagesAsync: async () => [{ role: "user", content: "Continue the original task" }],
}));
vi.mock("../logging/subsystem.js", () => ({
  createSubsystemLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
}));
vi.mock("./internal-session-effects.js", () => ({
  resolveInternalSessionEffectsTranscriptPath: (runId: string) => runId + ".jsonl",
}));
vi.mock("./subagent-registry-steer-runtime.js", () => ({
  replaceSubagentRunAfterSteer: (params: unknown) => {
    state.steer(params);
    return state.remap;
  },
  finalizeInterruptedSubagentRun: vi.fn(),
}));
vi.mock("./execution-phase/tool-boundary.js", () => ({
  isExecutionPhaseWriterEnabled: () => state.phaseEnabled,
  settlePersistedToolResult: vi.fn(),
}));
vi.mock("./execution-phase/recovery.js", () => ({
  resolveExecutionPhaseRecovery: () => ({
    action: state.phase,
    phases: [],
    reason: "observed durable tool boundary",
  }),
  authorizePendingToolRecovery: vi.fn(),
}));

import { recoverOrphanedSubagentSessions } from "./subagent-orphan-recovery.js";
import { sessionAdmissionRegistry } from "../sessions/session-admission-registry.js";

export const key = "agent:main:subagent:child";
export const recover = () => recoverOrphanedSubagentSessions({ getActiveRuns: () => state.runs });

beforeEach(() => {
  vi.clearAllMocks();
  state.steer.mockReset();
  vi.stubEnv("OPENCLAW_RECOVERY_AUTHORITY_MODE", "authority");
  state.writeFails = false;
  state.phaseEnabled = true;
  state.phase = "none";
  state.remap = true;
  sessionAdmissionRegistry.clearForTests();
  state.store = {
    [key]: {
      sessionId: "generation-1",
      updatedAt: 100,
      status: "running",
      lifecycleRunId: "original-run",
      abortedLastRun: true,
    },
  };
  state.runs = new Map([
    [
      "original-run",
      {
        runId: "original-run",
        childSessionKey: key,
        requesterSessionKey: "agent:main:main",
        requesterDisplayKey: "main",
        task: "Complete the original task",
        cleanup: "keep",
        createdAt: 100,
      },
    ],
  ]);
  state.gateway.mockImplementation(async (call: { params: { idempotencyKey: string } }) => {
    if (
      state.store[key].subagentRecovery?.authority?.idempotencyKey === call.params.idempotencyKey
    ) {
      state.store[key].lifecycleRunId = call.params.idempotencyKey;
      state.store[key].abortedLastRun = false;
    }
    return { runId: call.params.idempotencyKey };
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  sessionAdmissionRegistry.clearForTests();
});
