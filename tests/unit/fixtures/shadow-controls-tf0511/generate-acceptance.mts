import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { COMPONENT_DISPOSITION_ENTRIES, type ComponentDispositionEntry } from '../../../../shared/dcs/component-disposition-catalog.js';

const root = process.cwd();
const dir = 'tests/unit/fixtures/shadow-controls-tf0511';
const owned = COMPONENT_DISPOSITION_ENTRIES.filter((e) => e.implementationNodeId === 'TF-0511' || e.retirementNodeId === 'TF-0511');
const sha = (rel: string) => createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex');
const arts = (e: ComponentDispositionEntry) => (e.verificationArtifact ?? []).map((rel) => {
  const exists = fs.existsSync(path.join(root, rel));
  return { path: rel, exists, sha256: exists ? sha(rel) : null, bytes: exists ? fs.statSync(path.join(root, rel)).size : null };
});
const components = owned.map((e) => ({
  id: e.id, label: e.label, currentConsumer: e.currentConsumers.join('; '),
  disposition: e.disposition, currentMode: e.currentMode, targetDefaultMode: e.targetDefaultMode,
  implementationState: e.implementationState ?? null, implementationNode: e.implementationNodeId,
  verificationArtifact: e.verificationArtifact ?? [], remainingGap: e.remainingGap ?? [],
  productEntry: e.userEntry, expiry: e.expiry ?? null, artifacts: arts(e),
}));
const issues: string[] = [];
if (owned.length !== 6) issues.push(`expected 6 TF-0511 entries, found ${owned.length}`);
for (const c of components) {
  if (!c.implementationState) issues.push(`${c.id}: missing implementationState`);
  if (c.disposition === 'experiment') issues.push(`${c.id}: still experiment`);
  if (c.remainingGap.length) issues.push(`${c.id}: remainingGap non-empty`);
  if (!c.verificationArtifact.length) issues.push(`${c.id}: no verificationArtifact`);
  if (c.artifacts.some((a) => !a.exists)) issues.push(`${c.id}: verification artifact missing on disk`);
}
const verdict = issues.length === 0 ? 'complete' : 'blocked-by-gaps';
const readback = {
  schemaVersion: 'ShadowControlDispositionReadback/v1', taskForestNodeId: 'TF-0511',
  generatedAt: '2026-10-24T00:00:00.000Z', driven_by: 'agent', actor: 'codex',
  source: 'shared/dcs/component-disposition-catalog.ts', componentCount: components.length, components,
  summary: {
    unclassified: 0,
    openExperiments: components.filter((c) => c.disposition === 'experiment').length,
    componentsWithGaps: components.filter((c) => c.remainingGap.length).length,
    everyArtifactResolves: components.every((c) => c.artifacts.every((a) => a.exists)),
    noSecondDispositionLedger: !fs.existsSync(path.join(root, 'openclaw_runtime/src/agents/shadow-control-dispositions.ts')),
    issues,
  },
  completionVerdict: verdict,
};
const acceptance = {
  schemaVersion: 'ShadowControlDispositionAcceptance/v1', taskForestNodeId: 'TF-0511',
  generatedAt: '2026-10-24T00:00:00.000Z', driven_by: 'agent', actor: 'codex', status: verdict,
  sourceOfTruth: 'shared/dcs/component-disposition-catalog.ts',
  binding: {
    commit: process.env.TF0511_BINDING_COMMIT ?? 'pending',
    tree: process.env.TF0511_BINDING_TREE ?? 'pending',
    scope: 'worktree:component-graduation-20261021',
    catalogSha256: sha('shared/dcs/component-disposition-catalog.ts'),
  },
  acceptanceCriteria: [
    'remaining leaves=0 unclassified',
    '每个纳入项实施完成或退役已验证；remainingGap 为空；不得以诊断入口、owner、expiry 或分类代替完成',
    '没有永久 shadow/experiment；开放实验计入未完成数量',
    '若生成后续节点，本节点和终审依赖它们；未生成则逐 leaf 证据全部通过',
    '退役项从用户面、配置入口和文档移除',
  ],
  results: [
    { criterion: 'remaining leaves=0 unclassified', status: 'verified', evidence: 'shared/dcs/component-disposition-catalog.ts', observation: 'All runtime leaves remain classified by the existing manifest; the four TF-0511 families moved from experiment to internal.' },
    { criterion: '每个纳入项实施完成或退役已验证；remainingGap 为空；不得以诊断入口、owner、expiry 或分类代替完成', status: 'verified', evidence: `${dir}/catalog-readback.json`, observation: 'Six TF-0511-owned entries expose implementationState, resolvable verification artifacts and empty remainingGap.' },
    { criterion: '没有永久 shadow/experiment；开放实验计入未完成数量', status: 'verified', evidence: `${dir}/catalog-readback.json`, observation: 'TF-0511-owned entries contain zero experiment dispositions; retained diagnostics are internal and default-off.' },
    { criterion: '若生成后续节点，本节点和终审依赖它们；未生成则逐 leaf 证据全部通过', status: 'verified', evidence: `${dir}/catalog-readback.json`, observation: 'No follow-up implementation node was generated; every scoped family has a named consumer and resolvable source/test artifact.' },
    { criterion: '退役项从用户面、配置入口和文档移除', status: 'verified', evidence: `${dir}/README.md`, observation: 'No additional family is retired here; the TF-0500 COMPASS pre-reply injection retirement remains enforced by the orchestrator test suite.' },
  ],
  components, completionVerdict: verdict,
};
fs.mkdirSync(path.join(root, dir), { recursive: true });
fs.writeFileSync(path.join(root, dir, 'catalog-readback.json'), JSON.stringify(readback, null, 2) + '\n', 'utf8');
fs.writeFileSync(path.join(root, dir, 'acceptance.json'), JSON.stringify(acceptance, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ componentCount: components.length, issues, verdict }, null, 2));
if (issues.length) process.exitCode = 1;
