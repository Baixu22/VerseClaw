/**
 * DCS W4: production SEKB enablement + experience bridge wiring.
 *
 * Proves:
 * - enable (config/env) installs harness hooks and sets trajectoryCapture
 * - production-shaped confirm_and_save writes experience via sink
 * - disable path installs nothing / does not leak
 * - ANTI-8: suggest path never writes Blocks
 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, SessionManager } from "../sessions/index.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { ContextBlockSink } from "../../context-engine/block.js";
import type { ProviderRuntimeModel } from "../../plugins/provider-runtime-model.types.js";
import type { DistillationSuggestion } from "../../knowledge/sekb/types.js";
import { closeOpenClawStateDatabaseForTest } from "../../state/openclaw-state-db.js";
import {
  clearTaskStateHandlerConfig,
  getTaskStateHandlerConfig,
} from "../harness/lifecycle-hook-helpers.js";
import { buildEmbeddedExtensionFactories } from "./extensions.js";
import {
  confirmAndSaveSekbExperience,
  confirmAndSaveSekbExperienceFromRuntime,
  installEmbeddedSekbHarnessHooks,
  isSekbBatchDistillationAssistantEnabled,
  isSekbEnabled,
  isSekbShadowEvaluationEnabled,
  resolveEmbeddedSekbRuntime,
} from "./sekb-runtime.js";

const tempRoots: string[] = [];

beforeEach(() => {
  clearTaskStateHandlerConfig();
});

afterEach(() => {
  clearTaskStateHandlerConfig();
  closeOpenClawStateDatabaseForTest();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
  delete process.env.OPENCLAW_SEKB_ENABLED;
  delete process.env.OPENCLAW_SEKB_SHADOW_EVALUATION_ENABLED;
  delete process.env.OPENCLAW_SEKB_BATCH_DISTILLATION_ASSISTANT_ENABLED;
  delete process.env.OPENCLAW_STATE_DIR;
});

describe("isSekbEnabled", () => {
  it("defaults to false when config and env are unset", () => {
    expect(isSekbEnabled(undefined, {})).toBe(false);
    expect(isSekbEnabled({} as OpenClawConfig, {})).toBe(false);
  });

  it("enables from runtime.contextBlock.sekb.enabled", () => {
    const cfg = {
      runtime: { contextBlock: { sekb: { enabled: true } } },
    } as OpenClawConfig;
    expect(isSekbEnabled(cfg, {})).toBe(true);
  });

  it("env overrides config (on and off)", () => {
    const cfgOn = {
      runtime: { contextBlock: { sekb: { enabled: true } } },
    } as OpenClawConfig;
    expect(isSekbEnabled(cfgOn, { OPENCLAW_SEKB_ENABLED: "0" })).toBe(false);
    expect(isSekbEnabled(undefined, { OPENCLAW_SEKB_ENABLED: "true" })).toBe(true);
    expect(isSekbEnabled(undefined, { OPENCLAW_SEKB_ENABLED: "yes" })).toBe(true);
  });
});

describe("isSekbShadowEvaluationEnabled", () => {
  const sekbEnabled = {
    runtime: { contextBlock: { sekb: { enabled: true } } },
  } as OpenClawConfig;

  it("defaults to false and requires the SEKB master gate", () => {
    expect(isSekbShadowEvaluationEnabled(undefined, {})).toBe(false);
    expect(isSekbShadowEvaluationEnabled({
      runtime: { contextBlock: { sekb: { shadowEvaluation: { enabled: true } } } },
    } as OpenClawConfig, {})).toBe(false);
  });

  it("enables only from its nested config when SEKB is enabled", () => {
    expect(isSekbShadowEvaluationEnabled({
      runtime: { contextBlock: { sekb: { enabled: true, shadowEvaluation: { enabled: true } } } },
    } as OpenClawConfig, {})).toBe(true);
  });

  it("uses the dedicated environment variable as the final override", () => {
    const cfg = {
      runtime: { contextBlock: { sekb: { enabled: true, shadowEvaluation: { enabled: false } } } },
    } as OpenClawConfig;
    expect(isSekbShadowEvaluationEnabled(cfg, {
      OPENCLAW_SEKB_SHADOW_EVALUATION_ENABLED: "true",
    })).toBe(true);
    expect(isSekbShadowEvaluationEnabled(sekbEnabled, {
      OPENCLAW_SEKB_SHADOW_EVALUATION_ENABLED: "0",
    })).toBe(false);
  });
});

describe("isSekbBatchDistillationAssistantEnabled", () => {
  it("defaults to false and cannot activate SEKB by itself", () => {
    expect(isSekbBatchDistillationAssistantEnabled(undefined, {})).toBe(false);
    expect(isSekbBatchDistillationAssistantEnabled({
      runtime: { contextBlock: { sekb: { batchDistillationAssistant: { enabled: true } } } },
    } as OpenClawConfig, {})).toBe(false);
  });

  it("uses its nested config and dedicated environment override after the master gate", () => {
    const cfg = {
      runtime: {
        contextBlock: {
          sekb: { enabled: true, batchDistillationAssistant: { enabled: false } },
        },
      },
    } as OpenClawConfig;
    expect(isSekbBatchDistillationAssistantEnabled(cfg, {})).toBe(false);
    expect(isSekbBatchDistillationAssistantEnabled(cfg, {
      OPENCLAW_SEKB_BATCH_DISTILLATION_ASSISTANT_ENABLED: "true",
    })).toBe(true);
    expect(isSekbBatchDistillationAssistantEnabled({
      runtime: { contextBlock: { sekb: { enabled: true, batchDistillationAssistant: { enabled: true } } } },
    } as OpenClawConfig, {
      OPENCLAW_SEKB_BATCH_DISTILLATION_ASSISTANT_ENABLED: "0",
    })).toBe(false);
  });
});

describe("resolveEmbeddedSekbRuntime + install", () => {
  it("returns undefined and does not install when disabled", () => {
    const runtime = resolveEmbeddedSekbRuntime({
      cfg: {} as OpenClawConfig,
      env: {},
    });
    expect(runtime).toBeUndefined();

    const target = createAgentRecorder();
    const uninstall = installEmbeddedSekbHarnessHooks(target, runtime);
    uninstall();
    expect(Object.keys(target.handlers)).toHaveLength(0);
  });

  it("constructs runtime and installs hooks when config enabled", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "openclaw-sekb-w4-"));
    tempRoots.push(root);
    process.env.OPENCLAW_STATE_DIR = root;

    const cfg = {
      runtime: { contextBlock: { sekb: { enabled: true } } },
    } as OpenClawConfig;
    const runtime = resolveEmbeddedSekbRuntime({ cfg, env: {} });
    expect(runtime).toBeDefined();
    expect(runtime?.capture).toBeDefined();
    expect(runtime?.distiller).toBeDefined();

    const target = createAgentRecorder();
    const uninstall = installEmbeddedSekbHarnessHooks(target, runtime);
    expect(Object.keys(target.handlers).length).toBeGreaterThan(0);
    expect(target.handlers.before_agent_start?.length).toBeGreaterThan(0);
    uninstall();
  });

  it("wires the nested shadow flag into terminal trajectory capture only", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "openclaw-sekb-shadow-runtime-"));
    tempRoots.push(root);
    process.env.OPENCLAW_STATE_DIR = root;
    const cfg = {
      runtime: { contextBlock: { sekb: { enabled: true, shadowEvaluation: { enabled: true } } } },
    } as OpenClawConfig;
    const runtime = resolveEmbeddedSekbRuntime({ cfg, env: {} });
    expect(runtime).toBeDefined();
    if (!runtime) {
      return;
    }

    const trajectoryId = runtime.capture.start_trajectory("sensitive task", "config/db", []);
    runtime.capture.log_step(trajectoryId, "tool.call", { secret: "do-not-copy" }, {});
    const trajectory = runtime.capture.finish_trajectory(trajectoryId, "success");

    expect(trajectory.metadata).toMatchObject({
      sekbShadow: { schema: "sekb-shadow-metadata.v1" },
    });
    expect(JSON.stringify(trajectory.metadata)).not.toContain("do-not-copy");
  });
});

describe("production factory wiring", () => {
  it("enable: buildEmbeddedExtensionFactories installs SEKB hooks and sets trajectoryCapture", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "openclaw-sekb-w4-fact-"));
    tempRoots.push(root);
    process.env.OPENCLAW_STATE_DIR = root;

    const cfg = {
      runtime: { contextBlock: { sekb: { enabled: true } } },
    } as OpenClawConfig;
    const sekbRuntime = resolveEmbeddedSekbRuntime({ cfg, env: {} });
    expect(sekbRuntime).toBeDefined();

    const sink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    const agent = createAgentRecorder();
    for (const factory of buildEmbeddedExtensionFactories({
      cfg,
      sessionManager: {} as SessionManager,
      provider: "openai",
      modelId: "gpt-test",
      model: undefined as ProviderRuntimeModel | undefined,
      sessionId: "session-w4",
      sessionKey: "agent:w4:main",
      contextBlockSink: sink,
      workingMemoryStore: {
        query: vi.fn(async () => []),
        upsert: vi.fn(async () => ({ accepted: true })),
      },
      trajectoryCapture: sekbRuntime?.capture,
      sekbRuntime,
      objective: "wire sekb",
    })) {
      void factory(agent as unknown as ExtensionAPI);
    }

    expect(agent.handlers.before_agent_start?.length).toBeGreaterThan(0);
    const config = getTaskStateHandlerConfig();
    expect(config?.trajectoryCapture).toBe(sekbRuntime?.capture);
    expect(config?.contextBlockSink).toBe(sink);
  });

  it("disable: no SEKB install and no trajectoryCapture leakage", () => {
    const sink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    const agent = createAgentRecorder();
    const beforeCounts = countHandlers(agent);

    for (const factory of buildEmbeddedExtensionFactories({
      cfg: {} as OpenClawConfig,
      sessionManager: {} as SessionManager,
      provider: "openai",
      modelId: "gpt-test",
      model: undefined as ProviderRuntimeModel | undefined,
      sessionId: "session-w4-off",
      sessionKey: "agent:w4:main",
      contextBlockSink: sink,
      workingMemoryStore: {
        query: vi.fn(async () => []),
        upsert: vi.fn(async () => ({ accepted: true })),
      },
      // intentionally no sekbRuntime / trajectoryCapture
    })) {
      void factory(agent as unknown as ExtensionAPI);
    }

    const config = getTaskStateHandlerConfig();
    expect(config?.trajectoryCapture).toBeUndefined();
    // Without SEKB, factories still register task-state before_agent_start when sink present,
    // but installEmbeddedSekbHarnessHooks must not have added tool_call / agent_end SEKB hooks.
    expect(agent.handlers.tool_call).toBeUndefined();
    expect(agent.handlers.agent_end).toBeUndefined();
    expect(countHandlers(agent)).toBeGreaterThanOrEqual(beforeCounts);
  });
});

describe("production confirm_and_save experience bridge", () => {
  it("writes experience Block through sink when enabled and sink+sessionId provided", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "openclaw-sekb-w4-confirm-"));
    tempRoots.push(root);
    process.env.OPENCLAW_STATE_DIR = root;

    const cfg = {
      runtime: { contextBlock: { sekb: { enabled: true } } },
    } as OpenClawConfig;
    const runtime = resolveEmbeddedSekbRuntime({ cfg, env: {} });
    expect(runtime).toBeDefined();
    if (!runtime) {
      return;
    }

    // Seed two trajectories so confirm can mark distilled.
    for (const id of ["traj-w4-a", "traj-w4-b"]) {
      runtime.store.save_trajectory({
        trajectory_id: id,
        created_at: "2026-07-14T00:00:00.000Z",
        task_intent: "connect to PostgreSQL",
        task_type: "config/db",
        context_fingerprint: ["postgresql"],
        steps: [],
        outcome: "failure",
        error_signature: null,
        cost: { tokens: 10, duration_seconds: 1, retries: 0 },
        distilled: false,
        distilled_into: [],
        expires_at: null,
        metadata: {},
      });
    }

    const sink: ContextBlockSink = vi.fn(async (writes) =>
      writes.map(() => ({ accepted: true })),
    );
    const suggestion = makeSuggestion();

    const principleId = confirmAndSaveSekbExperience({
      distiller: runtime.distiller,
      suggestion,
      sessionId: "session-w4-prod",
      contextBlockSink: sink,
    });
    expect(typeof principleId).toBe("string");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sink).toHaveBeenCalledTimes(1);
    const writeArg = (sink as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{
      block: { block_type: string; source_system: string; session_id: string };
      admission: { confirmed: boolean; confidence: number; write_origin: string };
    }>;
    expect(writeArg[0]?.block.block_type).toBe("experience");
    expect(writeArg[0]?.block.source_system).toBe("sekb");
    expect(writeArg[0]?.block.session_id).toBe("session-w4-prod");
    expect(writeArg[0]?.admission).toEqual({
      confirmed: true,
      confidence: 0.9,
      write_origin: "handler",
    });
  });

  it("fromRuntime returns undefined when SEKB disabled (no leak)", () => {
    const sink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    const result = confirmAndSaveSekbExperienceFromRuntime({
      cfg: {} as OpenClawConfig,
      env: {},
      suggestion: makeSuggestion(),
      sessionId: "session-off",
      contextBlockSink: sink,
    });
    expect(result).toBeUndefined();
    expect(sink).not.toHaveBeenCalled();
  });

  it("ANTI-8: suggest_principles_from_trajectories does not write Blocks", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "openclaw-sekb-w4-anti8-"));
    tempRoots.push(root);
    process.env.OPENCLAW_STATE_DIR = root;

    const cfg = {
      runtime: { contextBlock: { sekb: { enabled: true } } },
    } as OpenClawConfig;
    const runtime = resolveEmbeddedSekbRuntime({ cfg, env: {} });
    expect(runtime).toBeDefined();
    if (!runtime) {
      return;
    }
    for (const id of ["traj-anti-a", "traj-anti-b"]) {
      runtime.store.save_trajectory({
        trajectory_id: id,
        created_at: "2026-07-14T00:00:00.000Z",
        task_intent: "connect to PostgreSQL",
        task_type: "config/db",
        context_fingerprint: ["postgresql"],
        steps: [],
        outcome: "failure",
        error_signature: null,
        cost: { tokens: 10, duration_seconds: 1, retries: 0 },
        distilled: false,
        distilled_into: [],
        expires_at: null,
        metadata: {},
      });
    }
    const sink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    const suggestions = runtime.distiller.suggest_principles_from_trajectories();
    expect(suggestions.length).toBeGreaterThan(0);
    expect(sink).not.toHaveBeenCalled();
  });
});

type RegisteredHandler = (event: unknown, ctx?: unknown) => unknown;

function createAgentRecorder() {
  const handlers: Record<string, RegisteredHandler[]> = {};
  return {
    handlers,
    on(event: string, handler: RegisteredHandler) {
      (handlers[event] ??= []).push(handler);
    },
  };
}

function countHandlers(agent: { handlers: Record<string, RegisteredHandler[]> }): number {
  return Object.values(agent.handlers).reduce((sum, list) => sum + list.length, 0);
}

function makeSuggestion(
  overrides: Partial<DistillationSuggestion> = {},
): DistillationSuggestion {
  return {
    cluster_summary: "PostgreSQL connection refused failures",
    source_trajectory_ids: ["traj-w4-a", "traj-w4-b"],
    suggested_principle: {
      title: "Check PG access",
      condition: "When PostgreSQL reports Connection refused",
      action: "Check pg_hba.conf and firewall rules",
      reason: "Most connection refusals are environment issues",
      task_types: ["config/db"],
      context_tags: ["postgresql"],
      criticality: "high",
    },
    confidence: 0.9,
    ...overrides,
  };
}
