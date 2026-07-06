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
  on(type: string, handler: (event: unknown) => unknown | Promise<unknown>): () => void;
  subscribe(listener: (event: unknown) => unknown | Promise<unknown>): () => void;
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

type BeforeAgentStartPayload = {
  prompt: string;
  systemPrompt: string;
  resources: unknown;
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
};

export function installSekbHarnessHooks(
  target: SekbHarnessHookTarget,
  options: InstallSekbHarnessHooksOptions,
): () => void {
  if (!options.enabled) {
    return () => {};
  }

  let active: ActiveSekbRun | null = null;
  const classify = options.classifyTask ?? defaultSekbTaskClassifier;
  const unsubs = [
    target.on("before_agent_start", (event) =>
      safe(options, () => {
        const payload = readBeforeAgentStartEvent(event);
        if (!payload) {
          return undefined;
        }
        const classification = classify(payload);
        active = {
          trajectoryId: options.capture.start_trajectory(
            classification.task_intent,
            classification.task_type,
            classification.context_tags,
          ),
          tags: classification.context_tags,
          rawError: null,
        };
        return {
          systemPrompt: options.injector.for_task(
            payload.systemPrompt,
            classification.task_intent,
            classification.task_type,
            classification.context_tags,
          ),
        };
      })
    ),
    target.on("tool_call", (event) =>
      safe(options, () => {
        const payload = readToolCallEvent(event);
        if (!active || !payload) {
          return undefined;
        }
        options.capture.log_step(active.trajectoryId, "tool.call", payload.input, {
          toolName: payload.toolName,
          toolCallId: payload.toolCallId,
        });
        return undefined;
      })
    ),
    target.on("tool_result", (event) =>
      safe(options, () => {
        const payload = readToolResultEvent(event);
        if (!active || !payload) {
          return undefined;
        }
        options.capture.log_step(active.trajectoryId, "tool.result", payload.input, {
          toolName: payload.toolName,
          toolCallId: payload.toolCallId,
          isError: payload.isError,
          content: payload.content,
        });
        if (!payload.isError) {
          return undefined;
        }
        active.rawError = textFromContent(payload.content) || `${payload.toolName} failed`;
        const signature = options.capture.extract_error_signature(active.rawError);
        const advice = options.injector.for_error(signature, active.tags);
        return advice ? { content: appendAdvice(payload.content, advice) } : undefined;
      })
    ),
    target.subscribe((event) =>
      safe(options, () => {
        const type = readEventType(event);
        if (!active) {
          return undefined;
        }
        if (type === "agent_end") {
          options.capture.finish_trajectory(
            active.trajectoryId,
            active.rawError ? "failure" : "success",
            active.rawError,
          );
          active = null;
        }
        if (type === "abort") {
          options.capture.finish_trajectory(active.trajectoryId, "partial", active.rawError);
          active = null;
        }
        return undefined;
      })
    ),
  ];

  return () => {
    for (const unsub of unsubs.splice(0)) {
      unsub();
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readEventType(value: unknown): string | null {
  return isRecord(value) && typeof value.type === "string" ? value.type : null;
}

function readBeforeAgentStartEvent(value: unknown): BeforeAgentStartPayload | null {
  if (!isRecord(value) || value.type !== "before_agent_start") {
    return null;
  }
  if (typeof value.prompt !== "string" || typeof value.systemPrompt !== "string") {
    return null;
  }
  return {
    prompt: value.prompt,
    systemPrompt: value.systemPrompt,
    resources: value.resources,
  };
}

function readInput(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function readToolCallEvent(value: unknown): ToolCallPayload | null {
  if (!isRecord(value) || value.type !== "tool_call") {
    return null;
  }
  if (typeof value.toolCallId !== "string" || typeof value.toolName !== "string") {
    return null;
  }
  return {
    toolCallId: value.toolCallId,
    toolName: value.toolName,
    input: readInput(value.input),
  };
}

function readContent(value: unknown): ContentBlock[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is ContentBlock =>
      isRecord(entry) && typeof entry.type === "string"
    )
    : [];
}

function readToolResultEvent(value: unknown): ToolResultPayload | null {
  if (!isRecord(value) || value.type !== "tool_result") {
    return null;
  }
  if (typeof value.toolCallId !== "string" || typeof value.toolName !== "string") {
    return null;
  }
  return {
    toolCallId: value.toolCallId,
    toolName: value.toolName,
    input: readInput(value.input),
    content: readContent(value.content),
    details: value.details,
    isError: value.isError === true,
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
