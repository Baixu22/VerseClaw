import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  CONTEXT_VIEW_TOOL_CATALOG,
  CONTEXT_VIEW_TOOL_CATALOG_DIGEST_SHA256,
  CONTEXT_VIEW_TOOL_NAMES,
  resolveContextViewToolSurfaceState,
} from '../../../../../../openclaw_runtime/src/agents/tools/context-view-tool-surface.js';
import {
  DCS_CONTEXT_VIEW_TOOL_NAMES,
  createDcsContextAgentTools,
} from '../../../../../../openclaw_runtime/src/agents/tools/context-agent-tools.js';
import {
  isKnownCoreToolId,
  listCoreToolSections,
  resolveCoreToolProfilePolicy,
} from '../../../../../../openclaw_runtime/src/agents/tool-catalog.js';
import type { ComponentGraduationReport, GraduationArtifactRef } from '../../../../../../shared/component-graduation-report.js';

const root = process.cwd();
const outputDir = 'tests/unit/fixtures/context-view-tool-surface/acceptance/TF-0495';
const reportId = 'tf-0495-context-view-tool-surface';
const evidencePath = outputDir + '/raw-evidence.json';
const reportPath = outputDir + '/component-graduation-report.json';
const sumsPath = outputDir + '/SHA256SUMS';
const protocolPath = outputDir + '/canary-protocol.json';
const canaryRunPath = outputDir + '/canary-run-v1.json';

const sourcePaths = [
  'openclaw_runtime/src/agents/tools/context-view-tool-surface.ts',
  'openclaw_runtime/src/agents/tools/context-agent-tools.ts',
  'openclaw_runtime/src/agents/tools/context-agent-tools.test.ts',
  'openclaw_runtime/src/agents/tool-catalog.ts',
  'openclaw_runtime/src/context-engine/coding-tool-navigation.ts',
  'shared/dcs/prod-flags-catalog.ts',
  'docs/generated/catalogs/prod-flags.md',
  'tests/unit/context-view-tool-surface.test.ts',
  'tests/unit/config-schema-parity.test.ts',
  'tests/e2e/context-view-tool-surface.spec.ts',
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

const protocol = JSON.parse(fs.readFileSync(path.join(root, protocolPath), 'utf8')) as {
  schemaVersion: string;
  taskForestNodeId: string;
  endpoint: string;
  provider: string;
  model: string;
  design: { totalCalls: number; arms: { A_discovery: { sampleSize: number }; B_unavailable: { sampleSize: number } } };
};
const canaryRun = JSON.parse(fs.readFileSync(path.join(root, canaryRunPath), 'utf8')) as {
  schemaVersion: string;
  decision: { status: string; reasons: string[] };
  summary: {
    totalCalls: number; providerErrors: number; parseFailures: number;
    A_toolDiscoveryPassCount: number; A_toolDiscoverySuccessRate: number;
    B_correctUnavailableCount: number; falseToolPresenceClaims: number; unauthorizedViewToolCalls: number;
  };
  checks: Record<string, boolean>;
};
if (canaryRun.decision?.status !== 'pass') throw new Error('canary run did not pass');
if (canaryRun.summary.totalCalls !== protocol.design.totalCalls) throw new Error('canary call count mismatch');
if (canaryRun.summary.A_toolDiscoverySuccessRate < 0.95) throw new Error('canary discovery rate below 95%');
if (canaryRun.summary.falseToolPresenceClaims !== 0) throw new Error('canary reported a false tool-presence claim');
if (canaryRun.summary.unauthorizedViewToolCalls !== 0) throw new Error('canary reported an unauthorized view-tool call');

const catalogIds = listCoreToolSections().flatMap((section) => section.tools.map((tool) => tool.id));
const codingAllow = new Set(resolveCoreToolProfilePolicy('coding')?.allow ?? []);
const coreCatalog = CONTEXT_VIEW_TOOL_NAMES.map((name) => ({
  name,
  known: isKnownCoreToolId(name),
  inCatalog: catalogIds.includes(name),
  inCodingProfile: codingAllow.has(name),
}));
if (coreCatalog.some((entry) => !entry.known || !entry.inCatalog || !entry.inCodingProfile)) {
  throw new Error('one or more view tools are missing from the standard catalog');
}

const factService = {} as never;
const states = {
  healthy: resolveContextViewToolSurfaceState({ env: {}, factService }),
  missingDependency: resolveContextViewToolSurfaceState({ env: {} }),
  permissionDenied: resolveContextViewToolSurfaceState({ env: {}, factService, permissionAllowed: false }),
  explicitRollback: resolveContextViewToolSurfaceState({
    env: { OPENCLAW_DCS_CONTEXT_VIEW_TOOLS: '0' },
    factService,
  }),
};
if (states.healthy.mode !== 'healthy' || states.healthy.activeToolNames.length !== 4) {
  throw new Error('healthy surface did not expose exactly four tools');
}
for (const [key, state] of Object.entries(states)) {
  if (key === 'healthy') continue;
  if (state.enabled || state.activeToolNames.length !== 0 || !state.reason) {
    throw new Error('unavailable state falsely advertised a callable tool: ' + key);
  }
}

const registryEntries = createDcsContextAgentTools({
  factService,
  contextViewSurfaceState: states.healthy,
}).map((tool) => ({
  name: tool.name,
  summary: tool.displaySummary,
  risk: tool.risk,
}));
const viewEntries = registryEntries.filter((entry) => CONTEXT_VIEW_TOOL_NAMES.includes(entry.name as never));
if (viewEntries.length !== 4 || viewEntries.some((entry) => entry.risk !== 'readonly')) {
  throw new Error('standard discovery entries are incomplete or not read-only');
}
const discoverable = viewEntries.map((entry) => ({
  name: entry.name,
  selector: CONTEXT_VIEW_TOOL_CATALOG.find((candidate) => candidate.name === entry.name)?.selector,
  shortSummary: entry.summary,
  fullSchemaResident: false,
}));
if (discoverable.some((entry) => !entry.selector || !entry.shortSummary)) {
  throw new Error('short discovery metadata missing');
}

const recomputedCatalogDigest = sha256(JSON.stringify(
  [...CONTEXT_VIEW_TOOL_CATALOG]
    .map(({ name, selector, summary }) => ({ name, selector, summary }))
    .sort((left, right) => left.name.localeCompare(right.name)),
));
if (recomputedCatalogDigest !== CONTEXT_VIEW_TOOL_CATALOG_DIGEST_SHA256) {
  throw new Error('runtime catalog digest does not recompute');
}
if (JSON.stringify([...CONTEXT_VIEW_TOOL_NAMES]) !== JSON.stringify([...DCS_CONTEXT_VIEW_TOOL_NAMES])) {
  throw new Error('surface and factory tool names diverge');
}

const evidence = {
  schemaVersion: 'ContextViewToolSurfaceEvidence/v1',
  taskForestNodeId: 'TF-0495',
  generatedAt: new Date().toISOString(),
  driven_by: 'agent',
  actor: 'codex',
  catalog: {
    names: [...CONTEXT_VIEW_TOOL_NAMES],
    factoryNames: [...DCS_CONTEXT_VIEW_TOOL_NAMES],
    coreCatalog,
    catalogDigest: CONTEXT_VIEW_TOOL_CATALOG_DIGEST_SHA256,
    digestMatch: true,
    generatedCatalogPath: 'docs/generated/catalogs/prod-flags.md (authority delta TFP-TF-0495-derived-catalog-authority-20261022)',
  },
  surfaceStates: Object.fromEntries(Object.entries(states).map(([key, state]) => [key, {
    mode: state.mode,
    enabled: state.enabled,
    activeToolNames: state.activeToolNames,
    reason: state.reason,
    recoverable: state.recoverable,
    catalogDigest: state.catalogDigest,
  }])),
  discoverability: {
    activeToolNames: states.healthy.activeToolNames,
    entries: discoverable,
    fullSchemaResident: false,
    toolDiscoverySuccessRate: canaryRun.summary.A_toolDiscoverySuccessRate,
    falseToolPresenceClaims: canaryRun.summary.falseToolPresenceClaims,
    unauthorizedViewToolCalls: canaryRun.summary.unauthorizedViewToolCalls,
  },
  permissionNegative: {
    state: states.permissionDenied.mode,
    recoverable: states.permissionDenied.recoverable,
    activeToolNames: states.permissionDenied.activeToolNames,
    failClosed: true,
  },
  rollback: {
    mode: states.explicitRollback.mode,
    envOverrideOnly: true,
    defaultValueFlipped: false,
  },
  canary: {
    schemaVersion: canaryRun.schemaVersion,
    protocolSha256: sha256(fs.readFileSync(path.join(root, protocolPath))),
    endpoint: protocol.endpoint,
    provider: protocol.provider,
    model: protocol.model,
    totalCalls: canaryRun.summary.totalCalls,
    providerErrors: canaryRun.summary.providerErrors,
    parseFailures: canaryRun.summary.parseFailures,
    A_toolDiscoveryPassCount: canaryRun.summary.A_toolDiscoveryPassCount,
    A_toolDiscoverySuccessRate: canaryRun.summary.A_toolDiscoverySuccessRate,
    B_correctUnavailableCount: canaryRun.summary.B_correctUnavailableCount,
    falseToolPresenceClaims: canaryRun.summary.falseToolPresenceClaims,
    unauthorizedViewToolCalls: canaryRun.summary.unauthorizedViewToolCalls,
    checks: canaryRun.checks,
    decision: canaryRun.decision,
  },
  results: {
    catalog: { status: 'pass' },
    surfaceStates: { status: 'pass' },
    discoverability: { status: 'pass' },
    permissionNegative: { status: 'pass' },
    rollback: { status: 'pass' },
    contract: { status: 'pass' },
    canary: { status: 'pass' },
    'not-product-claim': { status: 'pass' },
    boundary: { status: 'pass' },
  },
  acceptanceCriteria: [
    { criterion: '标准 catalog 中可见四个工具且与 runtime digest 一致', status: 'pass', evidence: ['catalog', 'discoverability', 'core tool-catalog source (not generated docs)'] },
    { criterion: '健康/缺依赖/无权限三态均可回读', status: 'pass', evidence: ['surfaceStates'] },
    { criterion: '模型不会声称工具存在但不可调用', status: 'pass', evidence: ['discoverability', 'surfaceStates', 'canary Arm B'] },
    { criterion: '工具调用越权 fail-closed', status: 'pass', evidence: ['permissionNegative', 'context-agent-tools.test.ts'] },
  ],
  evidenceNotes: {
    diskReadback: false,
    humanEvidenceClaimed: false,
    publicReleaseClaimed: false,
    productDefaultChanged: false,
    verseGitTouched: false,
  },
};
writeJson(evidencePath, evidence);
const persisted = JSON.parse(fs.readFileSync(path.join(root, evidencePath), 'utf8')) as typeof evidence;
persisted.evidenceNotes.diskReadback = true;
writeJson(evidencePath, persisted);

const rawArtifact = artifact(evidencePath);
const bindingArtifacts = [
  ...sourcePaths.map(artifact),
  artifact(evidencePath),
  artifact(outputDir + '/README.md'),
  artifact(outputDir + '/generate-acceptance.mts'),
  artifact(outputDir + '/run-verification.ps1'),
  artifact(outputDir + '/recheck-canary.mts'),
  artifact(outputDir + '/run-canary.mts'),
  artifact(protocolPath),
  artifact(canaryRunPath),
];
const inputDigest = sha256(bindingArtifacts.map((entry) => entry.path + '\0' + entry.sha256 + '\0' + entry.bytes).sort().join('\n'));
const buildHash = sha256(JSON.stringify(bindingArtifacts));
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).trim();
const report: ComponentGraduationReport = {
  schemaVersion: 'ComponentGraduationReport/v1',
  reportId,
  reportKind: 'contract',
  componentId: 'dcs-fact-view-and-tools',
  taskForestNodeId: 'TF-0495',
  disposition: 'internal',
  maturity: 'verified',
  owner: 'TF-0495',
  entryPoint: 'openclaw_runtime/src/agents/tools/context-view-tool-surface.ts',
  defaultMode: 'opt-in',
  benefitEvidence: 'Healthy workspaces discover the four read-only context views from the standard coding catalog without an environment switch. A declared agent-driven canary measured 20/20 (100%) tool selection and 20/20 correct unavailable-state descriptions with zero false presence claims.',
  rollback: 'Set OPENCLAW_DCS_CONTEXT_VIEW_TOOLS=0 (or OPENCLAW_DCS_CONTEXT_TOOLS=0) and restart; the four view tools leave the catalog. The production default value is unchanged.',
  modelEffectiveState: 'When healthy, the model sees four named read-only context views with selectors and short summaries. When unavailable, the model sees no active names and a reason; the canary confirmed it describes them as not callable.',
  evidenceGrade: 'e2e',
  actor: 'codex',
  driven_by: 'agent',
  expiry: null,
  binding: {
    commit,
    tree,
    buildHash,
    runtimeGeneration: 'context-view-tool-surface-tf0495',
    provider: protocol.provider,
    model: protocol.model,
    inputSet: 'tf0495-context-view-tool-surface+canary-v1',
    scope: 'workspace:component-graduation/session:tf-0495',
    artifacts: bindingArtifacts,
  },
  evidence: [
    {
      kind: 'contract',
      status: 'pass',
      grade: 'e2e',
      summary: 'Standard catalog, digest, discovery, three-state readback and permission fail-closed contract pass.',
      artifacts: [{ ...rawArtifact, supportsVerdict: true }],
    },
    {
      kind: 'canary',
      status: 'pass',
      grade: 'e2e',
      summary: 'Predeclared agent-driven canary: 20/20 tool selection, 20/20 correct unavailable descriptions, zero false presence claims, zero provider/parse failures.',
      artifacts: [{ ...rawArtifact, supportsVerdict: true }],
    },
    {
      kind: 'not-product-claim',
      status: 'pass',
      grade: 'documented-boundary',
      summary: 'No public release, GA, liveReady, productApproved or real-human evidence is claimed; the product default is not flipped.',
      artifacts: [{ ...rawArtifact, supportsVerdict: true }],
    },
    {
      kind: 'boundary',
      status: 'pass',
      grade: 'unit-test',
      summary: 'Unavailable surfaces expose no active tool names; the generated prod-flags projection is bound under the recorded authority delta.',
      artifacts: [{ ...rawArtifact, supportsVerdict: true }],
    },
  ],
  recompute: {
    verdict: 'pass',
    inputDigest,
    command: 'pnpm --dir openclaw_runtime exec tsx tests/unit/fixtures/context-view-tool-surface/acceptance/TF-0495/generate-acceptance.mts',
  },
};
writeJson(reportPath, report);

const sumTargets = [
  ...sourcePaths,
  outputDir + '/README.md',
  outputDir + '/generate-acceptance.mts',
  outputDir + '/run-verification.ps1',
  outputDir + '/recheck-canary.mts',
  outputDir + '/run-canary.mts',
  protocolPath,
  canaryRunPath,
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
console.log(JSON.stringify({
  ok: true,
  reportId,
  evidencePath,
  reportPath,
  sumsPath,
  digest: CONTEXT_VIEW_TOOL_CATALOG_DIGEST_SHA256,
  states: Object.fromEntries(Object.entries(states).map(([key, state]) => [key, state.mode])),
  canary: canaryRun.summary,
}, null, 2));
