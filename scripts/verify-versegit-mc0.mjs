#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { validateMc0Baseline, writeMc0Baseline } from './versegit-mc0-baseline.mjs';

function main() {
  const repoIndex = process.argv.indexOf('--repo');
  const repo = repoIndex >= 0 ? resolve(process.argv[repoIndex + 1]) : resolve(process.cwd(), '..', 'VerseGit');
  const artifactIndex = process.argv.indexOf('--artifact');
  const artifact = artifactIndex >= 0
    ? resolve(process.argv[artifactIndex + 1])
    : resolve(process.cwd(), 'harness/specs/fixtures/versegit-planning-correction/mc0-evidence/baseline.json');
  const requireDeliverable = process.argv.includes('--require-deliverable');
  if (!existsSync(artifact)) {
    console.error(`[versegit-mc0] FAIL: artifact missing: ${artifact}`);
    process.exitCode = 1;
    return;
  }
  const baseline = JSON.parse(readFileSync(artifact, 'utf8'));
  const issues = [];
  const validation = validateMc0Baseline(baseline, { requireDeliverable });
  issues.push(...validation.issues);
  const live = writeMc0Baseline({ repo, output: artifact }).baseline;
  if (live.source.head !== baseline.source.head) issues.push('live source head differs from frozen baseline');
  if (live.source.tree !== baseline.source.tree) issues.push('live source tree differs from frozen baseline');
  if (live.binary.sha256 !== baseline.binary.sha256) issues.push('live binary digest differs from frozen baseline');
  if (baseline.deliverable === 'eligible' && live.source.status !== 'clean') issues.push('eligible baseline source is no longer clean');
  if (requireDeliverable && baseline.deliverable !== 'eligible') issues.push('deliverable baseline required');
  if (!requireDeliverable && baseline.deliverable !== 'rejected') issues.push('diagnostic baseline must explicitly reject dirty source');
  if (issues.length > 0) {
    for (const issue of issues) console.error(`[versegit-mc0] FAIL: ${issue}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[versegit-mc0] OK deliverable=${baseline.deliverable} head=${baseline.source.head} binary=${baseline.binary.sha256.slice(0, 12)}`);
}

if (isMainEntrypoint(import.meta.url)) main();