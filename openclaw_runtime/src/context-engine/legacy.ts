// Legacy context engine wraps pre-plugin context behavior behind the pluggable interface.
import type { AgentMessage } from "../agents/runtime/index.js";
import type { MemoryCitationsMode } from "../config/types.memory.js";
import type { ContextItem } from "../runtime-core/types.js";
import { delegateCompactionToRuntime } from "./delegate.js";
import { contextProviderShadowFlagEnabled } from "./shadow-flags.js";
import type {
  ContextEngine,
  ContextEngineInfo,
  AssembleResult,
  CompactResult,
  ContextEngineRuntimeContext,
  IngestResult,
} from "./types.js";

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function messageRole(message: AgentMessage): string {
  const role = (message as { role?: unknown }).role;
  return typeof role === "string" && role.trim() ? role.trim() : "message";
}

function messageText(message: AgentMessage): string {
  const content = (message as { content?: unknown; text?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content.flatMap((entry) => {
      if (typeof entry === "string") return [entry];
      if (entry && typeof entry === "object" && typeof (entry as { text?: unknown }).text === "string") {
        return [(entry as { text: string }).text];
      }
      return [];
    });
    if (parts.length) return parts.join("\n");
  }
  const text = (message as { text?: unknown }).text;
  if (typeof text === "string") return text;
  return JSON.stringify(message);
}

function truncateShadowText(text: string): { text: string; truncated: boolean } {
  const maxChars = 4_000;
  if (text.length <= maxChars) return { text, truncated: false };
  return {
    text: `${text.slice(0, maxChars - 80)}\n[truncated ${text.length - maxChars} chars]`,
    truncated: true,
  };
}

function buildLegacyContextItems(messages: readonly AgentMessage[]): ContextItem[] {
  return messages.map((message, index) => {
    const sourceId = `legacy_context_engine:message:${index + 1}`;
    const role = messageRole(message);
    const text = truncateShadowText(messageText(message));
    return {
      id: sourceId,
      kind: "message",
      text: text.text,
      source: "legacy_context_engine",
      evidenceRefs: [{
        type: "other",
        ref: sourceId,
        label: `${role} message`,
      }],
      metadata: {
        sourceId,
        sourceKind: "message",
        role,
        tokenEstimate: estimateTokens(text.text),
        truncated: text.truncated,
      },
    };
  });
}

/**
 * LegacyContextEngine wraps the existing compaction behavior behind the
 * ContextEngine interface, preserving 100% backward compatibility.
 *
 * - ingest: no-op (SessionManager handles message persistence)
 * - assemble: pass-through (existing sanitize/validate/limit pipeline in attempt.ts handles this)
 * - compact: delegates to compactEmbeddedAgentSessionDirect
 */
export class LegacyContextEngine implements ContextEngine {
  readonly info: ContextEngineInfo = {
    id: "legacy",
    name: "Legacy Context Engine",
    version: "1.0.0",
  };

  constructor(private readonly shadowConfig?: unknown) {}

  async ingest(_params: {
    sessionId: string;
    sessionKey?: string;
    message: AgentMessage;
    isHeartbeat?: boolean;
  }): Promise<IngestResult> {
    // No-op: SessionManager handles message persistence in the legacy flow
    return { ingested: false };
  }

  async assemble(params: {
    sessionId: string;
    sessionKey?: string;
    messages: AgentMessage[];
    tokenBudget?: number;
    availableTools?: Set<string>;
    citationsMode?: MemoryCitationsMode;
    model?: string;
  }): Promise<AssembleResult> {
    // Pass-through: the existing sanitize -> validate -> limit -> repair pipeline
    // in attempt.ts handles context assembly for the legacy engine.
    // We just return the messages as-is with a rough token estimate.
    return {
      messages: params.messages,
      estimatedTokens: 0, // Caller handles estimation
      ...(contextProviderShadowFlagEnabled(this.shadowConfig, "shadow")
        ? { contextItems: buildLegacyContextItems(params.messages) }
        : {}),
    };
  }

  async afterTurn(_params: {
    sessionId: string;
    sessionKey?: string;
    sessionFile: string;
    messages: AgentMessage[];
    prePromptMessageCount: number;
    autoCompactionSummary?: string;
    isHeartbeat?: boolean;
    tokenBudget?: number;
    runtimeContext?: ContextEngineRuntimeContext;
  }): Promise<void> {
    // No-op: legacy flow persists context directly in SessionManager.
  }

  async compact(params: {
    sessionId: string;
    sessionKey?: string;
    sessionFile: string;
    tokenBudget?: number;
    force?: boolean;
    currentTokenCount?: number;
    compactionTarget?: "budget" | "threshold";
    customInstructions?: string;
    runtimeContext?: ContextEngineRuntimeContext;
  }): Promise<CompactResult> {
    return await delegateCompactionToRuntime(params);
  }

  async dispose(): Promise<void> {
    // Nothing to clean up for legacy engine
  }
}
