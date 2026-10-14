#!/usr/bin/env node
/**
 * A4 Decision Quality — explicit offline dev-tool entry point.
 *
 * `docs/runtime-design/development-manual.md` §1.4 freezes A4 as
 * "offline pure functions only": it MUST NOT run on any production turn path
 * and is invoked ONLY via an explicit dev-tool invocation (CLI, test fixture,
 * debug panel). This script is that CLI surface: it reads a JSON array of
 * `DecisionRecord`s from disk, audits them with the existing
 * `DecisionQualityAuditor`, writes a report, and exits non-zero when the
 * low-quality rate breaches the 10% graduation budget.
 *
 * It does not touch the runtime turn path and never enables the pilot flag for
 * the app; it only exercises the same auditor the runtime would use if the
 * `decisionQualityPilot: 'shadow'` flag were set by an operator.
 *
 * Usage:
 *   pnpm --dir openclaw_runtime exec tsx ../scripts/a4-decision-quality-audit.mts --input <file.json>
 *   pnpm --dir openclaw_runtime exec tsx ../scripts/a4-decision-quality-audit.mts --input <file.json> --out <report.json>
 *   pnpm --dir openclaw_runtime exec tsx ../scripts/a4-decision-quality-audit.mts --selftest
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  DecisionQualityAuditor,
  isDecisionQualityAuditEnabled,
  scoreDecision,
  type DecisionRecord,
} from "../openclaw_runtime/src/observability/decision-quality-auditor.js";

const LOW_QUALITY_BUDGET = 0.1;

function parseArgs(argv: string[]): { input: string | null; out: string | null; selftest: boolean } {
  const args = { input: null as string | null, out: null as string | null, selftest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--input") args.input = argv[index + 1] ?? null;
    else if (token === "--out") args.out = argv[index + 1] ?? null;
    else if (token === "--selftest") args.selftest = true;
  }
  return args;
}

function readRecords(filePath: string): DecisionRecord[] {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const records = Array.isArray(raw) ? raw : raw?.records;
  if (!Array.isArray(records)) {
    throw new Error("input must be a JSON array of DecisionRecord objects (or { records: [...] })");
  }
  return records as DecisionRecord[];
}

function audit(records: DecisionRecord[]) {
  // The dev-tool always enables the shadow pilot for this offline run; the app
  // flag stays default-off and this never runs in a production turn.
  const enabled = isDecisionQualityAuditEnabled({ decisionQualityPilot: "shadow" });
  const auditor = new DecisionQualityAuditor({ decisionQualityPilot: "shadow" });
  const batch = auditor.auditBatch(records);
  if (batch === null) throw new Error("A4 auditor is disabled in the dev-tool run");
  const lowQualityRate = batch.totalAudited > 0 ? batch.lowQualityCount / batch.totalAudited : 0;
  return {
    enabled,
    totalAudited: batch.totalAudited,
    lowQualityCount: batch.lowQualityCount,
    lowQualityRate,
    meanOverall: batch.meanOverall,
    withinBudget: lowQualityRate <= LOW_QUALITY_BUDGET,
    scores: batch.scores,
  };
}

function buildSelftestRecords(): DecisionRecord[] {
  return [
    {
      decisionId: "selftest-good",
      reviewerAction: "continue",
      expectedAction: "continue",
      actionMatched: true,
      contextItemsAvailable: 10,
      contextItemsConsidered: 10,
      decisionTick: 0,
      maxTicksForDecision: 10,
    },
  ];
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  if (args.selftest) {
    const report = audit(buildSelftestRecords());
    process.stdout.write(`[a4-decision-quality-audit] selftest totalAudited=${report.totalAudited} lowQualityCount=${report.lowQualityCount}\n`);
    return report.totalAudited === 1 && report.lowQualityCount === 0 ? 0 : 1;
  }
  if (!args.input) {
    process.stderr.write("[a4-decision-quality-audit] missing --input <records.json> (or --selftest)\n");
    return 2;
  }
  const inputPath = path.resolve(args.input);
  const records = readRecords(inputPath);
  const report = audit(records);
  const payload = {
    schema: "a4-decision-quality-audit/v1",
    generatedAt: new Date().toISOString(),
    actor: "agent",
    driven_by: "agent",
    invoked_via: "explicit-dev-tool-cli",
    production_turn_path: false,
    input: path.relative(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), inputPath).split(path.sep).join("/"),
    budget: LOW_QUALITY_BUDGET,
    ...report,
  };
  const outPath = args.out
    ? path.resolve(args.out)
    : path.resolve("artifacts/decision-quality-audit/report.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
  process.stdout.write(
    `[a4-decision-quality-audit] audited=${report.totalAudited} lowQuality=${report.lowQualityCount} rate=${(report.lowQualityRate * 100).toFixed(2)}% withinBudget=${report.withinBudget}\n`,
  );
  return report.withinBudget ? 0 : 1;
}

process.exit(main());
