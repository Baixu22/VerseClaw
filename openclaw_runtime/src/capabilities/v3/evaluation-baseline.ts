import {
  adaptContextCapability,
  adaptSkillCapability,
  adaptToolCapability,
  type CapabilityAdapterResult,
} from "./adapters.js";
import {
  hashCapabilityDescriptor,
  hashCapabilityMetadata,
  type CapabilityDescriptor,
} from "./capability-descriptor.js";
import { buildCapabilityShadowCatalog } from "./shadow-catalog.js";

export type CapabilityRegistryEvaluationFixture = {
  id: string;
  query: string;
  expected: {
    category: string;
    workflowNamespace: string;
    capabilityId: string;
  };
};

export type CapabilityRegistryRecall = {
  categoryAt1: number;
  workflowNamespaceAt1: number;
  capabilityAt1: number;
};

export type CapabilityRegistryEvaluationBaseline = {
  schemaVersion: "capability-registry-v3-evaluation-baseline/v1";
  fixtureCount: number;
  descriptorCount: number;
  directProjectionCharacterCount: number;
  directProjectionEstimatedTokens: number;
  directProjectionHash: string;
  recallAt1: CapabilityRegistryRecall;
  catalogSnapshotHash: string;
};

const FIXTURE_SOURCE = {
  owner: "fixture",
  type: "static",
  provenance: "capability-registry-v3-v3-00",
} as const;

function requireDescriptor(result: CapabilityAdapterResult): CapabilityDescriptor {
  if (!result.descriptor) {
    throw new Error(`invalid capability fixture: ${result.diagnostics.map((item) => item.message).join(", ")}`);
  }
  return result.descriptor;
}

/** Redacted hand-authored metadata for V3-00 comparison only. */
export const CAPABILITY_REGISTRY_V3_FIXTURE_DESCRIPTORS: readonly CapabilityDescriptor[] = [
  requireDescriptor(
    adaptSkillCapability({
      name: "release-notes",
      title: "Release Notes",
      description: "Prepare release notes from verified changes.",
      triggerKeywords: ["release", "notes", "changelog"],
      category: "engineering",
      workflowNamespace: "engineering.release",
      source: FIXTURE_SOURCE,
    }),
  ),
  requireDescriptor(
    adaptSkillCapability({
      name: "code-review",
      title: "Code Review",
      description: "Review a bounded code change for regressions and risks.",
      triggerKeywords: ["review", "regression", "risk"],
      category: "engineering",
      workflowNamespace: "engineering.review",
      source: FIXTURE_SOURCE,
    }),
  ),
  requireDescriptor(
    adaptSkillCapability({
      name: "incident-response",
      title: "Incident Response",
      description: "Guide a controlled incident investigation workflow.",
      triggerKeywords: ["incident", "outage", "mitigation"],
      category: "operations",
      workflowNamespace: "operations.incident",
      source: FIXTURE_SOURCE,
    }),
  ),
  requireDescriptor(
    adaptToolCapability({
      name: "workspace-search",
      title: "Workspace Search",
      description: "Search the current workspace for relevant files and symbols.",
      triggerKeywords: ["search", "files", "symbols"],
      category: "engineering",
      workflowNamespace: "engineering.discovery",
      source: FIXTURE_SOURCE,
      schemaHash: hashCapabilityMetadata({ type: "object", operation: "workspace-search" }),
    }),
  ),
  requireDescriptor(
    adaptToolCapability({
      name: "workspace-read",
      title: "Workspace Read",
      description: "Read a selected workspace file through the existing runtime.",
      triggerKeywords: ["read", "file", "workspace"],
      category: "engineering",
      workflowNamespace: "engineering.discovery",
      source: FIXTURE_SOURCE,
      schemaHash: hashCapabilityMetadata({ type: "object", operation: "workspace-read" }),
    }),
  ),
  requireDescriptor(
    adaptToolCapability({
      name: "session-status",
      title: "Session Status",
      description: "Inspect existing session state and runtime status.",
      triggerKeywords: ["session", "status", "runtime"],
      category: "operations",
      workflowNamespace: "operations.sessions",
      source: FIXTURE_SOURCE,
      schemaHash: hashCapabilityMetadata({ type: "object", operation: "session-status" }),
    }),
  ),
  requireDescriptor(
    adaptContextCapability({
      id: "task-state",
      title: "Task State",
      description: "Current task state supplied by its existing owner.",
      triggerKeywords: ["task", "state", "progress"],
      category: "operations",
      workflowNamespace: "operations.tasks",
      source: FIXTURE_SOURCE,
    }),
  ),
  requireDescriptor(
    adaptContextCapability({
      id: "run-receipt",
      title: "Run Receipt",
      description: "Execution receipt metadata supplied by its existing owner.",
      triggerKeywords: ["receipt", "run", "evidence"],
      category: "operations",
      workflowNamespace: "operations.observability",
      source: FIXTURE_SOURCE,
    }),
  ),
  requireDescriptor(
    adaptContextCapability({
      id: "knowledge-index",
      title: "Knowledge Index",
      description: "Read-only knowledge index metadata supplied by its owner.",
      triggerKeywords: ["knowledge", "research", "reference"],
      category: "knowledge",
      workflowNamespace: "knowledge.research",
      source: FIXTURE_SOURCE,
    }),
  ),
];

export const CAPABILITY_REGISTRY_V3_EVALUATION_FIXTURES: readonly CapabilityRegistryEvaluationFixture[] = [
  {
    id: "v3-01",
    query: "Prepare release notes for verified changes.",
    expected: {
      category: "engineering",
      workflowNamespace: "engineering.release",
      capabilityId: "skill:fixture:release-notes",
    },
  },
  {
    id: "v3-02",
    query: "Review this patch for a regression.",
    expected: {
      category: "engineering",
      workflowNamespace: "engineering.review",
      capabilityId: "skill:fixture:code-review",
    },
  },
  {
    id: "v3-03",
    query: "Find a workspace symbol before editing it.",
    expected: {
      category: "engineering",
      workflowNamespace: "engineering.discovery",
      capabilityId: "tool:fixture:workspace-search",
    },
  },
  {
    id: "v3-04",
    query: "Read the selected workspace file.",
    expected: {
      category: "engineering",
      workflowNamespace: "engineering.discovery",
      capabilityId: "tool:fixture:workspace-read",
    },
  },
  {
    id: "v3-05",
    query: "Show the current task progress.",
    expected: {
      category: "operations",
      workflowNamespace: "operations.tasks",
      capabilityId: "context:fixture:task-state",
    },
  },
  {
    id: "v3-06",
    query: "Inspect the run receipt for this work.",
    expected: {
      category: "operations",
      workflowNamespace: "operations.observability",
      capabilityId: "context:fixture:run-receipt",
    },
  },
  {
    id: "v3-07",
    query: "Check the current session status.",
    expected: {
      category: "operations",
      workflowNamespace: "operations.sessions",
      capabilityId: "tool:fixture:session-status",
    },
  },
  {
    id: "v3-08",
    query: "Investigate an incident with a controlled response.",
    expected: {
      category: "operations",
      workflowNamespace: "operations.incident",
      capabilityId: "skill:fixture:incident-response",
    },
  },
  {
    id: "v3-09",
    query: "Find governed knowledge for research.",
    expected: {
      category: "knowledge",
      workflowNamespace: "knowledge.research",
      capabilityId: "context:fixture:knowledge-index",
    },
  },
];

function renderDirectProjection(descriptor: CapabilityDescriptor): string {
  return [
    descriptor.capabilityId,
    descriptor.kind,
    descriptor.category,
    descriptor.workflowNamespace,
    descriptor.title,
    descriptor.description,
    descriptor.triggerKeywords.join(","),
    descriptor.revision,
    descriptor.manifestHash,
    descriptor.schemaHash ?? "",
    descriptor.source.owner,
    descriptor.source.type,
    descriptor.source.provenance,
  ].join("|");
}

function queryTokens(value: string): string[] {
  const stopWords = new Set([
    "a",
    "an",
    "and",
    "before",
    "current",
    "for",
    "from",
    "in",
    "is",
    "it",
    "of",
    "on",
    "the",
    "this",
    "to",
    "with",
  ]);
  return value
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.map((token) => (token.endsWith("s") && token.length > 3 ? token.slice(0, -1) : token))
    .filter((token) => token.length > 2 && !stopWords.has(token)) ?? [];
}

function descriptorTokens(descriptor: CapabilityDescriptor): Set<string> {
  return new Set(
    queryTokens(
      [
        descriptor.title,
        descriptor.description,
        ...descriptor.triggerKeywords,
      ].join(" "),
    ),
  );
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function rankDescriptors(query: string, descriptors: readonly CapabilityDescriptor[]): CapabilityDescriptor[] {
  const tokens = queryTokens(query);
  return descriptors
    .map((descriptor) => {
      const available = descriptorTokens(descriptor);
      const matched = tokens.filter((token) => available.has(token));
      const phrase = query.trim().toLowerCase();
      const searchableText = [descriptor.title, descriptor.description, ...descriptor.triggerKeywords]
        .join(" ")
        .toLowerCase();
      return {
        descriptor,
        score: matched.length + (phrase && searchableText.includes(phrase) ? tokens.length : 0),
      };
    })
    .toSorted(
      (left, right) =>
        right.score - left.score || compareStrings(left.descriptor.capabilityId, right.descriptor.capabilityId),
    )
    .map((entry) => entry.descriptor);
}

/**
 * Records a reproducible direct-projection baseline. Its token value is a
 * character heuristic, not a provider token or latency measurement.
 */
export function evaluateCapabilityRegistryV3Baseline(
  fixtures: readonly CapabilityRegistryEvaluationFixture[] = CAPABILITY_REGISTRY_V3_EVALUATION_FIXTURES,
  descriptors: readonly CapabilityDescriptor[] = CAPABILITY_REGISTRY_V3_FIXTURE_DESCRIPTORS,
): CapabilityRegistryEvaluationBaseline {
  const catalog = buildCapabilityShadowCatalog(descriptors);
  const directProjection = catalog.descriptors.map(renderDirectProjection).join("\n");
  const rankedFixtures = fixtures.map((fixture) => ({
    fixture,
    top: rankDescriptors(fixture.query, catalog.descriptors)[0],
  }));
  const categoryAt1 = rankedFixtures.filter(
    ({ fixture, top }) => top?.category === fixture.expected.category,
  ).length / Math.max(fixtures.length, 1);
  const workflowNamespaceAt1 = rankedFixtures.filter(
    ({ fixture, top }) => top?.workflowNamespace === fixture.expected.workflowNamespace,
  ).length / Math.max(fixtures.length, 1);
  const capabilityAt1 = rankedFixtures.filter(
    ({ fixture, top }) => top?.capabilityId === fixture.expected.capabilityId,
  ).length / Math.max(fixtures.length, 1);
  return {
    schemaVersion: "capability-registry-v3-evaluation-baseline/v1",
    fixtureCount: fixtures.length,
    descriptorCount: catalog.descriptors.length,
    directProjectionCharacterCount: directProjection.length,
    directProjectionEstimatedTokens: directProjection ? Math.ceil(directProjection.length / 4) : 0,
    directProjectionHash: hashCapabilityMetadata(
      catalog.descriptors.map((descriptor) => hashCapabilityDescriptor(descriptor)),
    ),
    recallAt1: { categoryAt1, workflowNamespaceAt1, capabilityAt1 },
    catalogSnapshotHash: catalog.snapshotHash,
  };
}
