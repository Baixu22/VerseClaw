/** Durable spend reservations owned by ProviderOutboundBudget, in the existing state database. */
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { Selectable } from "kysely";
import type { RuntimeFeatureConfig } from "../config/types.openclaw.js";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import {
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
  type OpenClawStateDatabaseOptions,
} from "../state/openclaw-state-db.js";
import type { DB } from "../state/openclaw-state-db.generated.js";
import { resolveOpenClawStateSqlitePath } from "../state/openclaw-state-db.paths.js";
import {
  resolveProjectIdForWorkspace,
  type WorkspaceId,
  type ProjectId,
  type SessionKey,
} from "../../../shared/types/identity-scope.js";
import type { Model } from "../llm/types.js";
import type { StreamFn } from "./runtime/index.js";
import { runWithProviderSpend, type ProviderSpendWireTicket } from "./provider-spend-context.js";
import { calculateCost } from "../llm/model-utils.js";
import type { ModelRequestBudget } from "./command/shared-types.js";

type BudgetConfig = NonNullable<RuntimeFeatureConfig["providerBudget"]>;
type ScopeName = "host" | "project" | "session";
type CallRow = Selectable<DB["provider_spend_calls"]>;
export type ProviderSpendScope = {
  workspaceId?: WorkspaceId;
  projectId?: ProjectId;
  sessionKey: SessionKey;
  sessionGeneration: string;
};
export type ProviderSpendSnapshot = {
  scope: ScopeName;
  scopeKey: string;
  spentTokens: number;
  spentCostMicros: number;
  heldTokens: number;
  heldCostMicros: number;
  activeCalls: number;
  unknownTokenCalls: number;
  unknownCostCalls: number;
};
export type ProviderSpendReservation = { callId: string; ownerToken: string };
type DatabaseOptions = OpenClawStateDatabaseOptions;
const MICROS_PER_USD = 1_000_000;

export class ProviderSpendRejectedError extends Error {
  readonly code = "PROVIDER_SPEND_REJECTED";
  constructor(
    readonly reason: "tokens" | "cost" | "unknown-cost" | "scope" | "duplicate" | "calls",
    readonly scope?: ScopeName,
  ) {
    super(`Provider spend admission rejected: ${reason}${scope ? ` (${scope})` : ""}`);
    this.name = "ProviderSpendRejectedError";
  }
}

function integer(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError(`${name} must be a nonnegative safe integer`);
  return value;
}
function costMicros(value: number): number {
  if (!Number.isFinite(value) || value < 0)
    throw new TypeError("USD amount must be finite and nonnegative");
  return integer(Math.ceil(value * MICROS_PER_USD), "USD micros");
}
function scopeKeys(scope: ProviderSpendScope): Array<{ scope: ScopeName; key: string }> {
  if (!scope.sessionKey?.trim() || !scope.sessionGeneration?.trim())
    throw new ProviderSpendRejectedError("scope", "session");
  if (Boolean(scope.workspaceId) !== Boolean(scope.projectId))
    throw new ProviderSpendRejectedError("scope", "project");
  const project =
    scope.workspaceId && scope.projectId ? [scope.workspaceId, scope.projectId] : null;
  return [
    { scope: "host", key: "host" },
    ...(project
      ? [{ scope: "project" as const, key: JSON.stringify(["project", ...project]) }]
      : []),
    {
      scope: "session",
      key: JSON.stringify(["session", scope.sessionKey, scope.sessionGeneration]),
    },
  ];
}
function hasLimits(config: BudgetConfig | undefined): config is BudgetConfig {
  return Boolean(
    config &&
    Object.values(config).some(
      (limits) => limits && (limits.maxTokens !== undefined || limits.maxCostUsd !== undefined),
    ),
  );
}
function snapshot(scope: ScopeName, key: string, rows: CallRow[]): ProviderSpendSnapshot {
  const result: ProviderSpendSnapshot = {
    scope,
    scopeKey: key,
    spentTokens: 0,
    spentCostMicros: 0,
    heldTokens: 0,
    heldCostMicros: 0,
    activeCalls: 0,
    unknownTokenCalls: 0,
    unknownCostCalls: 0,
  };
  for (const row of rows) {
    if (row.state === "cancelled") continue;
    const active = row.state === "reserved" || row.state === "sent";
    if (active) result.activeCalls++;
    if (row.actual_tokens === null) {
      result.heldTokens += row.reserved_tokens;
      if (!active) result.unknownTokenCalls++;
    } else result.spentTokens += row.actual_tokens;
    if (row.actual_cost_micros === null) {
      result.heldCostMicros += row.reserved_cost_micros ?? 0;
      if (!active || row.reserved_cost_micros === null) result.unknownCostCalls++;
    } else result.spentCostMicros += row.actual_cost_micros;
  }
  for (const value of Object.values(result))
    if (typeof value === "number") integer(value, "aggregate spend");
  return result;
}

/** Same SQLite transaction checks all scopes and inserts all reservations; no await or partial reserve. */
export function reserveProviderSpend(
  input: {
    callId: string;
    runId: string;
    provider: string;
    model: string;
    requestDigest: string;
    scope: ProviderSpendScope;
    reservedTokens: number;
    reservedCostUsd: number | null;
    config: BudgetConfig;
    maxSessionCalls?: number;
  },
  options: DatabaseOptions = {},
): ProviderSpendReservation {
  const reservedTokens = integer(input.reservedTokens, "reserved tokens");
  const reservedCost = input.reservedCostUsd === null ? null : costMicros(input.reservedCostUsd);
  const keys = scopeKeys(input.scope);
  for (const name of ["callId", "runId", "provider", "model", "requestDigest"] as const)
    if (!input[name]?.trim()) throw new TypeError(`Missing ${name}`);
  if (input.config.project && !input.scope.projectId)
    throw new ProviderSpendRejectedError("scope", "project");
  return runOpenClawStateWriteTransaction(({ db }) => {
    const sql = getNodeSqliteKysely<DB>(db);
    if (
      executeSqliteQuerySync(
        db,
        sql
          .selectFrom("provider_spend_calls")
          .select("call_id")
          .where("call_id", "=", input.callId),
      ).rows.length
    ) {
      throw new ProviderSpendRejectedError("duplicate");
    }
    for (const key of keys) {
      const limits = input.config[key.scope];
      if (!limits) continue;
      const rows = executeSqliteQuerySync(
        db,
        sql
          .selectFrom("provider_spend_calls")
          .innerJoin(
            "provider_spend_allocations",
            "provider_spend_allocations.call_id",
            "provider_spend_calls.call_id",
          )
          .selectAll("provider_spend_calls")
          .where("scope_key", "=", key.key),
      ).rows;
      const state = snapshot(key.scope, key.key, rows);
      if (
        key.scope === "session" &&
        input.maxSessionCalls !== undefined &&
        rows.filter((row) => row.state !== "cancelled").length >=
          integer(input.maxSessionCalls, "call limit")
      ) {
        throw new ProviderSpendRejectedError("calls", key.scope);
      }
      if (
        limits.maxTokens !== undefined &&
        state.spentTokens + state.heldTokens + reservedTokens >
          integer(limits.maxTokens, "token limit")
      ) {
        throw new ProviderSpendRejectedError("tokens", key.scope);
      }
      if (limits.maxCostUsd !== undefined) {
        if (reservedCost === null || state.unknownCostCalls > 0)
          throw new ProviderSpendRejectedError("unknown-cost", key.scope);
        costMicros(limits.maxCostUsd); // Validate before rounding the ceiling down.
        const ceiling = Math.floor(limits.maxCostUsd * MICROS_PER_USD);
        if (state.spentCostMicros + state.heldCostMicros + reservedCost > ceiling)
          throw new ProviderSpendRejectedError("cost", key.scope);
      }
    }
    const ownerToken = randomUUID();
    executeSqliteQuerySync(
      db,
      sql.insertInto("provider_spend_calls").values({
        call_id: input.callId,
        owner_token: ownerToken,
        request_digest: input.requestDigest,
        run_id: input.runId,
        provider: input.provider,
        model: input.model,
        scope_json: JSON.stringify(input.scope),
        state: "reserved",
        reserved_tokens: reservedTokens,
        reserved_cost_micros: reservedCost,
        actual_tokens: null,
        actual_cost_micros: null,
        created_at: Date.now(),
        settled_at: null,
        reconciliation_ref: null,
      }),
    );
    executeSqliteQuerySync(
      db,
      sql
        .insertInto("provider_spend_allocations")
        .values(keys.map((key) => ({ scope_key: key.key, call_id: input.callId }))),
    );
    return { callId: input.callId, ownerToken };
  }, options);
}

function mutateReservation(
  reservation: ProviderSpendReservation,
  options: DatabaseOptions,
  change: (
    row: CallRow,
    database: ReturnType<typeof openOpenClawStateDatabase>,
  ) => Partial<CallRow>,
): void {
  runOpenClawStateWriteTransaction((database) => {
    const { db } = database;
    const sql = getNodeSqliteKysely<DB>(db);
    const row = executeSqliteQuerySync(
      db,
      sql.selectFrom("provider_spend_calls").selectAll().where("call_id", "=", reservation.callId),
    ).rows[0];
    if (!row || row.owner_token !== reservation.ownerToken)
      throw new Error("Provider spend reservation owner mismatch");
    executeSqliteQuerySync(
      db,
      sql
        .updateTable("provider_spend_calls")
        .set(change(row, database))
        .where("call_id", "=", row.call_id),
    );
  }, options);
}
export function markProviderSpendSent(
  reservation: ProviderSpendReservation,
  options: DatabaseOptions = {},
): void {
  mutateReservation(reservation, options, (row) => {
    if (row.state !== "reserved") throw new Error("Provider spend reservation is not dispatchable");
    return { state: "sent" };
  });
}
export function cancelUnsentProviderSpend(
  reservation: ProviderSpendReservation,
  options: DatabaseOptions = {},
): void {
  mutateReservation(reservation, options, (row) => {
    if (row.state !== "reserved") throw new Error("Cannot cancel provider spend after dispatch");
    return { state: "cancelled", settled_at: Date.now() };
  });
}
/** Missing usage retains the reserved liability. Duplicate reconciliation is idempotent, differing facts reject. */
export function reconcileProviderSpend(
  reservation: ProviderSpendReservation,
  usage: { tokens: number | null; costUsd: number | null; evidenceRef: string },
  options: DatabaseOptions = {},
): void {
  const tokens = usage.tokens === null ? null : integer(usage.tokens, "actual tokens");
  const cost = usage.costUsd === null ? null : costMicros(usage.costUsd);
  if (!usage.evidenceRef.trim()) throw new TypeError("Missing usage evidence reference");
  mutateReservation(reservation, options, (row, { db }) => {
    if (row.state === "cancelled" || row.state === "reserved")
      throw new Error("Provider spend was not dispatched");
    const sql = getNodeSqliteKysely<DB>(db);
    const receipt = executeSqliteQuerySync(
      db,
      sql
        .selectFrom("provider_spend_reconciliations")
        .selectAll()
        .where("call_id", "=", row.call_id)
        .where("evidence_ref", "=", usage.evidenceRef),
    ).rows[0];
    if (receipt) {
      if (receipt.tokens !== tokens || receipt.cost_micros !== cost)
        throw new Error("Provider spend reconciliation conflict");
      return { state: row.state };
    }
    // Later owner evidence may resolve unknown amounts, but cannot lower or
    // rewrite known consumption. Keep every reconciliation receipt in this owner.
    if (
      (row.actual_tokens !== null && row.actual_tokens !== tokens) ||
      (row.actual_cost_micros !== null && row.actual_cost_micros !== cost)
    )
      throw new Error("Provider spend reconciliation conflict");
    executeSqliteQuerySync(
      db,
      sql.insertInto("provider_spend_reconciliations").values({
        call_id: row.call_id,
        evidence_ref: usage.evidenceRef,
        tokens,
        cost_micros: cost,
        recorded_at: Date.now(),
      }),
    );
    return {
      state: tokens === null || cost === null ? "unknown" : "settled",
      actual_tokens: tokens,
      actual_cost_micros: cost,
      reconciliation_ref: usage.evidenceRef,
      settled_at: Date.now(),
    };
  });
}
export function providerSpendSnapshot(
  scope: ProviderSpendScope,
  options: DatabaseOptions & { readOnly?: boolean } = {},
): ProviderSpendSnapshot[] {
  const db = options.readOnly ? new DatabaseSync(options.path ?? resolveOpenClawStateSqlitePath(options.env), { readOnly: true })
    : openOpenClawStateDatabase(options).db;
  try {
    if (options.readOnly) db.exec('BEGIN');
    const sql = getNodeSqliteKysely<DB>(db);
    const result = scopeKeys(scope).flatMap(key => {
      const rows = executeSqliteQuerySync(db, sql.selectFrom("provider_spend_calls")
        .innerJoin("provider_spend_allocations", "provider_spend_allocations.call_id", "provider_spend_calls.call_id")
        .selectAll("provider_spend_calls").where("scope_key", "=", key.key)).rows;
      if (options.readOnly && key.scope === 'session' && rows.some(row => {
        if (row.state === 'cancelled') return false;
        try {
          const owner = JSON.parse(row.scope_json) as ProviderSpendScope;
          return owner.workspaceId !== scope.workspaceId || owner.projectId !== scope.projectId ||
            owner.sessionKey !== scope.sessionKey || owner.sessionGeneration !== scope.sessionGeneration;
        } catch { return true; }
      })) return [];
      return [snapshot(key.scope, key.key, rows)];
    });
    if (options.readOnly) db.exec('COMMIT');
    return result;
  } finally {
    if (options.readOnly) {
      if (db.isTransaction) db.exec('ROLLBACK');
      db.close();
    }
  }
}

export type ProviderSpendRunContext = {
  providerFallbackIndex?: number;
  config?: BudgetConfig; workspaceId?: string; sessionKey?: string; sessionGeneration: string; runId?: string; attemptIndex?: number;
  requestBudget?: ModelRequestBudget;
  sessionStorePath?: string;
};
async function resolveProviderSpendWorkspace(
  run: ProviderSpendRunContext,
): Promise<string | undefined> {
  if (!run.sessionStorePath) return run.workspaceId;
  const { updateSessionStoreEntry } = await import("../config/sessions/store.js");
  const requested = run.workspaceId?.trim();
  const entry = await updateSessionStoreEntry({
    storePath: run.sessionStorePath,
    sessionKey: run.sessionKey!,
    skipMaintenance: true,
    update: (owner) => {
      if (owner.sessionId !== run.sessionGeneration)
        throw new ProviderSpendRejectedError("scope", "session");
      if (owner.workspaceId && requested && owner.workspaceId !== requested)
        throw new ProviderSpendRejectedError("scope", "project");
      return !owner.workspaceId && requested ? { workspaceId: requested } : null;
    },
  });
  if (!entry) throw new ProviderSpendRejectedError("scope", "session");
  return entry.workspaceId;
}
function knownPrice(model: Model): boolean {
  return (
    model.cost &&
    Object.values(model.cost).every(
      (value) => typeof value === "number" && Number.isFinite(value) && value >= 0,
    ) &&
    Object.values(model.cost).some((value) => value > 0)
  );
}
/** The embedded runner supplies scope; provider/model options cannot grant or replace it. */
export function wrapProviderSpendStream(
  inner: StreamFn,
  run: ProviderSpendRunContext,
  options: DatabaseOptions = {},
): StreamFn {
  if (!hasLimits(run.config) && !run.requestBudget) return inner;
  const requestBudget = run.requestBudget ? structuredClone(run.requestBudget) : undefined;
  if (
    requestBudget &&
    (!Number.isSafeInteger(requestBudget.maxInputTokens) ||
      requestBudget.maxInputTokens < 1 ||
      !Number.isSafeInteger(requestBudget.maxOutputTokens) ||
      requestBudget.maxOutputTokens < 1 ||
      !Number.isFinite(requestBudget.maxCostUsd) ||
      requestBudget.maxCostUsd < 0 ||
      requestBudget.maxCalls !== 1)
  )
    throw new TypeError("Invalid model request budget");
  const config: BudgetConfig = structuredClone(run.config ?? {});
  if (requestBudget)
    config.session = {
      maxTokens: Math.min(
        config.session?.maxTokens ?? Infinity,
        requestBudget.maxInputTokens + requestBudget.maxOutputTokens,
      ),
      maxCostUsd: Math.min(config.session?.maxCostUsd ?? Infinity, requestBudget.maxCostUsd),
    };
  run = { ...run };
  let callIndex = 0;
  return async (model, context, streamOptions) => {
    streamOptions?.signal?.throwIfAborted();
    if (!run.runId || !run.sessionKey) throw new ProviderSpendRejectedError("scope");
    const quotedModel = { ...model, cost: { ...model.cost } };
    // A UTF-8 byte per token plus framing allowance is a conservative request bound.
    // It is an admission ceiling, not a measured tokenizer or usage receipt.
    const requestInput = requestBudget
      ? Buffer.byteLength(JSON.stringify(context), "utf8") + 512
      : undefined;
    if (requestBudget && requestInput! > requestBudget.maxInputTokens)
      throw new ProviderSpendRejectedError("tokens", "session");
    const inputBound = integer(
      requestBudget
        ? Math.min(quotedModel.contextWindow, requestBudget.maxInputTokens)
        : quotedModel.contextWindow,
      "model input bound",
    );
    const outputBound = integer(
      Math.min(
        streamOptions?.maxTokens ?? quotedModel.maxTokens,
        requestBudget?.maxOutputTokens ?? Infinity,
      ),
      "model output bound",
    );
    if (inputBound < 1 || outputBound < 1) throw new TypeError("Model bounds must be positive");
    const requestOptions = { ...streamOptions, maxTokens: outputBound };
    const workspaceId = (await resolveProviderSpendWorkspace(run)) as WorkspaceId | undefined;
    streamOptions?.signal?.throwIfAborted();
    const scope: ProviderSpendScope = {
      ...(workspaceId ? { workspaceId, projectId: resolveProjectIdForWorkspace(workspaceId) } : {}),
      sessionKey: run.sessionKey as SessionKey,
      sessionGeneration: run.sessionGeneration,
    };
    const tokens = inputBound + outputBound;
    const reservedCostUsd = knownPrice(quotedModel) ? tokens * Math.max(...Object.values(quotedModel.cost)) / MICROS_PER_USD : null;
    const requestDigest = createHash('sha256').update(JSON.stringify({ scope, model: quotedModel.id, provider: quotedModel.provider, pricing: quotedModel.cost, inputBound, outputBound, context })).digest('hex');
    const callId = JSON.stringify([scope.workspaceId ?? null, scope.projectId ?? null,
      scope.sessionKey, scope.sessionGeneration, run.runId, run.attemptIndex ?? 0, callIndex++,
      ...(run.providerFallbackIndex ? ['fallback', run.providerFallbackIndex] : [])]);
    const reservationInput = { callId, runId: run.runId, provider: model.provider, model: model.id,
      requestDigest, scope, reservedTokens: tokens, reservedCostUsd, config,
      ...(requestBudget ? { maxSessionCalls: requestBudget.maxCalls } : {}) };
    type Attempt = { reservation: ProviderSpendReservation; sent: boolean; refused: boolean; cancelled: boolean };
    let active: Attempt = { reservation: reserveProviderSpend(reservationInput, options), sent: false, refused: false, cancelled: false };
    const cancel = (attempt: Attempt) => {
      if (!attempt.sent && !attempt.cancelled) {
        cancelUnsentProviderSpend(attempt.reservation, options);
        attempt.cancelled = true;
      }
    };
    const markSent = (attempt: Attempt) => {
      if (!attempt.sent) {
        markProviderSpendSent(attempt.reservation, options);
        attempt.sent = true;
      }
    };
    const settleUnavailable = (evidenceRef: string) => {
      if (active.cancelled) return;
      if (!active.sent && active.refused) {
        cancel(active);
        return;
      }
      // An adapter without a transport receipt retains the original liability.
      markSent(active);
      reconcileProviderSpend(
        active.reservation,
        { tokens: null, costUsd: null, evidenceRef },
        options,
      );
    };
    if (streamOptions?.signal?.aborted) {
      cancel(active);
      streamOptions.signal.throwIfAborted();
    }
    let wireAttempts = 0;
    const beforeWire = (): ProviderSpendWireTicket => {
      if (wireAttempts > 0) {
        if (active.sent)
          reconcileProviderSpend(
            active.reservation,
            { tokens: null, costUsd: null, evidenceRef: "physical-retry-without-usage" },
            options,
          );
        else if (active.refused) cancel(active);
        active = {
          reservation: reserveProviderSpend(
            { ...reservationInput, callId: JSON.stringify([callId, "wire", wireAttempts]) },
            options,
          ),
          sent: false,
          refused: false,
          cancelled: false,
        };
      }
      wireAttempts++;
      const attempt = active;
      return {
        markSent: () => {
          if (attempt.refused || attempt.cancelled)
            throw new Error("Provider attempt was refused before dispatch");
          markSent(attempt);
        },
        rejectBeforeSend: () => {
          if (!attempt.sent) attempt.refused = true;
        },
      };
    };
    try {
      const stream = await runWithProviderSpend(beforeWire, () =>
        inner(model, context, requestOptions),
      );
      const result = stream.result().then(
        (message) => {
          // Normalized adapters can synthesize all-zero usage for a missing frame;
          // that is unknown billing, never evidence of a free model request.
          const usage = message.usage;
          const reported = Number.isSafeInteger(usage?.totalTokens) && usage.totalTokens > 0;
          const partsValid =
            reported &&
            [usage.input, usage.output, usage.cacheRead, usage.cacheWrite].every(
              (value) => Number.isSafeInteger(value) && value >= 0,
            );
          const partTotal = partsValid
            ? usage.input + usage.output + usage.cacheRead + usage.cacheWrite
            : 0;
          const measured = reported && (partTotal === 0 || partTotal === usage.totalTokens);
          if (!measured && !active.sent && active.refused) {
            cancel(active);
            return message;
          }
          const breakdown = measured && partsValid && partTotal === usage.totalTokens;
          const calculated =
            breakdown && knownPrice(quotedModel)
              ? calculateCost(quotedModel, { ...usage, cost: { ...usage.cost } }).total
              : null;
          const actualCost =
            calculated !== null && Number.isFinite(calculated) && calculated >= 0
              ? calculated
              : null;
          markSent(active);
          reconcileProviderSpend(
            active.reservation,
            {
              tokens: measured ? usage.totalTokens : null,
              costUsd: actualCost,
              evidenceRef: createHash("sha256")
                .update(
                  JSON.stringify({
                    callId,
                    responseId: message.responseId,
                    usage,
                    pricing: quotedModel.cost,
                    stopReason: message.stopReason,
                  }),
                )
                .digest("hex"),
            },
            options,
          );
          return message;
        },
        (error) => {
          settleUnavailable("stream-result-unavailable");
          throw error;
        },
      );
      void result.catch(() => undefined);
      return {
        result: () => result,
        async *[Symbol.asyncIterator]() {
          for await (const event of stream) {
            if (event.type === "done" || event.type === "error") await result;
            yield event;
          }
        },
      };
    } catch (error) {
      settleUnavailable("stream-start-unavailable");
      throw error;
    }
  };
}

/** Read only the provider owner's reservations for this run; unknown charges stay held. */
export function providerSpendForRun(runId: string, options: DatabaseOptions = {}) {
  const { db } = openOpenClawStateDatabase(options),
    sql = getNodeSqliteKysely<DB>(db);
  const rows = executeSqliteQuerySync(
    db,
    sql.selectFrom("provider_spend_calls").selectAll().where("run_id", "=", runId),
  ).rows.filter((row) => row.state !== "cancelled");
  return {
    calls: rows.length,
    reservedTokens: rows.reduce((sum, row) => sum + row.reserved_tokens, 0),
    reservedCostUsd: rows.some((row) => row.reserved_cost_micros === null)
      ? null
      : rows.reduce((sum, row) => sum + row.reserved_cost_micros!, 0) / MICROS_PER_USD,
    actualTokens:
      rows.length && rows.every((row) => row.actual_tokens !== null)
        ? rows.reduce((sum, row) => sum + row.actual_tokens!, 0)
        : null,
    actualCostUsd:
      rows.length && rows.every((row) => row.actual_cost_micros !== null)
        ? rows.reduce((sum, row) => sum + row.actual_cost_micros!, 0) / MICROS_PER_USD
        : null,
  };
}
