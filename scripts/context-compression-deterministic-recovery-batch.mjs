#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildContinuationDirective,
  buildDeterministicRecoverySummary,
  buildRecoveryLedger,
} from "./context-compression-recovery-ledger.mjs";

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

const manifestPath = resolve(argValue("--manifest", "reports/context-compression/production-manifest-30.json"));
const metaPath = resolve(argValue("--meta", "reports/context-compression/production-summaries-30-generated.meta.json"));
const outRoot = resolve(argValue("--out", "artifacts/p6-tf0074-deterministic-recovery-30"));
const manifest = readJson(manifestPath);
const meta = readJson(metaPath);
const metaById = new Map((meta.entries ?? []).map((entry) => [entry.sampleId, entry]));
const rows = [];

for (const sample of manifest.samples ?? []) {
  const file = metaById.get(sample.id)?.file;
  if (!file) throw new Error(`${sample.id}: missing transcript meta entry`);
  const ordinalIndex = Number(/^R(\d+)$/u.exec(String(sample.id))?.[1] ?? 1) - 1;
  const ledger = buildRecoveryLedger(file, sample.id, {
    windowSize: Number(sample.cohort?.turn ?? 200),
    ordinalIndex,
  });
  const directive = buildContinuationDirective(ledger);
  const summary = `${buildDeterministicRecoverySummary(ledger)}\n\n${directive.text}`.trim();
  rows.push({ sampleId: sample.id, compressedSummary: summary });
}

mkdirSync(outRoot, { recursive: true });
writeFileSync(
  `${outRoot}/would-retry-summaries.jsonl`,
  `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
  "utf8",
);
writeFileSync(
  `${outRoot}/batch-metadata.json`,
  `${JSON.stringify({
    schema: "p6-deterministic-recovery-batch/v1",
    generatedAt: new Date().toISOString(),
    sampleCount: rows.length,
    manifestPath,
    manifestSha256: sha256(readFileSync(manifestPath)),
    recoveryLedgerSha256: sha256(readFileSync(resolve("scripts/context-compression-recovery-ledger.mjs"))),
    ordinalRule: "R<number> -> ordinalIndex<number-1>",
    model: "none",
  }, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify({ outRoot, sampleCount: rows.length, model: "none" }, null, 2));
