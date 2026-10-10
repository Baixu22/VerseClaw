// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { createHash } from "node:crypto";

const originalDispatcher = getGlobalDispatcher();
let mock: MockAgent;
const key = "unit-test-only-not-a-provider-credential";
const response = { id: "test-response-1", model: "step-5-preview", choices: [{ message: { content: "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } };

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("RUNTIME_MEMORY_REAL_LLM", "1");
  vi.stubEnv("RUNTIME_MEMORY_LLM_API_KEY", key);
  vi.stubEnv("RUNTIME_MEMORY_LLM_BASE_URL", "https://step.example/step_plan/v1");
  vi.stubEnv("RUNTIME_MEMORY_LLM_MODEL", "step-5-preview");
  vi.stubEnv("DEEPSEEK_API_KEY", "");
  mock = new MockAgent();
  mock.disableNetConnect();
  setGlobalDispatcher(mock);
});
afterEach(async () => {
  setGlobalDispatcher(originalDispatcher);
  await mock.close();
  vi.unstubAllEnvs();
});

describe("real-model evaluation provider binding and receipts", () => {
  it("uses the explicit endpoint/model and never stores the credential in receipts", async () => {
    mock.get("https://step.example").intercept({
      path: "/step_plan/v1/chat/completions", method: "POST",
      headers: { authorization: 'Bearer ' + key },
      body: (body) => { const payload = JSON.parse(String(body)); return payload.model === "step-5-preview" && payload.max_tokens >= 2048; },
    }).reply(200, response);
    const client = await import("./helpers/runtime-memory-real-llm-client");
    expect(client.hasDeepSeekKey()).toBe(true);
    expect((await client.callDeepSeek("judge", "public fixture", { maxTokens: 16 })).content).toBe("OK");
    expect(client.getRuntimeMemoryLlmReceipts()).toMatchObject([{ status: 200, returnedModel: "step-5-preview", responseId: "test-response-1", usage: response.usage }]);
    expect(client.getRuntimeMemoryLlmReceipts()[0].requestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(client.getRuntimeMemoryLlmReceipts())).not.toContain(key);
    mock.assertNoPendingInterceptors();
  });
  it("retains a frozen-judge request fingerprint and verdict without auth or mutable receipt aliases", async () => {
    const verdict = { ...response, choices: [{ message: { content: "CORRECT" }, finish_reason: "stop" }] };
    mock.get("https://step.example").intercept({ path: "/step_plan/v1/chat/completions", method: "POST" }).reply(200, verdict);
    const client = await import("./helpers/runtime-memory-real-llm-client");
    await client.callDeepSeek("frozen system", "fixture question and answer", { maxTokens: 8, evidenceRole: "frozen-judge" });
    const [receipt] = client.getRuntimeMemoryLlmReceipts();
    const request = JSON.stringify({ model: "step-5-preview", messages: [{ role: "system", content: "frozen system" }, { role: "user", content: "fixture question and answer" }], temperature: 0, max_tokens: 2048, stream: false });
    expect(receipt.requestSha256).toBe(createHash("sha256").update(request).digest("hex"));
    expect(receipt.judgeEvidence).toEqual({ temperature: 0, maxTokens: 2048, content: "CORRECT" });
    receipt.judgeEvidence!.content = "WRONG";
    expect(client.getRuntimeMemoryLlmReceipts()[0].judgeEvidence!.content).toBe("CORRECT");
    expect(JSON.stringify(receipt)).not.toContain(key);
  });
  it("does not accidentally send a generic credential to the default provider", async () => {
    vi.stubEnv("RUNTIME_MEMORY_LLM_BASE_URL", "");
    const client = await import("./helpers/runtime-memory-real-llm-client");
    expect(client.hasDeepSeekKey()).toBe(false);
    await expect(client.callDeepSeek("system", "question")).rejects.toThrow("explicit");
  });
  it.each(["http://external.example/v1", "https://user:password@step.example/v1", "https://step.example/v1?api_key=not-real"])("rejects unsafe credential-bearing endpoints: %s", async (base) => {
    vi.stubEnv("RUNTIME_MEMORY_LLM_BASE_URL", base);
    const client = await import("./helpers/runtime-memory-real-llm-client");
    await expect(client.callDeepSeek("system", "question")).rejects.toThrow("base URL");
  });
  it.each([
    { message: { content: "", reasoning_content: "CORRECT" }, finish_reason: "stop" },
    { message: { content: "CORRECT" }, finish_reason: "length" },
  ])("does not score reasoning or truncated output as a final answer", async (choice) => {
    mock.get("https://step.example").intercept({ path: "/step_plan/v1/chat/completions", method: "POST" }).reply(200, { ...response, choices: [choice] });
    const client = await import("./helpers/runtime-memory-real-llm-client");
    await expect(client.callDeepSeek("system", "question")).rejects.toThrow("complete final answer");
    expect(client.getRuntimeMemoryLlmReceipts()).toHaveLength(0);
  });
  it("does not expose a provider error body or count it as a successful call", async () => {
    mock.get("https://step.example").intercept({ path: "/step_plan/v1/chat/completions", method: "POST" }).reply(401, { error: { message: key } });
    const client = await import("./helpers/runtime-memory-real-llm-client");
    await expect(client.callDeepSeek("system", "question")).rejects.toThrow(/^Runtime memory LLM API 401$/);
    expect(client.getRuntimeMemoryLlmReceipts()).toHaveLength(0);
  });
  it("preserves the legacy DeepSeek endpoint for the legacy credential", async () => {
    vi.stubEnv("RUNTIME_MEMORY_LLM_API_KEY", "");
    vi.stubEnv("RUNTIME_MEMORY_LLM_BASE_URL", "");
    vi.stubEnv("RUNTIME_MEMORY_LLM_MODEL", "");
    vi.stubEnv("DEEPSEEK_API_KEY", key);
    vi.stubEnv("DEEPSEEK_MODEL", "deepseek-chat");
    mock.get("https://api.deepseek.com").intercept({ path: "/v1/chat/completions", method: "POST" }).reply(200, { ...response, model: "deepseek-chat" });
    const client = await import("./helpers/runtime-memory-real-llm-client");
    expect((await client.callDeepSeek("system", "question")).model).toBe("deepseek-chat");
  });
});
