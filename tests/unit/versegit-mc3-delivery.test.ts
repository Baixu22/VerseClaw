import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertNonSystemDrive, launchSidecar, packageTempRoot, sha256, validateMc3Package, verifyPackageIdentity, MC3_SCHEMA,
} from '../../scripts/versegit-mc3-delivery.mjs';

const tempRoots: string[] = [];
function temp() {
  const dir = mkdtempSync(join(packageTempRoot(), 'versegit-mc3-test-'));
  tempRoots.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempRoots.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
});

function manifestFixture() {
  const hex64 = 'a'.repeat(64);
  const hex40 = 'b'.repeat(40);
  const smoke = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, status, host_verdict: 'unchanged', ...extra });
  return {
    packageSchema: MC3_SCHEMA,
    identity: {
      effective_source_commit: hex40, source_tree_digest: hex40, allowed_residual_patches: [],
      build_recipe_digest: hex64, lockfile_digest: hex64, platform: 'win32-x64', binary_sha256: hex64,
      capabilities_digest: hex64, capabilities_schema: 'versegit.capabilities/v1', contract_digest: hex64,
      golden_bundle_digest: hex64, capability_matrix_digest: hex64,
    },
    identity_required_fields: [],
    package_contents: [],
    forbidden_contents: ['source_tree', 'git_directory', 'build_output_directory', 'task_forest', 'private_evidence'].map((name) => ({ name, copied_into_clawx: false })),
    installation: {
      digest_addressed: true, mutable_checkout_path_consumed: false, no_system_drive_artifacts: true,
      path: 'D:/ClawX-sidecar/versegit/aaaaaaaaaaaaaaaa/vg.exe', temp_root: 'D:/tmp',
    },
    startup_smoke: [
      smoke('startup_version', 'observed', { exit_code: 0, duration_ms: 12 }),
      smoke('startup_capabilities', 'observed', { exit_code: 0, duration_ms: 40 }),
      smoke('startup_doctor_outside_workspace', 'degraded', { exit_code: 1 }),
      smoke('startup_timeout_budget', 'degraded', { duration_ms: 1_001, reason: 'startup_timeout' }),
      smoke('startup_kill_switch', 'observed', { survivors: 0, reason: 'kill_switch_completed' }),
      smoke('startup_missing_binary', 'unavailable', { survivors: 0, reason: 'binary_missing' }),
      smoke('identity_gate_match', 'verified', { mismatches: [] }),
      smoke('identity_gate_digest_mismatch', 'rejected_by_policy', { mismatches: ['binary_sha256'] }),
    ],
    runtime_contract: { host_worktree_deletion_allowed: false },
    cleanup: { cleanup_status: 'clean', host_worktrees_deleted: 0, fixture_survivors: 0, sidecar_process_survivors: 0 },
    boundaries: {
      vg_source_tree_copied: false, vg_git_directory_copied: false, vg_build_outputs_copied: false,
      vg_task_forest_copied: false, vg_private_evidence_copied: false, user_repository_mutated: false,
      provider_state_created_in_user_repo: false, land_or_admit_invoked: false,
    },
    status: 'rejected',
    deliverable: 'rejected',
    blockers: ['release_binary_not_built'],
  };
}

describe('MC3 sidecar delivery contract', () => {
  it('refuses a system-drive install or temp root', () => {
    expect(assertNonSystemDrive('C:/Users/x/sidecar', 'win32').ok).toBe(false);
    expect(assertNonSystemDrive('D:/ClawX-sidecar/versegit', 'win32')).toMatchObject({ ok: true, drive: 'D:' });
    expect(assertNonSystemDrive('/srv/sidecar', 'linux').ok).toBe(true);
  });

  it('treats a missing binary as unavailable without touching the host verdict', () => {
    const result = launchSidecar({ binary: join(temp(), 'absent', 'vg.exe'), args: ['--version'] });
    expect(result.status).toBe('unavailable');
    expect(result.host_verdict).toBe('unchanged');
    expect(result.module_state).toBe('discovered_failed');
    expect(result.reason).toBe('binary_missing');
  });

  it('bounds a hung sidecar with the startup timeout budget', () => {
    const dir = temp();
    const hang = join(dir, 'hang.cjs');
    writeFileSync(hang, 'setTimeout(() => {}, 60000);\n', 'utf8');
    const result = launchSidecar({ binary: process.execPath, args: [hang], cwd: dir, timeoutMs: 1_500 });
    expect(result.status).toBe('degraded');
    expect(result.reason).toBe('startup_timeout');
    expect(result.duration_ms).toBeLessThan(10_000);
  });

  it('kills a live sidecar and leaves no survivor behind', () => {
    const dir = temp();
    const live = join(dir, 'live.cjs');
    writeFileSync(live, 'setInterval(() => {}, 100);\n', 'utf8');
    const result = launchSidecar({ binary: process.execPath, args: [live], cwd: dir, timeoutMs: 20_000, killAfterMs: 400 });
    expect(result.survivors).toBe(0);
    expect(result.status).toBe('observed');
    expect(result.module_state).toBe('detached');
  });

  it('rejects a package whose digest identity does not match the frozen baseline', () => {
    expect(verifyPackageIdentity({ identity: { binary_sha256: 'a'.repeat(64), effective_source_commit: 'b'.repeat(40), capabilities_digest: 'c'.repeat(64) }, expectedBinarySha: 'a'.repeat(64), expectedSourceCommit: 'b'.repeat(40) }).status).toBe('verified');
    const rejected = verifyPackageIdentity({ identity: { binary_sha256: 'a'.repeat(64), effective_source_commit: 'b'.repeat(40), capabilities_digest: 'c'.repeat(64) }, expectedBinarySha: 'f'.repeat(64), expectedSourceCommit: 'b'.repeat(40) });
    expect(rejected.status).toBe('rejected_by_policy');
    expect(rejected.mismatches).toContain('binary_sha256');
    expect(rejected.host_verdict).toBe('unchanged');
  });

  it('accepts a well-formed rejected package and refuses a copied source tree', () => {
    expect(validateMc3Package(manifestFixture()).issues).toEqual([]);
    const leaked = manifestFixture();
    leaked.boundaries.vg_source_tree_copied = true;
    expect(validateMc3Package(leaked).issues).toContain('boundary vg_source_tree_copied must be false');
    const dirty = manifestFixture();
    dirty.status = 'accepted';
    dirty.identity.allowed_residual_patches = ['?? leftover'];
    expect(validateMc3Package(dirty).issues).toContain('dirty or untracked provider source cannot produce an accepted package');
    const onC = manifestFixture();
    onC.installation.path = 'C:/Windows/sidecar/vg.exe';
    onC.installation.no_system_drive_artifacts = false;
    expect(validateMc3Package(onC).issues).toContain('sidecar install and temp roots must avoid the system drive');
  });

  it('requires the digest gate and kill switch to be proven, not declared', () => {
    const mutated = manifestFixture();
    mutated.startup_smoke = mutated.startup_smoke.filter((entry: any) => entry.id !== 'startup_kill_switch');
    mutated.cleanup = { ...mutated.cleanup, cleanup_status: 'recovery_required' };
    const result = validateMc3Package(mutated);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'missing startup smoke startup_kill_switch',
      'the kill switch must leave no surviving sidecar process',
      'cleanup must be clean',
    ]));
  });

  it('hashes identity deterministically', () => {
    expect(sha256('versegit')).toBe(sha256('versegit'));
    expect(sha256('versegit')).not.toBe(sha256('versegiu'));
    mkdirSync(temp(), { recursive: true });
  });
});
