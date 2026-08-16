import { describe, expect, it } from 'vitest';
import {
  VERSESHELL_OBSERVATION_SCHEMA,
  VerseShellContractError,
  decodeArtifactDescriptor,
  decodeResultQueryRequest,
  decodeStreamCapture,
  extractArtifactDescriptors,
  type Observation,
} from '@shared/verseshell';

const digest = `sha256:${'a'.repeat(64)}`;
const handle = `result://sha256/${'a'.repeat(64)}`;
const owner = {
  workspace_id: 'ws-1',
  runtime_id: 'runtime-1',
  process_id: 'process-1',
  request_id: 'request-1',
};

function descriptor(overrides: Record<string, unknown> = {}) {
  return {
    handle,
    digest,
    stream: 'stdout',
    raw_bytes: 100,
    retained_bytes: 60,
    omitted_bytes: 40,
    created_at: 1_000,
    expires_at: 10_000,
    owner,
    query: {
      modes: ['meta', 'head', 'tail', 'slice', 'grep', 'raw'],
      max_bytes: 64 * 1024,
      max_tokens: 4_000,
      max_lines: 500,
      max_matches: 200,
    },
    ...overrides,
  };
}

function observation(data: unknown): Observation {
  return {
    schema: VERSESHELL_OBSERVATION_SCHEMA,
    id: 'request-1',
    op: 'exec.run',
    ok: true,
    data: data as Observation['data'],
    meta: { elapsed_ms: 1, profile: 'test', token_estimate: 1 },
  };
}

describe('VerseShell bounded observation and artifact contract', () => {
  it('validates lineage, digest, byte accounting, expiry, and ownership', () => {
    expect(decodeArtifactDescriptor(descriptor(), { now_ms: 2_000, expected_owner: owner })).toMatchObject({ handle, digest });
    expect(() => decodeArtifactDescriptor(descriptor({ digest: `sha256:${'b'.repeat(64)}` }))).toThrowError(VerseShellContractError);
    expect(() => decodeArtifactDescriptor(descriptor({ omitted_bytes: 1 }))).toThrow(/retained_bytes/u);
    expect(() => decodeArtifactDescriptor(descriptor(), { now_ms: 10_000 })).toThrow(/expired/u);
    expect(() => decodeArtifactDescriptor(descriptor(), { expected_owner: { process_id: 'other' } })).toThrow(/owner/u);
  });

  it('requires explicit truncation and omitted-byte evidence for streams', () => {
    expect(decodeStreamCapture({
      status: 'truncated',
      text: 'tail',
      raw_bytes: 100,
      retained_bytes: 60,
      omitted_bytes: 40,
      truncated: true,
      artifact: handle,
    })).toMatchObject({ truncated: true, omitted_bytes: 40, artifact: handle });
    expect(() => decodeStreamCapture({
      status: 'complete', raw_bytes: 10, retained_bytes: 5, omitted_bytes: 5, truncated: false,
    })).toThrow(/truncated flag/u);
  });

  it('bounds all result query modes before transport', () => {
    expect(decodeResultQueryRequest({ handle, mode: 'slice', start_line: 1, end_line: 3 })).toMatchObject({ mode: 'slice' });
    expect(() => decodeResultQueryRequest({ handle, mode: 'raw', max_bytes: 64 * 1024 + 1 })).toThrow(/exceeds/u);
    expect(() => decodeResultQueryRequest({ handle, mode: 'grep', pattern: 'x'.repeat(501) })).toThrow(/pattern/u);
    expect(() => decodeResultQueryRequest({ handle, mode: 'slice', start_line: 4, end_line: 2 })).toThrow(/end_line/u);
    expect(() => decodeResultQueryRequest({ handle: 'result://sha256/nope', mode: 'head' })).toThrow(/handle/u);
  });

  it('extracts descriptors without exposing raw output', () => {
    const result = extractArtifactDescriptors(observation({ artifacts: [descriptor()] }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ handle, omitted_bytes: 40 });
    expect(JSON.stringify(result)).not.toContain('secret-output');
  });
});
