import { Type } from "@sinclair/typebox";
import { afterEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ before: vi.fn(async () => undefined) }));
vi.mock("../plugins/hook-runner-global.js", () => ({
  getGlobalHookRunner: () => ({
    hasHooks: (name: string) => name === "before_tool_call",
    runBeforeToolCall: hooks.before,
  }),
}));

import {
  getDiagnosticSessionState,
  resetDiagnosticSessionStateForTest,
} from "../logging/diagnostic-session-state.js";
import { wrapToolWithBeforeToolCallHook } from "./agent-tools.before-tool-call.js";
import { detectToolCallLoop } from "./tool-loop-detection.js";

afterEach(() => {
  hooks.before.mockReset();
  resetDiagnosticSessionStateForTest();
});

describe("tool cancellation before side effects", () => {
  it.each(["entry", "prepare", "policy"] as const)(
    "does not execute after cancellation at %s",
    async (phase) => {
      const abort = new AbortController();
      const reason = new DOMException("operator cancelled", "AbortError");
      const execute = vi.fn(async () => ({
        content: [{ type: "text" as const, text: "written" }],
        details: {},
      }));
      const prepare = vi.fn(async (params: unknown) => {
        if (phase === "prepare") abort.abort(reason);
        return params;
      });
      hooks.before.mockImplementationOnce(async () => {
        if (phase === "policy") abort.abort(reason);
        return undefined;
      });
      const definition = {
        name: "write",
        label: "write",
        description: "write",
        parameters: Type.Object({}),
        execute,
        prepareBeforeToolCallParams: prepare,
      };
      const tool = wrapToolWithBeforeToolCallHook(definition);
      if (phase === "entry") abort.abort(reason);
      await expect(tool.execute("write-cancelled", {}, abort.signal)).rejects.toBe(reason);
      expect(execute).not.toHaveBeenCalled();
      if (phase === "entry") expect(prepare).not.toHaveBeenCalled();
    },
  );

  it("does not record cancelled executions in loop history", async () => {
    const abort = new AbortController();
    const reason = new DOMException("operator cancelled", "AbortError");
    const tool = wrapToolWithBeforeToolCallHook(
      {
        name: "read",
        label: "read",
        description: "read",
        parameters: Type.Object({}),
        execute: async () => {
          abort.abort(reason);
          throw reason;
        },
      },
      { sessionKey: "cancel-history", runId: "run-cancel-history" },
    );
    await expect(tool.execute("read-cancelled", { path: "x" }, abort.signal)).rejects.toBe(reason);
    const session = getDiagnosticSessionState({ sessionKey: "cancel-history" });
    expect(session.toolCallHistory?.some((record) => record.resultHash)).toBeFalsy();
    expect(detectToolCallLoop(session, "read", { path: "x" }).stuck).toBe(false);
  });

  it("drops progress updates after cancellation", async () => {
    const abort = new AbortController();
    const reason = new DOMException("operator cancelled", "AbortError");
    const onUpdate = vi.fn();
    const tool = wrapToolWithBeforeToolCallHook({
      name: "read",
      label: "read",
      description: "read",
      parameters: Type.Object({}),
      execute: async (_id, _params, _signal, update) => {
        update?.({ content: [{ type: "text", text: "before" }] });
        abort.abort(reason);
        update?.({ content: [{ type: "text", text: "after-cancel" }] });
        return { content: [{ type: "text" as const, text: "done" }], details: {} };
      },
    });
    await expect(tool.execute("read-progress", {}, abort.signal, onUpdate)).rejects.toBe(reason);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][0]).toMatchObject({
      content: [{ text: "before" }],
    });
  });

  it("does not deliver a late success after cancellation", async () => {
    const abort = new AbortController();
    const reason = new DOMException("operator cancelled", "AbortError");
    const tool = wrapToolWithBeforeToolCallHook({
      name: "read",
      label: "read",
      description: "read",
      parameters: Type.Object({}),
      execute: async () => {
        abort.abort(reason);
        return { content: [{ type: "text" as const, text: "late-success" }], details: {} };
      },
    });
    await expect(tool.execute("read-late", {}, abort.signal)).rejects.toBe(reason);
  });

  it("executes an allowed uncancelled tool", async () => {
    const execute = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "written" }],
      details: {},
    }));
    const tool = wrapToolWithBeforeToolCallHook({
      name: "write",
      label: "write",
      description: "write",
      parameters: Type.Object({}),
      execute,
    });
    await tool.execute("write-active", {}, new AbortController().signal);
    expect(execute).toHaveBeenCalledOnce();
  });
});
