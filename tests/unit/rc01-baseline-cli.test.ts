// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const baselinePath = 'artifacts/runtime-authority-convergence/rc-01/baseline.json';
const generator = 'scripts/rc01-authority-inventory.mjs';
const validator = 'scripts/rc01-baseline-validate.mjs';
const template = JSON.parse(readFileSync(join(repoRoot, baselinePath), 'utf8'));
let scratch: string;
let fixture: string;
let acceptedBase: string;
let baselineBytes: Buffer;

function git(args: string[], root = fixture) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
}

function write(relativePath: string, content: string) {
  const path = join(fixture, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function run(script: string, args: string[] = [], root = fixture) {
  const result = spawnSync(process.execPath, [join(root, script), ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 15_000,
  });
  expect(result.error).toBeUndefined();
  return result;
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'clawx-rc01-cli-'));
  fixture = join(scratch, 'candidate');
  mkdirSync(fixture);
  for (const authority of Object.values<Record<string, unknown>>(template.authorities)) {
    for (const field of ['writers', 'nonOwners', 'legacyWriters', 'candidates']) {
      const entries = authority[field];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (typeof entry?.path !== 'string') continue;
        write(entry.path.replace(/\/\*\*$/, '/owner.ts').replace(/\/$/, '/owner.ts'), '// owner fixture\n');
      }
    }
  }
  for (const path of [generator, validator, 'scripts/lib/rc01-receipt-contract.mjs', 'package.json', 'openclaw_runtime/package.json']) {
    write(path, readFileSync(join(repoRoot, path), 'utf8'));
  }
  git(['init', '--quiet']);
  git(['config', 'user.name', 'RC01 fixture']);
  git(['config', 'user.email', 'rc01@example.invalid']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'core.autocrlf', 'false']);
  git(['add', '.']);
  git(['commit', '--quiet', '-m', 'accepted base']);
  acceptedBase = git(['rev-parse', 'HEAD']);
  const baseline = {
    ...template,
    acceptedBaseSha: acceptedBase,
    generatedAt: new Date(Number(git(['show', '-s', '--format=%ct', acceptedBase])) * 1000).toISOString(),
  };
  baselineBytes = Buffer.from(`${JSON.stringify(baseline, null, 2)}\n`);
  write(baselinePath, baselineBytes.toString());
  git(['add', '.']);
  git(['commit', '--quiet', '-m', 'candidate baseline']);
});

beforeEach(() => {
  writeFileSync(join(fixture, baselinePath), baselineBytes);
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
});

afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

describe('RC-01 baseline CLI input contract', () => {
  it('uses the explicit ancestor, independently of remote refs, and regenerates identical bytes', () => {
    git(['update-ref', '-d', 'refs/remotes/origin/main']);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = run(generator, ['--accepted-base', acceptedBase]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(`acceptedBaseSha=${acceptedBase}`);
      expect(readFileSync(join(fixture, baselinePath))).toEqual(baselineBytes);
    }
    const validation = run(validator);
    expect(validation.status, validation.stderr).toBe(0);
    expect(validation.stdout).toContain('classified=41 modules=16/16');
  });

  it.each([
    ['missing base', []],
    ['empty base', ['--accepted-base=']],
    ['missing value', ['--accepted-base']],
    ['unknown commit', ['--accepted-base', 'does-not-exist']],
    ['non-commit object', ['--accepted-base', 'HEAD:package.json']],
    ['unknown option', ['--accepted-bsae', 'HEAD']],
  ])('rejects %s without replacing the baseline', (_name, args) => {
    const result = run(generator, args);
    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toBe('');
    expect(readFileSync(join(fixture, baselinePath))).toEqual(baselineBytes);
  });

  it('rejects a valid commit that is not an ancestor of the candidate', () => {
    const unrelated = git(['commit-tree', 'HEAD^{tree}', '-m', 'unrelated root']);
    const result = run(generator, ['--accepted-base', unrelated]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/ancestor/);
    expect(readFileSync(join(fixture, baselinePath))).toEqual(baselineBytes);
  });

  it('runs both commands from paths with spaces, CJK and URL-reserved characters', () => {
    const encodedRoot = join(scratch, 'checkout 空格 #%');
    cpSync(fixture, encodedRoot, { recursive: true });
    const generated = run(generator, ['--accepted-base', acceptedBase], encodedRoot);
    expect(generated.status, generated.stderr).toBe(0);
    expect(readFileSync(join(encodedRoot, baselinePath))).toEqual(baselineBytes);
    const validated = run(validator, [], encodedRoot);
    expect(validated.status, validated.stderr).toBe(0);
    expect(validated.stdout).toContain('RC-01 baseline validation PASSED');
  });

  it('rejects an owner file present only in the working tree', () => {
    const owner = 'openclaw_runtime/src/plugins/slots.ts';
    git(['update-index', '--force-remove', owner]);
    try {
      for (const result of [run(generator, ['--accepted-base', acceptedBase]), run(validator)]) {
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(owner);
        expect(readFileSync(join(fixture, baselinePath))).toEqual(baselineBytes);
      }
    } finally {
      git(['add', owner]);
    }
  });

  it('rejects a tracked owner whose file is absent', () => {
    const owner = 'openclaw_runtime/src/plugins/slots.ts';
    const original = readFileSync(join(fixture, owner));
    unlinkSync(join(fixture, owner));
    try {
      for (const result of [run(generator, ['--accepted-base', acceptedBase]), run(validator)]) {
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(owner);
        expect(readFileSync(join(fixture, baselinePath))).toEqual(baselineBytes);
      }
    } finally {
      writeFileSync(join(fixture, owner), original);
    }
  });

  it.each(['openclaw_runtime/package.json', 'package.json'])('rejects missing version metadata in %s', (path) => {
    const original = readFileSync(join(fixture, path));
    write(path, '{}');
    try {
      for (const result of [run(generator, ['--accepted-base', acceptedBase]), run(validator)]) {
        expect(result.status).not.toBe(0);
        expect(result.stderr).not.toBe('');
        expect(readFileSync(join(fixture, baselinePath))).toEqual(baselineBytes);
      }
    } finally {
      writeFileSync(join(fixture, path), original);
    }
  });

  it.each(['generatedAt', 'sourceRuntimeVersion', 'npmRuntimeVersion'])('rejects altered %s evidence', (field) => {
    const baseline = JSON.parse(baselineBytes.toString());
    baseline[field] = field === 'generatedAt'
      ? '2000-01-01T00:00:00.000Z'
      : { ...baseline[field], version: '0.0.0', spec: '0.0.0' };
    write(baselinePath, JSON.stringify(baseline));
    const result = run(validator);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(field);
  });

  it.each(['path', 'classification'])('rejects an invalid writer %s', (field) => {
    const baseline = JSON.parse(baselineBytes.toString());
    baseline.authorities.run.writers[0][field] = field === 'path' ? '' : 'unknown';
    write(baselinePath, JSON.stringify(baseline));
    const result = run(validator);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/owner path|classification/);
  });

  it.each(['selectedOwner', 'logicalOwner', 'physicalOwner', 'tableName'])('rejects mismatched receipt authority %s', (field) => {
    const baseline = JSON.parse(baselineBytes.toString());
    baseline.authorities.receipt[field] = 'unapproved sidecar';
    write(baselinePath, JSON.stringify(baseline));
    const result = run(validator);
    expect(result.status, result.stdout).toBe(1);
    expect(result.stderr).toContain(`authorities.receipt.${field}`);
  });

  it.each([1, 2, 3, 4, 5, 6, 7])('rejects waived receipt hard constraint %i', (number) => {
    const baseline = JSON.parse(baselineBytes.toString());
    baseline.authorities.receipt.hardConstraints[number - 1] = `${number}. waived in this baseline`;
    write(baselinePath, JSON.stringify(baseline));
    const result = run(validator);
    expect(result.status, result.stdout).toBe(1);
    expect(result.stderr).toContain('hard constraint');
  });

  it('rejects duplicate constraints used to pad the required count', () => {
    const baseline = JSON.parse(baselineBytes.toString());
    baseline.authorities.receipt.hardConstraints[6] = baseline.authorities.receipt.hardConstraints[0];
    write(baselinePath, JSON.stringify(baseline));
    const result = run(validator);
    expect(result.status, result.stdout).toBe(1);
    expect(result.stderr).toContain('hard constraint');
  });

  it('rejects a negated constraint even when its keywords remain present', () => {
    const baseline = JSON.parse(baselineBytes.toString());
    baseline.authorities.receipt.hardConstraints[1] += '; this requirement is waived';
    write(baselinePath, JSON.stringify(baseline));
    const result = run(validator);
    expect(result.status, result.stdout).toBe(1);
    expect(result.stderr).toContain('hard constraint');
  });
});
