#!/usr/bin/env node
// Validates the quantitative smoke metrics emitted by
// extensions/codegraph/runtime.e2e.test.ts. This is intentionally a narrow
// quality gate for the CodeGraph Runtime project-cognition base layer.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const metricsPath = path.join(runtimeRoot, ".artifacts", "codegraph-runtime-e2e-metrics.json");

function fail(message, details = {}) {
  console.error(`CODEGRAPH_RUNTIME_GATE_FAIL ${JSON.stringify({ message, ...details })}`);
  process.exitCode = 1;
}

function pass(summary) {
  console.log(`CODEGRAPH_RUNTIME_GATE_PASS ${JSON.stringify(summary)}`);
}

function assertMetric(condition, message, details) {
  if (!condition) {
    fail(message, details);
    return false;
  }
  return true;
}

function loadMetrics() {
  if (!fs.existsSync(metricsPath)) {
    fail("Missing CodeGraph runtime e2e metrics file", { metricsPath });
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(metricsPath, "utf8"));
  } catch (error) {
    fail("Invalid CodeGraph runtime e2e metrics JSON", {
      metricsPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function checkSourceStaticAssets() {
  const extensionRoot = path.join(runtimeRoot, "extensions", "codegraph");
  const packagePath = path.join(extensionRoot, "package.json");
  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const assets = pkg.openclaw?.build?.staticAssets ?? [];
  const missing = assets.filter((asset) => !fs.existsSync(path.join(extensionRoot, asset.source)));
  const cjsBoundaryPath = path.join(extensionRoot, "dist", "package.json");
  const cjsBoundary = fs.existsSync(cjsBoundaryPath)
    ? JSON.parse(fs.readFileSync(cjsBoundaryPath, "utf8"))
    : null;
  return {
    staticAssetCount: assets.length,
    missingStaticAssetCount: missing.length,
    cjsBoundaryOk: cjsBoundary?.type === "commonjs",
  };
}

function checkPackagedStaticAssets() {
  const sourceRoot = path.join(runtimeRoot, "extensions", "codegraph");
  const builtRoot = path.join(runtimeRoot, "dist", "extensions", "codegraph");
  if (!fs.existsSync(builtRoot)) {
    return { status: "skipped_not_built" };
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(sourceRoot, "package.json"), "utf8"));
  const assets = pkg.openclaw?.build?.staticAssets ?? [];
  const missing = assets.filter((asset) => !fs.existsSync(path.join(builtRoot, asset.output)));
  return {
    status: missing.length === 0 ? "ok" : "missing_assets",
    checkedAssetCount: assets.length,
    missingAssetCount: missing.length,
    missingSample: missing.slice(0, 5).map((asset) => asset.output),
  };
}

const metrics = loadMetrics();
if (!metrics) process.exit();

const sourceAssets = checkSourceStaticAssets();
const packagedAssets = checkPackagedStaticAssets();

const checks = [
  assertMetric(metrics.registeredToolCount === 15, "Expected exactly 15 registered CodeGraph tools", {
    actual: metrics.registeredToolCount,
  }),
  assertMetric(metrics.manifestToolCount === 15, "Expected exactly 15 manifest CodeGraph tools", {
    actual: metrics.manifestToolCount,
  }),
  assertMetric(metrics.staticAssetCount >= 688, "Expected vendored CodeGraph static assets to be present", {
    actual: metrics.staticAssetCount,
  }),
  assertMetric(metrics.missingStaticAssetCount === 0, "Expected no missing vendored CodeGraph assets in e2e metrics", {
    actual: metrics.missingStaticAssetCount,
  }),
  assertMetric(sourceAssets.staticAssetCount >= 688, "Expected source static asset manifest to contain vendored dist", sourceAssets),
  assertMetric(sourceAssets.missingStaticAssetCount === 0, "Expected no missing source static assets", sourceAssets),
  assertMetric(sourceAssets.cjsBoundaryOk, "Expected vendored dist/package.json to force CommonJS", sourceAssets),
  assertMetric(metrics.indexedFileCount >= 5, "Expected e2e fixture files to be indexed", {
    actual: metrics.indexedFileCount,
  }),
  assertMetric(metrics.indexedNodeCount >= 10, "Expected e2e fixture symbols to be indexed", {
    actual: metrics.indexedNodeCount,
  }),
  assertMetric(metrics.directPlanFileCount >= 1, "Expected direct file task to produce a source-read plan", {
    actual: metrics.directPlanFileCount,
  }),
  assertMetric(
    metrics.graphPlanFileCount >= 1 && metrics.graphPlanFileCount <= 6,
    "Expected graph context plan to stay bounded",
    { actual: metrics.graphPlanFileCount },
  ),
  assertMetric(metrics.graphPlanSymbolCount >= 1, "Expected graph context plan to include symbols", {
    actual: metrics.graphPlanSymbolCount,
  }),
  assertMetric(metrics.searchResultCount >= 1, "Expected symbol search to return results", {
    actual: metrics.searchResultCount,
  }),
  assertMetric(metrics.fastFreshnessStatus === "stale", "Expected fast mode to surface stale dirty-workspace state", {
    actual: metrics.fastFreshnessStatus,
  }),
  assertMetric(
    metrics.balancedFreshnessStatus === "fresh" || metrics.balancedFreshnessStatus === "refreshed",
    "Expected balanced mode to synchronize or confirm freshness",
    { actual: metrics.balancedFreshnessStatus },
  ),
  assertMetric(metrics.balancedChangedFileCount >= 1, "Expected balanced mode to report changed files after edit", {
    actual: metrics.balancedChangedFileCount,
  }),
  assertMetric(metrics.balancedRetrievalConfidence >= 0.9, "Expected high confidence after balanced sync", {
    actual: metrics.balancedRetrievalConfidence,
  }),
  assertMetric(metrics.durationMs < 5_000, "Expected CodeGraph runtime e2e to remain lightweight", {
    actual: metrics.durationMs,
  }),
];

if (packagedAssets.status === "missing_assets") {
  checks.push(assertMetric(false, "Built runtime CodeGraph static assets are incomplete", packagedAssets));
}

if (checks.every(Boolean)) {
  pass({
    metricsPath,
    registeredToolCount: metrics.registeredToolCount,
    staticAssetCount: metrics.staticAssetCount,
    indexedFileCount: metrics.indexedFileCount,
    indexedNodeCount: metrics.indexedNodeCount,
    balancedRetrievalConfidence: metrics.balancedRetrievalConfidence,
    durationMs: metrics.durationMs,
    packagedAssetStatus: packagedAssets.status,
  });
}
