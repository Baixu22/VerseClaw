#!/usr/bin/env node
// WP1 verifier: rebuild the observation stream from the fixture, compare it byte-for-byte
// with the stored evidence, and independently re-fire duplicate, stale, owner, session and
// cleanup-barrier cases. The stored JSONL alone is never accepted as proof.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import {
  WP1_FIXTURE_PATH, WP1_OBSERVATION_MODULE_PATH, buildWp1Evidence, loadObservationBridge, validateWp1Report,
} from './versegit-wp1-observation.mjs';
import { sha256 } from './versegit-mc5-differential.mjs';

const root = process.env.VERSEGIT_WP1_ROOT ? resolve(process.env.VERSEGIT_WP1_ROOT) : resolve(process.cwd());
function at(flag) { const i = process.argv.indexOf(flag); return i >= 0 ? resolve(process.argv[i + 1]) : undefined; }

async function main() {
  const eventsPath = at('--events') ?? resolve(root, 'harness/specs/fixtures/versegit-planning-correction/wp1-evidence/events.jsonl');
  const reportPath = at('--report') ?? resolve(root, 'harness/specs/fixtures/versegit-planning-correction/wp1-evidence/events-report.json');
  if (!existsSync(eventsPath) || !existsSync(reportPath)) {
    console.error('[versegit-wp1] FAIL: events or report artifact missing');
    process.exitCode = 1;
    return;
  }
  const issues = [];
  const storedEventsText = readFileSync(eventsPath, 'utf8');
  const stored = JSON.parse(readFileSync(reportPath, 'utf8'));
  issues.push(...validateWp1Report(stored).issues.map((issue) => `stored: ${issue}`));
  const lines = storedEventsText.split(/\r?\n/u).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch { issues.push(`stored events line ${index + 1} is not JSON`); return null; }
  }).filter(Boolean);

  const rebuilt = await buildWp1Evidence({ root });
  issues.push(...validateWp1Report(rebuilt.report).issues.map((issue) => `live: ${issue}`));
  if (stored.digest !== rebuilt.report.digest) issues.push('stored report digest differs from the live replay');
  if (stored.eventsDigest !== rebuilt.report.eventsDigest) issues.push('stored events digest differs from the live replay');
  if (storedEventsText !== rebuilt.eventLinesText) issues.push('stored events are not byte-identical to the live replay');
  if (lines.length !== 20) issues.push(`stored event lines must be 20, got ${lines.length}`);

  const fixture = JSON.parse(readFileSync(resolve(root, WP1_FIXTURE_PATH), 'utf8'));
  if (stored.fixtureDigest !== sha256(readFileSync(resolve(root, WP1_FIXTURE_PATH)))) issues.push('fixture digest drifted');
  if (stored.observationModuleDigest !== sha256(readFileSync(resolve(root, WP1_OBSERVATION_MODULE_PATH), 'utf8'))) issues.push('observation module digest drifted');
  const source = readFileSync(resolve(root, WP1_OBSERVATION_MODULE_PATH), 'utf8');
  for (const forbidden of ['child_process', 'execFileSync', 'spawnSync', 'vg land', 'vg admit']) {
    if (source.includes(forbidden)) issues.push(`observation bridge contains forbidden execution or landing surface: ${forbidden}`);
  }
  for (const marker of ['src/a.ts', 'src/b.ts', 'pnpm test', 'https://example.invalid', 'mystery_tool']) {
    if (storedEventsText.includes(marker)) issues.push(`raw payload leaked into stored events: ${marker}`);
  }

  const module = await loadObservationBridge({ root });
  let duplicateCount = 0;
  let staleCount = 0;
  let rejectedCount = 0;
  const bridge = new module.VerseGitObservationBridge({ maxSeenKeys: 8, maxTombstones: 2 });
  const a = fixture.bindings.a;
  const b = fixture.bindings.b;
  if (bridge.bind(a).status !== 'attached' || bridge.bind(b).status !== 'attached') issues.push('two independent sessions must attach');
  const started = { type: 'tool.started', runId: 'run-a', sessionKey: 'session-a', seq: 1, ts: 2000, toolCallId: 'dup', name: 'Read', args: { path: 'secret/path.ts' } };
  const first = bridge.ingest(started, { epoch: 2, ownerId: 'owner-a', eventId: 'same' });
  const duplicate = bridge.ingest(started, { epoch: 2, ownerId: 'owner-a', eventId: 'same' });
  if (first.status !== 'observed') issues.push('independent first event must be observed');
  if (duplicate.status !== 'duplicate') issues.push('independent duplicate must be rejected as duplicate');
  else duplicateCount += 1;
  if (bridge.ingest(started, { epoch: 1, ownerId: 'owner-a', eventId: 'old' }).status === 'stale') staleCount += 1;
  else issues.push('old epoch must be stale');
  if (bridge.ingest(started, { epoch: 2, ownerId: 'owner-b', eventId: 'wrong-owner' }).status === 'rejected_by_policy') rejectedCount += 1;
  else issues.push('wrong owner must be rejected');
  if (bridge.ingest({ ...started, sessionKey: 'session-b' }, { epoch: 2, ownerId: 'owner-a', eventId: 'wrong-session' }).status === 'rejected_by_policy') rejectedCount += 1;
  else issues.push('wrong session must be rejected');
  const seal = bridge.detach('run-a', { epoch: 2, ownerId: 'owner-a', at: 3000 });
  if (seal.status !== 'detached' || seal.coverage?.values.shellRead !== 'unobserved' || seal.coverage?.values.directFs !== 'unobserved') issues.push('cleanup seal must preserve unobserved coverage');
  if (bridge.ingest(started, { epoch: 2, ownerId: 'owner-a', eventId: 'late' }).status === 'stale') staleCount += 1;
  else issues.push('late event after detach must be stale');

  const expectedEventSurfaceCounts = { 'file.read': 2, 'file.write': 1, 'repo.search': 1, test: 2, mcp: 1, network: 1, control: 4 };
  if (JSON.stringify(stored.emittedSurfaceCounts) !== JSON.stringify(expectedEventSurfaceCounts)) issues.push('stored surface counts drifted');
  if (stored.coverage?.fileRead !== 'host-event' || stored.coverage?.fileWrite !== 'host-event' || stored.coverage?.shellRead !== 'unobserved' || stored.coverage?.shellWrite !== 'inferred' || stored.coverage?.directFs !== 'unobserved') issues.push('stored coverage semantics drifted');
  if (stored.crossWorktreeViolations !== 0) issues.push('cross-worktree violations must remain zero');
  if (stored.host_verdict !== 'unchanged') issues.push('host verdict must remain unchanged');
  if (duplicateCount !== 1 || staleCount < 2 || rejectedCount < 2) issues.push(`independent negative controls failed duplicate=${duplicateCount} stale=${staleCount} rejected=${rejectedCount}`);

  if (issues.length > 0) {
    for (const issue of issues) console.error(`[versegit-wp1] FAIL: ${issue}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[versegit-wp1] OK lines=${stored.eventLineCount} behavior_events=${stored.behaviorEventCount} sessions=${stored.sessionEndCount} digest=${stored.digest.slice(0, 12)}`);
}

if (isMainEntrypoint(import.meta.url)) {
  main().catch((error) => { console.error(`[versegit-wp1] FAIL: ${String(error?.stack ?? error)}`); process.exitCode = 1; });
}