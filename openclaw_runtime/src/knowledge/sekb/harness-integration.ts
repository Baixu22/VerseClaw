import type { AgentMessage } from "../../agents/runtime/index.js";
import type { ContextInjector } from "./retrieval-engine.js";
import type { TrajectoryCapture } from "./trajectory-capture.js";
import type { RuntimeLineage } from "../../runtime-core/lineage.js";
import { Type } from "typebox";
import type { ToolDefinition } from "../../agents/sessions/extensions/types.js";
import type { KnowledgeStore } from "./knowledge-store.js";
import type { SourceRefV2 } from "../../runtime-core/knowledge-owner-read.js";
import { digestOwnerReadContent } from "../../runtime-core/knowledge-owner-read.js";
import {
  experienceReadPolicy,
  getPrincipleVersion,
  isConfirmedPrinciple,
  SEKB_ATTRIBUTION_SCHEMA,
  type Principle,
  type SekbAdoptionEvidence,
  type SekbRunIdentity,
} from "./types.js";

export type SekbTaskClassification = {
  task_intent: string;
  task_type: string;
  context_tags: string[];
};

export type SekbTaskClassifier = (event: {
  prompt: string;
  systemPrompt: string;
  resources: unknown;
}) => SekbTaskClassification;

export type SekbHarnessHookTarget = {
  on(type: string, handler: (event: unknown, context?: unknown) => unknown): () => void;
  subscribe?: (listener: (event: unknown) => unknown) => () => void;
  registerTool?: (definition: ToolDefinition) => void;
};

export type InstallSekbHarnessHooksOptions = {
  enabled: boolean;
  capture: TrajectoryCapture;
  injector: ContextInjector;
  store?: KnowledgeStore;
  identity?: SekbRunIdentity | (() => SekbRunIdentity);
  /** When provided, DCS owns both retrieval and actual context exposure. */
  retainedExperience?: () => readonly SourceRefV2[];
  classifyTask?: SekbTaskClassifier;
  lineage?: RuntimeLineage | (() => RuntimeLineage | undefined);
  onError?: (error: unknown) => void;
};

type ActiveSekbRun = {
  trajectoryId: string;
  tags: string[];
  rawError: string | null;
  identity: SekbRunIdentity;
  exposed: Map<string, { principleId: string; version: string }>;
  operations: Map<string, NonNullable<SekbAdoptionEvidence["operation"]>>;
};

type TextBlock = { type: "text"; text: string };
type ContentBlock = TextBlock | { type: string; [key: string]: unknown };
type ToolResultMessage = Extract<AgentMessage, { role: "toolResult" }>;

type BeforeAgentStartPayload = {
  prompt: string;
  systemPrompt: string;
  resources: unknown;
  hasSystemPrompt: boolean;
};

type ToolCallPayload = {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
};

type ToolResultPayload = ToolCallPayload & {
  content: ContentBlock[];
  details: unknown;
  isError: boolean;
  message?: ToolResultMessage;
};

type AgentEndPayload = {
  success?: boolean;
  error: string | null;
};

const DEFAULT_RUN_KEY = "__sekb_default_run__";
export const SEKB_ADOPTION_TOOL_NAME = "record_sekb_adoption";
const EMPTY_IDENTITY: SekbRunIdentity = {
  taskId: null,
  runId: null,
  sessionId: null,
  sessionKey: null,
  experimentId: null,
  arm: null,
  repeat: null,
};
const adoptionParameters = Type.Object(
  {
    principleId: Type.String({ minLength: 1, maxLength: 256 }),
    principleVersion: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    trigger: Type.String({ enum: ["cited", "adopted"] }),
    operationToolCallId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  },
  { additionalProperties: false },
);

export function installSekbHarnessHooks(
  target: SekbHarnessHookTarget,
  options: InstallSekbHarnessHooksOptions,
): () => void {
  if (!options.enabled) {
    return () => {};
  }

  const activeRuns = new Map<string, ActiveSekbRun>();
  const toolCallRunKeys = new Map<string, { runKey: string; toolName: string }>();
  let lastActiveRunKey: string | null = null;
  const classify = options.classifyTask ?? defaultSekbTaskClassifier;
  if (options.store && target.registerTool) {
    const definition: ToolDefinition<typeof adoptionParameters> = {
      name: SEKB_ADOPTION_TOOL_NAME,
      label: "Record SEKB attribution",
      description:
        "Cite an exposed principle, or attribute an observed successful tool operation to its exact id and content version. This records agent attribution, not causal benefit or task success.",
      promptSnippet: "Record explicit use of a recalled SEKB principle with its id and version.",
      parameters: adoptionParameters,
      risk: "readonly",
      writeRiskProfile: {
        kind: "durable_state",
        ownerStore: "sekb_attribution_events",
        requiresApproval: false,
      },
      async execute(_toolCallId, params, signal) {
        signal?.throwIfAborted();
        if (
          !isRecord(params) ||
          Object.keys(params).some(
            (key) =>
              !["principleId", "principleVersion", "trigger", "operationToolCallId"].includes(key),
          ) ||
          !readStringField(params, "principleId") ||
          !/^[a-f0-9]{64}$/u.test(params.principleVersion) ||
          (params.trigger !== "cited" && params.trigger !== "adopted") ||
          (params.operationToolCallId !== undefined &&
            !readStringField(params, "operationToolCallId"))
        ) {
          throw new Error("Invalid record_sekb_adoption arguments");
        }
        // The closure owns run identity. Model arguments cannot select another task or experiment arm.
        const configured = resolveRunIdentity(options.identity);
        const active = configured.runId
          ? activeRuns.get(configured.runId)
          : activeRuns.size === 1
            ? [...activeRuns.values()][0]
            : undefined;
        if (active) recordRetainedExposure(options, active);
        if (
          options.retainedExperience &&
          !currentRetainedPrinciples(options).some(
            (principle) =>
              principle.principle_id === params.principleId &&
              getPrincipleVersion(principle) === params.principleVersion,
          )
        ) {
          const details = { status: "rejected", reason: "experience-no-longer-admitted" };
          return { content: [{ type: "text", text: JSON.stringify(details) }], details };
        }
        const operation =
          params.trigger === "adopted" && params.operationToolCallId
            ? (active?.operations.get(params.operationToolCallId) ?? {
                toolCallId: params.operationToolCallId,
                toolName: null,
                observed: false,
                succeeded: null,
              })
            : null;
        const result = options.store!.record_adoption(params.principleId, {
          ...attributionEvidence(active, params.principleVersion),
          trigger: params.trigger,
          source: "agent",
          operation,
        });
        const details =
          result.disposition === "conflict"
            ? {
                status: "rejected",
                reason: "conflicting-replay",
                disposition: result.disposition,
                eventId: result.eventId,
                conflictCount: result.conflictCount,
              }
            : result;
        return { content: [{ type: "text", text: JSON.stringify(details) }], details };
      },
    };
    target.registerTool(definition);
  }
  const unsubs = [
    target.on("context", () =>
      safe(options, () => {
        const identity = resolveRunIdentity(options.identity);
        const active = identity.runId
          ? activeRuns.get(identity.runId)
          : activeRuns.size === 1
            ? [...activeRuns.values()][0]
            : undefined;
        if (active) recordRetainedExposure(options, active);
      }),
    ),
    target.on("before_agent_start", (event, context) =>
      safe(options, () => {
        const payload = readBeforeAgentStartEvent(event);
        if (!payload) {
          return undefined;
        }
        const classification = classify(payload);
        const configured = resolveRunIdentity(options.identity);
        const eventRunId = readRunKey(event, context);
        if (configured.runId && eventRunId && configured.runId !== eventRunId)
          throw new Error("SEKB run identity mismatch");
        const identity = {
          ...configured,
          runId: configured.runId ?? eventRunId,
          sessionId: configured.sessionId ?? readStringField(context, "sessionId"),
          sessionKey: configured.sessionKey ?? readStringField(context, "sessionKey"),
        };
        const runKey = identity.runId ?? DEFAULT_RUN_KEY;
        const lineage = resolveConfiguredLineage(options.lineage);
        const metadata = {
          sekbCaptureOrigin: "agent_end" as const,
          ...(identity.sessionId ? { sessionId: identity.sessionId } : {}),
          ...(lineage ? { runtimeLineage: lineage } : {}),
        };
        activeRuns.set(runKey, {
          trajectoryId: options.capture.start_trajectory(
            classification.task_intent,
            classification.task_type,
            classification.context_tags,
            metadata,
          ),
          tags: classification.context_tags,
          rawError: null,
          identity,
          exposed: new Map(),
          operations: new Map(),
        });
        lastActiveRunKey = runKey;
        if (options.retainedExperience) return undefined;
        const onRetrieved = (principles: readonly Principle[]) =>
          recordExposure(options, activeRuns.get(runKey)!, principles);
        if (payload.hasSystemPrompt) {
          return {
            systemPrompt: options.injector.for_task(
              payload.systemPrompt,
              classification.task_intent,
              classification.task_type,
              classification.context_tags,
              onRetrieved,
            ),
          };
        }
        const appendContext = options.injector
          .for_task(
            "",
            classification.task_intent,
            classification.task_type,
            classification.context_tags,
            onRetrieved,
          )
          .trim();
        return appendContext ? { appendContext } : undefined;
      }),
    ),
    target.on("before_tool_call", (event, context) =>
      safe(options, () =>
        handleToolCallEvent(event, context, options, activeRuns, toolCallRunKeys, lastActiveRunKey),
      ),
    ),
    target.on("tool_call", (event, context) =>
      safe(options, () =>
        handleToolCallEvent(event, context, options, activeRuns, toolCallRunKeys, lastActiveRunKey),
      ),
    ),
    target.on("tool_result_persist", (event, context) =>
      safe(options, () =>
        handleToolResultEvent(
          event,
          context,
          options,
          activeRuns,
          toolCallRunKeys,
          lastActiveRunKey,
        ),
      ),
    ),
    target.on("tool_result", (event, context) =>
      safe(options, () =>
        handleToolResultEvent(
          event,
          context,
          options,
          activeRuns,
          toolCallRunKeys,
          lastActiveRunKey,
        ),
      ),
    ),
    target.on("agent_end", (event, context) =>
      safe(options, () => {
        const runKey = readRunKey(event, context) ?? lastActiveRunKey ?? DEFAULT_RUN_KEY;
        const active = activeRuns.get(runKey);
        if (!active) {
          return undefined;
        }
        finishActiveRun(
          options,
          active,
          readAgentEndEvent(event),
          resolveConfiguredLineage(options.lineage),
        );
        activeRuns.delete(runKey);
        clearToolCallsForRun(toolCallRunKeys, runKey);
        if (lastActiveRunKey === runKey) {
          lastActiveRunKey = null;
        }
        return undefined;
      }),
    ),
  ];
  if (target.subscribe) {
    unsubs.push(
      target.subscribe((event) =>
        safe(options, () => {
          const type = readEventType(event);
          const runKey = readRunKey(event) ?? lastActiveRunKey ?? DEFAULT_RUN_KEY;
          const active = activeRuns.get(runKey);
          if (!active) {
            return undefined;
          }
          if (type === "agent_end") {
            finishActiveRun(
              options,
              active,
              readAgentEndEvent(event),
              resolveConfiguredLineage(options.lineage),
            );
            activeRuns.delete(runKey);
            clearToolCallsForRun(toolCallRunKeys, runKey);
            if (lastActiveRunKey === runKey) {
              lastActiveRunKey = null;
            }
          }
          if (type === "abort") {
            finishActiveRun(
              options,
              active,
              { success: false, error: null },
              resolveConfiguredLineage(options.lineage),
              "partial",
            );
            activeRuns.delete(runKey);
            clearToolCallsForRun(toolCallRunKeys, runKey);
            if (lastActiveRunKey === runKey) {
              lastActiveRunKey = null;
            }
          }
          return undefined;
        }),
      ),
    );
  }

  return () => {
    for (const unsub of unsubs.splice(0)) {
      unsub();
    }
  };
}

function handleToolCallEvent(
  event: unknown,
  context: unknown,
  options: InstallSekbHarnessHooksOptions,
  activeRuns: Map<string, ActiveSekbRun>,
  toolCallRunKeys: Map<string, { runKey: string; toolName: string }>,
  lastActiveRunKey: string | null,
): undefined {
  const payload = readToolCallEvent(event, context);
  const runKey = readRunKey(event, context) ?? lastActiveRunKey ?? DEFAULT_RUN_KEY;
  const active = activeRuns.get(runKey);
  if (!active || !payload) {
    return undefined;
  }
  recordRetainedExposure(options, active);
  toolCallRunKeys.set(payload.toolCallId, { runKey, toolName: payload.toolName });
  options.capture.log_step(active.trajectoryId, "tool.call", payload.input, {
    toolName: payload.toolName,
    toolCallId: payload.toolCallId,
  });
  return undefined;
}

function handleToolResultEvent(
  event: unknown,
  context: unknown,
  options: InstallSekbHarnessHooksOptions,
  activeRuns: Map<string, ActiveSekbRun>,
  toolCallRunKeys: Map<string, { runKey: string; toolName: string }>,
  lastActiveRunKey: string | null,
): { content?: ContentBlock[]; message?: ToolResultMessage } | undefined {
  const payload = readToolResultEvent(event, context);
  const runKey =
    (payload?.toolCallId ? toolCallRunKeys.get(payload.toolCallId)?.runKey : undefined) ??
    readRunKey(event, context) ??
    lastActiveRunKey ??
    DEFAULT_RUN_KEY;
  const active = activeRuns.get(runKey);
  if (!active || !payload) {
    return undefined;
  }
  options.capture.log_step(active.trajectoryId, "tool.result", payload.input, {
    toolName: payload.toolName,
    toolCallId: payload.toolCallId,
    isError: payload.isError,
    content: payload.content,
    details: payload.details,
  });
  // An attribution tool cannot endorse its own bookkeeping call as an adopted operation.
  if (payload.toolName !== SEKB_ADOPTION_TOOL_NAME) {
    const call = toolCallRunKeys.get(payload.toolCallId);
    const explicitRunId = readRunKey(event, context);
    const observed =
      call?.toolName === payload.toolName && (!explicitRunId || explicitRunId === call.runKey);
    const errorObserved =
      isRecord(event) && typeof event.isError === "boolean"
        ? event.isError
        : payload.message && typeof payload.message.isError === "boolean"
          ? payload.message.isError
          : null;
    const operation = {
      toolCallId: payload.toolCallId,
      toolName: payload.toolName,
      observed,
      succeeded: observed && errorObserved !== null ? !errorObserved : null,
    };
    active.operations.set(payload.toolCallId, operation);
    for (const exposed of active.exposed.values())
      safe(options, () =>
        options.store?.record_adoption(exposed.principleId, {
          ...attributionEvidence(active, exposed.version),
          trigger: "operation",
          operation,
          observationId: readEventType(event) ?? "tool_result",
        }),
      );
  }
  if (!payload.isError) {
    return undefined;
  }
  if (options.retainedExperience) return undefined;
  active.rawError = textFromContent(payload.content) || `${payload.toolName} failed`;
  const signature = options.capture.extract_error_signature(active.rawError);
  const advice = options.injector.for_error(signature, active.tags, (principles) =>
    recordExposure(options, active, principles),
  );
  if (!advice) {
    return undefined;
  }
  return payload.message
    ? { message: appendAdviceToToolResultMessage(payload.message, advice) }
    : { content: appendAdvice(payload.content, advice) };
}

function finishActiveRun(
  options: InstallSekbHarnessHooksOptions,
  active: ActiveSekbRun,
  payload: AgentEndPayload | null,
  lineage?: RuntimeLineage,
  forcedOutcome?: "partial",
): void {
  recordRetainedExposure(options, active);
  const capture = options.capture;
  if (lineage && typeof capture.update_active_metadata === "function") {
    capture.update_active_metadata(active.trajectoryId, { runtimeLineage: lineage });
  }
  const rawError = active.rawError ?? payload?.error ?? null;
  const outcome =
    forcedOutcome ??
    (payload?.success === true
      ? "success"
      : rawError
        ? "failure"
        : payload?.success === false
          ? "partial"
          : "partial");
  capture.finish_trajectory(active.trajectoryId, outcome, rawError);
  const operationalOutcome = forcedOutcome
    ? "unknown"
    : payload?.success === true
      ? "success"
      : payload?.success === false || payload?.error
        ? "failure"
        : "unknown";
  for (const exposed of active.exposed.values())
    safe(options, () =>
      options.store?.record_adoption(exposed.principleId, {
        ...attributionEvidence(active, exposed.version),
        trigger: "outcome",
        outcomeKind: "operational",
        outcome: operationalOutcome,
        observationId: `agent_end:${active.trajectoryId}`,
      }),
    );
}

function resolveRunIdentity(identity: InstallSekbHarnessHooksOptions["identity"]): SekbRunIdentity {
  return identity ? (typeof identity === "function" ? identity() : identity) : EMPTY_IDENTITY;
}

function attributionEvidence(
  active: ActiveSekbRun | undefined,
  version: string,
): SekbAdoptionEvidence {
  return {
    ...(active?.identity ?? EMPTY_IDENTITY),
    schemaVersion: SEKB_ATTRIBUTION_SCHEMA,
    principleVersion: version,
    trajectoryId: active?.trajectoryId ?? null,
    trigger: "retrieved",
    source: "runtime",
    outcome: "unknown",
    outcomeKind: null,
    observationId: null,
    operation: null,
    actor: "embedded-agent",
    driven_by: "agent",
  };
}

function recordExposure(
  options: InstallSekbHarnessHooksOptions,
  active: ActiveSekbRun,
  principles: readonly Principle[],
): void {
  for (const principle of principles) {
    const version = getPrincipleVersion(principle);
    active.exposed.set(`${principle.principle_id}@${version}`, {
      principleId: principle.principle_id,
      version,
    });
    safe(options, () =>
      options.store?.record_adoption(principle.principle_id, {
        ...attributionEvidence(active, version),
        trigger: options.retainedExperience ? "context-exposure" : "retrieved",
      }),
    );
  }
}

function currentRetainedPrinciples(options: InstallSekbHarnessHooksOptions): Principle[] {
  if (!options.retainedExperience || !options.store) return [];
  const principles: Principle[] = [];
  for (const pin of options.retainedExperience()) {
    if (
      pin.domain !== "experience" ||
      pin.authorityId !== "sekb" ||
      pin.namespaceId !== options.store.get_source_namespace_id()
    )
      continue;
    safe(options, () => {
      const principle = options.store!.get_principle(pin.subjectId);
      const version = getPrincipleVersion(principle);
      if (
        !isConfirmedPrinciple(principle) ||
        version !== pin.revision ||
        digestOwnerReadContent(principle.full_content) !== pin.sourceDigest ||
        digestOwnerReadContent(JSON.stringify(experienceReadPolicy(principle))) !== pin.policyEpoch
      )
        return;
      principles.push(principle);
    });
  }
  return principles;
}

function recordRetainedExposure(
  options: InstallSekbHarnessHooksOptions,
  active: ActiveSekbRun,
): void {
  for (const principle of currentRetainedPrinciples(options)) {
    if (!active.exposed.has(`${principle.principle_id}@${getPrincipleVersion(principle)}`))
      recordExposure(options, active, [principle]);
  }
}

function resolveConfiguredLineage(
  lineage: InstallSekbHarnessHooksOptions["lineage"],
): RuntimeLineage | undefined {
  return typeof lineage === "function" ? lineage() : lineage;
}

function clearToolCallsForRun(
  toolCallRunKeys: Map<string, { runKey: string; toolName: string }>,
  runKey: string,
): void {
  for (const [toolCallId, mappedRunKey] of toolCallRunKeys) {
    if (mappedRunKey.runKey === runKey) {
      toolCallRunKeys.delete(toolCallId);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readStringField(value: unknown, key: string): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const field = value[key];
  return typeof field === "string" && field.trim() ? field : null;
}

function readRunKey(event: unknown, context?: unknown): string | null {
  return readStringField(event, "runId") ?? readStringField(context, "runId");
}

function readEventType(value: unknown): string | null {
  return isRecord(value) && typeof value.type === "string" ? value.type : null;
}

function readBeforeAgentStartEvent(value: unknown): BeforeAgentStartPayload | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.type !== undefined && value.type !== "before_agent_start") {
    return null;
  }
  if (typeof value.prompt !== "string") {
    return null;
  }
  const systemPromptValue = value.systemPrompt;
  const hasSystemPrompt = typeof systemPromptValue === "string";
  const systemPrompt: string = hasSystemPrompt ? systemPromptValue : "";
  return {
    prompt: value.prompt,
    systemPrompt,
    resources: value.resources,
    hasSystemPrompt,
  };
}

function readInput(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function readToolCallEvent(value: unknown, context?: unknown): ToolCallPayload | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.type !== undefined && value.type !== "tool_call" && value.type !== "before_tool_call") {
    return null;
  }
  const toolCallId = readStringField(value, "toolCallId") ?? readStringField(context, "toolCallId");
  const toolName = readStringField(value, "toolName") ?? readStringField(context, "toolName");
  if (!toolCallId || !toolName) {
    return null;
  }
  return {
    toolCallId,
    toolName,
    input: readInput(value.input ?? value.params),
  };
}

function readContent(value: unknown): ContentBlock[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is ContentBlock => isRecord(entry) && typeof entry.type === "string",
      )
    : [];
}

function isToolResultMessage(value: unknown): value is ToolResultMessage {
  return isRecord(value) && value.role === "toolResult";
}

function readToolResultEvent(value: unknown, context?: unknown): ToolResultPayload | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    value.type !== undefined &&
    value.type !== "tool_result" &&
    value.type !== "tool_result_persist"
  ) {
    return null;
  }
  const message = isToolResultMessage(value.message) ? value.message : undefined;
  const toolCallId =
    readStringField(value, "toolCallId") ??
    readStringField(context, "toolCallId") ??
    message?.toolCallId;
  const toolName =
    readStringField(value, "toolName") ?? readStringField(context, "toolName") ?? message?.toolName;
  if (!toolCallId || !toolName) {
    return null;
  }
  return {
    toolCallId,
    toolName,
    input: readInput(value.input ?? value.params),
    content: readContent(value.content ?? message?.content),
    details: value.details ?? message?.details,
    isError: value.isError === true || message?.isError === true,
    ...(message ? { message } : {}),
  };
}

function readAgentEndEvent(value: unknown): AgentEndPayload | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.type !== undefined && value.type !== "agent_end") {
    return null;
  }
  return {
    success: typeof value.success === "boolean" ? value.success : undefined,
    error: typeof value.error === "string" && value.error.trim() ? value.error : null,
  };
}

function isTextBlock(value: ContentBlock): value is TextBlock {
  return value.type === "text" && typeof value.text === "string";
}

function textFromContent(content: ContentBlock[]): string {
  return content
    .filter(isTextBlock)
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function appendAdvice(content: ContentBlock[], advice: string): ContentBlock[] {
  const firstTextIndex = content.findIndex(isTextBlock);
  if (firstTextIndex < 0) {
    return [{ type: "text", text: advice }, ...content];
  }
  return content.map((entry, index) =>
    index === firstTextIndex && isTextBlock(entry)
      ? { ...entry, text: `${entry.text}\n\n${advice}` }
      : entry,
  );
}

function appendAdviceToToolResultMessage(
  message: ToolResultMessage,
  advice: string,
): ToolResultMessage {
  const nextContent = appendAdvice(
    message.content as unknown as ContentBlock[],
    advice,
  ) as unknown as ToolResultMessage["content"];
  return {
    ...message,
    content: nextContent,
  };
}

/** Maximum characters retained for task_intent from the raw prompt. */
export const SEKB_DEFAULT_TASK_INTENT_MAX_CHARS = 2_000;

/**
 * Deterministic default classifier used when callers do not supply classifyTask.
 * Coarse buckets only; no LLM and no expansion of sensitive persistence.
 */
export function defaultSekbTaskClassifier(event: {
  prompt: string;
  systemPrompt?: string;
  resources?: unknown;
}): SekbTaskClassification {
  const prompt = typeof event.prompt === "string" ? event.prompt : "";
  const systemPrompt = typeof event.systemPrompt === "string" ? event.systemPrompt : "";
  const haystack = `${prompt}
${systemPrompt}`.toLowerCase();
  const tags: string[] = [];
  let task_type = "agent/task";

  if (
    matchesAny(haystack, [
      "browser",
      "playwright",
      "puppeteer",
      "selenium",
      "navigate to",
      "click the",
      "webpage",
      "web page",
      "http://",
      "https://",
    ])
  ) {
    task_type = "browser/task";
    tags.push("browser");
  } else if (
    matchesAny(haystack, [
      "debug",
      "troubleshoot",
      "stack trace",
      "stacktrace",
      "failing test",
      "runtime error",
      "exception",
      "crash",
      "fix the bug",
    ])
  ) {
    task_type = "debug/task";
    tags.push("debug");
  } else if (
    matchesAny(haystack, [
      "deploy",
      "docker",
      "kubernetes",
      "k8s",
      "ci/cd",
      "pipeline",
      "infrastructure",
      "ops/",
      "server config",
      "systemd",
    ])
  ) {
    task_type = "ops/task";
    tags.push("ops");
  } else if (
    matchesAny(haystack, [
      "typescript",
      "javascript",
      "python",
      "refactor",
      "compile",
      "eslint",
      "unit test",
      "source code",
      "function ",
      "class ",
      "git commit",
      "pull request",
      "code review",
    ])
  ) {
    task_type = "code/task";
    tags.push("code");
  }

  // Structured non-sensitive cues only (resource type labels, never payloads).
  for (const tag of extractResourceTags(event.resources)) {
    if (!tags.includes(tag)) {
      tags.push(tag);
    }
  }

  const task_intent =
    prompt.length > SEKB_DEFAULT_TASK_INTENT_MAX_CHARS
      ? prompt.slice(0, SEKB_DEFAULT_TASK_INTENT_MAX_CHARS)
      : prompt;

  return {
    task_intent,
    task_type,
    context_tags: tags.slice(0, 8),
  };
}

function matchesAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function extractResourceTags(resources: unknown): string[] {
  if (!Array.isArray(resources)) {
    return [];
  }
  const tags: string[] = [];
  for (const resource of resources) {
    if (!resource || typeof resource !== "object") {
      continue;
    }
    const record = resource as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type.trim().toLowerCase() : "";
    const kind = typeof record.kind === "string" ? record.kind.trim().toLowerCase() : "";
    const candidate = type || kind;
    if (
      candidate &&
      candidate.length <= 40 &&
      /^[a-z0-9][a-z0-9._/-]*$/.test(candidate) &&
      !/(?:secret|password|token|api[_-]?key|authorization)/.test(candidate)
    ) {
      tags.push(candidate);
    }
  }
  return tags.slice(0, 4);
}

function safe<T>(
  options: Pick<InstallSekbHarnessHooksOptions, "onError">,
  operation: () => T,
): T | undefined {
  try {
    return operation();
  } catch (error) {
    options.onError?.(error);
    return undefined;
  }
}
