// @vitest-environment node
/**
 * TF-0645 / A5: checkpoint-first new context.
 *
 * The gate that matters is the order: an archive must be written and verified
 * before any reset may run, and a failure at any step must refuse the reset.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CHECKPOINTED_CONTEXT_RESET_ENV,
  CONTEXT_ARCHIVE_SCHEMA,
  createContextArchive,
  isCheckpointedContextResetEnabled,
  peekCheckpointedReset,
  performCheckpointedContextReset,
  resetCheckpointedResetStateForTests,
  takeCheckpointedReset,
  verifyContextArchive,
} from "../../openclaw_runtime/src/agents/checkpointed-context-reset";
import { createSessionsNewContextTool } from "../../openclaw_runtime/src/agents/tools/sessions-new-context-tool";
import { createOpenClawTools } from "../../openclaw_runtime/src/agents/openclaw-tools";

const PAYLOAD = JSON.stringify({ session: "sess-1", messages: ["hello", "world"] });
function textOf(result: { content: Array<{ type: string }> }): string {
  const first = result.content[0];
  if (first?.type !== "text") throw new Error("expected text result");
  return (first as unknown as { text: string }).text;
}
const dirs: string[] = [];

function tempStateDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "checkpoint-reset-"));
  dirs.push(dir);
  return dir;
}

beforeEach(() => {
  resetCheckpointedResetStateForTests();
});

afterEach(() => {
  resetCheckpointedResetStateForTests();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  delete process.env[CHECKPOINTED_CONTEXT_RESET_ENV];
});

describe("flag", () => {
  it("is off by default and only explicit truthy values turn it on", () => {
    expect(isCheckpointedContextResetEnabled({}, {})).toBe(false);
    expect(isCheckpointedContextResetEnabled(undefined, {})).toBe(false);
    expect(
      isCheckpointedContextResetEnabled(
        { runtime: { contextBlock: { checkpointedContextReset: { enabled: true } } } },
        {},
      ),
    ).toBe(true);
    expect(isCheckpointedContextResetEnabled({}, { [CHECKPOINTED_CONTEXT_RESET_ENV]: "1" })).toBe(true);
    expect(isCheckpointedContextResetEnabled({}, { [CHECKPOINTED_CONTEXT_RESET_ENV]: "off" })).toBe(false);
    expect(isCheckpointedContextResetEnabled({}, { [CHECKPOINTED_CONTEXT_RESET_ENV]: "maybe" })).toBe(false);
  });
});

describe("archive", () => {
  it("writes a verifiable archive with a digest and the original payload", () => {
    const stateDir = tempStateDir();
    const handle = createContextArchive({ payload: PAYLOAD, sessionId: "sess-1", stateDir });
    expect(handle.schema).toBe(CONTEXT_ARCHIVE_SCHEMA);
    expect(handle.chars).toBe(PAYLOAD.length);
    expect(handle.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyContextArchive(handle)).toEqual({ ok: true, chars: PAYLOAD.length });
    const archived = JSON.parse(fs.readFileSync(handle.path, "utf8")) as { payload: string };
    expect(archived.payload).toBe(PAYLOAD);
  });

  it("refuses an empty or oversize payload instead of writing a useless archive", () => {
    const stateDir = tempStateDir();
    expect(() => createContextArchive({ payload: "", stateDir })).toThrow(/empty/);
    expect(() => createContextArchive({ payload: "x".repeat(8 * 1024 * 1024 + 1), stateDir })).toThrow(
      /exceeds archive limit/,
    );
  });

  it("fails verification when the archive is missing or the bytes changed", () => {
    const stateDir = tempStateDir();
    const handle = createContextArchive({ payload: PAYLOAD, stateDir });
    fs.rmSync(handle.path);
    expect(verifyContextArchive(handle)).toEqual({ ok: false, reason: "archive-missing" });

    const second = createContextArchive({ payload: PAYLOAD, stateDir });
    fs.writeFileSync(second.path, JSON.stringify({ ...JSON.parse(fs.readFileSync(second.path, "utf8")), payload: "tampered" }));
    expect(verifyContextArchive(second).ok).toBe(false);
  });
});

describe("reset ordering", () => {
  it("does not run the reset when the archive cannot be verified", async () => {
    let called = false;
    const stateDir = tempStateDir();
    const handle = createContextArchive({ payload: PAYLOAD, stateDir });
    fs.rmSync(handle.path);
    const outcome = await performCheckpointedContextReset({
      handle,
      reset: async () => {
        called = true;
        return true;
      },
    });
    expect(outcome).toEqual({ status: "refused", reason: "archive-missing" });
    expect(called).toBe(false);
  });

  it("runs the reset only after a successful verification", async () => {
    const stateDir = tempStateDir();
    const handle = createContextArchive({ payload: PAYLOAD, stateDir });
    const order: string[] = [];
    const outcome = await performCheckpointedContextReset({
      handle,
      reset: async () => {
        order.push("reset");
        return true;
      },
    });
    order.push("verify-result");
    expect(outcome.status).toBe("reset");
    expect(order).toEqual(["reset", "verify-result"]);
  });

  it("refuses when the reset callback fails or declines", async () => {
    const stateDir = tempStateDir();
    const handle = createContextArchive({ payload: PAYLOAD, stateDir });
    expect(
      await performCheckpointedContextReset({
        handle,
        reset: async () => {
          throw new Error("boom");
        },
      }),
    ).toEqual({ status: "refused", reason: "reset-failed" });
    expect(
      await performCheckpointedContextReset({ handle, reset: async () => false }),
    ).toEqual({ status: "refused", reason: "reset-declined" });
  });
});

describe("tool", () => {
  it("schedules a reset and exposes only the archive identity", async () => {
    const stateDir = tempStateDir();
    process.env[CHECKPOINTED_CONTEXT_RESET_ENV] = "1";
    const tool = createSessionsNewContextTool({
      sessionId: "sess-1",
      sessionKey: "agent:main:main",
      stateDir,
      readTranscript: () => PAYLOAD,
    });
    const result = await tool.execute("call-1", {});
    const first = result.content[0];
    if (first?.type !== "text") throw new Error("expected text result");
    const details = JSON.parse(first.text) as Record<string, unknown>;
    expect(details).toMatchObject({ status: "scheduled", session: "current", timing: "after_turn" });
    expect(details.handle).toMatchObject({ chars: PAYLOAD.length });
    expect(JSON.stringify(details)).not.toContain("hello");
    const pending = peekCheckpointedReset("sess-1");
    expect(pending).toBeDefined();
    expect(takeCheckpointedReset("sess-1")).toBe(pending);
    expect(takeCheckpointedReset("sess-1")).toBeUndefined();
  });

  it("refuses when there is no transcript, no session, or no reader", async () => {
    process.env[CHECKPOINTED_CONTEXT_RESET_ENV] = "1";
    const stateDir = tempStateDir();
    const noTranscript = createSessionsNewContextTool({ sessionId: "s", stateDir, readTranscript: () => "" });
    expect(JSON.parse(textOf(await noTranscript.execute("c", {})))).toMatchObject({
      status: "refused",
      reason: "empty-transcript",
    });
    const noReader = createSessionsNewContextTool({ sessionId: "s", stateDir });
    expect(JSON.parse(textOf(await noReader.execute("c", {})))).toMatchObject({
      status: "refused",
      reason: "reset-unsupported-here",
    });
    const noSession = createSessionsNewContextTool({ stateDir, readTranscript: () => PAYLOAD });
    expect(JSON.parse(textOf(await noSession.execute("c", {})))).toMatchObject({
      status: "error",
      reason: "no-current-session",
    });
  });

  it("does not register the tool when the flag is off", () => {
    delete process.env[CHECKPOINTED_CONTEXT_RESET_ENV];
    const off = createOpenClawTools({
      sessionId: "sess-1",
      readCheckpointTranscript: () => PAYLOAD,
      config: {},
    } as never) as Array<{ name: string }>;
    expect(off.some((tool) => tool.name === "sessions_new_context")).toBe(false);
  });
});
