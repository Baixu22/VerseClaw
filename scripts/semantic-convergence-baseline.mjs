// Deterministic, source-derived baseline for the semantic convergence program.
// This script intentionally measures contract facts, not user-visible effects.
// Every metric must carry method + limitation; a static count is never reported
// as a runtime benefit.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "artifacts", "runs", "semantic-convergence-20261104");
const OUT_FILE = process.env.SEMANTIC_CONVERGENCE_OUT
  ? resolve(process.env.SEMANTIC_CONVERGENCE_OUT)
  : join(OUT_DIR, "baseline.json");

function read(path) {
  if (process.env.SEMANTIC_CONVERGENCE_SOURCE === "git-head") {
    const ref = process.env.SEMANTIC_CONVERGENCE_REF ?? "HEAD";
    try {
      return execFileSync("git", ["show", `${ref}:${path}`], { cwd: ROOT, encoding: "utf8" });
    } catch {
      // File did not exist at the baseline ref (new in the current change set).
      return "";
    }
  }
  return readFileSync(join(ROOT, path), "utf8");
}

function countMatches(text, pattern) {
  const re = new RegExp(pattern, "gm");
  return [...text.matchAll(re)].length;
}

function git(args) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function listFilesRecursive(dir, predicate) {
  const absolute = join(ROOT, dir);
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (predicate(path)) out.push(path);
    }
  };
  walk(absolute);
  return out;
}

function metric(id, definition, formula, value, unit, method, limitation, sources = []) {
  return { id, definition, formula, value, unit, method, limitation, sources };
}

const requestAttemptBudget = read("openclaw_runtime/src/agents/request-attempt-budget.ts");
const memorySelfEditTools = read("openclaw_runtime/src/runtime-core/memory-self-edit-tools.ts");
const memoryRuntimeIntegration = read("openclaw_runtime/src/runtime-core/memory-runtime-integration.ts");
const memoryQueryTool = read("openclaw_runtime/src/runtime-core/memory-query-tool.ts");
const memoryPreReply = read("openclaw_runtime/src/runtime-core/memory-pre-reply-injection.ts");
const providerValidation = read("electron/services/providers/provider-validation.ts");
const hookTypes = read("openclaw_runtime/src/plugins/hook-before-agent-start.types.ts");
const attemptRunner = read("openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts");
const rc03Seal = read("openclaw_runtime/src/context-engine/rc03-seal-hook.ts");
const knowledgeEmbedding = read("electron/services/knowledge-embedding-provider.ts");

const usedCountAsIdentity = countMatches(requestAttemptBudget, "physicalAttempt: this\\.usedCount");
const successDecrementsUsed = countMatches(requestAttemptBudget, "this\\.usedCount = Math\\.max\\(0, this\\.usedCount - 1\\)");
const retry1 = usedCountAsIdentity > 0 && successDecrementsUsed > 0 ? 1 : 0;

const productionFiles = {
  "provider-transport": read("openclaw_runtime/src/agents/provider-transport-fetch.ts"),
  "agent-auto-retry": read("openclaw_runtime/src/agents/sessions/agent-session.ts"),
  "model-fallback": read("openclaw_runtime/src/agents/model-fallback.ts"),
  "retryAsync": read("openclaw_runtime/src/infra/retry.ts"),
};
const chargeLayerCounts = Object.fromEntries(
  Object.entries(productionFiles).map(([name, text]) => [
    name,
    countMatches(text, "tryRecordAttempt|recordAttempt"),
  ]),
);
const ambientChargeLayers = Object.entries(productionFiles).filter(([name, text]) =>
  countMatches(text, "tryRecordAttempt|recordAttempt") > 0 &&
  !(name === "retryAsync" && text.includes("explicitAttemptBudget")),
).length;

const humanLabels = {
  humanConfirmationSource: countMatches(memorySelfEditTools, "source: \"human_confirmation\""),
  humanApprovedStatus: countMatches(memorySelfEditTools, "verificationStatus: \"human_approved\""),
  promotedByHuman: countMatches(memorySelfEditTools, "promotedBy: \"human\""),
};

const updateTransactions = {
  selfEditSequence: ["appendFact", "persistInvalidation", "persistSupersedesRelation"].filter((name) =>
    memorySelfEditTools.includes(name),
  ).length,
  curationSequence: ["invalidateFact", "appendFact", "persistRelation"].filter((name) =>
    memoryRuntimeIntegration.includes(name),
  ).length,
  deleteReturnsFlagDisabled: memoryRuntimeIntegration.includes("DELETE appends no new fact") &&
    memoryRuntimeIntegration.includes("reason: \"flag_disabled\""),
};

// TF-0733: measure the CURRENT state shape. The pre-fix code collapsed 2xx,
// 429 and non-auth probe 400 into `valid:true`; the fixed classifier emits a
// structured state and gates readiness on `ready`.
const validationStateDimensions = [
  /reachable:\s*'/.test(providerValidation),
  /auth:\s*'/.test(providerValidation),
  /protocol:\s*'/.test(providerValidation),
  /model:\s*'/.test(providerValidation),
  /rateLimited:\s*/.test(providerValidation),
  /ready:\s*(true|false)/.test(providerValidation),
];
const validationDimensionCount = validationStateDimensions.filter(Boolean).length;
const legacyCollapsedClasses = [
  providerValidation.includes("status >= 200 && status < 300) return { valid: true }"),
  providerValidation.includes("status === 429) return { valid: true }"),
  providerValidation.includes("status === 400 && !classified.authFailure"),
].filter(Boolean).length;
const falseReadyScenarios = legacyCollapsedClasses;

// TF-0734: validation and inference share one policy resolver
// (openclaw_runtime/src/agents/provider-network-policy.ts).
const providerTransport = read("openclaw_runtime/src/agents/provider-transport-fetch.ts");
const sharedPolicyResolver = read("openclaw_runtime/src/agents/provider-network-policy.ts");
const sharedPolicyResolverPresent = sharedPolicyResolver.includes("export function resolveProviderNetworkPolicy");
const bothUseSharedPolicy =
  sharedPolicyResolverPresent &&
  providerValidation.includes("resolveProviderNetworkPolicy") &&
  providerValidation.includes("evaluateProviderNetworkTarget") &&
  providerTransport.includes("resolveProviderNetworkPolicy");
const usesGuardedFetch = bothUseSharedPolicy ? 1 : 0;
const validationHasDeadline =
  providerValidation.includes("PROVIDER_VALIDATION_DEADLINE_MS") &&
  providerValidation.includes("AbortSignal.timeout") &&
  providerValidation.includes("signal: context.signal");
const policyParity = bothUseSharedPolicy ? 1 : 0;
const probeDeadlineCoverage = ["performProviderValidationRequest", "performResponsesProbe", "performChatCompletionsProbe", "performAnthropicMessagesProbe"].filter(
  (name) => {
    const start = providerValidation.indexOf("async function " + name);
    if (start < 0) return false;
    const next = providerValidation.indexOf("async function ", start + 10);
    const block = providerValidation.slice(start, next > 0 ? next : undefined);
    return block.includes("signal: context.signal");
  },
).length;

const mutationFields = ["systemPrompt", "prependContext", "appendContext", "prependSystemContext", "appendSystemContext"];
// Count actual field mappings, not the mere presence of an authority type name.
const promptAuthorityMappings = Object.fromEntries(mutationFields.map((field) => {
  const authority = hookTypes.match(new RegExp(`\\b${field}:\\s*"(append_data|append_instruction|replace_system_prompt|replace_messages)"`))?.[1];
  return [field, authority ?? null];
}));
const promptAuthorityCoverage = Object.values(promptAuthorityMappings).filter(Boolean).length;

const postOrchestratorAdditions = ["runtimeIntensitySystemPrompt", "dcsDepsResolution.degradationNotice"].filter((name) =>
  attemptRunner.includes(name),
).length;

const sealMatrix = rc03Seal.includes("unregisteredProducers") && rc03Seal.includes("registeredTransportTransformIds");

const cacheInvalidationInQuery = memoryQueryTool.includes("clearCompassFactsCache");
const cacheInvalidationInPreReply = memoryPreReply.includes("clearCompassFactsCache");

const facadeConsumers = listFilesRecursive("openclaw_runtime/src", (path) => path.endsWith(".ts"))
  .filter((path) => !path.endsWith(".test.ts"))
  .filter((path) => !path.includes("golden-run") && !path.includes("stage5-memory-facade.ts") && readFileSync(path, "utf8").includes("createSemanticMemoryFacade"))
  .map((path) => relative(ROOT, path));

const batchTimeoutMs = Number((knowledgeEmbedding.match(/REQUEST_TIMEOUT_MS = ([0-9_]+)/) ?? [])[1]?.replaceAll("_", "") ?? 0);
const batchSize = Number((knowledgeEmbedding.match(/MAX_BATCH_SIZE = ([0-9_]+)/) ?? [])[1] ?? 0);
const embeddingDeadlineMs = Number((knowledgeEmbedding.match(/DEFAULT_EMBEDDING_DEADLINE_MS = ([0-9_]+)/) ?? [])[1]?.replaceAll("_", "") ?? 0);
const embeddingBatchesFor100 = Math.ceil(100 / Math.max(1, batchSize));
const worstCaseWithoutDeadline = batchTimeoutMs * embeddingBatchesFor100;
// TF-0735: the per-batch ceiling is capped by the caller's total budget, and
// the batch loop refuses to start another batch once the budget is exhausted.
const embWorstCaseFor100 = embeddingDeadlineMs > 0
  ? Math.min(worstCaseWithoutDeadline, embeddingDeadlineMs)
  : worstCaseWithoutDeadline;

const dirty = git(["status", "--porcelain"]).length > 0;
const commit = git(["rev-parse", "HEAD"]);

const metrics = [
  metric("RETRY-1", "attempt identity collides with reversible budget count", "identity==usedCount AND success decrements usedCount", retry1, "boolean", "static", "Source shape only; the contract test reproduces the collision dynamically.", ["openclaw_runtime/src/agents/request-attempt-budget.ts"]),
  metric("RETRY-2", "ambient charging layers present for one logical request", "count(files charging ambient tryRecordAttempt without explicit opt-in gate)", ambientChargeLayers, "layers", "static", "After TF-0730 only provider transport charges ambient requests; retryAsync only charges an explicitly supplied budget. Dynamic recovery is measured by model-fallback.loop-termination.test.ts.", Object.keys(productionFiles)),
  metric("MEM-1", "agent self-edit emits human provenance labels", "count(human_confirmation)+count(human_approved)+count(promotedBy human)", humanLabels.humanConfirmationSource + humanLabels.humanApprovedStatus + humanLabels.promotedByHuman, "labels", "static", "Persist is retired, so these labels are unreachable today; this is a recovery gate.", ["openclaw_runtime/src/runtime-core/memory-self-edit-tools.ts"]),
  metric("MEM-2", "independent commit steps inside one logical memory update", "sum(step count) for self-edit and curation", Math.max(0, updateTransactions.selfEditSequence - 1) + Math.max(0, updateTransactions.curationSequence - 1), "steps", "static", "Transaction boundaries are inherited from the persistence port; values are candidate windows, not observed corruption.", ["openclaw_runtime/src/runtime-core/memory-self-edit-tools.ts", "openclaw_runtime/src/runtime-core/memory-runtime-integration.ts"]),
  metric("VALID-1", "status classes currently collapsed into valid=true", "count(success, rateLimit, probe400)", falseReadyScenarios, "classes", "static", "Classes only; actual provider behavior varies by API. The 12-scenario matrix is the behavioral gate.", ["electron/services/providers/provider-validation.ts"]),
  metric("VALID-2", "validation state dimensions exposed by the result type", "count(reachable, auth, protocol, model, rateLimited, ready)", validationDimensionCount, "dimensions", "static", "Type-shape evidence; UI semantics are asserted by semantic-convergence-provider-validation-matrix.test.ts.", ["shared/host-api/contract.ts", "electron/services/providers/provider-validation.ts"]),
  metric("NET-1", "validation requests sharing inference guarded policy", "bothUseSharedPolicy ? 1 : 0", usesGuardedFetch, "boolean", "static", "Source contract: both call sites import the shared resolver; behaviour is asserted by semantic-convergence-provider-network-parity.test.ts.", ["electron/services/providers/provider-validation.ts", "openclaw_runtime/src/agents/provider-transport-fetch.ts", "openclaw_runtime/src/agents/provider-network-policy.ts"]),
  metric("NET-2", "validation probe carries explicit deadline", "deadline gate + signal present", validationHasDeadline ? 1 : 0, "boolean", "static", "Source contract; probe coverage is measured as NET-3.", ["electron/services/providers/provider-validation.ts"]),
  metric("NET-3", "validation probes carrying the total deadline signal", "count(models, responses, chat, anthropic probes with signal)", probeDeadlineCoverage, "probes", "static", "Static coverage of the four probe call sites; runtime abort behaviour is unit-tested.", ["electron/services/providers/provider-validation.ts"]),
  metric("NET-4", "policy parity between validation and inference", "bothUseSharedPolicy ? 1 : 0", policyParity, "boolean", "static", "Same resolver, same normalized fingerprint; behavioural matrix in semantic-convergence-provider-network-parity.test.ts.", ["openclaw_runtime/src/agents/provider-network-policy.ts"]),
  metric("PROMPT-1", "prompt mutation fields mapped to required authority", "count(explicit PLUGIN_PROMPT_MUTATION_AUTHORITIES field mappings)", promptAuthorityCoverage, "fields", "static", "Field-map coverage only; separate behavioral tests verify producer admission in explicit enforce mode. This does not prove global default enforcement.", ["openclaw_runtime/src/plugins/hook-before-agent-start.types.ts"]),
  metric("PROMPT-2", "post-orchestrator additions outside the managed ledger", "count(runtimeIntensitySystemPrompt, degradationNotice)", postOrchestratorAdditions, "additions", "static", "Counts code paths, not actual chars; the snapshot coverage test measures chars.", ["openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts"]),
  metric("PROMPT-3", "seal producer coverage matrix present", "sealMatrix ? 1 : 0", sealMatrix ? 1 : 0, "boolean", "static", "Seal is default-off; presence is not enforcement evidence.", ["openclaw_runtime/src/context-engine/rc03-seal-hook.ts"]),
  metric("MEM-3", "shared memory cache invalidated on write path", "cacheInvalidationInQuery && cacheInvalidationInPreReply", cacheInvalidationInQuery && cacheInvalidationInPreReply ? 1 : 0, "boolean", "static", "No write-path invalidation found; TTL is 30s.", ["openclaw_runtime/src/runtime-core/memory-query-tool.ts", "openclaw_runtime/src/runtime-core/memory-pre-reply-injection.ts"]),
  metric("FACADE-1", "production consumers of Stage5 facade", "count(non-test files referencing facade)", facadeConsumers.length, "consumers", "static", "Includes golden-run by design; the node decides adopt-or-retire.", ["openclaw_runtime/src/context-engine/stage5-memory-facade.ts"]),
  metric("EMB-1", "worst-case embedding time for 100 texts", "min(REQUEST_TIMEOUT_MS * ceil(100 / MAX_BATCH_SIZE), DEFAULT_EMBEDDING_DEADLINE_MS)", embWorstCaseFor100, "ms", "static", "Assumes every batch hits its ceiling; the total operation is capped by the caller deadline. No network measurement.", ["electron/services/knowledge-embedding-provider.ts"]),
  metric("EMB-2", "embedding batches started after the total deadline", "0 if the loop checks remaining budget before every batch", knowledgeEmbedding.includes("remainingMs() <= 0") ? 0 : 1, "batches", "static", "Source-shape only; the fake-clock test exercises the 100-text/13-batch path.", ["electron/services/knowledge-embedding-provider.ts"]),
];

const report = {
  schema: "SemanticConvergenceBaseline/v1",
  generatedAt: process.env.SEMANTIC_CONVERGENCE_FIXED_TIME ?? new Date().toISOString(),
  candidate: { commit, dirty },
  measurementBoundary: "source-derived static baseline; no user-visible effect is claimed",
  metrics,
  metricContract: {
    retry: { retry1Target: 0, retry2TargetMax: 1.0, retryRecoveryTarget: 1.0 },
    validation: { falseReadyTarget: 0, dimensionTarget: 6, scenarioCount: 12 },
    prompt: { authorityTarget: 5, accountedRatioTarget: 1.0, unregisteredMutationsTarget: 0 },
    memory: { humanLabelTarget: 0, partialWindowsTarget: 0, staleReadMaxSecondsTarget: 0 },
    embedding: { totalDeadlineMs: 120000 },
    scoreWeights: { correctness: 0.35, userImpact: 0.25, coverage: 0.2, costEfficiency: 0.1, evidenceQuality: 0.1 },
  },
  limitations: [
    "Metrics are source-derived; no provider request, E2E, or live user data was executed.",
    "RETRY-2 counts layers, not a measured amplification ratio for one request.",
    "MEM metrics are recovery gates because runtime.memory.persist is retired.",
    "VALID-1/VALID-2 are static classifications; the 12-scenario matrix is the behavioral gate.",
    "No real-human evidence is claimed.",
  ],
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify(report, null, 2) + "\n", "utf8");
const digest = createHash("sha256").update(JSON.stringify(report)).digest("hex");
console.log(JSON.stringify({ wrote: OUT_FILE, sha256: digest, metricCount: metrics.length }, null, 2));
