// @vitest-environment node
// L01: the Working Context ledger is the single live-task read/write source.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createTaskLedgerWorkingContextProposal,
} from "../../shared/task-ledger-working-context";
import {
  appendTaskLedgerWorkingContextEvents,
  readTaskLedgerWorkingContext,
} from "../../electron/services/task-ledger-working-context";
import {
  getTaskLedgerDir,
  getTaskLedgerEventsPath,
  readTaskLedgerEvents,
} from "../../electron/services/task-ledger-service";

const roots: string[] = [];
const saved = { config: process.env.OPENCLAW_CONFIG_DIR };

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "l01-working-context-"));
  roots.push(root);
  process.env.OPENCLAW_CONFIG_DIR = path.join(root, "config");
});

afterEach(() => {
  if (saved.config === undefined) delete process.env.OPENCLAW_CONFIG_DIR;
  else process.env.OPENCLAW_CONFIG_DIR = saved.config;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const workspaceId = "ws-l01";
const taskId = "task-l01";
const baseTime = "2026-10-13T00:00:00.000Z";

function proposalEvents() {
  const built = createTaskLedgerWorkingContextProposal({
    proposalId: "p1",
    field: "Objective",
    value: "Ship L01",
    version: 1,
    actor: "assistant",
    taskId,
    evidenceRefs: [{ type: "file", ref: "file:spec.md" }],
    createdAt: baseTime,
    idempotencyKey: "idem-p1",
  });
  if (!built.ok) throw new Error(built.reason);
  return [built.event];
}

describe("L01 working-context single source", () => {
  it("persists through the transactional ledger and reads back a consistent projection", async () => {
    await appendTaskLedgerWorkingContextEvents(workspaceId, proposalEvents());
    const projection = await readTaskLedgerWorkingContext(workspaceId);
    expect(projection.fields.Objective.pending.map((entry) => entry.proposalId)).toContain("p1");
    expect(fs.existsSync(path.join(getTaskLedgerDir(workspaceId),'events.sqlite3'))).toBe(true);
    expect((await readTaskLedgerEvents(workspaceId)).events).toHaveLength(1);
  });

  it("is idempotent across a replayed batch (no duplicate events, identical projection)", async () => {
    await appendTaskLedgerWorkingContextEvents(workspaceId, proposalEvents(), "batch-1");
    const first = await readTaskLedgerWorkingContext(workspaceId);
    await appendTaskLedgerWorkingContextEvents(workspaceId, proposalEvents(), "batch-1");
    const second = await readTaskLedgerWorkingContext(workspaceId);
    expect(second).toEqual(first);
    expect((await readTaskLedgerEvents(workspaceId)).events).toHaveLength(1);
  });

  it("surfaces a write failure instead of reporting success", async () => {
    // Occupy the ledger directory path with a file so the append cannot succeed.
    const dir = getTaskLedgerDir(workspaceId);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.writeFileSync(dir, "not a directory");
    await expect(appendTaskLedgerWorkingContextEvents(workspaceId, proposalEvents())).rejects.toThrow();
  });

  it("keeps workspaces isolated on the single ledger", async () => {
    await appendTaskLedgerWorkingContextEvents("ws-a", proposalEvents());
    const b = await readTaskLedgerWorkingContext("ws-b");
    expect(b.fields.Objective.pending).toHaveLength(0);
    expect(fs.existsSync(getTaskLedgerEventsPath("ws-b"))).toBe(false);
  });
});
