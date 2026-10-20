import fs from 'node:fs';
import path from 'node:path';

export const PLAN_ROOT_REL = 'plans/system-maturity';
export const PHASE_TOPOLOGY_REL = `${PLAN_ROOT_REL}/phases.json`;

function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '');
}

function phaseDirOrder(name) {
  const match = name.match(/^phase(\d+)-/u);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

export function discoverPhaseDirs(planRoot) {
  if (!fs.existsSync(planRoot)) return [];
  return fs
    .readdirSync(planRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^phase\d+-/u.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => phaseDirOrder(left) - phaseDirOrder(right) || left.localeCompare(right));
}

export function validatePhaseTopology(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return ['topology must be a JSON object'];
  }
  if (doc.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!Array.isArray(doc.phases) || doc.phases.length === 0) {
    errors.push('phases must be a non-empty array');
    return errors;
  }

  const ids = new Set();
  for (const [index, phase] of doc.phases.entries()) {
    const at = `phases[${index}]`;
    if (!phase || typeof phase !== 'object' || Array.isArray(phase)) {
      errors.push(`${at} must be an object`);
      continue;
    }
    const id = String(phase.id ?? '');
    if (!/^phase\d+-[a-z0-9-]+$/u.test(id)) errors.push(`${at}.id is not a phase directory name`);
    if (ids.has(id)) errors.push(`${at}.id duplicates ${id}`);
    ids.add(id);
    if (phase.order !== index + 1) errors.push(`${at}.order must be ${index + 1}`);
    if (!phase.owner) errors.push(`${at}.owner missing`);
    if (!phase.findings) errors.push(`${at}.findings missing`);
    if (!phase.title) errors.push(`${at}.title missing`);
    if (!phase.tierFrom || !phase.tierTo) errors.push(`${at}.tierFrom/tierTo missing`);
    if (!Array.isArray(phase.dependencies)) errors.push(`${at}.dependencies must be an array`);
  }

  const indexById = new Map(doc.phases.map((phase, index) => [phase?.id, index]));
  for (const [index, phase] of doc.phases.entries()) {
    if (!phase || typeof phase !== 'object' || !Array.isArray(phase.dependencies)) continue;
    for (const dependency of phase.dependencies) {
      const dependencyIndex = indexById.get(dependency);
      if (dependencyIndex === undefined) {
        errors.push(`${phase.id} depends on unknown phase ${dependency}`);
      } else if (dependencyIndex >= index) {
        errors.push(`${phase.id} depends on ${dependency}, which must appear earlier`);
      }
    }
  }

  return errors;
}

export function readPhaseTopology(root = process.cwd(), { allowDiscovery = false } = {}) {
  const topologyPath = path.join(root, PHASE_TOPOLOGY_REL);
  if (fs.existsSync(topologyPath)) {
    const doc = JSON.parse(readText(topologyPath));
    const errors = validatePhaseTopology(doc);
    if (errors.length > 0) {
      throw new Error(`${PHASE_TOPOLOGY_REL}: ${errors.join('; ')}`);
    }
    return { ...doc, source: 'phases.json' };
  }
  if (!allowDiscovery) {
    throw new Error(`missing ${PHASE_TOPOLOGY_REL}`);
  }
  const planRoot = path.join(root, PLAN_ROOT_REL);
  const phases = discoverPhaseDirs(planRoot).map((id, index) => ({
    order: index + 1,
    id,
    tierFrom: 'unknown',
    tierTo: 'unknown',
    owner: 'unknown',
    findings: 'unknown',
    dependencies: [],
    title: id,
  }));
  return {
    schemaVersion: 1,
    program: 'clawx-system-maturity',
    phases,
    source: 'discovered',
  };
}

export function phaseDirsFromTopology(topology) {
  return topology.phases.map((phase) => phase.id);
}

export function tierLabel(phase) {
  return `${phase.tierFrom}→${phase.tierTo}`;
}

export function dependencyLabel(phase) {
  return phase.dependencies.length > 0 ? phase.dependencies.join(', ') : 'none';
}

export function renderIndexTable(topology, statusByPhase) {
  const rows = topology.phases.map((phase) => (
    `| ${phase.id} | ${tierLabel(phase)} | ${phase.owner} | ${phase.findings} | `
    + `${dependencyLabel(phase)} | ${statusByPhase[phase.id] ?? 'planned'} |`
  ));
  return [
    '| Phase | Tier | Owner | Findings | Dependencies | Status |',
    '|---|---|---|---|---|---|',
    ...rows,
  ];
}

export function renderStructureTable(topology, statusByPhase) {
  const rows = topology.phases.map((phase) => (
    `| ${phase.order} | \`${phase.id}\` | ${tierLabel(phase)} | ${phase.owner} | ${phase.findings} | `
    + `${dependencyLabel(phase)} | ${statusByPhase[phase.id] ?? 'planned'} |`
  ));
  return [
    '| # | Phase | Tier | Owner | Findings | Dependencies | Status |',
    '|---|---|---|---|---|---|---|',
    ...rows,
  ];
}
