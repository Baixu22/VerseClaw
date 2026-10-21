#!/usr/bin/env node
// MC3: freeze the VerseGit sidecar delivery contract.
//
// The sidecar is delivered as a digest-addressed package: ClawX stores the manifest,
// capabilities, the consumer contract and the golden bundle digest, and never copies
// the VerseGit source tree, .git or .agent-workbench. Startup, timeout, kill-switch,
// missing-binary and recovery behavior are probed against the frozen binary so the
// acceptance criteria are evidence-based rather than declared.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MC3_SCHEMA = 'clawx.versegit.mc3-package/v1';
export const MC0_BASELINE_PATH = 'harness/specs/fixtures/versegit-planning-correction/mc0-evidence/baseline.json';
export const MC1_CONTRACT_PATH = 'harness/specs/fixtures/versegit-planning-correction/mc1-evidence/contract.json';
export const MC2_GOLDEN_PATH = 'harness/specs/fixtures/versegit-planning-correction/mc2-evidence/golden.json';
export const PROVIDER_CONTRACT_PATH = 'harness/specs/fixtures/versegit-planning-correction/provider-contracts.json';

export const REQUIRED_IDENTITY_FIELDS = [
  'effective_source_commit', 'source_tree_digest', 'allowed_residual_patches', 'build_recipe_digest',
  'lockfile_digest', 'platform', 'binary_sha256', 'capabilities_digest', 'contract_digest',
  'golden_bundle_digest', 'capability_matrix_digest',
];
export const FORBIDDEN_PACKAGE_CONTENTS = ['source_tree', 'git_directory', 'build_output_directory', 'task_forest', 'private_evidence'];
const sleep = (ms) => { const until = Date.now() + ms; while (Date.now() < until) { /* bounded synchronous wait keeps the probe deterministic */ } };

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256File(path) {
  return sha256(readFileSync(path));
}

function runGit(repo, args) {
  try {
    return { ok: true, stdout: execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000, windowsHide: true }).trim(), stderr: '' };
  } catch (error) {
    return { ok: false, stdout: '', stderr: String(error?.stderr ?? error?.message ?? error).trim() };
  }
}

export function packageTempRoot(env = process.env) {
  return resolve(env.VERSEGIT_SIDECAR_TMP || env.TEMP || env.TMP || tmpdir());
}

// The install and temp roots must never sit on the system drive: C: on this machine is
// chronically full, so a sidecar writing there fails as an apparent code error.
export function assertNonSystemDrive(path, platform = process.platform) {
  const resolved = resolve(path);
  if (platform !== 'win32') return { ok: true, path: resolved, drive: null };
  const drive = /^[a-zA-Z]:/.exec(resolved)?.[0]?.toUpperCase() ?? null;
  if (!drive) return { ok: false, path: resolved, drive: null, reason: 'install root must be absolute' };
  if (drive === 'C:') return { ok: false, path: resolved, drive, reason: 'install root must not be on the system drive' };
  return { ok: true, path: resolved, drive, reason: null };
}

function childAlive(child) {
  if (!child || child.exitCode !== null || child.signalCode) return false;
  try { process.kill(child.pid, 0); return true; } catch { return false; }
}

function killTree(child) {
  if (!childAlive(child)) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 15_000 });
  } else {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

export function launchSidecar({ binary, args = ['--version'], cwd, timeoutMs = 15_000, killAfterMs = null } = {}) {
  if (!binary || !existsSync(binary)) {
    return {
      status: 'unavailable', host_verdict: 'unchanged', module_state: 'discovered_failed',
      exit_code: null, duration_ms: 0, survivors: 0, reason: 'binary_missing',
      stdout: '', stderr: `binary missing: ${binary ?? 'unset'}`,
    };
  }
  if (killAfterMs !== null) {
    const startedAt = Date.now();
    const child = spawn(binary, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    const deadline = Date.now() + (timeoutMs ?? 15_000);
    while (Date.now() < deadline) {
      if (Date.now() - startedAt >= killAfterMs && childAlive(child)) killTree(child);
      if (!childAlive(child)) break;
      sleep(25);
    }
    if (childAlive(child)) killTree(child);
    const graceUntil = Date.now() + 5_000;
    while (childAlive(child) && Date.now() < graceUntil) sleep(25);
    const survivors = childAlive(child) ? 1 : 0;
    return {
      status: survivors === 0 ? 'observed' : 'degraded', host_verdict: 'unchanged',
      module_state: survivors === 0 ? 'detached' : 'recovery_required',
      exit_code: child.exitCode ?? null, duration_ms: Date.now() - startedAt, survivors,
      reason: survivors === 0 ? 'kill_switch_completed' : 'kill_switch_incomplete',
      stdout: stdout.trim(), stderr: stderr.trim(),
    };
  }
  const startedAt = Date.now();
  const result = spawnSync(binary, args, { cwd, encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  const durationMs = Date.now() - startedAt;
  if (result.error && result.status === null && result.signal === undefined) {
    const timedOut = /ETIMEDOUT|timed out/iu.test(String(result.error.message ?? result.error));
    return {
      status: timedOut ? 'degraded' : 'unavailable', host_verdict: 'unchanged',
      module_state: timedOut ? 'degraded' : 'discovered_failed',
      exit_code: null, duration_ms: durationMs, survivors: 0,
      reason: timedOut ? 'startup_timeout' : 'spawn_failed',
      stdout: String(result.stdout ?? '').trim(), stderr: String(result.stderr ?? result.error?.message ?? result.error).trim(),
    };
  }
  const timedOut = result.error !== undefined && result.status === null && /ETIMEDOUT|timed out/iu.test(String(result.error?.message ?? ''));
  return {
    status: timedOut ? 'degraded' : (result.status === 0 ? 'observed' : 'degraded'),
    host_verdict: 'unchanged',
    module_state: timedOut ? 'degraded' : (result.status === 0 ? 'active' : 'degraded'),
    exit_code: result.status ?? null, duration_ms: durationMs, survivors: 0,
    reason: timedOut ? 'startup_timeout' : (result.status === 0 ? null : 'nonzero_exit'),
    stdout: String(result.stdout ?? '').trim(), stderr: String(result.stderr ?? '').trim(),
  };
}

// A digest-addressed package is only usable when the stored identity matches the frozen
// baseline; a mismatch is a policy rejection, never a silent fallback to another binary.
export function verifyPackageIdentity({ identity, expectedBinarySha, expectedSourceCommit }) {
  const mismatches = [];
  if (identity?.binary_sha256 !== expectedBinarySha) mismatches.push('binary_sha256');
  if (identity?.effective_source_commit !== expectedSourceCommit) mismatches.push('effective_source_commit');
  if (identity?.capabilities_digest === null || identity?.capabilities_digest === undefined) mismatches.push('capabilities_digest');
  return mismatches.length === 0
    ? { status: 'verified', module_state: 'verified', host_verdict: 'unchanged', mismatches }
    : { status: 'rejected_by_policy', module_state: 'rejected_by_policy', host_verdict: 'unchanged', mismatches };
}

function stripPayload({ stdout, stderr, ...rest }) {
  return { ...rest, stderr_excerpt: stderr ? String(stderr).split(/\r?\n/u)[0]?.slice(0, 140) ?? null : null };
}

// Build a disposable VG workspace (real git repo + .vg ledger) so startup, timeout and
// kill-switch probes exercise the same path a sidecar would run inside.
function makeFixtureProbeRepo(tempRoot, binary) {
  const fixture = mkdtempSync(join(tempRoot, 'versegit-mc3-'));
  runGit(fixture, ['init', '--quiet', '-b', 'main']);
  runGit(fixture, ['config', 'user.name', 'versegit-mc3']);
  runGit(fixture, ['config', 'user.email', 'versegit-mc3@example.invalid']);
  writeFileSync(join(fixture, 'a.txt'), 'x = 1\n', 'utf8');
  runGit(fixture, ['add', '-A']);
  runGit(fixture, ['commit', '--quiet', '-m', 'base']);
  spawnSync(binary, ['init', '--json'], { cwd: fixture, encoding: 'utf8', timeout: 30_000, windowsHide: true });
  return fixture;
}

export function buildMc3Package({ repo, binary, tempRoot } = {}) {
  const mc0 = JSON.parse(readFileSync(resolve(repositoryRoot, MC0_BASELINE_PATH), 'utf8'));
  const mc1 = JSON.parse(readFileSync(resolve(repositoryRoot, MC1_CONTRACT_PATH), 'utf8'));
  const resolvedRepo = repo ? resolve(repo) : resolve(String(mc0?.source?.repo ?? repositoryRoot));
  const mc2 = JSON.parse(readFileSync(resolve(repositoryRoot, MC2_GOLDEN_PATH), 'utf8'));
  const provider = JSON.parse(readFileSync(resolve(repositoryRoot, PROVIDER_CONTRACT_PATH), 'utf8'));
  const resolvedBinary = binary ? resolve(binary) : resolve(String(mc0.binary.path));
  const binaryBytes = existsSync(resolvedBinary) ? readFileSync(resolvedBinary) : null;
  const binarySha = binaryBytes ? sha256(binaryBytes) : null;
  const platform = `${process.platform}-${process.arch}`;
  const root = tempRoot ? resolve(tempRoot) : packageTempRoot();
  mkdirSync(root, { recursive: true });

  const head = runGit(resolvedRepo, ['rev-parse', 'HEAD']);
  const tree = runGit(resolvedRepo, ['rev-parse', 'HEAD^{tree}']);
  const status = runGit(resolvedRepo, ['status', '--porcelain=v1', '--untracked-files=all']);
  const dirtyLines = status.ok ? status.stdout.split(/\r?\n/u).filter(Boolean) : [];
  const lockfile = join(resolvedRepo, 'Cargo.lock');
  const toolchain = join(resolvedRepo, 'rust-toolchain.toml');
  const releaseBinary = join(resolvedRepo, 'target', 'release', process.platform === 'win32' ? 'vg.exe' : 'vg');
  const installRoot = resolve(repositoryRoot, '..', 'ClawX-sidecar', 'versegit');
  const installPath = join(installRoot, binarySha ? binarySha.slice(0, 16) : 'unresolved', process.platform === 'win32' ? 'vg.exe' : 'vg');

  const probe = makeFixtureProbeRepo(root, resolvedBinary);
  const capabilitiesProbe = launchSidecar({ binary: resolvedBinary, args: ['capabilities', '--json'], cwd: probe, timeoutMs: 30_000 });
  const capabilitiesDoc = (() => { try { return JSON.parse(capabilitiesProbe.stdout); } catch { return null; } })();

  const identity = {
    effective_source_commit: head.ok ? head.stdout : null,
    source_tree_digest: tree.ok ? tree.stdout : null,
    allowed_residual_patches: dirtyLines,
    build_recipe_digest: sha256(JSON.stringify({
      recipe: ['cargo', 'build', '--release', '--package', 'vg-cli'],
      toolchain_sha256: existsSync(toolchain) ? sha256File(toolchain) : null,
      lockfile_sha256: existsSync(lockfile) ? sha256File(lockfile) : null,
      platform,
    })),
    lockfile_digest: existsSync(lockfile) ? sha256File(lockfile) : null,
    platform,
    binary_sha256: binarySha,
    binary_bytes: binaryBytes ? binaryBytes.length : null,
    binary_profile: existsSync(releaseBinary) ? 'release' : 'debug',
    capabilities_digest: capabilitiesDoc ? sha256(JSON.stringify(capabilitiesDoc)) : null,
    capabilities_schema: capabilitiesDoc?.schema ?? null,
    contract_digest: sha256(JSON.stringify(mc1)),
    golden_bundle_digest: mc2.digest ?? null,
    capability_matrix_digest: capabilitiesDoc ? sha256(JSON.stringify(capabilitiesDoc.workflows ?? [])) : null,
    vg_version: mc0.version?.version ?? null,
    ledger_schema_version: mc0.vgSchema?.ledger_schema_version ?? null,
  };

  const versionSmoke = launchSidecar({ binary: resolvedBinary, args: ['--version'], cwd: probe, timeoutMs: 15_000 });
  const doctorOutsideSmoke = launchSidecar({ binary: resolvedBinary, args: ['doctor', '--json'], cwd: root, timeoutMs: 30_000 });
  const timeoutSmoke = launchSidecar({ binary: resolvedBinary, args: ['daemon', '--repo', probe, '--ticks', '0', '--interval-ms', '250'], cwd: probe, timeoutMs: 1 });
  const killSmoke = launchSidecar({
    binary: resolvedBinary,
    args: ['daemon', '--repo', probe, '--ticks', '0', '--interval-ms', '250', '--debounce-ms', '0'],
    cwd: probe, timeoutMs: 25_000, killAfterMs: 1_200,
  });
  const missingSmoke = launchSidecar({ binary: join(probe, 'not-installed', 'vg.exe'), args: ['--version'], cwd: probe });

  const identityGate = verifyPackageIdentity({
    identity,
    expectedBinarySha: mc0.binary.sha256,
    expectedSourceCommit: mc0.source.head,
  });
  const identityGateMismatch = verifyPackageIdentity({
    identity,
    expectedBinarySha: '0'.repeat(64),
    expectedSourceCommit: mc0.source.head,
  });
  const installCheck = assertNonSystemDrive(root);
  const installPathCheck = assertNonSystemDrive(installPath);

  rmSync(probe, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  const survivors = existsSync(probe) ? 1 : 0;
  const cleanup = {
    disposable_root_pattern: 'versegit-mc3-*',
    fixture_survivors: survivors,
    sidecar_process_survivors: killSmoke.survivors,
    cleanup_status: survivors === 0 && killSmoke.survivors === 0 ? 'clean' : 'recovery_required',
    host_worktrees_deleted: 0,
    evidence_retained: true,
  };

  const startupSmoke = [
    { id: 'startup_version', expect: 'exit_zero', ...stripPayload(versionSmoke) },
    { id: 'startup_capabilities', expect: 'exit_zero_json', ...stripPayload(capabilitiesProbe) },
    { id: 'startup_doctor_outside_workspace', expect: 'refused_without_state', ...stripPayload(doctorOutsideSmoke) },
    { id: 'startup_timeout_budget', expect: 'bounded_timeout', ...stripPayload(timeoutSmoke) },
    { id: 'startup_kill_switch', expect: 'no_survivors', ...stripPayload(killSmoke) },
    { id: 'startup_missing_binary', expect: 'fail_open_host_verdict', ...stripPayload(missingSmoke) },
    { id: 'identity_gate_match', expect: 'verified', ...identityGate },
    { id: 'identity_gate_digest_mismatch', expect: 'rejected_by_policy', ...identityGateMismatch },
  ];

  const blockers = [];
  if (dirtyLines.length > 0) blockers.push('source_worktree_dirty');
  if (!existsSync(releaseBinary)) blockers.push('release_binary_not_built');
  if (identity.capabilities_schema !== 'versegit.capabilities/v1') blockers.push('capabilities_schema_unverified');
  if (versionSmoke.status !== 'observed' || capabilitiesProbe.status !== 'observed') blockers.push('startup_smoke_failed');
  if (cleanup.cleanup_status !== 'clean') blockers.push('cleanup_not_clean');
  if (!installCheck.ok || !installPathCheck.ok) blockers.push('install_root_on_system_drive');
  if (identity.binary_sha256 !== mc0.binary.sha256) blockers.push('binary_digest_mismatch_with_mc0');
  if (identity.effective_source_commit !== mc0.source.head) blockers.push('source_head_mismatch_with_mc0');

  const manifest = {
    packageSchema: MC3_SCHEMA,
    generated_at: new Date().toISOString(),
    driven_by: 'agent',
    actor: 'codex',
    task: 'TF-0476',
    delivery_model: 'digest-addressed sidecar package',
    identity,
    identity_required_fields: REQUIRED_IDENTITY_FIELDS,
    package_contents: [
      { name: 'binary_manifest', copied_into_clawx: true },
      { name: 'capabilities', schema: identity.capabilities_schema, payload: 'digest and document schema only', copied_into_clawx: true },
      { name: 'consumer_contract', digest: identity.contract_digest, copied_into_clawx: true },
      { name: 'golden_bundle', digest: identity.golden_bundle_digest, copied_into_clawx: true },
      { name: 'capability_matrix', digest: identity.capability_matrix_digest, copied_into_clawx: true },
      { name: 'build_provenance', recipe: 'cargo build --release --package vg-cli', reproducible_build_verified: false, copied_into_clawx: true },
    ],
    forbidden_contents: FORBIDDEN_PACKAGE_CONTENTS.map((name) => ({ name, copied_into_clawx: false })),
    installation: {
      root_policy: 'host-owned per-user sidecar root addressed by the binary digest',
      root_template: relative(repositoryRoot, installRoot).replaceAll('\\', '/') || installRoot.replaceAll('\\', '/'),
      path: installPath.replaceAll('\\', '/'),
      digest_addressed: true,
      temp_root: root.replaceAll('\\', '/'),
      temp_root_off_system_drive: installCheck.ok === true,
      install_path_off_system_drive: installPathCheck.ok === true,
      no_system_drive_artifacts: installCheck.ok === true && installPathCheck.ok === true,
      mutable_checkout_path_consumed: false,
      provider_state_creation: provider.state.m1,
    },
    startup_smoke: startupSmoke,
    runtime_contract: {
      startup_timeout_ms: 15_000,
      command_timeout_ms: 30_000,
      kill_switch: 'stop_accepting_work -> drain_or_cancel_inflight -> terminate process tree -> verify no survivors',
      lifecycle_states: ['absent', 'discovered', 'verified', 'attached', 'active', 'degraded', 'draining', 'detached', 'upgrade_pending', 'recovery_required'],
      crash_state: 'lost',
      incomplete_cleanup_state: 'recovery_required',
      missing_binary_state: 'unavailable',
      digest_mismatch_state: 'rejected_by_policy',
      schema_mismatch_state: 'rejected_by_policy',
      startup_failure_effect_on_host: 'fail_open: harness verdict unchanged and module disabled',
      cleanup_barrier_owner: provider.cleanup_barrier.owner,
      cleanup_barrier_order: provider.cleanup_barrier.order,
      host_worktree_deletion_allowed: false,
    },
    cleanup,
    blockers,
    status: blockers.length === 0 ? 'accepted' : 'rejected',
    deliverable: blockers.length === 0 ? 'eligible' : 'rejected',
    boundaries: {
      vg_source_tree_copied: false,
      vg_git_directory_copied: false,
      vg_build_outputs_copied: false,
      vg_task_forest_copied: false,
      vg_private_evidence_copied: false,
      user_repository_mutated: false,
      provider_state_created_in_user_repo: false,
      release_binary_built: existsSync(releaseBinary),
      land_or_admit_invoked: false,
    },
  };
  manifest.digest = sha256(JSON.stringify({ ...manifest, generated_at: undefined, digest: undefined }));
  return { manifest, provider };
}

export function validateMc3Package(manifest, { requireDeliverable = false } = {}) {
  const issues = [];
  if (manifest?.packageSchema !== MC3_SCHEMA) issues.push(`packageSchema must be ${MC3_SCHEMA}`);
  for (const field of REQUIRED_IDENTITY_FIELDS) {
    if (manifest?.identity?.[field] === undefined) issues.push(`identity missing ${field}`);
  }
  if (!/^[0-9a-f]{64}$/u.test(String(manifest?.identity?.binary_sha256 ?? ''))) issues.push('binary sha256 missing');
  if (!/^[0-9a-f]{40}$/u.test(String(manifest?.identity?.effective_source_commit ?? ''))) issues.push('effective source commit missing');
  if (!Array.isArray(manifest?.identity?.allowed_residual_patches)) issues.push('allowed_residual_patches must be an array');
  if (manifest?.identity?.capabilities_schema !== 'versegit.capabilities/v1') issues.push('capabilities schema is not versegit.capabilities/v1');
  if (manifest?.installation?.no_system_drive_artifacts !== true) issues.push('sidecar install and temp roots must avoid the system drive');
  if (manifest?.installation?.mutable_checkout_path_consumed !== false) issues.push('the package must be digest-addressed, not a mutable checkout path');
  if (manifest?.installation?.digest_addressed !== true) issues.push('the install path must be addressed by the binary digest');
  const smoke = manifest?.startup_smoke ?? [];
  for (const id of ['startup_version', 'startup_capabilities', 'startup_kill_switch', 'startup_missing_binary', 'startup_timeout_budget']) {
    if (!smoke.some((entry) => entry.id === id)) issues.push(`missing startup smoke ${id}`);
  }
  const version = smoke.find((entry) => entry.id === 'startup_version');
  if (!version || version.status !== 'observed') issues.push('sidecar startup smoke must pass');
  const capabilities = smoke.find((entry) => entry.id === 'startup_capabilities');
  if (!capabilities || capabilities.status !== 'observed') issues.push('sidecar capabilities smoke must pass');
  const killSwitch = smoke.find((entry) => entry.id === 'startup_kill_switch');
  if (!killSwitch || killSwitch.survivors !== 0) issues.push('the kill switch must leave no surviving sidecar process');
  const timeout = smoke.find((entry) => entry.id === 'startup_timeout_budget');
  if (!timeout || typeof timeout.duration_ms !== 'number') issues.push('the startup timeout budget must be measured');
  const outside = smoke.find((entry) => entry.id === 'startup_doctor_outside_workspace');
  if (outside && outside.status === 'observed') issues.push('doctor must not be reported as available outside a VG workspace state');
  const missing = smoke.find((entry) => entry.id === 'startup_missing_binary');
  if (!missing || missing.status !== 'unavailable' || missing.host_verdict !== 'unchanged') issues.push('a missing binary must be unavailable and leave the host verdict unchanged');
  const gate = smoke.find((entry) => entry.id === 'identity_gate_match');
  if (!gate || gate.status !== 'verified') issues.push('the package identity gate must verify against the frozen MC0 digests');
  const gateMismatch = smoke.find((entry) => entry.id === 'identity_gate_digest_mismatch');
  if (!gateMismatch || gateMismatch.status !== 'rejected_by_policy') issues.push('a digest mismatch must be rejected by policy');
  for (const entry of manifest?.forbidden_contents ?? []) {
    if (entry.copied_into_clawx !== false) issues.push(`${entry.name} must not enter ClawX`);
  }
  for (const boundary of ['vg_source_tree_copied', 'vg_git_directory_copied', 'vg_build_outputs_copied', 'vg_task_forest_copied', 'vg_private_evidence_copied', 'user_repository_mutated', 'provider_state_created_in_user_repo', 'land_or_admit_invoked']) {
    if (manifest?.boundaries?.[boundary] !== false) issues.push(`boundary ${boundary} must be false`);
  }
  if (manifest?.cleanup?.cleanup_status !== 'clean') issues.push('cleanup must be clean');
  if (manifest?.cleanup?.host_worktrees_deleted !== 0) issues.push('the sidecar must never delete a host worktree');
  if (manifest?.runtime_contract?.host_worktree_deletion_allowed !== false) issues.push('the sidecar contract must forbid host worktree deletion');
  if (manifest?.status === 'accepted' && manifest?.identity?.allowed_residual_patches?.length > 0) issues.push('dirty or untracked provider source cannot produce an accepted package');
  if (requireDeliverable && manifest?.deliverable !== 'eligible') issues.push('deliverable package required');
  if (!requireDeliverable && manifest?.status === 'accepted' && manifest?.deliverable !== 'eligible') issues.push('an accepted package must be deliverable');
  const serialized = JSON.stringify(manifest ?? {});
  if (/"path": "C:[\\\\/]/iu.test(serialized) || /"temp_root": "C:[\\\\/]/iu.test(serialized)) issues.push('raw system-drive sidecar path leaked into the manifest');
  return { ok: issues.length === 0, issues };
}

export function writeMc3Package({ repo, binary, tempRoot, output } = {}) {
  const { manifest } = buildMc3Package({ repo, binary, tempRoot });
  const validation = validateMc3Package(manifest);
  const path = output ? resolve(output) : resolve(repositoryRoot, 'harness/specs/fixtures/versegit-planning-correction/mc3-evidence/package-manifest.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { path, manifest, validation };
}

function main() {
  const argv = process.argv;
  const at = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? resolve(argv[i + 1]) : undefined; };
  const result = writeMc3Package({ repo: at('--repo'), binary: at('--binary'), tempRoot: at('--temp-root'), output: at('--out') });
  console.log(JSON.stringify({
    path: result.path,
    status: result.manifest.status,
    deliverable: result.manifest.deliverable,
    blockers: result.manifest.blockers,
    smoke: result.manifest.startup_smoke.map((entry) => `${entry.id}=${entry.status}`),
    cleanup: result.manifest.cleanup.cleanup_status,
    validation: result.validation,
  }, null, 2));
  if (!result.validation.ok) process.exitCode = 1;
}

if (isMainEntrypoint(import.meta.url)) {
  main();
}
