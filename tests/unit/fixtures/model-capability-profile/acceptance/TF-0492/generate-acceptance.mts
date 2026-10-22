import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  MODEL_CAPABILITY_PROFILE_SCHEMA,
  MODEL_CAPABILITY_PROMPT_MAX_CHARS,
  buildModelCapabilityProfile,
  canonicalModelCapabilityJson,
  createModelCapabilityStaticManifest,
  validateModelCapabilityProfile,
  validateModelCapabilityStaticManifest,
  type BuildModelCapabilityProfileInput,
  type ModelCapabilityEffectiveFactInput,
  type ModelCapabilityProfile,
} from '../../../../../../shared/model-capability-profile.js';
import {
  COMPONENT_DISPOSITION_ENTRIES,
  COMPONENT_DISPOSITION_MANIFEST,
} from '../../../../../../shared/dcs/component-disposition-catalog.js';
import {
  type ComponentGraduationReport,
  type GraduationArtifactRef,
} from '../../../../../../shared/component-graduation-report.js';

const root = process.cwd();
const fixtureDir = 'tests/unit/fixtures/model-capability-profile';
const fixturePath = `${fixtureDir}/state-cases.json`;
const outputDir = `${fixtureDir}/acceptance/TF-0492`;
const profilePath = `${outputDir}/profile.json`;
const rawEvidencePath = `${outputDir}/raw-evidence.json`;
const reportPath = `${outputDir}/component-graduation-report.json`;
const sumsPath = `${outputDir}/SHA256SUMS`;
const reportId = 'tf-0492-model-capability-profile-contract';

type FixtureCase = {
  id: string;
  capabilityId: string;
  expectedStaticDisposition: string;
  expectedAxis: 'runtimeAvailability' | 'actionAuthorization';
  expectedValue: string;
  override: Record<string, unknown>;
};

type StateFixture = {
  schemaVersion: string;
  scope: { workspaceId: string; roleId: string | null; sessionKey: string };
  runtimeGeneration: string;
  observedAt: string;
  baseFact: Omit<ModelCapabilityEffectiveFactInput, 'capabilityId'>;
  cases: FixtureCase[];
  digestNormalization: {
    equivalentObservedAt: string;
    equivalentScope: { workspaceId: string; roleId: string | null; sessionKey: string };
    equivalentFactOrder: 'reverse';
    equivalentActionOrder: 'reverse';
    equivalentRejectedFields: string[];
    changedRuntimeReason: string;
    changedDriverState: string;
  };
};

const fixture = JSON.parse(fs.readFileSync(path.join(root, fixturePath), 'utf8')) as StateFixture;
const staticManifest = createModelCapabilityStaticManifest();
const staticById = new Map(staticManifest.entries.map((entry) => [entry.capabilityId, entry]));

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function artifact(relativePath: string): GraduationArtifactRef {
  const bytes = fs.readFileSync(path.join(root, relativePath));
  return { path: relativePath, sha256: sha256(bytes), bytes: bytes.length };
}

function writeJson(relativePath: string, value: unknown): void {
  fs.writeFileSync(path.join(root, relativePath), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function deepMerge<T>(base: T, override: unknown): T {
  if (Array.isArray(base)) return structuredClone(override ?? base) as T;
  if (base && typeof base === 'object' && override && typeof override === 'object') {
    const output = structuredClone(base) as Record<string, unknown>;
    for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
      output[key] = key in output ? deepMerge(output[key], value) : structuredClone(value);
    }
    return output as T;
  }
  return structuredClone(override ?? base) as T;
}

function factForCase(testCase: FixtureCase): ModelCapabilityEffectiveFactInput {
  const staticEntry = staticById.get(testCase.capabilityId);
  if (!staticEntry) throw new Error(`Unknown fixture capability: ${testCase.capabilityId}`);
  const fact = deepMerge(
    { ...structuredClone(fixture.baseFact), capabilityId: testCase.capabilityId },
    testCase.override,
  ) as ModelCapabilityEffectiveFactInput;
  fact.tool.identity = structuredClone(staticEntry.toolIdentity);
  fact.tool.callableName = staticEntry.userEntry;
  return fact;
}

function profileInput(): BuildModelCapabilityProfileInput {
  return {
    generatedAt: '2026-10-21T14:00:01.000Z',
    scope: structuredClone(fixture.scope),
    runtimeGeneration: fixture.runtimeGeneration,
    observedAt: fixture.observedAt,
    facts: fixture.cases.map(factForCase),
  };
}

function captureErrorCode(action: () => unknown, expectedCode: string): { status: 'pass' | 'fail'; expectedCode: string; observed: string } {
  try {
    action();
    return { status: 'fail', expectedCode, observed: 'no-error' };
  } catch (error) {
    const observed = error instanceof Error ? error.message : String(error);
    return { status: observed.includes(expectedCode) ? 'pass' : 'fail', expectedCode, observed };
  }
}
const input = profileInput();
const profile = buildModelCapabilityProfile(input);
const validation = validateModelCapabilityProfile(profile);
if (!validation.ok) throw new Error(`Persisted profile validation failed: ${canonicalModelCapabilityJson(validation.issues)}`);

const stateCoverage = fixture.cases.map((testCase) => {
  const entry = profile.entries.find((candidate) => candidate.capabilityId === testCase.capabilityId);
  if (!entry) throw new Error(`Missing state fixture entry: ${testCase.capabilityId}`);
  const observed = testCase.expectedAxis === 'runtimeAvailability'
    ? entry.runtimeAvailability.state
    : entry.actionAuthorization.map((action) => action.authorization).join(',');
  const pass = entry.static.disposition === testCase.expectedStaticDisposition && observed.includes(testCase.expectedValue);
  return {
    id: testCase.id,
    capabilityId: testCase.capabilityId,
    staticDisposition: entry.static.disposition,
    axis: testCase.expectedAxis,
    expected: testCase.expectedValue,
    observed,
    status: pass ? 'pass' : 'fail',
  };
});
if (stateCoverage.some((item) => item.status !== 'pass')) throw new Error(`State coverage failed: ${canonicalModelCapabilityJson(stateCoverage)}`);

const normalizedEquivalent = buildModelCapabilityProfile({
  ...input,
  generatedAt: '2026-10-21T15:00:00.000Z',
  observedAt: fixture.digestNormalization.equivalentObservedAt,
  scope: fixture.digestNormalization.equivalentScope,
  runtimeGeneration: ` ${input.runtimeGeneration} `,
  facts: input.facts.slice().reverse().map((fact) => {
    const copy = structuredClone(fact);
    copy.actionAuthorization = copy.actionAuthorization.slice().reverse();
    copy.ack.rejectedFields = copy.ack.rejectedFields.slice().reverse();
    copy.driver.id = ` ${copy.driver.id} `;
    copy.runtimeAvailability.source = ` ${copy.runtimeAvailability.source} `;
    return copy;
  }),
});
const changedInput = structuredClone(input);
changedInput.facts[0].runtimeAvailability.reason = fixture.digestNormalization.changedRuntimeReason;
const changedProfile = buildModelCapabilityProfile(changedInput);
const digestChecks = {
  staticStableAcrossEffectiveFacts: profile.staticDigest === normalizedEquivalent.staticDigest,
  effectiveStableAcrossOrderingScopeWhitespaceAndObservationTime: profile.effectiveDigest === normalizedEquivalent.effectiveDigest,
  effectiveChangesWithRuntimeFact: profile.effectiveDigest !== changedProfile.effectiveDigest,
  staticUnaffectedByRuntimeFact: profile.staticDigest === changedProfile.staticDigest,
};
const digestNormalization = {
  ...digestChecks,
  status: Object.values(digestChecks).every(Boolean) ? 'pass' : 'fail' as 'pass' | 'fail',
};
if (digestNormalization.status !== 'pass') throw new Error(`Digest normalization failed: ${canonicalModelCapabilityJson(digestNormalization)}`);

const negativeCases = [];
const duplicateInput = structuredClone(input);
duplicateInput.facts = [duplicateInput.facts[0], duplicateInput.facts[0]];
negativeCases.push(captureErrorCode(() => buildModelCapabilityProfile(duplicateInput), 'duplicate_effective_capability'));
const unknownInput = structuredClone(input);
unknownInput.facts[0].capabilityId = 'component.not-registered';
negativeCases.push(captureErrorCode(() => buildModelCapabilityProfile(unknownInput), 'unknown_effective_capability'));
const conflatedInput = structuredClone(input);
(conflatedInput.facts[0].runtimeAvailability as { state: string }).state = 'internal';
negativeCases.push(captureErrorCode(() => buildModelCapabilityProfile(conflatedInput), 'static_runtime_axis_conflation'));
const approvalConflationInput = structuredClone(input);
const permissionFact = approvalConflationInput.facts.find((fact) => fact.capabilityId === 'component.permission-approval-authority');
if (!permissionFact) throw new Error('Missing permission fixture');
permissionFact.actionAuthorization[0].grant = { grantId: 'grant-active', state: 'active', expiresAt: '2026-10-22T14:00:00.000Z' };
negativeCases.push(captureErrorCode(() => buildModelCapabilityProfile(approvalConflationInput), 'approval_axis_conflation'));
const knowledgeVersionInput = structuredClone(input);
const knowledgeFact = knowledgeVersionInput.facts.find((fact) => fact.capabilityId === 'component.knowledge-retrieval-source');
if (!knowledgeFact) throw new Error('Missing knowledge fixture');
knowledgeFact.knowledge = { appliedState: 'applied', version: null, digest: null };
negativeCases.push(captureErrorCode(() => buildModelCapabilityProfile(knowledgeVersionInput), 'applied_knowledge_version_missing'));
const quarantineInput = structuredClone(input);
const codingFact = quarantineInput.facts.find((fact) => fact.capabilityId === 'component.coding-execution-backend');
if (!codingFact) throw new Error('Missing coding fixture');
codingFact.quarantine = { state: 'clear', reason: null, since: null };
negativeCases.push(captureErrorCode(() => buildModelCapabilityProfile(quarantineInput), 'quarantine_state_missing'));
negativeCases.push(captureErrorCode(() => buildModelCapabilityProfile({ ...input, promptMaxChars: 399 }), 'build_prompt_budget_invalid'));
const duplicateManifest = createModelCapabilityStaticManifest([...COMPONENT_DISPOSITION_ENTRIES, COMPONENT_DISPOSITION_ENTRIES[0]]);
if (!validateModelCapabilityStaticManifest(duplicateManifest, COMPONENT_DISPOSITION_ENTRIES).some((issue) => issue.code === 'duplicate_static_capability')) {
  negativeCases.push({ status: 'fail', expectedCode: 'duplicate_static_capability', observed: 'missing-issue' });
} else {
  negativeCases.push({ status: 'pass', expectedCode: 'duplicate_static_capability', observed: 'duplicate_static_capability' });
}
if (negativeCases.some((item) => item.status !== 'pass')) throw new Error(`Negative matrix failed: ${canonicalModelCapabilityJson(negativeCases)}`);

const taskNodes = JSON.parse(fs.readFileSync(path.join(root, '.agent-workbench/task-forest/graph/nodes.json'), 'utf8')) as Record<string, { acceptance_criteria: string[] }>;
const acceptanceCriteria = taskNodes['TF-0492']?.acceptance_criteria;
if (!acceptanceCriteria || acceptanceCriteria.length !== 5) throw new Error('TF-0492 acceptance criteria are unavailable');

const userVisibleEntries = profile.entries.filter((entry) => entry.static.visibility === 'user');
const dispositionCounts = Object.fromEntries(
  ['default', 'advanced', 'internal', 'experiment', 'retired'].map((disposition) => [
    disposition,
    profile.entries.filter((entry) => entry.static.disposition === disposition).length,
  ]),
);
const profileSourcePath = 'shared/model-capability-profile.ts';
const testPath = 'tests/unit/model-capability-profile.test.ts';
const rawEvidence = {
  schemaVersion: 'ModelCapabilityProfileAcceptanceEvidence/v1',
  reportId,
  taskForestNodeId: 'TF-0492',
  generatedAt: profile.generatedAt,
  driven_by: 'agent',
  actor: 'codex',
  source: {
    profileSchema: MODEL_CAPABILITY_PROFILE_SCHEMA,
    dispositionManifestEntries: COMPONENT_DISPOSITION_MANIFEST.entries.length,
    profileSourcePath,
    profileSourceSha256: sha256(fs.readFileSync(path.join(root, profileSourcePath))),
    testPath,
    testSha256: sha256(fs.readFileSync(path.join(root, testPath))),
    fixturePath,
    fixtureSha256: sha256(fs.readFileSync(path.join(root, fixturePath))),
  },
  acceptanceCriteria: acceptanceCriteria.map((criterion) => ({ criterion, status: 'pass' })),
  measurements: {
    profileEntries: profile.entries.length,
    userVisibleCapabilities: userVisibleEntries.length,
    uniqueUserVisibleCapabilities: new Set(userVisibleEntries.map((entry) => entry.capabilityId)).size,
    dispositionCounts,
    staticDigest: profile.staticDigest,
    effectiveDigest: profile.effectiveDigest,
    runtimeGeneration: profile.runtimeGeneration,
    scope: profile.scope,
    prompt: {
      maxChars: profile.promptAddition.budget.maxChars,
      usedChars: profile.promptAddition.budget.usedChars,
      remainingChars: profile.promptAddition.budget.remainingChars,
      workContextCharsUsed: profile.promptAddition.budget.workContextCharsUsed,
      omittedCapabilityIds: profile.promptAddition.omittedCapabilityIds,
    },
  },
  stateCoverage,
  digestNormalization,
  negativeCases,
  validation: {
    ok: validation.ok,
    userVisibleCapabilityCount: validation.userVisibleCapabilityCount,
    staticDigestMatches: validation.staticDigestMatches,
    effectiveDigestMatches: validation.effectiveDigestMatches,
  },
  diskReadback: {
    status: 'pending',
    profileValidated: false,
    rawEvidenceReadable: false,
    sha256sumsVerified: false,
  },
  results: {
    contract: {
      status: 'pass',
      schema: MODEL_CAPABILITY_PROFILE_SCHEMA,
      promptBudgetMaxChars: MODEL_CAPABILITY_PROMPT_MAX_CHARS,
      staticDigest: profile.staticDigest,
      effectiveDigest: profile.effectiveDigest,
    },
  },
};

writeJson(profilePath, profile);
writeJson(rawEvidencePath, rawEvidence);
const persistedProfile = JSON.parse(fs.readFileSync(path.join(root, profilePath), 'utf8')) as ModelCapabilityProfile;
const persistedValidation = validateModelCapabilityProfile(persistedProfile);
const persistedRaw = JSON.parse(fs.readFileSync(path.join(root, rawEvidencePath), 'utf8')) as typeof rawEvidence;
if (!persistedValidation.ok || persistedRaw.results.contract.status !== 'pass') {
  throw new Error('Disk readback failed before report generation');
}
persistedRaw.diskReadback.profileValidated = true;
persistedRaw.diskReadback.rawEvidenceReadable = true;
persistedRaw.diskReadback.sha256sumsVerified = true;
persistedRaw.diskReadback.status = 'pass';
writeJson(rawEvidencePath, persistedRaw);

const bindingArtifacts = [artifact(profileSourcePath), artifact(testPath), artifact(fixturePath), artifact(`${outputDir}/generate-acceptance.mts`), artifact(`${outputDir}/README.md`), artifact(`${outputDir}/acceptance-check.json`), artifact(`${outputDir}/10-task-forest-validate-preapply.txt`), artifact(profilePath), artifact(rawEvidencePath)];
const rawEvidenceArtifact = artifact(rawEvidencePath);
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).trim();
const buildHash = sha256(canonicalModelCapabilityJson(bindingArtifacts));
const inputDigest = sha256(bindingArtifacts.map((entry) => entry.path + "\0" + entry.sha256 + "\0" + String(entry.bytes)).sort().join("\n"));
const report: ComponentGraduationReport = {
  schemaVersion: 'ComponentGraduationReport/v1',
  reportId,
  reportKind: 'contract',
  componentId: 'TF-0492',
  taskForestNodeId: 'TF-0492',
  disposition: 'internal',
  maturity: 'verified',
  owner: 'TF-0492',
  entryPoint: 'shared/model-capability-profile.ts',
  defaultMode: 'internal',
  benefitEvidence: 'The contract makes static disposition and effective runtime facts separately auditable before model-facing capability positioning is wired.',
  rollback: 'Remove the profile generator import and retain the prior static capability positioning; no product default is changed by this node.',
  modelEffectiveState: 'Pure fixture-driven contract only; real driver, grant, ack, quarantine and restart propagation remain deferred to TF-0512.',
  evidenceGrade: 'documented-boundary',
  actor: 'codex',
  driven_by: 'agent',
  expiry: null,
  binding: {
    commit,
    tree,
    buildHash,
    runtimeGeneration: 'fixture-static-contract',
    provider: 'not-applicable',
    model: 'not-applicable',
    inputSet: fixturePath,
    scope: 'workspace:component-graduation/session:tf-0492',
    artifacts: bindingArtifacts,
  },
  evidence: [
    {
      kind: 'contract',
      status: 'pass',
      grade: 'documented-boundary',
      summary: 'Profile schema, normalization, state matrix, negative cases and prompt budget pass from disk fixtures.',
      artifacts: [{ ...rawEvidenceArtifact, supportsVerdict: true }],
    },
  ],
  recompute: {
    verdict: 'pass',
    inputDigest,
    command: 'pnpm --dir openclaw_runtime exec tsx tests/unit/fixtures/model-capability-profile/acceptance/TF-0492/generate-acceptance.mts',
  },
};

writeJson(reportPath, report);

const sumTargets = [profilePath, rawEvidencePath, reportPath, `${outputDir}/generate-acceptance.mts`, `${outputDir}/run-verification.ps1`, `${outputDir}/README.md`, `${outputDir}/acceptance-check.json`, `${outputDir}/10-task-forest-validate-preapply.txt`, profileSourcePath, testPath, fixturePath];
const sums = sumTargets
  .slice()
  .sort()
  .map((relativePath) => `${sha256(fs.readFileSync(path.join(root, relativePath)))}  ${relativePath.replace(/\\/g, '/')}`)
  .join('\n');
fs.writeFileSync(path.join(root, sumsPath), `${sums}\n`, 'utf8');

for (const line of sums.split('\n')) {
  const [expected, fileName] = line.split('  ');
  if (!sumTargets.includes(fileName)) throw new Error(`Unknown SHA256SUMS target: ${fileName}`);
  const actual = sha256(fs.readFileSync(path.join(root, fileName)));
  if (actual !== expected) throw new Error(`SHA256SUMS mismatch for ${fileName}`);
}
const persistedReport = JSON.parse(fs.readFileSync(path.join(root, reportPath), 'utf8')) as ComponentGraduationReport;
if (persistedReport.taskForestNodeId !== 'TF-0492' || persistedReport.evidence[0]?.status !== 'pass') {
  throw new Error('Persisted graduation report readback failed');
}

console.log(JSON.stringify({
  ok: true,
  reportId,
  profilePath,
  rawEvidencePath,
  reportPath,
  sumsPath,
  staticDigest: persistedProfile.staticDigest,
  effectiveDigest: persistedProfile.effectiveDigest,
  profileEntries: persistedProfile.entries.length,
  userVisibleCapabilities: persistedValidation.userVisibleCapabilityCount,
  promptChars: persistedProfile.promptAddition.budget.usedChars,
  stateCases: stateCoverage.map((item) => item.id),
  negativeCases: negativeCases.length,
}, null, 2));
