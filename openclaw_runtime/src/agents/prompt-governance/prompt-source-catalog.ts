// PromptSourceCatalog: single registry for runtime-owned prompt contributions.
//
// This is the lightweight PCS-v1.2 source of truth for intensity-related
// prompt surfaces. It does not own the prompt itself; system-prompt.ts and
// intensity-policy.ts remain the producers.

export type PromptLayer = "L0-capability" | "L4-dynamic";
export type PromptCachePlacement = "stable-prefix" | "dynamic" | "none";
export type PromptSourceKind = "prompt-text" | "runtime-policy";
export type PromptReducerKind = "none" | "truncate" | "compact";

export type PromptSourceEntry = {
  id: string;
  owner: string;
  layer: PromptLayer;
  kind: PromptSourceKind;
  cachePlacement: PromptCachePlacement;
  /** Maximum rendered chars. Runtime text contributions are rejected when over budget. */
  budgetChars: number;
  reducer: PromptReducerKind;
  enforcementRefs: string[];
};

export const RUNTIME_INTENSITY_PROMPT_SOURCE = "runtime.intensity.prompt";
export const RUNTIME_INTENSITY_HARNESS_BEHAVIOR_SOURCE = "runtime.intensity.harness_behavior";

const DEFAULT_ENTRIES: PromptSourceEntry[] = [
  {
    id: RUNTIME_INTENSITY_PROMPT_SOURCE,
    owner: "intensity-policy.ts",
    layer: "L4-dynamic",
    kind: "prompt-text",
    cachePlacement: "dynamic",
    budgetChars: 400,
    reducer: "none",
    enforcementRefs: [
      "openclaw_runtime/src/agents/intensity-policy.ts",
      "openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts",
    ],
  },
  {
    id: RUNTIME_INTENSITY_HARNESS_BEHAVIOR_SOURCE,
    owner: "intensity-policy.ts",
    layer: "L4-dynamic",
    kind: "runtime-policy",
    cachePlacement: "none",
    budgetChars: 0,
    reducer: "none",
    enforcementRefs: [
      "openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts",
      "openclaw_runtime/src/skills/loading/workspace.ts",
      "openclaw_runtime/src/agents/embedded-agent-runner/tool-result-truncation.ts",
      "openclaw_runtime/src/agents/embedded-agent-runner/tool-result-context-guard.ts",
    ],
  },
];

const registry = new Map<string, PromptSourceEntry>(DEFAULT_ENTRIES.map((entry) => [entry.id, entry]));

export function listPromptSourceCatalog(): PromptSourceEntry[] {
  return [...registry.values()].map((entry) => ({ ...entry }));
}

export function getPromptSourceCatalogEntry(id: string): PromptSourceEntry | undefined {
  const entry = registry.get(id);
  return entry ? { ...entry } : undefined;
}

export function registerPromptSourceCatalogEntry(entry: PromptSourceEntry): void {
  if (entry.budgetChars < 0 || !Number.isInteger(entry.budgetChars)) {
    throw new Error(`invalid prompt source budget for ${entry.id}`);
  }
  registry.set(entry.id, { ...entry });
}

export type PromptSourceCatalogIssue = {
  id: string;
  reason: string;
};

/** Validates that every runtime-owned prompt contribution is registered and bounded. */
export function validatePromptSourceCatalog(): PromptSourceCatalogIssue[] {
  const issues: PromptSourceCatalogIssue[] = [];
  for (const entry of registry.values()) {
    if (!entry.id || !entry.owner || entry.enforcementRefs.length === 0) {
      issues.push({ id: entry.id, reason: "incomplete source registration" });
    }
    if (entry.kind === "prompt-text" && entry.budgetChars <= 0) {
      issues.push({ id: entry.id, reason: "prompt-text source must have a positive budget" });
    }
    if (entry.reducer !== "none") {
      issues.push({ id: entry.id, reason: "intensity prompt sources must not use runtime reducers" });
    }
  }
  return issues;
}

/** Fail-closed guard for producers that contribute under the intensity catalog. */
export function assertPromptSourceCatalogHealthy(): void {
  const issues = validatePromptSourceCatalog();
  if (issues.length > 0) {
    throw new Error(`prompt source catalog invalid: ${issues.map((issue) => `${issue.id}: ${issue.reason}`).join("; ")}`);
  }
}
