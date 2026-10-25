import { describe, expect, it } from 'vitest';
import {
  classifyStderr, normalizeCapture, shapeOf, validateMc2Fingerprint, sha256, MC2_SCHEMA,
} from '../../scripts/versegit-mc2-fingerprint.mjs';

const ROOT = 'C:/Users/Someone/AppData/Local/Temp/versegit-mc2-abc123';

function fingerprintFixture(overrides: Record<string, any> = {}) {
  const roles = ['identity', 'health', 'behavior', 'positive', 'negative_control', 'error'];
  const silentDigests = new Set(['negative_control_silent_before_peer_write', 'negative_control_unrelated_symbol_silent', 'negative_control_own_write_not_cross_session', 'negative_control_ended_session_stops_conflicting']);
  const cases: any[] = [];
  for (const role of roles) {
    for (let index = 0; index < 6; index += 1) {
      const id = role === 'positive' ? 'positive_stale_read_producer_consumer' : (role === 'negative_control' ? ['negative_control_silent_before_peer_write', 'negative_control_unrelated_symbol_silent', 'negative_control_own_write_not_cross_session', 'negative_control_ended_session_stops_conflicting', 'negative_control_sibling_worktree_not_verified', 'negative_control_extra'][index] : `${role}-${index}`);
      const assertion = role === 'positive'
        ? { advisory_kinds: ['ssi/stale-read'] }
        : silentDigests.has(id) ? { advisory_kinds: [] }
          : id === 'negative_control_sibling_worktree_not_verified' ? { verdict: 'UNVERIFIED' } : undefined;
      cases.push({
        id, role, purpose: `${role} case`, argv: ['vg', role], status: 'observed', exit_code: 0,
        stdout_kind: 'json_object', normalized_stdout: { ok: true }, normalized_stderr: '', stderr_class: 'none',
        output_shape: shapeOf({ ok: true }), output_digest: sha256(JSON.stringify({ role, index })),
        ...(assertion ? { assertion } : {}),
      });
    }
  }
  for (const [id, role, assertion] of [
    ['health_verify_status_unverified', 'health', { verdict: 'UNVERIFIED' }],
    ['health_verify_registry_empty', 'health', { registered_checks: 0 }],
    ['behavior_verify_run_then_status', 'behavior', { verdict: 'VERIFIED' }],
  ] as const) {
    cases.push({
      id, role, purpose: id, argv: [], status: 'observed', exit_code: 0, stdout_kind: 'json_object',
      normalized_stdout: assertion, normalized_stderr: '', stderr_class: 'none',
      output_shape: shapeOf(assertion), output_digest: sha256(id), assertion,
    });
  }
  const hex64 = 'a'.repeat(64);
  const base = {
    fingerprintSchema: MC2_SCHEMA,
    identity: {
      binary_sha256: hex64, matches_mc0: true, mc0_source_head: 'b'.repeat(40), mc0_binary_sha256: hex64,
      capabilities_schema: 'versegit.capabilities/v1',
    },
    fixture: {
      created_outside_repos: true, temp_root_placeholder: '<temp_root>', base_content_sha256: sha256('base'),
      signature_change_sha256: sha256('sig'), body_change_sha256: sha256('body'),
    },
    cases,
    cleanup: { cleanup_status: 'clean', survivors: 0, host_worktrees_deleted: 0, evidence_retained: true },
    boundaries: {
      vg_source_tree_copied: false, user_repository_mutated: false, fixture_only_execution: true,
      land_or_admit_invoked: false, deliverable: 'rejected',
    },
  };
  return { ...base, ...overrides };
}

describe('MC2 behavior fingerprint helpers', () => {
  it('classifies VG stderr into stable error classes', () => {
    expect(classifyStderr('vg: 会话不存在: missing')).toBe('session_not_found');
    expect(classifyStderr('vg: 未找到工作区：从 C 向上未发现 .vg/')).toBe('workspace_not_found');
    expect(classifyStderr('error: the following required arguments were not provided')).toBe('usage_error');
    expect(classifyStderr('')).toBe('none');
    expect(classifyStderr('boom')).toBe('error');
  });

  it('normalizes volatile JSON so re-runs hash identically', () => {
    const a = normalizeCapture({
      stdout: JSON.stringify({ session_id: '11111111-2222-3333-4444-555555555555', tree_oid: `c${'0'.repeat(39)}`, run_at: '2026-10-21T00:00:00+00:00' }),
      stderr: `failed under ${ROOT}`, code: 0,
    }, [ROOT]);
    const b = normalizeCapture({
      stdout: JSON.stringify({ session_id: '99999999-8888-7777-6666-555555555555', tree_oid: `d${'0'.repeat(39)}`, run_at: '2026-10-22T09:09:09+00:00' }),
      stderr: `failed under ${ROOT}`, code: 0,
    }, [ROOT]);
    expect(a.output_digest).toBe(b.output_digest);
    expect(a.normalized_stderr).toBe('failed under <temp_root>');
    expect(JSON.stringify(a.normalized_stdout)).not.toMatch(/11111111-2222/);
  });

  it('accepts a well-formed fingerprint', () => {
    expect(validateMc2Fingerprint(fingerprintFixture()).issues).toEqual([]);
  });

  it('rejects a raw identifier leak', () => {
    const leaked = fingerprintFixture();
    leaked.cases[0].normalized_stdout = { focus: '11111111-2222-3333-4444-555555555555' };
    const result = validateMc2Fingerprint(leaked);
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('raw uuid leaked into the fingerprint');
  });

  it('rejects a raw absolute path leak', () => {
    const leaked = fingerprintFixture();
    leaked.cases[0].purpose = 'ran in C:/Users/Someone/secrets';
    const result = validateMc2Fingerprint(leaked);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue: string) => issue.startsWith('raw absolute path leaked'))).toBe(true);
  });

  it('rejects a silent positive control', () => {
    const mutated = fingerprintFixture();
    mutated.cases = mutated.cases.map((entry: any) => (entry.id === 'positive_stale_read_producer_consumer' ? { ...entry, assertion: { advisory_kinds: [] } } : entry));
    const result = validateMc2Fingerprint(mutated);
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('producer-consumer stale-read positive control did not fire');
  });

  it('rejects binary drift from the frozen MC0 identity', () => {
    const mutated = fingerprintFixture();
    mutated.identity.mc0_binary_sha256 = 'f'.repeat(64);
    const result = validateMc2Fingerprint(mutated);
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('fingerprint binary differs from the MC0 frozen binary');
  });

  it('rejects a dirty fixture', () => {
    const mutated = fingerprintFixture();
    mutated.cleanup = { ...mutated.cleanup, cleanup_status: 'recovery_required', survivors: 1 };
    const result = validateMc2Fingerprint(mutated);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining(['cleanup must be clean', 'cleanup survivors must be zero']));
  });
});
