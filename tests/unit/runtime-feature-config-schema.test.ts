import { describe, expect, it } from "vitest";
import { FIELD_HELP } from "../../openclaw_runtime/src/config/schema.help";
import { FIELD_LABELS } from "../../openclaw_runtime/src/config/schema.labels";
import { OpenClawSchema } from "../../openclaw_runtime/src/config/zod-schema";

describe("runtime feature config schema", () => {
  it("accepts default-off runtime AgentMap flags without widening strict keys", () => {
    const parsed = OpenClawSchema.parse({
      runtime: {
        agentMap: {
          provider: true,
          promptAssemblyExperiment: true,
          promptCandidateRuntimeShadow: true,
          promptCandidateControlledCutoverPilot: true,
          promptCandidateTaskLoopExplicitInvocationPilot: true,
        },
      },
    });

    expect(parsed.runtime?.agentMap).toEqual({
      provider: true,
      promptAssemblyExperiment: true,
      promptCandidateRuntimeShadow: true,
      promptCandidateControlledCutoverPilot: true,
      promptCandidateTaskLoopExplicitInvocationPilot: true,
    });
    expect(() =>
      OpenClawSchema.parse({
        runtime: { agentMap: { provider: true, promptCutover: true } },
      }),
    ).toThrow();
    expect(() =>
      OpenClawSchema.parse({
        runtime: { agentMap: { promptAssemblyExperiment: true, defaultOn: true } },
      }),
    ).toThrow();
    expect(() =>
      OpenClawSchema.parse({
        runtime: {
          agentMap: {
            promptAssemblyExperiment: true,
            promptCandidateRuntimeShadow: true,
            promptCandidateRuntimeCutover: true,
          },
        },
      }),
    ).toThrow();
  });

  it("accepts default-off runtime memory flags without widening strict keys", () => {
    const parsed = OpenClawSchema.parse({
      runtime: {
        memory: {
          shadow: true,
          provider: true,
          proposeFacts: true,
          persist: true,
        },
      },
    });

    expect(parsed.runtime?.memory).toEqual({
      shadow: true,
      provider: true,
      proposeFacts: true,
      persist: true,
    });
    expect(() =>
      OpenClawSchema.parse({
        runtime: { memory: { shadow: true, defaultOn: true } },
      }),
    ).toThrow();
  });

  it("accepts default-off runtime trace context flags without widening strict keys", () => {
    const parsed = OpenClawSchema.parse({
      runtime: {
        traceContext: {
          shadow: true,
          provider: true,
          propagation: true,
        },
      },
    });

    expect(parsed.runtime?.traceContext).toEqual({
      shadow: true,
      provider: true,
      propagation: true,
    });
    expect(() =>
      OpenClawSchema.parse({
        runtime: { traceContext: { shadow: true, exporter: true } },
      }),
    ).toThrow();
  });

  it("does not synthesize enabled defaults when runtime flags are omitted", () => {
    expect(OpenClawSchema.parse({}).runtime).toBeUndefined();

    const parsed = OpenClawSchema.parse({
      runtime: {
        memory: {},
        agentMap: {},
        traceContext: {},
      },
    });

    expect(parsed.runtime?.memory).toEqual({});
    expect(parsed.runtime?.agentMap).toEqual({});
    expect(parsed.runtime?.traceContext).toEqual({});
    expect(parsed.runtime?.memory?.shadow).not.toBe(true);
    expect(parsed.runtime?.memory?.provider).not.toBe(true);
    expect(parsed.runtime?.memory?.proposeFacts).not.toBe(true);
    expect(parsed.runtime?.memory?.persist).not.toBe(true);
    expect(parsed.runtime?.traceContext?.shadow).not.toBe(true);
    expect(parsed.runtime?.traceContext?.provider).not.toBe(true);
    expect(parsed.runtime?.traceContext?.propagation).not.toBe(true);
    expect(parsed.runtime?.agentMap?.provider).not.toBe(true);
    expect(parsed.runtime?.agentMap?.promptAssemblyExperiment).not.toBe(true);
    expect(parsed.runtime?.agentMap?.promptCandidateRuntimeShadow).not.toBe(true);
    expect(parsed.runtime?.agentMap?.promptCandidateControlledCutoverPilot).not.toBe(true);
    expect(parsed.runtime?.agentMap?.promptCandidateTaskLoopExplicitInvocationPilot)
      .not.toBe(true);
  });

  it("keeps the existing evidence verifier schema entry valid", () => {
    const parsed = OpenClawSchema.parse({
      runtime: {
        evidenceVerifier: { shadow: true },
      },
    });

    expect(parsed.runtime?.evidenceVerifier?.shadow).toBe(true);
  });

  it("documents runtime AgentMap provider labels and help as shadow-only", () => {
    expect(FIELD_LABELS["runtime.agentMap"]).toBe("Runtime AgentMap");
    expect(FIELD_LABELS["runtime.agentMap.provider"]).toBe("Runtime AgentMap Provider");
    expect(FIELD_LABELS["runtime.agentMap.promptAssemblyExperiment"])
      .toBe("Runtime AgentMap Prompt Assembly Experiment");
    expect(FIELD_LABELS["runtime.agentMap.promptCandidateRuntimeShadow"])
      .toBe("Runtime AgentMap Prompt Candidate Runtime Shadow");
    expect(FIELD_LABELS["runtime.agentMap.promptCandidateControlledCutoverPilot"])
      .toBe("Runtime AgentMap Prompt Candidate Controlled Cutover Pilot");
    expect(FIELD_LABELS["runtime.agentMap.promptCandidateTaskLoopExplicitInvocationPilot"])
      .toBe("Runtime AgentMap Prompt Candidate TaskLoop Explicit Invocation Pilot");
    expect(FIELD_HELP["runtime.agentMap"]).toContain("Default-off AgentMap readiness");
    expect(FIELD_HELP["runtime.agentMap.provider"]).toContain("default: false");
    expect(FIELD_HELP["runtime.agentMap.provider"]).toContain("does not add AgentMap output to default prompts");
    expect(FIELD_HELP["runtime.agentMap.promptAssemblyExperiment"]).toContain("default: false");
    expect(FIELD_HELP["runtime.agentMap.promptAssemblyExperiment"])
      .toContain("does not feed AgentMap output into default prompts");
    expect(FIELD_HELP["runtime.agentMap.promptCandidateRuntimeShadow"]).toContain("default: false");
    expect(FIELD_HELP["runtime.agentMap.promptCandidateRuntimeShadow"])
      .toContain("does not add candidate text to prompts");
    expect(FIELD_HELP["runtime.agentMap.promptCandidateControlledCutoverPilot"])
      .toContain("default: false");
    expect(FIELD_HELP["runtime.agentMap.promptCandidateControlledCutoverPilot"])
      .toContain("valid AgentMapResult is explicitly supplied");
    expect(FIELD_HELP["runtime.agentMap.promptCandidateControlledCutoverPilot"])
      .toContain("does not change TaskLoop reviewer prompts");
    expect(FIELD_HELP["runtime.agentMap.promptCandidateTaskLoopExplicitInvocationPilot"])
      .toContain("default: false");
    expect(FIELD_HELP["runtime.agentMap.promptCandidateTaskLoopExplicitInvocationPilot"])
      .toContain("caller explicitly requests TaskLoop pilot invocation");
    expect(FIELD_HELP["runtime.agentMap.promptCandidateTaskLoopExplicitInvocationPilot"])
      .toContain("does not change default TaskLoop reviewer prompts");
  });
});
