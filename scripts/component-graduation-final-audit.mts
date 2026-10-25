import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPONENT_AUTHORITY_MANIFEST, validateComponentAuthorityManifest } from '../shared/component-authority-manifest.js';
import { COMPONENT_DISPOSITION_MANIFEST, COMPONENT_DISPOSITION_ENTRIES, validateComponentDispositionManifest } from '../shared/dcs/component-disposition-catalog.js';
import { DCS_PROD_FLAGS } from '../shared/dcs/prod-flags-catalog.js';
import { RUNTIME_FEATURE_EXHAUSTIVE, listLeafPaths } from '../openclaw_runtime/src/config/runtime-feature-leaves.js';
import { SETTINGS_SECTION_SEGMENTS } from '../src/pages/Settings/route-config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const argv = process.argv.slice(2);
const value = (name: string) => argv[argv.indexOf(name) + 1];
const output = value('--output');
if (!output || !argv.includes('--output')) throw new Error('usage: component-graduation-final-audit.mts --output <json>');
const problems: string[] = [];
const authority = validateComponentAuthorityManifest();
problems.push(...authority.issues.map((issue) => issue.code + ': ' + issue.message));
const nodeIds = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/component-graduation/task-forest-node-ids.json'), 'utf8')).ids as string[];
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const routes = [...new Set([...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((match) => match[1]!))];
const disposition = validateComponentDispositionManifest(COMPONENT_DISPOSITION_MANIFEST, {
  authorityComponentIds: COMPONENT_AUTHORITY_MANIFEST.components.map((component) => component.id),
  dcsFlagIds: DCS_PROD_FLAGS.map((flag) => flag.id),
  runtimeLeafPaths: listLeafPaths(RUNTIME_FEATURE_EXHAUSTIVE),
  settingsSectionIds: ['overview', ...Object.keys(SETTINGS_SECTION_SEGMENTS)],
  settingsPanelIds: fs.readdirSync(path.join(root, 'src/components/settings')).filter((file) => file.endsWith('.tsx')).map((file) => file.slice(0, -4)),
  routePaths: routes, knownNodeIds: new Set(nodeIds), now: new Date().toISOString(),
});
problems.push(...disposition.issues.map((issue) => issue.code + ': ' + issue.message));
const anchors = COMPONENT_AUTHORITY_MANIFEST.components.flatMap((component) => component.sourceAnchors.map((anchor) => {
  const file = path.join(root, anchor.path);
  const exists = fs.existsSync(file);
  const contains = exists && (!anchor.contains || fs.readFileSync(file, 'utf8').includes(anchor.contains));
  if (!contains) problems.push('source anchor mismatch: ' + component.id + ':' + anchor.path);
  return { componentId: component.id, ...anchor, exists, contains };
}));
const evidence = COMPONENT_DISPOSITION_ENTRIES.map((entry) => {
  const refs = [...entry.evidenceRefs, ...(entry.verificationArtifact ?? [])].map((relative) => {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) { problems.push('evidence missing: ' + relative); return { path: relative, exists: false }; }
    const bytes = fs.readFileSync(file);
    return { path: relative, exists: true, sha256: sha(bytes), bytes: bytes.length };
  });
  return { id: entry.id, disposition: entry.disposition, visibility: entry.visibility, implementationNodeId: entry.implementationNodeId, retirementNodeId: entry.retirementNodeId, currentConsumers: entry.currentConsumers, evidence: refs, remainingGap: entry.remainingGap ?? [] };
});
const experiments = COMPONENT_DISPOSITION_ENTRIES.filter((entry) => entry.disposition === 'experiment');
if (experiments.length) problems.push('unfinished experiments: ' + experiments.map((entry) => entry.id).join(', '));
const visibleShadow = COMPONENT_DISPOSITION_ENTRIES.filter((entry) => entry.visibility === 'user' && entry.currentMode === 'shadow');
const groups = new Map<string, number>();
for (const row of COMPONENT_AUTHORITY_MANIFEST.authorities) {
  const key = `${row.dataType}:${row.scope}:${row.operation}`;
  groups.set(key, (groups.get(key) ?? 0) + 1);
}
const conflicts = [...groups].filter(([, count]) => count !== 1);
if (conflicts.length) problems.push('authority conflicts');
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const report = {
  schemaVersion: 'ComponentFinalSourceAudit/v1', generatedAt: new Date().toISOString(), actor: 'codex-source-verifier', driven_by: 'agent',
  candidate: { commit: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), dirty: git('status', '--porcelain', '--untracked-files=all') !== '' },
  metrics: { components: evidence.length, authorityConflicts: conflicts.length, unclassified: disposition.issues.filter((issue) => issue.code === 'unclassified_component').length, userVisibleShadowSurfaces: visibleShadow.length, unfinishedExperiments: experiments.length, missingImplementationOrRetirement: evidence.filter((entry) => !entry.implementationNodeId && !entry.retirementNodeId).length },
  authorityValidation: authority, dispositionValidation: disposition, sourceAnchors: anchors, components: evidence,
  pass: problems.length === 0, problems,
  limitation: 'Source, identity and coverage audit only. Runtime, E2E, canary and rollback evidence are checked separately; this report does not promote classification into implementation or general availability.',
};
fs.writeFileSync(path.resolve(output), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ pass: report.pass, metrics: report.metrics, problems }, null, 2));
process.exitCode = report.pass ? 0 : 1;
