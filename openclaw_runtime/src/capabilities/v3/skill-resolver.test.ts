import { describe, expect, it } from "vitest";
import {
  CAPABILITY_REGISTRY_V3_FIXTURE_DESCRIPTORS,
} from "./evaluation-baseline.js";
import { evaluateCapabilitySkillResolverBaseline } from "./skill-resolver-evaluation.js";
import {
  resolveCapabilitySkills,
  searchCapabilitySkills,
  type CapabilitySkillResolverBudget,
} from "./skill-resolver.js";
import { buildCapabilityShadowCatalog } from "./shadow-catalog.js";

const budget: CapabilitySkillResolverBudget = {
  contextWindowCharacters: 2_000,
  l0ContextWindowShare: 0.25,
  l0MaxEntries: 8,
  l0MaxTriggerKeywordsPerEntry: 4,
};

function catalog() {
  return buildCapabilityShadowCatalog(CAPABILITY_REGISTRY_V3_FIXTURE_DESCRIPTORS);
}

describe("Capability Skill hierarchical resolver", () => {
  it("is a no-op when disabled and does not inspect the catalog", () => {
    const disabled = resolveCapabilitySkills({
      enabled: false,
      get catalog() {
        throw new Error("disabled resolver must not inspect catalog");
      },
      budget,
    } as never);

    expect(disabled).toEqual({ enabled: false, mode: "disabled", diagnostics: [] });
  });

  it("folds Skill metadata into category and namespace levels with two budgets", () => {
    const result = resolveCapabilitySkills({
      enabled: true,
      catalog: catalog(),
      budget,
    });

    expect(result.enabled).toBe(true);
    if (result.enabled !== true || result.mode === "invalid") {
      throw new Error("expected an enabled resolver result");
    }
    expect(result.candidates.every((candidate) => candidate.capabilityId.startsWith("skill:"))).toBe(true);
    expect(result.l0.entries.map((entry) => entry.category)).toEqual(["engineering", "operations"]);
    expect(result.l0.entries.every((entry) => entry.triggerKeywords.length === 4)).toBe(true);
    expect(result.l0.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ workflowNamespaceCount: 2, candidateCount: 2 }),
        expect.objectContaining({ workflowNamespaceCount: 1, candidateCount: 1 }),
      ]),
    );
    expect(JSON.stringify(result.l0.entries)).not.toContain("description");
    expect(result.l0.characterCount).toBeLessThanOrEqual(result.l0.characterBudget);
    expect(result.l0.entries.length).toBeLessThanOrEqual(budget.l0MaxEntries);
    expect(result.namespaces.map((entry) => entry.workflowNamespace)).toEqual([
      "engineering.release",
      "engineering.review",
      "operations.incident",
    ]);
    expect(result.candidates.map((entry) => entry.capabilityId)).toEqual([
      "skill:fixture:release-notes",
      "skill:fixture:code-review",
      "skill:fixture:incident-response",
    ]);
  });

  it("enforces the structural caps without truncating individual entries", () => {
    const characterLimited = resolveCapabilitySkills({
      enabled: true,
      catalog: catalog(),
      budget: {
        ...budget,
        contextWindowCharacters: 100,
        l0ContextWindowShare: 0.5,
        l0MaxEntries: 1,
      },
    });
    const entryLimited = resolveCapabilitySkills({
      enabled: true,
      catalog: catalog(),
      budget: {
        ...budget,
        l0MaxEntries: 1,
      },
    });

    expect(characterLimited.enabled).toBe(true);
    expect(entryLimited.enabled).toBe(true);
    if (
      characterLimited.enabled !== true ||
      characterLimited.mode === "invalid" ||
      entryLimited.enabled !== true ||
      entryLimited.mode === "invalid"
    ) {
      throw new Error("expected an enabled resolver result");
    }
    expect(characterLimited.l0.entries).toHaveLength(0);
    expect(characterLimited.l0.omittedCategoryCount).toBe(2);
    expect(characterLimited.l0.characterCount).toBe(0);
    expect(characterLimited.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "l0-character-budget-reached" })]),
    );
    expect(entryLimited.l0.entries).toHaveLength(1);
    expect(entryLimited.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "l0-entry-cap-reached" })]),
    );
  });

  it("bypasses retrieval only for a stable small catalog within explicit caps", () => {
    const snapshot = catalog();
    const direct = resolveCapabilitySkills({
      enabled: true,
      catalog: snapshot,
      budget,
      directProjection: {
        stable: true,
        maxCandidates: 3,
        maxCharacters: 10_000,
      },
    });
    const hierarchical = resolveCapabilitySkills({
      enabled: true,
      catalog: snapshot,
      budget,
      directProjection: {
        stable: false,
        maxCandidates: 3,
        maxCharacters: 10_000,
      },
    });

    expect(direct.enabled).toBe(true);
    expect(hierarchical.enabled).toBe(true);
    if (direct.enabled !== true || hierarchical.enabled !== true) {
      throw new Error("expected enabled results");
    }
    if (direct.mode !== "direct-projection" || hierarchical.mode !== "hierarchical") {
      throw new Error("expected direct-projection and hierarchical results");
    }
    expect(direct.candidates).toEqual(hierarchical.candidates);
    expect(direct.directProjectionCharacterCount).toBeGreaterThan(0);
  });

  it("keeps direct projection off when a catalog carries an error diagnostic", () => {
    const snapshot = catalog();
    const result = resolveCapabilitySkills({
      enabled: true,
      catalog: {
        ...snapshot,
        diagnostics: [
          ...snapshot.diagnostics,
          { code: "conflicting-owner", severity: "error", message: "conflict" },
        ],
      },
      budget,
      directProjection: { stable: true, maxCandidates: 3, maxCharacters: 10_000 },
    });

    expect(result.enabled).toBe(true);
    if (result.enabled !== true || result.mode === "invalid") {
      throw new Error("expected an enabled resolver result");
    }
    expect(result.mode).toBe("hierarchical");
  });

  it("ranks category, namespace, and candidates deterministically", () => {
    const first = resolveCapabilitySkills({ enabled: true, catalog: catalog(), budget });
    const second = resolveCapabilitySkills({
      enabled: true,
      catalog: buildCapabilityShadowCatalog([...CAPABILITY_REGISTRY_V3_FIXTURE_DESCRIPTORS].reverse()),
      budget,
    });

    expect(first).toEqual(second);
    if (first.enabled !== true || first.mode === "invalid") {
      throw new Error("expected an enabled resolver result");
    }
    const ranked = searchCapabilitySkills(first, "prepare release notes");
    expect(ranked.categories[0]?.category).toBe("engineering");
    expect(ranked.namespaces[0]?.workflowNamespace).toBe("engineering.release");
    expect(ranked.candidates[0]?.capabilityId).toBe("skill:fixture:release-notes");
  });

  it("records a reproducible three-level retrieval baseline", () => {
    const first = evaluateCapabilitySkillResolverBaseline();
    const second = evaluateCapabilitySkillResolverBaseline({
      descriptors: [...CAPABILITY_REGISTRY_V3_FIXTURE_DESCRIPTORS].reverse(),
    });

    expect(first).toEqual(second);
    expect(first).toEqual(
      expect.objectContaining({
        fixtureCount: 3,
        candidateCount: 3,
        recallAt1: {
          categoryAt1: 1,
          workflowNamespaceAt1: 1,
          capabilityAt1: 1,
        },
      }),
    );
    expect(first.l0CharacterCount).toBeLessThanOrEqual(first.l0CharacterBudget);
    expect(first.evaluationHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});
