import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeRequestEnvelope } from "../../../shared/types/context-control-plane/artifacts.js";
import { closeOpenClawStateDatabase } from "../state/openclaw-state-db.js";
import {
  createCompilePlan,
  type CompilePlan,
} from "../context-engine/compile-plan.js";
import { RC03_SEAL_POLICY_DIGEST } from "../context-engine/rc03-seal-hook.js";
import { registerRc03SealProducers } from "../context-engine/rc03-producers.js";
import {
  resetSealRegistryForTests,
} from "../context-engine/seal-registry.js";
import { buildGuardedModelFetch } from "./provider-transport-fetch.js";
import { ReceiptStore } from "./receipt-store.js";
import {
  getShadowCensusDiagnostics,
  resetShadowCensusDiagnosticsForTest,
} from "./shadow-census.js";
import {
  buildStage1RequestEnvelope,
  computeStage1EnvelopeDigest,
} from "./stage1-request-envelope.js";

const tempRoots: string[] = [];
let stateDir = "";

function options() {
  return { env: process.env, path: path.join(stateDir, "openclaw-state.db") };
}

function makePlan(runId = "run-envelope"): CompilePlan {
  return createCompilePlan({
    sessionKey: "sess-envelope",
    runId,
    providerId: "deepseek",
    adapterId: "openai-completions",
    policyDigest: RC03_SEAL_POLICY_DIGEST,
    callIndex: { attemptIndex: 0, planRevision: 0, modelCallIndex: 0, wireAttemptIndex: 0 },
    preSealProducers: [
      { producerId: "dcs-knowledge", producerVersion: "1", applied: true },
    ],
    postSealTransformIds: ["transport-wire-serialization"],
  });
}

function makeShadow(plan: CompilePlan) {
  return {
    enabled: true,
    sourceRuntime: true,
    database: options(),
    sessionKey: "sess-envelope",
    runId: "run-envelope",
    attemptIndex: 0,
    modelCallIndex: 0,
    rc03Plan: plan,
    correlationDigest: "a".repeat(64),
  };
}

function makeBody() {
  return {
    model: "deepseek-v4-flash",
    messages: [
      { role: "system", content: "system prompt" },
      { role: "user", content: "hello" },
      {
        role: "user",
        content: [
          { type: "text", text: "with image" },
          { type: "image_url", image_url: { url: "https://example.test/a.png" } },
        ],
      },
    ],
    tools: [{ type: "function", function: { name: "write" } }],
  };
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage1-envelope-"));
  tempRoots.push(root);
  stateDir = path.join(root, "state");
  fs.mkdirSync(stateDir, { recursive: true });
  process.env.OPENCLAW_STATE_DIR = stateDir;
  resetSealRegistryForTests();
  registerRc03SealProducers();
  resetShadowCensusDiagnosticsForTest();
});

afterEach(() => {
  closeOpenClawStateDatabase();
  delete process.env.OPENCLAW_STATE_DIR;
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("stage1 RequestEnvelope observation", () => {
  it("covers system/messages/tools/media/transforms and validates the frozen schema", () => {
    const plan = makePlan();
    const built = buildStage1RequestEnvelope({
      body: makeBody(),
      bodyText: JSON.stringify(makeBody()),
      providerId: "deepseek",
      adapterId: "openai-completions",
      modelId: "deepseek-v4-flash",
      url: "https://api.deepseek.com/v1/chat/completions",
      method: "POST",
      endpointClass: "public",
      wireAttemptIndex: 0,
      shadow: makeShadow(plan),
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(() => normalizeRequestEnvelope(built.envelope)).not.toThrow();
    expect(built.envelope.system).toHaveLength(1);
    expect(built.envelope.messages).toHaveLength(2);
    expect(built.envelope.tools).toHaveLength(1);
    expect(built.envelope.media).toHaveLength(1);
    expect(built.envelope.transforms.length).toBeGreaterThanOrEqual(1);
    expect(built.envelope.transforms.map((entry) => entry.id)).toContain("transport-wire-serialization");
    expect(built.envelopeDigest).toBe(built.envelope.envelopeDigest);
  });

  it("produces a stable digest and changes when content changes", () => {
    const plan = makePlan();
    const shadow = makeShadow(plan);
    const first = buildStage1RequestEnvelope({
      body: makeBody(),
      bodyText: JSON.stringify(makeBody()),
      providerId: "deepseek",
      adapterId: "openai-completions",
      modelId: "deepseek-v4-flash",
      url: "https://api.deepseek.com/v1/chat/completions",
      method: "POST",
      endpointClass: "public",
      wireAttemptIndex: 0,
      shadow,
    });
    const second = buildStage1RequestEnvelope({
      body: makeBody(),
      bodyText: JSON.stringify(makeBody()),
      providerId: "deepseek",
      adapterId: "openai-completions",
      modelId: "deepseek-v4-flash",
      url: "https://api.deepseek.com/v1/chat/completions",
      method: "POST",
      endpointClass: "public",
      wireAttemptIndex: 0,
      shadow,
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.envelope.envelopeDigest).toBe(second.envelope.envelopeDigest);
    const changedBody = { ...makeBody(), messages: [{ role: "user", content: "changed" }] };
    const changed = buildStage1RequestEnvelope({
      body: changedBody,
      bodyText: JSON.stringify(changedBody),
      providerId: "deepseek",
      adapterId: "openai-completions",
      modelId: "deepseek-v4-flash",
      url: "https://api.deepseek.com/v1/chat/completions",
      method: "POST",
      endpointClass: "public",
      wireAttemptIndex: 0,
      shadow,
    });
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.envelope.envelopeDigest).not.toBe(first.envelope.envelopeDigest);
  });

  it("diagnoses missing plan or identity without changing send behavior", () => {
    const plan = makePlan();
    expect(buildStage1RequestEnvelope({
      body: makeBody(),
      bodyText: JSON.stringify(makeBody()),
      providerId: "deepseek",
      adapterId: "openai-completions",
      modelId: "deepseek-v4-flash",
      url: "https://api.deepseek.com/v1/chat/completions",
      method: "POST",
      endpointClass: "public",
      wireAttemptIndex: 0,
      shadow: { ...makeShadow(plan), rc03Plan: undefined },
    })).toMatchObject({ ok: false, reason: "request-envelope-incomplete" });
    expect(buildStage1RequestEnvelope({
      body: makeBody(),
      bodyText: JSON.stringify(makeBody()),
      providerId: "deepseek",
      adapterId: "openai-completions",
      modelId: "deepseek-v4-flash",
      url: "https://api.deepseek.com/v1/chat/completions",
      method: "POST",
      endpointClass: "public",
      wireAttemptIndex: 0,
      shadow: { ...makeShadow(plan), sessionKey: undefined },
    })).toMatchObject({ ok: false, reason: "request-envelope-identity-missing" });
  });

  it("flag-off and flag-on guarded fetch send identical bytes; wire receipt carries the envelope ref", async () => {
    const bodies: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? new Request(input, init) : new Request(input, init);
      bodies.push(await request.clone().text());
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const model = {
      provider: "deepseek",
      api: "openai-completions",
      id: "deepseek-v4-flash",
      name: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.com/v1",
      reasoning: false,
      input: ["text"],
      maxTokens: 4096,
      contextWindow: 128000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    } as never;
    const body = JSON.stringify(makeBody());
    try {
      const off = buildGuardedModelFetch(model, undefined, { sanitizeSse: false });
      const offResponse = await off("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      expect(offResponse.status).toBe(200);

      const plan = makePlan();
      const on = buildGuardedModelFetch(model, undefined, { sanitizeSse: false }, makeShadow(plan));
      const onResponse = await on("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      expect(onResponse.status).toBe(200);
      expect(bodies).toHaveLength(2);
      expect(bodies[1]).toBe(bodies[0]);

      const store = new ReceiptStore(options());
      const wire = store.list({ kind: "wire", runId: "run-envelope" }).find((row) => row.version === "1");
      expect(wire).toBeDefined();
      expect(wire?.wire_digest).toMatch(/^[a-f0-9]{64}$/);
      const selected = JSON.parse(wire?.selected_json ?? "[]") as string[];
      const envelopeRef = selected.find((value) => value.startsWith("ref:request-envelope:"));
      expect(envelopeRef).toBeDefined();
      expect(envelopeRef?.startsWith("ref:request-envelope:")).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reports unregistered semantic and post-seal transforms instead of silently skipping them", () => {
    const plan = createCompilePlan({
      sessionKey: "sess-envelope",
      runId: "run-envelope",
      providerId: "deepseek",
      adapterId: "openai-completions",
      policyDigest: RC03_SEAL_POLICY_DIGEST,
      callIndex: { attemptIndex: 0, planRevision: 0, modelCallIndex: 0, wireAttemptIndex: 0 },
      preSealProducers: [
        { producerId: "unknown-semantic-bypass", producerVersion: "1", applied: true },
      ],
      postSealTransformIds: ["transport-wire-serialization", "unknown-post-seal-transform"],
    });
    const built = buildStage1RequestEnvelope({
      body: makeBody(),
      bodyText: JSON.stringify(makeBody()),
      providerId: "deepseek",
      adapterId: "openai-completions",
      modelId: "deepseek-v4-flash",
      url: "https://api.deepseek.com/v1/chat/completions",
      method: "POST",
      endpointClass: "public",
      wireAttemptIndex: 0,
      shadow: makeShadow(plan),
    });
    expect(built).toMatchObject({
      ok: false,
      reason: "unregistered-transform",
      unregisteredTransformIds: expect.arrayContaining([
        "unknown-semantic-bypass",
        "unknown-post-seal-transform",
      ]),
    });
  });

  it("diagnoses an unregistered transform at the guarded fetch boundary without changing sent bytes", async () => {
    const bodies: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? new Request(input, init) : new Request(input, init);
      bodies.push(await request.clone().text());
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const model = {
      provider: "deepseek",
      api: "openai-completions",
      id: "deepseek-v4-flash",
      name: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.com/v1",
      reasoning: false,
      input: ["text"],
      maxTokens: 4096,
      contextWindow: 128000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    } as never;
    const body = JSON.stringify(makeBody());
    try {
      const off = buildGuardedModelFetch(model, undefined, { sanitizeSse: false });
      const offResponse = await off("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      expect(offResponse.status).toBe(200);

      const plan = createCompilePlan({
        sessionKey: "sess-envelope",
        runId: "run-envelope",
        providerId: "deepseek",
        adapterId: "openai-completions",
        policyDigest: RC03_SEAL_POLICY_DIGEST,
        callIndex: { attemptIndex: 0, planRevision: 0, modelCallIndex: 0, wireAttemptIndex: 0 },
        preSealProducers: [],
        postSealTransformIds: ["transport-wire-serialization", "unknown-post-seal-transform"],
      });
      const on = buildGuardedModelFetch(model, undefined, { sanitizeSse: false }, makeShadow(plan));
      const onResponse = await on("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      expect(onResponse.status).toBe(200);
      expect(bodies).toHaveLength(2);
      expect(bodies[1]).toBe(bodies[0]);
      expect(getShadowCensusDiagnostics()).toMatchObject({
        acceptanceReady: false,
        failures: expect.arrayContaining([
          { phase: "wire-capture", code: "unregistered-transform", count: 1 },
        ]),
      });
      const wire = new ReceiptStore(options())
        .list({ kind: "wire", runId: "run-envelope" })
        .find((row) => row.version === "1");
      expect(wire).toBeDefined();
      expect(wire?.selected_json).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("computeStage1EnvelopeDigest is deterministic over the digest-excluded fields", () => {
    const plan = makePlan();
    const built = buildStage1RequestEnvelope({
      body: makeBody(),
      bodyText: JSON.stringify(makeBody()),
      providerId: "deepseek",
      adapterId: "openai-completions",
      modelId: "deepseek-v4-flash",
      url: "https://api.deepseek.com/v1/chat/completions",
      method: "POST",
      endpointClass: "public",
      wireAttemptIndex: 0,
      shadow: makeShadow(plan),
    });
    if (!built.ok) throw new Error("build failed");
    const { envelopeId: _ignored, createdAt: _created, envelopeDigest: _digest, ...without } = built.envelope;
    expect(computeStage1EnvelopeDigest(without)).toBe(built.envelope.envelopeDigest);
  });
});
