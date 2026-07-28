import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  evaluateLearningCost,
  loadLearningCostInputs,
} from "./verseshell-foundation-learning-cost.mjs";

const scenariosPath = fileURLToPath(
  new URL("./fixtures/verseshell-foundation-learning-scenarios.json", import.meta.url),
);
const resultsPath = fileURLToPath(
  new URL("./fixtures/verseshell-foundation-learning-results.json", import.meta.url),
);
const schemaPath = fileURLToPath(
  new URL("./fixtures/verseshell-foundation-learning-schema.json", import.meta.url),
);

function fixtureInputs() {
  return loadLearningCostInputs({ scenarioPath: scenariosPath, resultsPath });
}

test("scenario fixture covers the required saved-result evaluation shapes", () => {
  const { scenarios } = fixtureInputs();
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.deepEqual(schema.$defs.result.properties.provider.enum, [
    "anthropic",
    "openai-compatible",
  ]);
  assert.deepEqual(
    scenarios.map((scenario) => scenario.id),
    [
      "small-read",
      "large-read",
      "repo-search",
      "short-command",
      "large-command",
      "artifact-recovery",
      "approval-denial",
      "runtime-outage",
    ],
  );
});

test("reports provider-neutral dimensions separately and deterministically", () => {
  const inputs = fixtureInputs();
  const first = evaluateLearningCost(inputs);
  const second = evaluateLearningCost({
    scenarios: [...inputs.scenarios].reverse(),
    results: [...inputs.results].reverse(),
  });

  assert.deepEqual(first.toolDefinitions.cacheStability, second.toolDefinitions.cacheStability);
  assert.equal(first.reportFingerprint, second.reportFingerprint);
  assert.deepEqual(first.callsAndResults.providerRuns, {
    anthropic: 2,
    "openai-compatible": 2,
  });
  assert.deepEqual(first.callsAndResults.cacheRuns, { cold: 2, warm: 2 });
  assert.equal(first.artifactsAndRecovery.artifactBytes, 8192);
  assert.equal(first.artifactsAndRecovery.recoverySuccesses, 1);
  assert.equal(
    first.toolDefinitions.cacheStability.every((entry) => entry.stable),
    true,
  );
});

test("never counts heuristics or four-chars-per-token as provider usage", () => {
  const report = evaluateLearningCost(fixtureInputs());

  assert.equal(report.tokenUsage.actualProviderUsage.records, 2);
  assert.equal(report.tokenUsage.estimates.records, 2);
  assert.deepEqual(report.tokenUsage.actualProviderUsage.sources, [
    "anthropic-response-usage",
    "openai-response-usage",
  ]);
  assert.deepEqual(report.tokenUsage.estimates.sources, [
    "four-chars-per-token",
    "verseshell-heuristic",
  ]);
  assert.equal(report.tokenUsage.actualProviderUsage.totalTokens, 3450);
  assert.equal(report.tokenUsage.estimates.totalTokens, 555);
});

test("does not claim 50-70% savings without paired actual provider usage", () => {
  const report = evaluateLearningCost(fixtureInputs());

  assert.equal(report.savingsEvidence.status, "insufficient-actual-provider-evidence");
  assert.equal(report.savingsEvidence.supportsFiftyToSeventyPercent, false);
  assert.equal(report.savingsEvidence.actualSavingsPercent, null);
  assert.match(report.savingsEvidence.claim, /No 50-70% savings claim/);
});

test("only emits a measured savings statement from paired actual usage", () => {
  const inputs = fixtureInputs();
  const base = inputs.results[0];
  const actualPair = [
    { ...base, runId: "cold", cacheState: "cold", usage: { ...base.usage, totalTokens: 1000 } },
    { ...base, runId: "warm", cacheState: "warm", usage: { ...base.usage, totalTokens: 400 } },
  ];
  const report = evaluateLearningCost({ scenarios: inputs.scenarios, results: actualPair });

  assert.equal(report.savingsEvidence.status, "measured");
  assert.equal(report.savingsEvidence.actualSavingsPercent, 60);
  assert.equal(report.savingsEvidence.supportsFiftyToSeventyPercent, true);
  assert.match(report.savingsEvidence.claim, /Measured mean savings: 60\.00%/);
});

test("fixtures and evaluator contain no network endpoint or credential dependency", () => {
  const source = fs.readFileSync(
    fileURLToPath(new URL("./verseshell-foundation-learning-cost.mjs", import.meta.url)),
    "utf8",
  );
  assert.doesNotMatch(source, /https?:\/\//);
  assert.doesNotMatch(source, /API_KEY|fetch\(|axios|WebSocket/);
});
