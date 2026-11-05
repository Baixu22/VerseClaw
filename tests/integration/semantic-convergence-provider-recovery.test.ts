// @vitest-environment node
import { createServer, type Server } from "node:http";
import { writeFileSync } from "node:fs";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { buildGuardedModelFetch } from "../../openclaw_runtime/src/agents/provider-transport-fetch";
import { attachModelProviderRequestTransport } from "../../openclaw_runtime/src/agents/provider-request-config";
import { createRequestAttemptBudget, runWithRequestAttemptBudget } from "../../openclaw_runtime/src/agents/request-attempt-budget";
import { coerceToFailoverError } from "../../openclaw_runtime/src/agents/failover-error";
import { createProviderHttpError } from "../../openclaw_runtime/src/agents/provider-http-errors";
import { retryAsync } from "../../openclaw_runtime/src/infra/retry";
import { closeProviderOutboundBudget } from "../../openclaw_runtime/src/agents/provider-outbound-budget";
import type { Model } from "../../openclaw_runtime/src/llm/types";

// Electron's socket owner is replaced only at this test-process seam. Main's
// actual net.fetch/host boundary is covered by the real Electron Setup journey.
vi.mock("@electron/utils/proxy-fetch", () => ({
  proxyAwareFetch: (url: string, init: RequestInit) => fetch(url, init),
}));

const servers: Server[] = [];
const observations: unknown[] = [];
afterEach(async () => {
  closeProviderOutboundBudget();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
afterAll(() => {
  if (process.env.SEMANTIC_HTTP_TRACE_PATH) writeFileSync(process.env.SEMANTIC_HTTP_TRACE_PATH,
    JSON.stringify({ driven_by: "agent", actor: "codex/tf0746", transport: "real local HTTP", observations }, null, 2));
});

async function provider(statuses: number[]) {
  const requests: Array<{ method: string; path: string; status: number }> = [];
  const server = createServer((req, res) => {
    const status = statuses[Math.min(requests.length, statuses.length - 1)];
    requests.push({ method: req.method ?? "", path: req.url ?? "", status });
    req.resume();
    res.writeHead(status, { "content-type": "application/json", "retry-after": "0" });
    res.end(JSON.stringify(status === 200
      ? { id: "fixture", data: [{ id: "fixture-model" }], choices: [{ message: { role: "assistant", content: "recovered" } }] }
      : { error: { message: status === 401 || status === 403 ? "Invalid API key" : "upstream unavailable", type: status >= 500 ? "server_error" : "invalid_request_error" } }));
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing local address");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  const model = attachModelProviderRequestTransport({
    id: "fixture-model", name: "local failure fixture", provider: "custom", api: "openai-completions", baseUrl,
    input: ["text"], reasoning: false, contextWindow: 4096, maxTokens: 128,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  } as Model, { allowPrivateNetwork: true });
  return { requests, baseUrl, model };
}

async function recovery(statuses: number[], maxPhysicalAttempts: number) {
  const endpoint = await provider(statuses);
  const budget = createRequestAttemptBudget({ logicalRequestId: "tf0746-local-http", maxPhysicalAttempts });
  const guarded = buildGuardedModelFetch(endpoint.model, 5000, { sanitizeSse: false });
  let error: unknown;
  let recovered = false;
  try {
    await runWithRequestAttemptBudget(budget, () => retryAsync(async () => {
      const response = await guarded(endpoint.baseUrl + "/chat/completions", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "fixture-model", messages: [] }),
      });
      if (!response.ok) throw await createProviderHttpError(response, "local provider");
      expect((await response.json()).choices[0].message.content).toBe("recovered");
      recovered = true;
    }, { attempts: 5, minDelayMs: 0, maxDelayMs: 0, jitter: 0,
      shouldRetry: failure => {
        if (!(failure instanceof Error)) return false;
        const status = (failure as Error & { status?: number }).status;
        return status === 429 || (typeof status === "number" && status >= 500);
      },
    }));
  } catch (caught) { error = caught; }
  const record = { statuses, maxPhysicalAttempts, physicalRequests: endpoint.requests.length, chargedAttempts: budget.snapshot().attempts.length,
    attempts: budget.snapshot().attempts, recovered, error: error instanceof Error ? error.message : undefined };
  observations.push(record);
  return { ...record, error };
}

describe("TF-0746 provider/retry real local HTTP", () => {
  it("recovers 503/503/200 with three physical requests and three charges", async () => {
    const result = await recovery([503, 503, 200], 3);
    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ recovered: true, physicalRequests: 3, chargedAttempts: 3 });
    expect(result.attempts.map(attempt => attempt.physicalAttempt)).toEqual([1, 2, 3]);
  });
  it.each([401, 403])("does not retry auth rejection %s", async status => {
    const result = await recovery([status, 200], 3);
    expect(result.error).toBeDefined();
    expect(result).toMatchObject({ recovered: false, physicalRequests: 1, chargedAttempts: 1 });
  });
  it("stops before a third request when the two-slot failure budget is exhausted", async () => {
    const result = await recovery([503, 503, 200], 2);
    expect(result.error).toBeDefined();
    expect(result).toMatchObject({ recovered: false, physicalRequests: 2, chargedAttempts: 2 });
  });
  it.each([429, 400, 401, 403])("validation and inference retain truthful failure state for HTTP %s", async status => {
    const endpoint = await provider([status]);
    const { validateApiKeyWithProvider } = await import("@electron/services/providers/provider-validation");
    const validation = await validateApiKeyWithProvider("custom", "test-only-token", { baseUrl: endpoint.baseUrl, apiProtocol: "openai-completions" });
    expect(validation.ready).toBe(false);
    expect(validation.valid).toBe(false);
    expect(validation.reason).toBe(status === 429 ? "rate-limited" : status === 400 ? "protocol-error" : "unauthorized");
    const guarded = buildGuardedModelFetch(endpoint.model, 5000, { sanitizeSse: false });
    let failure: unknown;
    try {
      const response = await guarded(endpoint.baseUrl + "/chat/completions", { method: "POST", body: "{}" });
      if (!response.ok) throw await createProviderHttpError(response, "local provider");
    }
    catch (error) { failure = error; }
    expect(failure).toBeDefined();
    const normalized = coerceToFailoverError(failure);
    expect(normalized?.status).toBe(status);
    observations.push({ status, validation, inferenceReason: normalized?.reason, requests: endpoint.requests });
  });
});
