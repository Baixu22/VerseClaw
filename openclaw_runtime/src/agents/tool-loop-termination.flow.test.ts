/**
 * Production tool-construction regression for the runaway loop in session s05-t01.
 *
 * The live corpus shows the detector blocking the 21st identical `read` call while
 * the run kept asking the model (43 read results, stopped by hand). The fix routes
 * a critical veto to the host through the same tool-construction path the app uses
 * (`createOpenClawCodingTools` -> before-tool-call hook), so this test drives the
 * real `read` tool instead of the wrapper in isolation.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createOpenClawCodingTools } from "./agent-tools.js";
import { resetDiagnosticSessionStateForTest } from "../logging/diagnostic-session-state.js";
import type { ToolLoopTerminationInfo } from "./tool-loop-termination.js";
import type { AnyAgentTool } from "./tools/common.js";

let workspaceDir = "";
const tempRoots: string[] = [];

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tool-loop-coding-tools-"));
  tempRoots.push(root);
  workspaceDir = path.join(root, "workspace");
  fs.mkdirSync(path.join(workspaceDir, "data"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, "data", "work-log.csv"),
    "id,status,minutes\nA01,done,12\nA02,pending,7\n",
  );
});

afterEach(() => {
  resetDiagnosticSessionStateForTest();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function findTool(tools: AnyAgentTool[], name: string): AnyAgentTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`tool ${name} missing from coding tool set`);
  }
  return tool;
}

function isBlockedLoopResult(result: unknown): boolean {
  const details = (result as { details?: Record<string, unknown> } | undefined)?.details;
  return details?.status === "blocked" && details?.deniedReason === "tool-loop";
}

describe("coding tool set forwards critical tool-loop termination", () => {
  it("notifies the host when the identical read loop turns critical", async () => {
    const terminations: ToolLoopTerminationInfo[] = [];
    const tools = createOpenClawCodingTools({
      agentId: "main",
      sessionKey: "agent:main:loop-termination-coding",
      runId: "loop-termination-coding-run",
      sessionId: "loop-termination-coding-session",
      workspaceDir,
      cwd: workspaceDir,
      onToolLoopTermination: (info) => terminations.push(info),
    });
    const readTool = findTool(tools, "read");

    const results: unknown[] = [];
    for (let i = 0; i < 23; i += 1) {
      results.push(
        await readTool.execute(`call-${i}`, { path: "data/work-log.csv" }, undefined, undefined),
      );
    }

    const firstBlockedIndex = results.findIndex((result) => isBlockedLoopResult(result));
    expect(firstBlockedIndex).toBe(20);
    expect(terminations.length).toBeGreaterThan(0);
    expect(terminations[0]).toMatchObject({ toolName: "read", detector: "generic_repeat" });
  }, 30_000);

  it("stays silent when the same tool set is built without the termination observer", async () => {
    const tools = createOpenClawCodingTools({
      agentId: "main",
      sessionKey: "agent:main:loop-termination-no-observer",
      runId: "loop-termination-no-observer-run",
      sessionId: "loop-termination-no-observer-session",
      workspaceDir,
      cwd: workspaceDir,
    });
    const readTool = findTool(tools, "read");

    const results: unknown[] = [];
    for (let i = 0; i < 23; i += 1) {
      results.push(
        await readTool.execute(`call-${i}`, { path: "data/work-log.csv" }, undefined, undefined),
      );
    }

    // Backward compatible: without the observer the veto is still only a blocked result.
    expect(results.some((result) => isBlockedLoopResult(result))).toBe(true);
  }, 30_000);
});
