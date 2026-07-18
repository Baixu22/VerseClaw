#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

export const PHASE_DIRS = [
  'phase0-foundation',
  'phase1-direct-boundaries',
  'phase2-authorization-isolation',
  'phase3-data-authority',
  'phase4-runtime-surfaces',
  'phase5-reliability-abuse',
  'phase6-supply-release',
  'phase7-continuous-governance',
];

export function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function collectPhaseStatuses(root) {
  const planRoot = path.join(root, 'plans/system-maturity');
  const phases = [];
  for (const dir of PHASE_DIRS) {
    const statusPath = path.join(planRoot, dir, 'STATUS.json');
    const relativeStatusPath = path.relative(root, statusPath).replace(/\\/gu, '/');
    if (!fs.existsSync(statusPath)) {
      phases.push({
        id: dir,
        missing: true,
        phaseStatus: null,
        tasks: {},
        taskCount: 0,
        doneCount: 0,
        allTasksDone: false,
        declaredAllTasksDone: false,
        consistent: false,
        statusPath: relativeStatusPath,
      });
      continue;
    }
    const status = loadJson(statusPath);
    const tasks = status.tasks || {};
    const taskIds = Object.keys(tasks);
    const allDone = taskIds.length > 0 && taskIds.every((id) => tasks[id] === 'done');
    const declaredAll = Boolean(status.allTasksDone);
    const phaseStatus = status.phaseStatus || null;
    const consistent =
      allDone === declaredAll
      && (allDone ? phaseStatus === 'done' : phaseStatus !== 'done');
    phases.push({
      id: dir,
      missing: false,
      phaseStatus,
      tasks,
      taskCount: taskIds.length,
      doneCount: taskIds.filter((id) => tasks[id] === 'done').length,
      allTasksDone: allDone,
      declaredAllTasksDone: declaredAll,
      consistent,
      statusPath: relativeStatusPath,
    });
  }
  return phases;
}

export function evaluateRiskAcceptances({ findings, riskRegistry, nowMs = Date.now() }) {
  const byId = new Map((riskRegistry?.items || []).map((item) => [item.findingId, item]));
  const rows = [];
  const errors = [];
  for (const finding of findings || []) {
    const decision = finding.decision || '';
    const needsAcceptance = decision === 'Track' || decision === 'Accept' || decision === 'Risk-accept';
    if (!needsAcceptance) continue;
    const entry = byId.get(finding.id);
    if (!entry) {
      errors.push(`missing risk acceptance entry for ${finding.id} (decision=${decision})`);
      rows.push({ findingId: finding.id, decision, status: 'missing-entry', ok: false });
      continue;
    }
    const reviewByMs = Date.parse(entry.reviewBy || '');
    if (!Number.isFinite(reviewByMs)) {
      errors.push(`${finding.id}: risk acceptance missing valid reviewBy`);
      rows.push({ findingId: finding.id, decision, status: 'invalid-reviewBy', ok: false, entry });
      continue;
    }
    const expired = reviewByMs < nowMs;
    if (expired) errors.push(`${finding.id}: risk acceptance expired at ${entry.reviewBy}`);
    rows.push({
      findingId: finding.id,
      decision,
      owner: entry.owner || null,
      reviewBy: entry.reviewBy,
      rationale: entry.rationale || null,
      status: expired ? 'expired' : 'active',
      ok: !expired,
      entry,
    });
  }
  return { rows, errors, ok: errors.length === 0 };
}

export function evaluateReleaseDecision({ phases, riskOk, agentDevAudit = null }) {
  const blockers = [];
  const notes = [];
  const p0 = phases.find((p) => p.id === 'phase0-foundation');
  const p1 = phases.find((p) => p.id === 'phase1-direct-boundaries');
  if (!p0 || p0.missing || !p0.allTasksDone || p0.phaseStatus !== 'done') {
    blockers.push('P0 incomplete: release blocked until all phase0 tasks are done');
  }
  if (!p1 || p1.missing || !p1.allTasksDone || p1.phaseStatus !== 'done') {
    blockers.push('P1 incomplete: release blocked until all phase1 tasks are done');
  }
  for (const phase of phases) {
    if (phase.missing) blockers.push(`missing STATUS for ${phase.id}`);
    else if (!phase.consistent) blockers.push(`inconsistent STATUS for ${phase.id}`);
  }
  if (!riskOk) blockers.push('risk acceptance registry has missing or expired entries');

  // F-GOV-002: Agent Dev grade/releaseReady must not be extrapolated to whole-system release.
  if (agentDevAudit) {
    notes.push({
      code: 'agent-dev-not-system-release',
      message: 'Agent Dev audit score/grade/releaseReady must not be extrapolated to whole-system release readiness',
      status: agentDevAudit.status ?? null,
      releaseReady: agentDevAudit.releaseReady ?? null,
      score: agentDevAudit.score ?? null,
    });
    if (agentDevAudit.status === 'fail') {
      notes.push({
        code: 'agent-dev-status-fail',
        message: 'Agent Dev audit status=fail (informational for system maturity; not an automatic P0/P1 release veto)',
      });
    }
    if (agentDevAudit.releaseReady === false) {
      notes.push({
        code: 'agent-dev-releaseReady-false',
        message: 'Agent Dev releaseReady=false recorded as caveat only; system release uses phase/risk gates',
      });
    }
  }

  return {
    allowed: blockers.length === 0,
    blockers,
    notes,
    code: blockers.length === 0 ? 'release-eligible' : 'release-blocked',
  };
}

export function buildMaturityScorecard({ phases, risk, release, agentDevAudit = null }) {
  const phaseScore = phases.length
    ? Math.round((phases.filter((p) => p.allTasksDone && p.phaseStatus === 'done').length / phases.length) * 40)
    : 0;
  const consistencyScore = phases.length
    ? Math.round((phases.filter((p) => !p.missing && p.consistent).length / phases.length) * 20)
    : 0;
  const riskScore = risk.ok ? 20 : Math.max(0, 20 - risk.errors.length * 5);
  const releaseScore = release.allowed ? 20 : 0;
  const total = phaseScore + consistencyScore + riskScore + releaseScore;
  return {
    dimensions: [
      { id: 'phase-completion', score: phaseScore, max: 40 },
      { id: 'status-consistency', score: consistencyScore, max: 20 },
      { id: 'risk-acceptance', score: riskScore, max: 20 },
      { id: 'release-gate', score: releaseScore, max: 20 },
    ],
    total,
    max: 100,
    grade: total >= 90 ? 'A' : total >= 80 ? 'B' : total >= 70 ? 'C' : 'D',
    agentDevNote: agentDevAudit
      ? {
          status: agentDevAudit.status ?? null,
          releaseReady: agentDevAudit.releaseReady ?? null,
          score: agentDevAudit.score ?? null,
          grade: agentDevAudit.grade ?? null,
          caveat: 'Agent Dev A-grade must not be extrapolated to whole-system release readiness (F-GOV-002)',
        }
      : null,
  };
}

export function loadAgentDevAudit(root) {
  const reportPath = path.join(root, 'artifacts/agent-dev-audit/report.json');
  if (!fs.existsSync(reportPath)) return null;
  try {
    const report = loadJson(reportPath);
    return {
      path: path.relative(root, reportPath).replace(/\\/gu, '/'),
      status: report.status ?? report.decision?.status ?? null,
      releaseReady: report.releaseReady ?? report.decision?.releaseReady ?? null,
      score: report.score ?? report.decision?.score ?? null,
      grade: report.grade ?? report.decision?.grade ?? null,
      generatedAt: report.generatedAt ?? null,
    };
  } catch {
    return { path: path.relative(root, reportPath).replace(/\\/gu, '/'), status: 'unreadable', releaseReady: false, score: null, grade: null };
  }
}

export function runSystemMaturityQuarterlyAudit({
  root,
  nowMs = Date.now(),
  agentDevAudit = undefined,
  findingsPath = null,
  riskPath = null,
}) {
  const resolvedFindingsPath = findingsPath || path.join(root, 'plans/system-maturity/findings-registry.json');
  const resolvedRiskPath = riskPath || path.join(root, 'plans/system-maturity/risk-acceptance.json');
  const findingsDoc = loadJson(resolvedFindingsPath);
  const riskRegistry = fs.existsSync(resolvedRiskPath)
    ? loadJson(resolvedRiskPath)
    : { schemaVersion: 1, items: [] };
  const phases = collectPhaseStatuses(root);
  const risk = evaluateRiskAcceptances({
    findings: findingsDoc.findings || [],
    riskRegistry,
    nowMs,
  });
  const resolvedAgentDev = agentDevAudit === undefined ? loadAgentDevAudit(root) : agentDevAudit;
  const release = evaluateReleaseDecision({ phases, riskOk: risk.ok, agentDevAudit: resolvedAgentDev });
  const scorecard = buildMaturityScorecard({ phases, risk, release, agentDevAudit: resolvedAgentDev });
  const fail = [];
  for (const phase of phases) {
    if (phase.missing) fail.push(`missing phase STATUS ${phase.id}`);
    if (!phase.missing && !phase.consistent) fail.push(`inconsistent phase STATUS ${phase.id}`);
  }
  for (const error of risk.errors) fail.push(error);
  if (!release.allowed) {
    for (const blocker of release.blockers) fail.push(blocker);
  }

  const phaseTrace = phases.map((phase) => ({
    phase: phase.id,
    statusPath: phase.statusPath,
    phaseStatus: phase.phaseStatus,
    allTasksDone: phase.allTasksDone,
    consistent: phase.consistent,
    missing: phase.missing,
    tasks: phase.tasks,
  }));

  return {
    schemaVersion: 1,
    task: 'P7-004',
    generatedAt: new Date(nowMs).toISOString(),
    ok: fail.length === 0,
    // Omit findingIds so full-validation can refresh global freshness like P7-001.
    primaryFindingIds: ['F-GOV-002', 'F-GOV-003'],
    phases: phaseTrace,
    riskAcceptance: risk,
    releaseDecision: release,
    scorecard,
    agentDevAudit: resolvedAgentDev,
    fail,
    summary: {
      phaseCount: phases.length,
      phasesDone: phases.filter((p) => p.allTasksDone && p.phaseStatus === 'done').length,
      phasesTraceable: phases.filter((p) => !p.missing).length,
      riskActive: risk.rows.filter((r) => r.status === 'active').length,
      riskExpired: risk.rows.filter((r) => r.status === 'expired').length,
      riskMissing: risk.rows.filter((r) => r.status === 'missing-entry').length,
      releaseAllowed: release.allowed,
      score: scorecard.total,
      grade: scorecard.grade,
    },
  };
}

export function validateQuarterlyAuditReport(report) {
  const errors = [];
  if (!report || report.schemaVersion !== 1) errors.push('report schemaVersion must be 1');
  if (report?.task !== 'P7-004') errors.push('report task must be P7-004');
  if (!Array.isArray(report?.phases) || report.phases.length !== PHASE_DIRS.length) {
    errors.push(`report must trace all ${PHASE_DIRS.length} phases`);
  } else {
    for (const phase of report.phases) {
      if (!phase.statusPath) errors.push(`phase ${phase.phase} missing statusPath`);
    }
  }
  if (!report?.riskAcceptance || !Array.isArray(report.riskAcceptance.rows)) {
    errors.push('report missing riskAcceptance.rows');
  }
  if (!report?.releaseDecision || typeof report.releaseDecision.allowed !== 'boolean') {
    errors.push('report missing releaseDecision.allowed');
  }
  if (!report?.scorecard || typeof report.scorecard.total !== 'number') {
    errors.push('report missing scorecard.total');
  }
  if (report?.ok !== true && (!Array.isArray(report?.fail) || report.fail.length === 0)) {
    errors.push('failed report must include fail reasons');
  }
  return errors;
}
