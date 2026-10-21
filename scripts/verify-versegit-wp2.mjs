#!/usr/bin/env node
// WP2 verifier: replay the opt-in profile fixture and independently prove zero VG
// calls for single-worktree/session, real diagnostic calls for concurrency, fail-open
// missing-binary behavior, cleanup and no implicit profile membership.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { buildWp2Report, validateWp2Report, WP2_FIXTURE_PATH, WP2_PROFILE, WP2_SCHEMA } from './versegit-wp2-profile.mjs';
import { sha256 } from './versegit-mc5-differential.mjs';

const root = process.env.VERSEGIT_WP2_ROOT ? resolve(process.env.VERSEGIT_WP2_ROOT) : resolve(process.cwd());
function at(flag) { const i = process.argv.indexOf(flag); return i >= 0 ? resolve(process.argv[i + 1]) : undefined; }

async function main() {
  const artifact = at('--artifact') ?? resolve(root, 'artifacts/versegit/wp2/report.json');
  if (!existsSync(artifact)) { console.error(`[versegit-wp2] FAIL: artifact missing ${artifact}`); process.exitCode = 1; return; }
  const stored = JSON.parse(readFileSync(artifact, 'utf8'));
  const issues = [];
  issues.push(...validateWp2Report(stored).issues.map((issue) => `stored: ${issue}`));
  const live = await buildWp2Report({ root });
  issues.push(...validateWp2Report(live.report).issues.map((issue) => `live: ${issue}`));
  if (stored.digest !== live.report.digest) issues.push('stored digest differs from the live profile replay');
  if (stored.summary?.processCalls !== 3) issues.push('fixture process count must be three');
  if (stored.summary?.statuses?.not_applicable !== 1 || stored.summary?.statuses?.partial !== 1 || stored.summary?.statuses?.unavailable !== 1) issues.push('fixture status distribution drifted');

  const profileSource = readFileSync(resolve(root, 'harness/src/profiles.mjs'), 'utf8');
  if (!profileSource.includes(`'${WP2_PROFILE}'`)) issues.push('concurrency-aux profile is not registered');
  const fastBlock = profileSource.match(/fast:\s*\[([\s\S]*?)\],\s*comms:/u)?.[1] ?? '';
  const commsBlock = profileSource.match(/comms:\s*\[([\s\S]*?)\],\s*e2e:/u)?.[1] ?? '';
  if (fastBlock.includes('versegit') || commsBlock.includes('versegit')) issues.push('concurrency-aux must not be added to fast or comms');
  const profileModule = readFileSync(resolve(root, 'scripts/versegit-wp2-profile.mjs'), 'utf8');
  const adapterSource = readFileSync(resolve(root, 'electron/services/versegit-module.ts'), 'utf8');
  if (!profileModule.includes("readVersion()") || !profileModule.includes("readCapabilities()") || !profileModule.includes("readDoctor()")) issues.push('profile must use fixed adapter seams');
  if (!adapterSource.includes("['doctor', '--json']")) issues.push('doctor seam is not fixed');
  for (const marker of ['D:\\Projects\\VerseGit', 'C:\\Users', 'D:/Projects/VerseGit']) {
    if (readFileSync(artifact, 'utf8').includes(marker)) issues.push(`absolute path leaked into WP2 report: ${marker}`);
  }
  const single = stored.cases?.find((entry) => entry.caseId === 'single-worktree');
  const multi = stored.cases?.find((entry) => entry.caseId === 'multi-worktree');
  const missing = stored.cases?.find((entry) => entry.caseId === 'missing-binary');
  if (!single || single.usage?.processesStarted !== 0) issues.push('single-worktree must execute zero VG processes');
  if (!multi || multi.usage?.processesStarted < 1 || multi.status !== 'partial') issues.push('multi-worktree must return a partial report with diagnostics');
  if (!multi?.moduleReport || multi.moduleReport.verification?.executor !== 'verseshell') issues.push('multi-worktree report must retain VerseShell execution ownership');
  if (!missing || missing.status !== 'unavailable' || missing.usage?.processesStarted !== 0) issues.push('missing binary must fail open without spawning');
  for (const entry of stored.cases ?? []) {
    if (entry.hostVerdict !== 'unchanged' || entry.cleanup?.sidecarProcessesSurviving !== 0 || entry.cleanup?.candidateTempDirectories !== 0 || entry.cleanup?.hostWorktreesDeleted !== 0) issues.push(`${entry.caseId}: cleanup or host verdict boundary failed`);
  }
  const expectedDigest = sha256(JSON.stringify({ ...stored, generated_at: undefined, digest: undefined }));
  if (stored.digest !== expectedDigest) issues.push('stored report digest is not reproducible');
  if (stored.schema !== WP2_SCHEMA || stored.task !== 'TF-0468') issues.push('stored WP2 schema/task mismatch');
  if (stored.profile !== WP2_PROFILE || stored.opt_in !== true) issues.push('stored profile is not explicitly opted in');

  if (issues.length > 0) { for (const issue of issues) console.error(`[versegit-wp2] FAIL: ${issue}`); process.exitCode = 1; return; }
  console.log(`[versegit-wp2] OK cases=${stored.summary.caseCount} process_calls=${stored.summary.processCalls} single=0 multi=3 missing=0 digest=${stored.digest.slice(0, 12)}`);
}

if (isMainEntrypoint(import.meta.url)) main().catch((error) => { console.error(`[versegit-wp2] FAIL: ${String(error?.stack ?? error)}`); process.exitCode = 1; });