import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readPersistentTaskEvents } from '../../../../shared/task-system/event-store.js';

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createTaskLedgerWorkingContextProposal,
  createTaskLedgerWorkingContextDecision,
  STAGE3_WORKING_CONTEXT_POLICY_DIGEST,
} from "../../../../shared/task-ledger-working-context.js";
import {
  appendStage3WorkingContextEvents,
  resolveStage3WorkingContextState,
  STAGE3_TASK_LEDGER_WORKING_CONTEXT_ENV,
} from "./stage3-working-context.js";
import {
  ensureLongTaskLedgerRoot,
  readLongTaskLedgerRevision,
  stableLongTaskLedgerRootId,
} from "./task-ledger.js";

const tempRoots: string[] = [];
let stateDir = "";

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage3-wc-"));
  tempRoots.push(root);
  stateDir = path.join(root, "state");
});

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function env(): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = { ...process.env, OPENCLAW_STATE_DIR: stateDir };
  delete base[STAGE3_TASK_LEDGER_WORKING_CONTEXT_ENV];
  return base;
}

function stage3Events(rootId: string, createdAt: string) {
  const proposal = createTaskLedgerWorkingContextProposal({
    proposalId: "p-runtime",
    field: "Objective",
    value: "Runtime objective",
    version: 1,
    actor: "assistant",
    taskId: rootId,
    sessionId: "sess:stage3",
    evidenceRefs: [{ type: "tool", ref: "tool:real" }],
    createdAt,
  });
  if (!proposal.ok) throw new Error(proposal.reason);
  const accept = createTaskLedgerWorkingContextDecision({
    proposalId: "p-runtime",
    field: "Objective",
    version: 1,
    decision: "accepted",
    actor: "user",
    taskId: rootId,
    sessionId: "sess:stage3",
    policyDigest: STAGE3_WORKING_CONTEXT_POLICY_DIGEST,
    createdAt,
  });
  if (!accept.ok) throw new Error(accept.reason);
  return [proposal.event, accept.event];
}

describe("stage3 long-task Working Context runtime adapter", () => {
  it("defaults off and performs zero JSONL I/O", () => {
    const runtimeEnv = env();
    expect(resolveStage3WorkingContextState(runtimeEnv).enabled).toBe(false);
    const rootId = stableLongTaskLedgerRootId({
      workspaceId: "stage3-off",
      sessionKey: "sess:stage3-off",
      runId: "run:stage3-off",
      source: "task_loop",
    });
    ensureLongTaskLedgerRoot({
      workspaceId: "stage3-off",
      taskLedgerRootId: rootId,
      sessionKey: "sess:stage3-off",
      runId: "run:stage3-off",
      title: "off root",
      source: "task_loop",
      createdAt: Date.parse("2026-06-16T10:00:00.000Z"),
      env: runtimeEnv,
    });
    const before = readLongTaskLedgerRevision({
      workspaceId: "stage3-off",
      taskLedgerRootId: rootId,
      env: runtimeEnv,
    });
    const events = stage3Events(rootId, "2026-06-16T10:01:00.000Z");
    appendStage3WorkingContextEvents({
      workspaceId: "stage3-off",
      events,
      env: runtimeEnv,
    });
    const after = readLongTaskLedgerRevision({
      workspaceId: "stage3-off",
      taskLedgerRootId: rootId,
      env: runtimeEnv,
    });
    expect(after).toEqual(before);
  });

  it("appends proposal/accept through the existing JSONL appender when explicitly enabled", () => {
    const runtimeEnv = env();
    const rootId = stableLongTaskLedgerRootId({
      workspaceId: "stage3-on",
      sessionKey: "sess:stage3-on",
      runId: "run:stage3-on",
      source: "task_loop",
    });
    ensureLongTaskLedgerRoot({
      workspaceId: "stage3-on",
      taskLedgerRootId: rootId,
      sessionKey: "sess:stage3-on",
      runId: "run:stage3-on",
      title: "on root",
      source: "task_loop",
      createdAt: Date.parse("2026-06-16T10:00:00.000Z"),
      env: runtimeEnv,
    });
    const before = readLongTaskLedgerRevision({
      workspaceId: "stage3-on",
      taskLedgerRootId: rootId,
      env: runtimeEnv,
    });
    expect(before?.eventCount).toBe(2);

    const events = stage3Events(rootId, "2026-06-16T10:01:00.000Z");
    appendStage3WorkingContextEvents({
      workspaceId: "stage3-on",
      events,
      env: runtimeEnv,
      enabled: true,
    });
    appendStage3WorkingContextEvents({
      workspaceId: "stage3-on",
      events,
      env: runtimeEnv,
      enabled: true,
    });

    const after = readLongTaskLedgerRevision({
      workspaceId: "stage3-on",
      taskLedgerRootId: rootId,
      env: runtimeEnv,
    });
    expect(after?.eventCount).toBe(4);
    expect(after?.revision).toMatch(/^rev_4_[a-f0-9]{16}$/);
    expect(after?.contentDigest).toMatch(/^sha256:[a-f0-9]{64}$/);

    const workspacesRoot = path.join(stateDir, "task-ledgers", "workspaces");
    const workspaceDir = fs.readdirSync(workspacesRoot).find((name) => name.startsWith("stage3-on-"));
    expect(workspaceDir).toBeDefined();
    const stateDirLedger = path.join(workspacesRoot, workspaceDir as string, "events.jsonl");
    const parsed = readPersistentTaskEvents(stateDirLedger);
    expect(parsed).toHaveLength(4);
    expect(parsed.filter((line) => line.type === "working_context_proposed")).toHaveLength(1);
    expect(parsed.filter((line) => line.type === "working_context_proposal_accepted")).toHaveLength(1);
    expect(parsed.every((line) => line.taskId === rootId)).toBe(true);
  });

  it("recomputes the Stage 2 revision formula after Stage 3 events", () => {
    const runtimeEnv = env();
    const rootId = stableLongTaskLedgerRootId({
      workspaceId: "stage3-revision",
      sessionKey: "sess:stage3-revision",
      runId: "run:stage3-revision",
      source: "task_loop",
    });
    ensureLongTaskLedgerRoot({
      workspaceId: "stage3-revision",
      taskLedgerRootId: rootId,
      sessionKey: "sess:stage3-revision",
      runId: "run:stage3-revision",
      title: "revision root",
      source: "task_loop",
      createdAt: Date.parse("2026-06-16T10:00:00.000Z"),
      env: runtimeEnv,
    });
    appendStage3WorkingContextEvents({
      workspaceId: "stage3-revision",
      events: stage3Events(rootId, "2026-06-16T10:01:00.000Z"),
      env: runtimeEnv,
      enabled: true,
    });
    const revision = readLongTaskLedgerRevision({
      workspaceId: "stage3-revision",
      taskLedgerRootId: rootId,
      env: runtimeEnv,
    });
    expect(revision?.eventCount).toBe(4);
    expect(revision?.revision).toBe(`rev_4_${revision?.contentDigest.slice("sha256:".length, "sha256:".length + 16)}`);
  });
});
