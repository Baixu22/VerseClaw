import {
  CAPABILITY_REGISTRY_V3_EVALUATION_FIXTURES,
  CAPABILITY_REGISTRY_V3_FIXTURE_DESCRIPTORS,
  type CapabilityRegistryRecall,
} from "./evaluation-baseline.js";
import { hashCapabilityMetadata, type CapabilityDescriptor } from "./capability-descriptor.js";
import {
  resolveCapabilitySkills,
  searchCapabilitySkills,
  type CapabilitySkillResolverBudget,
} from "./skill-resolver.js";
import { buildCapabilityShadowCatalog } from "./shadow-catalog.js";

export const CAPABILITY_REGISTRY_V3_SKILL_FIXTURE_BUDGET = {
  contextWindowCharacters: 2_000,
  l0ContextWindowShare: 0.25,
  l0MaxEntries: 8,
  l0MaxTriggerKeywordsPerEntry: 4,
} satisfies CapabilitySkillResolverBudget;

export type CapabilitySkillResolverEvaluationBaseline = {
  schemaVersion: "capability-skill-resolver-evaluation/v1";
  fixtureCount: number;
  candidateCount: number;
  l0CharacterBudget: number;
  l0CharacterCount: number;
  directProjectionCharacterCount: number;
  recallAt1: CapabilityRegistryRecall;
  resolverHash: string;
  evaluationHash: string;
};

/**
 * Static V3-02 retrieval comparison. Character counts are deterministic text
 * measurements; Recall values describe only the hand-authored fixture corpus.
 */
export function evaluateCapabilitySkillResolverBaseline(params: {
  descriptors?: readonly CapabilityDescriptor[];
  budget?: CapabilitySkillResolverBudget;
} = {}): CapabilitySkillResolverEvaluationBaseline {
  const descriptors = params.descriptors ?? CAPABILITY_REGISTRY_V3_FIXTURE_DESCRIPTORS;
  const fixtures = CAPABILITY_REGISTRY_V3_EVALUATION_FIXTURES.filter((fixture) =>
    fixture.expected.capabilityId.startsWith("skill:"),
  );
  const result = resolveCapabilitySkills({
    enabled: true,
    catalog: buildCapabilityShadowCatalog(descriptors),
    budget: params.budget ?? CAPABILITY_REGISTRY_V3_SKILL_FIXTURE_BUDGET,
  });
  if (result.enabled !== true || result.mode === "invalid") {
    throw new Error(
      `invalid Skill resolver baseline: ${result.diagnostics.map((entry) => entry.message).join(", ")}`,
    );
  }

  const ranked = fixtures.map((fixture) => ({
    fixture,
    top: searchCapabilitySkills(result, fixture.query),
  }));
  const denominator = Math.max(fixtures.length, 1);
  const recallAt1 = {
    categoryAt1:
      ranked.filter(({ fixture, top }) => top.categories[0]?.category === fixture.expected.category)
        .length / denominator,
    workflowNamespaceAt1:
      ranked.filter(
        ({ fixture, top }) =>
          top.namespaces[0]?.workflowNamespace === fixture.expected.workflowNamespace,
      ).length / denominator,
    capabilityAt1:
      ranked.filter(
        ({ fixture, top }) => top.candidates[0]?.capabilityId === fixture.expected.capabilityId,
      ).length / denominator,
  };
  const measurement = {
    schemaVersion: "capability-skill-resolver-evaluation/v1" as const,
    fixtureCount: fixtures.length,
    candidateCount: result.candidates.length,
    l0CharacterBudget: result.l0.characterBudget,
    l0CharacterCount: result.l0.characterCount,
    directProjectionCharacterCount: result.directProjectionCharacterCount,
    recallAt1,
    resolverHash: result.resolverHash,
  };
  return {
    ...measurement,
    evaluationHash: hashCapabilityMetadata(measurement),
  };
}
