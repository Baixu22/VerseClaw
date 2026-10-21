#!/usr/bin/env -S node --import tsx
// Independent WP7 verifier: validate the stored vertical report, replay the live
// host integration, compare the normalized outcome, and recheck final checksums.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WP7_ARTIFACT_PATH,
  WP7_EVIDENCE_PATH,
  buildWp7Report,
  validateWp7Report,
} from './versegit-wp7-host-vertical.mts';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

function at(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? resolve(repositoryRoot, process.argv[index + 1]) : undefined;
}

function readJson(path: string, label: string): Record<string, unknown> {
  if (!existsSync(path)) throw new Error(`${label} missing: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function verifySums(path: string): string[] {
  if (!existsSync(path)) return [`SHA256SUMS missing: ${path}`];
  const issues: string[] = [];
  for (const [index, line] of readFileSync(path, 'utf8').split(String.fromCharCode(10)).filter(Boolean).entries()) {
    const match = /^([0-9a-f]{64})  (.+)$/u.exec(line);
    if (!match) { issues.push(`SHA256SUMS line ${index + 1} malformed`); continue; }
    const target = resolve(repositoryRoot, match[2]);
    if (!existsSync(target)) { issues.push(`SHA256SUMS target missing: ${match[2]}`); continue; }
    const actual = createHash('sha256').update(readFileSync(target)).digest('hex');
    if (actual !== match[1]) issues.push(`SHA256SUMS mismatch: ${match[2]}`);
  }
  return issues;
}

export async function verifyWp7Artifact({
  artifact = resolve(repositoryRoot, WP7_ARTIFACT_PATH),
  replay = true,
}: { artifact?: string; replay?: boolean } = {}): Promise<{ ok: boolean; issues: string[]; report: Record<string, unknown> }> {
  const storedPath = existsSync(artifact) ? artifact : resolve(repositoryRoot, WP7_EVIDENCE_PATH);
  const stored = readJson(storedPath, 'WP7 report');
  const issues = validateWp7Report(stored).issues.slice();
  if (stored.passed !== true || stored.status !== 'passed') issues.push('stored report is not passed');
  if (replay) {
    const live = await buildWp7Report({ root: repositoryRoot });
    const liveValidation = validateWp7Report(live);
    issues.push(...liveValidation.issues.map((issue) => `live: ${issue}`));
    if (live.passed !== true) issues.push('live replay did not pass');
    if (live.normalizedOutcomeDigest !== stored.normalizedOutcomeDigest) issues.push('normalized outcome digest drifted');
    const storedCleanup = stored.cleanup as Record<string, unknown> | undefined;
    const liveCleanup = live.cleanup as Record<string, unknown> | undefined;
    if (storedCleanup?.status !== 'clean' || liveCleanup?.status !== 'clean') issues.push('cleanup is not clean');
  }
  const evidence = resolve(repositoryRoot, WP7_EVIDENCE_PATH);
  if (existsSync(evidence) && evidence !== storedPath && readFileSync(evidence).compare(readFileSync(storedPath)) !== 0) {
    issues.push('curated WP7 evidence differs from artifact');
  }
  if (existsSync(resolve(repositoryRoot, 'artifacts/versegit/wp7/SHA256SUMS'))) issues.push(...verifySums(resolve(repositoryRoot, 'artifacts/versegit/wp7/SHA256SUMS')));
  issues.push(...verifySums(resolve(repositoryRoot, 'harness/specs/fixtures/versegit-planning-correction/wp7-evidence/SHA256SUMS')));
  return { ok: issues.length === 0, issues: [...new Set(issues)], report: stored };
}

async function main(): Promise<void> {
  const result = await verifyWp7Artifact({ artifact: at('--artifact') });
  if (!result.ok) {
    for (const issue of result.issues) console.error(`[versegit-wp7-verify] FAIL: ${issue}`);
    process.exitCode = 1;
    return;
  }
  const report = result.report;
  const cleanup = report.cleanup as Record<string, unknown>;
  console.log(`[versegit-wp7-verify] OK normalized=${String(report.normalizedOutcomeDigest).slice(0, 12)} worktrees_deleted=${String(cleanup.worktreesDeleted)} processes=${String(cleanup.processSurvivors)}`);
}

if (isMainEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(`[versegit-wp7-verify] FAIL: ${String(error?.stack ?? error)}`);
    process.exitCode = 1;
  });
}
