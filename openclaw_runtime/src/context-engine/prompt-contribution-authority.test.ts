// @vitest-environment node
/**
 * TF-0737: producer-level prompt contribution authority.
 *
 * Rights come from registration metadata, never from hook output. Undeclared
 * producers may append data only; stronger mutations are rejected in enforce
 * mode instead of being silently downgraded.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PromptContributionAuthorityError,
  admitPromptContribution,
  getBuiltinPromptContributionDeclaration,
  resolvePromptAuthorityMode,
  type PromptContributionDeclaration,
} from "./prompt-contribution-authority.js";
import {
  CONTEXT_CANDIDATE_AUTHORITIES,
  collectContextCandidate,
  createContextCandidate,
  resetContextCandidateCollectionsForTests,
} from "./context-candidate.js";
import {
  PLUGIN_PROMPT_MUTATION_AUTHORITIES,
  PLUGIN_PROMPT_MUTATION_RESULT_FIELDS,
} from "../plugins/hook-before-agent-start.types.js";
import { createHookRunner } from "../plugins/hooks.js";

function declaration(
  overrides: Partial<PromptContributionDeclaration> = {},
): PromptContributionDeclaration {
  return {
    authority: ["replace_system_prompt"],
    source: "plugin-a",
    scope: ["systemPrompt"],
    reason: "test declaration",
    ...overrides,
  };
}

describe("TF-0737 prompt contribution authority", () => {
  afterEach(() => {
    resetContextCandidateCollectionsForTests();
    vi.unstubAllEnvs();
  });

  it("declares an authority for all five mutation fields", () => {
    expect(PLUGIN_PROMPT_MUTATION_RESULT_FIELDS).toHaveLength(5);
    expect(Object.keys(PLUGIN_PROMPT_MUTATION_AUTHORITIES).sort()).toEqual(
      [...PLUGIN_PROMPT_MUTATION_RESULT_FIELDS].sort(),
    );
    expect(PLUGIN_PROMPT_MUTATION_AUTHORITIES).toEqual({
      systemPrompt: "replace_system_prompt",
      prependContext: "append_data",
      appendContext: "append_data",
      prependSystemContext: "append_instruction",
      appendSystemContext: "append_instruction",
    });
    expect(CONTEXT_CANDIDATE_AUTHORITIES).toEqual({
      system_prompt: "append_instruction",
      message: "append_data",
      message_replacement: "replace_messages",
    });
  });

  it("rejects an undeclared systemPrompt replacement in enforce mode", () => {
    expect(() =>
      admitPromptContribution("plugin-a", "systemPrompt", "replace_system_prompt", {
        mode: "enforce",
      }),
    ).toThrowError(PromptContributionAuthorityError);
    try {
      admitPromptContribution("plugin-a", "systemPrompt", "replace_system_prompt", {
        mode: "enforce",
      });
    } catch (error) {
      expect((error as PromptContributionAuthorityError).reason).toBe("undeclared");
    }
  });

  it("rejects an undeclared message replacement in enforce mode", () => {
    expect(() =>
      admitPromptContribution("plugin-a", "message_replacement", "replace_messages", {
        mode: "enforce",
      }),
    ).toThrowError(PromptContributionAuthorityError);
  });

  it("still allows append_data by default for undeclared producers", () => {
    expect(admitPromptContribution("plugin-a", "appendContext", "append_data")).toBe(
      "default-data",
    );
  });

  it("allows a matching declaration and rejects mismatches explicitly", () => {
    expect(
      admitPromptContribution("plugin-a", "systemPrompt", "replace_system_prompt", {
        mode: "enforce",
        declaration: declaration(),
      }),
    ).toBe("declared");

    for (const [overrides, reason] of [
      [{ source: "plugin-b" }, "source-mismatch"],
      [{ scope: ["appendSystemContext"] }, "scope-mismatch"],
      [{ authority: ["append_instruction"] }, "authority-mismatch"],
    ] as const) {
      try {
        admitPromptContribution("plugin-a", "systemPrompt", "replace_system_prompt", {
          mode: "enforce",
          declaration: declaration(overrides as Partial<PromptContributionDeclaration>),
        });
        throw new Error("expected rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(PromptContributionAuthorityError);
        expect((error as PromptContributionAuthorityError).reason).toBe(reason);
      }
    }
  });

  it("warns instead of throwing outside enforce mode, and never downgrades silently", () => {
    const warn = vi.fn();
    expect(
      admitPromptContribution("plugin-a", "systemPrompt", "replace_system_prompt", {
        mode: "warn",
        warn,
      }),
    ).toBe("warned");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("Prompt contribution authority violation");
  });

  it("enforces the same rule at the context-candidate collection boundary", () => {
    const candidate = createContextCandidate({
      authorityObjectId: "object-a",
      authorityVersion: "v1",
      sourceId: "plugin-a",
      channel: "other",
      target: "system_prompt",
      text: "replacement instruction",
    });
    expect(() => collectContextCandidate("turn-1", candidate, { mode: "enforce" })).toThrowError(
      PromptContributionAuthorityError,
    );
  });

  it("declares built-in context producers so enforce mode keeps the product path", () => {
    for (const [sourceId, target] of [
      ["memory-inject-pilot:runtime-memory", "system_prompt"],
      ["compass-ssp", "system_prompt"],
      ["compass-retrieval", "system_prompt"],
      ["cvk-context-engine", "system_prompt"],
      ["cvk-message-replacement", "message_replacement"],
      ["dcs-knowledge", "message"],
      ["context-block:knowledge", "message"],
    ] as const) {
      const candidate = createContextCandidate({
        authorityObjectId: "object-a",
        authorityVersion: "v1",
        sourceId,
        channel: "other",
        target,
        text: "built-in contribution",
        ...(target === "message_replacement"
          ? { messageReplacement: { original: [], replacement: [] } }
          : {}),
      });
      const lineage = collectContextCandidate("turn-builtin", candidate, { mode: "enforce" });
      expect(lineage.promptAuthority).toBe("declared");
      resetContextCandidateCollectionsForTests();
    }
  });

  it("keeps message append as default-data in enforce mode", () => {
    const candidate = createContextCandidate({
      authorityObjectId: "object-a",
      authorityVersion: "v1",
      sourceId: "plugin-a",
      channel: "other",
      target: "message",
      text: "appended data",
    });
    const lineage = collectContextCandidate("turn-1", candidate, { mode: "enforce" });
    expect(lineage.promptAuthority).toBe("default-data");
  });

  it("parses the host enforce switch, defaulting to warn", () => {
    expect(resolvePromptAuthorityMode(undefined)).toBe("warn");
    expect(resolvePromptAuthorityMode("warn")).toBe("warn");
    expect(resolvePromptAuthorityMode("enforce")).toBe("enforce");
    expect(resolvePromptAuthorityMode(" ENFORCE ")).toBe("enforce");
    expect(() => resolvePromptAuthorityMode("anything-else")).toThrow("expected warn or enforce");
  });

  it.each([
    "dcs-knowledge",
    "context-block:knowledge",
    "compass-ssp",
    "session-start:summary",
    "memory-inject-pilot:runtime-memory",
  ])("does not derive replacement permission from a built-in source name (%s)", (sourceId) => {
    const candidate = createContextCandidate({
      authorityObjectId: "object-a",
      authorityVersion: "v1",
      sourceId,
      channel: "other",
      target: "message_replacement",
      text: "unauthorized replacement",
      messageReplacement: { original: [], replacement: [] },
    });
    expect(() => collectContextCandidate("escalation", candidate, { mode: "enforce" })).toThrow(
      PromptContributionAuthorityError,
    );
  });

  it("does not register synthetic names or broaden exact core IDs by prefix", () => {
    for (const sourceId of [
      "shared-source",
      "compass",
      "cvk",
      "cvk-messages",
      "compass-ssp:third-party",
    ]) {
      expect(getBuiltinPromptContributionDeclaration(sourceId)).toBeUndefined();
    }
  });

  it("enforces the host environment mode at the candidate boundary", () => {
    vi.stubEnv("OPENCLAW_PROMPT_AUTHORITY_MODE", "enforce");
    const candidate = createContextCandidate({
      authorityObjectId: "fact",
      authorityVersion: "1",
      sourceId: "plugin-a",
      channel: "other",
      target: "system_prompt",
      text: "instruction",
    });
    expect(() => collectContextCandidate("host-mode", candidate)).toThrow(
      PromptContributionAuthorityError,
    );
    expect(
      collectContextCandidate("host-warn", candidate, { mode: "warn", warn: vi.fn() })
        .promptAuthority,
    ).toBe("warned");
  });

  it("enforces the host mode through the default hook-runner construction", async () => {
    vi.stubEnv("OPENCLAW_PROMPT_AUTHORITY_MODE", "enforce");
    const registry = {
      hooks: [],
      plugins: [],
      typedHooks: [
        {
          pluginId: "plugin-a",
          source: "fixture",
          hookName: "before_prompt_build" as const,
          handler: () => ({ systemPrompt: "unregistered replacement" }),
        },
      ],
    };
    await expect(
      createHookRunner(registry).runBeforePromptBuild({ prompt: "request", messages: [] }, {}),
    ).rejects.toBeInstanceOf(PromptContributionAuthorityError);
    const warn = vi.fn();
    expect(
      await createHookRunner(registry, {
        promptAuthorityMode: "warn",
        logger: { warn, error: vi.fn() },
      }).runBeforePromptBuild({ prompt: "request", messages: [] }, {}),
    ).toMatchObject({ systemPrompt: "unregistered replacement" });
    expect(warn).toHaveBeenCalledOnce();
  });
});
