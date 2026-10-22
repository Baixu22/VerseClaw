#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const expectedSchemas = {
  core: 'clawx.versegit.planning-correction/v1',
  m1: 'clawx.versegit.m1-effect-matrix/v1',
  receipt: 'clawx.verseshell.execution-receipt/v1',
  provider: 'clawx.versegit.provider-contracts/v1',
  inputFreeze: 'clawx.versegit.input-freeze/v1',
  nodes: 'clawx.versegit.node-acceptance-matrix/v1',
  soak: 'clawx.versegit.resource-soak/v1',
  evidence: 'clawx.versegit.evidence-retention/v1',
};

const expectedNodeIds = [
  'TF-0465', 'TF-0466', 'TF-0467', 'TF-0468', 'TF-0469', 'TF-0470', 'TF-0471', 'TF-0472',
  'TF-0473', 'TF-0474', 'TF-0475', 'TF-0476', 'TF-0477', 'TF-0478', 'TF-0479', 'TF-0480',
];

function readJson(path) {
  if (!existsSync(path)) throw new Error(`missing fixture: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function requireKeys(object, keys, label, issues) {
  for (const key of keys) {
    if (object?.[key] === undefined) issues.push(`${label}: missing ${key}`);
  }
}

function validateDag(core, issues) {
  const required = [
    ['TF-0466', 'TF-0476'],
    ['TF-0478', 'TF-0466'],
    ['TF-0477', 'TF-0478'],
    ['TF-0467', 'TF-0477'],
    ['TF-0468', 'TF-0477'],
    ['TF-0469', 'TF-0477'],
  ];
  const actual = new Set((core.dag?.required_edges ?? []).map((edge) => `${edge.from}->${edge.to}`));
  for (const [from, to] of required) {
    if (!actual.has(`${from}->${to}`)) issues.push(`dag: missing required edge ${from}->${to}`);
  }
  const forbidden = new Set((core.dag?.forbidden_edges ?? []).map((edge) => `${edge.from}->${edge.to}`));
  if (!forbidden.has('TF-0478->TF-0477')) issues.push('dag: missing forbidden edge TF-0478->TF-0477');
  if (core.dag?.planning_correction !== 'TF-0481') issues.push('dag: planning correction must be TF-0481');
  if (!core.dag?.optional_nodes?.includes('TF-0479')) issues.push('dag: TF-0479 must be optional');
  if (!core.dag?.deprecated_nodes?.some((node) => node.id === 'TF-0480')) issues.push('dag: TF-0480 must be deprecated');
}

function validateM1(m1, issues) {
  const entries = new Map(m1.entries?.map((entry) => [entry.entry, entry]));
  for (const name of ['capabilities', 'doctor', 'conflicts', 'session_show', 'verdict_facts']) {
    if (!entries.has(name)) issues.push(`m1: missing entry ${name}`);
  }
  for (const [name, entry] of entries) {
    requireKeys(entry, ['pure_diagnostic', 'effects'], `m1:${name}`, issues);
    for (const effect of ['file_read', 'file_write', 'db_read', 'db_write_or_create', 'git_object_write', 'materialize', 'execute']) {
      if (typeof entry.effects?.[effect] !== 'boolean') issues.push(`m1:${name}: effect ${effect} must be boolean`);
    }
    if (entry.pure_diagnostic && (entry.effects?.file_write || entry.effects?.db_write_or_create || entry.effects?.git_object_write || entry.effects?.materialize || entry.effects?.execute)) {
      issues.push(`m1:${name}: pure diagnostic entry has a forbidden effect`);
    }
  }
  if (entries.get('conflicts')?.pure_diagnostic !== false) issues.push('m1: conflicts must not be marked pure diagnostic');
  for (const seam of ['provider.status', 'provider.doctor', 'provider.conflicts-plan', 'provider.session-status']) {
    if (!m1.provider_seams?.includes(seam)) issues.push(`m1: missing provider seam ${seam}`);
  }
  for (const forbidden of ['initialize', 'migrate', 'materialize', 'execute_check', 'write_workspace', 'write_domain_state']) {
    if (!m1.forbidden_in_m1?.includes(forbidden)) issues.push(`m1: missing forbidden effect ${forbidden}`);
  }
}

function validateReceipt(receipt, issues) {
  const required = ['planId', 'candidateId', 'checkId', 'ownerId', 'epoch', 'executionInputDigest', 'requiredScope', 'artifactDigests', 'cleanupStatus'];
  for (const binding of required) {
    if (!receipt.required_bindings?.includes(binding)) issues.push(`receipt: missing binding ${binding}`);
  }
  for (const rejection of ['wrong_candidate', 'stale_epoch', 'plan_check_mismatch', 'input_digest_drift', 'permission_revoked', 'missing_or_forged_artifact', 'selected_scope_claimed_as_full']) {
    if (!receipt.rejects?.includes(rejection)) issues.push(`receipt: missing rejection ${rejection}`);
  }
  if (receipt.trusted_source !== 'ClawX host process/artifact authority') issues.push('receipt: trusted source must be ClawX host process/artifact authority');
}

function validateProvider(provider, issues) {
  if (provider.state?.m1 !== 'No provider state is created; missing state is unavailable, not initialized.') issues.push('provider: M1 state rule mismatch');
  if (provider.state?.m2 !== 'ClawX host explicitly creates provider state in a declared location after approval.') issues.push('provider: M2 state rule mismatch');
  requireKeys(provider.state?.shared_sidecar, ['instance_key', 'reference_counting', 'last_consumer_shutdown', 'standalone_state_reuse'], 'provider:shared_sidecar', issues);
  for (const identity of ['effective_source_commit', 'source_tree_digest', 'allowed_residual_patches', 'build_recipe_digest', 'lockfile_digest', 'platform', 'binary_sha256', 'capabilities_digest']) {
    if (!provider.delivery?.required_identity?.includes(identity)) issues.push(`provider delivery: missing identity ${identity}`);
  }
  if (provider.delivery?.build_must_be_reproducible !== true) issues.push('provider delivery: build must be reproducible');
  const cleanup = provider.cleanup_barrier?.order ?? [];
  const expectedCleanup = ['stop_accepting_work', 'drain_or_cancel_inflight', 'seal_evidence', 'detach_vg_session', 'verify_owner_epoch_reference', 'delete_disposable_worktree'];
  if (JSON.stringify(cleanup) !== JSON.stringify(expectedCleanup)) issues.push('provider cleanup: order mismatch');
}

function validateInputFreeze(inputFreeze, issues) {
  if (inputFreeze.inprocess_backend?.supported !== false) issues.push('input freeze: inprocess backend must be unsupported');
  for (const step of ['hash canonical path set', 'hash file content and mode', 'hash dependency manifests', 'rehash before and after verification', 'reject on drift']) {
    if (!inputFreeze.algorithm?.includes(step)) issues.push(`input freeze: missing algorithm step ${step}`);
  }
  if (inputFreeze.git_backend?.dirty_files !== true || inputFreeze.git_backend?.untracked_files !== true) issues.push('input freeze: Git backend must cover dirty and untracked files');
}

function validateNodes(nodes, issues) {
  const ids = nodes.nodes?.map((node) => node.id) ?? [];
  if (new Set(ids).size !== ids.length) issues.push('nodes: duplicate node id');
  for (const id of expectedNodeIds) {
    if (!ids.includes(id)) issues.push(`nodes: missing ${id}`);
  }
  for (const node of nodes.nodes ?? []) {
    requireKeys(node, ['id', 'role', 'anchor', 'fixture', 'artifact', 'verifier', 'closure', 'next'], `node:${node.id}`, issues);
    if (!nodes.taskSpec) issues.push(`node:${node.id}: missing task spec`);
    if (!String(node.anchor ?? '').startsWith('#')) issues.push(`node:${node.id}: anchor must start with #`);
  }
  const merged = nodes.nodes?.find((node) => node.id === 'TF-0480');
  if (merged?.closure !== 'Deprecated and merged into TF-0472') issues.push('nodes: TF-0480 must be deprecated and merged into TF-0472');
}

function validateSoak(soak, issues) {
  requireKeys(soak, ['limits', 'over_limit_action', 'soak_recipe', 'performance_tolerances', 'calibration_rule'], 'soak', issues);
  for (const key of ['max_active_sessions', 'max_candidate_worktrees', 'max_parallel_checks', 'max_event_queue_bytes', 'max_sidecar_memory_mb', 'max_sidecar_cpu_percent', 'max_log_bytes_per_run', 'max_disk_bytes_per_run']) {
    if (!Number.isFinite(soak.limits?.[key])) issues.push(`soak: missing numeric limit ${key}`);
  }
  if (soak.soak_recipe?.worktrees !== 3) issues.push('soak: three-worktree recipe required');
  if (soak.soak_recipe?.three_way_composition_cases === undefined) issues.push('soak: three-way composition cases required');
}

function validateEvidence(evidence, issues) {
  if (!evidence.disposable_resources?.length || !evidence.retain_evidence?.length) issues.push('evidence: disposable and retained sets must be explicit');
  if (evidence.sealing?.atomic !== true) issues.push('evidence: sealing must be atomic');
  if (evidence.sealing?.missing_file !== 'incomplete' || evidence.sealing?.tamper !== 'reject') issues.push('evidence: missing/tamper semantics mismatch');
}

export function validateVerseGitPlanningCorrection({ root = repositoryRoot, node } = {}) {
  const issues = [];
  const fixtureDir = resolve(root, 'harness/specs/fixtures/versegit-planning-correction');
  const corePath = resolve(fixtureDir, 'planning-contract.json');
  let core;
  try { core = readJson(corePath); } catch (error) { return { ok: false, issues: [error.message] }; }
  if (core.schema !== expectedSchemas.core) issues.push(`core: schema mismatch: ${core.schema}`);
  requireKeys(core, ['review_input', 'p0', 'p1', 'dag', 'non_goals', 'completion'], 'core', issues);
  if (core.review_input?.verdict !== 'FAIL') issues.push('core: review input must preserve the FAIL verdict');
  if (!core.review_input?.required_re_review_verdict?.includes('PASS_WITH_GAPS')) issues.push('core: PASS_WITH_GAPS re-review must be allowed');
  if (core.completion?.clean_tree_full_validation_required !== true) issues.push('core: clean-tree full validation must be required');

  const contractFiles = {
    m1: 'm1-effect-matrix.json',
    receipt: 'execution-receipt-contract.json',
    provider: 'provider-contracts.json',
    inputFreeze: 'input-freeze-contract.json',
    nodes: 'node-acceptance-matrix.json',
    soak: 'resource-soak-plan.json',
    evidence: 'evidence-retention-contract.json',
  };
  const contracts = {};
  for (const [key, file] of Object.entries(contractFiles)) {
    const path = resolve(fixtureDir, file);
    try {
      contracts[key] = readJson(path);
      if (contracts[key].schema !== expectedSchemas[key]) issues.push(`${key}: schema mismatch: ${contracts[key].schema}`);
    } catch (error) {
      issues.push(error.message);
    }
  }

  validateDag(core, issues);
  if (contracts.m1) validateM1(contracts.m1, issues);
  if (contracts.receipt) validateReceipt(contracts.receipt, issues);
  if (contracts.provider) validateProvider(contracts.provider, issues);
  if (contracts.inputFreeze) validateInputFreeze(contracts.inputFreeze, issues);
  if (contracts.nodes) validateNodes(contracts.nodes, issues);
  if (contracts.soak) validateSoak(contracts.soak, issues);
  if (contracts.evidence) validateEvidence(contracts.evidence, issues);

  if (node) {
    const selected = contracts.nodes?.nodes?.find((entry) => entry.id === node);
    if (!selected) issues.push(`node: requested node not found: ${node}`);
  }

  return { ok: issues.length === 0, issues, node: node ?? null };
}

async function main() {
  const nodeIndex = process.argv.indexOf('--node');
  const node = nodeIndex >= 0 ? process.argv[nodeIndex + 1] : undefined;
  const result = validateVerseGitPlanningCorrection({ node });
  if (!result.ok) {
    for (const issue of result.issues) console.error(`[versegit-planning] FAIL: ${issue}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[versegit-planning] OK${node ? ` node=${node}` : ''}`);
}

if (isMainEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(`[versegit-planning] FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}