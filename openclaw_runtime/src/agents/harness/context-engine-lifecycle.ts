/**
 * Manages context-engine lifecycle hooks for native agent harnesses.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { isDeepStrictEqual } from "node:util";
import type { MemoryCitationsMode } from "../../config/types.memory.js";
import { collectCompassContext } from "../../context-engine/compass-context.js";
import {
  contextMessageReplacementText,
  reopenContextCandidateCollection,
} from "../../context-engine/context-candidate.js";
import {
  collectContextOrchestratorCandidate,
  endContextOrchestratorTurn,
  finalizeContextOrchestratorTurn,
} from "../../context-engine/context-orchestrator.js";
import { isContextEnhancementKillSwitchEngaged } from "../../context-engine/enhancement-kill-switch.js";
import {
  beginTurnInjectionBudget,
  endTurnInjectionBudget,
} from "../../context-engine/turn-injection-budget.js";
import type {
  AssembleResult,
  ContextEngine,
  ContextEngineProjectContextFile,
  ContextEngineRuntimeContext,
  ContextEngineSkillMetadata,
  ContextEngineToolMetadata,
} from "../../context-engine/types.js";
import { runContextEngineMaintenance } from "../embedded-agent-runner/context-engine-maintenance.js";
import {
  buildAfterTurnRuntimeContext,
  buildAfterTurnRuntimeContextFromUsage,
} from "../embedded-agent-runner/run/attempt.prompt-helpers.js";
import { stripRuntimeContextCustomMessages } from "../internal-runtime-context.js";
import type { AgentMessage } from "../runtime/index.js";
import type { SessionWriteLockAcquireTimeoutConfig } from "../session-write-lock.js";
import type { AgentHarnessAttemptParams, AgentHarnessAttemptResult } from "./types.js";

export type HarnessContextEngine = ContextEngine;

// Carry the existing turn owner across the SDK call without changing plugin
// engine identity or making embedded assembly pay a second time.
type NativeContextBudgetAttempt = {
  turnId: string;
  cfg: AgentHarnessAttemptParams["config"];
  previous?: { original: AgentMessage[]; assembled: AssembleResult; admitted: AssembleResult };
};
type NativeContextBudgetScope = {
  cfg: AgentHarnessAttemptParams["config"];
  admit: (original: AgentMessage[], assembled: AssembleResult) => AssembleResult;
};
// Source hosts and built plugin SDKs can load distinct module instances. Share
// the scope, but route admission back to the attempt's original ledger owner.
const nativeContextBudgetKey = Symbol.for("openclaw.nativeContextBudget.v1");
const nativeContextBudgetGlobal = globalThis as typeof globalThis & {
  [nativeContextBudgetKey]?: AsyncLocalStorage<NativeContextBudgetScope>;
};
const nativeContextBudget = (nativeContextBudgetGlobal[nativeContextBudgetKey] ??=
  new AsyncLocalStorage<NativeContextBudgetScope>());

export async function runWithHarnessContextBudget(
  params: AgentHarnessAttemptParams,
  native: boolean,
  run: (prepared: AgentHarnessAttemptParams) => Promise<AgentHarnessAttemptResult>,
): Promise<AgentHarnessAttemptResult> {
  // A native tool can start an embedded child run. Its own assembly hooks must
  // not inherit the parent's native budget or charge the child twice.
  if (!native) return nativeContextBudget.exit(() => run(params));
  const turnId = `harness:${params.sessionKey ?? params.sessionId}:${params.runId}:${params.attemptIndex ?? 0}`;
  beginTurnInjectionBudget({
    turnId,
    killed: isContextEnhancementKillSwitchEngaged(params.config),
  });
  try {
    // Knowledge has higher declared precedence than engine additions. Keep its
    // charge alive until the native attempt (including startup retries) ends.
    if (params.compassContext) collectCompassContext(turnId, params.compassContext, params.config);
    const compassPrompt = finalizeContextOrchestratorTurn({
      turnId,
      messages: [],
      cfg: params.config,
      seal: false,
    }).projection.systemPromptAddition;
    const attempt: NativeContextBudgetAttempt = { turnId, cfg: params.config };
    return await nativeContextBudget.run(
      {
        cfg: params.config,
        admit: (original, assembled) => admitNativeAssembly(attempt, original, assembled),
      },
      () =>
        run({
          ...params,
          compassContext: undefined,
          extraSystemPrompt:
            [params.extraSystemPrompt, compassPrompt].filter(Boolean).join("\n\n") || undefined,
        }),
    );
  } finally {
    endContextOrchestratorTurn(turnId);
    endTurnInjectionBudget(turnId);
  }
}

function admitNativeAssembly(
  scope: NativeContextBudgetAttempt,
  original: AgentMessage[],
  assembled: AssembleResult,
): AssembleResult {
  const previous = scope.previous;
  // A native startup retry may request the same projection again. Reuse only
  // byte-equivalent input/output; never charge it twice or reuse a stale plan.
  if (
    previous &&
    isDeepStrictEqual(previous.original, original) &&
    isDeepStrictEqual(previous.assembled, assembled)
  ) {
    return structuredClone(previous.admitted);
  }
  reopenContextCandidateCollection(scope.turnId);
  const text = contextMessageReplacementText(original, assembled.messages);
  for (const candidate of [
    ...(text
      ? [
          {
            sourceId: "cvk-messages",
            target: "message_replacement" as const,
            text,
            messageReplacement: { original, replacement: assembled.messages },
          },
        ]
      : []),
    ...(assembled.systemPromptAddition?.trim()
      ? [
          {
            sourceId: "cvk",
            target: "system_prompt" as const,
            text: assembled.systemPromptAddition.trim(),
          },
        ]
      : []),
  ]) {
    collectContextOrchestratorCandidate(scope.turnId, {
      ...candidate,
      channel: "cvk_addition",
      authorityObjectId: candidate.sourceId,
      authorityVersion: "1",
    });
  }
  const { projection } = finalizeContextOrchestratorTurn({
    turnId: scope.turnId,
    messages: original,
    cfg: scope.cfg,
    seal: false,
  });
  const messages = text
    ? (projection.messageReplacement?.replacement ?? original)
    : assembled.messages;
  const admitted = {
    ...assembled,
    messages,
    systemPromptAddition: projection.systemPromptAddition,
    // An engine fingerprint describes its full assembly. A budget-reduced
    // projection must not establish/reuse that thread-bootstrap identity.
    contextProjection: projection.lineage.some((entry) => entry.reason !== "applied")
      ? undefined
      : assembled.contextProjection,
  };
  scope.previous = structuredClone({ original, assembled, admitted });
  return admitted;
}

/**
 * Run optional bootstrap + bootstrap maintenance for a harness-owned context engine.
 */
export async function bootstrapHarnessContextEngine(params: {
  hadSessionFile: boolean;
  contextEngine?: HarnessContextEngine;
  sessionId: string;
  sessionKey?: string;
  sessionFile: string;
  sessionManager?: unknown;
  runtimeContext?: ContextEngineRuntimeContext;
  runMaintenance?: typeof runHarnessContextEngineMaintenance;
  config?: SessionWriteLockAcquireTimeoutConfig;
  warn: (message: string) => void;
}): Promise<void> {
  if (
    !params.hadSessionFile ||
    !(params.contextEngine?.bootstrap || params.contextEngine?.maintain)
  ) {
    return;
  }
  try {
    if (typeof params.contextEngine?.bootstrap === "function") {
      await params.contextEngine.bootstrap({
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        sessionFile: params.sessionFile,
      });
    }
    await (params.runMaintenance ?? runHarnessContextEngineMaintenance)({
      contextEngine: params.contextEngine,
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      sessionFile: params.sessionFile,
      reason: "bootstrap",
      sessionManager: params.sessionManager,
      runtimeContext: params.runtimeContext,
      config: params.config,
    });
  } catch (bootstrapErr) {
    params.warn(`context engine bootstrap failed: ${String(bootstrapErr)}`);
  }
}

/**
 * Assemble model context through the active harness-owned context engine.
 */
export async function assembleHarnessContextEngine(params: {
  contextEngine?: HarnessContextEngine;
  sessionId: string;
  sessionKey?: string;
  messages: AgentMessage[];
  tokenBudget?: number;
  availableTools?: Set<string>;
  activeTools?: ContextEngineToolMetadata[];
  projectContextFiles?: ContextEngineProjectContextFile[];
  skillsMetadata?: ContextEngineSkillMetadata[];
  citationsMode?: MemoryCitationsMode;
  modelId: string;
  prompt?: string;
}) {
  if (!params.contextEngine) {
    return undefined;
  }
  const messages = stripRuntimeContextCustomMessages(params.messages);
  const scope = nativeContextBudget.getStore();
  if (scope && isContextEnhancementKillSwitchEngaged(scope.cfg)) {
    return { messages, estimatedTokens: 0 };
  }
  const result = await params.contextEngine.assemble({
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    messages: scope ? structuredClone(messages) : messages,
    tokenBudget: params.tokenBudget,
    ...(params.availableTools ? { availableTools: params.availableTools } : {}),
    ...(params.activeTools ? { activeTools: params.activeTools } : {}),
    ...(params.projectContextFiles ? { projectContextFiles: params.projectContextFiles } : {}),
    ...(params.skillsMetadata ? { skillsMetadata: params.skillsMetadata } : {}),
    ...(params.citationsMode ? { citationsMode: params.citationsMode } : {}),
    model: params.modelId,
    ...(params.prompt !== undefined ? { prompt: params.prompt } : {}),
  });
  const assembled = ensureAssembleResultShape(result, params.contextEngine.info.id);
  return scope ? scope.admit(messages, assembled) : assembled;
}

/**
 * Validate that a context engine's assemble() return value matches the
 * AssembleResult contract before the runner consumes it. Engines that omit
 * `messages` or return a non-array previously crashed the runner downstream
 * when prompt assembly tried to read `activeSession.messages.length` (#75541).
 *
 * Throws a descriptive error so the runner's existing assemble try/catch can
 * log the offending engine id and fall back to the unmodified pipeline
 * messages instead of poisoning session state.
 */
function ensureAssembleResultShape(result: unknown, engineId: string): AssembleResult {
  if (!result || typeof result !== "object") {
    throw new Error(
      `context engine "${engineId}" assemble() returned an invalid result: expected an object with a "messages" array (got ${describeAssembleResultType(result)})`,
    );
  }
  const candidate = result as { messages?: unknown };
  if (!Array.isArray(candidate.messages)) {
    throw new Error(
      `context engine "${engineId}" assemble() returned an invalid result: expected an object with a "messages" array (got messages of type ${describeAssembleResultType(candidate.messages)})`,
    );
  }
  return result as AssembleResult;
}

function describeAssembleResultType(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

/**
 * Finalize a completed harness turn via afterTurn or ingest fallbacks.
 */
export async function finalizeHarnessContextEngineTurn(params: {
  contextEngine?: HarnessContextEngine;
  promptError: boolean;
  aborted: boolean;
  yieldAborted: boolean;
  sessionIdUsed: string;
  sessionKey?: string;
  sessionFile: string;
  messagesSnapshot: AgentMessage[];
  prePromptMessageCount: number;
  tokenBudget?: number;
  runtimeContext?: ContextEngineRuntimeContext;
  runMaintenance?: typeof runHarnessContextEngineMaintenance;
  sessionManager?: unknown;
  config?: SessionWriteLockAcquireTimeoutConfig;
  warn: (message: string) => void;
  /** True when this turn belongs to a heartbeat run. */
  isHeartbeat?: boolean;
}) {
  if (!params.contextEngine) {
    return { postTurnFinalizationSucceeded: true };
  }

  const conversationSnapshot = buildContextEngineConversationSnapshot({
    messagesSnapshot: params.messagesSnapshot,
    prePromptMessageCount: params.prePromptMessageCount,
  });
  let postTurnFinalizationSucceeded = true;

  if (typeof params.contextEngine.afterTurn === "function") {
    try {
      await params.contextEngine.afterTurn({
        sessionId: params.sessionIdUsed,
        sessionKey: params.sessionKey,
        sessionFile: params.sessionFile,
        messages: conversationSnapshot.messages,
        prePromptMessageCount: conversationSnapshot.prePromptMessageCount,
        tokenBudget: params.tokenBudget,
        runtimeContext: params.runtimeContext,
        isHeartbeat: params.isHeartbeat,
      });
    } catch (afterTurnErr) {
      postTurnFinalizationSucceeded = false;
      params.warn(`context engine afterTurn failed: ${String(afterTurnErr)}`);
    }
  } else {
    const newMessages = conversationSnapshot.messages.slice(
      conversationSnapshot.prePromptMessageCount,
    );
    if (newMessages.length > 0) {
      if (typeof params.contextEngine.ingestBatch === "function") {
        try {
          await params.contextEngine.ingestBatch({
            sessionId: params.sessionIdUsed,
            sessionKey: params.sessionKey,
            messages: newMessages,
            isHeartbeat: params.isHeartbeat,
          });
        } catch (ingestErr) {
          postTurnFinalizationSucceeded = false;
          params.warn(`context engine ingest failed: ${String(ingestErr)}`);
        }
      } else {
        for (const msg of newMessages) {
          try {
            await params.contextEngine.ingest?.({
              sessionId: params.sessionIdUsed,
              sessionKey: params.sessionKey,
              message: msg,
              isHeartbeat: params.isHeartbeat,
            });
          } catch (ingestErr) {
            postTurnFinalizationSucceeded = false;
            params.warn(`context engine ingest failed: ${String(ingestErr)}`);
          }
        }
      }
    }
  }

  if (
    !params.promptError &&
    !params.aborted &&
    !params.yieldAborted &&
    postTurnFinalizationSucceeded
  ) {
    await (params.runMaintenance ?? runHarnessContextEngineMaintenance)({
      contextEngine: params.contextEngine,
      sessionId: params.sessionIdUsed,
      sessionKey: params.sessionKey,
      sessionFile: params.sessionFile,
      reason: "turn",
      sessionManager: params.sessionManager,
      runtimeContext: params.runtimeContext,
      config: params.config,
    });
  }

  return { postTurnFinalizationSucceeded };
}

function buildContextEngineConversationSnapshot(params: {
  messagesSnapshot: AgentMessage[];
  prePromptMessageCount: number;
}): { messages: AgentMessage[]; prePromptMessageCount: number } {
  const prePromptMessages = stripRuntimeContextCustomMessages(
    params.messagesSnapshot.slice(0, params.prePromptMessageCount),
  );
  const turnMessages = stripRuntimeContextCustomMessages(
    params.messagesSnapshot.slice(params.prePromptMessageCount),
  );
  return {
    messages: [...prePromptMessages, ...turnMessages],
    prePromptMessageCount: prePromptMessages.length,
  };
}

/**
 * Build runtime context passed into harness context-engine hooks.
 */
export function buildHarnessContextEngineRuntimeContext(
  params: Parameters<typeof buildAfterTurnRuntimeContext>[0],
): ContextEngineRuntimeContext {
  return buildAfterTurnRuntimeContext(params);
}

/**
 * Build runtime context passed into harness context-engine hooks from usage data.
 */
export function buildHarnessContextEngineRuntimeContextFromUsage(
  params: Parameters<typeof buildAfterTurnRuntimeContextFromUsage>[0],
): ContextEngineRuntimeContext {
  return buildAfterTurnRuntimeContextFromUsage(params);
}

/**
 * Run optional transcript maintenance for a harness-owned context engine.
 */
export async function runHarnessContextEngineMaintenance(params: {
  contextEngine?: HarnessContextEngine;
  sessionId: string;
  sessionKey?: string;
  sessionFile: string;
  reason: "bootstrap" | "compaction" | "turn";
  sessionManager?: unknown;
  runtimeContext?: ContextEngineRuntimeContext;
  executionMode?: "foreground" | "background";
  onDeferredMaintenance?: (promise: Promise<void>) => void;
  config?: SessionWriteLockAcquireTimeoutConfig;
}) {
  return await runContextEngineMaintenance({
    contextEngine: params.contextEngine,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    sessionFile: params.sessionFile,
    reason: params.reason,
    sessionManager: params.sessionManager as Parameters<
      typeof runContextEngineMaintenance
    >[0]["sessionManager"],
    runtimeContext: params.runtimeContext,
    executionMode: params.executionMode,
    onDeferredMaintenance: params.onDeferredMaintenance,
    config: params.config,
  });
}

/**
 * Return true when a non-legacy context engine should affect plugin harness behavior.
 */
export function isActiveHarnessContextEngine(
  contextEngine: ContextEngine | undefined,
): contextEngine is ContextEngine {
  return Boolean(contextEngine && contextEngine.info.id !== "legacy");
}
