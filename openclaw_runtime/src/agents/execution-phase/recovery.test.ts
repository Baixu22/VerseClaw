import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeOpenClawStateDatabase } from "../../state/openclaw-state-db.js";
import {
  beginToolExecution,
  isExecutionPhaseWriterEnabled,
  recordToolDispatch,
  type ToolIntentKey,
} from "./tool-boundary.js";
import {
  commitExecutionPhase,
  readOpenExecutionPhases,
  settleOrphanedExecutionPhases,
} from "./store.js";
import { resolveExecutionPhaseRecovery } from "./recovery.js";
import { makeMissingToolResult } from "../session-transcript-repair.js";

let dir = "";
const env = {
  OPENCLAW_EXECUTION_PHASE_WRITER: "taskflow",
  OPENCLAW_TASK_LOOP_LIFECYCLE_WRITER: "taskflow",
};
const key: ToolIntentKey = {
  sessionKey: "s",
  sessionId: "generation-1",
  runId: "run-1",
  toolCallId: "call-1",
  toolName: "write",
  args: { path: "a", content: "secret" },
};
const assistant = {
  role: "assistant",
  content: [{ type: "toolCall", id: "call-1", name: "write", arguments: key.args }],
  stopReason: "toolUse",
};
const transcript = { sessionId: "generation-1", messages: [assistant] };
function options() {
  return { path: join(dir, "state.sqlite") };
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "exec-rec-"));
});
afterEach(() => {
  closeOpenClawStateDatabase();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("phase recovery authorization", () => {
  it("requires both opt-in writers and keeps the legacy defaults", () => {
    expect(isExecutionPhaseWriterEnabled({})).toBe(false);
    expect(isExecutionPhaseWriterEnabled({ OPENCLAW_EXECUTION_PHASE_WRITER: "taskflow" })).toBe(
      false,
    );
    expect(
      isExecutionPhaseWriterEnabled({ ...env, OPENCLAW_TASK_LOOP_LIFECYCLE_WRITER: "projection" }),
    ).toBe(false);
    expect(isExecutionPhaseWriterEnabled(env)).toBe(true);
  });
  it("keeps legacy disabled", () => {
    expect(resolveExecutionPhaseRecovery("s", {}, options(), transcript).action).toBe("none");
  });
  it("preserves and authorizes a bound unstarted call across startup settlement", () => {
    recordToolDispatch(key, options());
    settleOrphanedExecutionPhases({ options: options() });
    expect(resolveExecutionPhaseRecovery("s", env, options(), transcript).action).toBe("resume");
    expect(readOpenExecutionPhases("s", options())[0].intent_json).not.toContain("secret");
  });
  it("does not interpret a synthetic result as execution or authority", () => {
    const messages = [
      assistant,
      makeMissingToolResult({ toolCallId: "call-1", toolName: "write" }),
    ];
    expect(
      resolveExecutionPhaseRecovery("s", env, options(), { ...transcript, messages }).action,
    ).toBe("reconcile");
    recordToolDispatch(key, options());
    expect(
      resolveExecutionPhaseRecovery("s", env, options(), { ...transcript, messages }).action,
    ).toBe("resume");
  });
  it("reconciles a call claimed before its effect, even if execution throws", () => {
    recordToolDispatch(key, options());
    beginToolExecution(key, env, options());
    expect(resolveExecutionPhaseRecovery("s", env, options(), transcript).action).toBe("reconcile");
  });
  it("rejects changed arguments, changed generations, and missing bindings", () => {
    recordToolDispatch(key, options());
    expect(
      resolveExecutionPhaseRecovery("s", env, options(), {
        ...transcript,
        sessionId: "new-generation",
      }).action,
    ).toBe("reconcile");
    const changed = {
      ...assistant,
      content: [{ ...assistant.content[0], arguments: { path: "different" } }],
    };
    expect(
      resolveExecutionPhaseRecovery("s", env, options(), { ...transcript, messages: [changed] })
        .action,
    ).toBe("reconcile");
    expect(() => recordToolDispatch({ ...key, args: { path: "different" } }, options())).toThrow(
      "conflict",
    );
    expect(resolveExecutionPhaseRecovery("s", env, options()).action).toBe("reconcile");
  });
  it("does not replay a call with a persisted real result", () => {
    recordToolDispatch(key, options());
    const idempotencyKey = beginToolExecution(key, env, options())!;
    commitExecutionPhase(
      { idempotencyKey, from: "effect_pending", to: "effect_committed" },
      options(),
    );
    const result = {
      role: "toolResult",
      toolCallId: "call-1",
      content: [{ type: "text", text: "done" }],
      isError: false,
    };
    expect(
      resolveExecutionPhaseRecovery("s", env, options(), {
        ...transcript,
        messages: [assistant, result],
      }).action,
    ).toBe("none");
  });
  it("does not resurrect an older assistant call after a newer user turn", () => {
    recordToolDispatch(key, options());
    expect(
      resolveExecutionPhaseRecovery("s", env, options(), {
        ...transcript,
        messages: [assistant, { role: "user", content: "a different turn", timestamp: 2 }],
      }).action,
    ).toBe("none");
  });
  it("does not treat an error result as resolution of an uncertain effect", () => {
    recordToolDispatch(key, options());
    beginToolExecution(key, env, options());
    const result = {
      role: "toolResult",
      toolCallId: "call-1",
      content: [{ type: "text", text: "failed after effect" }],
      isError: true,
    };
    expect(
      resolveExecutionPhaseRecovery("s", env, options(), {
        ...transcript,
        messages: [assistant, result],
      }).action,
    ).toBe("reconcile");
  });
  it("fails closed when the phase database cannot be opened", () => {
    expect(resolveExecutionPhaseRecovery("s", env, { path: dir }, transcript).action).toBe(
      "reconcile",
    );
  });
  it("an exclusive claim cannot be acquired twice, even with a new run id", () => {
    recordToolDispatch(key, options());
    expect(beginToolExecution(key, env, options())).toBeTruthy();
    expect(() => beginToolExecution({ ...key, runId: "run-2" }, env, options())).toThrow(
      "reconciliation",
    );
  });
});
