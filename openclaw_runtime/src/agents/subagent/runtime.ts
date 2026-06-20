import type { SubagentConfig, SubagentResult } from "../../../packages/agent-core/src/types.js";
import type { Usage } from "../../../packages/llm-core/src/index.js";
import type { ObservabilityTraceRecorder } from "../../observability/trace-recorder.js";
import type { ObservabilityTokenUsage } from "../../observability/types.js";
import { Agent } from "../runtime/index.js";

const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function textFromMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content.flatMap((part) => {
    if (part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part) {
      return [String(part.text)];
    }
    return [];
  }).join("\n");
}

function sumUsage(left: Usage, right: Usage): Usage {
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    totalTokens: left.totalTokens + right.totalTokens,
    cost: {
      input: left.cost.input + right.cost.input,
      output: left.cost.output + right.cost.output,
      cacheRead: left.cost.cacheRead + right.cost.cacheRead,
      cacheWrite: left.cost.cacheWrite + right.cost.cacheWrite,
      total: left.cost.total + right.cost.total,
    },
  };
}

function toObservabilityTokenUsage(usage: Usage): ObservabilityTokenUsage {
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    totalTokens: usage.totalTokens,
    costUsd: usage.cost.total,
  };
}

export function createSubagentSystemPrompt(config: SubagentConfig): string {
  const context = config.contextPack ? `\n\nContext pack:\n${JSON.stringify(config.contextPack)}` : "";
  return `${config.role.rolePrompt}\n\nYou are a short-lived subagent. Complete only this task, respect the token/turn budget, and return a concise result summary.\n\nTask: ${config.task}${context}`;
}

export async function runSubagent(
  config: SubagentConfig,
  observability?: { recorder?: ObservabilityTraceRecorder; parentSpanId?: string },
): Promise<SubagentResult> {
  const span = observability?.recorder?.startSpan({
    name: `subagent:${config.role.name}`,
    kind: "subagent",
    parentSpanId: observability.parentSpanId,
    roleName: config.role.name,
    input: config.task,
    attributes: { budget: config.budget },
  });
  const startedAt = Date.now();
  let toolCallCount = 0;
  let tokensUsed = { ...EMPTY_USAGE, cost: { ...EMPTY_USAGE.cost } };
  const agent = new Agent({
    initialState: {
      systemPrompt: createSubagentSystemPrompt(config),
      tools: config.tools,
      ...(config.model ? { model: config.model } : {}),
    },
  });
  agent.subscribe((event) => {
    if (event.type === "tool_execution_start") {
      toolCallCount += 1;
    }
    if (event.type === "turn_end" && event.message.role === "assistant") {
      tokensUsed = sumUsage(tokensUsed, event.message.usage);
    }
  });
  try {
    await agent.prompt(config.task);
    const assistantMessages = agent.state.messages.filter((message) => message.role === "assistant");
    const last = assistantMessages[assistantMessages.length - 1];
    const summary = last ? textFromMessageContent(last.content) : "Subagent completed without assistant output.";
    const result: SubagentResult = {
      success: true,
      summary,
      artifacts: [],
      toolCallCount,
      tokensUsed,
      durationMs: Date.now() - startedAt,
    };
    if (span) {
      observability?.recorder?.endSpan(span.id, {
        status: "completed",
        output: summary,
        tokenUsage: toObservabilityTokenUsage(tokensUsed),
        metrics: { toolCallCount },
      });
    }
    return result;
  } catch (error) {
    const result: SubagentResult = {
      success: false,
      summary: error instanceof Error ? error.message : String(error),
      artifacts: [],
      toolCallCount,
      tokensUsed,
      durationMs: Date.now() - startedAt,
    };
    if (span) {
      observability?.recorder?.endSpan(span.id, {
        status: "error",
        output: result.summary,
        error: result.summary,
        tokenUsage: toObservabilityTokenUsage(tokensUsed),
        metrics: { toolCallCount },
      });
    }
    return result;
  }
}
