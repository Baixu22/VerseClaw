/**
 * Foreground-only exec liveness.
 *
 * When background execution is unavailable (`allowBackground: false`) the exec
 * promise settles only when the process exits. Session s03-t02 in the 2026-09-11
 * live CDP corpus shows the consequence: the command produced no result before
 * the UI timeout while it was still running. The tool must now emit periodic
 * `running` updates and warn the model that the command cannot be backgrounded.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const gatewayMock = vi.hoisted(() => ({
  processGatewayAllowlist: vi.fn(async () => ({})),
}));

vi.mock("./bash-tools.exec-host-gateway.js", () => gatewayMock);

import { createExecTool } from "./bash-tools.exec.js";
import type { ExecToolDetails } from "./bash-tools.exec-types.js";

const HEARTBEAT_ENV = "OPENCLAW_EXEC_FOREGROUND_HEARTBEAT_MS";

afterEach(() => {
  delete process.env[HEARTBEAT_ENV];
  gatewayMock.processGatewayAllowlist.mockClear();
});

type ExecResult = { content: Array<{ type: string; text: string }>; details: ExecToolDetails };

type Update = { details: ExecToolDetails; text: string };

function collectUpdates(updates: Update[]) {
  return (partial: unknown) => {
    const result = partial as ExecResult;
    updates.push({
      details: result.details,
      text: result.content.map((entry) => entry.text).join("\n"),
    });
  };
}

function heartbeatUpdates(updates: Update[]): Update[] {
  return updates.filter((update) => update.text.includes("s elapsed"));
}

describe("exec foreground liveness", () => {
  it("emits running updates while a foreground-only command is still executing", async () => {
    process.env[HEARTBEAT_ENV] = "250";
    const tool = createExecTool({
      host: "gateway",
      security: "full",
      ask: "off",
      allowBackground: false,
      timeoutSec: 20,
      sessionKey: "agent:main:exec-foreground-heartbeat",
    });

    const updates: Update[] = [];
    const result = (await tool.execute(
      "call-foreground-heartbeat",
      { command: `node -e "setTimeout(function(){console.log('done')},1200)"` },
      undefined,
      collectUpdates(updates),
    )) as ExecResult;

    expect(result.details.status).toBe("completed");
    const heartbeats = heartbeatUpdates(updates);
    expect(heartbeats.length).toBeGreaterThan(0);
    expect(heartbeats.every((update) => update.details.status === "running")).toBe(true);
    expect(result.content.map((entry) => entry.text).join("\n")).toContain(
      "background execution is disabled",
    );
  }, 30_000);

  it("does not emit foreground heartbeats when background execution is available", async () => {
    process.env[HEARTBEAT_ENV] = "250";
    const tool = createExecTool({
      host: "gateway",
      security: "full",
      ask: "off",
      allowBackground: true,
      backgroundMs: 60_000,
      timeoutSec: 20,
      sessionKey: "agent:main:exec-background-enabled",
    });

    const updates: Update[] = [];
    const result = (await tool.execute(
      "call-background-enabled",
      { command: `node -e "setTimeout(function(){console.log('done')},1200)"` },
      undefined,
      collectUpdates(updates),
    )) as ExecResult;

    expect(result.details.status).toBe("completed");
    expect(heartbeatUpdates(updates)).toHaveLength(0);
  }, 30_000);
});
