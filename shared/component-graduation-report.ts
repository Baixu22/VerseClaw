import type { CapabilityClaimEvidenceLevel } from './capability-claims.js';
import {
  COMPONENT_AUTHORITY_DEFAULT_MODES,
  COMPONENT_AUTHORITY_MANIFEST,
  type ComponentAuthorityDefaultMode,
  type ComponentAuthorityManifest,
} from './component-authority-manifest.js';

export const COMPONENT_GRADUATION_REPORT_SCHEMA = 'ComponentGraduationReport/v1' as const;
export const COMPONENT_GRADUATION_PROFILE_SCHEMA = 'ComponentGraduationProfile/v1' as const;

export const GRADUATION_REPORT_KINDS = ['component', 'administrative', 'contract'] as const;
export const GRADUATION_DISPOSITIONS = ['default', 'advanced', 'internal', 'experiment', 'shadow', 'retired'] as const;
export const GRADUATION_MATURITY_STATES = ['verified', 'partial', 'candidate', 'blocked', 'retired'] as const;
export const GRADUATION_EVIDENCE_STATUSES = ['pass', 'fail', 'not-applicable'] as const;
export const GRADUATION_EVIDENCE_KINDS = [
  'production-call',
  'e2e',
  'effective-state',
  'permission-negative',
  'canary',
  'rollback',
  'benefit',
  'necessity',
  'real-consumer',
  'boundary',
  'failure-recovery',
  'not-product-claim',
  'caller-removal',
  'entrypoint-removal',
  'migration',
  'preservation-recovery',
  'expiry',
  'scope-observation',
  'kill-switch',
  'contract',
] as const;

export type GraduationReportKind = (typeof GRADUATION_REPORT_KINDS)[number];
export type GraduationDisposition = (typeof GRADUATION_DISPOSITIONS)[number];
export type GraduationMaturity = (typeof GRADUATION_MATURITY_STATES)[number];
export type GraduationEvidenceStatus = (typeof GRADUATION_EVIDENCE_STATUSES)[number];
export type GraduationEvidenceKind = (typeof GRADUATION_EVIDENCE_KINDS)[number];
export type GraduationEvidenceGrade = CapabilityClaimEvidenceLevel;

export type GraduationArtifactRef = {
  path: string;
  sha256: string;
  bytes: number;
};

export type GraduationEvidenceArtifact = GraduationArtifactRef & {
  supportsVerdict: boolean;
};

export type ComponentGraduationEvidence = {
  kind: GraduationEvidenceKind;
  status: GraduationEvidenceStatus;
  grade: GraduationEvidenceGrade;
  summary: string;
  artifacts: readonly GraduationEvidenceArtifact[];
};

export type ComponentGraduationBinding = {
  commit: string;
  tree: string;
  buildHash: string;
  runtimeGeneration: string;
  provider: string;
  model: string;
  inputSet: string;
  scope: string;
  artifacts: readonly GraduationArtifactRef[];
};

export type ComponentGraduationRecompute = {
  verdict: 'pass' | 'fail';
  inputDigest: string;
  command: string;
};

export type ComponentGraduationReport = {
  schemaVersion: typeof COMPONENT_GRADUATION_REPORT_SCHEMA;
  reportId: string;
  reportKind: GraduationReportKind;
  componentId: string;
  taskForestNodeId: string;
  disposition: GraduationDisposition;
  maturity: GraduationMaturity;
  owner: string;
  entryPoint: string;
  defaultMode: ComponentAuthorityDefaultMode;
  benefitEvidence: string;
  rollback: string;
  modelEffectiveState: string;
  evidenceGrade: GraduationEvidenceGrade;
  actor: string;
  driven_by: string;
  expiry: string | null;
  binding: ComponentGraduationBinding;
  evidence: readonly ComponentGraduationEvidence[];
  recompute: ComponentGraduationRecompute;
};

export type GraduationArtifactResolution = {
  status: 'match' | 'missing' | 'hash-mismatch' | 'unchecked';
  content?: string;
};

export type GraduationValidationExpectation = {
  scope?: string;
  actor?: string;
  provider?: string;
  model?: string;
  commit?: string;
  tree?: string;
  buildHash?: string;
  recomputeInputDigest?: string;
};

export type ComponentGraduationValidationContext = {
  manifest?: ComponentAuthorityManifest;
  artifactResolver?: (artifact: GraduationArtifactRef) => GraduationArtifactResolution;
  expected?: GraduationValidationExpectation;
  now?: string;
};

export type GraduationValidationIssue = {
  code: string;
  message: string;
  path?: string;
};

export type ComponentGraduationValidationResult = {
  ok: boolean;
  issues: GraduationValidationIssue[];
  requiredEvidence: string[];
  missingEvidence: string[];
  graduationPass: boolean;
  countsAsGraduated: boolean;
  recomputedVerdict: 'pass' | 'fail';
  defaultChangedAgainstAuthority: boolean;
  evidenceGradeDetected: GraduationEvidenceGrade | null;
};

export type GraduationTaskForestNode = {
  id: string;
  status: string;
  contextTags?: readonly string[];
};

export type TaskForestDoneGateResult = {
  ok: boolean;
  reason: string;
};

export type DefaultChangeGateResult = {
  ok: boolean;
  defaultChanged: boolean;
  reason: string;
};

export const GRADUATION_EVIDENCE_MATRIX: Readonly<Record<GraduationReportKind | GraduationDisposition, readonly (readonly GraduationEvidenceKind[])[]>> = {
  component: [],
  administrative: [['contract']],
  contract: [['contract']],
  default: [
    ['production-call'],
    ['e2e'],
    ['effective-state'],
    ['permission-negative'],
    ['canary'],
    ['rollback'],
    ['benefit', 'necessity'],
  ],
  advanced: [
    ['production-call'],
    ['e2e'],
    ['effective-state'],
    ['permission-negative'],
    ['canary'],
    ['rollback'],
    ['benefit', 'necessity'],
  ],
  internal: [
    ['real-consumer'],
    ['boundary'],
    ['necessity', 'benefit'],
    ['failure-recovery'],
    ['not-product-claim'],
  ],
  retired: [
    ['caller-removal'],
    ['entrypoint-removal'],
    ['migration'],
    ['preservation-recovery'],
  ],
  experiment: [
    ['expiry'],
    ['scope-observation'],
    ['kill-switch'],
  ],
  shadow: [
    ['expiry'],
    ['scope-observation'],
    ['kill-switch'],
  ],
};

const EVIDENCE_GRADE_RANK: Record<GraduationEvidenceGrade, number> = {
  source: 0,
  'documented-boundary': 0,
  'unit-test': 1,
  e2e: 2,
  'negative-runtime': 3,
  'real-runtime': 4,
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isHex64(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function issue(code: string, message: string, pathValue?: string): GraduationValidationIssue {
  return { code, message, ...(pathValue ? { path: pathValue } : {}) };
}

function requiredEvidenceFor(report: Pick<ComponentGraduationReport, 'reportKind' | 'disposition'>): string[] {
  const matrix = report.reportKind === 'component'
    ? GRADUATION_EVIDENCE_MATRIX[report.disposition]
    : GRADUATION_EVIDENCE_MATRIX[report.reportKind];
  return matrix.map((alternatives) => alternatives.join('|'));
}

function detectHighestEvidenceGrade(evidence: readonly ComponentGraduationEvidence[]): GraduationEvidenceGrade | null {
  let selected: GraduationEvidenceGrade | null = null;
  for (const item of evidence) {
    if (!selected || EVIDENCE_GRADE_RANK[item.grade] > EVIDENCE_GRADE_RANK[selected]) selected = item.grade;
  }
  return selected;
}

export function createComponentGraduationReportScaffold(input: {
  componentId: string;
  taskForestNodeId: string;
  owner: string;
  actor?: string;
}): ComponentGraduationReport {
  const member = COMPONENT_AUTHORITY_MANIFEST.components.find((entry) => entry.id === input.componentId);
  if (!member) throw new Error(`Unknown component for graduation report: ${input.componentId}`);
  return {
    schemaVersion: COMPONENT_GRADUATION_REPORT_SCHEMA,
    reportId: `${input.componentId}-graduation`,
    reportKind: 'component',
    componentId: member.id,
    taskForestNodeId: input.taskForestNodeId,
    disposition: 'internal',
    maturity: 'partial',
    owner: input.owner,
    entryPoint: member.sourceAnchors[0]?.path ?? member.runtimeAvailabilitySource,
    defaultMode: member.defaultMode,
    benefitEvidence: 'not-yet-verified',
    rollback: 'not-yet-verified',
    modelEffectiveState: 'not-yet-verified',
    evidenceGrade: 'source',
    actor: input.actor ?? 'codex',
    driven_by: 'agent',
    expiry: null,
    binding: {
      commit: 'not-yet-bound',
      tree: 'not-yet-bound',
      buildHash: 'not-yet-bound',
      runtimeGeneration: 'not-yet-bound',
      provider: 'not-yet-bound',
      model: 'not-yet-bound',
      inputSet: 'not-yet-bound',
      scope: 'not-yet-bound',
      artifacts: [],
    },
    evidence: [],
    recompute: { verdict: 'fail', inputDigest: '0'.repeat(64), command: 'not-yet-run' },
  };
}export function validateComponentGraduationReport(
  report: ComponentGraduationReport,
  context: ComponentGraduationValidationContext = {},
): ComponentGraduationValidationResult {
  const manifest = context.manifest ?? COMPONENT_AUTHORITY_MANIFEST;
  const issues: GraduationValidationIssue[] = [];
  const requiredEvidence = requiredEvidenceFor(report);
  const missingEvidence: string[] = [];
  const member = manifest.components.find((entry) => entry.id === report.componentId);
  const nowMs = context.now ? Date.parse(context.now) : Date.now();

  if (report.schemaVersion !== COMPONENT_GRADUATION_REPORT_SCHEMA) {
    issues.push(issue('schema_version', `Expected ${COMPONENT_GRADUATION_REPORT_SCHEMA}`, 'schemaVersion'));
  }
  for (const [field, value] of [
    ['reportId', report.reportId],
    ['componentId', report.componentId],
    ['taskForestNodeId', report.taskForestNodeId],
    ['owner', report.owner],
    ['entryPoint', report.entryPoint],
    ['benefitEvidence', report.benefitEvidence],
    ['rollback', report.rollback],
    ['modelEffectiveState', report.modelEffectiveState],
    ['actor', report.actor],
    ['driven_by', report.driven_by],
  ] as const) {
    if (!isNonEmptyString(value)) issues.push(issue('missing_field', `${field} must be a non-empty string`, field));
  }
  if (!GRADUATION_REPORT_KINDS.includes(report.reportKind)) issues.push(issue('invalid_report_kind', `Unknown report kind: ${report.reportKind}`, 'reportKind'));
  if (!GRADUATION_DISPOSITIONS.includes(report.disposition)) issues.push(issue('invalid_disposition', `Unknown disposition: ${report.disposition}`, 'disposition'));
  if (!GRADUATION_MATURITY_STATES.includes(report.maturity)) issues.push(issue('invalid_maturity', `Unknown maturity: ${report.maturity}`, 'maturity'));
  if (!COMPONENT_AUTHORITY_DEFAULT_MODES.includes(report.defaultMode)) issues.push(issue('invalid_default_mode', `Unknown default mode: ${report.defaultMode}`, 'defaultMode'));
  if (!Object.hasOwn(EVIDENCE_GRADE_RANK, report.evidenceGrade)) issues.push(issue('invalid_evidence_grade', `Unknown evidence grade: ${report.evidenceGrade}`, 'evidenceGrade'));
  if (!isNonEmptyString(report.actor) || report.driven_by !== 'agent' || /\bhuman\b|real-human/iu.test(`${report.actor} ${report.driven_by}`)) {
    issues.push(issue('agent_attribution_required', 'Agent evidence must use driven_by=agent and a concrete non-human actor', 'actor'));
  }
  if (report.reportKind === 'component' && !member) {
    issues.push(issue('unknown_component', `Component is not in the authority manifest: ${report.componentId}`, 'componentId'));
  }
  if (report.reportKind !== 'component' && report.disposition !== 'internal') {
    issues.push(issue('report_kind_disposition', 'Administrative and contract reports must use internal disposition', 'disposition'));
  }
  if (report.disposition === 'experiment' || report.disposition === 'shadow') {
    if (report.maturity === 'verified') {
      issues.push(issue('experiment_marked_verified', `${report.disposition} cannot count as graduated`, 'maturity'));
    }
    if (!isNonEmptyString(report.expiry) || Number.isNaN(Date.parse(report.expiry)) || Date.parse(report.expiry) <= nowMs) {
      issues.push(issue('expiry_required', `${report.disposition} requires a future expiry`, 'expiry'));
    }
  } else if (report.expiry !== null) {
    issues.push(issue('unexpected_expiry', `${report.disposition} reports do not use an expiry`, 'expiry'));
  }

  const binding = report.binding;
  for (const [field, value] of [
    ['commit', binding.commit], ['tree', binding.tree], ['buildHash', binding.buildHash], ['runtimeGeneration', binding.runtimeGeneration],
    ['provider', binding.provider], ['model', binding.model], ['inputSet', binding.inputSet], ['scope', binding.scope],
  ] as const) {
    if (!isNonEmptyString(value)) issues.push(issue('binding_missing_field', `binding.${field} must be a non-empty string`, `binding.${field}`));
  }
  if (binding.artifacts.length === 0) issues.push(issue('binding_artifacts_missing', 'binding.artifacts must include raw artifacts', 'binding.artifacts'));

  const bindingArtifacts = new Map<string, GraduationArtifactRef>();
  for (const [index, artifact] of binding.artifacts.entries()) {
    const artifactPath = `binding.artifacts[${index}]`;
    if (!isNonEmptyString(artifact.path) || artifact.path.startsWith('/') || artifact.path.includes('..')) {
      issues.push(issue('invalid_artifact_path', `Artifact path must be relative and stay inside root: ${artifact.path}`, artifactPath));
    }
    if (!isHex64(artifact.sha256)) issues.push(issue('invalid_artifact_hash', `Artifact hash must be 64 lowercase hex: ${artifact.path}`, artifactPath));
    if (!Number.isInteger(artifact.bytes) || artifact.bytes < 0) issues.push(issue('invalid_artifact_bytes', `Artifact bytes must be a non-negative integer: ${artifact.path}`, artifactPath));
    bindingArtifacts.set(artifact.path, artifact);
    if (!context.artifactResolver) {
      issues.push(issue('artifact_verification_unavailable', 'A filesystem/hash resolver is required to validate artifacts', artifactPath));
    } else {
      const resolution = context.artifactResolver(artifact);
      if (resolution.status === 'missing') issues.push(issue('artifact_missing', `Artifact does not exist: ${artifact.path}`, artifactPath));
      if (resolution.status === 'hash-mismatch') issues.push(issue('artifact_hash_mismatch', `Artifact hash does not match report: ${artifact.path}`, artifactPath));
      if (resolution.status === 'unchecked') issues.push(issue('artifact_unchecked', `Artifact could not be verified: ${artifact.path}`, artifactPath));
    }
  }

  const expect = context.expected;
  if (expect) {
    for (const field of ['scope', 'provider', 'model', 'commit', 'tree', 'buildHash'] as const) {
      const expectedValue = expect[field];
      if (expectedValue && binding[field] !== expectedValue) {
        issues.push(issue(`${field}_mismatch`, `binding.${field} does not match current execution: ${binding[field]} != ${expectedValue}`, `binding.${field}`));
      }
    }
    if (expect.actor && report.actor !== expect.actor) {
      issues.push(issue('actor_mismatch', `Report actor ${report.actor} does not match current actor ${expect.actor}`, 'actor'));
    }
  }

  if (report.evidence.length === 0) issues.push(issue('evidence_missing', 'At least one evidence item is required', 'evidence'));
  const evidenceByKind = new Map<GraduationEvidenceKind, ComponentGraduationEvidence[]>();
  const resolvedArtifacts = new Map<string, GraduationArtifactResolution["status"]>();
  for (const [index, evidence] of report.evidence.entries()) {
    const evidencePath = `evidence[${index}]`;
    if (!GRADUATION_EVIDENCE_KINDS.includes(evidence.kind)) issues.push(issue('invalid_evidence_kind', `Unknown evidence kind: ${evidence.kind}`, `${evidencePath}.kind`));
    if (!GRADUATION_EVIDENCE_STATUSES.includes(evidence.status)) issues.push(issue('invalid_evidence_status', `Unknown evidence status: ${evidence.status}`, `${evidencePath}.status`));
    if (!Object.hasOwn(EVIDENCE_GRADE_RANK, evidence.grade)) issues.push(issue('invalid_evidence_grade', `Unknown evidence grade: ${evidence.grade}`, `${evidencePath}.grade`));
    if (!isNonEmptyString(evidence.summary)) issues.push(issue('evidence_summary_missing', 'Evidence summary must be non-empty', `${evidencePath}.summary`));
    if (evidence.artifacts.length === 0) issues.push(issue('artifact_missing', `${evidence.kind} evidence has no artifact`, `${evidencePath}.artifacts`));
    const bucket = evidenceByKind.get(evidence.kind) ?? [];
    bucket.push(evidence);
    evidenceByKind.set(evidence.kind, bucket);
    for (const [artifactIndex, artifact] of evidence.artifacts.entries()) {
      const artifactPath = `${evidencePath}.artifacts[${artifactIndex}]`;
      if (!isNonEmptyString(artifact.path) || artifact.path.startsWith('/') || artifact.path.includes('..')) {
        issues.push(issue('invalid_artifact_path', `Artifact path must be relative and stay inside root: ${artifact.path}`, artifactPath));
      }
      if (!isHex64(artifact.sha256)) issues.push(issue('invalid_artifact_hash', `Artifact hash must be 64 lowercase hex: ${artifact.path}`, artifactPath));
      if (!Number.isInteger(artifact.bytes) || artifact.bytes < 0) issues.push(issue('invalid_artifact_bytes', `Artifact bytes must be a non-negative integer: ${artifact.path}`, artifactPath));
      if (evidence.status === 'pass' && artifact.supportsVerdict !== true) {
        issues.push(issue('artifact_does_not_support_verdict', `${evidence.kind} cannot pass from an artifact that does not support the conclusion`, artifactPath));
      }
      const bound = bindingArtifacts.get(artifact.path);
      if (!bound) {
        issues.push(issue('artifact_not_bound', `${artifact.path} is not listed in binding.artifacts`, artifactPath));
      } else if (bound.sha256 !== artifact.sha256 || bound.bytes !== artifact.bytes) {
        issues.push(issue('artifact_binding_mismatch', `${artifact.path} differs from binding.artifacts`, artifactPath));
      }
      if (!context.artifactResolver) {
        issues.push(issue('artifact_verification_unavailable', 'A filesystem/hash resolver is required to validate artifacts', artifactPath));
      } else {
        const resolution = context.artifactResolver(artifact);
        resolvedArtifacts.set(`${artifact.path}:${artifact.sha256}`, resolution.status);
        if (resolution.status === 'missing') issues.push(issue('artifact_missing', `Artifact does not exist: ${artifact.path}`, artifactPath));
        if (resolution.status === 'hash-mismatch') issues.push(issue('artifact_hash_mismatch', `Artifact hash does not match report: ${artifact.path}`, artifactPath));
        if (resolution.status === 'unchecked') issues.push(issue('artifact_unchecked', `Artifact could not be verified: ${artifact.path}`, artifactPath));
        if (resolution.status === 'match') {
          if (!resolution.content) {
            issues.push(issue('raw_result_unreadable', `Artifact content is unavailable for ${artifact.path}`, artifactPath));
          } else {
            try {
              const raw = JSON.parse(resolution.content) as { results?: Record<string, { status?: unknown }> };
              const rawStatus = raw.results?.[evidence.kind]?.status;
              if (rawStatus === undefined) {
                issues.push(issue('raw_result_missing', `Raw artifact has no result for ${evidence.kind}`, artifactPath));
              } else if (rawStatus !== evidence.status) {
                issues.push(issue('raw_result_mismatch', `Raw ${evidence.kind} status ${String(rawStatus)} does not match report status ${evidence.status}`, artifactPath));
              }
            } catch {
              issues.push(issue('raw_result_unreadable', `Artifact is not structured JSON: ${artifact.path}`, artifactPath));
            }
          }
        }
      }
    }
  }

  for (const alternatives of GRADUATION_EVIDENCE_MATRIX[report.reportKind === 'component' ? report.disposition : report.reportKind]) {
    const satisfied = alternatives.some((kind) => (evidenceByKind.get(kind) ?? []).some((item) => item.status === 'pass'));
    if (!satisfied) missingEvidence.push(alternatives.join('|'));
  }
  for (const missing of missingEvidence) {
    issues.push(issue('required_evidence_missing', `Required evidence is missing or failed: ${missing}`, 'evidence'));
  }

  const detectedEvidenceGrade = detectHighestEvidenceGrade(report.evidence);
  if (detectedEvidenceGrade && report.evidenceGrade !== detectedEvidenceGrade) {
    issues.push(issue('evidence_grade_mismatch', `Declared ${report.evidenceGrade} but strongest evidence is ${detectedEvidenceGrade}`, 'evidenceGrade'));
  }
  if (!isHex64(report.recompute.inputDigest)) {
    issues.push(issue('recompute_digest_invalid', 'recompute.inputDigest must be 64 lowercase hex', 'recompute.inputDigest'));
  }
  if (!isNonEmptyString(report.recompute.command)) issues.push(issue('recompute_command_missing', 'recompute.command must be non-empty', 'recompute.command'));
  if (expect?.recomputeInputDigest && report.recompute.inputDigest !== expect.recomputeInputDigest) {
    issues.push(issue('recompute_digest_mismatch', 'Recomputed artifact digest does not match the report binding', 'recompute.inputDigest'));
  }

  const recomputedVerdict = issues.length === 0 ? 'pass' : 'fail';
  if (report.recompute.verdict !== recomputedVerdict) {
    issues.push(issue('recompute_verdict_mismatch', `Report declares ${report.recompute.verdict}; recomputed verdict is ${recomputedVerdict}`, 'recompute.verdict'));
  }
  const experimentOrShadow = report.disposition === 'experiment' || report.disposition === 'shadow';
  const requiredEvidenceSatisfied = missingEvidence.length === 0;
  const graduationPass = issues.length === 0 && requiredEvidenceSatisfied && !experimentOrShadow && report.maturity === 'verified';
  const countsAsGraduated = report.reportKind === 'component' && graduationPass && report.disposition !== 'experiment' && report.disposition !== 'shadow';
  return {
    ok: issues.length === 0,
    issues,
    requiredEvidence,
    missingEvidence,
    graduationPass,
    countsAsGraduated,
    recomputedVerdict: issues.length === 0 && requiredEvidenceSatisfied ? 'pass' : 'fail',
    defaultChangedAgainstAuthority: Boolean(member && report.defaultMode !== member.defaultMode),
    evidenceGradeDetected: detectedEvidenceGrade,
  };
}export function createAllComponentGraduationReportScaffolds(input: {
  taskForestNodeIdFor?: (componentId: string) => string;
  ownerFor?: (componentId: string) => string;
  actor?: string;
} = {}): ComponentGraduationReport[] {
  return COMPONENT_AUTHORITY_MANIFEST.components.map((member) => createComponentGraduationReportScaffold({
    componentId: member.id,
    taskForestNodeId: input.taskForestNodeIdFor?.(member.id) ?? `component:${member.id}`,
    owner: input.ownerFor?.(member.id) ?? member.id,
    actor: input.actor ?? 'codex',
  }));
}

export function canonicalGraduationArtifactInput(report: ComponentGraduationReport): string {
  return report.binding.artifacts
    .map((artifact) => `${artifact.path}\0${artifact.sha256}\0${artifact.bytes}`)
    .sort()
    .join('\n');
}

export function evaluateTaskForestDoneGate(input: {
  node: GraduationTaskForestNode;
  report?: ComponentGraduationReport | null;
  validation?: ComponentGraduationValidationResult | null;
}): TaskForestDoneGateResult {
  if (input.node.status !== 'done') return { ok: true, reason: 'node is not done' };
  if (!input.report) return { ok: false, reason: 'done node has no ComponentGraduationReport/v1' };
  if (input.report.taskForestNodeId !== input.node.id) {
    return { ok: false, reason: `report targets ${input.report.taskForestNodeId}, not ${input.node.id}` };
  }
  if (!input.validation) return { ok: false, reason: 'report was not validated' };
  if (!input.validation.ok) return { ok: false, reason: `report has validation issues: ${input.validation.issues.map((entry) => entry.code).join(',')}` };
  if (input.report.disposition === 'experiment' || input.report.disposition === 'shadow') {
    return { ok: false, reason: 'experiment/shadow reports cannot close a Task Forest done node' };
  }
  if (!input.validation.graduationPass) return { ok: false, reason: 'report does not pass its disposition evidence matrix' };
  return { ok: true, reason: 'validated report passes' };
}

export function evaluateDefaultChangeGate(input: {
  currentDefaultMode: ComponentAuthorityDefaultMode;
  report: ComponentGraduationReport;
  validation: ComponentGraduationValidationResult;
}): DefaultChangeGateResult {
  const defaultChanged = input.report.defaultMode !== input.currentDefaultMode;
  if (!defaultChanged) return { ok: true, defaultChanged: false, reason: 'default mode is unchanged' };
  if (!['default', 'advanced'].includes(input.report.disposition)) {
    return { ok: false, defaultChanged: true, reason: 'only default/advanced disposition can request a default change' };
  }
  if (!input.validation.graduationPass) {
    return { ok: false, defaultChanged: true, reason: 'default change requires a report that passes its evidence matrix' };
  }
  const evidenceKinds = new Set(input.report.evidence.filter((entry) => entry.status === 'pass').map((entry) => entry.kind));
  for (const required of ['canary', 'rollback', 'effective-state', 'permission-negative'] as const) {
    if (!evidenceKinds.has(required)) return { ok: false, defaultChanged: true, reason: `default change missing ${required} evidence` };
  }
  if (!evidenceKinds.has('benefit') && !evidenceKinds.has('necessity')) {
    return { ok: false, defaultChanged: true, reason: 'default change missing benefit/necessity evidence' };
  }
  if (!input.report.rollback.trim() || !input.report.benefitEvidence.trim()) {
    return { ok: false, defaultChanged: true, reason: 'default change requires rollback and benefitEvidence fields' };
  }
  return { ok: true, defaultChanged: true, reason: 'report and evidence authorize the default change gate' };
}

export function evaluateComponentGraduationGate(input: {
  report: ComponentGraduationReport;
  context?: ComponentGraduationValidationContext;
  currentDefaultMode?: ComponentAuthorityDefaultMode;
  taskForestNode?: GraduationTaskForestNode;
}): {
  validation: ComponentGraduationValidationResult;
  defaultChange: DefaultChangeGateResult | null;
  taskForestDone: TaskForestDoneGateResult | null;
  ok: boolean;
} {
  const validation = validateComponentGraduationReport(input.report, input.context);
  const defaultChange = input.currentDefaultMode
    ? evaluateDefaultChangeGate({ currentDefaultMode: input.currentDefaultMode, report: input.report, validation })
    : null;
  const taskForestDone = input.taskForestNode
    ? evaluateTaskForestDoneGate({ node: input.taskForestNode, report: input.report, validation })
    : null;
  return {
    validation,
    defaultChange,
    taskForestDone,
    ok: validation.ok && (defaultChange?.ok ?? true) && (taskForestDone?.ok ?? true),
  };
}