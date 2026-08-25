#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const DEFAULT_IDS = ["R5", "R6", "R7", "R8", "R14", "R16", "R23", "R27", "R29"];

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function normalizePressureCohort(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "emergency") return raw || "emergency";
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? String(numeric) : raw;
}

function normalizeProviderCohort(value) {
  const raw = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9_.-]/gu, "-");
  return raw || "unknown";
}

function transcriptIdentity(file) {
  const absolute = resolve(file);
  const stat = statSync(absolute);
  return {
    pathHash: sha256(absolute.toLowerCase()),
    basename: basename(absolute),
    size: stat.size,
    mtimeMs: Math.floor(stat.mtimeMs),
  };
}

function sampleManifestKeyV2(sample) {
  return sha256(stableJson({
    source: "real",
    version: 2,
    transcriptIdentity: {
      pathHash: sample.transcript.fileHash,
      basename: sample.transcript.basename,
      size: sample.transcript.size,
      mtimeMs: sample.transcript.mtimeMs,
    },
    turnCohort: sample.cohort.turn,
    pressureCohort: normalizePressureCohort(sample.cohort.pressure),
    providerCohort: normalizeProviderCohort(sample.cohort.provider),
    splitTurnCohort: sample.cohort.splitTurn ?? "unknown",
    previousSummaryCohort: sample.cohort.previousSummary ?? "unknown",
    fileHunkCohort: sample.cohort.fileHunk ?? "unknown",
    evidenceMessageIds: sample.evidenceMessageIds ?? [],
  }));
}

const manifestPath = resolve(argValue("--manifest", "reports/context-compression/production-manifest-30.json"));
const metaPath = resolve(argValue("--meta", "reports/context-compression/production-summaries-30-generated.meta.json"));
const outPath = resolve(argValue("--out", "artifacts/p6-would-retry-local-tf0073-r1/manifest-9.json"));
const ids = (argValue("--ids", DEFAULT_IDS.join(",")) ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const manifest = readJson(manifestPath);
const meta = readJson(metaPath);
const sourceBytes = readFileSync(manifestPath);
const sourceById = new Map((manifest.samples ?? []).map((sample) => [sample.id, sample]));
const metaById = new Map((meta.entries ?? []).map((entry) => [entry.sampleId, entry]));
const selected = ids.map((id) => {
  const source = sourceById.get(id);
  const entry = metaById.get(id);
  if (!source || !entry?.file) throw new Error(`${id}: missing frozen manifest or meta entry`);
  const transcriptPath = resolve(entry.file);
  const identity = transcriptIdentity(transcriptPath);
  const sample = {
    ...source,
    source: "real",
    transcript: {
      ...source.transcript,
      fileHash: identity.pathHash,
      basename: identity.basename,
      size: identity.size,
      mtimeMs: identity.mtimeMs,
    },
  };
  return { ...sample, key: sampleManifestKeyV2(sample) };
});

const output = {
  version: manifest.version,
  seed: manifest.seed,
  requestedSampleCount: selected.length,
  sampleSelectionHash: sha256(stableJson(selected)),
  generatedAt: new Date().toISOString(),
  sourceManifestPath: manifestPath,
  sourceManifestSha256: sha256(sourceBytes),
  generator: "context-compression-would-retry-local-manifest/v1",
  samples: selected,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  outPath,
  sampleCount: output.requestedSampleCount,
  sampleIds: ids,
  sourceManifestSha256: output.sourceManifestSha256,
  sampleSelectionHash: output.sampleSelectionHash,
}, null, 2));
