import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REQUIRED_PROFILES = ['dcs-coding', 'sekb-assisted', 'browser-supervised'];

function addError(errors, condition, message) {
  if (!condition) errors.push(message);
}

export function validateTf0009AgentSurrogateCharter(charter) {
  const errors = [];
  const current = charter?.schema === 'tf0009-agent-surrogate-charter/v2';
  addError(errors, current || charter?.schema === 'tf0009-agent-surrogate-charter/v1', 'charter schema mismatch');
  addError(errors, charter?.authority === 'user-directed-agent-surrogate', 'charter authority mismatch');
  addError(errors, charter?.evidenceClass === 'engineering-agent-surrogate', 'charter evidence class mismatch');
  addError(errors, charter?.humanEquivalent === false, 'charter must keep humanEquivalent=false');
  addError(errors, charter?.liveEvidence === false, 'charter must keep liveEvidence=false');
  addError(errors, charter?.requiredRunsPerProfile === 10, 'charter requires exactly 10 runs per profile');
  addError(errors, charter?.terminalTaskStatus === (current ? 'done' : 'review_needed'), 'charter terminal status mismatch');
  addError(errors, charter?.mayMarkDone === current, 'charter closure authority mismatch');
  if (current) {
    addError(errors, charter?.policy === 'AGENTS.md#human-in-the-loop-2026-09-27', 'charter policy mismatch');
    addError(errors, charter?.driven_by === 'agent', 'charter must be agent driven');
  }
  addError(errors, charter?.mayReleaseTF0011 === false, 'charter must not self-authorize TF-0011 release');
  addError(errors, charter?.hardBounds?.liveReady === false, 'liveReady lock drifted');
  addError(errors, charter?.hardBounds?.productApproved === false, 'productApproved lock drifted');
  addError(errors, charter?.hardBounds?.defaultOn === false, 'defaultOn lock drifted');
  addError(errors, charter?.hardBounds?.c1ReductionFactor === 4.5, 'C1 reduction lock drifted');
  addError(errors, charter?.hardBounds?.c1MeetsGate === false, 'C1 gate lock drifted');
  addError(errors, charter?.hardBounds?.c1Recommendation === 'keep-off', 'C1 recommendation drifted');
  addError(errors, charter?.hardBounds?.tf0006 === 'blocked', 'TF-0006 lock drifted');
  addError(errors, charter?.hardBounds?.sekbAutoWriteback === false, 'SEKB auto-writeback lock drifted');
  addError(errors, charter?.hardBounds?.browserPrivateNetwork === 'deny', 'Browser private-network lock drifted');
  addError(errors, charter?.hardBounds?.runtimeMemory === 'diagnostics-only', 'Runtime Memory boundary drifted');

  const profiles = new Map((charter?.profiles ?? []).map((profile) => [profile.id, profile]));
  for (const id of REQUIRED_PROFILES) {
    const profile = profiles.get(id);
    addError(errors, Boolean(profile), `missing charter profile ${id}`);
    addError(errors, profile?.operator?.kind === 'agent', `${id} operator must be an agent`);
    addError(errors, typeof profile?.componentPath === 'string' && profile.componentPath.length > 0, `${id} componentPath missing`);
    addError(errors, Array.isArray(profile?.stopConditions) && profile.stopConditions.length > 0, `${id} stopConditions missing`);
  }
  return { ok: errors.length === 0, errors };
}

export function validateTf0009AgentSurrogateReport(report) {
  const errors = [];
  const current = report?.schema === 'tf0009-agent-surrogate-report/v2';
  addError(errors, current || report?.schema === 'tf0009-agent-surrogate-report/v1', 'report schema mismatch');
  addError(errors, report?.authority === 'engineering-agent-surrogate-only', 'report authority mismatch');
  addError(errors, report?.result === (current ? 'agent-acceptance-complete' : 'degraded-engineering-complete'), 'report result mismatch');
  addError(errors, report?.humanEquivalent === false, 'report must keep humanEquivalent=false');
  addError(errors, report?.liveEvidence === false, 'report must keep liveEvidence=false');
  addError(errors, report?.taskForest?.recommendedStatus === (current ? 'done' : 'review_needed'), 'recommended status mismatch');
  addError(errors, report?.taskForest?.canMarkDone === current, 'report closure authority mismatch');
  addError(errors, report?.taskForest?.canReleaseTF0011 === false, 'report must not self-authorize TF-0011 release');
  addError(errors, report?.humanQualifyingRuns?.['dcs-coding'] === 0, 'DCS human count must stay zero');
  addError(errors, report?.humanQualifyingRuns?.['sekb-assisted'] === 0, 'SEKB human count must stay zero');
  addError(errors, report?.humanQualifyingRuns?.['browser-supervised'] === 0, 'Browser human count must stay zero');

  const runs = Array.isArray(report?.runs) ? report.runs : [];
  addError(errors, runs.length === 30, 'report must contain exactly 30 agent runs');
  for (const id of REQUIRED_PROFILES) {
    const profileRuns = runs.filter((run) => run?.profile === id);
    addError(errors, profileRuns.length === 10, `${id} must contain exactly 10 agent runs`);
    addError(errors, report?.agentSurrogateRuns?.[id] === 10, `${id} summary count must be 10`);
    for (const run of profileRuns) {
      addError(errors, run?.actor?.kind === 'agent', `${id} run actor must be agent`);
      addError(errors, run?.humanEquivalent === false, `${id} run must keep humanEquivalent=false`);
      addError(errors, run?.liveEvidence === false, `${id} run must keep liveEvidence=false`);
      addError(errors, run?.result === 'pass', `${id} run did not pass`);
      addError(errors, typeof run?.lineage?.componentEntrypoint === 'string', `${id} run lineage missing`);
    }
  }

  addError(errors, report?.killRollbackDrill?.actor?.kind === 'agent', 'kill drill actor must be agent');
  addError(errors, report?.killRollbackDrill?.humanEquivalent === false, 'kill drill must not claim human equivalence');
  addError(errors, report?.killRollbackDrill?.result === 'pass', 'kill drill must pass');
  addError(errors, current ? ['continue', 'shrink', 'stop'].includes(report?.decision?.value) : report?.decision?.value === 'deferred-human-validation', 'decision value mismatch');
  addError(errors, report?.decision?.productApproval === false, 'decision must not grant product approval');
  addError(errors, report?.frozenBoundaries?.liveReady === false, 'report liveReady lock drifted');
  addError(errors, report?.frozenBoundaries?.productApproved === false, 'report productApproved lock drifted');
  addError(errors, report?.frozenBoundaries?.defaultOn === false, 'report defaultOn lock drifted');
  addError(errors, report?.frozenBoundaries?.c1ReductionFactor === 4.5, 'report C1 reduction lock drifted');
  addError(errors, report?.frozenBoundaries?.c1MeetsGate === false, 'report C1 gate lock drifted');
  addError(errors, report?.frozenBoundaries?.c1Recommendation === 'keep-off', 'report C1 recommendation drifted');
  addError(errors, report?.frozenBoundaries?.tf0006 === 'blocked', 'report TF-0006 lock drifted');
  if (current) {
    addError(errors, report?.policy === 'AGENTS.md#human-in-the-loop-2026-09-27', 'report policy mismatch');
    addError(errors, report?.driven_by === 'agent' && typeof report?.actor === 'string' && report.actor.trim().length > 0, 'report must name its agent driver');
    addError(errors, /^[0-9a-f]{40}$/.test(report?.candidate?.commit ?? '') && /^[0-9a-f]{40}$/.test(report?.candidate?.tree ?? ''), 'candidate identity missing');
    addError(errors, typeof report?.candidate?.dirty === 'boolean', 'candidate dirty state missing');
    addError(errors, new Set(runs.map((run) => run?.runId)).size === 30, 'run IDs must be unique');
    for (const run of runs) {
      addError(errors, typeof run?.runId === 'string' && run.runId.length > 0, 'run ID missing');
      addError(errors, run?.driven_by === 'agent' && run?.actor?.id === report.actor, 'run must name its agent driver');
      addError(errors, typeof run?.taskIntent === 'string' && run.taskIntent.length > 0, 'run intent missing');
      const safe = run?.profile === 'dcs-coding'
        ? run?.safety?.unauthorizedWrite === false
        : run?.profile === 'sekb-assisted'
          ? run?.safety?.unconfirmedPrincipleWrite === false && run?.safety?.autoWriteback === false && run?.safety?.productionStoreAccess === false && run?.metrics?.confirmedWrites === 0
          : run?.safety?.privateNetworkAllowed === false && run?.safety?.approvalBypass === false && run?.safety?.realPublicNetwork === false;
      addError(errors, safe, `${run?.runId} safety evidence failed`);
    }
    const steps = report?.killRollbackDrill?.steps;
    const requiredSteps = ['dcs-opt-in-unset', 'sekb-agent-confirm-writes-zero', 'browser-sessions-closed', 'browser-runtime-disabled', 'product-defaults-still-off'];
    addError(errors, Array.isArray(steps) && steps.length === requiredSteps.length && requiredSteps.every((id) => steps.some((step) => step?.id === id && step?.ok === true)), 'kill drill steps incomplete or failed');
    addError(errors, report?.killRollbackDrill?.driven_by === 'agent' && report?.killRollbackDrill?.actor?.id === report.actor, 'kill drill driver missing');
    addError(errors, report?.decision?.driven_by === 'agent' && report?.decision?.actor?.id === report.actor, 'decision driver missing');
    addError(errors, report?.frozenBoundaries?.runtimeMemory === 'diagnostics-only', 'Runtime Memory boundary drifted');
  }
  return { ok: errors.length === 0, errors };
}

// Archived closure stays valid after later source work; new closure additionally
// requires the current source to match the tested candidate (canCloseTf0009 below).
export function verifyTf0009ClosureEvidence(report, root, { requireCurrentSource = false } = {}) {
  if (!root || report?.schema !== 'tf0009-agent-surrogate-report/v2'
    || report?.candidate?.dirty !== false || !validateTf0009AgentSurrogateReport(report).ok) return false;
  try {
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const candidate = report.candidate;
    if (git('rev-parse', `${candidate.commit}^{tree}`) !== candidate.tree) return false;
    git('merge-base', '--is-ancestor', candidate.commit, 'HEAD');
    // Closure commits may add governance/evidence, never silently change the tested source.
    const closurePath = (file) => file.startsWith('.agent-workbench/task-forest/')
      || file.startsWith('artifacts/first-product-preview/TF-0009/')
      || file === 'docs/dev/handoffs/LATEST.md'
      || file === 'docs/dev/tf0009-policy-decision-20260930.md';
    if (requireCurrentSource && git('diff', '--name-only', candidate.commit, '--').split('\n').filter(Boolean).some((file) => !closurePath(file))) return false;
    const sourcePath = /^(?:scripts|openclaw_runtime|electron|src|shared|harness|packages|tests)\/|^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$/;
    if (requireCurrentSource && git('ls-files', '--others', '--exclude-standard').split('\n').some((file) => sourcePath.test(file))) return false;
    const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
    const artifactRoot = join(root, 'artifacts/first-product-preview/TF-0009');
    const evidenceRoot = join(artifactRoot, 'policy-acceptance');
    const rawReport = readFileSync(requireCurrentSource
      ? join(artifactRoot, 'agent-surrogate-report.json') : join(evidenceRoot, 'campaign-report.json'));
    if (JSON.stringify(JSON.parse(rawReport)) !== JSON.stringify(report)) return false;
    const verification = JSON.parse(readFileSync(join(evidenceRoot, 'verification.json'), 'utf8'));
    if (verification.schema !== 'tf0009-policy-verification/v1' || verification.driven_by !== 'agent'
      || verification.candidate?.commit !== candidate.commit || verification.candidate?.tree !== candidate.tree
      || verification.reportSha256 !== sha(rawReport)
      || verification.charterSha256 !== sha(readFileSync(requireCurrentSource
        ? join(artifactRoot, 'agent-surrogate-charter.json') : join(evidenceRoot, 'campaign-charter.json')))
      || verification.reportSha256 !== sha(readFileSync(join(evidenceRoot, 'campaign-report.json')))
      || verification.charterSha256 !== sha(readFileSync(join(evidenceRoot, 'campaign-charter.json')))
      || verification.credentialScan?.hits !== 0) return false;
    const required = ['campaign', 'unit', 'typecheck', 'lint', 'harness', 'autoreview'];
    if (!required.every((id) => verification.gates?.some((gate) => gate.id === id && gate.exitCode === 0))) return false;
    const sums = readFileSync(join(evidenceRoot, 'SHA256SUMS'), 'utf8').trim().split('\n');
    const files = readdirSync(evidenceRoot).filter((file) => file !== 'SHA256SUMS').sort();
    const manifest = new Map(sums.map((line) => {
      const match = /^([0-9a-f]{64}) \*(.+)$/.exec(line);
      if (!match || match[2].includes('/') || match[2].includes('\\')) throw new Error('Invalid evidence path');
      return [match[2], match[1]];
    }));
    if (manifest.size !== sums.length || manifest.size !== files.length) return false;
    for (const file of files) {
      if (sha(readFileSync(join(evidenceRoot, file))) !== manifest.get(file)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function canCloseTf0009(report, root) {
  return verifyTf0009ClosureEvidence(report, root, { requireCurrentSource: true });
}
