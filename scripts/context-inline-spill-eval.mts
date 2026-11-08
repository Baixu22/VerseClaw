#!/usr/bin/env node
/** Agent-driven paired recall/projection eval; providers receive visible text, never the private oracle. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  ARCHIVE_RECALL_RETENTION_MAX_CHARS,
  ARCHIVE_RECALL_RETENTION_TURNS,
  getRetainedArchiveRecalls,
} from "../openclaw_runtime/src/agents/archive-recall-retention.js";
import { pruneContextMessages } from "../openclaw_runtime/src/agents/agent-hooks/context-pruning/pruner.js";
import { DEFAULT_CONTEXT_PRUNING_SETTINGS } from "../openclaw_runtime/src/agents/agent-hooks/context-pruning/settings.js";
import {
  estimateToolResultReductionPotential,
  getToolResultTextLength,
  truncateOversizedToolResultsInMessages,
} from "../openclaw_runtime/src/agents/embedded-agent-runner/tool-result-truncation.js";
import { shouldPreemptivelyCompactBeforePrompt } from "../openclaw_runtime/src/agents/embedded-agent-runner/run/preemptive-compaction.js";
import { sanitizeSessionHistory } from "../openclaw_runtime/src/agents/embedded-agent-runner/replay-history.js";
import {
  installProviderPromptHistoryTransform,
  normalizeMessagesForCurrentPromptBoundary,
  normalizeMessagesForLlmBoundary,
} from "../openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.llm-boundary.js";
import { convertToLlm } from "../openclaw_runtime/src/agents/sessions/messages.js";
import { SessionManager } from "../openclaw_runtime/src/agents/sessions/session-manager.js";
import { installSessionToolResultGuard } from "../openclaw_runtime/src/agents/session-tool-result-guard.js";
import { formatContextLimitTruncationNotice } from "../openclaw_runtime/src/agents/embedded-agent-runner/context-truncation-notice.js";
import { createContextArchiveRecallTool } from "../openclaw_runtime/src/agents/tools/context-agent-tools.js";
import {
  createContextArchiveHandleForPayloadSync,
  verifyContextArchiveHandle,
} from "../openclaw_runtime/src/context-engine/registry/context-item-registry.js";
import { estimateStringChars } from "../openclaw_runtime/src/utils/cjk-chars.js";
import type { AgentMessage } from "../openclaw_runtime/src/agents/runtime/index.js";

const ROOT = process.cwd();
const MODE = argValue("--mode") ?? "deterministic";
if (!["deterministic", "live"].includes(MODE))
  throw new Error("mode must be deterministic or live");
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-") + "-" + MODE;
const runDir = resolve(argValue("--out") ?? "D:/tmp/context-inline-spill-eval", RUN_ID);
const archiveRoot = join(runDir, "archives");
mkdirSync(archiveRoot, { recursive: true });
// The existing owner override makes archives isolated and resolvable in a fresh process.
process.env.OPENCLAW_CONTEXT_ARCHIVE_DIR = archiveRoot;
const sessionsRoot = join(runDir, "sessions");
const fixtureSessionManager = SessionManager.create(ROOT, sessionsRoot);
const sessionId = fixtureSessionManager.getSessionId();
installSessionToolResultGuard(fixtureSessionManager);
const actor = "codex-inline-spill-retention";
const privateValue = "ARCHIVE_PRIVATE_EVIDENCE_7f31";
const rawToolOutput =
  "head\n" +
  "x".repeat(4_000) +
  "\nprivate_evidence=" +
  privateValue +
  "\n" +
  "y".repeat(4_000) +
  "\ntail";
const API_KEY = process.env.CONTEXT_INLINE_SPILL_API_KEY;
const BASE_URL = process.env.CONTEXT_INLINE_SPILL_BASE_URL;
const MODEL = process.env.CONTEXT_INLINE_SPILL_MODEL;
const COST = {
  status: "not-run",
  reason: "Provider billing rates were not supplied; no billing estimate is claimed.",
};
const baselinePath = resolve(
  ROOT,
  "harness/specs/fixtures/context-inline-spill/off-mode-baseline.json",
);

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
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
function textOf(messages: readonly AgentMessage[]): string {
  return messages
    .map((message) => {
      const content = (message as { content?: unknown }).content;
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content
                .filter(
                  (block): block is { type: "text"; text: string } =>
                    block?.type === "text" && typeof block.text === "string",
                )
                .map((block) => block.text)
                .join("\n")
            : "";
      return message.role + ": " + text;
    })
    .join("\n\n");
}
function tokens(text: string): number {
  return Math.ceil(estimateStringChars(text) / 4);
}
function user(content: string): AgentMessage {
  return { role: "user", content, timestamp: 1 } as AgentMessage;
}
function assistant(text: string): AgentMessage {
  return { role: "assistant", content: [{ type: "text", text }], timestamp: 1 } as AgentMessage;
}
function toolCall(id: string, name: string, args: unknown): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id, name, arguments: args }],
    timestamp: 1,
  } as AgentMessage;
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
function pressureTail(): AgentMessage[] {
  return [
    assistant("Evidence read."),
    user("Continue under pressure. " + "z".repeat(40_000)),
    assistant("Continue."),
    user("Continue."),
    assistant("Continue."),
    user("What is the exact private_evidence value?"),
  ];
}
function prune(messages: AgentMessage[], enabled: boolean): AgentMessage[] {
  return pruneContextMessages({
    messages,
    settings: structuredClone(DEFAULT_CONTEXT_PRUNING_SETTINGS),
    ctx: { model: { contextWindow: 32_000 } } as never,
    archiveRecallRetention: { enabled, sessionId },
  });
}
function providerPrompt(messages: AgentMessage[]): string {
  return [
    "Read only the supplied model-visible context. Quote the exact private_evidence value if it is present.",
    "An archive URI alone does not supply its contents. Do not infer a value from an address, hidden metadata, or tools that were not executed in this context.",
    'Return JSON only: {"answerable":true|false,"value":string|null,"reason":string}. Use null if the exact value is unavailable.',
    textOf(messages),
  ].join("\n\n");
}

type LiveResult = {
  status: "executed" | "failed" | "not-run";
  elapsed_ms?: number;
  http_status?: number;
  answer?: { answerable: boolean; value: string | null; reason: string };
  usage?: Record<string, unknown> | null;
  expected_behavior_matched?: boolean;
  failure_class?: string | null;
  reason?: string;
  raw_response?: string;
};
async function live(prompt: string, expectedAnswerable: boolean): Promise<LiveResult> {
  if (!BASE_URL || !API_KEY || !MODEL)
    return {
      status: "not-run",
      reason: "Missing explicit provider endpoint, credential, or model.",
    };
  const endpoint = new URL(BASE_URL);
  if (!endpoint.pathname.endsWith("/responses"))
    endpoint.pathname = endpoint.pathname.replace(/\/$/, "") + "/responses";
  const started = performance.now();
  let httpStatus: number | undefined;
  let rawResponse: string | undefined;
  let usage: Record<string, unknown> | null | undefined;
  let failureClass = "provider_transport_error";
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: "Bearer " + API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, input: prompt, temperature: 0, max_output_tokens: 800 }),
      signal: AbortSignal.timeout(120_000),
    });
    const raw = redact(await response.text());
    httpStatus = response.status;
    rawResponse = raw;
    const elapsed_ms = Number((performance.now() - started).toFixed(3));
    if (!response.ok)
      return {
        status: "failed",
        http_status: response.status,
        elapsed_ms,
        failure_class: "provider_http_error",
        raw_response: raw,
      };
    failureClass = "provider_response_json_invalid";
    const body = JSON.parse(raw) as {
      output_text?: string;
      output?: { content?: { text?: string }[] }[];
      usage?: Record<string, unknown>;
    };
    usage = body.usage ?? null;
    const output =
      body.output_text ??
      body.output
        ?.flatMap((item) => item.content ?? [])
        .map((part) => part.text ?? "")
        .join("") ??
      "";
    const firstBrace = output.indexOf("{");
    const lastBrace = output.lastIndexOf("}");
    failureClass = "provider_answer_json_invalid";
    const answer = JSON.parse(
      firstBrace >= 0 && lastBrace > firstBrace ? output.slice(firstBrace, lastBrace + 1) : output,
    ) as { answerable?: unknown; value?: unknown; reason?: unknown };
    if (
      typeof answer.answerable !== "boolean" ||
      !(typeof answer.value === "string" || answer.value === null) ||
      typeof answer.reason !== "string"
    ) {
      return {
        status: "failed",
        elapsed_ms,
        http_status: response.status,
        failure_class: "provider_answer_schema_invalid",
        raw_response: raw,
        usage: body.usage ?? null,
      };
    }
    const exact = answer.answerable && answer.value === privateValue;
    const matched = expectedAnswerable ? exact : !answer.answerable && answer.value === null;
    return {
      status: "executed",
      elapsed_ms,
      http_status: response.status,
      answer: { answerable: answer.answerable, value: answer.value, reason: answer.reason },
      usage: body.usage ?? null,
      expected_behavior_matched: matched,
      failure_class: matched
        ? null
        : expectedAnswerable
          ? "model_failed_visible_evidence"
          : "model_fabricated_unavailable_evidence",
      raw_response: raw,
    };
  } catch (error) {
    return {
      status: "failed",
      elapsed_ms: Number((performance.now() - started).toFixed(3)),
      http_status: httpStatus,
      raw_response: rawResponse,
      usage,
      failure_class: failureClass,
      reason: redact(error instanceof Error ? error.message : String(error)),
    };
  }
}

const handle = createContextArchiveHandleForPayloadSync({
  sessionId,
  itemId: "context-inline-spill-eval-observation" as never,
  payload: rawToolOutput,
  archiveRoot,
  source: { type: "tool_call", sessionId, label: "agent-driven-eval-fixture" },
});
const verified = await verifyContextArchiveHandle(handle);
if (!verified.ok) throw new Error("Fixture archive verification failed: " + verified.reason);
const original = toolResult("raw-output", "exec", rawToolOutput, { archiveHandle: handle });
const truncated = truncateOversizedToolResultsInMessages([original], 32_000, 2_000, 2_000, {
  sessionId,
}).messages[0]!;
const referenceText = textOf([truncated]);
const uri = /^archive_uri: (.+)$/m.exec(referenceText)?.[1];
const checksum = /^checksum: (.+)$/m.exec(referenceText)?.[1];
const byteLength = Number(/^byte_length: (\d+)$/m.exec(referenceText)?.[1]);
if (uri !== handle.uri || checksum !== handle.checksum || byteLength !== handle.byteLength)
  throw new Error("Default truncation did not expose a complete archive reference.");
const recallArgs = {
  archive_uri: uri,
  checksum,
  byte_length: byteLength,
  offset: 0,
  max_chars: 12_000,
};
const recallTool = createContextArchiveRecallTool({ sessionId, archiveRecallRetention: true })!;
const recallStarted = performance.now();
const recalled = await recallTool.execute("eval-recall", recallArgs);
const recallElapsedMs = Number((performance.now() - recallStarted).toFixed(3));
const recalledMessage = {
  role: "toolResult",
  toolCallId: "eval-recall",
  toolName: "context_archive_recall",
  ...recalled,
  isError: false,
  timestamp: 1,
} as AgentMessage;
const sharedMessages = [
  user("Recover the private evidence from the archived tool output."),
  toolCall("raw-output", "exec", {}),
  truncated,
  toolCall("eval-recall", "context_archive_recall", recallArgs),
  recalledMessage,
  ...pressureTail(),
];
const baselineMessages = [
  user("Recover the private evidence from the archived tool output."),
  toolCall("raw-output", "exec", {}),
  toolResult("raw-output", "exec", formatContextLimitTruncationNotice(rawToolOutput.length)),
  ...pressureTail(),
];

const armInputs = [
  {
    name: "baseline",
    messages: baselineMessages,
    expectedAnswerable: false,
    retention: false,
    pruner: false,
  },
  {
    name: "reference-visible",
    messages: sharedMessages,
    expectedAnswerable: true,
    retention: false,
    pruner: false,
  },
  {
    name: "recall-stable",
    messages: sharedMessages,
    expectedAnswerable: true,
    retention: true,
    pruner: true,
  },
  {
    name: "retention-off",
    messages: sharedMessages,
    expectedAnswerable: false,
    retention: false,
    pruner: true,
  },
];
const transcript: Record<string, unknown> = {
  schema: "ContextInlineSpillTranscript/v2",
  driven_by: "agent",
  actor,
  raw_tool_output: rawToolOutput,
  archive_handle: handle,
  recall_invocation: {
    driven_by: "agent",
    args: recallArgs,
    elapsed_ms: recallElapsedMs,
    result: recalled,
  },
  arms: [],
};
const arms = [];
for (const arm of armInputs) {
  const started = performance.now();
  // All arms branch the same isolated session through the real guarded writer.
  // Each snapshot is reopened before replay, so metadata-cap failures are visible.
  fixtureSessionManager.resetLeaf();
  for (const message of arm.messages) fixtureSessionManager.appendMessage(message as never);
  const persistedPath = join(sessionsRoot, arm.name + ".jsonl");
  copyFileSync(fixtureSessionManager.getSessionFile()!, persistedPath);
  const replaySessionManager = SessionManager.open(persistedPath);
  const persistedMessages = replaySessionManager
    .getBranch()
    .filter((entry) => entry.type === "message")
    .map((entry) => entry.message) as AgentMessage[];
  const replayed = await sanitizeSessionHistory({
    messages: persistedMessages,
    modelApi: "openai-responses",
    sessionId,
    sessionManager: replaySessionManager,
    config: {
      runtime: { contextFamily: { archiveRecallRetention: { enabled: arm.retention } } },
    },
  });
  const pruned = arm.pruner ? prune(replayed, arm.retention) : replayed;
  const internalBoundary = normalizeMessagesForCurrentPromptBoundary({
    messages: pruned,
    prompt: "What is the exact private_evidence value?",
    archiveRecallRetention: { enabled: arm.retention, sessionId },
  });
  let messages: AgentMessage[] = [];
  const projectionAgent: Parameters<typeof installProviderPromptHistoryTransform>[0]["agent"] = {
    convertToLlm: (history) => convertToLlm(normalizeMessagesForLlmBoundary(history)),
    streamFn: (_model, context) => {
      messages = context.messages as AgentMessage[];
      // This captures the production projection only; it is not a fake live provider.
      return {} as never;
    },
  };
  const cleanupProjection = installProviderPromptHistoryTransform({
    agent: projectionAgent,
    contextWindowTokens: 32_000,
    maxChars: 12_000,
    aggregateMaxChars: 16_000,
    archiveRecallRetention: { enabled: arm.retention, sessionId },
  });
  try {
    const converted = await projectionAgent.convertToLlm(internalBoundary);
    projectionAgent.streamFn({} as never, { messages: converted, systemPrompt: "" });
  } finally {
    cleanupProjection();
  }
  if (messages.some((message) => "details" in message))
    throw new Error("Internal retention provenance leaked into provider messages.");
  const mainContext = textOf(messages);
  const prompt = providerPrompt(messages);
  const answerable = mainContext.includes(privateValue);
  if (!arm.expectedAnswerable && prompt.includes(privateValue))
    throw new Error("Oracle leaked into negative arm " + arm.name);
  const projectionMs = Number((performance.now() - started).toFixed(3));
  const providerResult =
    MODE === "live"
      ? await live(prompt, arm.expectedAnswerable)
      : ({ status: "not-run", reason: "Deterministic oracle; no provider invoked." } as LiveResult);
  const refs = mainContext.includes(handle.uri) && mainContext.includes(handle.checksum);
  const armResult = {
    name: arm.name,
    sample_count: 1,
    repetitions: 1,
    negative_control: !arm.expectedAnswerable,
    quality: {
      exact_value_available: answerable,
      score: Number(answerable),
      expected_answerable: arm.expectedAnswerable,
      expected_behavior_matched: answerable === arm.expectedAnswerable,
    },
    main_context_chars: mainContext.length,
    main_context_tokens_proxy: tokens(mainContext),
    model_input_chars: prompt.length,
    total_tokens_proxy: tokens(prompt),
    actual_total_tokens: providerResult.usage?.total_tokens ?? null,
    token_estimate_kind: "weighted-characters/4 proxy; live usage is separately observed",
    latency_ms: {
      projection: projectionMs,
      shared_fixture_recall: arm.name === "baseline" ? 0 : recallElapsedMs,
      provider: providerResult.elapsed_ms ?? null,
    },
    cost: COST,
    evidence_refs: {
      present: refs,
      resolved: refs && verified.ok,
      resolution_rate: refs ? Number(verified.ok) : null,
    },
    scope: {
      sessionId,
      stale: false,
      retention_enabled: arm.retention,
      max_turns: ARCHIVE_RECALL_RETENTION_TURNS,
      max_retained_chars: ARCHIVE_RECALL_RETENTION_MAX_CHARS,
    },
    retained: arm.retention
      ? getRetainedArchiveRecalls(internalBoundary, { enabled: true, sessionId })
      : [],
    production_projection: {
      path: "guarded transcript write -> disk reload -> sanitizeSessionHistory -> pruner -> internal precheck -> eligible-source selection -> convertToLlm -> final provider truncation -> strip details -> stream projection",
      persisted_session_ref: relative(runDir, persistedPath).replaceAll("\\", "/"),
      persisted_session_id: replaySessionManager.getSessionId(),
      persisted_leaf_id: replaySessionManager.getLeafId(),
      internal_replay_retained: getRetainedArchiveRecalls(replayed, {
        enabled: arm.retention,
        sessionId,
      }).length,
      provider_details_stripped: messages.every((message) => !("details" in message)),
    },
    failure_class: answerable
      ? null
      : arm.name === "baseline"
        ? "archive_reference_missing"
        : "recalled_text_pruned",
    live: providerResult,
    transcript_ref: "transcript.json",
  };
  arms.push(armResult);
  (transcript.arms as unknown[]).push({
    name: arm.name,
    before: arm.messages,
    after_disk_reload: persistedMessages,
    after_replay: replayed,
    after_pruner: pruned,
    internal_boundary: internalBoundary,
    after: messages,
    request:
      MODE === "live"
        ? {
            endpoint_origin: BASE_URL ? new URL(BASE_URL).origin : null,
            model: MODEL,
            body: { model: MODEL, input: prompt, temperature: 0, max_output_tokens: 800 },
          }
        : null,
    provider_result: providerResult,
  });
  console.log(
    JSON.stringify({
      arm: arm.name,
      exactValueAvailable: answerable,
      providerStatus: providerResult.status,
      expectedBehaviorMatched: providerResult.expected_behavior_matched ?? null,
      elapsedMs: providerResult.elapsed_ms ?? null,
    }),
  );
}

const expiredMessages = [
  ...sharedMessages,
  assistant("The fourth subsequent assistant turn has completed."),
];
const expiredOn = prune(expiredMessages, true);
const expiredOff = prune(expiredMessages, false);
const foreignTool = createContextArchiveRecallTool({
  sessionId: "other-session",
  archiveRecallRetention: true,
})!;
const rejectionResults = [
  {
    name: "checksum-mismatch",
    result: await recallTool.execute("checksum-negative", {
      ...recallArgs,
      checksum: "sha256:" + "a".repeat(64),
    }),
  },
  { name: "cross-session", result: await foreignTool.execute("scope-negative", recallArgs) },
  {
    name: "archive-missing",
    result: await recallTool.execute("missing-negative", {
      ...recallArgs,
      archive_uri: "context-archive://" + sessionId + "/missing.context-archive.json",
    }),
  },
];
const rejected = rejectionResults.map(({ name, result }) => {
  const details = result.details as Record<string, unknown>;
  return {
    name,
    failed_closed: details.ok === false && details.archiveRecallOrigin === undefined,
    details,
  };
});
const old = JSON.parse(readFileSync(baselinePath, "utf8")) as {
  toolResult: AgentMessage;
  pruner: { input: Parameters<typeof pruneContextMessages>[0]; output: unknown };
  truncation: {
    input: Parameters<typeof estimateToolResultReductionPotential>[0];
    output: unknown;
  };
  reduction: { input: Parameters<typeof estimateToolResultReductionPotential>[0]; output: unknown };
  compaction: {
    input: Parameters<typeof shouldPreemptivelyCompactBeforePrompt>[0];
    output: unknown;
  };
};
// Replay the frozen input through the real owner/tool; do not replace or
// rewrite the baseline captured before the retention implementation.
const oldDetails = (old.toolResult as { details: Record<string, unknown> }).details;
const oldSessionId = "session-inline-spill-retention";
const oldHandle = createContextArchiveHandleForPayloadSync({
  sessionId: oldSessionId,
  itemId: "inline-spill-retention-observation" as never,
  payload: oldDetails.content,
  archiveRoot,
  source: { type: "tool_call", sessionId: oldSessionId, label: "retention-reproduction" },
});
const oldTool = createContextArchiveRecallTool({
  sessionId: oldSessionId,
  archiveRecallRetention: false,
})!;
const oldToolResult = await oldTool.execute("recall-call", {
  archive_uri: oldHandle.uri,
  checksum: oldHandle.checksum,
  byte_length: oldHandle.byteLength,
  offset: 0,
  max_chars: 5_000,
});
const replayedOldMessage = {
  role: "toolResult",
  toolName: "context_archive_recall",
  toolCallId: "recall-call",
  content: oldToolResult.content,
  details: oldToolResult.details,
  isError: false,
  timestamp: 2,
};
const oldTrunc = old.truncation.input;
const parity = {
  baseline_ref: "off-mode-baseline.json",
  baseline_sha256: digest(readFileSync(baselinePath)),
  tool_result: JSON.stringify(replayedOldMessage) === JSON.stringify(old.toolResult),
  pruner:
    JSON.stringify(
      pruneContextMessages({
        ...old.pruner.input,
        archiveRecallRetention: { enabled: false, sessionId },
      }),
    ) === JSON.stringify(old.pruner.output),
  truncation:
    JSON.stringify(
      truncateOversizedToolResultsInMessages(
        oldTrunc.messages,
        oldTrunc.contextWindowTokens,
        oldTrunc.maxCharsOverride,
        oldTrunc.aggregateMaxCharsOverride,
        { archiveRecallRetention: false },
      ),
    ) === JSON.stringify(old.truncation.output),
  reduction:
    JSON.stringify(
      estimateToolResultReductionPotential({
        ...old.reduction.input,
        archiveRecallRetention: { enabled: false, sessionId },
      }),
    ) === JSON.stringify(old.reduction.output),
  compaction:
    JSON.stringify(
      shouldPreemptivelyCompactBeforePrompt({
        ...old.compaction.input,
        archiveRecallRetention: { enabled: false, sessionId },
      }),
    ) === JSON.stringify(old.compaction.output),
};
const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
let soak: Record<string, unknown> = {
  status: "not-run",
  reason: "Run tsx with --expose-gc for bounded heap evidence.",
  passed: false,
};
if (gc) {
  for (let index = 0; index < 100; index++) prune(sharedMessages, true);
  gc();
  const beforeHeap = process.memoryUsage().heapUsed;
  const beforeDigest = digest(JSON.stringify(sharedMessages));
  const started = performance.now();
  let stable = true;
  for (let index = 0; index < 5_000; index++)
    stable &&= prune(sharedMessages, true) === sharedMessages;
  gc();
  const afterHeap = process.memoryUsage().heapUsed;
  const unchanged = beforeDigest === digest(JSON.stringify(sharedMessages));
  soak = {
    status: "executed",
    iterations: 5_000,
    elapsed_ms: Number((performance.now() - started).toFixed(3)),
    heap_before_bytes: beforeHeap,
    heap_after_bytes: afterHeap,
    heap_growth_bytes: afterHeap - beforeHeap,
    heap_growth_limit_bytes: 2 * 1024 * 1024,
    same_array: stable,
    messages_unchanged: unchanged,
    message_count: sharedMessages.length,
    passed: stable && unchanged && afterHeap - beforeHeap <= 2 * 1024 * 1024,
  };
}
const onChars = arms.find((arm) => arm.name === "recall-stable")!.main_context_chars;
const offChars = arms.find((arm) => arm.name === "retention-off")!.main_context_chars;
const multiBlockInput = [
  recalledMessage,
  {
    role: "toolResult",
    toolName: "exec",
    toolCallId: "aggregate-multi-block",
    timestamp: 1,
    content: Array.from({ length: 3 }, () => ({ type: "text", text: "o".repeat(1_000) })),
  },
] as AgentMessage[];
const aggregateControlBudget =
  getToolResultTextLength(recalledMessage) + 2 * formatContextLimitTruncationNotice(1).length;
const aggregateOn = truncateOversizedToolResultsInMessages(
  multiBlockInput,
  32_000,
  16_000,
  aggregateControlBudget,
  { sessionId, archiveRecallRetention: true },
);
const aggregateOff = truncateOversizedToolResultsInMessages(
  multiBlockInput,
  32_000,
  16_000,
  aggregateControlBudget,
  { sessionId, archiveRecallRetention: false },
);
const toolTextChars = (messages: AgentMessage[]) =>
  messages.reduce((sum, message) => sum + getToolResultTextLength(message), 0);
const controls = {
  aggregate_block_budget: {
    budget_chars: aggregateControlBudget,
    on_chars: toolTextChars(aggregateOn.messages),
    off_chars: toolTextChars(aggregateOff.messages),
    legacy_plan_used: aggregateOn.messages[0] !== recalledMessage,
    passed:
      toolTextChars(aggregateOn.messages) <= aggregateControlBudget &&
      toolTextChars(aggregateOff.messages) <= aggregateControlBudget &&
      aggregateOn.messages[0] !== recalledMessage,
  },
  expiry: {
    age_turns: 4,
    evidence_available: textOf(expiredOn).includes(privateValue),
    old_path_restored: JSON.stringify(expiredOn) === JSON.stringify(expiredOff),
    passed:
      !textOf(expiredOn).includes(privateValue) &&
      JSON.stringify(expiredOn) === JSON.stringify(expiredOff),
  },
  rejected,
  off_mode_parity: parity,
  repeat_projection_soak: soak,
  context_growth: {
    chars: onChars - offChars,
    limit: ARCHIVE_RECALL_RETENTION_MAX_CHARS,
    passed: onChars - offChars <= ARCHIVE_RECALL_RETENTION_MAX_CHARS,
  },
};
const deterministicPass =
  arms.every((arm) => arm.quality.expected_behavior_matched) &&
  controls.expiry.passed &&
  rejected.every((item) => item.failed_closed) &&
  parity.tool_result &&
  parity.pruner &&
  parity.truncation &&
  parity.reduction &&
  parity.compaction &&
  soak.passed === true &&
  controls.context_growth.passed &&
  controls.aggregate_block_budget.passed;
const liveStatus =
  MODE !== "live" || arms.every((arm) => arm.live.status === "not-run")
    ? "not-run"
    : arms.every((arm) => arm.live.status === "executed")
      ? "executed"
      : "failed";
const livePairedPass =
  liveStatus === "executed" ? arms.every((arm) => arm.live.expected_behavior_matched) : null;
const git = (args: string[]) =>
  execFileSync("git", args, { cwd: ROOT, windowsHide: true, encoding: "utf8" }).trim();
const sourcePaths = [
  "scripts/context-inline-spill-eval.mts",
  "harness/specs/tasks/context-inline-spill-default-path.md",
  "openclaw_runtime/src/agents/archive-recall-retention.ts",
  "openclaw_runtime/src/agents/tools/context-agent-tools.ts",
  "openclaw_runtime/src/agents/agent-hooks/context-pruning/pruner.ts",
  "openclaw_runtime/src/agents/embedded-agent-runner/tool-result-truncation.ts",
  "openclaw_runtime/src/agents/embedded-agent-runner/run/preemptive-compaction.ts",
  "openclaw_runtime/src/agents/embedded-agent-runner/replay-history.ts",
  "openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.llm-boundary.ts",
  "openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts",
  "openclaw_runtime/src/agents/session-transcript-repair.ts",
  "openclaw_runtime/src/agents/tool-call-id.ts",
  "openclaw_runtime/src/agents/embedded-agent-helpers/openai.ts",
  "openclaw_runtime/src/agents/session-tool-result-guard.ts",
  "openclaw_runtime/src/agents/sessions/session-manager.ts",
  "openclaw_runtime/src/agents/sessions/sdk.ts",
  "openclaw_runtime/packages/agent-core/src/harness/messages.ts",
];
const result = {
  schema: "ContextInlineSpillEval/v2",
  runId: RUN_ID,
  mode: MODE,
  driven_by: "agent",
  actor,
  candidate: {
    commit: git(["rev-parse", "HEAD"]),
    tree: git(["rev-parse", "HEAD^{tree}"]),
    dirty: git(["status", "--porcelain=v1"]).length > 0,
  },
  source_inputs: sourcePaths.map((path) => ({
    path,
    sha256: digest(readFileSync(resolve(ROOT, path))),
  })),
  provider: {
    kind: MODE === "live" ? "openai-compatible-responses" : "deterministic-local-oracle",
    endpoint_origin: MODE === "live" && BASE_URL ? new URL(BASE_URL).origin : null,
    model: MODE === "live" ? (MODEL ?? null) : null,
    credential_persisted: false,
  },
  fixture: {
    payload_sha256: digest(rawToolOutput),
    payload_chars: rawToolOutput.length,
    archive_uri: handle.uri,
    checksum: handle.checksum,
    byte_length: handle.byteLength,
    archive_verified: verified.ok,
    oracle_private_value: privateValue,
  },
  arms,
  controls,
  decision: {
    deterministicPass,
    liveStatus,
    livePairedPass,
    qualityNoRegression:
      arms.find((arm) => arm.name === "recall-stable")!.quality.score >=
      arms.find((arm) => arm.name === "reference-visible")!.quality.score,
    engineeringAcceptedByAgent: false,
    releaseApproved: false,
    liveReady: false,
    defaultOn: false,
  },
  boundaries: [
    "One fixture and one provider request per arm; this is not a statistical product-quality benchmark.",
    "Recall is agent-driven through the real tool. Autonomous model tool selection and full agent-loop continuation are not claimed.",
    "Retention protects budget-fitting pruner/replacement projections; full summarization and hard overflow remain with their existing owners.",
    "Actual provider usage is reported when supplied; deterministic token figures are proxies and billing cost is not-run.",
  ],
};
Object.assign(transcript, {
  controls: {
    expired_before: expiredMessages,
    expired_after: expiredOn,
    rejections: rejectionResults,
    aggregate_before: multiBlockInput,
    aggregate_on: aggregateOn.messages,
    aggregate_off: aggregateOff.messages,
  },
  candidate: result.candidate,
});
save("result.json", result);
save("transcript.json", transcript);
const archiveFiles = readdirSync(archiveRoot, { recursive: true })
  .map(String)
  .filter((name) => name.endsWith(".json"))
  .sort();
const transcriptFiles = readdirSync(sessionsRoot)
  .map(String)
  .filter((name) => name.endsWith(".jsonl"))
  .sort();
save("recovery-index.json", {
  schema: "ContextInlineSpillRecoveryIndex/v1",
  driven_by: "agent",
  actor,
  archive_root: "archives",
  archives: archiveFiles.map((name) => {
    const file = join(archiveRoot, name);
    const artifact = JSON.parse(readFileSync(file, "utf8")) as {
      handle: { uri: string; checksum: string; byteLength: number };
    };
    return {
      uri: artifact.handle.uri,
      checksum: artifact.handle.checksum,
      byte_length: artifact.handle.byteLength,
      path: relative(runDir, file).replaceAll("\\", "/"),
      sha256: digest(readFileSync(file)),
    };
  }),
  transcripts: transcriptFiles.map((name) => ({
    session_id: sessionId,
    path: relative(runDir, join(sessionsRoot, name)).replaceAll("\\", "/"),
    sha256: digest(readFileSync(join(sessionsRoot, name))),
  })),
});
const files = [
  "result.json",
  "transcript.json",
  "recovery-index.json",
  ...archiveFiles.map((name) => relative(runDir, join(archiveRoot, name)).replaceAll("\\", "/")),
  ...transcriptFiles.map((name) =>
    relative(runDir, join(sessionsRoot, name)).replaceAll("\\", "/"),
  ),
];
const credentialHits = files.reduce((sum, name) => {
  const text = readFileSync(join(runDir, name), "utf8");
  return (
    sum +
    Number(Boolean(API_KEY && text.includes(API_KEY))) +
    (text.match(/\bsk-[A-Za-z0-9_-]{16,}\b/g)?.length ?? 0)
  );
}, 0);
save("credential-scan.json", {
  schema: "ContextInlineSpillCredentialScan/v1",
  driven_by: "agent",
  actor,
  files_scanned: files.length,
  hits: credentialHits,
  passed: credentialHits === 0,
});
files.push("credential-scan.json");
writeFileSync(
  join(runDir, "SHA256SUMS"),
  files.map((name) => digest(readFileSync(join(runDir, name))) + "  " + name).join("\n") + "\n",
);
const diskResult = JSON.parse(readFileSync(join(runDir, "result.json"), "utf8")) as typeof result;
console.log(
  JSON.stringify(
    {
      runDir,
      candidate: diskResult.candidate,
      decision: diskResult.decision,
      controls: diskResult.controls,
      credentialHits,
    },
    null,
    2,
  ),
);
process.exitCode =
  deterministicPass && liveStatus !== "failed" && livePairedPass !== false && credentialHits === 0
    ? 0
    : 1;
