import { describe, expect, it } from 'vitest';
import {
  VERSESHELL_OBSERVATION_SCHEMA,
  extractApprovalRequest,
  extractArtifactHandles,
  isArtifactHandle,
  parseArtifactHandle,
  redactApprovalSecrets,
  type Observation,
} from '@shared/verseshell';

const handleA = `result://sha256/${'a'.repeat(64)}`;
const handleB = `result://sha256/${'b'.repeat(64)}`;

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    schema: VERSESHELL_OBSERVATION_SCHEMA,
    id: 'r1',
    op: 'exec.run',
    ok: false,
    status: 'failed',
    data: {
      stdout: { artifact: handleA },
      stderr: { artifact: handleB },
      duplicate: handleA,
    },
    error: { code: 'E_PROCESS_EXIT', message: 'failed', recoverable: true },
    meta: { elapsed_ms: 1, profile: 'cargo', token_estimate: 4 },
    suggested_next: [{ op: 'result.query', args: { handle: handleB, mode: 'tail' } }],
    ...overrides,
  };
}

describe('VerseShell artifact and approval extraction', () => {
  it('validates and extracts unique result artifact handles', () => {
    expect(isArtifactHandle(handleA)).toBe(true);
    expect(parseArtifactHandle(handleA)).toBe(handleA);
    expect(isArtifactHandle(`result://sha256/${'A'.repeat(64)}`)).toBe(false);
    expect(() => parseArtifactHandle('res_abc')).toThrow(/artifact handle/u);
    expect(extractArtifactHandles(observation())).toEqual([handleA, handleB]);
  });

  it('fails closed when result:// content resembles a malformed handle', () => {
    expect(() =>
      extractArtifactHandles(
        observation({ data: { stdout: { artifact: 'result://sha256/not-a-digest' } } }),
      ),
    ).toThrow(/malformed result artifact handle/u);
  });

  it('extracts only structurally valid E_NEEDS_APPROVAL data', () => {
    const approval = observation({
      data: {
        approval_token: 'apv_0123456789abcdef',
        what: 'exec',
        builtin: 'exec.run',
        reversible: false,
      },
      error: {
        code: 'E_NEEDS_APPROVAL',
        message: 'approval required',
        recoverable: true,
        hint: 're-run with AETHER_APPROVE=apv_0123456789abcdef',
      },
    });
    expect(extractApprovalRequest(approval)).toEqual({
      approval_token: 'apv_0123456789abcdef',
      what: 'exec',
      builtin: 'exec.run',
      reversible: false,
    });
    expect(extractApprovalRequest(observation())).toBeUndefined();
    expect(() =>
      extractApprovalRequest(
        observation({
          data: { approval_token: 'approve-me', what: 'exec', builtin: 'exec.run', reversible: false },
          error: { code: 'E_NEEDS_APPROVAL', message: 'approval', recoverable: true },
        }),
      ),
    ).toThrow(/approval_token is malformed/u);
  });

  it('redacts approval tokens in logging clones without mutating retry data', () => {
    const original = observation({
      data: {
        approval_token: 'apv_0123456789abcdef',
        token: 'apv_fedcba9876543210',
        nested: ['apv_aaaaaaaaaaaaaaaa', 'safe'],
        what: 'exec',
        builtin: 'exec.run',
        reversible: false,
      },
      error: {
        code: 'E_NEEDS_APPROVAL',
        message: 'approval required',
        recoverable: true,
        hint: 'AETHER_APPROVE=apv_0123456789abcdef',
      },
    });
    const redacted = redactApprovalSecrets(original);
    expect(JSON.stringify(redacted)).not.toContain('apv_');
    expect(JSON.stringify(redacted)).toContain('[REDACTED_APPROVAL_TOKEN]');
    expect(JSON.stringify(original)).toContain('apv_0123456789abcdef');
  });
});
