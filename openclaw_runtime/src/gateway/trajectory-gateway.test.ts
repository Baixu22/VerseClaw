import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessionFile = path.join(os.tmpdir(), `trajectory-gateway-${process.pid}.jsonl`);
const sessionModule = vi.hoisted(() => ({ loads: 0, pathError: null as Error | null }));

vi.mock("./session-utils.js", () => {
  sessionModule.loads += 1;
  return {
    loadSessionEntry: () => ({
      storePath: "sessions.json",
      entry: { sessionId: "session-1", sessionFile: "session.jsonl" },
    }),
  };
});
vi.mock("../config/sessions/paths.js", () => ({
  resolveSessionFilePathOptions: () => {
    if (sessionModule.pathError) {
      throw sessionModule.pathError;
    }
    return {};
  },
  resolveSessionFilePath: () => "session.jsonl",
}));
vi.mock("../trajectory/runtime-file.js", () => ({
  resolveTrajectoryRuntimeFile: async () => sessionFile,
}));

import {
  clearTrajectorySubscriptions,
  readTrajectoryPage,
  subscribeTrajectory,
  TrajectoryGatewayRequestError,
  unsubscribeTrajectory,
} from "./trajectory-gateway.js";

const v2Event = (seq: number) => ({
  traceSchema: "openclaw-trajectory",
  schemaVersion: 2,
  traceId: "session-1",
  source: "runtime",
  ts: "2026-08-14T00:00:00.000Z",
  seq,
  type: "run/start",
  role: "run",
  phase: "start",
  runId: "run-1",
  state: { status: "running", seq },
});

describe("Gateway trajectory read/subscribe", () => {
  beforeEach(async () => {
    await fs.writeFile(
      sessionFile,
      `${JSON.stringify(v2Event(1))}\n${JSON.stringify(v2Event(2))}\n`,
    );
  });

  afterEach(async () => {
    sessionModule.pathError = null;
    clearTrajectorySubscriptions();
    await fs.rm(sessionFile, { force: true });
  });

  it("loads session resolution on the first valid read while cleanup stays synchronous", async () => {
    expect(sessionModule.loads).toBe(0);
    expect(unsubscribeTrajectory("unsubscribed-connection")).toBe(false);
    clearTrajectorySubscriptions();
    await expect(readTrajectoryPage({ sessionKey: "" })).rejects.toMatchObject({
      code: "invalid-session",
    });
    await expect(readTrajectoryPage({ sessionKey: "agent:main", limit: 0 })).rejects.toMatchObject({
      code: "invalid-range",
    });
    expect(sessionModule.loads).toBe(0);
    expect((await readTrajectoryPage({ sessionKey: "agent:main" })).events).toHaveLength(2);
    expect(sessionModule.loads).toBe(1);
    expect((await readTrajectoryPage({ sessionKey: "agent:main" })).sessionId).toBe("session-1");
    expect(sessionModule.loads).toBe(1);
  });

  it("preserves the request error type when session path resolution fails", async () => {
    sessionModule.pathError = new Error("invalid session path");
    const error = await readTrajectoryPage({ sessionKey: "agent:main" }).catch(
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(TrajectoryGatewayRequestError);
    expect(error).toMatchObject({
      code: "invalid-session",
      message: "Invalid session key agent:main: invalid session path",
    });
  });

  it("reads v2 rows in seq order and retains v1 compatibility rows", async () => {
    const v1 = {
      traceSchema: "openclaw-trajectory",
      schemaVersion: 1,
      traceId: "session-1",
      source: "runtime",
      type: "legacy.event",
      ts: "2026-08-14T00:00:00.000Z",
      seq: 3,
      sessionId: "session-1",
    };
    await fs.appendFile(sessionFile, `${JSON.stringify(v1)}\n`);
    const page = await readTrajectoryPage({ sessionKey: "agent:main", fromSeq: 0, limit: 10 });
    expect(page.events.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(page.nextSeq).toBe(3);
    expect(page.sourceAvailable).toBe(true);
  });

  it("reports a deterministic gap and rejects invalid ranges", async () => {
    await fs.writeFile(sessionFile, `${JSON.stringify(v2Event(2))}\n`);
    const page = await readTrajectoryPage({ sessionKey: "agent:main", fromSeq: 0, limit: 10 });
    expect(page.gap).toEqual({ expectedSeq: 1, actualSeq: 2, fromSeq: 0 });
    await expect(
      readTrajectoryPage({ sessionKey: "agent:main", fromSeq: 4, toSeq: 2 }),
    ).rejects.toMatchObject({
      code: "invalid-range",
    } satisfies Partial<TrajectoryGatewayRequestError>);
  });

  it("reports malformed rows and duplicate sequences without replaying either", async () => {
    const first = JSON.stringify(v2Event(1));
    const duplicate = JSON.stringify(v2Event(1));
    const second = JSON.stringify(v2Event(2));
    await fs.writeFile(sessionFile, `${first}\n${duplicate}\nnot-json\n${second}\n`);

    const page = await readTrajectoryPage({ sessionKey: "agent:main", fromSeq: 0, limit: 10 });

    expect(page.events.map((event) => event.seq)).toEqual([1, 2]);
    expect(page.duplicateSeqs).toEqual([1]);
    expect(page.invalidRows).toEqual([3]);
  });

  it("rejects malformed numeric bounds instead of applying defaults", async () => {
    await expect(
      readTrajectoryPage({ sessionKey: "agent:main", fromSeq: "1" as never }),
    ).rejects.toMatchObject({
      code: "invalid-range",
    } satisfies Partial<TrajectoryGatewayRequestError>);
    await expect(
      readTrajectoryPage({ sessionKey: "agent:main", toSeq: Number.NaN }),
    ).rejects.toMatchObject({
      code: "invalid-range",
    } satisfies Partial<TrajectoryGatewayRequestError>);
    await expect(readTrajectoryPage({ sessionKey: "agent:main", limit: 0 })).rejects.toMatchObject({
      code: "invalid-range",
    } satisfies Partial<TrajectoryGatewayRequestError>);
  });

  it("publishes ordered batches to the subscribed connection and supports replacement cleanup", async () => {
    const broadcasts: Array<{ event: string; payload: unknown; connIds: ReadonlySet<string> }> = [];
    const broadcastToConnIds = (event: string, payload: unknown, connIds: ReadonlySet<string>) => {
      broadcasts.push({ event, payload, connIds });
    };
    const subscription = subscribeTrajectory({
      connId: "conn-1",
      sessionKey: "agent:main",
      fromSeq: 0,
      broadcastToConnIds,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(subscription.subscriptionId).toContain("conn-1");
    expect(broadcasts[0]?.event).toBe("observability.trajectory");
    expect((broadcasts[0]?.payload as { kind?: string }).kind).toBe("events");
    expect(unsubscribeTrajectory("conn-1")).toBe(true);
    expect(unsubscribeTrajectory("conn-1")).toBe(false);
  });
});
