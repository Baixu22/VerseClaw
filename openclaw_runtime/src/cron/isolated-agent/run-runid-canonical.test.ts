// R5: runId 贯通 —— Cron 执行 id → Browser 结果 runId → runner runId(收据 run_id 唯一上游)三处同值。
import { describe, expect, it } from "vitest";
import { createCronExecutionId } from "../run-id.js";
import { getAgentRunContext, registerAgentRunContext } from "../../infra/agent-events.js";
import {
  loadRunCronIsolatedAgentTurn,
  mockRunCronFallbackPassthrough,
  runEmbeddedAgentMock,
  registerAgentRunContextMock,
} from "./run.test-harness.js";
import {
  makeIsolatedAgentTurnParams,
  setupRunCronIsolatedAgentTurnSuite,
} from "./run.suite-helpers.js";

setupRunCronIsolatedAgentTurnSuite({ fast: true });

describe("cron runId 贯通 (R5-1)", () => {
  it.each([false, true])(
    "records the scheduled owner only during embedded execution (failed=%s)",
    async (failed) => {
      mockRunCronFallbackPassthrough();
      registerAgentRunContextMock.mockImplementation(registerAgentRunContext);
      let runId = "";
      runEmbeddedAgentMock.mockImplementation(
        async (args: {
          runId: string;
          sessionKey: string;
          sessionId: string;
          workspaceDir: string;
        }) => {
          runId = args.runId;
          expect(getAgentRunContext(runId)).toMatchObject({
            sessionKey: args.sessionKey,
            sessionId: args.sessionId,
            cronTaskScope: { jobId: "scheduled-owner", workspaceDir: args.workspaceDir },
          });
          if (failed) throw new Error("Scheduled execution failed");
          return { payloads: [{ text: "ok" }], meta: { agentMeta: {} } };
        },
      );
      const run = await loadRunCronIsolatedAgentTurn();
      const result = await run(
        makeIsolatedAgentTurnParams({
          job: {
            id: "scheduled-owner",
            sessionTarget: "isolated",
            payload: { kind: "agentTurn", message: "Scheduled owner check" },
          },
        }) as never,
      );
      expect(result.status).toBe(failed ? "error" : "ok");
      expect(runId).not.toBe("");
      expect(getAgentRunContext(runId)).toBeUndefined();
      registerAgentRunContextMock.mockReset();
    },
  );
  it("threads one canonical execution id through the browser result and the runner runId (receipt run_id source)", async () => {
    // 注入点 = 模型依赖边界(runEmbeddedAgentMock);run.ts / run-executor 全真。
    mockRunCronFallbackPassthrough();
    runEmbeddedAgentMock.mockResolvedValue({
      payloads: [{ text: "ok" }],
      meta: { agentMeta: {} },
      browserAutomationEvents: [
        {
          schemaVersion: 1,
          tool: "agent_browser",
          action: "open",
          ok: true,
          ts: Date.now(),
          sessionId: "browser-session-1",
          profile: "default",
          finalUrl: "https://example.com/checkin",
          title: "Check-in",
          textSample: "already checked in",
        },
      ],
    });

    const run = await loadRunCronIsolatedAgentTurn();
    const result = await run(
      makeIsolatedAgentTurnParams({
        job: {
          id: "job-r5",
          name: "R5 browser",
          sessionTarget: "isolated",
          payload: { kind: "agentTurn", message: "go", toolsAllow: ["agent_browser"] },
        },
      }) as never,
    );

    // ① Browser 结果 runId = canonical 工厂值(用结果自身的 startedAt 回推,不 mock 时间)。
    expect(result.browserAutomationResult).toBeDefined();
    const browserRunId = result.browserAutomationResult!.runId;
    const startedAtMs = Date.parse(result.browserAutomationResult!.startedAt);
    expect(Number.isFinite(startedAtMs)).toBe(true);
    expect(browserRunId).toBe(createCronExecutionId("job-r5", startedAtMs));
    expect(browserRunId).toMatch(/^cron:job-r5:\d+$/);

    // ② runner 收到的 runId(收据 run_id 的唯一上游)与 browser 结果同值。
    const runnerCall = runEmbeddedAgentMock.mock.calls.find(
      ([args]) => (args as { runId?: unknown } | undefined)?.runId !== undefined,
    );
    expect(runnerCall).toBeDefined();
    expect((runnerCall![0] as { runId: string }).runId).toBe(browserRunId);

    // ③ 会话语义保留:sessionId 仍是独立 UUID,不与执行 id 混用。
    expect(result.sessionId).toBeDefined();
    expect(result.sessionId).not.toBe(browserRunId);
    expect(result.sessionKey).toContain(":run:");
    expect(result.status).toBe("ok");
  });
});
