// @vitest-environment node
// S06: memory self-edit writes correlate with the RC-04 EffectReceipt model.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeOpenClawStateDatabase } from "../state/openclaw-state-db.js";
import { EffectReceiptStore } from "../agents/effect-receipt.js";
import {
  buildMemoryEffectReceipt,
  memoryEffectIdempotencyKey,
  recordMemoryEffect,
  type MemoryEffectReceiptInput,
  type MemoryEffectReceiptSink,
} from "./memory-effect-receipt.js";
import { memoryUpdateTool } from "./memory-self-edit-tools.js";
import { RuntimeMemoryStore } from "./memory-store.js";
import { buildRuntimeMemoryTemporalFactFixture } from "./memory-context.js";

const tempRoots: string[] = [];

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "memory-effect-"));
  tempRoots.push(root);
  const stateDir = path.join(root, "state");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.join(root, "home"), { recursive: true });
  process.env.OPENCLAW_HOME = path.join(root, "home");
  process.env.OPENCLAW_STATE_DIR = stateDir;
});

afterEach(() => {
  closeOpenClawStateDatabase();
  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_STATE_DIR;
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fact(id: string) {
  return buildRuntimeMemoryTemporalFactFixture({
    factId: id,
    subject: "S06",
    predicate: "has",
    objectSummary: `Fact ${id}.`,
    confidence: 0.7,
    source: "tool_result",
    verificationStatus: "verified",
    valid_at: 100,
    reference_time: 100,
    acceptedAt: 100,
    sourceEpisodeRefs: [{ episodeId: "ep", taskId: "task", kind: "verifier_summary", idempotencyKey: `task:${id}`, reference_time: 10 }],
    evidenceRefs: [{ type: "test", ref: "memory-effect-receipt.test.ts" }],
  });
}

const identity = { sessionKey: "sess-s06", runId: "run-s06", toolCallId: "call-s06", attemptIndex: 0, modelCallIndex: 0 };

function input(over: Partial<MemoryEffectReceiptInput> = {}): MemoryEffectReceiptInput {
  return { action: "memory_update", factId: "fact-1", outcome: "applied", identity, ...over };
}

describe("S06 memory effect receipt", () => {
  it("derives a deterministic per-intent idempotency key that ignores the outcome", () => {
    const applied = memoryEffectIdempotencyKey(input({ outcome: "applied" }));
    const unknown = memoryEffectIdempotencyKey(input({ outcome: "unknown" }));
    expect(applied).toBe(unknown);
    expect(memoryEffectIdempotencyKey(input({ factId: "fact-2" }))).not.toBe(applied);
  });

  it("keeps the proposal digest-only (identifiers, never memory content)", () => {
    const receipt = buildMemoryEffectReceipt(input({ newFactId: "fact-1_new" }));
    expect(receipt.proposal).toEqual({ domain: "runtime-memory", action: "memory_update", factId: "fact-1", newFactId: "fact-1_new" });
    const serialized = JSON.stringify(receipt);
    for (const contentWord of ["objectSummary", "subject", "predicate", "Fact "]) {
      expect(serialized.includes(contentWord)).toBe(false);
    }
    expect(receipt.stage1Context?.actor).toMatchObject({ sessionKey: "sess-s06", runId: "run-s06", actorKind: "principal" });
    expect(receipt.stage1Context?.effect).toMatchObject({ toolCallId: "call-s06", toolName: "memory_update", resource: "fact-1" });
  });

  it("is fail-open and does nothing without a sink", () => {
    const throwing: MemoryEffectReceiptSink = { record() { throw new Error("sink down"); } };
    expect(() => recordMemoryEffect({ effectReceiptStore: throwing }, input())).not.toThrow();
    expect(recordMemoryEffect({ effectReceiptStore: throwing }, input())).toBe(true);
    expect(recordMemoryEffect({}, input())).toBe(false);
  });

  it("records one row per memory write through the real store, and replays as a duplicate", () => {
    const realStore = new EffectReceiptStore();
    const captured: Array<{ idempotencyKey: string; outcome: string }> = [];
    const results: Array<{ ok: boolean; duplicate?: boolean; effectReceiptId?: string }> = [];
    const sink: MemoryEffectReceiptSink = {
      record: (value) => {
        captured.push({ idempotencyKey: value.idempotencyKey, outcome: value.outcome });
        const result = realStore.record(value as never) as { ok: boolean; duplicate?: boolean; effectReceiptId?: string };
        results.push(result);
        return result;
      },
    };

    const store = new RuntimeMemoryStore({ now: () => 100 });
    store.appendFact(fact("fact-1"));
    const context = { store, now: 100, effectReceiptStore: sink, effectIdentity: identity };

    const first = memoryUpdateTool.execute({ factId: "fact-1", objectSummary: "updated" }, context);
    expect(first.ok, first.message).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ outcome: "applied" });
    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.duplicate).toBe(false);
    const effectReceiptId = results[0]!.effectReceiptId!;
    expect(realStore.getById(effectReceiptId)).toMatchObject({ domain_executor: "clawx-runtime-memory", outcome: "applied" });

    // Replay the same intent: same idempotency key -> identical content -> duplicate, no second effect.
    const replay = memoryUpdateTool.execute({ factId: "fact-1", objectSummary: "updated" }, context);
    expect(replay.ok).toBe(true);
    expect(captured).toHaveLength(2);
    expect(captured[0]!.idempotencyKey).toBe(captured[1]!.idempotencyKey);
    expect(results[1]).toMatchObject({ ok: true, duplicate: true, effectReceiptId });
  });

  it("preserves an unknown outcome rather than disguising it as applied", () => {
    const sink = new EffectReceiptStore();
    const recorded: unknown[] = [];
    const spy: MemoryEffectReceiptSink = { record: (value) => { recorded.push(value); return sink.record(value as never); } };
    recordMemoryEffect({ effectReceiptStore: spy }, input({ outcome: "unknown" }));
    expect(recorded).toHaveLength(1);
    expect((recorded[0] as { outcome: string }).outcome).toBe("unknown");
  });
});