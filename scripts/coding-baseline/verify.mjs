import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isMainEntrypoint } from '../lib/entrypoint.mjs';

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
export const PROBE_FILES = {
  worktrees: 'worktrees/probe-results.json',
  boundaries: 'boundaries/boundary-results.json',
  routing: 'routing/routing-results.json',
  journal: 'journal/journal-results.json',
};

function rows(probe) {
  if (!Array.isArray(probe?.rows) || probe.rows.some((r) => r.error || typeof r.id !== 'string')) {
    throw new Error('missing or failed probe rows');
  }
  const map = new Map(probe.rows.map((r) => [r.id, r]));
  if (map.size !== probe.rows.length) throw new Error('duplicate probe row');
  return (id) => {
    if (!map.has(id)) throw new Error(`missing probe row: ${id}`);
    return map.get(id);
  };
}

// These are the frozen *failure* expectations, not product acceptance. Changing
// an observation requires a new adjudication; absence never means a bug is fixed.
export function evaluateFindings(probes) {
  const w = rows(probes.worktrees);
  const b = rows(probes.boundaries);
  const r = rows(probes.routing);
  const j = rows(probes.journal);
  const trusted = b('denied-write-journal-trusted').actual;
  const external = b('denied-write-journal-external').actual;
  const undo = b('undo-via-junction-workspaceOnly').actual;
  const plan = r('rpc-top-level-isolation').actual;
  const methods = r('stock-gateway-methods').actual;
  const off = r('retired-patch-flow-explicit-false').actual.spawnProbes;
  const on = r('retired-patch-flow-explicit-true').actual.spawnProbes;
  const definitions = [
    ['A1', 'TF-0765', trusted.directReadDenied === true && !!trusted.refused && trusted.copied === true && trusted.readableByReadTool === true && trusted.outsideUnchanged === true && external.directReadDenied === true && !!external.refused && external.copied === false && external.snapshots.length === 0],
    ['A2', 'TF-0766', undo.outsideContents === 'before-local-edit' && undo.undo.ok === true],
    ['A3', 'TF-0767', w('worktree-dotdot-id-deletes-control-directory').actual.markerPreserved === false && w('worktree-dotdot-id-deletes-control-directory').actual.result.id === '..'],
    ['A4', 'TF-0769', w('worktree-deletion-silently-not-merged').actual.baseFileStillExists === true && w('worktree-overwrites-concurrent-base-edit').actual.baseContents === 'worker-change' && w('git-worktree-delete').actual.backend === 'git' && w('git-worktree-delete').actual.contents === 'baseline' && w('git-worktree-delete').actual.result[0].status === 'merged' && w('git-worktree-stale').actual.backend === 'git' && w('git-worktree-stale').actual.contents === 'worker-change' && w('git-worktree-stale').actual.result[0].status === 'merged'],
    ['A5', 'TF-0770', j('patch-sidecar-normal').persisted === 'committed' && j('patch-sidecar-normal').rehydrated === 'committed' && j('patch-sidecar-locked').journalInResult === 'committed' && j('patch-sidecar-locked').persisted === 'prepared' && j('patch-sidecar-locked').rehydrated === 'prepared' && j('patch-sidecar-locked').undoable === true],
    ['A6', 'TF-0768', plan.actual.ok === true && plan.actual.planIsolation === 'shared' && plan.workerOverride.workerIsolation === 'worktree' && r('rpc-run-workspace-carrier').actual.spawnCalls === 0 && r('rpc-run-workspace-carrier').actual.failures.some((f) => f.error.includes('worktree isolation requires a workspaceDir'))],
    ['A7', 'TF-0771', w('coding-run-optional-warning-roundtrip').actual.code === 'MISSING_FIELD' && w('coding-run-nested-schema-validation').actual.status === 'ok' && r('coding-run-cli-optional').actual.exit === 1 && r('coding-run-cli-cross-run').actual.exit === 0 && JSON.parse(r('coding-run-cli-cross-run').actual.stdout).verification === 'passed'],
    ['A8', 'TF-0772', methods['mcp.listTools'] === false && methods['mcp.callTool'] === false && methods['mcp.heartbeat'] === false && methods['tools.catalog'] === true && methods['tools.invoke'] === true],
    ['A9', 'TF-0773', r('mcp-image-real-hook-and-sdk').actual.sdkAccepted === false && r('mcp-error-real-hook').actual.actual.result.isError === false],
    ['A10', 'TF-0774', off.length === 3 && on.length === 3 && off.every((v) => !v.deniedWrite && !v.proposalPrompt) && on.every((v) => v.deniedWrite && v.proposalPrompt)],
  ];
  return definitions.map(([id, repairNode, reproduced]) => ({
    id, repairNode, status: reproduced ? 'reproduced' : 'changed-or-unverified',
    productPass: false,
  }));
}

export function readWithin(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) {
    throw new Error('invalid evidence path');
  }
  const absolute = fs.realpathSync(path.resolve(root, relative));
  const rel = path.relative(fs.realpathSync(root), absolute);
  if (path.isAbsolute(rel) || rel === '..' || rel.startsWith(`..${path.sep}`)) throw new Error('evidence escaped its pack');
  return fs.readFileSync(absolute);
}

export function boundInputPaths(root) {
  const fixture = 'harness/specs/fixtures/coding-vg-sts-jj-baseline/';
  const history = JSON.parse(fs.readFileSync(path.join(root, fixture, 'historical-inputs.json')));
  const scripts = ['scripts/coding-baseline', 'scripts/coding-baseline/probes'].flatMap((dir) =>
    fs.readdirSync(path.join(root, dir)).filter((f) => /\.(mjs|mts|py)$/.test(f)).map((f) => `${dir}/${f}`));
  return [...new Set([...Object.keys(history.sourceStamps), ...scripts,
    `${fixture}historical-inputs.json`, `${fixture}evaluation-protocol.json`, `${fixture}capabilities.json`,
    'harness/specs/tasks/coding-vg-sts-jj-baseline.md',
  ])].sort();
}

export function verifyEvidence(report, { readArtifact, readSource, requiredSources, expectedCandidate } = {}) {
  const issues = [];
  const fail = (condition, message) => { if (!condition) issues.push(message); };
  try {
    fail(report.schema === 'CodingBaselineEvidence/v1', 'wrong schema');
    fail(report.driven_by === 'agent' && report.realHumanEvidence === false && !!report.actor, 'missing attribution');
    fail(report.candidate?.dirty === false && /^[0-9a-f]{40}$/.test(report.candidate?.commit ?? ''), 'candidate is not clean/frozen');
    if (expectedCandidate) fail(report.candidate.commit === expectedCandidate, 'candidate mismatch');
    fail(report.productVerdict === 'needs-fix' && report.releaseApproved === false, 'baseline promoted to product acceptance');
    fail(report.protocolScope === 'mechanism-baseline-not-performance-or-live-quality', 'scope upgraded');
    const paths = report.sourceInputs.map((input) => input.path);
    fail(new Set(paths).size === paths.length, 'duplicate source input');
    for (const source of requiredSources ?? []) fail(paths.includes(source), `missing source input: ${source}`);
    for (const input of report.sourceInputs) fail(sha256(readSource(input.path)) === input.sha256, `source changed: ${input.path}`);
    for (const [name, artifact] of Object.entries(report.artifacts)) fail(sha256(readArtifact(name)) === artifact.sha256, `artifact changed: ${name}`);
    const probes = {};
    for (const [name, relative] of Object.entries(PROBE_FILES)) {
      fail(!!report.artifacts[relative], `missing artifact binding: ${relative}`);
      probes[name] = JSON.parse(readArtifact(relative));
      fail(probes[name].candidate === report.candidate.commit, `probe candidate mismatch: ${name}`);
      fail(probes[name].driven_by === 'agent' && probes[name].realHumanEvidence === false, `probe attribution: ${name}`);
      const commands = report.commands.filter((c) => c.probe === name);
      fail(commands.length === 1 && commands[0].exitCode === 0 && commands[0].timedOut === false, `probe command incomplete: ${name}`);
    }
    const actual = evaluateFindings(probes);
    fail(JSON.stringify(report.findings) === JSON.stringify(actual), 'findings do not match raw values');
    fail(actual.every((f) => f.status === 'reproduced'), 'frozen failure expectation changed; investigate before closing C0');
    fail(report.artifacts['inventory.json'] !== undefined, 'inventory is unbound');
    const inventory = JSON.parse(readArtifact('inventory.json'));
    fail(inventory.vg?.binaryMatchesManifest === true && inventory.vs?.binaryMatchesManifest === true, 'binary identity mismatch');
    fail(inventory.sts?.contracts?.length === 2 && inventory.sts.contracts.every((c) => c.invalid.length === 0), 'STS contracts incomplete');
    fail(inventory.sts?.wheel?.sha256?.length === 64 && inventory.sts.wheel.binding?.verified === true && inventory.sts.environment?.python, 'STS installation/package identity missing');
    fail(inventory.jj?.libraryVersion === '0.46.0' && inventory.jj.cliClaim === 'not-executed', 'JJ scope is not explicit');
    fail(inventory.corpus?.length === 3 && inventory.corpus.every((c) => c.verified === true), 'corpus input not frozen');
    fail(report.baselineVerdict === 'established', 'baseline not established');
  } catch (error) {
    issues.push(`unreadable or malformed evidence: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { ok: issues.length === 0, issues, productVerdict: 'needs-fix' };
}

if (isMainEntrypoint(import.meta.url)) {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: node scripts/coding-baseline/verify.mjs <report.json>');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const report = JSON.parse(fs.readFileSync(file));
  const result = verifyEvidence(report, {
    readArtifact: (p) => readWithin(path.dirname(path.resolve(file)), p),
    readSource: (p) => readWithin(root, p), requiredSources: boundInputPaths(root),
  });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}
