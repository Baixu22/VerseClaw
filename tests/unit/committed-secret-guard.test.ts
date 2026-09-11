// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SEC-P1-01 regression guard for issue #36.
 *
 * A live DeepSeek API key was committed in three `tests/unit/runtime-memory-*.test.ts`
 * fixtures. The fixtures have been replaced with an explicit placeholder, but the fix
 * is only durable if the same class of mistake fails the suite instead of passing CI.
 *
 * Scope: git-tracked source files only. Untracked/ignored evidence artifacts (e.g.
 * `artifacts/**`) are out of scope for a committed-content guard; they are regenerated
 * from tracked inputs and are not published to the remote.
 *
 * Deliberately narrow: matches only the concrete key shapes this repo actually handles,
 * so ordinary prose and short fakes (e.g. `sk-abc123def456`) stay green.
 */
const rootDir = process.cwd();

type SecretPattern = {
  id: string;
  pattern: RegExp;
  description: string;
};

const SECRET_PATTERNS: SecretPattern[] = [
  {
    id: 'deepseek-key',
    // DeepSeek keys are `sk-` + 32 lowercase hex characters.
    pattern: /\bsk-([0-9a-f]{32})\b/g,
    description: 'DeepSeek API key (sk- + 32 hex chars)',
  },
  {
    id: 'openai-project-key',
    pattern: /\bsk-proj-([A-Za-z0-9_-]{20,})\b/g,
    description: 'OpenAI project API key',
  },
  {
    id: 'anthropic-key',
    pattern: /\bsk-ant-([A-Za-z0-9_-]{20,})\b/g,
    description: 'Anthropic API key',
  },
];

/** Placeholders that are allowed to look like keys — they carry no entropy. */
const ALLOWED_VALUES = new Set([
  'sk-TEST-PLACEHOLDER-DO-NOT-USE',
  'sk-PLACEHOLDER',
  'sk-REDACTED',
]);

/**
 * The repo legitimately contains synthetic keys: redaction and error-message
 * fixtures need strings that *look* like provider keys. Those are hand-authored
 * ordered runs, repeated blocks, or literal "fake"/"test" spellings. A real key
 * is random, so it matches none of these shapes.
 */
function isSyntheticBody(body: string): boolean {
  if (body.length === 0) return true;
  const lower = body.toLowerCase();
  if (/(fake|dummy|placeholder|redacted|example|sample|xxx|todo|changeme|not-?real|test)/.test(lower)) {
    return true;
  }
  // Short-period repetition, e.g. `abcdef1234567890abcdef1234567890`.
  for (let period = 1; period <= Math.floor(body.length / 2); period++) {
    if (body.length % period !== 0) continue;
    const unit = body.slice(0, period);
    if (unit.repeat(body.length / period) === body) return true;
  }
  // Ordered runs, e.g. `1234567890abcdefgh` or `abcdefghijklmnopqrstuvwxyz`.
  let sequential = 1;
  for (let i = 1; i < body.length; i++) {
    if (body.charCodeAt(i) - body.charCodeAt(i - 1) === 1) sequential++;
  }
  if (sequential / body.length >= 0.7) return true;
  return false;
}

/** Directories that are tracked but contain vendored or generated content. */
const SKIP_PREFIXES = [
  'node_modules/',
  'dist/',
  'dist-electron/',
  'openclaw_runtime/node_modules/',
];

const SCANNED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
  '.json', '.jsonc', '.md', '.yml', '.yaml', '.toml',
  '.sh', '.bash', '.ps1', '.env', '.ini', '.cfg', '.conf',
]);

function trackedFiles(): string[] {
  const stdout = execFileSync('git', ['ls-files', '-z'], {
    cwd: rootDir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout
    .split('\0')
    .filter(Boolean)
    .filter((file) => !SKIP_PREFIXES.some((prefix) => file.startsWith(prefix)))
    .filter((file) => {
      const dot = file.lastIndexOf('.');
      if (dot === -1) return false;
      return SCANNED_EXTENSIONS.has(file.slice(dot));
    });
}

type Finding = { file: string; patternId: string; value: string };

function scanForSecrets(): Finding[] {
  const findings: Finding[] = [];
  for (const file of trackedFiles()) {
    let content: string;
    try {
      content = readFileSync(join(rootDir, file), 'utf8');
    } catch {
      continue; // unreadable / binary — nothing meaningful to assert on.
    }
    for (const { id, pattern } of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      for (const match of content.matchAll(pattern)) {
        const value = match[0];
        if (ALLOWED_VALUES.has(value)) continue;
        if (isSyntheticBody(match[1] ?? '')) continue;
        findings.push({ file, patternId: id, value });
      }
    }
  }
  return findings;
}

describe('SEC-P1-01 committed secret guard (issue #36)', () => {
  it('matches the key shape that leaked in #36, so the guard is not vacuous', () => {
    const deepseek = SECRET_PATTERNS.find((p) => p.id === 'deepseek-key')!;
    // Same 32-hex shape as the key leaked in #36, but synthetic (repeating
    // `deadbeef`) — the real key must not appear anywhere in tracked files.
    const canary = 'objectSummary: "User API key is sk-deadbeefdeadbeefdeadbeefdeadbeef"';
    expect([...canary.matchAll(deepseek.pattern)].map((m) => m[0])).toHaveLength(1);
  });

  it('treats the documented placeholder as non-secret', () => {
    const canary = 'objectSummary: "User API key is sk-TEST-PLACEHOLDER-DO-NOT-USE"';
    for (const { pattern } of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      expect([...canary.matchAll(pattern)]).toEqual([]);
    }
  });

  it('does not flag the short non-hex fake used by existing fixtures', () => {
    const canary = 'DEEPSEEK_API_KEY=sk-abc123def456';
    for (const { pattern } of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      expect([...canary.matchAll(pattern)]).toEqual([]);
    }
  });

  it('finds no provider API keys in tracked source files', () => {
    const findings = scanForSecrets();
    // Redact the matched value before reporting: the failure output must not become
    // a second copy of the secret in CI logs.
    const redacted = findings.map(({ file, patternId, value }) => ({
      file,
      patternId,
      value: `${value.slice(0, 7)}…${value.length - 7} chars redacted`,
    }));
    expect(redacted).toEqual([]);
  });
});
