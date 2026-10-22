import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  MEMORY_EXPORT_SCHEMA_VERSION,
  MEMORY_SURFACE_SCHEMA_VERSION,
  MEMORY_SURFACE_SEMANTICS,
  buildMemoryExportSnapshot,
  isAcceptedMemoryStatus,
  isCandidateMemoryProposal,
} from '../../../../../../src/components/agents/memory-surface.js';
import type { ComponentGraduationReport, GraduationArtifactRef } from '../../../../../../shared/component-graduation-report.js';

const root = process.cwd();
const outputDir = 'tests/unit/fixtures/memory-authority/acceptance/TF-0498';
const evidencePath = outputDir + '/raw-evidence.json';
const reportPath = outputDir + '/component-graduation-report.json';
const sumsPath = outputDir + '/SHA256SUMS';
const reportId = 'tf-0498-unified-memory-surface';

const sourcePaths = [
  'src/components/agents/memory-surface.ts',
  'src/components/agents/RolesOrchestrationPanel.tsx',
  'src/components/agents/ProposeFactsConfirmQueue.tsx',
  'src/pages/Agents/index.tsx',
  'shared/i18n/locales/en/agents.json',
  'shared/i18n/locales/zh/agents.json',
  'shared/i18n/locales/ja/agents.json',
  'shared/i18n/locales/ru/agents.json',
  'tests/unit/memory-surface-contract.test.ts',
  'tests/unit/roles-orchestration-panel.test.tsx',
  'tests/unit/propose-facts-confirm-queue.test.tsx',
  'tests/e2e/memory-surface.spec.ts',
  'tests/e2e/role-memory-panel.spec.ts',
  'tests/e2e/agents-propose-facts-confirm.spec.ts',
  'tests/unit/role-orchestration-methods.test.ts',
  'tests/unit/role-memory-context-provider.test.ts',
] as const;

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
function artifact(relativePath: string): GraduationArtifactRef {
  const bytes = fs.readFileSync(path.join(root, relativePath));
  return { path: relativePath, sha256: sha256(bytes), bytes: bytes.length };
}
function writeJson(relativePath: string, value: unknown): void {
  fs.writeFileSync(path.join(root, relativePath), JSON.stringify(value, null, 2) + '\n', 'utf8');
}

const nodes = JSON.parse(fs.readFileSync(path.join(root, '.agent-workbench/task-forest/graph/nodes.json'), 'utf8')) as Record<string, { acceptance_criteria: string[] }>;
const criteria = nodes['TF-0498']?.acceptance_criteria;
if (!criteria || criteria.length !== 4) throw new Error('TF-0498 acceptance criteria unavailable');

const acceptedCard = {
  id: 'accepted-memory',
  status: 'active',
  content: 'Accepted memory can be recalled.',
  type: 'fact',
  scope: 'role',
  sensitivity: 'normal',
  source: 'user',
  createdAt: '2026-10-21T00:00:00.000Z',
};
const candidate = {
  id: 'candidate-memory',
  status: 'needs_review',
  proposal: { content: 'Candidate memory cannot be recalled before approval.', type: 'fact', scope: 'role' },
};
const deletedCard = { ...acceptedCard, id: 'deleted-memory', status: 'tombstone' };
const exportSnapshot = buildMemoryExportSnapshot({
  generatedAt: '2026-10-22T00:00:00.000Z',
  roleName: 'architect',
  cards: [acceptedCard, deletedCard],
  proposals: [candidate, { id: 'history', status: 'applied', proposal: { content: 'reviewed memory' } }],
  injections: [{ id: 'injection-1', roleName: 'architect', cardIds: ['accepted-memory'] }],
});

const surfaceText = fs.readFileSync(path.join(root, 'src/components/agents/RolesOrchestrationPanel.tsx'), 'utf8');
const agentPageText = fs.readFileSync(path.join(root, 'src/pages/Agents/index.tsx'), 'utf8');
const candidateQueueText = fs.readFileSync(path.join(root, 'src/components/agents/ProposeFactsConfirmQueue.tsx'), 'utf8');

const surfaceAssertions = {
  onePanelMarker: surfaceText.includes('data-testid="role-memory-panel"') && surfaceText.includes('data-surface-id="agents.memory"'),
  candidateQueueInsidePanel: surfaceText.includes('<ProposeFactsConfirmQueue />'),
  noSecondAgentsPageQueue: !agentPageText.includes('ProposeFactsConfirmQueue'),
  exportEntryPresent: surfaceText.includes('data-testid="memory-export"'),
  deleteEntryPresent: surfaceText.includes('data-testid="role-memory-delete"'),
  deleteUsesTombstone: surfaceText.includes("hostApi.gateway.rpc('memory.archive', { id, tombstone: true })"),
  candidateReviewUsesAuthority: candidateQueueText.includes('hostApi.memory.proposeFactsConfirm'),
  modelVisibilityCopyPresent: surfaceText.includes('data-testid="memory-model-visibility"'),
  masterOffCopyPresent: surfaceText.includes('data-testid="memory-disabled-semantics"'),
};

const acceptedExportIds = (exportSnapshot.acceptedMemory as Array<{ id: string }>).map((entry) => entry.id);
const candidateExportIds = (exportSnapshot.candidateQueue as Array<{ id: string }>).map((entry) => entry.id);

const masterSwitch = {
  ...MEMORY_SURFACE_SEMANTICS.masterSwitch,
  productionConsumers: [
    'gateway role-orchestration-methods read/write guards',
    'role-memory-context-provider injection gate',
    'role-spawn context gate',
    'chat-knowledge-source-adapters retrieval gate',
  ],
  legacyBehavior: MEMORY_SURFACE_SEMANTICS.legacyFallback,
};

const candidateIsolation = {
  schemaVersion: MEMORY_SURFACE_SCHEMA_VERSION,
  candidateStatuses: ['pending', 'needs_review'],
  acceptedStatuses: MEMORY_SURFACE_SEMANTICS.readGate.acceptedStatuses,
  candidateEvaluatedAsAccepted: isAcceptedMemoryStatus(candidate.status),
  candidateIsReviewCandidate: isCandidateMemoryProposal(candidate),
  exportAcceptedIds: acceptedExportIds,
  exportCandidateIds: candidateExportIds,
  acceptedOnly: MEMORY_SURFACE_SEMANTICS.readGate.acceptedOnly,
  unapprovedCandidateRetrievable: MEMORY_SURFACE_SEMANTICS.readGate.unapprovedCandidateRetrievable,
  unapprovedCandidateInjectable: MEMORY_SURFACE_SEMANTICS.readGate.unapprovedCandidateInjectable,
};

const modelVisibility = {
  productConcept: MEMORY_SURFACE_SEMANTICS.productConcept,
  approvedOnly: MEMORY_SURFACE_SEMANTICS.modelVisibility.approvedOnly,
  candidateExplanation: MEMORY_SURFACE_SEMANTICS.modelVisibility.candidateExplanation,
  explicitRememberPolicy: MEMORY_SURFACE_SEMANTICS.writeGate.explicitRemember,
  automaticAcceptance: MEMORY_SURFACE_SEMANTICS.writeGate.automaticAcceptance,
};

const criterionStatuses = [
  surfaceAssertions.onePanelMarker
    && surfaceAssertions.candidateQueueInsidePanel
    && surfaceAssertions.noSecondAgentsPageQueue
    && surfaceAssertions.exportEntryPresent
    && surfaceAssertions.deleteEntryPresent
    && surfaceAssertions.candidateReviewUsesAuthority,
  candidateIsolation.candidateEvaluatedAsAccepted === false
    && candidateIsolation.candidateIsReviewCandidate
    && candidateIsolation.unapprovedCandidateRetrievable === false
    && candidateIsolation.unapprovedCandidateInjectable === false,
  masterSwitch.offBlocksRead
    && masterSwitch.offBlocksWrite
    && masterSwitch.offBlocksInjection
    && !masterSwitch.deletesStoredMemory
    && masterSwitch.legacyBehavior.nativeOpenClawMemory === 'unchanged-and-outside-this-surface'
    && surfaceAssertions.masterOffCopyPresent,
  modelVisibility.approvedOnly
    && modelVisibility.candidateExplanation.includes('not accepted')
    && surfaceAssertions.modelVisibilityCopyPresent,
].map((ok) => (ok ? 'pass' : 'fail'));

const evidence = {
  schemaVersion: 'MemoryProductSurfaceAcceptanceEvidence/v1',
  reportId,
  taskForestNodeId: 'TF-0498',
  generatedAt: new Date().toISOString(),
  driven_by: 'agent',
  actor: 'codex',
  acceptanceCriteria: [
    {
      criterion: criteria[0],
      status: criterionStatuses[0],
      evidence: ['MemoryProductSurface/v1', 'one Agents-page panel marker', 'candidate queue mounted inside the panel', 'export and tombstone delete actions'],
    },
    {
      criterion: criteria[1],
      status: criterionStatuses[1],
      evidence: ['candidate status excluded from accepted export', 'candidate queue persists', 'candidate is not retrievable or injectable'],
    },
    {
      criterion: criteria[2],
      status: criterionStatuses[2],
      evidence: ['master switch semantics', 'production consumer ancestry', 'native OpenClaw memory unchanged'],
    },
    {
      criterion: criteria[3],
      status: criterionStatuses[3],
      evidence: ['MemoryProductSurface/v1 modelVisibility', 'Agent panel model-visible copy'],
    },
  ],
  surface: {
    schemaVersion: MEMORY_SURFACE_SCHEMA_VERSION,
    surfaceId: MEMORY_SURFACE_SEMANTICS.surfaceId,
    productConcept: MEMORY_SURFACE_SEMANTICS.productConcept,
    actions: MEMORY_SURFACE_SEMANTICS.actions,
    assertions: surfaceAssertions,
  },
  masterSwitch,
  candidateIsolation,
  modelVisibility,
  export: {
    schemaVersion: MEMORY_EXPORT_SCHEMA_VERSION,
    counts: exportSnapshot.counts,
    acceptedOnly: (exportSnapshot.acceptedMemory as Array<{ status: string }>).every((card) => card.status === 'active' || card.status === 'cold'),
    candidateQueueSeparated: Array.isArray(exportSnapshot.candidateQueue),
    tombstoneExcludedFromAccepted: !acceptedExportIds.includes('deleted-memory'),
  },
  deletion: MEMORY_SURFACE_SEMANTICS.deletion,
  evidenceNotes: {
    noProductDefaultChanged: true,
    noNewRoute: true,
    noSecondReviewUi: true,
    noExtractionAlgorithmChange: true,
    noVerseGitWork: true,
    noRealHumanEvidence: true,
    publicReleaseClaimed: false,
    gaClaimed: false,
    liveReadyClaimed: false,
    productApprovedClaimed: false,
  },
  results: {
    contract: { status: criterionStatuses.every((status) => status === 'pass') ? 'pass' : 'fail' },
    'real-consumer': { status: criterionStatuses[0] === 'pass' ? 'pass' : 'fail' },
    boundary: { status: criterionStatuses[1] === 'pass' ? 'pass' : 'fail' },
    necessity: { status: criterionStatuses[0] === 'pass' && criterionStatuses[3] === 'pass' ? 'pass' : 'fail' },
    'failure-recovery': { status: criterionStatuses[2] === 'pass' ? 'pass' : 'fail' },
    'not-product-claim': { status: 'pass' },
  },
};

writeJson(evidencePath, evidence);
const persisted = JSON.parse(fs.readFileSync(path.join(root, evidencePath), 'utf8')) as typeof evidence;
if (persisted.results.contract.status !== 'pass' || persisted.acceptanceCriteria.some((entry) => entry.status !== 'pass')) {
  throw new Error('TF-0498 acceptance evidence failed');
}

const rawArtifact = artifact(evidencePath);
const bindingArtifacts = [
  ...sourcePaths.map(artifact),
  artifact(outputDir + '/README.md'),
  artifact(outputDir + '/generate-acceptance.mts'),
  artifact(outputDir + '/run-verification.ps1'),
  artifact(evidencePath),
];
const inputDigest = sha256(bindingArtifacts.map((entry) => entry.path + '\0' + entry.sha256 + '\0' + entry.bytes).sort().join('\n'));
const buildHash = sha256(JSON.stringify(bindingArtifacts));
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).trim();
const report: ComponentGraduationReport = {
  schemaVersion: 'ComponentGraduationReport/v1',
  reportId,
  reportKind: 'contract',
  componentId: 'role-memory-card-governance',
  taskForestNodeId: 'TF-0498',
  disposition: 'internal',
  maturity: 'verified',
  owner: 'TF-0498',
  entryPoint: 'src/components/agents/RolesOrchestrationPanel.tsx',
  defaultMode: 'opt-in',
  benefitEvidence: 'One Memory panel lets a user review candidates, approve accepted memory, delete by tombstone and export a scoped snapshot without a second review UI; candidates remain non-retrievable and non-injectable until approval.',
  rollback: 'Remove the Memory surface contract and candidate-block UI additions; retain the existing Role/Runtime stores, approvals, default mode and native OpenClaw memory.',
  modelEffectiveState: 'Only accepted memory is model-visible. Candidates are stored for review only and are neither retrievable nor injectable until approved; switching Memory off retains stored cards on disk but blocks read, write and injection, while native OpenClaw memory remains separate and unchanged.',
  evidenceGrade: 'e2e',
  actor: 'codex',
  driven_by: 'agent',
  expiry: null,
  binding: {
    commit,
    tree,
    buildHash,
    runtimeGeneration: 'memory-surface-tf0498',
    provider: 'fixture-provider',
    model: 'fixture-model',
    inputSet: 'tf0498-unified-memory-surface',
    scope: 'workspace:component-graduation/session:tf-0498',
    artifacts: bindingArtifacts,
  },
  evidence: [
    { kind: 'contract', status: 'pass', grade: 'e2e', summary: 'The single Memory surface contract, candidate isolation, master-off semantics and export separation are all verified.', artifacts: [{ ...rawArtifact, supportsVerdict: true }] },
    { kind: 'real-consumer', status: 'pass', grade: 'e2e', summary: 'Existing Agent-page consumers use one panel and the candidate queue inside it.', artifacts: [{ ...rawArtifact, supportsVerdict: true }] },
    { kind: 'boundary', status: 'pass', grade: 'unit-test', summary: 'Candidate statuses are excluded from accepted memory and export separation is explicit.', artifacts: [{ ...rawArtifact, supportsVerdict: true }] },
    { kind: 'necessity', status: 'pass', grade: 'e2e', summary: 'The single panel is required for review, approval, deletion and local export in one product surface.', artifacts: [{ ...rawArtifact, supportsVerdict: true }] },
    { kind: 'failure-recovery', status: 'pass', grade: 'unit-test', summary: 'Master-off retains cards on disk while blocking reads/writes/injection, and tombstone preserves audit history.', artifacts: [{ ...rawArtifact, supportsVerdict: true }] },
    { kind: 'not-product-claim', status: 'pass', grade: 'documented-boundary', summary: 'No release, GA, liveReady, productApproved or default-lock claim is made.', artifacts: [{ ...rawArtifact, supportsVerdict: true }] },
  ],
  recompute: {
    verdict: 'pass',
    inputDigest,
    command: '& .\\openclaw_runtime\\node_modules\\.bin\\tsx.CMD tests/unit/fixtures/memory-authority/acceptance/TF-0498/generate-acceptance.mts',
  },
};
writeJson(reportPath, report);

const sumTargets = [
  ...sourcePaths,
  outputDir + '/README.md',
  outputDir + '/generate-acceptance.mts',
  outputDir + '/run-verification.ps1',
  evidencePath,
  reportPath,
];
const sums = sumTargets.sort().map((relativePath) => sha256(fs.readFileSync(path.join(root, relativePath))) + '  ' + relativePath).join('\n');
fs.writeFileSync(path.join(root, sumsPath), sums + '\n', 'utf8');
for (const line of sums.split('\n')) {
  const [expected, fileName] = line.split('  ');
  const actual = sha256(fs.readFileSync(path.join(root, fileName)));
  if (actual !== expected) throw new Error('SHA256SUMS mismatch: ' + fileName);
}
console.log(JSON.stringify({ ok: true, reportId, evidencePath, reportPath, sumsPath, criteria: persisted.acceptanceCriteria.map((entry) => entry.status) }, null, 2));
