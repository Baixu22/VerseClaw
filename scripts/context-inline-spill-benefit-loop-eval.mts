#!/usr/bin/env node
/**
 * Agent-driven real task-benefit eval for Inline/Spill archive recall.
 *
 * The model receives only the production-projected visible context. It decides
 * whether to call the production context_archive_recall tool; this harness only
 * executes the function calls the model returns and appends the real result.
 *
 * Modes:
 *   deterministic - a scripted policy stands in for the model (harness self-test;
 *                   never evidence of model autonomy).
 *   live          - OpenAI-compatible /v1/responses with real tool calling.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  ARCHIVE_RECALL_RETENTION_MAX_CHARS,
  getRetainedArchiveRecalls,
} from "../openclaw_runtime/src/agents/archive-recall-retention.js";
import { pruneContextMessages } from "../openclaw_runtime/src/agents/agent-hooks/context-pruning/pruner.js";
import { DEFAULT_CONTEXT_PRUNING_SETTINGS } from "../openclaw_runtime/src/agents/agent-hooks/context-pruning/settings.js";
import { truncateOversizedToolResultsInMessages } from "../openclaw_runtime/src/agents/embedded-agent-runner/tool-result-truncation.js";
import { formatContextLimitTruncationNotice } from "../openclaw_runtime/src/agents/embedded-agent-runner/context-truncation-notice.js";
import { createContextArchiveRecallTool } from "../openclaw_runtime/src/agents/tools/context-agent-tools.js";
import {
  createContextArchiveHandleForPayloadSync,
  verifyContextArchiveHandle,
} from "../openclaw_runtime/src/context-engine/registry/context-item-registry.js";
import type { AgentMessage } from "../openclaw_runtime/src/agents/runtime/index.js";
import { mcnemarExact, parseAnswer, wilson } from "./context-inline-spill-benefit-scoring.mjs";
import { buildProjectedEvalInput, contentText, pairedSessionId, textOf } from "./context-inline-spill-benefit-input.mjs";

const ROOT = process.cwd();
const MODE = argValue("--mode") ?? "deterministic";
if (!["deterministic", "live"].includes(MODE)) throw new Error("mode must be deterministic or live");
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-") + "-" + MODE;
const runDir = resolve(argValue("--out") ?? "D:/tmp/context-inline-spill-benefit", RUN_ID);
mkdirSync(runDir, { recursive: true });
const ACTOR = "codex-inline-spill-benefit-r3";
const API_KEY = process.env.CONTEXT_INLINE_SPILL_API_KEY;
const BASE_URL = process.env.CONTEXT_INLINE_SPILL_BASE_URL ?? "http://127.0.0.1:3065/v1";
const MODEL = process.env.CONTEXT_INLINE_SPILL_MODEL ?? "space-bunny";
const REPEATS = Number(argValue("--repeats") ?? 3);
const MAX_TURNS = Number(argValue("--max-turns") ?? 8);
const CONTEXT_WINDOW_TOKENS = 32_000;
const TOOL_MAX_CHARS = 6_000;
const AGGREGATE_MAX_CHARS = 16_000;
const RECALL_PAGE_CHARS = 5_500;
process.env.OPENCLAW_CONTEXT_ARCHIVE_DIR = join(runDir, "archives");
mkdirSync(join(runDir, "archives"), { recursive: true });

type Arm = "baseline-no-reference" | "reference-visible" | "recall-stable" | "retention-off";
const ARMS: Arm[] = ["baseline-no-reference", "reference-visible", "recall-stable", "retention-off"];
const ARM_CONFIG: Record<Arm, { reference: boolean; retention: boolean; pressure: boolean }> = {
  "baseline-no-reference": { reference: false, retention: false, pressure: false },
  "reference-visible": { reference: true, retention: false, pressure: false },
  "recall-stable": { reference: true, retention: true, pressure: true },
  "retention-off": { reference: true, retention: false, pressure: true },
};

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
}
function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
function redact(text: string): string {
  const withoutKey = API_KEY ? text.split(API_KEY).join("[redacted]") : text;
  return withoutKey.replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[redacted]");
}
function save(name: string, value: unknown): void {
  writeFileSync(join(runDir, name), redact(JSON.stringify(value, null, 2)) + "\n");
}
function user(text: string): AgentMessage {
  return { role: "user", content: text, timestamp: 1 } as AgentMessage;
}
function assistantText(text: string): AgentMessage {
  return { role: "assistant", content: [{ type: "text", text }], timestamp: 1 } as AgentMessage;
}
function toolResult(id: string, name: string, text: string, details?: unknown): AgentMessage {
  return {
    role: "toolResult",
    toolName: name,
    toolCallId: id,
    content: [{ type: "text", text }],
    details,
    isError: false,
    timestamp: 1,
  } as AgentMessage;
}

// ---------------------------------------------------------------- fixtures
type Fixture = { id: string; question: string; oracle: string | null; payload: string };
const FILLER = "The deployment log records routine health checks for this workstation. ".repeat(4);

function buildFixtures(): Fixture[] {
  const evidence = [
    { id: "deploy-token", oracle: "DEPLOY_TOKEN_7f31ab", question: "What exact deploy token is recorded in the archived tool output? Answer with the exact token." },
    { id: "db-passport", oracle: "DB_PASSPORT_9c02de", question: "What exact database passport string is recorded in the archived tool output?" },
    { id: "cache-seed", oracle: "CACHE_SEED_44aa10", question: "What exact cache seed is recorded in the archived tool output?" },
    { id: "signing-key", oracle: "SIGNING_KEY_b71c55", question: "What exact signing key identifier is recorded in the archived tool output?" },
    { id: "tenant-id", oracle: "TENANT_ID_3d9e77", question: "What exact tenant id is recorded in the archived tool output?" },
    { id: "migration-hash", oracle: "MIGRATION_HASH_a1f4c8", question: "What exact migration hash is recorded in the archived tool output?" },
  ];
  const controls = [
    { id: "control-absent-1", question: "What exact deploy token is recorded in the archived tool output? If no such exact value exists, answer null." },
    { id: "control-absent-2", question: "What exact tenant id is recorded in the archived tool output? If no such exact value exists, answer null." },
  ];
  const fixtures: Fixture[] = [];
  let i = 0;
  for (const item of evidence) {
    // The oracle sits at ~4800-5200 absolute: outside the initial truncated head
    // (the payload has a summary tail, so the head is ~70% of the 6000 budget),
    // inside one recall page (0..5500), and in the band aggregate soft-trim cuts.
    const offset = [7_000, 8_000, 9_000][i++ % 3]!;
    const before = FILLER.repeat(Math.ceil(offset / FILLER.length)).slice(0, offset);
    const payload = before + "private_evidence=" + item.oracle + "\n" + FILLER.repeat(120) + "summary: completed checks\n";
    fixtures.push({ id: item.id, question: item.question, oracle: item.oracle, payload });
  }
  for (const item of controls) {
    fixtures.push({ id: item.id, question: item.question, oracle: null, payload: FILLER.repeat(160) + "summary: completed checks\n" });
  }
  return fixtures;
}

// ---------------------------------------------------------------- projection
function project(messages: AgentMessage[], sessionId: string, arm: Arm) {
  const cfg = ARM_CONFIG[arm];
  const truncated = truncateOversizedToolResultsInMessages(
    messages,
    CONTEXT_WINDOW_TOKENS,
    TOOL_MAX_CHARS,
    AGGREGATE_MAX_CHARS,
    { sessionId, archiveRecallRetention: cfg.retention },
  );
  const pruned = pruneContextMessages({
    messages: truncated.messages,
    settings: structuredClone(DEFAULT_CONTEXT_PRUNING_SETTINGS),
    ctx: { model: { contextWindow: CONTEXT_WINDOW_TOKENS } } as never,
    archiveRecallRetention: { enabled: cfg.retention, sessionId },
  });
  return {
    visible: pruned,
    retained: getRetainedArchiveRecalls(pruned, { enabled: cfg.retention, sessionId }).length,
  };
}

// ---------------------------------------------------------------- provider
type ToolCall = { callId: string; name: string; arguments: Record<string, unknown> };
type ProviderTurn = {
  status: "executed" | "failed";
  text: string;
  toolCalls: ToolCall[];
  usage: Record<string, unknown> | null;
  latencyMs: number;
  httpStatus?: number;
  failureClass?: string;
  raw?: string;
};

const RECALL_TOOL_DEF = {
  type: "function" as const,
  name: "context_archive_recall",
  description: "Read a bounded excerpt from a masked tool-output archive. Use only an archive_uri that appears in the visible context.",
  parameters: {
    type: "object",
    properties: {
      archive_uri: { type: "string" },
      checksum: { type: "string" },
      byte_length: { type: "integer" },
      offset: { type: "integer" },
      max_chars: { type: "integer" },
    },
    required: ["archive_uri", "checksum"],
    additionalProperties: false,
  },
};

async function liveTurn(requestBody: string): Promise<ProviderTurn> {
  const started = performance.now();
  try {
    const response = await fetch(BASE_URL.replace(/\/$/, "") + "/responses", {
      method: "POST",
      headers: { authorization: "Bearer " + API_KEY, "content-type": "application/json" },
      body: requestBody,
      signal: AbortSignal.timeout(120_000),
    });
    const raw = redact(await response.text());
    const latencyMs = Number((performance.now() - started).toFixed(3));
    if (!response.ok) {
      return { status: "failed", text: "", toolCalls: [], usage: null, latencyMs, httpStatus: response.status, failureClass: "provider_http_error", raw };
    }
    const body = JSON.parse(raw) as { output_text?: string; output?: Array<Record<string, unknown>>; usage?: Record<string, unknown> };
    const toolCalls: ToolCall[] = [];
    for (const item of body.output ?? []) {
      if (item.type === "function_call") {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(String(item.arguments ?? "{}")); } catch { args = {}; }
        toolCalls.push({ callId: String(item.call_id ?? ""), name: String(item.name ?? ""), arguments: args });
      }
    }
    return { status: "executed", text: String(body.output_text ?? ""), toolCalls, usage: body.usage ?? null, latencyMs, raw };
  } catch (error) {
    return { status: "failed", text: "", toolCalls: [], usage: null, latencyMs: Number((performance.now() - started).toFixed(3)), failureClass: "provider_transport_error", raw: redact(error instanceof Error ? error.message : String(error)) };
  }
}

/** Deterministic stand-in policy. Harness self-test only; never evidence of model autonomy. */
function deterministicTurn(prompt: string, oracle: string | null, recallCount: number, archive: { uri: string; checksum: string }): ProviderTurn {
  const started = performance.now();
  const canSeeArchive = prompt.includes(archive.uri);
  if (canSeeArchive && recallCount < 2 && !prompt.includes(oracle ?? "\u0000__none__")) {
    return {
      status: "executed",
      text: "",
      toolCalls: [{
        callId: "det-" + recallCount + "-" + Math.random().toString(16).slice(2, 8),
        name: "context_archive_recall",
        arguments: { archive_uri: archive.uri, checksum: archive.checksum, offset: recallCount * RECALL_PAGE_CHARS, max_chars: RECALL_PAGE_CHARS },
      }],
      usage: null,
      latencyMs: Number((performance.now() - started).toFixed(3)),
    };
  }
  const found = oracle && prompt.includes(oracle) ? oracle : null;
  return { status: "executed", text: JSON.stringify({ value: found }), toolCalls: [], usage: null, latencyMs: Number((performance.now() - started).toFixed(3)) };
}

// ---------------------------------------------------------------- run
type RunRecord = {
  arm: Arm; fixtureId: string; repetition: number; sessionId: string;
  success: boolean; recallAttempted: boolean; recallOk: boolean; turns: number;
  mainContextChars: number; retainedAtEnd: number;
  projectedContextChars: number; initialRequestSha256: string;
  inputTokens: number; outputTokens: number; totalTokens: number; latencyMs: number;
  cost: Record<string, unknown>; failureClass: string | null;
  finalAnswer: { ok: boolean; value: string | null };
  providerCalls: Array<Record<string, unknown>>;
  toolCalls: Array<Record<string, unknown>>;
  archive: { uri: string; checksum: string; byteLength: number };
};

const fixtures = buildFixtures();
const records: RunRecord[] = [];

for (const fixture of fixtures) {
  for (const arm of ARMS) {
    const cfg = ARM_CONFIG[arm];
    for (let repetition = 0; repetition < REPEATS; repetition++) {
      const sessionId = pairedSessionId(fixture.id, arm, repetition);
      const handle = createContextArchiveHandleForPayloadSync({
        sessionId,
        itemId: (fixture.id + "-" + repetition) as never,
        payload: fixture.payload,
        archiveRoot: join(runDir, "archives"),
        source: { type: "tool_call", sessionId, label: "benefit-eval-fixture" },
      });
      const verified = await verifyContextArchiveHandle(handle);
      if (!verified.ok) throw new Error("fixture archive verification failed: " + verified.reason);

      const original = toolResult("raw-output", "exec", fixture.payload, { archiveHandle: handle });
      const truncated = truncateOversizedToolResultsInMessages([original], CONTEXT_WINDOW_TOKENS, TOOL_MAX_CHARS, AGGREGATE_MAX_CHARS, { sessionId }).messages[0]!;
      const visibleToolResult = cfg.reference
        ? truncated
        : toolResult("raw-output", "exec", formatContextLimitTruncationNotice(fixture.payload.length));

      const messages: AgentMessage[] = [
        user(fixture.question),
        { role: "assistant", content: [{ type: "toolCall", id: "raw-output", name: "exec", arguments: {} }], timestamp: 1 } as AgentMessage,
        visibleToolResult,
      ];
      const recallTool = createContextArchiveRecallTool({ sessionId, archiveRecallRetention: cfg.retention })!;
      const toolHistory: Array<Record<string, unknown>> = [];
      const providerCalls: Array<Record<string, unknown>> = [];
      const toolCallLog: Array<Record<string, unknown>> = [];
      let recallAttempted = false;
      let recallOk = false;
      let turns = 0;
      let mainContextChars = 0;
      let projectedContextChars = 0;
      let initialRequestSha256 = "";
      let retainedAtEnd = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      let totalTokens = 0;
      let latencyMs = 0;
      let finalAnswer = { ok: false, value: null as string | null };
      let failureClass: string | null = null;

      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const projected = project(messages, sessionId, arm);
        const visibleText = textOf(projected.visible);
        projectedContextChars = visibleText.length;
        retainedAtEnd = projected.retained;
        const input = buildProjectedEvalInput(projected.visible, toolHistory, fixture.question);
        const inputJson = JSON.stringify(input);
        mainContextChars = inputJson.length;
        const request = { model: MODEL, input, tools: [RECALL_TOOL_DEF], tool_choice: "auto", temperature: 0, max_output_tokens: 900 };
        const requestBody = JSON.stringify(request);
        const outputIds = new Set(toolHistory.filter((item) => item.type === "function_call_output").map((item) => String(item.call_id)));
        const projectedToolOutputs = Object.fromEntries(projected.visible.filter((m) => m.role === "toolResult" && outputIds.has(m.toolCallId)).map((m) => [m.toolCallId, contentText(m)]));
        if (turn === 0) initialRequestSha256 = digest(requestBody);
        if (!cfg.reference && fixture.oracle && requestBody.includes(fixture.oracle)) throw new Error("baseline input contains oracle");
        const result = MODE === "live"
          ? await liveTurn(requestBody)
          : deterministicTurn(inputJson, fixture.oracle, toolCallLog.length, { uri: handle.uri, checksum: handle.checksum });
        turns++;
        inputTokens += Number((result.usage as { input_tokens?: number } | null)?.input_tokens ?? 0);
        outputTokens += Number((result.usage as { output_tokens?: number } | null)?.output_tokens ?? 0);
        totalTokens += Number((result.usage as { total_tokens?: number } | null)?.total_tokens ?? 0);
        latencyMs += result.latencyMs;
        providerCalls.push({ turn, status: result.status, http_status: result.httpStatus ?? null, latency_ms: result.latencyMs, usage: result.usage, tool_call_count: result.toolCalls.length, text: result.text, failure_class: result.failureClass ?? null, request, request_sha256: digest(requestBody), input_chars: mainContextChars, input_bytes: Buffer.byteLength(inputJson), request_chars: requestBody.length, request_bytes: Buffer.byteLength(requestBody), projected_tool_outputs: projectedToolOutputs, raw_response: result.raw ?? null });
        if (result.status === "failed") { failureClass = result.failureClass ?? "provider_error"; break; }
        if (result.toolCalls.length === 0) {
          finalAnswer = parseAnswer(result.text);
          if (!finalAnswer.ok) failureClass = "schema_invalid";
          break;
        }
        let recallHandledThisTurn = false;
        for (const call of result.toolCalls) {
          toolHistory.push({ type: "function_call", call_id: call.callId, name: call.name, arguments: JSON.stringify(call.arguments) });
          if (call.name !== "context_archive_recall") {
            const output = JSON.stringify({ ok: false, diagnostics: [{ code: "unknown_tool" }] });
            toolHistory.push({ type: "function_call_output", call_id: call.callId });
            messages.push(toolResult(call.callId, call.name, output));
            continue;
          }
          recallAttempted = true;
          if (recallHandledThisTurn) {
            const output = JSON.stringify({ ok: false, diagnostics: [{ code: "parallel_recall_limit" }] });
            toolHistory.push({ type: "function_call_output", call_id: call.callId });
            messages.push(toolResult(call.callId, "context_archive_recall", output));
            toolCallLog.push({ call_id: call.callId, name: call.name, arguments: call.arguments, ok: false, result_chars: output.length, result_has_oracle: false, failure_code: "parallel_recall_limit" });
            continue;
          }
          recallHandledThisTurn = true;
          let executed: { content: Array<{ text?: string }>; details?: Record<string, unknown> };
          if (!cfg.reference) {
            executed = { content: [{ text: JSON.stringify({ ok: false, diagnostics: [{ code: "no_archive_reference" }] }) }], details: undefined };
          } else {
            try {
              executed = (await recallTool.execute(call.callId, call.arguments as never)) as typeof executed;
            } catch (error) {
              executed = { content: [{ text: JSON.stringify({ ok: false, diagnostics: [{ code: "invalid_arguments", message: String(error) }] }) }], details: undefined };
            }
          }
          const resultText = executed.content.map((b) => b.text ?? "").join("\n");
          const details = executed.details;
          if (details && details.ok === true) recallOk = true;
          toolCallLog.push({ call_id: call.callId, name: call.name, arguments: call.arguments, ok: details?.ok === true, result_chars: resultText.length, result_has_oracle: Boolean(fixture.oracle && resultText.includes(fixture.oracle)), raw_result: resultText });
          toolHistory.push({ type: "function_call_output", call_id: call.callId });
          messages.push(toolResult(call.callId, "context_archive_recall", resultText, details));
          if (cfg.pressure) {
            messages.push(assistantText("Acknowledged. Continuing with the remaining verification steps."));
            messages.push(user("Additional context for the remaining checks: " + FILLER.repeat(40)));
            messages.push(toolResult("distractor-1-" + turn, "exec", FILLER.repeat(33)));
            messages.push(toolResult("distractor-2-" + turn, "exec", FILLER.repeat(33)));
          }
        }
      }

      const expected = fixture.oracle;
      const success = finalAnswer.ok && finalAnswer.value === expected;
      if (!success && !failureClass) {
        if (expected === null) failureClass = finalAnswer.value !== null ? "fabricated_absent_evidence" : "answer_mismatch";
        else if (!recallAttempted) failureClass = "recall_not_attempted";
        else if (cfg.reference && !promptHasEvidence(messages, expected, sessionId, arm)) failureClass = "recalled_text_evicted";
        else failureClass = "answer_mismatch";
      }
      records.push({
        arm, fixtureId: fixture.id, repetition, sessionId, success, recallAttempted, recallOk, turns,
        mainContextChars, projectedContextChars, initialRequestSha256, retainedAtEnd, inputTokens, outputTokens, totalTokens,
        latencyMs: Number(latencyMs.toFixed(3)),
        cost: { status: "not-run", reason: "Provider billing rates were not supplied; token usage is recorded." },
        failureClass, finalAnswer, providerCalls, toolCalls: toolCallLog,
        archive: { uri: handle.uri, checksum: handle.checksum, byteLength: handle.byteLength },
      });
      console.error(redact(JSON.stringify({ arm, fixture: fixture.id, rep: repetition, success, recallAttempted, recallOk, turns, failureClass, finalValue: finalAnswer.value, mainContextChars, retainedAtEnd })));
    }
  }
}

function promptHasEvidence(messages: AgentMessage[], oracle: string, sessionId: string, arm: Arm): boolean {
  return textOf(project(messages, sessionId, arm).visible).includes(oracle);
}

// ---------------------------------------------------------------- summary
const evidenceTasks = fixtures.filter((f) => f.oracle !== null).map((f) => f.id);
const controlTasks = fixtures.filter((f) => f.oracle === null).map((f) => f.id);

function armStats(arm: Arm) {
  const rows = records.filter((r) => r.arm === arm);
  const n = rows.length;
  const evidenceRows = rows.filter((r) => evidenceTasks.includes(r.fixtureId));
  const controlRows = rows.filter((r) => controlTasks.includes(r.fixtureId));
  const pass = rows.filter((r) => r.success).length;
  const mean = (pick: (r: RunRecord) => number) => (n ? rows.reduce((s, r) => s + pick(r), 0) / n : 0);
  const latencies = rows.map((r) => r.latencyMs).sort((a, b) => a - b);
  const pct = (q: number) => (latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(q * (latencies.length - 1)))] : 0);
  const passK = evidenceTasks.filter((id) => rows.filter((r) => r.fixtureId === id).every((r) => r.success) && rows.some((r) => r.fixtureId === id)).length / Math.max(1, evidenceTasks.length);
  return {
    arm, runs: n, pass,
    successRate: n ? pass / n : 0,
    wilson95: wilson(pass, n),
    evidenceSuccessRate: evidenceRows.length ? evidenceRows.filter((r) => r.success).length / evidenceRows.length : 0,
    controlSuccessRate: controlRows.length ? controlRows.filter((r) => r.success).length / controlRows.length : 0,
    passAtK: passK,
    recallAttemptRate: evidenceRows.length ? evidenceRows.filter((r) => r.recallAttempted).length / evidenceRows.length : 0,
    recallOkRate: evidenceRows.length ? evidenceRows.filter((r) => r.recallOk).length / evidenceRows.length : 0,
    meanTurns: mean((r) => r.turns),
    meanMainContextChars: mean((r) => r.mainContextChars),
    meanInputTokens: mean((r) => r.inputTokens),
    meanOutputTokens: mean((r) => r.outputTokens),
    meanTotalTokens: mean((r) => r.totalTokens),
    p50LatencyMs: pct(0.5), p95LatencyMs: pct(0.95),
    failureClasses: rows.reduce<Record<string, number>>((acc, r) => { const k = r.failureClass ?? "none"; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {}),
  };
}

const stats = Object.fromEntries(ARMS.map((a) => [a, armStats(a)])) as Record<Arm, ReturnType<typeof armStats>>;
const initialPairs = records.filter((r) => r.arm === "recall-stable").map((r) => {
  const off = records.find((o) => o.arm === "retention-off" && o.fixtureId === r.fixtureId && o.repetition === r.repetition)!;
  return { fixtureId: r.fixtureId, repetition: r.repetition, stableSha256: r.initialRequestSha256, offSha256: off.initialRequestSha256, byteIdentical: r.initialRequestSha256 === off.initialRequestSha256 };
});

function paired(a: Arm, b: Arm) {
  let both = 0, onlyA = 0, onlyB = 0, neither = 0;
  for (const fixture of new Set(records.map((r) => r.fixtureId))) {
    for (let rep = 0; rep < REPEATS; rep++) {
      const ra = records.find((r) => r.arm === a && r.fixtureId === fixture && r.repetition === rep);
      const rb = records.find((r) => r.arm === b && r.fixtureId === fixture && r.repetition === rep);
      if (!ra || !rb) continue;
      if (ra.success && rb.success) both++;
      else if (ra.success) onlyA++;
      else if (rb.success) onlyB++;
      else neither++;
    }
  }
  return { both, onlyA, onlyB, neither, p: mcnemarExact(onlyA, onlyB) };
}

const comparisons = {
  "recall-stable_vs_baseline": paired("recall-stable", "baseline-no-reference"),
  "recall-stable_vs_retention-off": paired("recall-stable", "retention-off"),
  "recall-stable_vs_reference-visible": paired("recall-stable", "reference-visible"),
};

const controlPass = records.filter((r) => r.arm === "recall-stable" && controlTasks.includes(r.fixtureId)).every((r) => r.success);
const b1 = stats["recall-stable"].recallAttemptRate >= 0.8 && stats["recall-stable"].recallOkRate >= 0.95;
const b2 = stats["recall-stable"].evidenceSuccessRate - stats["baseline-no-reference"].evidenceSuccessRate >= 0.3 && comparisons["recall-stable_vs_baseline"].p < 0.05;
const b3 = comparisons["recall-stable_vs_retention-off"].onlyA >= 1 && comparisons["recall-stable_vs_retention-off"].onlyB === 0;
const b4 = stats["recall-stable"].evidenceSuccessRate >= stats["reference-visible"].evidenceSuccessRate - 0.05;
const b5 = controlPass;
const contextGrowth = stats["recall-stable"].meanMainContextChars - stats["retention-off"].meanMainContextChars;
const tokenGrowthPct = stats["reference-visible"].meanTotalTokens > 0
  ? (stats["recall-stable"].meanTotalTokens - stats["reference-visible"].meanTotalTokens) / stats["reference-visible"].meanTotalTokens
  : 0;
const b6 = contextGrowth <= ARCHIVE_RECALL_RETENTION_MAX_CHARS && tokenGrowthPct <= 0.25;
const decisionStatus = MODE !== "live"
  ? "inconclusive"
  : b1 && b2 && b3 && b4 && b5 && b6 ? "task-benefit-verified"
  : b1 ? "mechanism-only"
  : stats["recall-stable"].runs >= 18 ? "no-benefit" : "inconclusive";

const result = {
  schema: "ContextInlineSpillBenefitLoopEval/v1",
  runId: RUN_ID,
  mode: MODE,
  driven_by: "agent",
  actor: ACTOR,
  loop_driver: "eval-harness (executes only the model-returned tool calls)",
  candidate: { commit: execGit(["rev-parse", "HEAD"]), tree: execGit(["rev-parse", "HEAD^{tree}"]), dirty: execGit(["status", "--porcelain=v1"]).length > 0 },
  provider: MODE === "live"
    ? { kind: "openai-compatible-responses", endpoint_origin: new URL(BASE_URL).origin, model: MODEL, credential_persisted: false }
    : { kind: "deterministic-scripted-policy", endpoint_origin: null, model: null, credential_persisted: false },
  design: { repeats: REPEATS, maxTurns: MAX_TURNS, evidenceTasks, controlTasks, arms: ARM_CONFIG, contextWindowTokens: CONTEXT_WINDOW_TOKENS, toolMaxChars: TOOL_MAX_CHARS, aggregateMaxChars: AGGREGATE_MAX_CHARS, recallPageChars: RECALL_PAGE_CHARS },
  stats, comparisons,
  inputIntegrity: { assembly: "production-projection-only/function-protocol/v3", mainContextCharsSource: "JSON.stringify(actual request.input).length", initialPairs, allInitialPairsByteIdentical: initialPairs.every((p) => p.byteIdentical), unprojectedOutputFallback: false },
  decision: {
    status: decisionStatus,
    b1_mechanism_and_autonomy: b1,
    b2_task_benefit: b2,
    b3_retention_benefit: b3,
    b4_non_inferiority: b4,
    b5_no_fabrication: b5,
    b6_budget: b6,
    contextGrowthChars: contextGrowth,
    tokenGrowthPct,
    engineeringAcceptedByAgent: false, releaseApproved: false, liveReady: false, defaultOn: false,
  },
  boundaries: [
    "The loop driver is an eval harness: it executes only the tool calls the model returns, but it is not the Electron/Gateway product turn (no gateway approval, system prompt or bootstrap).",
    "Deterministic mode uses a scripted policy and is harness self-test only, never evidence of model autonomy.",
    "Cost is not-run unless the provider returns a billing unit; token usage is recorded per call.",
    "Results cover this corpus and this model only; they do not establish product quality or GA.",
  ],
};

function execGit(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", windowsHide: true }).trim();
}

save("result.json", result);
save("runs.json", { schema: "ContextInlineSpillBenefitRuns/v1", driven_by: "agent", actor: ACTOR, records });
const files = ["result.json", "runs.json"];
const credentialHits = files.reduce((sum, name) => {
  const text = readFileSync(join(runDir, name), "utf8");
  return sum + Number(Boolean(API_KEY && text.includes(API_KEY))) + (text.match(/\bsk-[A-Za-z0-9_-]{16,}\b/g)?.length ?? 0);
}, 0);
save("credential-scan.json", { schema: "ContextInlineSpillBenefitCredentialScan/v1", driven_by: "agent", actor: ACTOR, files_scanned: files.length, hits: credentialHits, passed: credentialHits === 0 });
files.push("credential-scan.json");
writeFileSync(join(runDir, "SHA256SUMS"), files.map((n) => digest(readFileSync(join(runDir, n))) + "  " + n).join("\n") + "\n");
console.log(JSON.stringify({ runDir, mode: MODE, decision: result.decision, stats: Object.fromEntries(ARMS.map((a) => [a, { evidenceSuccessRate: stats[a].evidenceSuccessRate, controlSuccessRate: stats[a].controlSuccessRate, recallAttemptRate: stats[a].recallAttemptRate, meanMainContextChars: stats[a].meanMainContextChars, meanTotalTokens: stats[a].meanTotalTokens, p95LatencyMs: stats[a].p95LatencyMs }])), credentialHits }, null, 2));
process.exitCode = credentialHits === 0 && result.inputIntegrity.allInitialPairsByteIdentical && (MODE === "deterministic" || result.decision.status !== "inconclusive") ? 0 : 1;


