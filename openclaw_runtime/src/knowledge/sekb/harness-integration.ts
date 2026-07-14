import type { AgentMessage } from "../../agents/runtime/index.js";
import type { ContextInjector } from "./retrieval-engine.js";
import type { TrajectoryCapture } from "./trajectory-capture.js";

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
  on(
    type: string,
    handler: (event: unknown, context?: unknown) => unknown,
  ): () => void;
  subscribe?: (listener: (event: unknown) => unknown) => () => void;
};

export type InstallSekbHarnessHooksOptions = {
  enabled: boolean;
  capture: TrajectoryCapture;
  injector: ContextInjector;
  classifyTask?: SekbTaskClassifier;
  onError?: (error: unknown) => void;
};

type ActiveSekbRun = {
  trajectoryId: string;
  tags: string[];
  rawError: string | null;
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

export function installSekbHarnessHooks(
  target: SekbHarnessHookTarget,
  options: InstallSekbHarnessHooksOptions,
): () => void {
  if (!options.enabled) {
    return () => {};
  }

  const activeRuns = new Map<string, ActiveSekbRun>();
  const toolCallRunKeys = new Map<string, string>();
  let lastActiveRunKey: string | null = null;
  const classify = options.classifyTask ?? defaultSekbTaskClassifier;
  const unsubs = [
    target.on("before_agent_start", (event, context) =>
      safe(options, () => {
        const payload = readBeforeAgentStartEvent(event);
        if (!payload) {
          return undefined;
        }
        const classification = classify(payload);
        const runKey = readRunKey(event, context) ?? DEFAULT_RUN_KEY;
        activeRuns.set(runKey, {
          trajectoryId: options.capture.start_trajectory(
            classification.task_intent,
            classification.task_type,
            classification.context_tags,
          ),
          tags: classification.context_tags,
          rawError: null,
        });
        lastActiveRunKey = runKey;
        if (payload.hasSystemPrompt) {
          return {
            systemPrompt: options.injector.for_task(
              payload.systemPrompt,
              classification.task_intent,
              classification.task_type,
              classification.context_tags,
            ),
          };
        }
        const appendContext = options.injector
          .for_task(
            "",
            classification.task_intent,
            classification.task_type,
            classification.context_tags,
          )
          .trim();
        return appendContext ? { appendContext } : undefined;
      })
    ),
    target.on("before_tool_call", (event, context) =>
      safe(options, () =>
        handleToolCallEvent(event, context, options, activeRuns, toolCallRunKeys, lastActiveRunKey)
      )
    ),
    target.on("tool_call", (event, context) =>
      safe(options, () =>
        handleToolCallEvent(event, context, options, activeRuns, toolCallRunKeys, lastActiveRunKey)
      )
    ),
    target.on("tool_result_persist", (event, context) =>
      safe(options, () =>
        handleToolResultEvent(event, context, options, activeRuns, toolCallRunKeys, lastActiveRunKey)
      )
    ),
    target.on("tool_result", (event, context) =>
      safe(options, () =>
        handleToolResultEvent(event, context, options, activeRuns, toolCallRunKeys, lastActiveRunKey)
      )
    ),
    target.on("agent_end", (event, context) =>
      safe(options, () => {
        const runKey = readRunKey(event, context) ?? lastActiveRunKey ?? DEFAULT_RUN_KEY;
        const active = activeRuns.get(runKey);
        if (!active) {
          return undefined;
        }
        finishActiveRun(options.capture, active, readAgentEndEvent(event));
        activeRuns.delete(runKey);
        clearToolCallsForRun(toolCallRunKeys, runKey);
        if (lastActiveRunKey === runKey) {
          lastActiveRunKey = null;
        }
        return undefined;
      })
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
            finishActiveRun(options.capture, active, readAgentEndEvent(event));
            activeRuns.delete(runKey);
            clearToolCallsForRun(toolCallRunKeys, runKey);
            if (lastActiveRunKey === runKey) {
              lastActiveRunKey = null;
            }
          }
          if (type === "abort") {
            options.capture.finish_trajectory(active.trajectoryId, "partial", active.rawError);
            activeRuns.delete(runKey);
            clearToolCallsForRun(toolCallRunKeys, runKey);
            if (lastActiveRunKey === runKey) {
              lastActiveRunKey = null;
            }
          }
          return undefined;
        })
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
  toolCallRunKeys: Map<string, string>,
  lastActiveRunKey: string | null,
): undefined {
  const payload = readToolCallEvent(event, context);
  const runKey = readRunKey(event, context) ?? lastActiveRunKey ?? DEFAULT_RUN_KEY;
  const active = activeRuns.get(runKey);
  if (!active || !payload) {
    return undefined;
  }
  toolCallRunKeys.set(payload.toolCallId, runKey);
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
  toolCallRunKeys: Map<string, string>,
  lastActiveRunKey: string | null,
): { content?: ContentBlock[]; message?: ToolResultMessage } | undefined {
  const payload = readToolResultEvent(event, context);
  const runKey =
    (payload?.toolCallId ? toolCallRunKeys.get(payload.toolCallId) : undefined) ??
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
  if (!payload.isError) {
    return undefined;
  }
  active.rawError = textFromContent(payload.content) || `${payload.toolName} failed`;
  const signature = options.capture.extract_error_signature(active.rawError);
  const advice = options.injector.for_error(signature, active.tags);
  if (!advice) {
    return undefined;
  }
  return payload.message
    ? { message: appendAdviceToToolResultMessage(payload.message, advice) }
    : { content: appendAdvice(payload.content, advice) };
}

function finishActiveRun(
  capture: TrajectoryCapture,
  active: ActiveSekbRun,
  payload: AgentEndPayload | null,
): void {
  const rawError = active.rawError ?? payload?.error ?? null;
  const outcome =
    payload?.success === true
      ? "success"
      : rawError
        ? "failure"
        : payload?.success === false
          ? "partial"
          : "success";
  capture.finish_trajectory(active.trajectoryId, outcome, rawError);
}

function clearToolCallsForRun(toolCallRunKeys: Map<string, string>, runKey: string): void {
  for (const [toolCallId, mappedRunKey] of toolCallRunKeys) {
    if (mappedRunKey === runKey) {
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
  if (
    value.type !== undefined &&
    value.type !== "tool_call" &&
    value.type !== "before_tool_call"
  ) {
    return null;
  }
  const toolCallId =
    readStringField(value, "toolCallId") ?? readStringField(context, "toolCallId");
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
    ? value.filter((entry): entry is ContentBlock =>
      isRecord(entry) && typeof entry.type === "string"
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
      : entry
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

function defaultSekbTaskClassifier(event: BeforeAgentStartPayload): SekbTaskClassification {
  return {
    task_intent: event.prompt,
    task_type: "agent/task",
    context_tags: [],
  };
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
