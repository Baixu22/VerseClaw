#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STATUSES = ['Open', 'Fixed', 'Partial', 'Unverified'];
const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FILE = path.join(ROOT, 'plans', 'system-maturity', 'findings-registry.json');

export function deriveFindingsRegistryCounts(findings) {
  const bySeverity = Object.fromEntries(
    SEVERITIES.map((severity) => [severity, findings.filter((finding) => finding?.severity === severity).length]),
  );
  const byStatus = Object.fromEntries(
    STATUSES.map((status) => [status, findings.filter((finding) => finding?.status === status).length]),
  );
  return {
    total: findings.length,
    bySeverity,
    byStatus,
    open: byStatus.Open,
    fixed: byStatus.Fixed,
    findings: findings.length,
  };
}

export function deriveRegistryTaskCount(tasks) {
  if (!tasks || typeof tasks !== 'object' || Array.isArray(tasks)) return null;
  return Object.keys(tasks).length;
}

export function validateFindingsRegistry(registry) {
  const errors = [];
  const findings = registry?.findings;
  if (!Array.isArray(findings)) {
    return { ok: false, errors: ['findings must be an array'], derived: null };
  }

  const derived = deriveFindingsRegistryCounts(findings);
  for (const key of ['total', 'bySeverity', 'byStatus', 'open', 'fixed', 'findings']) {
    if (JSON.stringify(registry?.counts?.[key]) !== JSON.stringify(derived[key])) {
      errors.push(`counts.${key} does not match findings[]`);
    }
  }

  const taskCount = deriveRegistryTaskCount(registry?.tasks);
  if (taskCount === null) {
    errors.push('tasks must be an object keyed by task id');
  } else if (registry?.counts?.tasks !== taskCount) {
    errors.push('counts.tasks does not match tasks registry');
  }

  const ids = findings.map((finding) => finding?.id);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicateIds.length > 0) errors.push(`duplicate finding ids: ${[...new Set(duplicateIds)].join(', ')}`);
  if (!Array.isArray(registry?.findingIds)) {
    errors.push('findingIds must be an array');
  } else if (JSON.stringify([...registry.findingIds].sort()) !== JSON.stringify([...ids].sort())) {
    errors.push('findingIds does not mirror findings[].id');
  }

  return { ok: errors.length === 0, errors, derived };
}

function parseFileArgument(argv) {
  const index = argv.indexOf('--file');
  return index >= 0 && argv[index + 1] ? path.resolve(argv[index + 1]) : DEFAULT_FILE;
}

function main() {
  const file = parseFileArgument(process.argv.slice(2));
  let registry;
  try {
    registry = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`findings registry: cannot read ${file}: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const result = validateFindingsRegistry(registry);
  if (!result.ok) {
    console.error(`findings registry: INVALID\n- ${result.errors.join('\n- ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `findings registry: OK (${result.derived.total} findings; ` +
      `Fixed=${result.derived.fixed}; Partial=${result.derived.byStatus.Partial})`,
  );
}

if (isMainEntrypoint(import.meta.url)) {
  main();
}
