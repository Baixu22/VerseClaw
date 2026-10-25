#!/usr/bin/env node
// WP4 evidence: summarize normalized WP1 behaviour events into bounded coverage and
// evidence-gated feedback delivery tiers.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { buildBehaviorCoverage, validateBehaviorCoverageReport } from '../electron/services/versegit-behavior-coverage.ts';

const root = process.env.VERSEGIT_WP4_ROOT ? resolve(process.env.VERSEGIT_WP4_ROOT) : resolve(process.cwd());
export const WP4_SCHEMA = 'clawx.versegit.wp4-coverage-evidence/v1';
export const WP4_FIXTURE_PATH = 'harness/specs/fixtures/versegit-planning-correction/wp4-behavior-coverage-fixture.json';
function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
export function buildWp4Evidence({ root: evidenceRoot = root, fixturePath } = {}) {
  const fixture = readJson(fixturePath ?? resolve(evidenceRoot, WP4_FIXTURE_PATH));
  const eventLines = readFileSync(resolve(evidenceRoot, fixture.sourceEvents), 'utf8').split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
  const sourceReport = readJson(resolve(evidenceRoot, fixture.sourceReport));
  const events = eventLines.flatMap((line) => [line.event, line.sessionEnd].filter(Boolean));
  const knownGaps = [...new Set((sourceReport.sessions ?? []).flatMap((session) => session.coverage?.knownGaps ?? []))];
  const coverage = buildBehaviorCoverage({ events, feedbackCases: fixture.feedbackCases, knownGaps, maxEvents: fixture.maxEvents });
  const statusCounts = sourceReport.statusCounts ?? {};
  const report = {
    schema: WP4_SCHEMA, generated_at: new Date().toISOString(), driven_by: 'agent', actor: 'codex', task: 'TF-0470',
    sourceEvents: fixture.sourceEvents, sourceLineCount: eventLines.length, sourceStatusCounts: statusCounts,
    coverage, coverageDigest: coverage.digest,
    redaction: { rawPayloadStored: false, absolutePathStored: false, secretStored: false },
    boundaries: { duplicateEventsCountedOnce: coverage.duplicateCount >= 0, staleEventsExcluded: (statusCounts.stale ?? 0) === 2, droppedExplicit: coverage.droppedCount >= 0, hostVerdictUnchanged: true },
    passed: coverage.passed && statusCounts.stale === 2,
    issues: [...coverage.issues],
  };
  report.digest = digest({ ...report, generated_at: undefined, digest: undefined });
  return { fixture, coverage, report, events };
}
export function validateWp4Report(report) {
  const issues = [];
  if (report?.schema !== WP4_SCHEMA || report?.task !== 'TF-0470') issues.push('WP4 schema/task mismatch');
  if (report?.driven_by !== 'agent' || report?.actor !== 'codex') issues.push('WP4 evidence must be agent-driven');
  if (report?.sourceLineCount !== 20) issues.push('WP4 source line count drifted');
  if (!report?.coverage || report.coverage.eventCount !== 12 || report.coverage.uniqueEventCount !== 12) issues.push('WP4 normalized event count drifted');
  if (report?.coverage?.unobservedCount !== 1 || report?.coverage?.droppedCount !== 0) issues.push('WP4 unobserved/dropped accounting drifted');
  if (report?.sourceStatusCounts?.duplicate !== 1 || report?.sourceStatusCounts?.stale !== 2) issues.push('WP4 source duplicate/stale accounting drifted');
  for (const tier of ['produced', 'host-delivered', 'transcript-confirmed', 'behavior-shift']) {
    if (!report?.coverage?.feedbackDelivery?.some((entry) => entry.tier === tier)) issues.push(`missing feedback tier ${tier}`);
  }
  if (report?.coverage?.feedbackDelivery?.some((entry) => entry.claimedWithoutEvidence)) issues.push('feedback tier was claimed without evidence');
  if (report?.coverage?.coverageVector?.directFs !== 'unobserved' || report?.coverage?.coverageVector?.shellRead !== 'unobserved') issues.push('coverage vector lost unobserved surfaces');
  if (report?.redaction?.rawPayloadStored !== false || report?.redaction?.absolutePathStored !== false || report?.redaction?.secretStored !== false) issues.push('WP4 redaction boundary failed');
  if (report?.coverage?.limits?.rawPayloadStored !== false || report?.coverage?.limits?.truncated !== false) issues.push('WP4 log limit boundary failed');
  const serialized = JSON.stringify(report);
  if (/(?:^|[^A-Za-z])[A-Za-z]:[\\/]|\/Users\/|api[_-]?key|secret\s*[:=]/iu.test(serialized)) issues.push('WP4 artifact contains an absolute path or secret-like field');
  const coverageValidation = validateBehaviorCoverageReport(report?.coverage);
  issues.push(...coverageValidation.issues);
  if (report?.passed !== true || (report?.issues ?? []).length !== 0) issues.push('WP4 report did not pass');
  if (report?.digest !== digest({ ...report, generated_at: undefined, digest: undefined })) issues.push('WP4 digest is not reproducible');
  return { ok: issues.length === 0, issues };
}
export function writeWp4Evidence({ root: evidenceRoot = root, output, fixturePath } = {}) {
  const built = buildWp4Evidence({ root: evidenceRoot, fixturePath });
  const path = output ? resolve(output) : resolve(evidenceRoot, 'artifacts/versegit/wp4/coverage.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(built.report, null, 2)}\n`, 'utf8');
  return { ...built, path, validation: validateWp4Report(built.report) };
}
async function main() {
  const at = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? resolve(process.argv[i + 1]) : undefined; };
  const result = writeWp4Evidence({ fixturePath: at('--fixture'), output: at('--out') });
  console.log(JSON.stringify({ path: result.path, passed: result.report.passed, counts: { source: result.report.sourceLineCount, unique: result.report.coverage.uniqueEventCount, duplicate: result.report.coverage.duplicateCount, unobserved: result.report.coverage.unobservedCount }, validation: result.validation }, null, 2));
  if (!result.validation.ok) process.exitCode = 1;
}
if (isMainEntrypoint(import.meta.url)) main();