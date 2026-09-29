// RC-02 receipt persistence owner: a narrow ReceiptStore interface over a typed,
// append-only runtime_receipts table in the existing openclaw-state SQLite
// (user-confirmed decision 2026-08-02). Seven hard constraints are enforced:
//  1. digest/refs/call-index/version/policy-digest only; never raw payload.
//  2. append-only; same idempotency_key with identical content is idempotent
//     success, different content must conflict-fail.
//  3. explicit attempt/model-call/wire-attempt identity (no max(sequence)+1).
//  4. no silent pruning; deletion requires an explicit lifecycle policy call.
//  5. shadow write failure must not change send behavior but must fail RC-02
//     acceptance (callers surface appendFailure; the shadow path never throws
//     into the send path).
//  6. a receipt explains and correlates facts only; it never authorizes replay;
//     domain journals remain the effect/idempotency truth.
//  7. the npm fallback reports degraded and never counts toward coverage.
import { createHash, randomUUID } from "node:crypto";

import type { Insertable, Selectable } from "kysely";

import {
  getNodeSqliteKysely,
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
} from "../infra/kysely-sync.js";
import {
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
  type OpenClawStateDatabaseOptions,
} from "../state/openclaw-state-db.js";
import type { DB as OpenClawStateKyselyDatabase } from "../state/openclaw-state-db.generated.js";

export const RUNTIME_RECEIPTS_SCHEMA_VERSION = "1";
export const RUNTIME_RECEIPTS_OWNER = "openclaw_runtime.agents.receipt-store";

export const RUNTIME_RECEIPT_KINDS = [
  "shadow_context",
  "shadow_wire",
  "context",
  "wire",
  "effect",
] as const;
export type RuntimeReceiptKind = (typeof RUNTIME_RECEIPT_KINDS)[number];

export const RUNTIME_RECEIPT_RUNTIME_MODES = ["source", "npm"] as const;
export type RuntimeReceiptRuntimeMode = (typeof RUNTIME_RECEIPT_RUNTIME_MODES)[number];

export type RuntimeReceiptInsert = Insertable<OpenClawStateKyselyDatabase["runtime_receipts"]>;
export type RuntimeReceiptRow = Selectable<OpenClawStateKyselyDatabase["runtime_receipts"]>;
export type RuntimeReceiptDatabase = Pick<OpenClawStateKyselyDatabase, "runtime_receipts">;

/** R5-3: one correlated v1 ContextReceipt + WireReceipt pair sharing a correlation_digest. */
export type RuntimeReceiptPair = {
  correlationDigest: string;
  context: RuntimeReceiptRow;
  wire: RuntimeReceiptRow;
};

export type ReceiptIdentity = {
  /** Session key, when the call is bound to a session. */
  sessionKey?: string;
  /** Run id, when the call is bound to a run. */
  runId?: string;
  /** Trace id, when a trace correlation id is available. */
  traceId?: string;
  /** Provider id (e.g. anthropic). */
  providerId?: string;
  /** Adapter id, when a provider-specific adapter performed the finalizers. */
  adapterId?: string;
  /** Registered non-semantic transport transform ids applied after seal. */
  transformIds?: string[];
  /** Runtime mode: source openclaw_runtime or npm fallback. */
  runtimeMode: RuntimeReceiptRuntimeMode;
};

export type ReceiptCallIndex = {
  attemptIndex: number;
  modelCallIndex: number;
  wireAttemptIndex: number;
};

export type ReceiptBudget =
  | {
      unit: "tokens";
      inputLimit: number;
      outputLimit: number;
    }
  | {
      unit: "chars";
      charsRequested: number;
      charsApplied: number;
    };

export type ReceiptContent = {
  /** Semantic logical digest (ContextReceipt) or final wire digest (WireReceipt). */
  logicalDigest?: string;
  /** Final request-body digest after provider-specific finalizers. */
  wireDigest?: string;
  /** Correlates the logical and wire receipts of the same model call. */
  correlationDigest: string;
  /** Selected items/decisions projection (JSON array of refs). */
  selected?: string[];
  /** Omitted items/decisions projection (JSON array of refs). */
  omitted?: string[];
  /** Bounded token-budget summary. */
  budget?: ReceiptBudget;
  /** Policy digest (the selection/budget policy that produced this receipt). */
  policyDigest?: string;
};

export type PutReceiptInput = {
  /** Stable idempotency key. Re-applying the same key with identical content is
   *  an idempotent success; different content under the same key must conflict. */
  idempotencyKey: string;
  kind: RuntimeReceiptKind;
  version: string;
  identity: ReceiptIdentity;
  callIndex: ReceiptCallIndex;
  content: ReceiptContent;
  createdAt?: number;
};

export type PutReceiptResult =
  | { ok: true; duplicate: false; receiptId: string; inserted: true }
  | { ok: true; duplicate: true; receiptId: string; inserted: false; reason: "identical-content" }
  | {
      ok: false;
      duplicate: true;
      receiptId: string;
      inserted: false;
      reason: "content-conflict";
      existing: string;
    };

const PUT_RECEIPT_KEYS = new Set([
  "idempotencyKey",
  "kind",
  "version",
  "identity",
  "callIndex",
  "content",
  "createdAt",
]);
const RECEIPT_IDENTITY_KEYS = new Set([
  "sessionKey",
  "runId",
  "traceId",
  "providerId",
  "adapterId",
  "transformIds",
  "runtimeMode",
]);
const RECEIPT_CALL_INDEX_KEYS = new Set(["attemptIndex", "modelCallIndex", "wireAttemptIndex"]);
const RECEIPT_CONTENT_KEYS = new Set([
  "logicalDigest",
  "wireDigest",
  "correlationDigest",
  "selected",
  "omitted",
  "budget",
  "policyDigest",
]);
const RECEIPT_BUDGET_KEYS = new Set([
  "unit",
  "inputLimit",
  "outputLimit",
  "charsRequested",
  "charsApplied",
]);
const SHA256_DIGEST_RE = /^[a-f0-9]{64}$/;
const RECEIPT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/;
// IRC channel routes contain # (agent:main:irc:group:#channel). Other receipt
// identifiers remain on the stricter grammar; whitespace/control bytes stay invalid.
const RECEIPT_SESSION_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/#-]*$/;
const RECEIPT_REFERENCE_RE =
  /^(?:ref:(?:context|file|memory|message|tool):[A-Za-z0-9][A-Za-z0-9._:@/+%-]*|owner-census:v0:[1-9]\d{0,5}:[a-f0-9]{64})$/;
const MAX_IDEMPOTENCY_KEY_LENGTH = 512;
const MAX_IDENTITY_LENGTH = 256;
const MAX_TRANSFORM_ID_LENGTH = 128;
const MAX_TRANSFORM_IDS = 32;
const MAX_RECEIPT_REFERENCES = 64;
const MAX_RECEIPT_REFERENCE_LENGTH = 256;
const MAX_BUDGET_TOKENS = 1_000_000_000;
const MAX_CALL_INDEX = 2_147_483_647;

const RECEIPT_VERSIONS = {
  shadow_context: "0",
  shadow_wire: "0",
  context: "1",
  wire: "1",
  effect: "1",
} as const satisfies Record<RuntimeReceiptKind, string>;

function assertPlainRecord(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must use a plain object prototype`);
  }
}

function assertOnlyKeys(value: Record<string, unknown>, keys: Set<string>, label: string): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new TypeError(`${label} contains unsupported symbol field`);
    if (!keys.has(key)) throw new TypeError(`${label} contains unsupported field: ${key}`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${label} field ${key} must be an enumerable data property`);
    }
  }
}

function assertOptionalId(value: unknown, label: string, pattern = RECEIPT_ID_RE): void {
  if (value === undefined) return;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_IDENTITY_LENGTH ||
    !pattern.test(value)
  ) {
    throw new TypeError(`${label} must be a bounded canonical identifier`);
  }
}

function assertCanonicalStringArray(
  value: unknown,
  label: string,
  options: { maxItems: number; maxLength: number; pattern: RegExp },
): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${label} must be an array of strings when provided`);
  }
  if (value.length > options.maxItems) {
    throw new TypeError(`${label} exceeds the maximum item count`);
  }
  const unique = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (
      !Object.hasOwn(value, index) ||
      typeof item !== "string" ||
      item.length === 0 ||
      item.length > options.maxLength ||
      !options.pattern.test(item)
    ) {
      throw new TypeError(`${label} must be a dense array of strings when provided`);
    }
    if (unique.has(item)) throw new TypeError(`${label} must not contain duplicate values`);
    unique.add(item);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) {
      throw new TypeError(`${label} contains unsupported array field: ${String(key)}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${label} array entries must be enumerable data properties`);
    }
  }
}

function assertNonNegativeInteger(value: unknown, label: string): void {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > MAX_CALL_INDEX) {
    throw new TypeError(`${label} must be a bounded non-negative integer`);
  }
}

function assertDigest(value: unknown, label: string, required: boolean): void {
  if (value === undefined && !required) return;
  if (typeof value !== "string" || !SHA256_DIGEST_RE.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
  }
}

function assertBudget(value: unknown, label: string): asserts value is ReceiptBudget | undefined {
  if (value === undefined) return;
  assertPlainRecord(value, label);
  assertOnlyKeys(value, RECEIPT_BUDGET_KEYS, label);
  if (value.unit === "tokens") {
    for (const key of ["inputLimit", "outputLimit"] as const) {
      const amount = value[key];
      if (
        !Number.isSafeInteger(amount) ||
        Number(amount) < 0 ||
        Number(amount) > MAX_BUDGET_TOKENS
      ) {
        throw new TypeError(`${label} ${key} must be a bounded non-negative integer`);
      }
    }
    return;
  }
  if (value.unit === "chars") {
    for (const key of ["charsRequested", "charsApplied"] as const) {
      const amount = value[key];
      if (
        !Number.isSafeInteger(amount) ||
        Number(amount) < 0 ||
        Number(amount) > MAX_BUDGET_TOKENS
      ) {
        throw new TypeError(`${label} ${key} must be a bounded non-negative integer`);
      }
    }
    return;
  }
  throw new TypeError(`${label} unit must be tokens or chars`);
}

function serializeBudget(value: ReceiptBudget | undefined): string | null {
  if (!value) return null;
  if (value.unit === "chars") {
    return JSON.stringify({
      unit: value.unit,
      charsRequested: value.charsRequested,
      charsApplied: value.charsApplied,
    });
  }
  return JSON.stringify({
    unit: value.unit,
    inputLimit: value.inputLimit,
    outputLimit: value.outputLimit,
  });
}

function validatePutReceiptInput(input: PutReceiptInput): void {
  assertPlainRecord(input, "ReceiptStore.put input");
  assertOnlyKeys(input, PUT_RECEIPT_KEYS, "ReceiptStore.put input");
  if (
    typeof input.idempotencyKey !== "string" ||
    input.idempotencyKey.length === 0 ||
    input.idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH ||
    !RECEIPT_ID_RE.test(input.idempotencyKey)
  ) {
    throw new TypeError("ReceiptStore.put idempotencyKey must be a bounded canonical identifier");
  }
  if (!RUNTIME_RECEIPT_KINDS.includes(input.kind))
    throw new TypeError(`unsupported receipt kind: ${String(input.kind)}`);
  if (input.version !== RECEIPT_VERSIONS[input.kind]) {
    throw new TypeError(`unsupported receipt version ${String(input.version)} for ${input.kind}`);
  }
  if (
    input.createdAt !== undefined &&
    (!Number.isSafeInteger(input.createdAt) || input.createdAt < 0)
  ) {
    throw new TypeError("receipt createdAt must be a non-negative safe integer");
  }

  assertPlainRecord(input.identity, "receipt identity");
  assertOnlyKeys(input.identity, RECEIPT_IDENTITY_KEYS, "receipt identity");
  for (const key of ["sessionKey", "runId", "traceId", "providerId", "adapterId"] as const) {
    assertOptionalId(
      input.identity[key],
      `receipt identity ${key}`,
      key === "sessionKey" ? RECEIPT_SESSION_KEY_RE : RECEIPT_ID_RE,
    );
  }
  assertCanonicalStringArray(input.identity.transformIds, "receipt identity transformIds", {
    maxItems: MAX_TRANSFORM_IDS,
    maxLength: MAX_TRANSFORM_ID_LENGTH,
    pattern: RECEIPT_ID_RE,
  });
  if (!RUNTIME_RECEIPT_RUNTIME_MODES.includes(input.identity.runtimeMode)) {
    throw new TypeError(`unsupported receipt runtime mode: ${String(input.identity.runtimeMode)}`);
  }
  if (input.kind !== "effect" && (!input.identity.providerId || !input.identity.adapterId)) {
    throw new TypeError("model receipt identity requires providerId and adapterId");
  }

  assertPlainRecord(input.callIndex, "receipt callIndex");
  assertOnlyKeys(input.callIndex, RECEIPT_CALL_INDEX_KEYS, "receipt callIndex");
  assertNonNegativeInteger(input.callIndex.attemptIndex, "receipt attemptIndex");
  assertNonNegativeInteger(input.callIndex.modelCallIndex, "receipt modelCallIndex");
  assertNonNegativeInteger(input.callIndex.wireAttemptIndex, "receipt wireAttemptIndex");

  assertPlainRecord(input.content, "receipt content");
  assertOnlyKeys(input.content, RECEIPT_CONTENT_KEYS, "receipt content");
  assertDigest(input.content.correlationDigest, "receipt content correlationDigest", true);
  assertDigest(
    input.content.logicalDigest,
    "receipt content logicalDigest",
    input.kind === "shadow_context" || input.kind === "context",
  );
  assertDigest(
    input.content.wireDigest,
    "receipt content wireDigest",
    input.kind === "shadow_wire" || input.kind === "wire",
  );
  assertDigest(input.content.policyDigest, "receipt content policyDigest", false);
  assertBudget(input.content.budget, "receipt content budget");
  assertCanonicalStringArray(input.content.selected, "receipt content selected", {
    maxItems: MAX_RECEIPT_REFERENCES,
    maxLength: MAX_RECEIPT_REFERENCE_LENGTH,
    pattern: RECEIPT_REFERENCE_RE,
  });
  assertCanonicalStringArray(input.content.omitted, "receipt content omitted", {
    maxItems: MAX_RECEIPT_REFERENCES,
    maxLength: MAX_RECEIPT_REFERENCE_LENGTH,
    pattern: RECEIPT_REFERENCE_RE,
  });
  const selected = new Set(input.content.selected ?? []);
  if ((input.content.omitted ?? []).some((reference) => selected.has(reference))) {
    throw new TypeError("receipt content selected and omitted references must be disjoint");
  }
}

export type DeleteReceiptPolicy = {
  /** Delete only receipts of these kinds (required; empty rejects the call). */
  kinds: RuntimeReceiptKind[];
  /** Delete only receipts older than now - maxAgeMs. */
  maxAgeMs: number;
  /** Hard upper bound; refuse a policy that could delete the whole table. */
  now?: number;
};

export type DeleteReceiptResult = { deleted: number };

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function receiptContentDigest(
  identity: ReceiptIdentity,
  callIndex: ReceiptCallIndex,
  content: ReceiptContent,
): string {
  return sha256Text(
    JSON.stringify({
      identity: {
        sessionKey: identity.sessionKey ?? null,
        runId: identity.runId ?? null,
        traceId: identity.traceId ?? null,
        providerId: identity.providerId ?? null,
        adapterId: identity.adapterId ?? null,
        transformIds: identity.transformIds?.length ? identity.transformIds : null,
        runtimeMode: identity.runtimeMode,
      },
      callIndex: {
        attemptIndex: callIndex.attemptIndex,
        modelCallIndex: callIndex.modelCallIndex,
        wireAttemptIndex: callIndex.wireAttemptIndex,
      },
      content: {
        logicalDigest: content.logicalDigest ?? null,
        wireDigest: content.wireDigest ?? null,
        correlationDigest: content.correlationDigest,
        selected: content.selected?.length ? content.selected : null,
        omitted: content.omitted?.length ? content.omitted : null,
        budget: content.budget
          ? content.budget.unit === "chars"
            ? {
                unit: content.budget.unit,
                charsRequested: content.budget.charsRequested,
                charsApplied: content.budget.charsApplied,
              }
            : {
                unit: content.budget.unit,
                inputLimit: content.budget.inputLimit,
                outputLimit: content.budget.outputLimit,
              }
          : null,
        policyDigest: content.policyDigest ?? null,
      },
    }),
  );
}

/**
 * Narrow ReceiptStore: append-only put with content-sensitive idempotency, typed
 * queries, and an explicit lifecycle-policy delete. Writes go through the shared
 * openclaw-state immediate transaction so they are durable and atomic.
 */
export class ReceiptStore {
  #database: OpenClawStateDatabaseOptions = {};

  constructor(options: OpenClawStateDatabaseOptions = {}) {
    this.#database = options;
  }

  /** Append a receipt. Validation/storage errors propagate to the caller;
   *  shadow callers catch them and record failed evidence without changing
   *  send behavior. */
  put(input: PutReceiptInput): PutReceiptResult {
    validatePutReceiptInput(input);
    // The digest is an internal fact. Callers cannot forge it or influence the
    // idempotency comparison by supplying a precomputed value.
    const contentDigest = receiptContentDigest(input.identity, input.callIndex, input.content);
    let outcome: PutReceiptResult | undefined;
    runOpenClawStateWriteTransaction(({ db }) => {
      const query = getNodeSqliteKysely<RuntimeReceiptDatabase>(db);
      const existing = executeSqliteQueryTakeFirstSync(
        db,
        query
          .selectFrom("runtime_receipts")
          .selectAll()
          .where("idempotency_key", "=", input.idempotencyKey),
      );
      if (existing) {
        // Kind/version are stored outside the stable content digest. A key
        // collision must not turn one receipt type into evidence for another.
        if (
          existing.kind === input.kind &&
          existing.version === input.version &&
          existing.content_digest === contentDigest
        ) {
          outcome = {
            ok: true,
            duplicate: true,
            receiptId: existing.receipt_id,
            inserted: false,
            reason: "identical-content",
          };
          return;
        }
        outcome = {
          ok: false,
          duplicate: true,
          receiptId: existing.receipt_id,
          inserted: false,
          reason: "content-conflict",
          existing: existing.content_digest,
        };
        return;
      }
      const receiptId = `rcpt_${randomUUID()}`;
      const row: RuntimeReceiptInsert = {
        receipt_id: receiptId,
        idempotency_key: input.idempotencyKey,
        kind: input.kind,
        runtime_mode: input.identity.runtimeMode,
        version: input.version,
        session_key: input.identity.sessionKey ?? null,
        run_id: input.identity.runId ?? null,
        trace_id: input.identity.traceId ?? null,
        attempt_index: input.callIndex.attemptIndex,
        model_call_index: input.callIndex.modelCallIndex,
        wire_attempt_index: input.callIndex.wireAttemptIndex,
        provider_id: input.identity.providerId ?? null,
        adapter_id: input.identity.adapterId ?? null,
        transform_ids_json: input.identity.transformIds?.length
          ? JSON.stringify(input.identity.transformIds)
          : null,
        selected_json: input.content.selected?.length
          ? JSON.stringify(input.content.selected)
          : null,
        omitted_json: input.content.omitted?.length ? JSON.stringify(input.content.omitted) : null,
        budget_json: serializeBudget(input.content.budget),
        policy_digest: input.content.policyDigest ?? null,
        logical_digest: input.content.logicalDigest ?? null,
        wire_digest: input.content.wireDigest ?? null,
        correlation_digest: input.content.correlationDigest,
        content_digest: contentDigest,
        created_at: input.createdAt ?? Date.now(),
      };
      executeSqliteQuerySync(db, query.insertInto("runtime_receipts").values(row));
      outcome = { ok: true, duplicate: false, receiptId, inserted: true };
    }, this.#database);
    if (!outcome) {
      throw new Error("ReceiptStore.put did not complete a transaction outcome");
    }
    return outcome;
  }

  /** Get one receipt by idempotency key. */
  getByIdempotencyKey(idempotencyKey: string): RuntimeReceiptRow | undefined {
    const { db } = openOpenClawStateDatabase(this.#database);
    const query = getNodeSqliteKysely<RuntimeReceiptDatabase>(db);
    return executeSqliteQueryTakeFirstSync(
      db,
      query
        .selectFrom("runtime_receipts")
        .selectAll()
        .where("idempotency_key", "=", idempotencyKey),
    );
  }

  /** Query receipts by kind, optionally scoped to a run, attempt/call indexes, or correlation digest. */
  list(
    options: {
      kind?: RuntimeReceiptKind;
      runId?: string;
      attemptIndex?: number;
      modelCallIndex?: number;
      correlationDigest?: string;
      limit?: number;
    } = {},
  ): RuntimeReceiptRow[] {
    const { db } = openOpenClawStateDatabase(this.#database);
    const query = getNodeSqliteKysely<RuntimeReceiptDatabase>(db);
    let builder = query.selectFrom("runtime_receipts").selectAll();
    if (options.kind) builder = builder.where("kind", "=", options.kind);
    if (options.runId) builder = builder.where("run_id", "=", options.runId);
    if (options.attemptIndex !== undefined)
      builder = builder.where("attempt_index", "=", options.attemptIndex);
    if (options.modelCallIndex !== undefined)
      builder = builder.where("model_call_index", "=", options.modelCallIndex);
    if (options.correlationDigest)
      builder = builder.where("correlation_digest", "=", options.correlationDigest);
    builder = builder.orderBy("created_at", "desc");
    if (options.limit) builder = builder.limit(options.limit);
    return executeSqliteQuerySync<RuntimeReceiptRow>(db, builder).rows;
  }

  /**
   * R5-3: join v1 ContextReceipt and WireReceipt rows that share one
   * correlation_digest. Returns only complete pairs; no new table.
   */
  joinByCorrelation(
    options: {
      runId?: string;
      correlationDigest?: string;
      limit?: number;
    } = {},
  ): RuntimeReceiptPair[] {
    const { db } = openOpenClawStateDatabase(this.#database);
    const query = getNodeSqliteKysely<RuntimeReceiptDatabase>(db);
    let builder = query
      .selectFrom("runtime_receipts")
      .selectAll()
      .where("kind", "in", ["context", "wire"] as const)
      .where("version", "=", "1");
    if (options.runId) builder = builder.where("run_id", "=", options.runId);
    if (options.correlationDigest)
      builder = builder.where("correlation_digest", "=", options.correlationDigest);
    builder = builder.orderBy("created_at", "desc");
    if (options.limit) builder = builder.limit(options.limit);
    const rows = executeSqliteQuerySync<RuntimeReceiptRow>(db, builder).rows;
    const byCorrelation = new Map<
      string,
      { context?: RuntimeReceiptRow; wire?: RuntimeReceiptRow }
    >();
    for (const row of rows) {
      const digest = row.correlation_digest;
      if (!digest) continue;
      const entry = byCorrelation.get(digest) ?? {};
      if (row.kind === "context" && !entry.context) entry.context = row;
      if (row.kind === "wire" && !entry.wire) entry.wire = row;
      byCorrelation.set(digest, entry);
    }
    return [...byCorrelation.entries()]
      .filter(([, entry]) => entry.context !== undefined && entry.wire !== undefined)
      .map(([correlationDigest, entry]) => ({
        correlationDigest,
        context: entry.context!,
        wire: entry.wire!,
      }));
  }

  /**
   * Explicit lifecycle-policy delete. Refuses empty kind lists and unbounded
   * age so no silent pruning is possible. Returns the number of deleted rows.
   */
  deleteByPolicy(policy: DeleteReceiptPolicy): DeleteReceiptResult {
    if (!policy.kinds.length) throw new Error("deleteByPolicy requires at least one receipt kind");
    if (!Number.isFinite(policy.maxAgeMs) || policy.maxAgeMs <= 0) {
      throw new Error("deleteByPolicy requires a positive maxAgeMs");
    }
    let deleted = 0;
    const now = policy.now ?? Date.now();
    const cutoff = now - policy.maxAgeMs;
    runOpenClawStateWriteTransaction(({ db }) => {
      const query = getNodeSqliteKysely<RuntimeReceiptDatabase>(db);
      const builder = query
        .deleteFrom("runtime_receipts")
        .where("created_at", "<", cutoff)
        .where("kind", "in", policy.kinds);
      const result = executeSqliteQuerySync(db, builder);
      deleted = Number(result.numAffectedRows ?? 0n);
    }, this.#database);
    return { deleted };
  }

  /** Drop all rows; for test isolation only, never used by runtime code. */
  clearForTest(): void {
    runOpenClawStateWriteTransaction(({ db }) => {
      const query = getNodeSqliteKysely<RuntimeReceiptDatabase>(db);
      executeSqliteQuerySync(db, query.deleteFrom("runtime_receipts"));
    }, this.#database);
  }
}
