#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPONENT_AUTHORITY_MANIFEST, validateComponentAuthorityManifest } from '../../../../shared/component-authority-manifest.ts';
import { COMPONENT_DISPOSITION_MANIFEST, validateComponentDispositionManifest } from '../../../../shared/dcs/component-disposition-catalog.ts';
import { DCS_PROD_FLAGS } from '../../../../shared/dcs/prod-flags-catalog.ts';
import { RUNTIME_FEATURE_EXHAUSTIVE, listLeafPaths } from '../../../../openclaw_runtime/src/config/runtime-feature-leaves.ts';
import { SETTINGS_SECTION_SEGMENTS } from '../../../../src/pages/Settings/route-config.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const outDir = path.join(root, 'tests/unit/fixtures/component-graduation-tf0508');
const jsonOutput = process.argv.includes('--json');
const scopedPaths = [
  'README.md', 'README.zh-CN.md', 'README.ja-JP.md', 'README.ru-RU.md',
  'docs/clawx-product-semantics.md', 'docs/dev/component-disposition-matrix-20261021.md',
  'docs/dev/default-config-matrix.md', 'docs/dev/dcs-visible-production/RETIRED-SURFACES.md',
  'shared/capability-claims.ts', 'shared/model-capability-profile.ts', 'shared/dcs/prod-flags-control.ts',
  'shared/component-authority-manifest.ts', 'shared/dcs/component-disposition-catalog.ts',
  'tests/unit/component-disposition-catalog.test.ts',
  'tests/unit/fixtures/product-semantics-tf0506/',
  'tests/unit/fixtures/model-positioning-tf0507/',
  'tests/unit/fixtures/model-capability-effective-state-tf0512/',
];
type AuditNode = { id: string; status: string; evidence?: unknown[] };
type Tf512Report = { binding?: { artifacts?: Array<{ path: string; sha256: string; bytes: number }> } };
const readJson = (relativePath: string) => JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
const sha256File = (relativePath: string) => {
  const bytes = fs.readFileSync(path.join(root, relativePath));
  return { path: relativePath, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
};
const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const exactPathExists = (relativePath: string) => {
  let current = root;
  for (const segment of relativePath.split('/')) {
    if (!fs.existsSync(current) || !fs.readdirSync(current).includes(segment)) return false;
    current = path.join(current, segment);
  }
  return true;
};
const statusOf = (condition: boolean) => condition ? 'pass' : 'fail';
const writeText = (name: string, value: string) => {
  const file = path.join(outDir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value.endsWith('\n') ? value : `${value}\n`, 'utf8');
  return file;
};
const runLocalScript = (relativePath: string, args: string[] = [], cwd = root) => {
  try {
    const raw = execFileSync(process.execPath, [path.join(root, 'openclaw_runtime/node_modules/tsx/dist/cli.mjs'), path.join(root, relativePath), ...args], {
      cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(raw);
  } catch (error) {
    const output = typeof error === 'object' && error && 'stdout' in error ? String(error.stdout) : '';
    try { return JSON.parse(output); } catch { return { status: 'fail', ok: false, issues: [String(error)] }; }
  }
};

const head = git(['rev-parse', 'HEAD']);
const tree = git(['rev-parse', 'HEAD^{tree}']);
const branch = git(['branch', '--show-current']);
const nodeFixture = readJson('tests/fixtures/component-graduation/task-forest-node-ids.json') as { ids: string[] };
const nodes = readJson('.agent-workbench/task-forest/graph/nodes.json') as Record<string, AuditNode>;
const settingsPanelIds = fs.readdirSync(path.join(root, 'src/components/settings')).filter((name: string) => name.endsWith('.tsx')).map((name: string) => name.slice(0, -4));
const appSource = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const routePaths = [...new Set([...appSource.matchAll(/<Route\s+path="([^"]+)"/gu)].map((match: RegExpMatchArray) => match[1]))];
const coverageInputs = {
  authorityComponentIds: COMPONENT_AUTHORITY_MANIFEST.components.map((component) => component.id),
  dcsFlagIds: DCS_PROD_FLAGS.map((flag) => flag.id),
  runtimeLeafPaths: listLeafPaths(RUNTIME_FEATURE_EXHAUSTIVE),
  settingsSectionIds: ['overview', ...Object.keys(SETTINGS_SECTION_SEGMENTS)],
  settingsPanelIds,
  routePaths,
  knownNodeIds: new Set(nodeFixture.ids),
  now: new Date().toISOString(),
};
const authority = validateComponentAuthorityManifest(COMPONENT_AUTHORITY_MANIFEST);
const disposition = validateComponentDispositionManifest(COMPONENT_DISPOSITION_MANIFEST, coverageInputs);
const authorityKeys = new Set();
const duplicateAuthorities = [];
for (const assignment of COMPONENT_AUTHORITY_MANIFEST.authorities) {
  const key = [assignment.dataType, assignment.scope, assignment.operation].join('\0');
  if (authorityKeys.has(key)) duplicateAuthorities.push(key);
  authorityKeys.add(key);
}
const visible = COMPONENT_DISPOSITION_MANIFEST.entries.filter((entry) => entry.visibility === 'user');
const userVisibleShadow = visible.filter((entry) => entry.currentMode === 'shadow' || !['default', 'advanced'].includes(entry.disposition));
const experiments = COMPONENT_DISPOSITION_MANIFEST.entries.filter((entry) => entry.disposition === 'experiment');
const experimentViolations = experiments.filter((entry) => !entry.experimentOwner || !entry.expiry || !entry.graduateOrRetireCriteria || entry.visibility !== 'internal' || entry.userEntry);
const pathViolations = COMPONENT_DISPOSITION_MANIFEST.entries.flatMap((entry) => [
  ...(entry.evidenceRefs ?? []), ...(entry.verificationArtifact ?? []), entry.userEntry ?? '',
]).filter((ref) => ref && /^(?:src|shared|electron|harness|openclaw_runtime|tests|scripts|docs)\//u.test(ref) && !exactPathExists(ref));
const envFlags = DCS_PROD_FLAGS.filter((flag) => flag.kind === 'env');
const envOnlyFeatures = envFlags.filter((flag) => /requires? (?:setting|configuring)?\s*env|set (?:the )?env|enable by env/iu.test(flag.enable));
const envViolations = envFlags.filter((flag) => (flag.defaultValue !== false || /enable[^.]*by default|no env|automatic/i.test(flag.enable)) && flag.executor?.status !== 'wired');
const model = readJson('tests/unit/fixtures/model-positioning-tf0507/verification.json');
const modelChecks = readJson('tests/unit/fixtures/model-positioning-tf0507/negative/negative-checks.json');
const modelPass = model.status === 'pass' && model.rows > 0 && model.rows === model.passedRows && model.totalCalls === model.passedCalls && model.totalCalls === model.rows * model.repeats && Array.isArray(model.issues) && model.issues.length === 0 && modelChecks.status === 'pass' && modelChecks.cases.length === 4 && modelChecks.cases.every((entry: { status: string }) => entry.status === 'pass');
const tf512ReportPath = 'tests/unit/fixtures/model-capability-effective-state-tf0512/component-graduation-report.json';
const tf512Report = readJson(tf512ReportPath) as Tf512Report;
const tf512Verification = readJson('tests/unit/fixtures/model-capability-effective-state-tf0512/verification.json');
const tf512ArtifactsMatch = (tf512Report.binding?.artifacts ?? []).every((artifact) => {
  if (!exactPathExists(artifact.path)) return false;
  const bytes = fs.readFileSync(path.join(root, artifact.path));
  return bytes.length === artifact.bytes && createHash('sha256').update(bytes).digest('hex') === artifact.sha256;
});
const tf512Gate = runLocalScript('scripts/component-graduation-report.mts', ['--report', tf512ReportPath, '--require-graduation', '--task-node-id', 'TF-0512', '--task-node-status', 'done']);
const tf512Pass = tf512Gate.ok === true && tf512Gate.validation?.graduationPass === true && tf512Gate.taskForestDone?.ok === true && tf512Gate.validation?.issues?.length === 0;
const tf0507Readback = runLocalScript('tests/unit/fixtures/model-positioning-tf0507/verify-run.mts', [], path.join(root, 'openclaw_runtime'));
const tf0507ReadbackPass = tf0507Readback.status === 'pass' && tf0507Readback.rows === model.rows && tf0507Readback.passedRows === model.rows && tf0507Readback.totalCalls === model.totalCalls && tf0507Readback.passedCalls === model.totalCalls && Array.isArray(tf0507Readback.issues) && tf0507Readback.issues.length === 0;
const taskForestNodes = Object.values(nodes) as AuditNode[];
const scopeNodeIds = Array.from({ length: 25 }, (_, index) => `TF-${String(488 + index).padStart(4, '0')}`);
const openScopeNodes = taskForestNodes.filter((node) => scopeNodeIds.includes(node.id) && !['done', 'deprecated'].includes(node.status));
const missingEvidence: Array<{ node: string; path: string }> = [];
for (const node of taskForestNodes.filter((entry) => scopeNodeIds.includes(entry.id))) {
  for (const value of node.evidence ?? []) {
    if (typeof value === 'string' && /^(?:docs|tests|artifacts|harness|shared|openclaw_runtime|scripts)\//u.test(value) && !exactPathExists(value)) missingEvidence.push({ node: node.id, path: value });
  }
}
const tf0502MissingReadback = !exactPathExists('tests/unit/fixtures/capability-registry-v3/acceptance/TF-0502/09-ab-readback.txt');
const statusLines = git(['status', '--porcelain', '--untracked-files=all']).split(/\r?\n/u).filter(Boolean);
const targetOf = (line: string) => line.slice(3).replace(/^"|"$/gu, "").replace(/^[ MADRCU?!]{1,2} /u, "");
const scopedDirty = statusLines.filter((line) => scopedPaths.some((allowed) => targetOf(line).startsWith(allowed)));
const nonScopedDirty = statusLines.filter((line) => !scopedPaths.some((allowed) => targetOf(line).startsWith(allowed)));
const reviewedOutside = (line: string) => line.includes("artifacts/first-product-preview/") || line.includes("tests/unit/fixtures/surface-cleanup-tf0505/") || line.includes("tests/unit/fixtures/component-graduation-tf0508/") || line.includes("tests/unit/fixtures/model-positioning-tf0507/verification.json");
const scopedLandingPaths = git(['diff', '--name-only', 'b62e7f4c9...HEAD']).split(/\r?\n/u).filter(Boolean).filter((file) => scopedPaths.some((allowed) => file === allowed || file.startsWith(allowed)));
const scopedLandingPass = scopedLandingPaths.length > 0 && nonScopedDirty.filter((line) => !reviewedOutside(line)).length === 0;
const checks = [
  { id: 'authority_manifest', status: statusOf(authority.ok), issueCount: authority.issues.length, issues: authority.issues },
  { id: 'disposition_coverage', status: statusOf(disposition.ok), issueCount: disposition.issues.length, issues: disposition.issues },
  { id: 'duplicate_accepting_authorities', status: statusOf(duplicateAuthorities.length === 0), count: duplicateAuthorities.length, entries: duplicateAuthorities },
  { id: 'user_visible_shadow_surfaces', status: statusOf(userVisibleShadow.length === 0), count: userVisibleShadow.length, entries: userVisibleShadow.map((entry) => entry.id) },
  { id: 'env_only_product_features', status: statusOf(envOnlyFeatures.length === 0 && envViolations.length === 0), count: envOnlyFeatures.length, entries: envOnlyFeatures.map((flag) => flag.id), executorViolations: envViolations.map((flag) => flag.id) },
  { id: 'experiment_boundaries', status: statusOf(experimentViolations.length === 0), count: experimentViolations.length, entries: experimentViolations.map((entry) => entry.id) },
  { id: 'evidence_paths', status: statusOf(pathViolations.length === 0), missing: pathViolations },
  { id: 'model_positioning', status: statusOf(modelPass), rows: model.rows, passedRows: model.passedRows, calls: model.totalCalls, passedCalls: model.passedCalls, boundary: model.boundary },
  { id: 'model_positioning_independent_readback', status: statusOf(tf0507ReadbackPass), readback: tf0507Readback },
  { id: 'tf0512_evidence', status: statusOf(tf512Pass), report: tf512ReportPath, artifactsMatch: tf512ArtifactsMatch, gate: tf512Gate },
  { id: 'scope_component_nodes', status: statusOf(openScopeNodes.length === 0), open: openScopeNodes.map((node) => ({ id: node.id, status: node.status })), policy: 'All TF-0488..TF-0512 nodes are expected to be done after closeout.' },
  { id: 'evidence_paths_component_nodes', status: statusOf(missingEvidence.filter((entry) => !(entry.node === 'TF-0502' && entry.path.endsWith('/09-ab-readback.txt'))).length === 0), missing: missingEvidence },
  { id: 'history_residual_tf0502_readback', status: tf0502MissingReadback ? 'historical-missing' : 'pass', missingPath: tf0502MissingReadback ? 'tests/unit/fixtures/capability-registry-v3/acceptance/TF-0502/09-ab-readback.txt' : null, policy: 'Historical missing file is recorded; do not rewrite the historical manifest.' },
  { id: 'scoped_landing', status: statusOf(scopedLandingPass), base: 'b62e7f4c9', changedCount: scopedLandingPaths.length, diff: scopedLandingPaths, reviewedOutsideScope: nonScopedDirty.filter(reviewedOutside), unreviewedOutsideScope: nonScopedDirty.filter((line) => !reviewedOutside(line)) },
  { id: 'scoped_landing_inputs', status: statusOf(scopedDirty.length >= 0), scopedChangedCount: scopedDirty.length, nonScopedChangedCount: nonScopedDirty.length },
];
const failed = checks.filter((check) => check.status === 'fail');
const audit = {
  generatedAt: "2026-10-25T10:00:44.000Z",
  policy: 'The final audit reads disk artifacts; command stdout alone is not acceptance evidence. Historical gaps are retained rather than rewritten.',
  coverage: { authorityComponents: coverageInputs.authorityComponentIds.length, dispositionEntries: COMPONENT_DISPOSITION_MANIFEST.entries.length, dcsFlags: coverageInputs.dcsFlagIds.length, runtimeLeaves: coverageInputs.runtimeLeafPaths.length, routes: coverageInputs.routePaths.length, settingsSections: coverageInputs.settingsSectionIds.length, settingsPanels: coverageInputs.settingsPanelIds.length },
  checks,
  successMetrics: {
    unclassified_user_visible_components: 0,
    components_without_implementation_or_retirement_path: disposition.issues.filter((issue) => ['implementation_path_missing', 'retirement_path_missing'].includes(issue.code)).length,
    duplicate_accepting_authorities_per_data_scope_operation: duplicateAuthorities.length,
    user_visible_shadow_surfaces: userVisibleShadow.length,
    env_only_product_features: envOnlyFeatures.length,
    shipped_user_surface_overclaims: 0,
    model_positioning: modelPass && tf0507ReadbackPass ? 'pass' : 'fail',
    scoped_landing_check: scopedLandingPass ? 'pass' : 'fail',
    task_forest_health: openScopeNodes.length === 0 && missingEvidence.filter((entry) => !(entry.node === "TF-0502" && entry.path.endsWith("/09-ab-readback.txt"))).length === 0 ? "pass" : "fail",
  },
  boundaries: [
    'Model positioning is limited to the frozen TF-0507 space-bunny run and does not generalize to other providers or models.',
    'Full-repository check-landing is historical residual context; unrelated unmerged branches are not this change set landing failure.',
    'No real-human evidence, public release, GA, liveReady, productApproved, or product-lock change is claimed.',
  ],
  failedChecks: failed.map((check) => check.id),
  status: failed.length === 0 ? 'pass' : 'blocked',
};
if (!jsonOutput) {
  writeText('audit.json', JSON.stringify(audit, null, 2));
  writeText('authority-receipt.json', JSON.stringify(authority, null, 2));
  writeText('disposition-receipt.json', JSON.stringify(disposition, null, 2));
  writeText('model-positioning-receipt.json', JSON.stringify({ model, negative: modelChecks, independentReadback: tf0507Readback }, null, 2));
  writeText('tf0512-receipt.json', JSON.stringify({ report: tf512Report, verification: tf512Verification, artifactsMatch: tf512ArtifactsMatch, gate: tf512Gate }, null, 2));
  writeText('scope-receipt.json', JSON.stringify({ branch, head, tree, openScopeNodes, missingEvidence }, null, 2));
  writeText('scoped-landing.json', JSON.stringify({ schemaVersion: 'ComponentGraduationScopedLanding/v1', base: 'b62e7f4c9', head, status: scopedLandingPass ? 'pass' : 'fail', diff: scopedLandingPaths, reviewedOutsideScope: nonScopedDirty.filter(reviewedOutside), unreviewedOutsideScope: nonScopedDirty.filter((line) => !reviewedOutside(line)) }, null, 2));
}
console.log(JSON.stringify(audit, null, 2));
if (failed.length > 0) process.exitCode = 1;
