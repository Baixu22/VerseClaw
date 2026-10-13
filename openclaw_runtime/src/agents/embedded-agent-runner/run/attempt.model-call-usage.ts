/** Terminal usage projection only; never changes the stream or its billing fields. */
import { createHash } from "node:crypto";
import type { DiagnosticModelCallUsageSnapshot } from "../../../infra/diagnostic-events.js";

type Snapshot = DiagnosticModelCallUsageSnapshot;
const BUCKETS = ["input", "output", "cacheRead", "cacheWrite"] as const;
const MAX_TOOL_LINKS = 128;
const digest = (domain: string, value: string) =>
  createHash("sha256")
    .update("openclaw.trace.cost-sampling.v1\0" + domain + "\0" + value)
    .digest("hex");
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const tokenCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function priceSnapshot(model: unknown): Snapshot["price"] {
  const unknown: Snapshot["price"] = {
    state: "unknown",
    currency: "USD",
    unit: "per-million-tokens",
    source: "runtime-model-catalog",
    version: null,
    rates: null,
  };
  const cost = record(record(model)?.cost);
  if (
    !cost ||
    !BUCKETS.every(
      (key) =>
        typeof cost[key] === "number" && Number.isFinite(cost[key]) && Number(cost[key]) >= 0,
    )
  )
    return unknown;
  const rates = {
    input: Number(cost.input),
    output: Number(cost.output),
    cacheRead: Number(cost.cacheRead),
    cacheWrite: Number(cost.cacheWrite),
  };
  // Catalog fallback rows use all-zero prices. They do not prove a free provider.
  if (!BUCKETS.some((key) => rates[key] > 0)) return unknown;
  return {
    ...unknown,
    state: "known",
    rates,
    version: digest("price-USD-per-million", JSON.stringify(rates)),
  };
}

export function createModelCallUsageObserver(model: unknown) {
  let price: Snapshot["price"];
  try {
    price = priceSnapshot(model);
  } catch {
    price = priceSnapshot(undefined);
  }
  const missing = (terminal: Snapshot["terminal"]): Snapshot => ({
    terminal,
    usage: null,
    costUsd: null,
    price,
    toolCallIdHashes: [],
    toolCallIdsDropped: 0,
  });
  let snapshot: Snapshot | undefined;
  const project = (chunk: Record<string, unknown>): Snapshot => {
    const terminal =
      chunk.type === "done" ? "done" : chunk.reason === "aborted" ? "aborted" : "error";
    const message = record(chunk.type === "done" ? chunk.message : chunk.error);
    const raw = record(message?.usage);
    const result = missing(terminal);
    if (raw && BUCKETS.every((key) => tokenCount(raw[key])) && tokenCount(raw.totalTokens)) {
      const usage = {
        input: Number(raw.input),
        output: Number(raw.output),
        cacheRead: Number(raw.cacheRead),
        cacheWrite: Number(raw.cacheWrite),
        total: raw.totalTokens,
      };
      const sum = BUCKETS.reduce((total, key) => total + usage[key], 0);
      // Error/abort SDK messages start with zero-filled usage even when none was received.
      if (
        Number.isSafeInteger(sum) &&
        usage.total >= sum &&
        (terminal === "done" || usage.total > 0)
      )
        result.usage = usage;
      if (result.usage && price.rates) {
        const cost =
          BUCKETS.reduce((total, key) => total + usage[key] * price.rates![key], 0) / 1_000_000;
        if (Number.isFinite(cost)) result.costUsd = cost;
      }
    }
    if (terminal === "done" && Array.isArray(message?.content)) {
      const links = new Set<string>();
      for (const item of message.content) {
        const tool = record(item);
        if (tool?.type !== "toolCall") continue;
        if (
          typeof tool.id !== "string" ||
          !tool.id ||
          tool.id.length > 512 ||
          links.size >= MAX_TOOL_LINKS
        ) {
          result.toolCallIdsDropped++;
          continue;
        }
        links.add(digest("tool-call", tool.id));
      }
      result.toolCallIdHashes = [...links].sort();
    }
    return result;
  };
  return {
    observe(chunk: unknown) {
      try {
        const value = record(chunk);
        if (!value || (value.type !== "done" && value.type !== "error")) return;
        const next = project(value);
        if (!snapshot) snapshot = next;
        else if (JSON.stringify(snapshot) !== JSON.stringify(next))
          snapshot = missing("conflicting");
      } catch {
        snapshot = missing("conflicting");
      }
    },
    finish(aborted = false): Snapshot {
      return snapshot ?? missing(aborted ? "aborted" : "incomplete");
    },
  };
}
