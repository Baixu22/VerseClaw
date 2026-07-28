import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ACTUAL_USAGE_SOURCES = new Set([
  "anthropic-response-usage",
  "openai-response-usage",
  "provider-billing-export",
]);
const ESTIMATE_SOURCES = new Set([
  "verseshell-heuristic",
  "four-chars-per-token",
  "provider-count-endpoint",
  "other-estimate",
]);

const toFiniteNonNegative = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function usageFromRecord(record) {
  const usage = record.usage ?? {};
  const source = usage.source;
  const actual = ACTUAL_USAGE_SOURCES.has(source);
  const estimate = ESTIMATE_SOURCES.has(source);
  if (!actual && !estimate && source != null) {
    throw new Error(`Unsupported token usage source: ${source}`);
  }
  const input = toFiniteNonNegative(usage.inputTokens);
  const output = toFiniteNonNegative(usage.outputTokens);
  const cacheRead = toFiniteNonNegative(usage.cacheReadInputTokens) ?? 0;
  const cacheWrite = toFiniteNonNegative(usage.cacheCreationInputTokens) ?? 0;
  const total =
    toFiniteNonNegative(usage.totalTokens) ??
    (input !== undefined && output !== undefined
      ? input + output + cacheRead + cacheWrite
      : undefined);
  return {
    classification: actual ? "actual-provider-usage" : estimate ? "estimate-only" : "missing",
    source: source ?? "missing",
    inputTokens: input,
    outputTokens: output,
    cacheReadInputTokens: cacheRead,
    cacheCreationInputTokens: cacheWrite,
    totalTokens: total,
  };
}

function validateRecord(record) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("Each result record must be a JSON object");
  }
  if (record.provider !== "anthropic" && record.provider !== "openai-compatible") {
    throw new Error(`Unsupported provider: ${record.provider}`);
  }
  if (record.cacheState !== "cold" && record.cacheState !== "warm") {
    throw new Error(`Unsupported cacheState: ${record.cacheState}`);
  }
  if (typeof record.scenarioId !== "string" || record.scenarioId.length === 0) {
    throw new Error("scenarioId is required");
  }
  if (typeof record.runId !== "string" || record.runId.length === 0) {
    throw new Error("runId is required");
  }
  return record;
}

function sum(values) {
  return values.reduce((total, value) => total + (value ?? 0), 0);
}

function minOrUndefined(values) {
  const finite = values.filter((value) => value !== undefined);
  return finite.length === 0 ? undefined : Math.min(...finite);
}

function maxOrUndefined(values) {
  const finite = values.filter((value) => value !== undefined);
  return finite.length === 0 ? undefined : Math.max(...finite);
}

function aggregateRuns(records) {
  return [...records]
    .sort((left, right) =>
      `${left.scenarioId}\0${left.provider}\0${left.cacheState}\0${left.runId}`.localeCompare(
        `${right.scenarioId}\0${right.provider}\0${right.cacheState}\0${right.runId}`,
      ),
    )
    .map((record) => ({
      scenarioId: record.scenarioId,
      runId: record.runId,
      provider: record.provider,
      model: record.model ?? "unspecified",
      cacheState: record.cacheState,
      toolDefinitions: {
        count: toFiniteNonNegative(record.toolDefinitions?.count) ?? 0,
        bytes: toFiniteNonNegative(record.toolDefinitions?.bytes) ?? 0,
        fingerprint: record.toolDefinitions?.fingerprint ?? null,
      },
      call: {
        bytes: toFiniteNonNegative(record.call?.bytes) ?? 0,
        resultBytes: toFiniteNonNegative(record.call?.resultBytes) ?? 0,
        toolTurns: toFiniteNonNegative(record.call?.toolTurns) ?? 0,
        latencyMs: toFiniteNonNegative(record.call?.latencyMs),
      },
      task: {
        completed: record.task?.completed === true,
        outcome: record.task?.outcome ?? "unknown",
      },
      usage: usageFromRecord(record),
      artifacts: {
        created: toFiniteNonNegative(record.artifacts?.created) ?? 0,
        bytes: toFiniteNonNegative(record.artifacts?.bytes) ?? 0,
        queries: toFiniteNonNegative(record.artifacts?.queries) ?? 0,
        expiries: toFiniteNonNegative(record.artifacts?.expiries) ?? 0,
      },
      recovery: {
        truncations: toFiniteNonNegative(record.recovery?.truncations) ?? 0,
        attempts: toFiniteNonNegative(record.recovery?.attempts) ?? 0,
        successes: toFiniteNonNegative(record.recovery?.successes) ?? 0,
        bytesRecovered: toFiniteNonNegative(record.recovery?.bytesRecovered) ?? 0,
      },
    }));
}

function summarizeToolDefinitions(runs) {
  const identities = runs.map((run) => ({
    provider: run.provider,
    model: run.model,
    cacheState: run.cacheState,
    count: run.toolDefinitions.count,
    bytes: run.toolDefinitions.bytes,
    fingerprint: run.toolDefinitions.fingerprint,
  }));
  const byProviderModel = new Map();
  for (const item of identities) {
    const key = `${item.provider}\0${item.model}`;
    const list = byProviderModel.get(key) ?? [];
    list.push(item);
    byProviderModel.set(key, list);
  }
  const cacheStability = [...byProviderModel.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, items]) => {
      const [provider, model] = key.split("\0");
      const fingerprints = [...new Set(items.map((item) => item.fingerprint).filter(Boolean))];
      const counts = [...new Set(items.map((item) => item.count))];
      const bytes = [...new Set(items.map((item) => item.bytes))];
      return {
        provider,
        model,
        stable: fingerprints.length <= 1 && counts.length <= 1 && bytes.length <= 1,
        observedFingerprints: fingerprints.length,
        observedCounts: counts,
        observedBytes: bytes,
      };
    });
  return {
    observations: identities.length,
    bytes: sum(identities.map((item) => item.bytes)),
    count: sum(identities.map((item) => item.count)),
    cacheStability,
  };
}

function summarizeUsage(runs) {
  const actual = runs.filter((run) => run.usage.classification === "actual-provider-usage");
  const estimated = runs.filter((run) => run.usage.classification === "estimate-only");
  const aggregate = (items) => ({
    records: items.length,
    inputTokens: sum(items.map((run) => run.usage.inputTokens)),
    outputTokens: sum(items.map((run) => run.usage.outputTokens)),
    cacheReadInputTokens: sum(items.map((run) => run.usage.cacheReadInputTokens)),
    cacheCreationInputTokens: sum(items.map((run) => run.usage.cacheCreationInputTokens)),
    totalTokens: sum(items.map((run) => run.usage.totalTokens)),
    sources: [...new Set(items.map((run) => run.usage.source))].sort(),
  });
  return {
    actualProviderUsage: aggregate(actual),
    estimates: aggregate(estimated),
    missingRecords: runs.length - actual.length - estimated.length,
    estimatePolicy:
      "Heuristic estimates, including VerseShell estimates and four-chars-per-token, are never provider usage.",
  };
}

function summarizeRuns(runs) {
  const latencies = runs.map((run) => run.call.latencyMs);
  return {
    runCount: runs.length,
    completedTasks: runs.filter((run) => run.task.completed).length,
    toolTurns: sum(runs.map((run) => run.call.toolTurns)),
    callBytes: sum(runs.map((run) => run.call.bytes)),
    resultBytes: sum(runs.map((run) => run.call.resultBytes)),
    latencyMs: {
      total: sum(latencies),
      min: minOrUndefined(latencies),
      max: maxOrUndefined(latencies),
    },
    providerRuns: Object.fromEntries(
      [...new Set(runs.map((run) => run.provider))]
        .sort()
        .map((provider) => [provider, runs.filter((run) => run.provider === provider).length]),
    ),
    cacheRuns: {
      cold: runs.filter((run) => run.cacheState === "cold").length,
      warm: runs.filter((run) => run.cacheState === "warm").length,
    },
  };
}

function summarizeArtifacts(runs) {
  return {
    artifactsCreated: sum(runs.map((run) => run.artifacts.created)),
    artifactBytes: sum(runs.map((run) => run.artifacts.bytes)),
    artifactQueries: sum(runs.map((run) => run.artifacts.queries)),
    artifactExpiries: sum(runs.map((run) => run.artifacts.expiries)),
    truncations: sum(runs.map((run) => run.recovery.truncations)),
    recoveryAttempts: sum(runs.map((run) => run.recovery.attempts)),
    recoverySuccesses: sum(runs.map((run) => run.recovery.successes)),
    bytesRecovered: sum(runs.map((run) => run.recovery.bytesRecovered)),
  };
}

function savingsEvidence(runs) {
  const actual = runs.filter((run) => run.usage.classification === "actual-provider-usage");
  const pairs = [];
  const keys = [
    ...new Set(actual.map((run) => `${run.scenarioId}\0${run.provider}\0${run.model}`)),
  ].sort();
  for (const key of keys) {
    const matching = actual.filter(
      (run) => `${run.scenarioId}\0${run.provider}\0${run.model}` === key,
    );
    const cold = matching.filter((run) => run.cacheState === "cold");
    const warm = matching.filter((run) => run.cacheState === "warm");
    if (cold.length === 0 || warm.length === 0) continue;
    const coldTokens = sum(cold.map((run) => run.usage.totalTokens)) / cold.length;
    const warmTokens = sum(warm.map((run) => run.usage.totalTokens)) / warm.length;
    if (coldTokens <= 0) continue;
    const [scenarioId, provider, model] = key.split("\0");
    pairs.push({
      scenarioId,
      provider,
      model,
      coldActualTokens: coldTokens,
      warmActualTokens: warmTokens,
      savingsPercent: ((coldTokens - warmTokens) / coldTokens) * 100,
    });
  }
  const actualSavings =
    pairs.length === 0
      ? null
      : pairs.reduce((total, pair) => total + pair.savingsPercent, 0) / pairs.length;
  const supportsFiftyToSeventyPercent =
    actualSavings !== null && actualSavings >= 50 && actualSavings <= 70;
  return {
    status: pairs.length === 0 ? "insufficient-actual-provider-evidence" : "measured",
    claim: supportsFiftyToSeventyPercent
      ? `Measured mean savings: ${actualSavings.toFixed(2)}% across ${pairs.length} paired scenarios.`
      : "No 50-70% savings claim is supported by the supplied actual provider usage.",
    actualSavingsPercent: actualSavings,
    supportsFiftyToSeventyPercent,
    pairedScenarios: pairs,
  };
}

export function evaluateLearningCost(input) {
  const scenarioIds = new Set((input.scenarios ?? []).map((scenario) => scenario.id));
  const records = (input.results ?? []).map(validateRecord);
  for (const record of records) {
    if (!scenarioIds.has(record.scenarioId)) {
      throw new Error(`Unknown scenarioId in results: ${record.scenarioId}`);
    }
  }
  const runs = aggregateRuns(records);
  const report = {
    schemaVersion: 1,
    scenarios: [...scenarioIds].sort(),
    toolDefinitions: summarizeToolDefinitions(runs),
    callsAndResults: summarizeRuns(runs),
    tokenUsage: summarizeUsage(runs),
    artifactsAndRecovery: summarizeArtifacts(runs),
    savingsEvidence: savingsEvidence(runs),
    runs,
  };
  return { ...report, reportFingerprint: stableHash(report) };
}

export function loadLearningCostInputs({ scenarioPath, resultsPath }) {
  return {
    scenarios: JSON.parse(fs.readFileSync(scenarioPath, "utf8")).scenarios,
    results: JSON.parse(fs.readFileSync(resultsPath, "utf8")).results,
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("Usage: --scenarios <path> --results <path> [--output <path>]");
    }
    args[key.slice(2)] = value;
  }
  if (!args.scenarios || !args.results) {
    throw new Error("Both --scenarios and --results are required");
  }
  return args;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
const modulePath = fileURLToPath(import.meta.url);
if (invokedPath === modulePath) {
  const args = parseArgs(process.argv.slice(2));
  const report = evaluateLearningCost(
    loadLearningCostInputs({ scenarioPath: args.scenarios, resultsPath: args.results }),
  );
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (args.output) fs.writeFileSync(args.output, json);
  else process.stdout.write(json);
}
