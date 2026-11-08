import { createHash } from 'node:crypto';

export function verifyVerseGitEvaluation(report, expectedManifest) {
  const issues = [];
  const check = (value, message) => { if (!value) issues.push(message); };
  check(report?.schema === 'CodingVgEvaluation/v1', 'evaluation schema mismatch');
  check(report?.driven_by === 'agent' && report?.realHumanEvidence === false, 'attribution missing');
  check(/^[a-f0-9]{64}$/.test(report?.binary?.sha256 ?? '') && /^[a-f0-9]{64}$/.test(report?.binary?.capabilitiesSha256 ?? ''), 'binary identity missing');
  check(report?.binary?.sha256 === report?.manifest?.binarySha256, 'binary digest mismatch');
  check(report?.binary?.capabilitiesSha256 === report?.manifest?.capabilitiesSha256, 'capabilities digest mismatch');
  // The report's embedded identity is data; compare it with the frozen caller-owned manifest.
  check(report?.binary?.sha256 === expectedManifest?.binarySha256, 'binary differs from frozen manifest');
  check(report?.binary?.capabilitiesSha256 === expectedManifest?.capabilitiesSha256, 'capabilities differ from frozen manifest');
  check(report?.manifest?.sourceCommit === expectedManifest?.sourceCommit && /^[a-f0-9]{40}$/.test(report?.manifest?.sourceCommit ?? ''), 'provider source identity missing or changed');
  const entries = Array.isArray(report?.cases) ? report.cases : [];
  const cases = new Map(entries.map((entry) => [entry?.id, entry]));
  for (const id of ['m0-inert', 'm1-capabilities', 'm2-read', 'm3-bounded-read', 'owner-rejected', 'epoch-rejected',
    'binary-rejected', 'm4-rejected', 'six-dimensions', 'selected-rejected', 'stale-rejected', 'candidate-rejected',
    'observed-write-risk', 'rename-unobserved', 'delete-unobserved', 'missing-basis-partial']) {
    check(cases.get(id)?.passed === true, `missing/failed case: ${id}`);
  }
  const rejected = ['owner-rejected','epoch-rejected','binary-rejected','m4-rejected'];
  check(cases.get('m0-inert')?.actual?.observation?.process_started === false, 'M0 process effect');
  check(cases.get('m1-capabilities')?.actual?.status === 'observed' && cases.get('m1-capabilities')?.actual?.observation?.effects?.domainStateWrite === false, 'M1 effect mismatch');
  for (const id of ['m2-read','m3-bounded-read']) {
    const actual = cases.get(id)?.actual;
    check(actual?.status === 'observed' && actual?.observation?.effects?.workspaceWrite === false && actual?.observation?.effects?.execute === false, `bounded mode effect mismatch: ${id}`);
  }
  for (const id of rejected) check(cases.get(id)?.actual?.status === 'rejected_by_policy' && cases.get(id)?.actual?.observation?.process_started === false, `invalid authority accepted: ${id}`);
  for (const id of ['selected-rejected','stale-rejected','candidate-rejected']) check(cases.get(id)?.actual?.admitted === false, `invalid verdict admitted: ${id}`);
  check(Array.isArray(cases.get('observed-write-risk')?.actual) && cases.get('observed-write-risk').actual.length === 1, 'observed risk missing');
  for (const id of ['rename-unobserved','delete-unobserved']) check(cases.get(id)?.actual?.values?.directFs === 'unobserved', `unobserved effect promoted: ${id}`);
  check(cases.get('missing-basis-partial')?.actual?.status === 'partial', 'missing basis promoted');
  check(cases.size === report?.cases?.length, 'duplicate case identity');
  const six = cases.get('six-dimensions')?.actual;
  check(six?.admitted === true && six?.single_green_light === false && Object.keys(six?.dimensions ?? {}).length === 6, 'six-dimension facts collapsed');
  check(report?.cleanup?.ownedProcessSurvivors === 0 && report?.cleanup?.hostWorktreesDeleted === 0, 'process or worktree cleanup missing');
  check(Array.isArray(report?.commands) && report.commands.length > 0, 'command evidence missing');
  for (const command of Array.isArray(report?.commands) ? report.commands : []) {
    if (!command || typeof command !== 'object' || typeof command.stdout !== 'string') {
      issues.push('malformed command record');
      continue;
    }
    check(Number.isInteger(command.exitCode), `command exit missing: ${command.id}`);
    check(command.outputSha256 === createHash('sha256').update(command.stdout).digest('hex'), `command output changed: ${command.id}`);
  }
  return { ok: issues.length === 0, issues };
}
