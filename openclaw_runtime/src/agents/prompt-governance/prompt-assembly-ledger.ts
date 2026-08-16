// PromptAssemblyLedger: append-only, process-local evidence for prompt mutations.
//
// It records WHO changed the final prompt, not the raw prompt text. Callers
// provide hashes/char counts only; raw prompt storage remains forbidden.

import { createHash } from "node:crypto";
import {
  assertPromptSourceCatalogHealthy,
  getPromptSourceCatalogEntry,
  RUNTIME_INTENSITY_HARNESS_BEHAVIOR_SOURCE,
  RUNTIME_INTENSITY_PROMPT_SOURCE,
  type PromptSourceCatalogIssue,
} from "./prompt-source-catalog.js";
import type { RuntimeIntensityPolicy } from "../intensity-policy.js";
import type { PromptMode } from "../system-prompt.types.js";

export type PromptAssemblyLedgerEntry = {
  sequence: number;
  contributionId: string;
  kind: "prompt-text" | "prompt-mode-mutation" | "behavior-policy";
  source: string;
  chars: number;
  beforeHash?: string;
  afterHash?: string;
  requestedReasoning?: string;
  effectiveReasoning?: string;
  requestedIntensity?: string;
  effectiveIntensity?: string;
  intensitySource?: "explicit" | "legacy-thinking-level";
  couplingMode?: "linked-v1";
  policyAdherence?: "full" | "prompt-only";
};

const ledger: PromptAssemblyLedgerEntry[] = [];
let sequenceCounter = 0;

export function sha256PromptText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function listPromptAssemblyLedger(): PromptAssemblyLedgerEntry[] {
  return ledger.map((entry) => ({ ...entry }));
}

export function clearPromptAssemblyLedgerForTests(): void {
  ledger.length = 0;
  sequenceCounter = 0;
}

function appendLedgerEntry(entry: Omit<PromptAssemblyLedgerEntry, "sequence">): PromptAssemblyLedgerEntry {
  const record = { ...entry, sequence: sequenceCounter++ };
  ledger.push(record);
  return record;
}

export type ValidatePromptAssemblyLedgerResult = {
  entries: PromptAssemblyLedgerEntry[];
  catalogIssues: PromptSourceCatalogIssue[];
  unregisteredContributions: string[];
};

/** Checks that every ledgered contribution is registered in the source catalog. */
export function validatePromptAssemblyLedger(): ValidatePromptAssemblyLedgerResult {
  const catalogIssues = (() => {
    try {
      assertPromptSourceCatalogHealthy();
      return [] as PromptSourceCatalogIssue[];
    } catch (error) {
      return [
        {
          id: "prompt-source-catalog",
          reason: error instanceof Error ? error.message : String(error),
        },
      ] as PromptSourceCatalogIssue[];
    }
  })();
  const unregisteredContributions = [
    ...new Set(
      ledger
        .map((entry) => entry.contributionId)
        .filter((id) => getPromptSourceCatalogEntry(id) === undefined),
    ),
  ];
  return {
    entries: listPromptAssemblyLedger(),
    catalogIssues,
    unregisteredContributions,
  };
}

export type RuntimeIntensityLedgerInput = {
  systemPrompt: string;
  promptMode: PromptMode;
  policy: RuntimeIntensityPolicy;
  requestedReasoning?: string;
  effectiveReasoning?: string;
  requestedIntensity?: string;
  effectiveIntensity?: string;
  intensitySource?: "explicit" | "legacy-thinking-level";
  policyAdherence?: "full" | "prompt-only";
};

/**
 * Records the runtime-intensity prompt text and behavior-policy mutations for
 * one assembled system prompt. Raw prompt text is hashed, never stored.
 */
export function recordRuntimeIntensityLedgerEntries(
  params: RuntimeIntensityLedgerInput,
): PromptAssemblyLedgerEntry[] {
  assertPromptSourceCatalogHealthy();

  const promptSource = getPromptSourceCatalogEntry(RUNTIME_INTENSITY_PROMPT_SOURCE);
  const promptChars = params.policy.systemPromptLines.join(" ").length;
  if (promptSource && promptChars > promptSource.budgetChars) {
    throw new Error(
      `${RUNTIME_INTENSITY_PROMPT_SOURCE} over budget: ${promptChars} > ${promptSource.budgetChars}`,
    );
  }

  const intensityBlock =
    params.policy.systemPromptLines.length > 0
      ? ["## Runtime Intensity", ...params.policy.systemPromptLines].join("\n")
      : "";
  const withoutIntensityText = intensityBlock
    ? params.systemPrompt.replace(intensityBlock, "").trim()
    : params.systemPrompt;
  const common = {
    source: "attempt.ts",
    beforeHash: sha256PromptText(withoutIntensityText),
    afterHash: sha256PromptText(params.systemPrompt),
    requestedReasoning: params.requestedReasoning,
    effectiveReasoning: params.effectiveReasoning,
    requestedIntensity: params.requestedIntensity,
    effectiveIntensity: params.effectiveIntensity,
    intensitySource: params.intensitySource,
    couplingMode: "linked-v1" as const,
    policyAdherence: params.policyAdherence,
  };

  const entries: PromptAssemblyLedgerEntry[] = [];
  if (params.policy.systemPromptLines.length > 0) {
    entries.push(
      appendLedgerEntry({
        ...common,
        contributionId: RUNTIME_INTENSITY_PROMPT_SOURCE,
        kind: "prompt-text",
        chars: promptChars,
      }),
    );
  }
  if (params.policy.promptMode !== "preserve") {
    entries.push(
      appendLedgerEntry({
        ...common,
        contributionId: RUNTIME_INTENSITY_PROMPT_SOURCE,
        kind: "prompt-mode-mutation",
        chars: 0,
      }),
    );
  }
  entries.push(
    appendLedgerEntry({
      ...common,
      contributionId: RUNTIME_INTENSITY_HARNESS_BEHAVIOR_SOURCE,
      kind: "behavior-policy",
      chars: 0,
    }),
  );
  return entries;
}
