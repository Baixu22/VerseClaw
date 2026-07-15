/**
 * Production SEKB runtime for embedded-agent sessions (DCS W4 / Stage 5).
 *
 * Flag-gated: runtime.contextBlock.sekb.enabled (default false) or
 * OPENCLAW_SEKB_ENABLED=true|1|yes|on. When enabled, production attempt/compact
 * can install harness hooks, supply trajectoryCapture to task-state handler
 * config, and confirm_and_save with contextBlockSink + sessionId.
 */
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { ContextBlockSink } from "../../context-engine/block.js";
import { DistillationTool } from "../../knowledge/sekb/distillation-tool.js";
import {
  isSekbBatchDistillationAssistantEnabled as resolveSekbBatchDistillationAssistantEnabled,
  isSekbEnabled as resolveSekbEnabled,
  isSekbPhaseCWouldTriggerEnabled as resolveSekbPhaseCWouldTriggerEnabled,
  isSekbShadowEvaluationEnabled as resolveSekbShadowEvaluationEnabled,
} from "../../knowledge/sekb/feature-flags.js";
import {
  SekbBatchDistillationAssistant,
  type SekbBatchDistillationAssistantOptions,
} from "../../knowledge/sekb/batch-distillation-assistant.js";
import {
  installSekbHarnessHooks,
  type SekbHarnessHookTarget,
} from "../../knowledge/sekb/harness-integration.js";
import { KnowledgeStore } from "../../knowledge/sekb/knowledge-store.js";
import {
  RetrievalEngine,
  type ContextInjector,
} from "../../knowledge/sekb/retrieval-engine.js";
import { TrajectoryCapture } from "../../knowledge/sekb/trajectory-capture.js";
import type {
  DistillationSuggestion,
  Principle,
} from "../../knowledge/sekb/types.js";
import { log } from "./logger.js";

export type EmbeddedSekbRuntime = {
  store: KnowledgeStore;
  capture: TrajectoryCapture;
  injector: ContextInjector;
  distiller: DistillationTool;
  batchDistillationAssistantEnabled: boolean;
};

/**
 * Explicit SEKB enablement: env wins when set, otherwise config flag.
 * Default is off (undefined env + omitted/false config).
 */
export function isSekbEnabled(
  cfg?: OpenClawConfig,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveSekbEnabled(cfg, env);
}

/** Shadow metadata is opt-in and cannot activate the SEKB runtime on its own. */
export function isSekbShadowEvaluationEnabled(
  cfg?: OpenClawConfig,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveSekbShadowEvaluationEnabled(cfg, env);
}

/**
 * The batch assistant has its own environment override but still requires the
 * existing SEKB master gate. It is only constructed by an explicit caller.
 */
export function isSekbBatchDistillationAssistantEnabled(
  cfg?: OpenClawConfig,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveSekbBatchDistillationAssistantEnabled(cfg, env);
}

/** Phase C would_trigger evidence is opt-in and never mutates durable SEKB state. */
export function isSekbPhaseCWouldTriggerEnabled(
  cfg?: OpenClawConfig,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveSekbPhaseCWouldTriggerEnabled(cfg, env);
}


/**
 * Best-effort SEKB runtime for production embedded runs.
 * Returns undefined when disabled or store construction fails.
 */
export function resolveEmbeddedSekbRuntime(params: {
  cfg?: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
}): EmbeddedSekbRuntime | undefined {
  if (!isSekbEnabled(params.cfg, params.env ?? process.env)) {
    return undefined;
  }
  try {
    const store = new KnowledgeStore();
    const capture = new TrajectoryCapture({
      store,
      shadowEvaluation: isSekbShadowEvaluationEnabled(params.cfg, params.env ?? process.env),
    });
    const injector = new RetrievalEngine({ store }).create_context_injector();
    const distiller = new DistillationTool({ store });
    return {
      store,
      capture,
      injector,
      distiller,
      batchDistillationAssistantEnabled: isSekbBatchDistillationAssistantEnabled(
        params.cfg,
        params.env ?? process.env,
      ),
    };
  } catch (error) {
    log.warn(`sekb runtime unavailable: ${String(error)}`);
    return undefined;
  }
}

export type SekbInstallableAgent = {
  // Loosely typed so ExtensionAPI overloads and recorder stubs both assign.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on: (type: string, handler: (...args: any[]) => any) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subscribe?: (listener: (...args: any[]) => any) => () => void;
};

/**
 * Adapt embedded ExtensionAPI-like agents to SekbHarnessHookTarget.
 * ExtensionAPI.on returns void; SEKB uninstall expects () => void.
 */
export function asSekbHarnessHookTarget(agent: SekbInstallableAgent): SekbHarnessHookTarget {
  return {
    on(type, handler) {
      agent.on(type, handler);
      return () => {};
    },
    ...(agent.subscribe ? { subscribe: agent.subscribe.bind(agent) } : {}),
  };
}

/**
 * Install SEKB harness hooks on an embedded agent extension target.
 * No-op when runtime is missing (disabled path).
 */
export function installEmbeddedSekbHarnessHooks(
  target: SekbInstallableAgent,
  runtime: EmbeddedSekbRuntime | undefined,
): () => void {
  if (!runtime) {
    return () => {};
  }
  return installSekbHarnessHooks(asSekbHarnessHookTarget(target), {
    enabled: true,
    capture: runtime.capture,
    injector: runtime.injector,
    onError: (error) => {
      log.warn(`sekb harness hook failed: ${String(error)}`);
    },
  });
}

/**
 * Production distillation completion path: confirm_and_save with optional
 * experience Block write when sink + sessionId are available.
 * ANTI-8: only this confirmed path writes experience (not suggest_*).
 */
export function confirmAndSaveSekbExperience(params: {
  distiller: DistillationTool;
  suggestion: DistillationSuggestion;
  edits?: Partial<Principle> | null;
  sessionId?: string;
  contextBlockSink?: ContextBlockSink;
}): string {
  const options =
    params.contextBlockSink && params.sessionId
      ? {
          contextBlockSink: params.contextBlockSink,
          sessionId: params.sessionId,
        }
      : {};
  return params.distiller.confirm_and_save(
    params.suggestion,
    params.edits ?? null,
    options,
  );
}

/**
 * Production-shaped confirm path: resolves SEKB runtime when enabled, then
 * confirms with sink/sessionId when available. Returns undefined when SEKB is
 * disabled so callers stay no-op safe.
 */
export function confirmAndSaveSekbExperienceFromRuntime(params: {
  cfg?: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
  suggestion: DistillationSuggestion;
  edits?: Partial<Principle> | null;
  sessionId?: string;
  contextBlockSink?: ContextBlockSink;
  runtime?: EmbeddedSekbRuntime;
}): string | undefined {
  const runtime =
    params.runtime ??
    resolveEmbeddedSekbRuntime({
      cfg: params.cfg,
      env: params.env,
    });
  if (!runtime) {
    return undefined;
  }
  return confirmAndSaveSekbExperience({
    distiller: runtime.distiller,
    suggestion: params.suggestion,
    edits: params.edits,
    sessionId: params.sessionId,
    contextBlockSink: params.contextBlockSink,
  });
}

/**
 * Creates no worker and makes no provider call. The returned assistant runs
 * only when its caller explicitly invokes `suggest`, preserving normal SEKB
 * distillation parity when the flag is off.
 */
export function createSekbBatchDistillationAssistant(params: {
  runtime: EmbeddedSekbRuntime;
  options?: Omit<SekbBatchDistillationAssistantOptions, "store" | "fallback" | "enabled">;
}): SekbBatchDistillationAssistant {
  return new SekbBatchDistillationAssistant({
    store: params.runtime.store,
    enabled: params.runtime.batchDistillationAssistantEnabled,
    fallback: (trajectoryIds, minClusterSize) =>
      params.runtime.distiller.suggest_principles_from_trajectories(trajectoryIds, minClusterSize),
    ...params.options,
  });
}
