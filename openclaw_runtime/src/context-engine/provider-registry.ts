import {
  buildLoopContextPack,
  formatLoopContextPackForPrompt,
  type LoopContextPackInput,
} from "../agents/loop-context-pack.js";
import type { AgentMessage } from "../agents/runtime/index.js";
import {
  type RuntimeContextProvider,
  type RuntimeContextProviderQuery,
  type RuntimeContextProviderResult,
  type RuntimeCoreJsonObject,
  type RuntimeRegistryDiagnostic,
} from "../runtime-core/index.js";
import { LegacyContextEngine } from "./legacy.js";

export const LEGACY_CONTEXT_ENGINE_PROVIDER_ID = "legacy-context-engine";
export const LOOP_CONTEXT_PACK_PROVIDER_ID = "loop-context-pack";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function metadataFrom(
  query: RuntimeContextProviderQuery,
  extras?: { metadata?: RuntimeCoreJsonObject },
): Record<string, unknown> {
  return {
    ...asRecord(query.metadata),
    ...asRecord(extras?.metadata),
  };
}

function messagesFrom(
  query: RuntimeContextProviderQuery,
  extras?: { metadata?: RuntimeCoreJsonObject },
): AgentMessage[] {
  const messages = metadataFrom(query, extras).messages;
  return Array.isArray(messages) ? messages as AgentMessage[] : [];
}

function loopContextInputFrom(
  query: RuntimeContextProviderQuery,
  extras?: { metadata?: RuntimeCoreJsonObject },
): LoopContextPackInput {
  const input = metadataFrom(query, extras).loopContextInput;
  return asRecord(input) ? input as LoopContextPackInput : {};
}

function diagnostic(params: {
  providerId?: string;
  status: RuntimeRegistryDiagnostic["status"];
  reason: RuntimeRegistryDiagnostic["reason"];
  message: string;
  metadata?: RuntimeCoreJsonObject;
}): RuntimeRegistryDiagnostic {
  return {
    surface: "context",
    providerId: params.providerId,
    status: params.status,
    reason: params.reason,
    message: params.message,
    evidenceRefs: params.providerId
      ? [{ type: "other", ref: params.providerId, label: "Context provider registry pilot" }]
      : [],
    metadata: params.metadata,
  };
}

function withContextShadowRuntime(input: LoopContextPackInput): LoopContextPackInput {
  return {
    ...input,
    runtime: {
      ...asRecord(input.runtime),
      contextProviders: {
        ...asRecord(asRecord(input.runtime)?.contextProviders),
        shadow: true,
        loopPackShadow: true,
      },
    },
  };
}

function collectEvidenceRefs(
  result: RuntimeContextProviderResult,
): RuntimeContextProviderResult["evidenceRefs"] {
  return [
    ...result.evidenceRefs,
    ...result.contextItems.flatMap((item) => item.evidenceRefs),
  ];
}

export function createLegacyContextEngineProvider(): RuntimeContextProvider {
  const manifest = {
    id: LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
    kind: "context" as const,
    title: "Legacy ContextEngine compatibility provider",
    source: "legacy" as const,
    capabilities: ["context.legacy", "context.messages"],
    priority: 10,
    order: 10,
    permission: {
      decision: "allow" as const,
      capability: "context.legacy",
      reason: "Compatibility provider emits shadow ContextItems only.",
    },
    enabledByDefault: false,
    shadowOnly: true,
    fallbackReasons: ["legacy_authoritative" as const, "provider_error" as const],
    evidenceRefs: [{ type: "file" as const, ref: "openclaw_runtime/src/context-engine/legacy.ts" }],
    outputKinds: ["message" as const],
    dependsOnIndexing: false,
  };

  return {
    manifest,
    async getContext(query, extras): Promise<RuntimeContextProviderResult> {
      const messages = messagesFrom(query, extras);
      const engine = new LegacyContextEngine({
        runtime: { contextProviders: { shadow: true } },
      });
      const assembled = await engine.assemble({
        sessionId: query.taskId ?? "registry-shadow",
        ...(query.taskId ? {} : { sessionKey: "registry-shadow" }),
        messages,
        tokenBudget: query.tokenBudget,
      });
      const result: RuntimeContextProviderResult = {
        status: "success",
        contextItems: assembled.contextItems ?? [],
        diagnostics: [
          diagnostic({
            providerId: manifest.id,
            status: "fallback",
            reason: "legacy_authoritative",
            message: "LegacyContextEngine remains authoritative; registry output is shadow-only.",
            metadata: {
              legacyAuthoritative: true,
              shadowOnly: true,
              messagesIdentityPreserved: assembled.messages === messages,
              messageOrderPreserved: assembled.messages.every((message, index) =>
                message === messages[index]
              ),
              messageCount: messages.length,
            },
          }),
        ],
        evidenceRefs: manifest.evidenceRefs,
        metadata: {
          providerId: manifest.id,
          legacyAuthoritative: true,
          shadowOnly: true,
        },
      };
      return {
        ...result,
        evidenceRefs: collectEvidenceRefs(result),
      };
    },
  };
}

export function createLoopContextPackProvider(): RuntimeContextProvider {
  const manifest = {
    id: LOOP_CONTEXT_PACK_PROVIDER_ID,
    kind: "context" as const,
    title: "LoopContextPack compatibility provider",
    source: "legacy" as const,
    capabilities: ["context.loop-pack", "context.task-loop"],
    priority: 20,
    order: 20,
    permission: {
      decision: "allow" as const,
      capability: "context.loop-pack",
      reason: "Compatibility provider emits shadow ContextItems only.",
    },
    enabledByDefault: false,
    shadowOnly: true,
    fallbackReasons: ["legacy_authoritative" as const, "provider_error" as const],
    evidenceRefs: [{ type: "file" as const, ref: "openclaw_runtime/src/agents/loop-context-pack.ts" }],
    outputKinds: [
      "instruction" as const,
      "checkpoint" as const,
      "memory" as const,
      "evidence" as const,
      "summary" as const,
    ],
    dependsOnIndexing: false,
  };

  return {
    manifest,
    getContext(query, extras): RuntimeContextProviderResult {
      const input = loopContextInputFrom(query, extras);
      const baseline = buildLoopContextPack(input);
      const shadow = buildLoopContextPack(withContextShadowRuntime(input));
      const baselinePrompt = formatLoopContextPackForPrompt(baseline);
      const shadowPrompt = formatLoopContextPackForPrompt(shadow);
      const result: RuntimeContextProviderResult = {
        status: "success",
        contextItems: shadow.contextItems ?? [],
        diagnostics: [
          diagnostic({
            providerId: manifest.id,
            status: "fallback",
            reason: "legacy_authoritative",
            message: "LoopContextPack prompt text remains authoritative; registry output is shadow-only.",
            metadata: {
              legacyAuthoritative: true,
              shadowOnly: true,
              promptTextUnchanged: baselinePrompt === shadowPrompt,
              packHashUnchanged: baseline.hash === shadow.hash,
              sectionCount: baseline.sections.length,
            },
          }),
        ],
        evidenceRefs: manifest.evidenceRefs,
        metadata: {
          providerId: manifest.id,
          legacyAuthoritative: true,
          shadowOnly: true,
        },
      };
      return {
        ...result,
        evidenceRefs: collectEvidenceRefs(result),
      };
    },
  };
}
