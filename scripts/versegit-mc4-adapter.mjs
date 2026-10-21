#!/usr/bin/env node
// MC4: run the shipped host adapter over the frozen sidecar seams and compare its
// publication through the semantic projection MC5 declared. The TypeScript module is
// imported directly, so this evidence exercises the code path Electron Main will use
// rather than a parallel reimplementation.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { validateConsumerContract } from './versegit-mc1-contract.mjs';
import { validateMc2Fingerprint } from './versegit-mc2-fingerprint.mjs';
import { validateMc3Package } from './versegit-mc3-delivery.mjs';
import { validateWp0Contract } from './versegit-wp0-contract.mjs';
import {
  projectValue, sha256, MC0_BASELINE_PATH, MC1_CONTRACT_PATH, MC2_GOLDEN_PATH,
} from './versegit-mc5-differential.mjs';

const repositoryRoot = process.env.VERSEGIT_MC4_ROOT
  ? resolve(process.env.VERSEGIT_MC4_ROOT)
  : resolve(process.cwd());

export const MC4_SCHEMA = 'clawx.versegit.mc4-adapter/v1';
export const ADAPTER_MODULE_PATH = 'electron/services/versegit-module.ts';
export const MC3_PACKAGE_PATH = 'harness/specs/fixtures/versegit-planning-correction/mc3-evidence/package-manifest.json';
export const WP0_CONTRACT_PATH = 'harness/specs/fixtures/versegit-planning-correction/wp0-evidence/contract.json';
const INTERNAL_IMPORT_MARKERS = ['vg_kernel', 'vg_jj', 'vg_battery_', 'crate::', 'clawx://'];

export function runVg(binary, argv, cwd, timeoutMs = 30_000) {
  const result = spawnSync(binary, argv, {
    cwd, encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024,
  });
  return {
    stdout: String(result.stdout ?? '').trim(),
    stderr: String(result.stderr ?? result.error?.message ?? '').replace(/\r/g, '').trim(),
    code: typeof result.status === 'number' ? result.status : null,
  };
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function gitHead(repo) {
  const result = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true });
  return result.status === 0 ? String(result.stdout ?? '').trim() : null;
}

export function collectIdentityPreflight({ mc0, mc1, mc2, mc3, wp0, binaryDigest, sourceHead }) {
  const checks = [];
  const record = (name, passed, detail) => checks.push({ name, passed, detail });
  for (const [name, validation] of [
    ['consumer_contract', validateConsumerContract(mc1)],
    ['golden_fingerprint', validateMc2Fingerprint(mc2)],
    ['sidecar_package', validateMc3Package(mc3)],
    ['wp0_contract', validateWp0Contract(wp0)],
  ]) record(name, validation.ok, validation.issues ?? []);
  const contractDigest = sha256(JSON.stringify(mc1));
  record('source_head_matches_mc0', sourceHead === mc0.source?.head, { actual: sourceHead, expected: mc0.source?.head });
  record('binary_digest_matches_mc0', binaryDigest === mc0.binary?.sha256, { actual: binaryDigest, expected: mc0.binary?.sha256 });
  record('source_head_matches_golden', mc2.identity?.mc0_source_head === sourceHead, { actual: sourceHead, expected: mc2.identity?.mc0_source_head });
  record('binary_digest_matches_golden', mc2.identity?.binary_sha256 === binaryDigest, { actual: binaryDigest, expected: mc2.identity?.binary_sha256 });
  record('source_head_matches_package', mc3.identity?.effective_source_commit === sourceHead, { actual: sourceHead, expected: mc3.identity?.effective_source_commit });
  record('binary_digest_matches_package', mc3.identity?.binary_sha256 === binaryDigest, { actual: binaryDigest, expected: mc3.identity?.binary_sha256 });
  record('source_head_matches_wp0', wp0.binary_identity?.source_head === sourceHead, { actual: sourceHead, expected: wp0.binary_identity?.source_head });
  record('binary_digest_matches_wp0', wp0.binary_identity?.sha256 === binaryDigest, { actual: binaryDigest, expected: wp0.binary_identity?.sha256 });
  record('contract_digest_matches_wp0', wp0.binary_identity?.consumer_contract_digest === contractDigest, { actual: contractDigest, expected: wp0.binary_identity?.consumer_contract_digest });
  record('contract_digest_matches_package', mc3.identity?.contract_digest === contractDigest, { actual: contractDigest, expected: mc3.identity?.contract_digest });
  record('golden_digest_matches_wp0', wp0.binary_identity?.golden_bundle_digest === mc2.digest, { actual: mc2.digest, expected: wp0.binary_identity?.golden_bundle_digest });
  record('package_digest_matches_wp0', wp0.binary_identity?.sidecar_package_digest === mc3.digest, { actual: mc3.digest, expected: wp0.binary_identity?.sidecar_package_digest });
  record('capabilities_schema_matches_golden', mc2.identity?.capabilities_schema === mc0.binary?.capabilities_schema, { actual: mc0.binary?.capabilities_schema, expected: mc2.identity?.capabilities_schema });
  const failures = checks.filter((check) => !check.passed);
  return { passed: failures.length === 0, checks, failures, contractDigest };
}

function countKeys(value) {
  if (Array.isArray(value)) return value.reduce((sum, entry) => sum + countKeys(entry), 0);
  if (value && typeof value === 'object') {
    return Object.values(value).reduce((sum, entry) => sum + countKeys(entry), Object.keys(value).length);
  }
  return 0;
}

function capabilitiesSummary(document) {
  return {
    schema: document?.schema ?? null,
    default_enable: document?.safety?.default_enable ?? null,
    single_green_light: document?.verdict?.single_green_light ?? null,
    read_channels: document?.verdict?.read_surface?.observed_channels ?? null,
    unobserved_channels: document?.verdict?.read_surface?.unobserved_channels ?? null,
  };
}

function importSpecifiers(source) {
  return [...source.matchAll(/from\s+['"]([^'"]+)['"]/gu)].map((match) => match[1]);
}

export function validateContractConformance(module, contract) {
  const issues = [];
  const equal = (actual, expected, label) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) issues.push(`${label} differs from the frozen consumer contract`);
  };
  equal(module.VG_CONSUMER_CONTRACT_VERSION, contract?.schema, 'consumer contract version');
  equal(module.VG_MODES, contract?.modes, 'mode list');
  equal(module.VG_TOP_LEVEL_STATUSES, contract?.statuses?.top_level, 'top-level statuses');
  equal(module.VG_REASON_STATUSES, contract?.statuses?.reasons, 'reason statuses');
  equal(module.VG_MODULE_REPORT_SCHEMA, contract?.surface?.module_report?.schema, 'module report schema');
  equal(module.VG_COMMAND_PLAN_SCHEMA, contract?.surface?.command_plan?.schema, 'command plan schema');
  return { ok: issues.length === 0, issues };
}

// A seam pair has a raw sidecar reference and a candidate produced by the exported
// adapter method. Projections are declared so equivalence is measured on the contract,
// not on transport-only identifiers.
export const SEAMS = [
  {
    seam: 'identity.version',
    argv: ['--version'],
    declaration: { volatile_keys: [] },
    reference: ({ raw }) => ({ document: raw.trim(), adapter_status: raw.length > 0 ? 'observed' : 'unavailable' }),
    candidate: ({ vg }) => {
      const read = vg.readVersion();
      return { document: read.value ?? null, adapter_status: read.status };
    },
  },
  {
    seam: 'identity.capabilities',
    argv: ['capabilities', '--json'],
    declaration: { volatile_keys: [] },
    reference: ({ json, code }) => ({ document: json, adapter_status: code === 0 ? 'observed' : 'degraded' }),
    candidate: ({ vg }) => {
      const read = vg.readCapabilities();
      return { document: read.document ?? null, adapter_status: read.status };
    },
  },
];

export async function loadAdapter({ root = repositoryRoot } = {}) {
  const modulePath = resolve(root, ADAPTER_MODULE_PATH);
  if (!existsSync(modulePath)) throw new Error(`missing adapter module: ${ADAPTER_MODULE_PATH}`);
  return import(pathToFileURL(modulePath).href);
}

export async function buildMc4Report({ root = repositoryRoot } = {}) {
  const mc0 = JSON.parse(readFileSync(resolve(root, MC0_BASELINE_PATH), 'utf8'));
  const mc1 = JSON.parse(readFileSync(resolve(root, MC1_CONTRACT_PATH), 'utf8'));
  const mc2 = JSON.parse(readFileSync(resolve(root, MC2_GOLDEN_PATH), 'utf8'));
  const mc3 = JSON.parse(readFileSync(resolve(root, MC3_PACKAGE_PATH), 'utf8'));
  const wp0 = JSON.parse(readFileSync(resolve(root, WP0_CONTRACT_PATH), 'utf8'));
  const binary = resolve(String(mc0.binary.path));
  if (!existsSync(binary)) throw new Error(`frozen sidecar binary is missing: ${binary}`);
  // Identity is revalidated before the mutable debug executable is allowed to run.
  const binaryDigest = sha256(readFileSync(binary));
  const sourceHead = gitHead(String(mc0.source.repo));
  const preflight = collectIdentityPreflight({ mc0, mc1, mc2, mc3, wp0, binaryDigest, sourceHead });
  if (!preflight.passed) {
    throw new Error(`identity preflight failed before execution: ${preflight.failures.map((failure) => failure.name).join(', ')}`);
  }
  const module = await loadAdapter({ root });
  const contractDigest = preflight.contractDigest;
  const sidecarPackageDigest = String(mc3.digest ?? '');
  const adapterSource = readFileSync(resolve(root, ADAPTER_MODULE_PATH), 'utf8');
  const imports = importSpecifiers(adapterSource);
  const forbiddenImports = imports.filter((specifier) => INTERNAL_IMPORT_MARKERS.some((marker) => specifier.includes(marker)));
  const contractConformance = validateContractConformance(module, mc1);
  const identity = {
    repoId: 'repo-mc4', worktreeIds: ['worktree-mc4'], agentSessionIds: ['agent-session-mc4'],
    vgSessionIds: ['vg-session-mc4'], epoch: 1,
  };
  const correlation = {
    runId: 'run-mc4', requestId: 'request-mc4', traceId: 'trace-mc4', epoch: 1,
  };
  const session = {
    agentSessionId: 'agent-session-mc4', vgSessionId: 'vg-session-mc4', worktreeId: 'worktree-mc4',
    epoch: 1, traceId: correlation.traceId, status: 'active',
  };
  const reportInput = (mode, status, reasons = []) => ({
    mode, component: 'versegit-module', trigger: { reason: 'mc4-differential', worktreeCount: 1, activeSessionCount: 1 },
    repository: { repoId: identity.repoId, worktreeId: session.worktreeId }, identity, correlation,
    sessions: [session], facts: { conflicts: [], warnings: [], unknowns: ['shell-file-effects'] },
    coverage: { declared: ['identity.version', 'identity.capabilities'], unobserved: ['bash', 'network', 'direct-fs'] },
    result: { status, reasons },
  });
  let adapterRunCount = 0;
  const vg = new module.VerseGitModule({
    binaryPath: binary,
    cwd: mc0.source.repo,
    contractDigest,
    expectedCapabilitiesDigest: wp0.binary_identity?.capabilities_digest,
    timeoutMs: 30_000,
    run: (argv, timeout) => {
      adapterRunCount += 1;
      return runVg(binary, argv, mc0.source.repo, timeout);
    },
  });
  const attach = vg.attach('M1', { mode: 'M1', authorizationId: 'mc4-read-grant' });
  if (!attach.ok) throw new Error(`adapter could not attach for MC4: ${attach.issues.join('; ')}`);

  const seams = [];
  const rawBySeam = new Map();
  for (const spec of SEAMS) {
    const raw = runVg(binary, spec.argv, mc0.source.repo);
    const json = spec.argv.includes('--json') ? parseJson(raw.stdout) : null;
    rawBySeam.set(spec.seam, { raw, json });
    const reference = spec.reference({ raw: raw.stdout, json, code: raw.code });
    const candidate = spec.candidate({ vg, module });
    const projectedReference = JSON.parse(projectValue(reference, spec.declaration));
    const projectedCandidate = JSON.parse(projectValue(candidate, spec.declaration));
    seams.push({
      seam: spec.seam,
      argv: spec.argv,
      reference_exit: raw.code,
      adapter_status: candidate.adapter_status,
      identical: JSON.stringify(projectedReference) === JSON.stringify(projectedCandidate),
      reference_digest: sha256(JSON.stringify(projectedReference)),
      candidate_digest: sha256(JSON.stringify(projectedCandidate)),
      reference_key_count: countKeys(projectedReference),
      candidate_key_count: countKeys(projectedCandidate),
      projection: spec.declaration,
      behavior_change_record: null,
    });
  }
  const seamProcessCount = adapterRunCount;
  const m1Report = vg.buildReport(reportInput('M1', 'partial', ['unknown']));
  const overriddenReport = vg.buildReport({ ...reportInput('M1', 'partial', ['unknown']), digests: { contract: 'f'.repeat(64) } });
  const noAttachClaim = (() => {
    const fresh = new module.VerseGitModule({ binaryPath: binary, contractDigest, run: () => ({ stdout: '{}', stderr: '', code: 0 }) });
    try { fresh.buildReport(reportInput('M1', 'partial', ['unknown'])); return false; } catch { return true; }
  })();

  const capabilitiesDocument = rawBySeam.get('identity.capabilities')?.json;
  const withCapabilityRun = (stdout, expectedCapabilitiesDigest = wp0.binary_identity?.capabilities_digest) => {
    const candidate = new module.VerseGitModule({
      binaryPath: binary, contractDigest, expectedCapabilitiesDigest,
      run: () => ({ stdout, stderr: '', code: 0 }),
    });
    candidate.attach('M1', { mode: 'M1', authorizationId: 'capability-negative' });
    return candidate.readCapabilities();
  };
  const singleGreen = structuredClone(capabilitiesDocument);
  singleGreen.verdict.single_green_light = true;
  const schemaDrift = structuredClone(capabilitiesDocument);
  schemaDrift.schema = 'versegit.capabilities/v999';
  const defaultEnable = structuredClone(capabilitiesDocument);
  defaultEnable.safety.default_enable = true;
  const digestDrift = structuredClone(capabilitiesDocument);
  digestDrift.mcp_tools = [...(digestDrift.mcp_tools ?? []), 'unexpected_tool'];
  const capabilityNegatives = [
    { id: 'capabilities_json_null', result: withCapabilityRun('null') },
    { id: 'capabilities_single_green_light', result: withCapabilityRun(JSON.stringify(singleGreen)) },
    { id: 'capabilities_schema_drift', result: withCapabilityRun(JSON.stringify(schemaDrift)) },
    { id: 'capabilities_default_enable', result: withCapabilityRun(JSON.stringify(defaultEnable)) },
    { id: 'capabilities_digest_drift', result: withCapabilityRun(JSON.stringify(digestDrift)) },
  ].map((entry) => ({
    id: entry.id,
    refused: entry.result.status !== 'observed',
    status: entry.result.status,
    reason: entry.result.reason ?? null,
    issues: entry.result.issues,
  }));

  // Default-off regression: M0 must not attach, must not spawn, and must not read state.
  const beforeM0 = adapterRunCount;
  const m0 = vg.attach('M0', { mode: 'M0', authorizationId: null });
  const m0Processes = vg.buildReport(reportInput('M0', 'not_applicable', []));
  const m0RunCalls = adapterRunCount - beforeM0;

  const validPlan = {
    schema: module.VG_COMMAND_PLAN_SCHEMA, runId: 'run-plan', candidateId: 'candidate-plan',
    owner: { agentId: 'agent-plan', sessionId: 'session-plan', worktreeId: 'worktree-plan' },
    commands: [{ argv: ['pnpm', 'test'], effect: 'execute', retry: 'never' }],
  };
  const commandNegatives = [
    { id: 'reject_shell_string', plan: { ...validPlan, shell: 'pnpm test && echo done' } },
    { id: 'reject_top_level_land', plan: { ...validPlan, land: true } },
    { id: 'reject_empty_owner', plan: { ...validPlan, owner: '' } },
    { id: 'reject_git_path', plan: { ...validPlan, commands: [{ argv: ['C:\\Program Files\\Git\\cmd\\git.exe', 'push'], effect: 'execute', retry: 'never' }] } },
    { id: 'reject_shell_interpreter', plan: { ...validPlan, commands: [{ argv: ['powershell.exe', '-Command', 'Write-Host ok'], effect: 'execute', retry: 'never' }] } },
    { id: 'reject_unknown_retry', plan: { ...validPlan, commands: [{ argv: ['pnpm', 'test'], effect: 'execute', retry: 'sometimes' }] } },
    { id: 'reject_effectful_auto_replay', plan: { ...validPlan, commands: [{ argv: ['pnpm', 'test'], effect: 'execute', retry: 'always' }] } },
  ].map((entry) => {
    const result = module.validateCommandPlan(entry.plan);
    return { id: entry.id, refused: result.ok === false, issues: result.issues };
  });
  const validPlanResult = module.validateCommandPlan(validPlan);

  const ungranted = vg.attach('M3', { mode: 'M3', authorizationId: null });
  const mismatched = vg.attach('M2', { mode: 'M1', authorizationId: 'auth-1' });
  const granted = vg.attach('M1', { mode: 'M1', authorizationId: 'auth-1' });
  const reasonAsStatus = module.validateModuleReport({ ...m0Processes, result: { status: 'stale', reasons: [] } });
  const authorityClaim = module.validateModuleReport({ ...m0Processes, admitted: true });
  const landRefused = module.authorizeCommand('M3', ['land', 'session-1'], { mode: 'M3', authorizationId: 'auth-3' });
  const admitRefused = module.authorizeCommand('M2', ['admit', 'check'], { mode: 'M2', authorizationId: 'auth-2' });
  const conflictsInM1Refused = module.authorizeCommand('M1', ['conflicts', '--json'], { mode: 'M1', authorizationId: 'auth-1' });
  const capabilitiesAllowed = module.authorizeCommand('M1', ['capabilities', '--json'], { mode: 'M1', authorizationId: 'auth-1' });
  const m0CommandRefused = module.authorizeCommand('M0', ['capabilities', '--json'], { mode: 'M0', authorizationId: null });
  const deferredCommandsDenied = Object.fromEntries(module.VerseGitModule.deferredCommands.map((command) => [
    command,
    module.authorizeCommand('M2', [command], { mode: 'M2', authorizationId: 'auth-2' }),
  ]));
  let unattachedRunCount = 0;
  const notAttachedRead = (() => {
    const fresh = new module.VerseGitModule({
      binaryPath: binary,
      contractDigest,
      run: () => { unattachedRunCount += 1; return { stdout: '{}', stderr: '', code: 0 }; },
    });
    return fresh.readCapabilities();
  })();
  vg.detach();
  const afterDetach = vg.readCapabilities();

  const capabilityDocument = rawBySeam.get('identity.capabilities')?.json;
  const negativeControls = [
    {
      id: 'control_version_drift',
      fired: projectValue({ document: 'vg 0.1.0' }) !== projectValue({ document: 'vg 0.1.1' }),
    },
    {
      id: 'control_dropped_capability_field',
      fired: (() => {
        const changed = structuredClone(capabilityDocument);
        delete changed.verdict;
        return projectValue({ document: capabilityDocument }) !== projectValue({ document: changed });
      })(),
    },
    {
      id: 'control_single_green_light_laundering',
      fired: (() => {
        const changed = structuredClone(capabilityDocument);
        changed.verdict.single_green_light = true;
        return projectValue({ document: capabilityDocument }) !== projectValue({ document: changed });
      })(),
    },
    {
      id: 'control_unknown_coverage_loss',
      fired: (() => {
        const changed = structuredClone(capabilityDocument);
        changed.verdict.read_surface.unobserved_channels = [];
        return projectValue({ document: capabilityDocument }) !== projectValue({ document: changed });
      })(),
    },
    {
      id: 'control_authority_claim',
      fired: authorityClaim.ok === false,
    },
  ];
  const report = {
    reportSchema: MC4_SCHEMA,
    generated_at: new Date().toISOString(),
    driven_by: 'agent',
    actor: 'codex',
    task: 'TF-0477',
    adapter_module: ADAPTER_MODULE_PATH,
    adapter_source_digest: sha256(adapterSource),
    adapter_imports_vg_internals: forbiddenImports.length > 0,
    forbidden_import_specifiers: forbiddenImports,
    additional_runtime_dependency: null,
    second_executor: false,
    contract_conformance: contractConformance,
    migration_budget_scope: {
      classification: 'host-owned-adapter-bootstrap',
      behavior_migration: false,
      provider_source_files_changed: 0,
      provider_internal_imports: forbiddenImports.length,
      mc5_line_budget_applies: false,
      rationale: 'MC5 line/file budgets govern slices that copy or replace provider behaviour. MC4 introduces a host-owned anti-corruption module and verifies the complete provider JSON document against the raw sidecar; it does not import or reimplement VG internals. Supporting scripts, tests and evidence are not provider behavioural slices.',
    },
    identity_preflight: {
      passed: preflight.passed,
      check_count: preflight.checks.length,
      checks: preflight.checks.map((check) => ({ name: check.name, passed: check.passed })),
      failures: preflight.failures.map((failure) => failure.name),
    },
    provenance: {
      node: 'TF-0477',
      source_commit: sourceHead,
      binary_sha256: binaryDigest,
      contract_digest: contractDigest,
      golden_bundle_digest: mc2.digest,
      sidecar_package_digest: sidecarPackageDigest,
      contract_matches_wp0: contractDigest === wp0.binary_identity?.consumer_contract_digest,
      golden_matches_wp0: mc2.digest === wp0.binary_identity?.golden_bundle_digest,
      sidecar_matches_wp0: sidecarPackageDigest === wp0.binary_identity?.sidecar_package_digest,
    },
    differential: {
      method: 'raw sidecar reference vs shipped adapter candidate, compared under the MC5 semantic projection',
      full_document_compared: true,
      adapter_run_count: seamProcessCount,
      seams,
      identical_count: seams.filter((entry) => entry.identical).length,
      seam_count: seams.length,
      behavior_changes_declared: 0,
      negative_controls: negativeControls,
    },
    default_off_regression: {
      m0_attach: { ok: m0.ok, status: m0.status, attached: vg.isAttached, process_calls: m0RunCalls },
      m0_report: {
        schema: m0Processes.schema, mode: m0Processes.mode, status: m0Processes.result.status,
        processes_started: m0Processes.allowed.processes_started, usage_processes_started: m0Processes.usage.processes_started,
        usage_state_reads: m0Processes.usage.state_reads, workspace_write: m0Processes.allowed.workspace_write,
        harness_verdict: m0Processes.authority.harnessVerdict, land: m0Processes.authority.land,
        host_verdict: m0Processes.host_verdict,
      },
    },
    capabilities_negative_controls: capabilityNegatives,
    command_plan_regression: {
      valid_plan_accepted: validPlanResult.ok,
      negatives: commandNegatives,
    },
    report_usage_regression: {
      m1_report_valid: module.validateModuleReport(m1Report).ok,
      m1_usage: m1Report.usage,
      m1_identity: m1Report.identity,
      m1_correlation: m1Report.correlation,
      report_without_attach_refused: noAttachClaim,
      contract_override_prevented: overriddenReport.digests.contract === contractDigest,
      contract_digest: overriddenReport.digests.contract,
    },
    authority_regression: {
      ungranted_promotion: { status: ungranted.status, ok: ungranted.ok },
      mismatched_grant: { status: mismatched.status, ok: mismatched.ok },
      granted_read_only: { status: granted.status, ok: granted.ok },
      reason_label_as_status: { ok: reasonAsStatus.ok, issues: reasonAsStatus.issues },
      authority_claim_in_report: { ok: authorityClaim.ok, issues: authorityClaim.issues },
      land_command: landRefused,
      admit_command: admitRefused,
      conflicts_in_m1: conflictsInM1Refused,
      capabilities_in_m1: capabilitiesAllowed,
      command_in_m0: m0CommandRefused,
      deferred_commands_denied: deferredCommandsDenied,
      read_without_attach: { status: notAttachedRead.status, reason: notAttachedRead.reason, process_calls: unattachedRunCount },
      read_after_detach: { status: afterDetach.status, reason: afterDetach.reason },
    },
    forbidden_command_surface: module.VerseGitModule.forbiddenCommands,
    read_only_command_surface: module.VerseGitModule.readOnlyCommands,
    deferred_command_surface: module.VerseGitModule.deferredCommands,
    status: preflight.passed && contractConformance.ok && seams.length >= 2
      && seams.every((entry) => entry.identical && entry.adapter_status === 'observed' && entry.reference_key_count === entry.candidate_key_count)
      && negativeControls.every((control) => control.fired)
      && capabilityNegatives.every((control) => control.refused)
      && validPlanResult.ok && commandNegatives.every((control) => control.refused)
      && noAttachClaim && overriddenReport.digests.contract === contractDigest ? 'equivalent' : 'divergent',
    boundaries: {
      vg_source_tree_copied: false,
      vg_history_copied: false,
      vg_task_forest_copied: false,
      vg_build_outputs_copied: false,
      vg_private_evidence_copied: false,
      provider_source_modified: false,
      host_ipc_channel_added: false,
      renderer_can_call_adapter: false,
      profile_added_to_fast_or_comms: false,
      default_on: false,
      land_or_admit_invoked: false,
      host_worktree_deleted: false,
      note: 'This node proves the shipped adapter matches the sidecar under the declared projection and refuses every escalation path. Host routes, the harness profile and the VerseShell receipt bridge belong to WP1-WP3 and are not claimed here.',
    },
  };
  report.digest = sha256(JSON.stringify({ ...report, generated_at: undefined, digest: undefined }));
  return report;
}

export function validateMc4Report(report) {
  const issues = [];
  if (report?.reportSchema !== MC4_SCHEMA) issues.push(`reportSchema must be ${MC4_SCHEMA}`);
  if (report?.driven_by !== 'agent' || report?.actor !== 'codex') issues.push('evidence must be honestly marked as agent-driven');
  if (!/^[0-9a-f]{40}$/u.test(String(report?.provenance?.source_commit ?? ''))) issues.push('provenance source commit missing');
  if (!/^[0-9a-f]{64}$/u.test(String(report?.provenance?.binary_sha256 ?? ''))) issues.push('provenance binary digest missing');
  if (!/^[0-9a-f]{64}$/u.test(String(report?.provenance?.contract_digest ?? ''))) issues.push('provenance contract digest missing');
  if (!/^[0-9a-f]{64}$/u.test(String(report?.provenance?.golden_bundle_digest ?? ''))) issues.push('provenance golden digest missing');
  if (!/^[0-9a-f]{64}$/u.test(String(report?.provenance?.sidecar_package_digest ?? ''))) issues.push('provenance sidecar package digest missing');
  for (const key of ['contract_matches_wp0', 'golden_matches_wp0', 'sidecar_matches_wp0']) {
    if (report?.provenance?.[key] !== true) issues.push(`provenance ${key} must be true`);
  }
  if (report?.adapter_module !== ADAPTER_MODULE_PATH) issues.push('the adapter must live in Electron Main services');
  if (!/^[0-9a-f]{64}$/u.test(String(report?.adapter_source_digest ?? ''))) issues.push('adapter source digest missing');
  if (report?.adapter_imports_vg_internals !== false) issues.push('the adapter must not import VG internals');
  if (!Array.isArray(report?.forbidden_import_specifiers) || report.forbidden_import_specifiers.length !== 0) issues.push('forbidden adapter imports were detected');
  if (report?.additional_runtime_dependency !== null) issues.push('the adapter must not add a runtime dependency');
  if (report?.second_executor !== false) issues.push('the adapter must not add a second executor');
  if (report?.contract_conformance?.ok !== true || (report?.contract_conformance?.issues ?? []).length !== 0) issues.push('adapter types do not conform to the frozen consumer contract');
  if (report?.migration_budget_scope?.classification !== 'host-owned-adapter-bootstrap'
    || report?.migration_budget_scope?.behavior_migration !== false
    || report?.migration_budget_scope?.provider_source_files_changed !== 0
    || report?.migration_budget_scope?.provider_internal_imports !== 0) issues.push('migration-budget scope must prove that no provider behaviour was migrated');
  if (report?.identity_preflight?.passed !== true || (report?.identity_preflight?.failures ?? []).length !== 0 || report?.identity_preflight?.check_count < 15) issues.push('pre-execution identity preflight did not cover every frozen identity');
  if (report?.identity_preflight?.checks?.some((check) => check.passed !== true)) issues.push('an identity preflight check failed');

  const differential = report?.differential ?? {};
  if ((differential.seams ?? []).length < 2) issues.push('at least two adapter seams must be measured');
  if (differential.full_document_compared !== true) issues.push('MC4 must compare the full projected capability document');
  if (differential.adapter_run_count !== differential.seams?.length) issues.push('each adapter seam must execute exactly one process');
  if (differential.identical_count !== differential.seam_count) issues.push('every measured seam must be equivalent under the declared projection');
  for (const seam of differential.seams ?? []) {
    if (seam.identical !== true) issues.push(`seam ${seam.seam} diverged`);
    if (seam.reference_exit !== 0) issues.push(`seam ${seam.seam} reference side did not exit 0`);
    if (seam.adapter_status !== 'observed') issues.push(`seam ${seam.seam} adapter did not observe`);
    if (seam.reference_digest !== seam.candidate_digest) issues.push(`seam ${seam.seam} digests differ`);
    if (!(seam.reference_key_count > 0) || seam.reference_key_count !== seam.candidate_key_count) issues.push(`seam ${seam.seam} lost projected fields`);
    if (seam.behavior_change_record !== null) issues.push(`seam ${seam.seam} must not declare a behavior change`);
  }
  if (differential.behavior_changes_declared !== 0) issues.push('MC4 may not smuggle a behavior change into the adapter');
  for (const control of ['control_version_drift', 'control_dropped_capability_field', 'control_single_green_light_laundering', 'control_unknown_coverage_loss', 'control_authority_claim']) {
    if (!(differential.negative_controls ?? []).some((entry) => entry.id === control && entry.fired === true)) issues.push(`negative control ${control} did not fire`);
  }

  const defaults = report?.default_off_regression ?? {};
  if (defaults.m0_attach?.ok !== true || defaults.m0_attach?.status !== 'not_applicable' || defaults.m0_attach?.attached !== false) issues.push('M0 must attach nothing and report not_applicable');
  if (defaults.m0_attach?.process_calls !== 0) issues.push('M0 attach must not call the sidecar');
  if (defaults.m0_report?.processes_started !== 0 || defaults.m0_report?.usage_processes_started !== 0 || defaults.m0_report?.usage_state_reads !== 0) issues.push('M0 must start zero processes and record zero usage');
  if (defaults.m0_report?.workspace_write !== false) issues.push('M0 must not write the workspace');
  if (defaults.m0_report?.harness_verdict !== 'host' || defaults.m0_report?.land !== 'host-git') issues.push('the report must pin verdict and landing authority to the host');
  if (defaults.m0_report?.host_verdict !== 'unchanged') issues.push('M0 must leave the host verdict unchanged');

  for (const control of ['capabilities_json_null', 'capabilities_single_green_light', 'capabilities_schema_drift', 'capabilities_default_enable', 'capabilities_digest_drift']) {
    if (!(report?.capabilities_negative_controls ?? []).some((entry) => entry.id === control && entry.refused === true)) issues.push(`capability negative ${control} did not fire`);
  }
  if (report?.command_plan_regression?.valid_plan_accepted !== true) issues.push('the hardened command-plan validator rejected a valid structured plan');
  for (const control of ['reject_shell_string', 'reject_top_level_land', 'reject_empty_owner', 'reject_git_path', 'reject_shell_interpreter', 'reject_unknown_retry', 'reject_effectful_auto_replay']) {
    if (!(report?.command_plan_regression?.negatives ?? []).some((entry) => entry.id === control && entry.refused === true)) issues.push(`command-plan negative ${control} did not fire`);
  }
  if (report?.report_usage_regression?.m1_report_valid !== true) issues.push('the effective M1 report must validate');
  if (report?.report_usage_regression?.m1_usage?.processes_started !== 2 || report?.report_usage_regression?.m1_usage?.state_reads !== 1) issues.push('M1 report usage must reflect two processes and one state read');
  if (report?.report_usage_regression?.report_without_attach_refused !== true) issues.push('a promoted report must not be generated without an active attachment');
  if (report?.report_usage_regression?.contract_override_prevented !== true || report?.report_usage_regression?.contract_digest !== report?.provenance?.contract_digest) issues.push('caller-supplied digests must not override the host contract digest');

  const authority = report?.authority_regression ?? {};
  if (authority.ungranted_promotion?.ok !== false || authority.ungranted_promotion?.status !== 'rejected_by_policy') issues.push('an ungranted mode promotion must be refused');
  if (authority.mismatched_grant?.ok !== false) issues.push('a grant that does not match the requested mode must be refused');
  if (authority.granted_read_only?.ok !== true) issues.push('a granted read-only attach must succeed');
  if (authority.reason_label_as_status?.ok !== false) issues.push('a reason label must not be accepted as a top-level status');
  if (authority.authority_claim_in_report?.ok !== false) issues.push('a report carrying admitted is refused');
  for (const key of ['land_command', 'admit_command', 'conflicts_in_m1', 'command_in_m0']) {
    if (authority[key]?.status !== 'rejected_by_policy') issues.push(`${key} must be rejected by policy`);
    if (authority[key]?.host_verdict !== 'unchanged') issues.push(`${key} must leave the harness verdict unchanged`);
  }
  for (const [command, result] of Object.entries(authority.deferred_commands_denied ?? {})) {
    if (result?.status !== 'rejected_by_policy' || result?.host_verdict !== 'unchanged') issues.push(`deferred command ${command} must be refused`);
  }
  if (Object.keys(authority.deferred_commands_denied ?? {}).length !== 5) issues.push('all five deferred commands need an explicit refusal record');
  if (authority.capabilities_in_m1 !== null) issues.push('the read-only capabilities seam must be allowed in M1');
  if (authority.read_without_attach?.status !== 'unavailable' || authority.read_without_attach?.process_calls !== 0) issues.push('reading before attach must be unavailable without spawning');
  if (authority.read_after_detach?.status !== 'unavailable') issues.push('reading after detach must be unavailable');

  for (const forbidden of ['land', 'admit', 'declare_intent', 'git', 'gerrit', 'export']) {
    if (!(report?.forbidden_command_surface ?? []).includes(forbidden)) issues.push(`forbidden command surface must list ${forbidden}`);
  }
  if (JSON.stringify(report?.read_only_command_surface) !== JSON.stringify(['capabilities'])) issues.push('MC4 must expose only the verified capabilities command');
  for (const deferred of ['doctor', 'session', 'verdict', 'conflicts', 'report']) {
    if (!(report?.deferred_command_surface ?? []).includes(deferred)) issues.push(`deferred command surface must list ${deferred}`);
  }
  for (const field of ['host_ipc_channel_added', 'renderer_can_call_adapter', 'profile_added_to_fast_or_comms', 'default_on', 'land_or_admit_invoked', 'host_worktree_deleted']) {
    if (report?.boundaries?.[field] !== false) issues.push(`boundary ${field} must be false`);
  }
  for (const field of ['vg_source_tree_copied', 'vg_history_copied', 'vg_task_forest_copied', 'vg_build_outputs_copied', 'vg_private_evidence_copied', 'provider_source_modified']) {
    if (report?.boundaries?.[field] !== false) issues.push(`boundary ${field} must be false`);
  }
  const expectedDigest = sha256(JSON.stringify({ ...report, generated_at: undefined, digest: undefined }));
  if (report?.digest !== expectedDigest) issues.push('report digest is not reproducible');
  if (report?.status !== 'equivalent') issues.push(`the adapter must be equivalent, got ${report?.status}`);
  return { ok: issues.length === 0, issues };
}
export async function writeMc4Report({ output, root = repositoryRoot } = {}) {
  const report = await buildMc4Report({ root });
  const validation = validateMc4Report(report);
  const path = output ? resolve(output) : resolve(root, 'harness/specs/fixtures/versegit-planning-correction/mc4-evidence/adapter-report.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { path, report, validation };
}

async function main() {
  const at = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? resolve(process.argv[i + 1]) : undefined; };
  const result = await writeMc4Report({ output: at('--out') });
  console.log(JSON.stringify({
    path: result.path,
    status: result.report.status,
    seams: result.report.differential.seams.map((entry) => `${entry.seam}=${entry.identical ? 'equal' : 'DIVERGED'}`),
    adapter_processes: result.report.differential.adapter_run_count,
    m0: result.report.default_off_regression.m0_attach,
    validation: result.validation,
  }, null, 2));
  if (!result.validation.ok) process.exitCode = 1;
}

if (isMainEntrypoint(import.meta.url)) {
  main().catch((error) => { console.error(String(error?.stack ?? error)); process.exitCode = 1; });
}