/**
 * P8-003 capability inventory validation for multi-impl residuals (F-REL-004).
 */
import fs from 'node:fs';
import path from 'node:path';

export function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function evaluateCapabilityInventory({ inventory, suite }) {
  const errors = [];
  const scenarioIds = new Set((suite?.scenarios || []).map((s) => s.id));
  const rows = [];

  if (!inventory || inventory.schemaVersion !== 1) {
    errors.push('capability-inventory schemaVersion must be 1');
  }
  if (inventory?.findingId !== 'F-REL-004') {
    errors.push('capability-inventory findingId must be F-REL-004');
  }
  const caps = inventory?.capabilities || [];
  if (!Array.isArray(caps) || caps.length === 0) {
    errors.push('capability-inventory must list capabilities');
  }

  for (const cap of caps) {
    const missingScenarios = (cap.scenarioIds || []).filter((id) => !scenarioIds.has(id));
    if (!cap.id) errors.push('capability missing id');
    if (!Array.isArray(cap.implementations) || cap.implementations.length < 1) {
      errors.push(`${cap.id || '?'}: implementations required`);
    }
    if (!Array.isArray(cap.scenarioIds) || cap.scenarioIds.length < 1) {
      errors.push(`${cap.id || '?'}: scenarioIds required`);
    }
    if (missingScenarios.length) {
      errors.push(`${cap.id}: unknown scenarioIds ${missingScenarios.join(',')}`);
    }
    rows.push({
      id: cap.id,
      strength: cap.strength || null,
      residual: cap.residual || null,
      scenarioIds: cap.scenarioIds || [],
      ok: missingScenarios.length === 0,
    });
  }

  // Every F-REL-004 scenario should be referenced by at least one capability
  const relScenarios = (suite?.scenarios || []).filter((s) => (s.findings || []).includes('F-REL-004'));
  for (const sc of relScenarios) {
    const covered = caps.some((c) => (c.scenarioIds || []).includes(sc.id));
    if (!covered) errors.push(`F-REL-004 scenario ${sc.id} not covered by capability inventory`);
  }

  return { rows, errors, ok: errors.length === 0 };
}

export function runCapabilityInventoryAudit({ root }) {
  const inventoryPath = path.join(root, 'plans/system-maturity/capability-inventory.json');
  const suitePath = path.join(root, 'plans/system-maturity/security-regression-suite.json');
  const inventory = loadJson(inventoryPath);
  const suite = loadJson(suitePath);
  const result = evaluateCapabilityInventory({ inventory, suite });
  return {
    schemaVersion: 1,
    task: 'P8-003',
    generatedAt: new Date().toISOString(),
    ok: result.ok,
    primaryFindingIds: ['F-REL-004'],
    result,
    fail: result.errors,
  };
}
