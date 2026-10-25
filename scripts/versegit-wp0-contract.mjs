#!/usr/bin/env node
// WP0: fix the VerseGit module contract, binary identity and version matrix that the
// ClawX harness reads before it may attach the sidecar at all.
//
// This node resolves identity only. It never attaches a session, never writes user
// workspace or provider state, and runs no probe at all when the mode is disabled.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const repositoryRoot = process.env.VERSEGIT_WP0_ROOT
  ? resolve(process.env.VERSEGIT_WP0_ROOT)
  : resolve(process.cwd());

export const WP0_SCHEMA = 'clawx.versegit.wp0-contract/v1';
export const SUPPORTED_CONTRACT_VERSIONS = ['clawx.versegit.consumer-contract/v1'];
export const SUPPORTED_CAPABILITIES_SCHEMAS = ['versegit.capabilities/v1'];
export const READ_ONLY_MCP_ALLOWLIST = [
  'vg_capabilities', 'verdict', 'integration_status', 'who_touches', 'explain_conflict', 'basis_status', 'basis_watermark',
];
export const MODEL_FORBIDDEN_MCP_TOOLS = ['declare_intent'];

export const WP0_ARTIFACTS = {
  mc0: 'harness/specs/fixtures/versegit-planning-correction/mc0-evidence/baseline.json',
  mc1: 'harness/specs/fixtures/versegit-planning-correction/mc1-evidence/contract.json',
  mc2: 'harness/specs/fixtures/versegit-planning-correction/mc2-evidence/golden.json',
  mc3: 'harness/specs/fixtures/versegit-planning-correction/mc3-evidence/package-manifest.json',
};

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function readJson(root, relative) {
  const path = resolve(root, relative);
  if (!existsSync(path)) throw new Error(`missing artifact: ${relative}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function versionMatrix({ mc0, mc1, mc2, mc3, capabilities }) {
  return {
    host_contract_versions: SUPPORTED_CONTRACT_VERSIONS,
    consumer_contract_version: mc1.schema,
    module_report_schema: mc1.surface.module_report.schema,
    command_plan_schema: mc1.surface.command_plan.schema,
    execution_receipt_schema: mc1.surface.execution_receipt.schema,
    sidecar_package_schema: mc3.packageSchema,
    fingerprint_schema: mc2.fingerprintSchema,
    vg_version: mc0.version?.version ?? null,
    vg_schema_version: mc0.vgSchema?.schema_version ?? null,
    supported_vg_schema_versions: mc0.vgSchema?.supported_schema_versions ?? [],
    ledger_schema_version: mc0.vgSchema?.ledger_schema_version ?? null,
    capabilities_schema: capabilities?.schema ?? null,
    verdict_schema: capabilities?.verdict?.schema ?? null,
    sts_protocols: capabilities?.compat?.sts_protocols ?? [],
    platform: mc3.identity?.platform ?? `${process.platform}-${process.arch}`,
    binary_profile: mc3.identity?.binary_profile ?? null,
    binary_sha256: mc0.binary.sha256,
    source_head: mc0.source.head,
  };
}

// The MCP surface VG advertises must be filtered before a model can see it:
// `declare_intent` writes ledger facts, so it is never part of a read-only profile.
export function readOnlyToolCatalog(capabilities) {
  const advertised = [...(capabilities?.mcp_tools ?? [])].sort();
  const allowed = advertised.filter((tool) => READ_ONLY_MCP_ALLOWLIST.includes(tool) && !MODEL_FORBIDDEN_MCP_TOOLS.includes(tool));
  const excluded = advertised.filter((tool) => !allowed.includes(tool));
  return {
    advertised_tools: advertised,
    read_only_tools: allowed,
    excluded_tools: excluded,
    deny_by_default: true,
    write_tools_exposed: false,
    catalog_digest: sha256(JSON.stringify(allowed)),
    excluded_digest: sha256(JSON.stringify(excluded)),
  };
}

// Mode resolution is pure: M0 spawns nothing and reads nothing, and no mode may
// silently grant itself a higher capability set.
export function resolveMode({ mode, catalog, matrix, startedProcesses = 0 }) {
  if (mode === 'M0') {
    return {
      mode: 'M0', attach: false, processes_started: 0, state_read: false, workspace_write: false,
      status: 'not_applicable', host_verdict: 'unchanged', reason: 'disabled_by_profile',
      catalog_digest: catalog.catalog_digest, matrix_head: matrix.source_head,
    };
  }
  return {
    mode, attach: true, processes_started: startedProcesses, state_read: startedProcesses > 0,
    workspace_write: false, status: 'partial', host_verdict: 'unchanged',
    reason: 'identity_probe_only', catalog_digest: catalog.catalog_digest, matrix_head: matrix.source_head,
  };
}

export function evaluateGate({ matrix, mc0, mc3, capabilities, capabilitiesDigest, binaryExists }) {
  const failures = [];
  if (!binaryExists) {
    // Without a binary nothing was probed, so no other identity claim can be made.
    failures.push({ case: 'missing_binary', status: 'unavailable', module_state: 'discovered_failed', host_verdict: 'unchanged' });
    return { passed: false, failures };
  }
  if (mc3.identity?.binary_sha256 !== mc0.binary.sha256) failures.push({ case: 'binary_digest_mismatch', status: 'rejected_by_policy', module_state: 'rejected_by_policy', host_verdict: 'unchanged' });
  if (!SUPPORTED_CAPABILITIES_SCHEMAS.includes(capabilities?.schema)) failures.push({ case: 'capabilities_schema_unsupported', status: 'rejected_by_policy', module_state: 'rejected_by_policy', host_verdict: 'unchanged' });
  if (capabilitiesDigest !== mc0.binary.capabilities_sha256) failures.push({ case: 'capabilities_digest_mismatch', status: 'rejected_by_policy', module_state: 'rejected_by_policy', host_verdict: 'unchanged' });
  const maxSupported = Math.max(0, ...(matrix.supported_vg_schema_versions ?? []));
  if ((matrix.ledger_schema_version ?? 0) > maxSupported) failures.push({ case: 'ledger_schema_too_new', status: 'rejected_by_policy', module_state: 'rejected_by_policy', host_verdict: 'unchanged' });
  if (!SUPPORTED_CONTRACT_VERSIONS.includes(matrix.consumer_contract_version)) failures.push({ case: 'contract_version_unsupported', status: 'rejected_by_policy', module_state: 'rejected_by_policy', host_verdict: 'unchanged' });
  return { passed: failures.length === 0, failures };
}

function porcelainSha(repo) {
  const result = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: repo, encoding: 'utf8', timeout: 120_000, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  return sha256(String(result.stdout ?? ''));
}

export function buildWp0Contract({ root = repositoryRoot, probe = true } = {}) {
  const mc0 = readJson(root, WP0_ARTIFACTS.mc0);
  const mc1 = readJson(root, WP0_ARTIFACTS.mc1);
  const mc2 = readJson(root, WP0_ARTIFACTS.mc2);
  const mc3 = readJson(root, WP0_ARTIFACTS.mc3);
  const binary = resolve(String(mc0.binary.path));
  const binaryExists = existsSync(binary);
  const before = porcelainSha(mc0.source.repo);
  let capabilities = null;
  let probeError = null;
  if (binaryExists && probe) {
    const result = spawnSync(binary, ['capabilities', '--json'], { cwd: mc0.source.repo, encoding: 'utf8', timeout: 60_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    if (result.status === 0) {
      try { capabilities = JSON.parse(String(result.stdout).trim()); } catch (error) { probeError = String(error?.message ?? error); }
    } else {
      probeError = String(result.stderr ?? result.error?.message ?? 'probe_failed').trim();
    }
  } else if (!binaryExists) {
    probeError = 'binary_missing';
  }
  const after = porcelainSha(mc0.source.repo);
  const capabilitiesDigest = capabilities ? sha256(JSON.stringify(capabilities)) : null;
  const matrix = versionMatrix({
    mc0, mc1, mc2, mc3,
    capabilities: capabilities ?? { schema: mc0.binary.capabilities_schema ?? null, verdict: { schema: 'versegit.verdict/v1' }, compat: { sts_protocols: [] }, mcp_tools: [] },
  });
  const catalog = readOnlyToolCatalog(capabilities ?? { mcp_tools: [] });
  const gate = evaluateGate({ matrix, mc0, mc3, capabilities: capabilities ?? { schema: null }, capabilitiesDigest, binaryExists });
  return {
    contractSchema: WP0_SCHEMA,
    generated_at: new Date().toISOString(),
    driven_by: 'agent',
    actor: 'codex',
    task: 'TF-0466',
    binary_identity: {
      path: binary.replaceAll('\\', '/'),
      exists: binaryExists,
      sha256: mc0.binary.sha256,
      bytes: mc0.binary.bytes,
      profile: mc3.identity?.binary_profile ?? null,
      platform: matrix.platform,
      capabilities_schema: capabilities?.schema ?? null,
      capabilities_digest: capabilitiesDigest,
      source_head: mc0.source.head,
      source_tree: mc0.source.tree,
      consumer_contract_digest: sha256(JSON.stringify(mc1)),
      golden_bundle_digest: mc2.digest,
      sidecar_package_digest: mc3.digest,
    },
    version_matrix: matrix,
    read_only_tool_catalog: catalog,
    mcp_registration: {
      registered_by_clawx: false,
      policy: 'ClawX exposes only the filtered read-only catalog through a host-owned typed adapter addressed by the binary digest; the provider .mcp.json entry is never inherited.',
      provider_release_binary_present: existsSync(resolve(mc0.source.repo, 'target', 'release', 'vg.exe')),
      provider_mcp_entry_is_dev_override: true,
      mutable_checkout_path_consumed: false,
      model_facing_write_tools: [],
    },
    mode_matrix: {
      M0: { attach: false, processes_started: 0, state_read: false, workspace_write: false, domain_state_write: false, execution: 'none', status: 'not_applicable', host_verdict: 'unchanged' },
      M1: { attach: true, processes_started: 1, state_read: true, workspace_write: false, domain_state_write: false, execution: 'none', status: 'partial', host_verdict: 'unchanged' },
      M2: { attach: true, processes_started: 1, state_read: true, workspace_write: false, domain_state_write: true, execution: 'none', status: 'partial', host_verdict: 'unchanged' },
      M3: { attach: true, processes_started: 1, state_read: true, workspace_write: false, domain_state_write: true, execution: 'via_verseshell_only', status: 'partial', host_verdict: 'unchanged' },
    },
    mode_resolution: {
      M0: resolveMode({ mode: 'M0', catalog, matrix }),
      M1: resolveMode({ mode: 'M1', catalog, matrix, startedProcesses: probe && binaryExists ? 1 : 0 }),
    },
    gate,
    probe_error: probeError,
    eligibility: {
      triggers: ['more_than_one_worktree', 'more_than_one_active_session', 'explicit_isolation_plan'],
      default_enabled: false,
      single_worktree_single_session_commands: 0,
      added_to_fast_profile: false,
      added_to_comms_profile: false,
      added_to_implicit_profile: false,
    },
    non_interference: {
      created_or_attached_session: false,
      wrote_provider_state: false,
      provider_workspace_unchanged: before === after,
      provider_porcelain_sha256_before: before,
      provider_porcelain_sha256_after: after,
      land_or_admit_invoked: false,
      host_verdict_changed: false,
    },
    status: gate.passed ? 'verified' : 'rejected',
    host_verdict: 'unchanged',
    boundaries: {
      vg_source_tree_copied: false,
      vg_history_copied: false,
      vg_task_forest_copied: false,
      vg_build_outputs_copied: false,
      vg_private_evidence_copied: false,
      provider_source_modified: false,
      default_on: false,
    },
  };
}

export function validateWp0Contract(contract) {
  const issues = [];
  if (contract?.contractSchema !== WP0_SCHEMA) issues.push(`contractSchema must be ${WP0_SCHEMA}`);
  if (!/^[0-9a-f]{64}$/u.test(String(contract?.binary_identity?.sha256 ?? ''))) issues.push('binary sha256 missing');
  if (!/^[0-9a-f]{40}$/u.test(String(contract?.binary_identity?.source_head ?? ''))) issues.push('source head missing');
  if (contract?.binary_identity?.capabilities_schema !== 'versegit.capabilities/v1') issues.push('capabilities schema is not versegit.capabilities/v1');
  if (!/^[0-9a-f]{64}$/u.test(String(contract?.binary_identity?.capabilities_digest ?? ''))) issues.push('capabilities digest missing');
  for (const field of ['consumer_contract_version', 'module_report_schema', 'command_plan_schema', 'execution_receipt_schema', 'ledger_schema_version', 'platform', 'binary_profile', 'sidecar_package_schema', 'fingerprint_schema']) {
    if (!contract?.version_matrix?.[field]) issues.push(`version matrix missing ${field}`);
  }
  if (contract?.read_only_tool_catalog?.deny_by_default !== true) issues.push('the MCP catalog must be deny-by-default');
  if (!contract?.read_only_tool_catalog?.excluded_tools?.includes('declare_intent')) issues.push('declare_intent must be excluded from the read-only catalog');
  if (contract?.read_only_tool_catalog?.write_tools_exposed !== false) issues.push('no write tool may be exposed');
  if (!/^[0-9a-f]{64}$/u.test(String(contract?.read_only_tool_catalog?.catalog_digest ?? ''))) issues.push('read-only catalog digest missing');
  if (contract?.mcp_registration?.registered_by_clawx !== false) issues.push('ClawX must not register the provider .mcp.json entry');
  if (contract?.mcp_registration?.mutable_checkout_path_consumed !== false) issues.push('the module must not consume a mutable checkout path');
  if (contract?.mode_matrix?.M0?.processes_started !== 0 || contract?.mode_matrix?.M0?.attach !== false) issues.push('M0 must start no process and attach nothing');
  if (contract?.mode_resolution?.M0?.processes_started !== 0) issues.push('the M0 resolution must start zero processes');
  for (const mode of ['M0', 'M1', 'M2', 'M3']) {
    const entry = contract?.mode_matrix?.[mode];
    if (!entry) { issues.push(`missing mode ${mode}`); continue; }
    if (entry.workspace_write !== false) issues.push(`${mode} must not write the user workspace`);
    if (entry.host_verdict !== 'unchanged') issues.push(`${mode} must not change the harness verdict`);
  }
  if (contract?.mode_matrix?.M1?.domain_state_write !== false) issues.push('M1 must not write provider domain state');
  if (contract?.mode_matrix?.M1?.execution !== 'none') issues.push('M1 must not execute checks');
  if (contract?.mode_matrix?.M3?.execution !== 'via_verseshell_only') issues.push('M3 execution must be VerseShell-only');
  if (contract?.eligibility?.default_enabled !== false) issues.push('the module must stay default-off');
  if (contract?.eligibility?.added_to_fast_profile || contract?.eligibility?.added_to_comms_profile || contract?.eligibility?.added_to_implicit_profile) issues.push('the module must not join fast, comms or an implicit profile');
  if (contract?.non_interference?.provider_workspace_unchanged !== true) issues.push('the identity probe must not change the provider workspace');
  if (contract?.non_interference?.created_or_attached_session !== false) issues.push('WP0 must not create or attach a session');
  if (contract?.non_interference?.wrote_provider_state !== false) issues.push('WP0 must not write provider state');
  if (contract?.non_interference?.land_or_admit_invoked !== false) issues.push('WP0 must not invoke land or admit');
  for (const failure of contract?.gate?.failures ?? []) {
    if (!['unavailable', 'rejected_by_policy', 'partial', 'degraded'].includes(failure.status)) issues.push(`gate failure ${failure.case} has an invalid status`);
    if (failure.host_verdict !== 'unchanged') issues.push(`gate failure ${failure.case} must leave the host verdict unchanged`);
  }
  for (const boundary of ['vg_source_tree_copied', 'vg_history_copied', 'vg_task_forest_copied', 'vg_build_outputs_copied', 'vg_private_evidence_copied', 'provider_source_modified']) {
    if (contract?.boundaries?.[boundary] !== false) issues.push(`boundary ${boundary} must be false`);
  }
  if (contract?.boundaries?.default_on !== false) issues.push('the contract must not claim default-on');
  return { ok: issues.length === 0, issues };
}

export function writeWp0Contract({ output, root = repositoryRoot } = {}) {
  const contract = buildWp0Contract({ root });
  const validation = validateWp0Contract(contract);
  const path = output ? resolve(output) : resolve(root, 'harness/specs/fixtures/versegit-planning-correction/wp0-evidence/contract.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(contract, null, 2)}\n`, 'utf8');
  return { path, contract, validation };
}

function main() {
  const at = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? resolve(process.argv[i + 1]) : undefined; };
  const result = writeWp0Contract({ output: at('--out') });
  console.log(JSON.stringify({
    path: result.path,
    status: result.contract.status,
    gate: result.contract.gate.failures.map((entry) => entry.case),
    processes_started: { M0: result.contract.mode_resolution.M0.processes_started, M1: result.contract.mode_resolution.M1.processes_started },
    validation: result.validation,
  }, null, 2));
  if (!result.validation.ok) process.exitCode = 1;
}

if (isMainEntrypoint(import.meta.url)) main();
