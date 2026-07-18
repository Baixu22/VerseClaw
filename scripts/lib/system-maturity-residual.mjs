/**
 * P8-001 residual governance: Partial + Act-now findings must have residual-register entries.
 */
import fs from 'node:fs';
import path from 'node:path';

export function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * @param {{ findings: Array<{id:string,status?:string,decision?:string}>, residualRegistry: {items?: Array<any>}, nowMs?: number }} params
 */
export function evaluateResidualRegister({ findings, residualRegistry, nowMs = Date.now() }) {
  const byId = new Map((residualRegistry?.items || []).map((item) => [item.findingId, item]));
  const rows = [];
  const errors = [];

  for (const finding of findings || []) {
    const status = String(finding.status || '');
    const decision = String(finding.decision || '');
    const needsResidual = status === 'Partial' && decision === 'Act-now';
    if (!needsResidual) continue;

    const entry = byId.get(finding.id);
    if (!entry) {
      errors.push(`missing residual-register entry for ${finding.id} (Partial+Act-now)`);
      rows.push({ findingId: finding.id, decision, status: 'missing-entry', ok: false });
      continue;
    }

    const reviewByMs = Date.parse(entry.reviewBy || '');
    if (!Number.isFinite(reviewByMs)) {
      errors.push(`${finding.id}: residual-register missing valid reviewBy`);
      rows.push({ findingId: finding.id, decision, status: 'invalid-reviewBy', ok: false, entry });
      continue;
    }

    if (!entry.owner || !String(entry.owner).trim()) {
      errors.push(`${finding.id}: residual-register missing owner`);
      rows.push({ findingId: finding.id, decision, status: 'missing-owner', ok: false, entry });
      continue;
    }

    if (!entry.residualScope || !String(entry.residualScope).trim()) {
      errors.push(`${finding.id}: residual-register missing residualScope`);
      rows.push({ findingId: finding.id, decision, status: 'missing-scope', ok: false, entry });
      continue;
    }

    const expired = reviewByMs < nowMs;
    if (expired) errors.push(`${finding.id}: residual-register expired at ${entry.reviewBy}`);

    rows.push({
      findingId: finding.id,
      decision,
      owner: entry.owner,
      reviewBy: entry.reviewBy,
      residualScope: entry.residualScope,
      status: expired ? 'expired' : 'active',
      ok: !expired,
      entry,
    });
  }

  // Warn (as error for strict residual gate) if register references unknown findings
  for (const item of residualRegistry?.items || []) {
    if (!(findings || []).some((f) => f.id === item.findingId)) {
      errors.push(`residual-register references unknown finding ${item.findingId}`);
    }
  }

  return { rows, errors, ok: errors.length === 0 };
}

export function runSystemMaturityResidualAudit({
  root,
  nowMs = Date.now(),
  findingsPath = null,
  residualPath = null,
}) {
  const resolvedFindingsPath =
    findingsPath || path.join(root, 'plans/system-maturity/findings-registry.json');
  const resolvedResidualPath =
    residualPath || path.join(root, 'plans/system-maturity/residual-register.json');

  const findingsDoc = loadJson(resolvedFindingsPath);
  const residualRegistry = fs.existsSync(resolvedResidualPath)
    ? loadJson(resolvedResidualPath)
    : { schemaVersion: 1, items: [] };

  const residual = evaluateResidualRegister({
    findings: findingsDoc.findings || findingsDoc || [],
    residualRegistry,
    nowMs,
  });

  const fail = [...residual.errors];
  return {
    schemaVersion: 1,
    task: 'P8-001',
    generatedAt: new Date(nowMs).toISOString(),
    ok: fail.length === 0,
    primaryFindingIds: ['F-SEC-001', 'F-REL-004', 'F-GOV-002'],
    residual,
    fail,
    summary: {
      residualActive: residual.rows.filter((r) => r.status === 'active').length,
      residualExpired: residual.rows.filter((r) => r.status === 'expired').length,
      residualMissing: residual.rows.filter((r) => r.status === 'missing-entry').length,
      residualOk: residual.ok,
    },
  };
}
