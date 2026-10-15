import { describe, expect, it } from 'vitest';
import { parseAciFrame, normalizeAciObservation } from './normalizer.js';
import type { Observation } from '../../../../shared/verseshell/types.js';

const handle = `result://sha256/${'a'.repeat(64)}`;
const descriptor = {
  handle,
  digest: `sha256:${'a'.repeat(64)}`,
  stream: 'stdout',
  raw_bytes: 100,
  retained_bytes: 60,
  omitted_bytes: 40,
  created_at: 1_000,
  expires_at: 10_000,
  owner: { workspace_id: 'ws', runtime_id: 'rt', process_id: 'p', request_id: 'r' },
  query: { modes: ['meta', 'head', 'tail'], max_bytes: 64 * 1024, max_tokens: 4_000, max_lines: 500, max_matches: 200 },
};

function observation(): Observation {
  return {
    schema: 'verseshell.observation/v1',
    id: 'r',
    op: 'exec.run',
    ok: true,
    status: 'ok',
    data: {
      stdout: { status: 'truncated', summary: 'tail', raw_bytes: 100, retained_bytes: 60, omitted_bytes: 40, truncated: true, artifact: handle },
      artifacts: [descriptor],
    },
    meta: { elapsed_ms: 1, profile: 'test', token_estimate: 1 },
  };
}

describe('VerseShell ACI normalizer', () => {
  it('keeps control frames out of observation correlation', () => {
    expect(parseAciFrame(JSON.stringify({ id: '__stats__', rss: 1 }), 1_000)).toMatchObject({ kind: 'control' });
    expect(parseAciFrame(JSON.stringify(observation()), 1_000)).toMatchObject({ kind: 'observation' });
  });

  it('projects bounded streams and artifact lineage without raw output', () => {
    const normalized = normalizeAciObservation(observation());
    expect(normalized.streams?.stdout).toMatchObject({ truncated: true, omitted_bytes: 40 });
    expect(normalized.artifacts?.[0]).toMatchObject({ handle, digest: descriptor.digest });
    expect(JSON.stringify(normalized.artifacts)).not.toContain('raw output');
  });

  it('fails closed on a malformed result handle', () => {
    expect(() => normalizeAciObservation({ ...observation(), data: { stdout: { artifact: 'result://sha256/not-valid' } } })).toThrow(/malformed/u);
  });
});
