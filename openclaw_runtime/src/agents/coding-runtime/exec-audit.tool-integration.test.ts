import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createExecTool } from "../bash-tools.exec.js";
import { CODING_RUNTIME_EVENT_TYPES, type CodingExecEvent } from "../../../../shared/coding-runtime/types.js";
import { InMemoryCodingAuditSink, resetCodingAuditSinkForTest, setCodingAuditSink } from "./audit-sink.js";
import { normalizeCommandApprovalPolicy } from "./command-approval-policy.js";

let workspace: string;
let sink: InMemoryCodingAuditSink;

function firstExecEvent(): CodingExecEvent | undefined {
  const event = sink.query("s1").items[0];
  return event?.eventType === CODING_RUNTIME_EVENT_TYPES.EXEC ? event : undefined;
}

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "uftk-exec-tool-"));
  sink = new InMemoryCodingAuditSink();
  setCodingAuditSink(sink);
});

afterEach(async () => {
  resetCodingAuditSinkForTest();
  await fs.rm(workspace, { recursive: true, force: true });
});

describe("exec tool UFTK P3 integration", () => {
  it("records a completed exec event with side effects when the auditor is wired", async () => {
    const tool = createExecTool({
      host: "gateway",
      security: "full",
      ask: "off",
      cwd: workspace,
      uftkExecAudit: {
        enabled: true,
        sideEffectsEnabled: true,
        workspaceRoot: workspace,
        sessionId: "s1",
        snapshot: { skipDirs: [] },
      },
    });

    const result = await tool.execute(
      "req-1",
      { command: "node -e \"require('fs').writeFileSync('side.txt','x')\"" },
      undefined,
      undefined,
    );
    expect(result.details).toMatchObject({ status: "completed", exitCode: 0 });
    expect(sink.size).toBe(1);
    const event = firstExecEvent();
    expect(event?.status).toBe("succeeded");
    expect(event?.sideEffects.some((effect) => effect.path === "side.txt" && effect.status === "added")).toBe(true);
  });

  it("blocks a forbidden command before execution and records a denied event", async () => {
    const tool = createExecTool({
      host: "gateway",
      security: "full",
      ask: "off",
      cwd: workspace,
      uftkExecAudit: {
        enabled: true,
        sideEffectsEnabled: false,
        workspaceRoot: workspace,
        sessionId: "s1",
      },
      uftkCommandApproval: {
        enabled: true,
        policy: normalizeCommandApprovalPolicy({
          defaultDecision: "allow",
          rules: [{ prefix: "node -e", decision: "forbidden" }],
        }),
      },
    });

    const error = await tool
      .execute("req-2", { command: "node -e \"require('fs').writeFileSync('nope.txt','x')\"" }, undefined, undefined)
      .then(() => null, (caught: unknown) => caught as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("forbidden");
    expect(sink.size).toBe(1);
    expect(firstExecEvent()?.status).toBe("denied");
    await expect(fs.access(path.join(workspace, "nope.txt"))).rejects.toThrow();
  });
});
