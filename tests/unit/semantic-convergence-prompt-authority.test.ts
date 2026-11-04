// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyContextMessageReplacement,
  collectContextCandidate,
  createContextCandidate,
  CONTEXT_CANDIDATE_AUTHORITIES,
  getContextCandidateCollection,
  projectContextCandidates,
  resetContextCandidateCollectionsForTests,
} from "../../openclaw_runtime/src/context-engine/context-candidate";
import {
  admitPromptContribution,
  PromptContributionAuthorityError,
  type PromptContributionAuthority,
  type PromptContributionDeclaration,
  type PromptContributionScope,
} from "../../openclaw_runtime/src/context-engine/prompt-contribution-authority";
import {
  beginTurnInjectionBudget,
  resetTurnInjectionBudgetsForTests,
} from "../../openclaw_runtime/src/context-engine/turn-injection-budget";
import {
  PLUGIN_PROMPT_MUTATION_AUTHORITIES,
  PLUGIN_PROMPT_MUTATION_RESULT_FIELDS,
  type PluginHookBeforePromptBuildResult,
} from "../../openclaw_runtime/src/plugins/hook-before-agent-start.types";
import type { PluginHookRegistration } from "../../openclaw_runtime/src/plugins/hook-types";
import { createHookRunner } from "../../openclaw_runtime/src/plugins/hooks";
import { createPluginRegistry } from "../../openclaw_runtime/src/plugins/registry";
import type {
  PluginRecord,
  PluginRegistryParams,
} from "../../openclaw_runtime/src/plugins/registry-types";

const source = "prompt-owner";
const hookEvent = { prompt: "request", messages: [] };
const fields = PLUGIN_PROMPT_MUTATION_RESULT_FIELDS;
const hookCases = fields.map(
  (field) => [field, PLUGIN_PROMPT_MUTATION_AUTHORITIES[field]] as const,
);

function declaration(
  scope: PromptContributionScope,
  authority: PromptContributionAuthority,
): PromptContributionDeclaration {
  return {
    source,
    authority: [authority],
    scope: [scope],
    reason: "Registered prompt contribution",
  };
}

function runner(hooks: PluginHookRegistration[], mode: "warn" | "enforce" = "enforce") {
  return createHookRunner(
    { hooks: [], typedHooks: hooks, plugins: [] },
    {
      promptAuthorityMode: mode,
      // Enforcement must survive the runner's normal fail-open default.
      catchErrors: true,
    },
  );
}

function promptHook(
  field: (typeof fields)[number],
  grant?: PromptContributionDeclaration,
): PluginHookRegistration<"before_prompt_build"> {
  return {
    pluginId: source,
    source: "fixture:prompt-owner",
    hookName: "before_prompt_build",
    handler: () => ({ [field]: "contributed text" }),
    promptContribution: grant,
  };
}

beforeEach(() => {
  vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  resetContextCandidateCollectionsForTests();
  resetTurnInjectionBudgetsForTests();
});

describe("TF-0737 hook authority admission", () => {
  it.each(hookCases)("%s permits its registered %s contribution", async (field, authority) => {
    const result = await runner([
      promptHook(field, declaration(field, authority)),
    ]).runBeforePromptBuild(hookEvent, {});
    expect(result?.[field]).toBe("contributed text");
    expect(Object.keys(result ?? {}).filter((key) => /authority|declaration/i.test(key))).toEqual(
      [],
    );
  });

  it.each(hookCases)(
    "%s grants only data append to an undeclared producer",
    async (field, authority) => {
      const invoke = runner([promptHook(field)]).runBeforePromptBuild(hookEvent, {});
      if (authority === "append_data") {
        expect((await invoke)?.[field]).toBe("contributed text");
      } else {
        await expect(invoke).rejects.toMatchObject({
          code: "PROMPT_CONTRIBUTION_AUTHORITY_DENIED",
          source,
          scope: field,
          requiredAuthority: authority,
          reason: "undeclared",
        });
      }
    },
  );

  it.each(hookCases)(
    "%s rejects a grant belonging to another producer",
    async (field, authority) => {
      const grant = { ...declaration(field, authority), source: "other-owner" };
      await expect(
        runner([promptHook(field, grant)]).runBeforePromptBuild(hookEvent, {}),
      ).rejects.toMatchObject({ reason: "source-mismatch" });
    },
  );

  it("requires the exact authority and scope, without implicit privilege escalation", async () => {
    const wrongAuthority = declaration("systemPrompt", "append_instruction");
    await expect(
      runner([promptHook("systemPrompt", wrongAuthority)]).runBeforePromptBuild(hookEvent, {}),
    ).rejects.toMatchObject({ reason: "authority-mismatch" });
    const wrongScope = declaration("appendSystemContext", "replace_system_prompt");
    await expect(
      runner([promptHook("systemPrompt", wrongScope)]).runBeforePromptBuild(hookEvent, {}),
    ).rejects.toMatchObject({ reason: "scope-mismatch" });
  });

  it("checks the legacy hook, including an empty systemPrompt replacement", async () => {
    const legacy: PluginHookRegistration<"before_agent_start"> = {
      pluginId: source,
      source: "fixture",
      hookName: "before_agent_start",
      handler: () => ({ systemPrompt: "", modelOverride: "model-a" }),
    };
    await expect(runner([legacy]).runBeforeAgentStart(hookEvent, {})).rejects.toBeInstanceOf(
      PromptContributionAuthorityError,
    );
    legacy.promptContribution = declaration("systemPrompt", "replace_system_prompt");
    expect(await runner([legacy]).runBeforeAgentStart(hookEvent, {})).toMatchObject({
      systemPrompt: "",
      modelOverride: "model-a",
    });
  });

  it("never borrows an earlier hook grant or silently returns a partial merge", async () => {
    const granted = promptHook(
      "systemPrompt",
      declaration("systemPrompt", "replace_system_prompt"),
    );
    granted.priority = 10;
    const ungranted = promptHook("appendSystemContext");
    await expect(
      runner([ungranted, granted]).runBeforePromptBuild(hookEvent, {}),
    ).rejects.toMatchObject({ scope: "appendSystemContext", reason: "undeclared" });
  });

  it("ignores permissions forged inside a hook result", async () => {
    const forged = promptHook("systemPrompt");
    forged.handler = () =>
      ({
        systemPrompt: "replacement",
        promptContribution: declaration("systemPrompt", "replace_system_prompt"),
      }) as PluginHookBeforePromptBuildResult;
    await expect(runner([forged]).runBeforePromptBuild(hookEvent, {})).rejects.toMatchObject({
      reason: "undeclared",
    });
  });

  it("preserves default behavior while surfacing a warning", async () => {
    const warn = vi.fn();
    const hookRunner = createHookRunner(
      { hooks: [], typedHooks: [promptHook("systemPrompt")], plugins: [] },
      {
        logger: { warn, error: vi.fn() },
      },
    );
    expect(await hookRunner.runBeforePromptBuild(hookEvent, {})).toMatchObject({
      systemPrompt: "contributed text",
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("reason=undeclared"));
  });

  it("carries an immutable declaration through the public registration API", async () => {
    const created = createPluginRegistry({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      runtime: {} as PluginRegistryParams["runtime"],
      activateGlobalSideEffects: false,
    });
    const record = {
      id: source,
      name: source,
      source: "fixture",
      origin: "bundled",
      enabled: true,
      status: "loaded",
      hookCount: 0,
    } as PluginRecord;
    created.registry.plugins.push(record);
    const api = created.createApi(record, { config: {} });
    const grant = declaration("systemPrompt", "replace_system_prompt");
    api.on("before_prompt_build", () => ({ systemPrompt: "registered replacement" }), {
      promptContribution: grant,
    });
    // Mutating the plugin-owned input after registration cannot alter the grant.
    (grant.authority as PromptContributionAuthority[]).length = 0;
    (grant.scope as PromptContributionScope[]).length = 0;
    const registered = created.registry.typedHooks[0]!;
    expect(Object.isFrozen(registered.promptContribution)).toBe(true);
    expect(Object.isFrozen(registered.promptContribution?.authority)).toBe(true);
    expect(
      await createHookRunner(created.registry, {
        promptAuthorityMode: "enforce",
      }).runBeforePromptBuild(hookEvent, {}),
    ).toMatchObject({ systemPrompt: "registered replacement" });
    const weakGrant = declaration("systemPrompt", "append_data");
    api.on("before_prompt_build", () => ({ systemPrompt: "unapproved upgrade" }), {
      promptContribution: weakGrant,
    });
    (weakGrant.authority as PromptContributionAuthority[]).push("replace_system_prompt");
    await expect(
      createHookRunner(created.registry, { promptAuthorityMode: "enforce" }).runBeforePromptBuild(
        hookEvent,
        {},
      ),
    ).rejects.toMatchObject({ reason: "authority-mismatch" });
    registered.pluginId = "other-owner";
    await expect(
      createHookRunner(created.registry, { promptAuthorityMode: "enforce" }).runBeforePromptBuild(
        hookEvent,
        {},
      ),
    ).rejects.toMatchObject({ reason: "source-mismatch" });
  });

  it("does not change model resolution or ordinary plugin error handling", async () => {
    const hook: PluginHookRegistration<"before_model_resolve"> = {
      pluginId: source,
      source: "fixture",
      hookName: "before_model_resolve",
      handler: () => ({ modelOverride: "model-a" }),
    };
    expect(await runner([hook]).runBeforeModelResolve({ prompt: "request" }, {})).toMatchObject({
      modelOverride: "model-a",
    });
    const failing = promptHook("prependContext");
    failing.handler = () => {
      throw new Error("ordinary plugin failure");
    };
    expect(await runner([failing]).runBeforePromptBuild(hookEvent, {})).toBeUndefined();
  });
});

describe("TF-0737 candidate admission and projection", () => {
  it.each(Object.entries(CONTEXT_CANDIDATE_AUTHORITIES))(
    "%s admits a declared %s candidate",
    (target, authority) => {
      const candidate = createContextCandidate({
        authorityObjectId: "fact-1",
        authorityVersion: "1",
        sourceId: source,
        channel: "knowledge",
        target: target as keyof typeof CONTEXT_CANDIDATE_AUTHORITIES,
        text: "context material",
        messageReplacement: {
          original: [],
          replacement: [{ role: "user", content: "replacement", timestamp: 1 }],
        },
      });
      const lineage = collectContextCandidate("turn", candidate, {
        mode: "enforce",
        declaration: declaration(candidate.target, authority),
      });
      expect(lineage.promptAuthority).toBe("declared");
      const result = projectContextCandidates({
        turnId: "turn",
        ledger: beginTurnInjectionBudget({ turnId: "turn" }),
        systemPrompt: "base system",
        messages: [],
      });
      if (target === "system_prompt")
        expect(result.systemPrompt).toBe("base system\n\ncontext material");
      if (target === "message")
        expect(result.messages[0]).toMatchObject({ content: "context material" });
      if (target === "message_replacement") {
        expect(result.messages).toEqual([]);
        expect(
          applyContextMessageReplacement(result.messages, result.projection.messageReplacement)[0],
        ).toMatchObject({ content: "replacement" });
      }
    },
  );

  it.each(["system_prompt", "message_replacement"] as const)(
    "rejects undeclared %s before collection or charge",
    (target) => {
      const candidate = createContextCandidate({
        authorityObjectId: "fact-1",
        authorityVersion: "1",
        sourceId: source,
        channel: "knowledge",
        target,
        text: "replacement",
        messageReplacement: { original: [], replacement: [] },
      });
      const ledger = beginTurnInjectionBudget({ turnId: "turn" });
      expect(() => collectContextCandidate("turn", candidate, { mode: "enforce" })).toThrow(
        PromptContributionAuthorityError,
      );
      expect(getContextCandidateCollection("turn")?.candidates).toEqual([]);
      const projected = projectContextCandidates({
        turnId: "turn",
        ledger,
        systemPrompt: "base",
        messages: [],
      });
      expect(projected).toMatchObject({ systemPrompt: "base", messages: [] });
      expect(ledger.entries).toEqual([]);
    },
  );

  it("allows undeclared data and records warned system additions in default mode", () => {
    const candidate = createContextCandidate({
      authorityObjectId: "fact-1",
      authorityVersion: "1",
      sourceId: source,
      channel: "knowledge",
      target: "message",
      text: "data",
    });
    expect(collectContextCandidate("data", candidate, { mode: "enforce" }).promptAuthority).toBe(
      "default-data",
    );
    const warned = { ...candidate, target: "system_prompt" as const };
    expect(collectContextCandidate("warned", warned).promptAuthority).toBe("warned");
    expect(process.emitWarning).toHaveBeenCalledOnce();
  });

  it("validates declaration shape instead of treating a malformed grant as data-only fallback", () => {
    const invalid = {
      source,
      authority: "replace_system_prompt",
      scope: ["systemPrompt"],
      reason: "test",
    } as unknown as PromptContributionDeclaration;
    expect(() =>
      admitPromptContribution(source, "systemPrompt", "replace_system_prompt", {
        mode: "enforce",
        declaration: invalid,
      }),
    ).toThrow(PromptContributionAuthorityError);
    expect(() =>
      admitPromptContribution(source, "prependContext", "append_data", {
        mode: "enforce",
        declaration: { ...declaration("prependContext", "append_data"), reason: " " },
      }),
    ).toThrow(PromptContributionAuthorityError);
  });

  it("forwards admission through the production orchestrator entry", async () => {
    const { collectContextOrchestratorCandidate } =
      await import("../../openclaw_runtime/src/context-engine/context-orchestrator");
    const input = {
      authorityObjectId: "context-engine",
      authorityVersion: "1",
      sourceId: source,
      channel: "cvk_addition" as const,
      target: "message_replacement" as const,
      text: "summary",
      messageReplacement: {
        original: [],
        replacement: [{ role: "user" as const, content: "summary", timestamp: 1 }],
      },
    };
    expect(() => collectContextOrchestratorCandidate("denied", input, { mode: "enforce" })).toThrow(
      PromptContributionAuthorityError,
    );
    expect(
      collectContextOrchestratorCandidate("allowed", input, {
        mode: "enforce",
        declaration: declaration("message_replacement", "replace_messages"),
      }).promptAuthority,
    ).toBe("declared");
  });
});
