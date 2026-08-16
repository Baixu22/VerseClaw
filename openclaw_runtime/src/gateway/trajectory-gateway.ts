import fsp from "node:fs/promises";
import { parseAgentSessionKey } from "../routing/session-key.js";
import { resolveSessionFilePath, resolveSessionFilePathOptions } from "../config/sessions/paths.js";
import { resolveTrajectoryRuntimeFile } from "../trajectory/runtime-file.js";
import { safeParseTrajectoryEvent } from "../trajectory/schema.js";
import type { TrajectoryReadableEvent } from "../trajectory/types.js";
import { loadSessionEntry } from "./session-utils.js";
import type { GatewayBroadcastToConnIdsFn } from "./server-broadcast-types.js";

const MAX_PAGE_EVENTS = 1_000;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const POLL_INTERVAL_MS = 250;
const SUBSCRIPTION_TTL_MS = 10 * 60_000;

export type TrajectoryGatewayGap = {
  expectedSeq: number;
  actualSeq: number;
  fromSeq: number;
};

export type TrajectoryGatewayReadResult = {
  sessionKey: string;
  sessionId: string;
  fromSeq: number;
  toSeq?: number;
  nextSeq: number;
  hasMore: boolean;
  sourceAvailable: boolean;
  events: TrajectoryReadableEvent[];
  gap?: TrajectoryGatewayGap;
  invalidRows: number[];
  duplicateSeqs: number[];
};

export class TrajectoryGatewayRequestError extends Error {
  constructor(
    public readonly code: "invalid-range" | "invalid-session" | "source-too-large",
    message: string,
  ) {
    super(message);
    this.name = "TrajectoryGatewayRequestError";
  }
}

type ReadParams = {
  sessionKey: string;
  fromSeq?: number;
  toSeq?: number;
  limit?: number;
};

function normalizeInteger(value: unknown, fallback: number, name: string): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TrajectoryGatewayRequestError("invalid-range", `${name} must be an integer`);
  }
  return value;
}

function resolveReadRange(params: ReadParams): { fromSeq: number; toSeq?: number; limit: number } {
  const fromSeq = normalizeInteger(params.fromSeq, 0, "fromSeq");
  const toSeq = params.toSeq === undefined ? undefined : normalizeInteger(params.toSeq, -1, "toSeq");
  const limit = normalizeInteger(params.limit, 200, "limit");
  if (fromSeq < 0 || (toSeq !== undefined && (toSeq < 0 || toSeq < fromSeq))) {
    throw new TrajectoryGatewayRequestError(
      "invalid-range",
      "fromSeq/toSeq must be non-negative integers with toSeq >= fromSeq",
    );
  }
  if (limit < 1 || limit > MAX_PAGE_EVENTS) {
    throw new TrajectoryGatewayRequestError(
      "invalid-range",
      `limit must be an integer between 1 and ${MAX_PAGE_EVENTS}`,
    );
  }
  return { fromSeq, toSeq, limit };
}

function resolveSessionSource(sessionKey: string): { sessionId: string; sessionFile: string } {
  const loaded = loadSessionEntry(sessionKey);
  const parsed = parseAgentSessionKey(sessionKey);
  const sessionId = loaded.entry?.sessionId ?? parsed?.rest ?? sessionKey;
  try {
    const pathOptions = resolveSessionFilePathOptions({
      storePath: loaded.storePath,
      agentId: parsed?.agentId,
    });
    return {
      sessionId,
      sessionFile: resolveSessionFilePath(sessionId, loaded.entry, pathOptions),
    };
  } catch (error) {
    throw new TrajectoryGatewayRequestError(
      "invalid-session",
      `Invalid session key ${sessionKey}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function readRuntimeRows(params: {
  runtimeFile: string;
  sessionId: string;
}): Promise<{ events: TrajectoryReadableEvent[]; invalidRows: number[] }> {
  const stat = await fsp.stat(params.runtimeFile);
  if (stat.size > MAX_FILE_BYTES) {
    throw new TrajectoryGatewayRequestError(
      "source-too-large",
      `Trajectory source exceeds ${MAX_FILE_BYTES} bytes`,
    );
  }
  const content = await fsp.readFile(params.runtimeFile, "utf8");
  const events: TrajectoryReadableEvent[] = [];
  const invalidRows: number[] = [];
  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    if (!line.trim()) {
      continue;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(line) as unknown;
    } catch {
      invalidRows.push(index + 1);
      continue;
    }
    const parsed = safeParseTrajectoryEvent(raw);
    if (!parsed.success || parsed.event.source !== "runtime") {
      invalidRows.push(index + 1);
      continue;
    }
    const belongsToSession =
      parsed.event.schemaVersion === 1
        ? parsed.event.sessionId === params.sessionId
        : parsed.event.traceId === params.sessionId;
    if (belongsToSession) {
      events.push(parsed.event);
    }
  }
  return { events, invalidRows };
}

export async function readTrajectoryPage(params: ReadParams): Promise<TrajectoryGatewayReadResult> {
  const sessionKey = params.sessionKey.trim();
  if (!sessionKey) {
    throw new TrajectoryGatewayRequestError("invalid-session", "sessionKey is required");
  }
  const { fromSeq, toSeq, limit } = resolveReadRange(params);
  const source = resolveSessionSource(sessionKey);
  const runtimeFile = await resolveTrajectoryRuntimeFile({
    sessionFile: source.sessionFile,
    sessionId: source.sessionId,
  });
  if (!runtimeFile) {
    return {
      sessionKey,
      sessionId: source.sessionId,
      fromSeq,
      ...(toSeq !== undefined ? { toSeq } : {}),
      nextSeq: fromSeq,
      hasMore: false,
      sourceAvailable: false,
      events: [],
      invalidRows: [],
      duplicateSeqs: [],
    };
  }
  const parsed = await readRuntimeRows({ runtimeFile, sessionId: source.sessionId });
  const sorted = parsed.events.toSorted((left, right) => left.seq - right.seq);
  const duplicateSeqs: number[] = [];
  const unique = sorted.filter((event, index) => {
    if (index > 0 && event.seq === sorted[index - 1]?.seq) {
      if (duplicateSeqs.at(-1) !== event.seq) {
        duplicateSeqs.push(event.seq);
      }
      return false;
    }
    return true;
  });
  const eligible = unique.filter(
    (event) => event.seq > fromSeq && (toSeq === undefined || event.seq <= toSeq),
  );
  const events = eligible.slice(0, limit);
  const first = events[0];
  const gap = first && first.seq > fromSeq + 1
    ? { expectedSeq: fromSeq + 1, actualSeq: first.seq, fromSeq }
    : undefined;
  const nextSeq = events.at(-1)?.seq ?? fromSeq;
  return {
    sessionKey,
    sessionId: source.sessionId,
    fromSeq,
    ...(toSeq !== undefined ? { toSeq } : {}),
    nextSeq,
    hasMore: eligible.length > events.length,
    sourceAvailable: true,
    events,
    ...(gap ? { gap } : {}),
    invalidRows: parsed.invalidRows,
    duplicateSeqs,
  };
}

type TrajectorySubscription = {
  connId: string;
  sessionKey: string;
  lastSeq: number;
  broadcastToConnIds: GatewayBroadcastToConnIdsFn;
  timer: NodeJS.Timeout;
  lastActivityAt: number;
  lastGapKey?: string;
};

const subscriptions = new Map<string, TrajectorySubscription>();

function emitSubscriptionGap(subscription: TrajectorySubscription, page: TrajectoryGatewayReadResult): void {
  const gap = page.gap;
  if (!gap) {
    return;
  }
  const gapKey = `${gap.expectedSeq}:${gap.actualSeq}`;
  if (subscription.lastGapKey === gapKey) {
    return;
  }
  subscription.lastGapKey = gapKey;
  subscription.broadcastToConnIds(
    "observability.trajectory",
    {
      kind: "gap",
      sessionKey: subscription.sessionKey,
      fromSeq: subscription.lastSeq,
      gap,
    },
    new Set([subscription.connId]),
    { dropIfSlow: true },
  );
}

async function pollSubscription(subscription: TrajectorySubscription): Promise<void> {
  if (Date.now() - subscription.lastActivityAt > SUBSCRIPTION_TTL_MS) {
    unsubscribeTrajectory(subscription.connId);
    return;
  }
  try {
    const page = await readTrajectoryPage({
      sessionKey: subscription.sessionKey,
      fromSeq: subscription.lastSeq,
      limit: MAX_PAGE_EVENTS,
    });
    emitSubscriptionGap(subscription, page);
    if (page.gap || page.events.length === 0) {
      return;
    }
    subscription.lastGapKey = undefined;
    subscription.lastSeq = page.nextSeq;
    subscription.lastActivityAt = Date.now();
    subscription.broadcastToConnIds(
      "observability.trajectory",
      {
        kind: "events",
        sessionKey: subscription.sessionKey,
        fromSeq: page.fromSeq,
        nextSeq: page.nextSeq,
        events: page.events,
      },
      new Set([subscription.connId]),
      { dropIfSlow: true },
    );
  } catch {
    // Read failures are surfaced through the next explicit readFrom call; a
    // subscription must not turn transient file errors into an unbounded loop.
  }
}

export function unsubscribeTrajectory(connId: string): boolean {
  const existing = subscriptions.get(connId);
  if (!existing) {
    return false;
  }
  clearInterval(existing.timer);
  subscriptions.delete(connId);
  return true;
}

export function subscribeTrajectory(params: {
  connId: string;
  sessionKey: string;
  fromSeq: number;
  broadcastToConnIds: GatewayBroadcastToConnIdsFn;
}): { subscriptionId: string; fromSeq: number } {
  unsubscribeTrajectory(params.connId);
  const subscription: Omit<TrajectorySubscription, "timer"> = {
    connId: params.connId,
    sessionKey: params.sessionKey,
    lastSeq: params.fromSeq,
    broadcastToConnIds: params.broadcastToConnIds,
    lastActivityAt: Date.now(),
  };
  const timer = setInterval(() => {
    const current = subscriptions.get(params.connId);
    if (current) {
      void pollSubscription(current);
    }
  }, POLL_INTERVAL_MS);
  timer.unref?.();
  subscriptions.set(params.connId, { ...subscription, timer });
  const current = subscriptions.get(params.connId);
  if (current) {
    void pollSubscription(current);
  }
  return { subscriptionId: `${params.connId}:${params.sessionKey}`, fromSeq: params.fromSeq };
}

export function clearTrajectorySubscriptions(): void {
  for (const connId of subscriptions.keys()) {
    unsubscribeTrajectory(connId);
  }
}
