/**
 * Production SEKB runtime for embedded-agent sessions (DCS W4 / Stage 5).
 *
 * Flag-gated: runtime.contextBlock.sekb.enabled (default false) or
 * OPENCLAW_SEKB_ENABLED=true|1|yes|on. When enabled, production attempt/compact
 * can install harness hooks and supply trajectoryCapture to task-state handler
 * config. Durable principle confirmation stays host-side (knowledge-api
 * sekbConfirmPrinciple -> confirm_and_save with a BlockStore sink); the runtime
 * records versioned attribution diagnostics. Principle content is changed only
 * through explicit host-side confirmation.
 */
import type { OpenClawConfig } from "../../config/types.openclaw.js";
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
  type InstallSekbHarnessHooksOptions,
} from "../../knowledge/sekb/harness-integration.js";
import { KnowledgeStore } from "../../knowledge/sekb/knowledge-store.js";
import { RetrievalEngine, type ContextInjector } from "../../knowledge/sekb/retrieval-engine.js";
import { TrajectoryCapture } from "../../knowledge/sekb/trajectory-capture.js";
import type { RuntimeLineage } from "../../runtime-core/lineage.js";
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
export function isSekbEnabled(cfg?: OpenClawConfig, env: NodeJS.ProcessEnv = process.env): boolean {
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
  on: (type: string, handler: (event: unknown, context?: unknown) => unknown) => unknown;
  subscribe?: (listener: (event: unknown) => unknown) => () => void;
  registerTool?: SekbHarnessHookTarget["registerTool"];
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
    ...(agent.registerTool ? { registerTool: agent.registerTool.bind(agent) } : {}),
  };
}

/**
 * Install SEKB harness hooks on an embedded agent extension target.
 * No-op when runtime is missing (disabled path).
 */
export function installEmbeddedSekbHarnessHooks(
  target: SekbInstallableAgent,
  runtime: EmbeddedSekbRuntime | undefined,
  lineage?: RuntimeLineage | (() => RuntimeLineage | undefined),
  identity?: InstallSekbHarnessHooksOptions["identity"],
  retainedExperience?: InstallSekbHarnessHooksOptions["retainedExperience"],
): () => void {
  if (!runtime) {
    return () => {};
  }
  return installSekbHarnessHooks(asSekbHarnessHookTarget(target), {
    enabled: true,
    capture: runtime.capture,
    injector: runtime.injector,
    store: runtime.store,
    ...(identity ? { identity } : {}),
    ...(retainedExperience ? { retainedExperience } : {}),
    ...(lineage ? { lineage } : {}),
    onError: (error) => {
      log.warn(`sekb harness hook failed: ${String(error)}`);
    },
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
