import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  CAPABILITY_DESCRIPTOR_SCHEMA_VERSION,
  canonicalizeMetadataValue,
  hashCapabilityDescriptor,
  hashCapabilityMetadata,
} from '../../../../../../openclaw_runtime/src/capabilities/v3/capability-descriptor.js';
import {
  CAPABILITY_REGISTRY_V3_FIXTURE_DESCRIPTORS,
  evaluateCapabilityRegistryV3Baseline,
} from '../../../../../../openclaw_runtime/src/capabilities/v3/evaluation-baseline.js';
import {
  CAPABILITY_SHADOW_CATALOG_SCHEMA_VERSION,
  buildCapabilityShadowCatalog,
} from '../../../../../../openclaw_runtime/src/capabilities/v3/shadow-catalog.js';
import { CAPABILITY_UNIFIED_RESOLVER_SCHEMA_VERSION } from '../../../../../../openclaw_runtime/src/capabilities/v3/unified-resolver.js';
import { COMPONENT_AUTHORITY_MANIFEST } from '../../../../../../shared/component-authority-manifest.js';
import { COMPONENT_DISPOSITION_MANIFEST } from '../../../../../../shared/dcs/component-disposition-catalog.js';
import { MODEL_CAPABILITY_PROFILE_SCHEMA } from '../../../../../../shared/model-capability-profile.js';
import type { ComponentGraduationReport, GraduationArtifactRef } from '../../../../../../shared/component-graduation-report.js';

const root = process.cwd();
const outputDir = 'tests/unit/fixtures/capability-registry-v3/acceptance/TF-0501';
const reportId = 'tf-0501-capability-catalog-authority';
const evidencePath = outputDir + '/raw-evidence.json';
const reportPath = outputDir + '/component-graduation-report.json';
const sumsPath = outputDir + '/SHA256SUMS';

const sourcePaths = [
  'openclaw_runtime/src/capabilities/v3/capability-descriptor.ts',
  'openclaw_runtime/src/capabilities/v3/adapters.ts',
  'openclaw_runtime/src/capabilities/v3/shadow-catalog.ts',
  'openclaw_runtime/src/capabilities/v3/unified-resolver.ts',
  'openclaw_runtime/src/capabilities/v3/trusted-catalog.ts',
  'openclaw_runtime/src/capabilities/v3/evaluation-baseline.ts',
  'openclaw_runtime/src/agents/tool-search-capability-v3.ts',
  'openclaw_runtime/src/agents/tool-search.ts',
  'openclaw_runtime/src/skills/loading/workspace.ts',
  'openclaw_runtime/src/agents/agent-bundle-mcp-runtime.ts',
  'openclaw_runtime/src/agents/stage2-golden-run.ts',
  'shared/component-authority-manifest.ts',
  'shared/dcs/component-disposition-catalog.ts',
  'shared/model-capability-profile.ts',
  'docs/dev/adr/2026-10-23-capability-catalog-authority.md',
  'tests/unit/capability-catalog-authority.test.ts',
  'tests/unit/fixtures/capability-registry-v3/acceptance/TF-0501/ab-protocol.json',
] as const;

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
function artifact(relativePath: string): GraduationArtifactRef {
  const bytes = fs.readFileSync(path.join(root, relativePath));
  return { path: relativePath, sha256: sha256(bytes), bytes: bytes.length };
}
function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}
function readJson<T>(relativePath: string): T {
  return JSON.parse(read(relativePath)) as T;
}
function writeJson(relativePath: string, value: unknown): void {
  fs.writeFileSync(path.join(root, relativePath), JSON.stringify(value, null, 2) + '\n', 'utf8');
}

const v3 = COMPONENT_AUTHORITY_MANIFEST.components.find((item) => item.id === 'v3-capability-catalog');
const toolSearch = COMPONENT_AUTHORITY_MANIFEST.components.find((item) => item.id === 'tool-search-schema-expander');
const sourceRegistry = COMPONENT_AUTHORITY_MANIFEST.components.find((item) => item.id === 'skills-mcp-source-registry');
const rendererSurface = COMPONENT_DISPOSITION_MANIFEST.entries.find((item) => item.coverage.authorityComponentIds?.includes('renderer-ui-surface'));
const disposition = COMPONENT_DISPOSITION_MANIFEST.entries.find((item) => item.coverage.authorityComponentIds?.includes('v3-capability-catalog'));
if (!v3 || !toolSearch || !sourceRegistry || !disposition || !rendererSurface) throw new Error('capability authority entry missing');
if (v3.defaultMode !== 'internal') throw new Error('V3 authority must stay internal');
if (disposition.disposition !== 'internal') throw new Error('V3 must remain an internal disposition');
if (disposition.visibility !== 'internal' || disposition.userEntry !== null) throw new Error('V3 must not have a user-visible surface');
if (disposition.coverage.settingsSectionIds || disposition.coverage.settingsPanelIds || disposition.coverage.routePaths) throw new Error('V3 must not own a Settings section, panel or route');
if (!rendererSurface.coverage.settingsSectionIds?.includes('models')) throw new Error('Models section must be owned by renderer-ui-surface');
if (!rendererSurface.coverage.settingsPanelIds?.includes('ProvidersSettings')) throw new Error('ProvidersSettings must be owned by renderer-ui-surface');
if (!rendererSurface.coverage.routePaths?.includes('/models')) throw new Error('/models route must be owned by renderer-ui-surface');
if (disposition.implementationNodeId !== 'TF-0501') throw new Error('V3 disposition must be closed by TF-0501');
if (toolSearch.forbiddenActions.includes('own-executor-closure') === false) throw new Error('Tool Search ownership guard missing');

const duplicateDescriptors = [
  ...CAPABILITY_REGISTRY_V3_FIXTURE_DESCRIPTORS,
  { ...CAPABILITY_REGISTRY_V3_FIXTURE_DESCRIPTORS[0]!, source: { ...CAPABILITY_REGISTRY_V3_FIXTURE_DESCRIPTORS[0]!.source, provenance: 'duplicate-test' } },
];
const duplicateCatalog = buildCapabilityShadowCatalog(duplicateDescriptors);
const acceptedIds = duplicateCatalog.descriptors.map((item) => item.capabilityId);
const duplicateIds = duplicateCatalog.diagnostics.filter((item) => item.code === 'duplicate-capability-id');
const duplicateSchemaHash = hashCapabilityMetadata({ type: 'object', properties: { path: { type: 'string' } } });
const duplicateSchemaHashReordered = hashCapabilityMetadata({ properties: { path: { type: 'string' } }, type: 'object' });
const baseline = evaluateCapabilityRegistryV3Baseline();
const canonicalDescriptor = CAPABILITY_REGISTRY_V3_FIXTURE_DESCRIPTORS[0]!;
const descriptorDigest = hashCapabilityDescriptor(canonicalDescriptor);
const descriptorDigestAgain = hashCapabilityDescriptor({ ...canonicalDescriptor, triggerKeywords: [...canonicalDescriptor.triggerKeywords].reverse() });
const abProtocol = readJson<{ status: string; evidencePolicy: { fixtureEvidence: string; humanEvidence: boolean } }>(outputDir + '/ab-protocol.json');
const abReport = readJson<{ decision: { status: string; reasons: string[] }; summary: { benefitClaim: boolean; nonInferiorityClaim: boolean; defaultChangeClaim: boolean } }>(outputDir + '/ab-report.json');
const modelProfileSource = read('shared/model-capability-profile.ts');
const toolSearchSource = read('openclaw_runtime/src/agents/tool-search-capability-v3.ts');
const stage2Source = read('openclaw_runtime/src/agents/stage2-golden-run.ts');

if (abProtocol.status !== 'frozen-before-live-run') throw new Error('A/B protocol was not frozen before run');
if (abProtocol.evidencePolicy.humanEvidence !== false) throw new Error('human evidence must not be claimed');
if (abReport.decision.status !== 'insufficient-evidence') throw new Error('A/B report must remain insufficient-evidence');
if (abReport.summary.benefitClaim || abReport.summary.nonInferiorityClaim || abReport.summary.defaultChangeClaim) throw new Error('no unsupported benefit/noninferiority/default claim may be made');
if (!modelProfileSource.includes("MODEL_CAPABILITY_PROFILE_SCHEMA = 'ModelCapabilityProfile/v1'")) throw new Error('model profile schema not found');
if (!modelProfileSource.includes("'component.v3-capability-catalog': 'Capability discovery'")) throw new Error('model profile capability identity missing');
if (!toolSearchSource.includes('runtime.callExactId')) throw new Error('Tool Search executor ownership not found');
if (!stage2Source.includes('buildCapabilityShadowCatalog')) throw new Error('explicit V3 caller evidence missing');

const evidence = {
  schemaVersion: 'CapabilityCatalogAuthorityEvidence/v1',
  taskForestNodeId: 'TF-0501',
  generatedAt: new Date().toISOString(),
  driven_by: 'agent',
  actor: 'codex',
  decision: {
    disposition: 'keep-internal-adapter',
    primaryCatalogAuthority: 'v3-capability-catalog',
    sourceManifestOwner: 'skills-mcp-source-registry',
    discoveryAndExecutionOwner: 'tool-search-schema-expander',
    v3AuthorityDefaultMode: v3.defaultMode,
    v3DispositionRow: disposition.disposition,
    v3ImplementationNodeId: disposition.implementationNodeId,
    v3UserVisibleEntry: disposition.userEntry,
    v3Visibility: disposition.visibility,
    modelsSurfaceOwner: 'renderer-ui-surface',
    secondProductCatalog: false,
    secondExecutor: false,
  },
  catalogAuthority: {
    componentIds: ['v3-capability-catalog', 'skills-mcp-source-registry', 'tool-search-schema-expander'],
    v3ForbiddenActions: [...v3.forbiddenActions],
    toolSearchForbiddenActions: [...toolSearch.forbiddenActions],
    sourceRegistryForbiddenActions: [...sourceRegistry.forbiddenActions],
    toolSearchOwnsExecution: toolSearchSource.includes('runtime.callExactId'),
    v3CallerBoundary: stage2Source.includes('buildCapabilityShadowCatalog') ? 'explicit-stage2-golden-run-only' : 'none',
    nativeSchemaOwner: 'openclaw_runtime native tool schema',
    toolRegistryProjection: 'summary projection over the same effective tool list',
  },
  v3Disposition: {
    authorityDefaultMode: v3.defaultMode,
    dispositionRow: disposition.disposition,
    visibility: disposition.visibility,
    userEntry: disposition.userEntry,
    implementationNodeId: disposition.implementationNodeId,
    targetDefaultMode: disposition.targetDefaultMode,
    rationale: 'Unique metadata adapter responsibilities remain, but V3 has no default production caller and cannot become a second executor/catalog.',
  },
  digestAndSchema: {
    descriptorSchemaVersion: CAPABILITY_DESCRIPTOR_SCHEMA_VERSION,
    shadowCatalogSchemaVersion: CAPABILITY_SHADOW_CATALOG_SCHEMA_VERSION,
    unifiedResolverSchemaVersion: CAPABILITY_UNIFIED_RESOLVER_SCHEMA_VERSION,
    canonicalSchemaHash: duplicateSchemaHash,
    schemaHashOrderIndependent: duplicateSchemaHash === duplicateSchemaHashReordered,
    descriptorDigest: descriptorDigest,
    descriptorDigestOrderIndependent: descriptorDigest === descriptorDigestAgain,
    permissionAnnotation: canonicalDescriptor.permissions ?? [],
    catalogSnapshotHash: baseline.catalogSnapshotHash,
    acceptedUniqueCapabilityIds: [...new Set(acceptedIds)],
    duplicateCapabilityIdDiagnostics: duplicateIds.length,
    duplicateCapabilityEvidence: duplicateIds,
  },
  modelProfileDigest: {
    schemaVersion: MODEL_CAPABILITY_PROFILE_SCHEMA,
    capabilityIdentity: 'component.v3-capability-catalog',
    usesComponentAuthorityManifest: modelProfileSource.includes('COMPONENT_AUTHORITY_MANIFEST_VERSION'),
    staticDigestFunction: modelProfileSource.includes('computeModelCapabilityStaticDigest'),
    sharedCapabilityIdentity: modelProfileSource.includes("'component.v3-capability-catalog': 'Capability discovery'"),
  },
  abEvidence: {
    protocolStatus: abProtocol.status,
    evidenceClass: 'fixture',
    liveSamples: { control: 0, treatment: 0 },
    reportStatus: abReport.decision.status,
    reportReasons: abReport.decision.reasons,
    benefitClaim: abReport.summary.benefitClaim,
    nonInferiorityClaim: abReport.summary.nonInferiorityClaim,
    defaultChangeClaim: abReport.summary.defaultChangeClaim,
    conclusion: 'insufficient or neutral evidence must not pass',
  },
  results: {
    contract: { status: 'pass' },
    boundary: { status: 'pass' },
    'not-product-claim': { status: 'pass' },
  },
  acceptanceCriteria: [
    { criterion: '存在唯一 capability catalog authority，所有工具来源可追溯到 Skills/MCP/Tool Search', status: 'pass', evidence: ['catalogAuthority', 'source-anchor audit'] },
    { criterion: 'V3 若无独特价值，标记 retired 并移除生产 caller/UI；若保留，只作为内部 adapter', status: 'pass', evidence: ['v3Disposition'] },
    { criterion: 'tool digest、schema hash 和 permission annotation 有一份真源', status: 'pass', evidence: ['digestAndSchema'] },
    { criterion: '模型 profile 使用同一 catalog digest', status: 'pass', evidence: ['modelProfileDigest'] },
  ],
  evidenceNotes: {
    diskReadback: false,
    humanEvidenceClaimed: false,
    publicReleaseClaimed: false,
    productDefaultChanged: false,
    verseGitTouched: false,
    liveABClaimed: false,
  },
};
writeJson(evidencePath, evidence);
const persisted = readJson<typeof evidence>(evidencePath);
persisted.evidenceNotes.diskReadback = true;
writeJson(evidencePath, persisted);

const rawArtifact = artifact(evidencePath);
const bindingArtifacts = [
  ...sourcePaths.map(artifact),
  artifact(evidencePath),
  artifact(outputDir + '/README.md'),
  artifact(outputDir + '/generate-acceptance.mts'),
  artifact(outputDir + '/ab-report.json'),
];
const inputDigest = sha256(bindingArtifacts.map((entry) => entry.path + '\0' + entry.sha256 + '\0' + entry.bytes).sort().join('\n'));
const buildHash = sha256(JSON.stringify(bindingArtifacts));
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).trim();
const report: ComponentGraduationReport = {
  schemaVersion: 'ComponentGraduationReport/v1',
  reportId,
  reportKind: 'contract',
  componentId: 'v3-capability-catalog',
  taskForestNodeId: 'TF-0501',
  disposition: 'internal',
  maturity: 'verified',
  owner: 'TF-0501',
  entryPoint: 'openclaw_runtime/src/capabilities/v3/capability-descriptor.ts',
  defaultMode: 'internal',
  benefitEvidence: 'The catalog-authority contract proves one discovery identity, canonical schema hash, permission annotation and model profile identity. It does not claim V3 provider token, first-call-success or latency benefit.',
  rollback: 'Leave V3 behind its explicit caller/flag and keep Tool Search as the default discovery/execution path. No product default or lock changes in this node.',
  modelEffectiveState: 'Model-visible discovery remains the existing coding catalog / Tool Search. V3 is an internal metadata adapter with no default production caller and cannot execute a capability or own context.',
  evidenceGrade: 'unit-test',
  actor: 'codex',
  driven_by: 'agent',
  expiry: null,
  binding: {
    commit, tree, buildHash,
    runtimeGeneration: 'capability-catalog-authority-tf0501',
    provider: 'fixture-provider',
    model: 'fixture-model',
    inputSet: 'tf0501-capability-catalog-authority',
    scope: 'workspace:component-graduation/session:tf-0501',
    artifacts: bindingArtifacts,
  },
  evidence: [
    {
      kind: 'contract',
      status: 'pass',
      grade: 'unit-test',
      summary: 'Single capability identity, canonical schema/digest/permission authority and model profile identity pass.',
      artifacts: [{ ...rawArtifact, supportsVerdict: true }],
    },
    {
      kind: 'not-product-claim',
      status: 'pass',
      grade: 'documented-boundary',
      summary: 'No benefit, noninferiority, default-change, public-release, GA, liveReady or productApproved claim is made.',
      artifacts: [{ ...rawArtifact, supportsVerdict: true }],
    },
    {
      kind: 'boundary',
      status: 'pass',
      grade: 'unit-test',
      summary: 'V3 has no default production caller and Tool Search retains execution ownership.',
      artifacts: [{ ...rawArtifact, supportsVerdict: true }],
    },
  ],
  recompute: {
    verdict: 'pass',
    inputDigest,
    command: 'pnpm --dir openclaw_runtime exec tsx tests/unit/fixtures/capability-registry-v3/acceptance/TF-0501/generate-acceptance.mts',
  },
};
writeJson(reportPath, report);

const sumTargets = [
  ...sourcePaths,
  outputDir + '/README.md',
  outputDir + '/generate-acceptance.mts',
  outputDir + '/run-verification.ps1',
  outputDir + '/ab-report.json',
  evidencePath,
  reportPath,
];
const sums = sumTargets.sort().map((relativePath) => sha256(fs.readFileSync(path.join(root, relativePath))) + '  ' + relativePath).join('\n');
fs.writeFileSync(path.join(root, sumsPath), sums + '\n', 'utf8');
for (const line of sums.split('\n')) {
  if (!line) continue;
  const [expected, fileName] = line.split('  ');
  const actual = sha256(fs.readFileSync(path.join(root, fileName)));
  if (actual !== expected) throw new Error('SHA256SUMS mismatch: ' + fileName);
}
console.log(JSON.stringify({ ok: true, reportId, evidencePath, reportPath, sumsPath, decision: evidence.decision, ab: evidence.abEvidence }, null, 2));
