#!/usr/bin/env node
// WP1 evidence harness: drive the shipped observation bridge with host-runtime-shaped
// events from two worktrees, then persist the normalized event chain and a digest-bound
// report. The bridge is imported directly; no parallel implementation is used.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const repositoryRoot = process.env.VERSEGIT_WP1_ROOT
  ? resolve(process.env.VERSEGIT_WP1_ROOT)
  : resolve(process.cwd());

export const WP1_SCHEMA = 'clawx.versegit.wp1-evidence-report/v1';
export const WP1_FIXTURE_PATH = 'harness/specs/fixtures/versegit-planning-correction/wp1-observation-fixture.json';
export const WP1_OBSERVATION_MODULE_PATH = 'electron/services/versegit-observation.ts';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function readText(path) {
  if (!existsSync(path)) throw new Error(`missing file: ${path}`);
  return readFileSync(path, 'utf8');
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function partialMatch(actual, expected) {
  if (expected === null) return actual === null;
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && expected.length === actual.length
      && expected.every((entry, index) => partialMatch(actual[index], entry));
  }
  if (expected && typeof expected === 'object') {
    return !!actual && typeof actual === 'object'
      && Object.entries(expected).every(([key, value]) => partialMatch(actual[key], value));
  }
  return actual === expected;
}

export async function loadObservationBridge({ root = repositoryRoot } = {}) {
  const modulePath = resolve(root, WP1_OBSERVATION_MODULE_PATH);
  if (!existsSync(modulePath)) throw new Error(`missing observation bridge: ${WP1_OBSERVATION_MODULE_PATH}`);
  return import(pathToFileURL(modulePath).href);
}

function normalizeOutcome(step, result, module) {
  return {
    schema: module.VG_OBSERVATION_BATCH_SCHEMA,
    operationSchema: result.schema,
    fixtureStepId: step.id,
    op: step.op,
    bindingKey: step.binding ?? null,
    status: result.status,
    why: result.why ?? null,
    eventId: result.event?.eventId ?? result.sessionEnd?.eventId ?? null,
    event: result.event ?? null,
    sessionEnd: result.sessionEnd ?? null,
    sealCoverage: result.coverage ?? null,
    dedupeKey: result.dedupeKey ?? null,
    issues: result.issues ?? [],
    observationBinding: result.binding ?? null,
    host_verdict: result.host_verdict,
  };
}

function checkOutcome(step, outcome, issues) {
  const expected = step.expected ?? {};
  if (!partialMatch(outcome.status, expected.status)) issues.push(`${step.id}: status ${outcome.status} != ${expected.status}`);
  if ('event' in expected && !partialMatch(outcome.event, expected.event)) issues.push(`${step.id}: event did not match the expected projection`);
  if ('sessionEnd' in expected && !partialMatch(outcome.sessionEnd, expected.sessionEnd)) issues.push(`${step.id}: sessionEnd did not match the expected projection`);
  if (outcome.host_verdict !== 'unchanged') issues.push(`${step.id}: host verdict changed`);
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

export async function buildWp1Evidence({ root = repositoryRoot } = {}) {
  const fixturePath = resolve(root, WP1_FIXTURE_PATH);
  const fixtureText = readText(fixturePath);
  const fixture = JSON.parse(fixtureText);
  const module = await loadObservationBridge({ root });
  const bridge = new module.VerseGitObservationBridge({ maxSeenKeys: 128, maxTombstones: 16 });
  const bindings = fixture.bindings ?? {};
  const outcomes = [];
  const issues = [];

  for (const step of fixture.steps ?? []) {
    let result;
    if (step.op === 'bind') {
      const binding = bindings[step.binding];
      if (!binding) { issues.push(`${step.id}: unknown binding ${step.binding}`); continue; }
      result = bridge.bind(binding);
    } else if (step.op === 'ingest') {
      if (!step.event) { issues.push(`${step.id}: missing event`); continue; }
      result = bridge.ingest(step.event, step.context ?? {});
    } else if (step.op === 'detach') {
      const binding = bindings[step.binding];
      if (!binding) { issues.push(`${step.id}: unknown binding ${step.binding}`); continue; }
      result = bridge.detach(binding.runId, step.options ?? {});
    } else {
      issues.push(`${step.id}: unsupported operation ${step.op}`);
      continue;
    }
    const outcome = normalizeOutcome(step, result, module);
    outcomes.push(outcome);
    checkOutcome(step, outcome, issues);
  }

  const emittedEvents = outcomes.filter((entry) => entry.event);
  const sessionEnds = outcomes.filter((entry) => entry.sessionEnd);
  const allEvents = [...emittedEvents, ...sessionEnds];
  for (const entry of allEvents) {
    const event = entry.event ?? entry.sessionEnd;
    if (!event || event.repoId !== 'repo-alpha') issues.push(`${entry.fixtureStepId}: event lost the canonical repo identity`);
    if (event?.runId === 'run-a' && event.worktreeId !== 'worktree-a') issues.push(`${entry.fixtureStepId}: run-a crossed into ${event.worktreeId}`);
    if (event?.runId === 'run-b' && event.worktreeId !== 'worktree-b') issues.push(`${entry.fixtureStepId}: run-b crossed into ${event.worktreeId}`);
    if (!event?.traceId || !event?.agentSessionId || !event?.vgSessionId) issues.push(`${entry.fixtureStepId}: event is missing trace/session identity`);
  }

  const statuses = countBy(outcomes.map((entry) => entry.status));
  const expectedCounts = {
    attached: 3, detached: 3, observed: 6, partial: 2, unobserved: 1, duplicate: 1, stale: 2, rejected_by_policy: 2,
  };
  for (const [status, count] of Object.entries(expectedCounts)) {
    if ((statuses[status] ?? 0) !== count) issues.push(`status ${status}: expected ${count}, got ${statuses[status] ?? 0}`);
  }
  if (outcomes.length !== 20) issues.push(`expected 20 fixture steps, got ${outcomes.length}`);
  if (emittedEvents.length !== 9) issues.push(`expected 9 behavior events, got ${emittedEvents.length}`);
  if (sessionEnds.length !== 3) issues.push(`expected 3 session-end events, got ${sessionEnds.length}`);
  if (bridge.activeSessionCount !== 0) issues.push(`expected zero active sessions after cleanup, got ${bridge.activeSessionCount}`);

  const detachedA = outcomes.find((entry) => entry.fixtureStepId === 'detach-a');
  const detachedB = outcomes.find((entry) => entry.fixtureStepId === 'detach-b');
  if (detachedA?.sessionEnd && detachedA.sessionEnd.worktreeId !== 'worktree-a') issues.push('detach-a crossed worktrees');
  if (detachedB?.sessionEnd && detachedB.sessionEnd.worktreeId !== 'worktree-b') issues.push('detach-b crossed worktrees');
  const coverageRank = { unobserved: 0, dropped: 1, partial: 2, inferred: 3, 'host-event': 4, direct: 5 };
  const coverageUnion = { fileRead: 'unobserved', fileWrite: 'unobserved', search: 'unobserved', shellRead: 'unobserved', shellWrite: 'unobserved', mcpRead: 'unobserved', mcpWrite: 'unobserved', network: 'unobserved', browser: 'unobserved', directFs: 'unobserved' };
  for (const entry of outcomes) {
    for (const [key, value] of Object.entries(entry.sealCoverage?.values ?? {})) {
      if ((coverageRank[value] ?? 0) > (coverageRank[coverageUnion[key]] ?? 0)) coverageUnion[key] = value;
    }
  }

  // The line shape intentionally contains normalized digests rather than raw args/results.
  const rawMarkers = ['src/a.ts', 'src/b.ts', 'pnpm test', 'https://example.invalid', 'mystery_tool'];
  const serialized = JSON.stringify(outcomes);
  for (const marker of rawMarkers) if (serialized.includes(marker)) issues.push(`raw payload leaked into evidence: ${marker}`);

  const eventLinesText = outcomes.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
  const source = readText(resolve(root, WP1_OBSERVATION_MODULE_PATH));
  const sessions = outcomes
    .filter((entry) => entry.sessionEnd)
    .map((entry) => ({
      fixtureStepId: entry.fixtureStepId,
      runId: entry.sessionEnd.runId,
      repoId: entry.sessionEnd.repoId,
      worktreeId: entry.sessionEnd.worktreeId,
      agentSessionId: entry.sessionEnd.agentSessionId,
      epoch: entry.sessionEnd.epoch,
      coverage: entry.sealCoverage,
    }));

  const report = {
    reportSchema: WP1_SCHEMA,
    generated_at: new Date().toISOString(),
    driven_by: 'agent',
    actor: 'codex',
    task: 'TF-0467',
    fixture: WP1_FIXTURE_PATH,
    fixtureDigest: sha256(fixtureText),
    observationModule: WP1_OBSERVATION_MODULE_PATH,
    observationModuleDigest: sha256(source),
    eventLineCount: outcomes.length,
    behaviorEventCount: emittedEvents.length,
    sessionEndCount: sessionEnds.length,
    statusCounts: statuses,
    emittedSurfaceCounts: countBy(allEvents.map((entry) => (entry.event ?? entry.sessionEnd).surface)),
    emittedCoverageCounts: countBy(allEvents.map((entry) => (entry.event ?? entry.sessionEnd).coverage)),
    sessions,
    duplicateRejectedWithoutCount: outcomes.some((entry) => entry.fixtureStepId === 'duplicate-read-start-a' && entry.status === 'duplicate'),
    staleRejectedWithoutCount: outcomes.filter((entry) => entry.status === 'stale').length === 2,
    wrongOwnerRejected: outcomes.some((entry) => entry.fixtureStepId === 'wrong-owner-a' && entry.status === 'rejected_by_policy'),
    wrongSessionRejected: outcomes.some((entry) => entry.fixtureStepId === 'wrong-session-a' && entry.status === 'rejected_by_policy'),
    crossWorktreeViolations: allEvents.filter((entry) => {
      const event = entry.event ?? entry.sessionEnd;
      return (event.runId === 'run-a' && event.worktreeId !== 'worktree-a') || (event.runId === 'run-b' && event.worktreeId !== 'worktree-b');
    }).length,
    coverage: coverageUnion,
    eventsDigest: `sha256:${sha256(eventLinesText)}`,
    host_verdict: 'unchanged',
    boundaries: {
      vg_process_started: false,
      workspace_write: false,
      default_on: false,
      renderer_route_added: false,
      harness_profile_added: false,
      land_or_admit_invoked: false,
      host_worktree_deleted: false,
      raw_payload_stored: false,
      note: 'WP1 normalizes host events only. Profile wiring, VG attachment and cleanup deletion belong to WP2/WP5.',
    },
    passed: issues.length === 0,
    issues,
  };
  report.digest = sha256(JSON.stringify({ ...report, generated_at: undefined, digest: undefined }));
  return { fixture, report, outcomes, eventLinesText, issues };
}

export function validateWp1Report(report) {
  const issues = [];
  if (report?.reportSchema !== WP1_SCHEMA) issues.push(`reportSchema must be ${WP1_SCHEMA}`);
  if (report?.driven_by !== 'agent' || report?.actor !== 'codex') issues.push('evidence must be honestly marked as agent-driven');
  if (report?.task !== 'TF-0467') issues.push('report task must be TF-0467');
  if (report?.fixture !== WP1_FIXTURE_PATH) issues.push('fixture path mismatch');
  if (!/^[0-9a-f]{64}$/u.test(String(report?.fixtureDigest ?? ''))) issues.push('fixture digest missing');
  if (report?.observationModule !== WP1_OBSERVATION_MODULE_PATH) issues.push('observation module path mismatch');
  if (!/^[0-9a-f]{64}$/u.test(String(report?.observationModuleDigest ?? ''))) issues.push('observation module digest missing');
  if (!/^sha256:[0-9a-f]{64}$/u.test(String(report?.eventsDigest ?? ''))) issues.push('events digest missing');
  if (report?.eventLineCount !== 20 || report?.behaviorEventCount !== 9 || report?.sessionEndCount !== 3) issues.push('event counts do not match the WP1 fixture');
  const expectedCounts = { attached: 3, detached: 3, observed: 6, partial: 2, unobserved: 1, duplicate: 1, stale: 2, rejected_by_policy: 2 };
  for (const [status, count] of Object.entries(expectedCounts)) {
    if (report?.statusCounts?.[status] !== count) issues.push(`statusCounts.${status} must be ${count}`);
  }
  if (!Array.isArray(report?.sessions) || report.sessions.length !== 3) issues.push('three detached session coverage snapshots are required');
  if ((report?.sessions ?? []).some((session) => !session.coverage?.values || !Array.isArray(session.coverage?.knownGaps))) issues.push('each session must retain coverage values and known gaps');
  if (JSON.stringify(report?.emittedSurfaceCounts) !== JSON.stringify({ 'file.read': 2, 'file.write': 1, 'repo.search': 1, test: 2, mcp: 1, network: 1, control: 4 })) issues.push('emitted surface counts drifted');
  if (JSON.stringify(report?.emittedCoverageCounts) !== JSON.stringify({ 'host-event': 9, partial: 2, unobserved: 1 })) issues.push('emitted coverage counts drifted');
  if (report?.crossWorktreeViolations !== 0) issues.push('cross-worktree violations must be zero');
  if (report?.duplicateRejectedWithoutCount !== true) issues.push('duplicate replay must be rejected without double counting');
  if (report?.staleRejectedWithoutCount !== true) issues.push('stale events must be rejected');
  if (report?.wrongOwnerRejected !== true) issues.push('wrong-owner events must be rejected');
  if (report?.wrongSessionRejected !== true) issues.push('wrong-session events must be rejected');
  if (report?.coverage?.fileRead !== 'host-event' || report?.coverage?.fileWrite !== 'host-event') issues.push('host file events must be recorded as host-event coverage');
  if (report?.coverage?.shellRead !== 'unobserved' || report?.coverage?.shellWrite !== 'inferred') issues.push('shell coverage must preserve unobserved/inferred semantics');
  if (report?.coverage?.mcpRead !== 'partial' || report?.coverage?.mcpWrite !== 'partial' || report?.coverage?.directFs !== 'unobserved') issues.push('partial coverage must remain explicit');
  if (report?.host_verdict !== 'unchanged') issues.push('WP1 must never change the host verdict');
  for (const field of ['vg_process_started', 'workspace_write', 'default_on', 'renderer_route_added', 'harness_profile_added', 'land_or_admit_invoked', 'host_worktree_deleted', 'raw_payload_stored']) {
    if (report?.boundaries?.[field] !== false) issues.push(`boundary ${field} must be false`);
  }
  if (report?.passed !== true || (report?.issues ?? []).length !== 0) issues.push('report did not pass its own assertions');
  if (report?.digest !== sha256(JSON.stringify({ ...report, generated_at: undefined, digest: undefined }))) issues.push('report digest is not reproducible');
  return { ok: issues.length === 0, issues };
}

export async function writeWp1Evidence({ root = repositoryRoot, eventsOutput, reportOutput } = {}) {
  const built = await buildWp1Evidence({ root });
  const eventsPath = eventsOutput
    ? resolve(eventsOutput)
    : resolve(root, 'harness/specs/fixtures/versegit-planning-correction/wp1-evidence/events.jsonl');
  const reportPath = reportOutput
    ? resolve(reportOutput)
    : resolve(root, 'harness/specs/fixtures/versegit-planning-correction/wp1-evidence/events-report.json');
  mkdirSync(dirname(eventsPath), { recursive: true });
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(eventsPath, built.eventLinesText, 'utf8');
  writeFileSync(reportPath, `${JSON.stringify(built.report, null, 2)}\n`, 'utf8');
  return { eventsPath, reportPath, ...built, validation: validateWp1Report(built.report) };
}

async function main() {
  const at = (flag) => {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? resolve(process.argv[i + 1]) : undefined;
  };
  const result = await writeWp1Evidence({ eventsOutput: at('--events-out'), reportOutput: at('--report-out') });
  console.log(JSON.stringify({
    events: result.eventsPath,
    report: result.reportPath,
    passed: result.report.passed,
    lines: result.report.eventLineCount,
    behavior_events: result.report.behaviorEventCount,
    sessions: result.report.sessionEndCount,
    statuses: result.report.statusCounts,
    validation: result.validation,
  }, null, 2));
  if (!result.validation.ok) process.exitCode = 1;
}

if (isMainEntrypoint(import.meta.url)) {
  main().catch((error) => { console.error(String(error?.stack ?? error)); process.exitCode = 1; });
}