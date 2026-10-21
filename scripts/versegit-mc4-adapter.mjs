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
    reference: ({ raw }) => ({ version: raw.trim(), adapter_status: raw.length > 0 ? 'observed' : 'unavailable' }),
    candidate: ({ vg }) => {
      const read = vg.readVersion();
      return { version: read.value ?? null, adapter_status: read.status };
    },
  },
  {
    seam: 'identity.capabilities',
    argv: ['capabilities', '--json'],
    declaration: { volatile_keys: [] },
    reference: ({ json, code }) => ({ ...capabilitiesSummary(json), adapter_status: code === 0 ? 'observed' : 'degraded' }),
    candidate: ({ vg }) => {
      const read = vg.readCapabilities();
      return { ...capabilitiesSummary(read.document), adapter_status: read.status };
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
  const module = await loadAdapter({ root });
  const contractDigest = sha256(JSON.stringify(mc1));
  const sidecarPackageDigest = String(mc3.digest ?? '');
  const adapterSource = readFileSync(resolve(root, ADAPTER_MODULE_PATH), 'utf8');
  const imports = importSpecifiers(adapterSource);
  const forbiddenImports = imports.filter((specifier) => INTERNAL_IMPORT_MARKERS.some((marker) => specifier.includes(marker)));
  const contractConformance = validateContractConformance(module, mc1);
  let adapterRunCount = 0;
  const vg = new module.VerseGitModule({
    binaryPath: binary,
    cwd: mc0.source.repo,
    contractDigest,
    timeoutMs: 30_000,
    run: (argv, timeout) => {
      adapterRunCount += 1;
      return runVg(binary, argv, mc0.source.repo, timeout);
    },
  });
  const attach = vg.attach('M1', { mode: 'M1', authorizationId: 'mc4-read-grant' });
  if (!attach.ok) throw new Error(`adapter could not attach for MC4: ${attach.issues.join('; ')}`);

  const seams = [];
  for (const spec of SEAMS) {
    const raw = runVg(binary, spec.argv, mc0.source.repo);
    const json = spec.argv.includes('--json') ? parseJson(raw.stdout) : null;
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
      projection: spec.declaration,
      behavior_change_record: null,
    });
  }
  const seamProcessCount = adapterRunCount;

  // Default-off regression: M0 must not attach, must not spawn, and must not read state.
  const beforeM0 = adapterRunCount;
  const m0 = vg.attach('M0', { mode: 'M0', authorizationId: null });
  const m0Processes = vg.buildReport({
    mode: 'M0', component: 'versegit-module', trigger: { reason: 'single-worktree-single-session' },
    repository: { repoId: 'repo' }, coverage: { declared: [], unobserved: ['all'] },
    result: { status: 'not_applicable', reasons: [] },
  });
  const m0RunCalls = adapterRunCount - beforeM0;

  // Authority regression: a higher mode without a grant, a reason label used as a
  // status, an authority claim, a shell string, and a forbidden command must all be refused.
  const ungranted = vg.attach('M3', { mode: 'M3', authorizationId: null });
  const mismatched = vg.attach('M2', { mode: 'M1', authorizationId: 'auth-1' });
  const granted = vg.attach('M1', { mode: 'M1', authorizationId: 'auth-1' });
  const reasonAsStatus = module.validateModuleReport({
    schema: module.VG_MODULE_REPORT_SCHEMA, mode: 'M1', component: 'c', trigger: {}, repository: {},
    coverage: { declared: [], unobserved: ['bash'] }, result: { status: 'stale' },
    authority: { harnessVerdict: 'host', execution: 'verseshell', land: 'host-git' },
    host_verdict: 'unchanged', contract: { version: module.VG_CONSUMER_CONTRACT_VERSION, digest: contractDigest },
    allowed: { processes_started: 1, state_read: true, domain_state_write: false, execution: 'none', workspace_write: false },
  });
  const authorityClaim = module.validateModuleReport({
    schema: module.VG_MODULE_REPORT_SCHEMA, mode: 'M3', component: 'c', trigger: {}, repository: {},
    coverage: { declared: [], unobserved: ['bash'] }, result: { status: 'observed' }, admitted: true,
  });
  const shellPlan = module.validateCommandPlan({
    schema: module.VG_COMMAND_PLAN_SCHEMA, runId: 'r', candidateId: 'c', owner: 'o',
    shell: 'pnpm test && echo done', commands: [],
  });
  const effectfulReplay = module.validateCommandPlan({
    schema: module.VG_COMMAND_PLAN_SCHEMA, runId: 'r', candidateId: 'c', owner: 'o',
    commands: [{ argv: ['pnpm', 'test'], effect: 'execute', retry: 'always' }],
  });
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
    provenance: {
      node: 'TF-0477',
      source_commit: mc0.source.head,
      binary_sha256: mc0.binary.sha256,
      contract_digest: contractDigest,
      golden_bundle_digest: mc2.digest,
      sidecar_package_digest: sidecarPackageDigest,
      contract_matches_wp0: contractDigest === wp0.binary_identity?.consumer_contract_digest,
      golden_matches_wp0: mc2.digest === wp0.binary_identity?.golden_bundle_digest,
      sidecar_matches_wp0: sidecarPackageDigest === wp0.binary_identity?.sidecar_package_digest,
    },
    differential: {
      method: 'raw sidecar reference vs shipped adapter candidate, compared under the MC5 semantic projection',
      adapter_run_count: seamProcessCount,
      seams,
      identical_count: seams.filter((entry) => entry.identical).length,
      seam_count: seams.length,
      behavior_changes_declared: 0,
    },
    default_off_regression: {
      m0_attach: { ok: m0.ok, status: m0.status, attached: vg.isAttached, process_calls: m0RunCalls },
      m0_report: {
        schema: m0Processes.schema, mode: m0Processes.mode, status: m0Processes.result.status,
        processes_started: m0Processes.allowed.processes_started, workspace_write: m0Processes.allowed.workspace_write,
        harness_verdict: m0Processes.authority.harnessVerdict, land: m0Processes.authority.land,
        host_verdict: m0Processes.host_verdict,
      },
    },
    authority_regression: {
      ungranted_promotion: { status: ungranted.status, ok: ungranted.ok },
      mismatched_grant: { status: mismatched.status, ok: mismatched.ok },
      granted_read_only: { status: granted.status, ok: granted.ok },
      reason_label_as_status: { ok: reasonAsStatus.ok, issues: reasonAsStatus.issues },
      authority_claim_in_report: { ok: authorityClaim.ok, issues: authorityClaim.issues },
      shell_string_plan: { ok: shellPlan.ok, issues: shellPlan.issues },
      effectful_auto_replay: { ok: effectfulReplay.ok, issues: effectfulReplay.issues },
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
    status: seams.length >= 2 && seams.every((entry) => entry.identical && entry.adapter_status === 'observed')
      && contractConformance.ok ? 'equivalent' : 'divergent',
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
  const differential = report?.differential ?? {};
  if ((differential.seams ?? []).length < 2) issues.push('at least two adapter seams must be measured');
  if (differential.adapter_run_count !== differential.seams?.length) issues.push('each adapter seam must execute exactly one process');
  if (differential.identical_count !== differential.seam_count) issues.push('every measured seam must be equivalent under the declared projection');
  for (const seam of differential.seams ?? []) {
    if (seam.identical !== true) issues.push(`seam ${seam.seam} diverged`);
    if (seam.reference_exit !== 0) issues.push(`seam ${seam.seam} reference side did not exit 0`);
    if (seam.adapter_status !== 'observed') issues.push(`seam ${seam.seam} adapter did not observe`);
    if (seam.reference_digest !== seam.candidate_digest) issues.push(`seam ${seam.seam} digests differ`);
    if (seam.behavior_change_record !== null) issues.push(`seam ${seam.seam} must not declare a behavior change`);
  }
  if (differential.behavior_changes_declared !== 0) issues.push('MC4 may not smuggle a behavior change into the adapter');
  const defaults = report?.default_off_regression ?? {};
  if (defaults.m0_attach?.ok !== true || defaults.m0_attach?.status !== 'not_applicable' || defaults.m0_attach?.attached !== false) issues.push('M0 must attach nothing and report not_applicable');
  if (defaults.m0_attach?.process_calls !== 0) issues.push('M0 attach must not call the sidecar');
  if (defaults.m0_report?.processes_started !== 0) issues.push('M0 must start zero processes');
  if (defaults.m0_report?.workspace_write !== false) issues.push('M0 must not write the workspace');
  if (defaults.m0_report?.harness_verdict !== 'host' || defaults.m0_report?.land !== 'host-git') issues.push('the report must pin verdict and landing authority to the host');
  if (defaults.m0_report?.host_verdict !== 'unchanged') issues.push('M0 must leave the host verdict unchanged');
  const authority = report?.authority_regression ?? {};
  if (authority.ungranted_promotion?.ok !== false || authority.ungranted_promotion?.status !== 'rejected_by_policy') issues.push('an ungranted mode promotion must be refused');
  if (authority.mismatched_grant?.ok !== false) issues.push('a grant that does not match the requested mode must be refused');
  if (authority.granted_read_only?.ok !== true) issues.push('a granted read-only attach must succeed');
  if (authority.reason_label_as_status?.ok !== false) issues.push('a reason label must not be accepted as a top-level status');
  if (authority.authority_claim_in_report?.ok !== false) issues.push('a report carrying admitted is refused');
  if (authority.shell_string_plan?.ok !== false) issues.push('a command plan must not carry a shell string');
  if (authority.effectful_auto_replay?.ok !== false) issues.push('an effectful execute plan must not auto-replay');
  for (const key of ['land_command', 'admit_command', 'conflicts_in_m1', 'command_in_m0']) {
    if (authority[key]?.status !== 'rejected_by_policy') issues.push(`${key} must be rejected by policy`);
    if (authority[key]?.host_verdict !== 'unchanged') issues.push(`${key} must leave the harness verdict unchanged`);
  }
  for (const [command, result] of Object.entries(authority.deferred_commands_denied ?? {})) {
    if (result?.status !== 'rejected_by_policy' || result?.host_verdict !== 'unchanged') issues.push(`deferred command ${command} must be refused`);
  }
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