/**
 * FP-P0-06: compile-checked exhaustive sample of `RuntimeFeatureConfig`.
 *
 * This is the type-side anchor of the config type / zod-schema parity guard
 * (tests/unit/config-schema-parity.test.ts at the repo root):
 *  - Every leaf that exists in the TS type MUST appear here, or `DeepRequired`
 *    makes this file fail to compile (covered by `pnpm lint:dcs` type-aware run).
 *  - Every leaf here MUST be accepted by the strict zod schema, or the parity
 *    test fails. That is the guard against the FP-P0-02 defect class where
 *    `runtime.contextEnhancement` existed in the type + labels/help but was
 *    rejected by zod-schema.ts, making the gateway exit code=1 on write.
 *
 * When you add a leaf to RuntimeFeatureConfig: this file stops compiling; add
 * the leaf here with a value that the zod schema accepts, and add the schema
 * leaf. There is no way to "fix" the guard without doing both — that is the point.
 */
import type { RuntimeFeatureConfig } from "./types.openclaw.js";

type DeepRequired<T> = T extends (infer U)[]
  ? DeepRequired<U>[]
  : T extends object
    ? { [K in keyof T]-?: DeepRequired<T[K]> }
    : T;

/**
 * Leaves that are intentionally present in the TS type but NOT validated by the
 * strict zod schema. Every entry needs a reason. Currently empty: after FP-P0-06
 * every typed runtime leaf is schema-accepted.
 */
export const SCHEMA_PARITY_INTENTIONAL_GAPS: ReadonlyArray<{ path: string; reason: string }> = [];

/** One sample value per leaf; values must satisfy the zod value constraints. */
export const RUNTIME_FEATURE_EXHAUSTIVE: DeepRequired<RuntimeFeatureConfig> = {
  verseShellFoundation: {
    killSwitch: false,
    verifiedRuntime: true,
    typedAci: true,
    facade: true,
    deferredOps: true,
    governedExec: true,
    artifactResults: true,
    mcpCompatibility: false,
    legacyEval: false,
    compatibilityNativeFallback: false,
    readOnlyShadow: true,
  },
  registryPilot: { enabled: true },
  providerRegistry: { shadow: true },
  contextProviders: { shadow: true, loopPackShadow: true, registryPilot: true },
  contextBlock: {
    "working-memory": { enabled: true },
    "tool-registry": { enabled: true },
    "compass": { enabled: true },
    "role-memory": { enabled: true },
    sekb: {
      enabled: true,
      shadowEvaluation: { enabled: true },
      batchDistillationAssistant: { enabled: true },
      phaseCWouldTrigger: {
        enabled: true,
        owner: "sekb-phase-c-would-trigger",
        timeoutMs: 5000,
      },
    },
  },
  coding: {
    factViews: { enabled: true },
    parseOnTouch: { enabled: true },
    staleWriteGuard: { enabled: true },
    writeJournal: { enabled: true },
    autoVerify: { enabled: true, timeoutSeconds: 30, command: "pnpm test" },
    worktree: { backend: "inprocess" },
    symbolLease: { enabled: true, mode: "memory" },
    patchFlow: { default: false, enabled: true },
    sekb: { enabled: true, experienceShadow: true },
    routingMemo: { shadow: true, enabled: true },
    verifier: { noSelfRepair: true },
  },
  contextRuntimeKit: { enabled: true, shadow: true },
  contextFamily: {
    observationMasking: { enabled: true, minChars: 2000, preserveNewestObservationCount: 2 },
    contextStatus: { enabled: true },
  },
  eventLog: { shadow: true, persist: true },
  checkpointSerializer: { shadow: true },
  resume: { replayShadow: true },
  toolRegistry: { shadow: true },
  registryDiagnostics: { collector: true },
  toolProtocol: { mcpShadow: true },
  toolGovernance: { destructiveOperationGuard: { preflight: { enabled: true } } },
  evidenceVerifier: { shadow: true },
  traceContext: { shadow: true, provider: true, propagation: true },
  memory: {
    shadow: true,
    provider: true,
    proposeFacts: true,
    persist: true,
    injectPilot: {
      enabled: true,
      providers: ["role-memory"],
      totalTokenBudget: 768,
      sessions: "main-only",
    },
  },
  contextEnhancement: { killSwitch: true },
  vtoken: {
    assembly: {
      enabled: true,
      budgetTokens: 600,
      renderMode: "compact",
      sessions: "all",
      timeoutMs: 12_000,
      maxSourceFiles: 12,
      maxSourceChars: 24_000,
    },
  },
  agentMap: {
    provider: true,
    promptAssemblyExperiment: true,
    promptCandidateRuntimeShadow: true,
    promptCandidateControlledCutoverPilot: true,
    promptCandidateTaskLoopExplicitInvocationPilot: true,
  },
  localControlPlane: {
    contextReport: true,
    modelRouterReport: true,
    capabilityReport: true,
    evidenceReport: true,
    missionReport: true,
  },
  orchestration: { routingMemoPilot: "shadow", handoffArtifacts: "on" },
  resilience: { anomalyClassifierPilot: "shadow" },
};

/** Dot-joined leaf paths of a plain-object sample tree (arrays are leaves). */
export function listLeafPaths(node: unknown, prefix = ""): string[] {
  if (node === null || typeof node !== "object" || Array.isArray(node)) {
    return prefix ? [prefix] : [];
  }
  const record = node as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0) return prefix ? [prefix] : [];
  return keys.flatMap((key) => listLeafPaths(record[key], prefix ? `${prefix}.${key}` : key));
}
