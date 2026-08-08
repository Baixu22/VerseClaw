import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import { ReceiptStore, receiptContentDigest, type PutReceiptInput } from "./receipt-store.js";
import {
  closeOpenClawStateDatabase,
  openOpenClawStateDatabase,
} from "../state/openclaw-state-db.js";

const tempRoots: string[] = [];
let stateDir = "";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function makeIdentity(overrides: Partial<PutReceiptInput["identity"]> = {}) {
  return {
    runtimeMode: "source" as const,
    providerId: "anthropic",
    adapterId: "anthropic-messages",
    ...overrides,
  };
}

function makeCallIndex(overrides: Partial<PutReceiptInput["callIndex"]> = {}) {
  return { attemptIndex: 0, modelCallIndex: 0, wireAttemptIndex: 0, ...overrides };
}

let receiptCounter = 0;

function makeReceipt(overrides: Partial<PutReceiptInput> = {}): PutReceiptInput {
  receiptCounter += 1;
  const base = {
    idempotencyKey: `rc02-${receiptCounter}`,
    kind: "shadow_context" as const,
    version: "0",
    identity: makeIdentity(),
    callIndex: makeCallIndex(),
    content: {
      correlationDigest: digest(`corr-${receiptCounter}`),
      logicalDigest: digest(`logical-${receiptCounter}`),
    },
  };
  const merged = { ...base, ...overrides };
  const content = { ...base.content, ...overrides.content };
  if (
    (merged.kind === "shadow_wire" || merged.kind === "wire") &&
    content.wireDigest === undefined
  ) {
    content.wireDigest = digest(`wire-${receiptCounter}`);
  }
  return {
    ...merged,
    content,
  };
}

function newStore() {
  return new ReceiptStore({ env: process.env, path: path.join(stateDir, "openclaw-state.db") });
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rc02-receipt-store-"));
  tempRoots.push(root);
  stateDir = path.join(root, "state");
  fs.mkdirSync(stateDir, { recursive: true });
  process.env.OPENCLAW_HOME = path.join(root, "home");
  process.env.OPENCLAW_STATE_DIR = stateDir;
  fs.mkdirSync(path.join(root, "home"), { recursive: true });
});

afterEach(() => {
  closeOpenClawStateDatabase();
  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_STATE_DIR;
  delete process.env.OPENCLAW_CONFIG_PATH;
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("ReceiptStore (runtime_receipts via openclaw-state SQLite)", () => {
  it("appends a shadow receipt and reads it back by idempotency key", () => {
    const store = newStore();
    const input = makeReceipt({ kind: "shadow_context" });
    const result = store.put(input);
    expect(result.ok).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(result.inserted).toBe(true);
    expect(result.receiptId).toMatch(/^rcpt_/);

    const row = store.getByIdempotencyKey(input.idempotencyKey);
    expect(row).toBeDefined();
    expect(row!.kind).toBe("shadow_context");
    expect(row!.runtime_mode).toBe("source");
    expect(row!.provider_id).toBe("anthropic");
    expect(row!.attempt_index).toBe(0);
    expect(row!.model_call_index).toBe(0);
    expect(row!.wire_attempt_index).toBe(0);
    expect(row!.logical_digest).toBe(digest("logical-1"));
    expect(row!.content_digest).toBe(
      receiptContentDigest(input.identity, input.callIndex, input.content),
    );
  });

  it("is idempotent when the same idempotency key has identical content", () => {
    const store = newStore();
    const input = makeReceipt({ idempotencyKey: "same-key", kind: "shadow_wire" });
    const first = store.put(input);
    expect(first.ok).toBe(true);
    expect(first.inserted).toBe(true);
    const second = store.put(input);
    expect(second.ok).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(second.inserted).toBe(false);
    expect(second.reason).toBe("identical-content");
    // Only one row exists.
    expect(store.list({ kind: "shadow_wire" })).toHaveLength(1);
  });

  it("conflict-fails when the same idempotency key has different content (hard constraint 2)", () => {
    const store = newStore();
    const input = makeReceipt({ idempotencyKey: "conflict-key", kind: "shadow_wire" });
    expect(store.put(input).ok).toBe(true);
    const conflicting = makeReceipt({
      idempotencyKey: "conflict-key",
      kind: "shadow_wire",
      content: { correlationDigest: digest("corr-1"), wireDigest: digest("different-wire-digest") },
    });
    const result = store.put(conflicting);
    expect(result.ok).toBe(false);
    expect(result.duplicate).toBe(true);
    expect(result.reason).toBe("content-conflict");
    expect(result.existing).toBe(
      receiptContentDigest(input.identity, input.callIndex, input.content),
    );
    // The conflicting content was NOT written.
    expect(store.list({ kind: "shadow_wire" })).toHaveLength(1);
  });

  it("uses explicit attempt/model-call/wire-attempt identity, not max(sequence)+1 (hard constraint 3)", () => {
    const store = newStore();
    const storeInputs: PutReceiptInput[] = [];
    for (const [attemptIndex, modelCallIndex, wireAttemptIndex] of [
      [0, 0, 0],
      [0, 1, 0],
      [1, 0, 0],
      [1, 0, 1],
    ] as const) {
      const input = makeReceipt({
        kind: "shadow_wire",
        callIndex: makeCallIndex({ attemptIndex, modelCallIndex, wireAttemptIndex }),
      });
      expect(store.put(input).ok).toBe(true);
      storeInputs.push(input);
    }
    const rows = store.list({ kind: "shadow_wire" });
    expect(rows).toHaveLength(4);
    const indexes = rows.map((row) => [
      row.attempt_index,
      row.model_call_index,
      row.wire_attempt_index,
    ]);
    for (const [a, m, w] of indexes) {
      expect(
        storeInputs.some(
          (i) =>
            i.callIndex.attemptIndex === a &&
            i.callIndex.modelCallIndex === m &&
            i.callIndex.wireAttemptIndex === w,
        ),
      ).toBe(true);
    }
    // Each row carries its explicit identity; there is no sequence column.
    for (const row of rows) {
      expect(row.attempt_index).toBeGreaterThanOrEqual(0);
      expect(row.model_call_index).toBeGreaterThanOrEqual(0);
      expect(row.wire_attempt_index).toBeGreaterThanOrEqual(0);
    }
  });

  it("refuses unbounded deletion and deletes only under an explicit lifecycle policy (hard constraint 4)", () => {
    const store = newStore();
    const old = makeReceipt({ kind: "shadow_context", createdAt: Date.now() - 60_000 });
    const fresh = makeReceipt({ kind: "shadow_context", createdAt: Date.now() });
    expect(store.put(old).ok).toBe(true);
    expect(store.put(fresh).ok).toBe(true);

    expect(() => store.deleteByPolicy({ kinds: [], maxAgeMs: 1_000 })).toThrow(
      /at least one receipt kind/,
    );
    expect(() => store.deleteByPolicy({ kinds: ["shadow_context"], maxAgeMs: 0 })).toThrow(
      /positive maxAgeMs/,
    );

    const result = store.deleteByPolicy({
      kinds: ["shadow_context"],
      maxAgeMs: 30_000,
      now: Date.now(),
    });
    expect(result.deleted).toBe(1);
    // The fresh receipt survives; only the old one was pruned under policy.
    expect(store.list({ kind: "shadow_context" })).toHaveLength(1);
  });

  it("records only digests/refs/indexes, never raw prompt or tool output (hard constraint 1)", () => {
    const store = newStore();
    const input = makeReceipt({
      idempotencyKey: "no-raw",
      kind: "shadow_wire",
      content: {
        correlationDigest: digest("corr-no-raw"),
        wireDigest: digest("wire-digest"),
        selected: ["ref:file:src/a.ts:1"],
        omitted: ["ref:memory:card-abc123"],
        budget: { unit: "tokens", inputLimit: 8000, outputLimit: 2000 },
        policyDigest: digest("policy-1"),
      },
    });
    expect(store.put(input).ok).toBe(true);
    const row = store.getByIdempotencyKey("no-raw")!;
    const rowText = JSON.stringify(row);
    // Refs may name a card id, but the raw prompt / tool output / credential
    // content itself is never persisted — only digests and refs.
    expect(rowText).not.toContain("raw-prompt-body");
    expect(rowText).not.toContain("tool-output-body");
    expect(rowText).not.toContain("Bearer sk-");
    expect(row.wire_digest).toBe(digest("wire-digest"));
    expect(row.selected_json).toBe(JSON.stringify(["ref:file:src/a.ts:1"]));
    expect(row.omitted_json).toBe(JSON.stringify(["ref:memory:card-abc123"]));
    expect(row.budget_json).toBe(
      JSON.stringify({ unit: "tokens", inputLimit: 8000, outputLimit: 2000 }),
    );
    expect(row.policy_digest).toBe(digest("policy-1"));
    expect(row.created_at).toBeTypeOf("number");
  });

  it("survives restart by reading the same SQLite rows from a new store instance", () => {
    const input = makeReceipt({ idempotencyKey: "restart-key", kind: "shadow_context" });
    const first = newStore();
    expect(first.put(input).ok).toBe(true);
    // A brand-new ReceiptStore against the same state dir sees the row.
    const second = newStore();
    const row = second.getByIdempotencyKey("restart-key");
    expect(row).toBeDefined();
    expect(row!.content_digest).toBe(
      receiptContentDigest(input.identity, input.callIndex, input.content),
    );
  });

  it("does not throw into the send path on a store-level failure (hard constraint 5)", () => {
    // A closed/missing state DB must not crash the caller; put surfaces a
    // result object. Here we simulate an unusable database path.
    const broken = new ReceiptStore({
      env: process.env,
      path: path.join(stateDir, "does-not-exist", "openclaw-state.db"),
    });
    let result;
    let threw = false;
    try {
      result = broken.put(makeReceipt({ idempotencyKey: "broken-db" }));
    } catch {
      threw = true;
      result = undefined;
    }
    // The narrow store contract is that put resolves to a result and never
    // throws synchronously into the shadow path; callers must fail RC-02
    // acceptance on a non-ok result without changing send behavior.
    expect(threw).toBe(false);
    expect(result).toBeDefined();
  });

  it("recomputes contentDigest and rejects a forged digest before writing", () => {
    const store = newStore();
    const input = makeReceipt({ idempotencyKey: "forged-digest" });
    const forged = {
      ...input,
      content: { ...input.content, contentDigest: "forged" },
    } as unknown as PutReceiptInput;
    expect(() => store.put(forged)).toThrow(/unsupported field: contentDigest/);
    expect(store.list({ kind: "shadow_context" })).toHaveLength(0);
  });

  it("rejects raw payload fields and invalid call indexes before opening a write transaction", () => {
    const store = newStore();
    const raw = {
      ...makeReceipt({ idempotencyKey: "raw-field" }),
      content: { ...makeReceipt().content, prompt: "raw prompt body" },
    } as unknown as PutReceiptInput;
    expect(() => store.put(raw)).toThrow(/unsupported field: prompt/);

    const invalidIndex = makeReceipt({
      idempotencyKey: "negative-index",
      callIndex: makeCallIndex({ modelCallIndex: -1 }),
    });
    expect(() => store.put(invalidIndex)).toThrow(/modelCallIndex/);
    expect(store.list({ kind: "shadow_context" })).toHaveLength(0);
  });

  it("rejects non-canonical object properties, prototypes, arrays, nulls, versions, and digests", () => {
    const store = newStore();
    const inherited = Object.assign(Object.create({ prompt: "raw prompt" }), makeReceipt());
    expect(() => store.put(inherited as PutReceiptInput)).toThrow(/plain object prototype/);

    const symbol = Symbol("credential");
    const symbolInput = makeReceipt() as PutReceiptInput & { [symbol]?: string };
    symbolInput[symbol] = "secret";
    expect(() => store.put(symbolInput)).toThrow(/unsupported symbol field/);

    const hidden = makeReceipt();
    Object.defineProperty(hidden.content, "cookie", { value: "secret", enumerable: false });
    expect(() => store.put(hidden)).toThrow(/unsupported field: cookie/);

    const sparse = makeReceipt({ content: { selected: new Array<string>(1) } });
    expect(() => store.put(sparse)).toThrow(/dense array/);

    const extraArray = ["ref:file:a"];
    (extraArray as string[] & { credential?: string }).credential = "secret";
    expect(() => store.put(makeReceipt({ content: { selected: extraArray } }))).toThrow(
      /unsupported array field/,
    );

    const nullIdentity = makeReceipt();
    (nullIdentity.identity as { sessionKey?: string | null }).sessionKey = null;
    expect(() => store.put(nullIdentity)).toThrow(
      /sessionKey must be a bounded canonical identifier/,
    );

    expect(() => store.put(makeReceipt({ version: "arbitrary" }))).toThrow(
      /unsupported receipt version/,
    );
    expect(() => store.put(makeReceipt({ content: { logicalDigest: "not-a-digest" } }))).toThrow(
      /logicalDigest must be/,
    );
    expect(store.list({ kind: "shadow_context" })).toHaveLength(0);
  });

  it("rejects unbounded identifiers, transforms, refs, budgets, and incomplete model identity", () => {
    const store = newStore();
    expect(() => store.put(makeReceipt({ idempotencyKey: `key-${"x".repeat(512)}` }))).toThrow(
      /idempotencyKey/,
    );
    expect(() =>
      store.put(makeReceipt({ identity: makeIdentity({ adapterId: undefined }) })),
    ).toThrow(/requires providerId and adapterId/);
    expect(() =>
      store.put(makeReceipt({ identity: makeIdentity({ transformIds: ["valid", "valid"] }) })),
    ).toThrow(/duplicate/);
    expect(() => store.put(makeReceipt({ content: { selected: ["arbitrary string"] } }))).toThrow(
      /dense array/,
    );
    expect(() =>
      store.put(makeReceipt({ content: { selected: new Array(65).fill("ref:file:a") } })),
    ).toThrow(/maximum item count/);
    expect(() =>
      store.put(
        makeReceipt({ content: { budget: { unit: "tokens", inputLimit: -1, outputLimit: 10 } } }),
      ),
    ).toThrow(/inputLimit/);
    expect(() =>
      store.put(
        makeReceipt({
          content: { budget: { unit: "tokens", inputLimit: 10, outputLimit: 1_000_000_001 } },
        }),
      ),
    ).toThrow(/outputLimit/);
    const overlap = "ref:context:ctx-1";
    expect(() =>
      store.put(makeReceipt({ content: { selected: [overlap], omitted: [overlap] } })),
    ).toThrow(/must be disjoint/);
  });

  it("accepts canonical refs with URL-encoded context segments (production candidate ids)", () => {
    const store = newStore();
    const input = makeReceipt({
      idempotencyKey: "url-encoded-ref",
      kind: "shadow_wire",
      content: {
        correlationDigest: digest("corr-url-ref"),
        wireDigest: digest("wire-url-ref"),
        selected: [
          "ref:context:context-candidate:dcs-knowledge:knowledge:message:block%3Aknowledge%3A1:1:sha256:b6f6a206c187eeacc3dda64400c65631144ec3d3b531da20e8b9bcbbda5fb7df",
        ],
        omitted: ["ref:context:context-source:dcs-knowledge:knowledge:message"],
      },
    });
    expect(store.put(input)).toMatchObject({ ok: true, duplicate: false });
    const row = store.getByIdempotencyKey("url-encoded-ref")!;
    expect(row.selected_json).toContain("block%3Aknowledge%3A1");
  });

  it("canonicalizes budget key order for content-sensitive idempotency", () => {
    const store = newStore();
    const first = makeReceipt({
      idempotencyKey: "canonical-budget",
      content: { budget: { unit: "tokens", inputLimit: 100, outputLimit: 20 } },
    });
    expect(store.put(first)).toMatchObject({ ok: true, duplicate: false });
    const reorderedBudget = { outputLimit: 20, inputLimit: 100, unit: "tokens" as const };
    expect(
      store.put({ ...first, content: { ...first.content, budget: reorderedBudget } }),
    ).toMatchObject({
      ok: true,
      duplicate: true,
      reason: "identical-content",
    });
  });

  it("enforces receipt version, digest, identity, and index constraints in SQLite", () => {
    const store = newStore();
    const input = makeReceipt({ idempotencyKey: "db-check-source" });
    expect(store.put(input).ok).toBe(true);
    const { db } = openOpenClawStateDatabase({
      env: process.env,
      path: path.join(stateDir, "openclaw-state.db"),
    });
    const row = store.getByIdempotencyKey(input.idempotencyKey)!;
    const values = [
      "rcpt_db_check",
      "db-check-invalid",
      "shadow_context",
      "source",
      "9",
      row.session_key,
      row.run_id,
      row.trace_id,
      -1,
      row.model_call_index,
      row.wire_attempt_index,
      row.provider_id,
      row.adapter_id,
      row.transform_ids_json,
      row.selected_json,
      row.omitted_json,
      row.budget_json,
      row.policy_digest,
      row.logical_digest,
      row.wire_digest,
      row.correlation_digest,
      row.content_digest,
      row.created_at,
    ];
    expect(() =>
      db
        .prepare(
          `INSERT INTO runtime_receipts VALUES (${new Array(values.length).fill("?").join(",")})`,
        )
        .run(...values),
    ).toThrow(/CHECK constraint failed/);
  });
});
