import { describe, expect, it } from 'vitest';
import {
  findSecretRanges,
  redactSecretShapes,
  secretSignature,
  summarizeSecretRanges,
} from '@shared/privacy/secret-shapes';

describe('findSecretRanges', () => {
  it('detects each shape kind', () => {
    const cases: Array<[string, string]> = [
      ['sk-' + 'a'.repeat(24), 'openai-key'],
      ['sk-proj-' + 'a'.repeat(24), 'openai-project-key'],
      ['sk-ant-' + 'a'.repeat(24), 'anthropic-key'],
      ['Bearer ' + 'x'.repeat(20), 'bearer-token'],
      ['CLAWX_CANARY_abcdef123', 'canary'],
      ['OPENCLAW_CANARY_abcdef123', 'canary'],
      ['ghp_' + 'A'.repeat(20), 'github-token'],
      ['github_pat_' + 'A'.repeat(22), 'github-token'],
      ['xoxb-' + '1'.repeat(12), 'slack-token'],
      ['AKIA' + '0'.repeat(16), 'aws-access-key-id'],
      ['-----BEGIN PRIVATE KEY-----', 'private-key-block'],
      ['-----BEGIN RSA PRIVATE KEY-----', 'private-key-block'],
    ];
    for (const [text, kind] of cases) {
      const ranges = findSecretRanges(text);
      expect(ranges, text).toHaveLength(1);
      expect(ranges[0].kind, text).toBe(kind);
      expect(text.slice(ranges[0].start, ranges[0].end)).toBe(text);
    }
  });

  it('does not flag benign text', () => {
    const benign = [
      'skill token',
      'sk-short',
      'sk-' + 'a'.repeat(10),
      'version 1.0.0-sk',
      'Bearer',
      'AKIA123',
      'ghp_short',
      '-----BEGIN CERTIFICATE-----',
      'no secrets here',
    ];
    for (const text of benign) {
      expect(findSecretRanges(text), text).toHaveLength(0);
    }
  });

  it('resolves overlaps preferring the longer earlier match', () => {
    const text = 'sk-proj-' + 'a'.repeat(24);
    const ranges = findSecretRanges(text);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].kind).toBe('openai-project-key');
  });

  it('sorts multiple matches and caps results at 100 by default', () => {
    const key = 'sk-' + 'b'.repeat(24);
    const text = Array.from({ length: 150 }, () => key).join(' ');
    const ranges = findSecretRanges(text);
    expect(ranges).toHaveLength(100);
    for (let i = 1; i < ranges.length; i += 1) {
      expect(ranges[i].start).toBeGreaterThan(ranges[i - 1].start);
    }
  });

  it('summarizes kinds and builds a stable signature', () => {
    const ranges = findSecretRanges('sk-' + 'c'.repeat(24) + ' and ghp_' + 'd'.repeat(20));
    const summary = summarizeSecretRanges(ranges);
    expect(summary.count).toBe(2);
    expect(summary.kinds).toEqual(['github-token', 'openai-key']);
    expect(secretSignature(summary)).toBe('github-token,openai-key:2');
  });
});

describe('redactSecretShapes', () => {
  it('keeps the historical sanitize replacement behavior', () => {
    expect(redactSecretShapes('key sk-' + 'a'.repeat(24))).toBe('key sk-[REDACTED]');
    expect(redactSecretShapes('Bearer ' + 't'.repeat(16))).toBe('Bearer [REDACTED]');
    expect(redactSecretShapes('CLAWX_CANARY_abc123')).toBe('[REDACTED_CANARY]');
    expect(redactSecretShapes('sk-proj-' + 'z'.repeat(20))).toBe('sk-proj-[REDACTED]');
    expect(redactSecretShapes('nothing here')).toBe('nothing here');
  });
});
