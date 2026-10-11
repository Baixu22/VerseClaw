import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  POLICY_PATHS,
  findCredentialShapes,
  findMissingReferences,
  findPhantomAccelerationSwitches,
  findSampleVersionRows,
  findTemplatePlaceholders,
  validatePolicyDocs,
} from '../../scripts/validate-policy-docs.mjs';

const REPO_ROOT = process.cwd();
const tempRoots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'policy-doc-truthfulness-'));
  tempRoots.push(root);
  return root;
}

function writeFixtureFile(root: string, relativePath: string, contents: string): void {
  const absolute = join(root, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents, 'utf8');
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
});

const FIXTURE_VERSION = '1.2.3-alpha.0';

function fixtureSecurityPolicy(version = FIXTURE_VERSION): string {
  return [
    '# Security Policy',
    '',
    `This private repository (Baixu22/VerseClaw) is a pre-release alpha. Only main is`,
    `maintained; the package version is ${version} from package.json.`,
    '',
    'Triage records findings in plans/system-maturity/findings-registry.json and',
    'pins the boundary in plans/system-maturity/security-regression-suite.json.',
    '',
    'Do not include live credentials in a report; rotate them first.',
    '',
    'Machine check: pnpm docs:policy:validate',
    '',
  ].join('\n');
}

const FIXTURE_ACCELERATION_POLICY = [
  '# Hardware acceleration policy',
  '',
  'Status: product-locked default (frozen).',
  '',
  'The app calls app.disableHardwareAcceleration() unconditionally.',
  '--enable-gpu does not exist and the app has no config key for it.',
  '',
  'Verification: pnpm docs:policy:validate',
  '',
].join('\n');

const FIXTURE_SOURCE = [
  '// Software rendering is intentional; no switch re-enables GPU compositing.',
  'app.disableHardwareAcceleration();',
  '',
].join('\n');

function buildFixtureRoot(overrides: Record<string, string> = {}): string {
  const root = makeRoot();
  const files: Record<string, string> = {
    'package.json': `${JSON.stringify({ name: 'fixture', version: FIXTURE_VERSION }, null, 2)}\n`,
    [POLICY_PATHS.securityPolicy]: fixtureSecurityPolicy(),
    [POLICY_PATHS.accelerationPolicy]: FIXTURE_ACCELERATION_POLICY,
    [POLICY_PATHS.accelerationSource]: FIXTURE_SOURCE,
    [POLICY_PATHS.findingsRegistry]: '{}\n',
    [POLICY_PATHS.securitySuite]: '{}\n',
    ...overrides,
  };
  for (const [relativePath, contents] of Object.entries(files)) {
    writeFixtureFile(root, relativePath, contents);
  }
  return root;
}

function statusOf(report: ReturnType<typeof validatePolicyDocs>, id: string): string | undefined {
  return report.checks.find((entry) => entry.id === id)?.status;
}

function findingsOf(report: ReturnType<typeof validatePolicyDocs>, id: string): string[] {
  return report.checks.find((entry) => entry.id === id)?.findings ?? [];
}

describe('policy documentation truthfulness', () => {
  describe('the real repository satisfies the policy contract', () => {
    it('passes every check against the checked-in documents', () => {
      const report = validatePolicyDocs({ root: REPO_ROOT });

      expect(report.schema).toBe('clawx.policy-doc-truthfulness.v1');
      expect(report.drivenBy).toBe('agent');
      expect(report.result).toBe('pass');
      expect(report.checks.every((entry) => entry.status === 'pass')).toBe(true);
      expect(report.checks.length).toBeGreaterThanOrEqual(9);
    });

    it('records the shipped version as a hashed input so drift is auditable', () => {
      const report = validatePolicyDocs({ root: REPO_ROOT });
      const declared = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version;

      expect(report.version).toBe(declared);
      expect(report.inputs.securityPolicy.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(report.inputs.accelerationSource.present).toBe(true);
    });
  });

  describe('pure detectors', () => {
    it('detects GitHub template scaffolding sentences', () => {
      expect(findTemplatePlaceholders('# Security Policy\n\nreal text\n')).toEqual([]);
      expect(findTemplatePlaceholders(
        'Use this section to tell people how to report a vulnerability.',
      )).toHaveLength(1);
      expect(findTemplatePlaceholders(
        'Use this section to tell people about which versions of your project are supported.',
      )).toHaveLength(1);
    });

    it('detects sample template version rows but not real support tables', () => {
      expect(findSampleVersionRows('| Version | Supported |\n| 5.1.x | :white_check_mark: |\n')).toHaveLength(1);
      expect(findSampleVersionRows('| `main` | Yes |\n| older alpha | No |\n')).toEqual([]);
    });

    it('detects advertised acceleration switches', () => {
      expect(findPhantomAccelerationSwitches('app.disableHardwareAcceleration();\n')).toEqual([]);
      expect(findPhantomAccelerationSwitches('// pass `--enable-gpu` to enable it\n')).toContain('--enable-gpu');
      expect(findPhantomAccelerationSwitches('set "disable-hardware-acceleration": false\n')).toContain(
        'disable-hardware-acceleration',
      );
    });

    it('detects credential-shaped strings in a policy document', () => {
      expect(findCredentialShapes('use <SYNTHETIC_TOKEN> instead\n')).toEqual([]);
      expect(findCredentialShapes(`leaked ${'ghp_'}${'a'.repeat(24)}\n`)).toContain('github-token');
      expect(findCredentialShapes('-----BEGIN RSA PRIVATE KEY-----\n')).toContain('private-key-block');
    });

    it('ignores external URLs and anchors when resolving repository references', () => {
      const missing = findMissingReferences(
        'See [issue](https://github.com/o/r/issues/1) and [top](#top) and `pnpm run x`\n',
        { root: REPO_ROOT, docPath: 'SECURITY.md' },
      );
      expect(missing).toEqual([]);
    });
  });

  describe('fail-closed behaviour', () => {
    it('fails every security check when SECURITY.md is missing instead of skipping', () => {
      const root = buildFixtureRoot();
      rmSync(join(root, POLICY_PATHS.securityPolicy));

      const report = validatePolicyDocs({ root });

      expect(report.result).toBe('fail');
      expect(statusOf(report, 'security-policy-no-template-text')).toBe('fail');
      expect(statusOf(report, 'security-policy-references-resolve')).toBe('fail');
      expect(findingsOf(report, 'security-policy-reporting-path')).toContain(
        `${POLICY_PATHS.securityPolicy} is missing`,
      );
    });

    it('fails when template scaffolding returns', () => {
      const root = buildFixtureRoot({
        [POLICY_PATHS.securityPolicy]: `${fixtureSecurityPolicy()}\nUse this section to tell people how to report a vulnerability.\n`,
      });

      const report = validatePolicyDocs({ root });

      expect(report.result).toBe('fail');
      expect(findingsOf(report, 'security-policy-no-template-text')[0]).toContain('template sentence');
    });

    it('fails when the manifest version moves ahead of the supported-version table', () => {
      const root = buildFixtureRoot({
        'package.json': `${JSON.stringify({ name: 'fixture', version: '9.9.9-alpha.0' }, null, 2)}\n`,
      });

      const report = validatePolicyDocs({ root });

      expect(report.result).toBe('fail');
      expect(findingsOf(report, 'security-policy-supported-version').join('\n')).toContain(
        'current package.json version 9.9.9-alpha.0 is not declared as supported',
      );
    });

    it('fails when the policy drops its tracking anchors', () => {
      const root = buildFixtureRoot({
        [POLICY_PATHS.securityPolicy]: [
          '# Security Policy',
          'This private repository (Baixu22/VerseClaw) supports main only.',
          `Version ${FIXTURE_VERSION} comes from package.json.`,
          'Do not include live credentials.',
          'Machine check: pnpm docs:policy:validate',
          '',
        ].join('\n'),
      });

      const report = validatePolicyDocs({ root });

      expect(report.result).toBe('fail');
      expect(findingsOf(report, 'security-policy-tracking-process').join('\n')).toContain(
        'plans/system-maturity/findings-registry.json',
      );
    });

    it('fails when a referenced policy path does not exist', () => {
      const root = buildFixtureRoot({
        [POLICY_PATHS.securityPolicy]: `${fixtureSecurityPolicy()}\nSee [missing policy](docs/dev/missing-policy.md)\n`,
      });

      const report = validatePolicyDocs({ root });

      expect(report.result).toBe('fail');
      expect(findingsOf(report, 'security-policy-references-resolve')).toContain(
        'referenced path does not exist: docs/dev/missing-policy.md',
      );
    });

    it('fails when a credential shape reaches the security policy', () => {
      const root = buildFixtureRoot({
        [POLICY_PATHS.securityPolicy]: `${fixtureSecurityPolicy()}\nExample: ${'sk-'}${'a'.repeat(32)}\n`,
      });

      const report = validatePolicyDocs({ root });

      expect(report.result).toBe('fail');
      expect(findingsOf(report, 'security-policy-no-credential-shapes')).toContain(
        'credential-shaped content detected: provider-key',
      );
    });

    it('fails when the Main process advertises a switch that does not exist', () => {
      const root = buildFixtureRoot({
        [POLICY_PATHS.accelerationSource]: `${FIXTURE_SOURCE}// users can pass --enable-gpu\n`,
      });

      const report = validatePolicyDocs({ root });

      expect(report.result).toBe('fail');
      expect(findingsOf(report, 'acceleration-source-matches-decision')).toContain(
        'source advertises a non-existent acceleration switch: --enable-gpu',
      );
    });

    it('fails when the acceleration decision record is missing or incomplete', () => {
      const missingRoot = buildFixtureRoot();
      rmSync(join(missingRoot, POLICY_PATHS.accelerationPolicy));
      expect(statusOf(validatePolicyDocs({ root: missingRoot }), 'acceleration-decision-record')).toBe('fail');

      const incompleteRoot = buildFixtureRoot({
        [POLICY_PATHS.accelerationPolicy]: '# Hardware acceleration\n\nWe disable it.\n',
      });
      const findings = findingsOf(validatePolicyDocs({ root: incompleteRoot }), 'acceleration-decision-record').join('\n');
      expect(findings).toContain('app.disableHardwareAcceleration()');
      expect(findings).toContain('product-locked');
    });

    it('fails when a tracking asset disappears', () => {
      const root = buildFixtureRoot();
      rmSync(join(root, POLICY_PATHS.securitySuite));

      const report = validatePolicyDocs({ root });

      expect(report.result).toBe('fail');
      expect(findingsOf(report, 'security-process-assets-exist').join('\n')).toContain(
        POLICY_PATHS.securitySuite,
      );
    });

    it('fails when package.json is unreadable so the version contract cannot be checked', () => {
      const root = buildFixtureRoot();
      writeFixtureFile(root, 'package.json', '{ not json\n');

      const report = validatePolicyDocs({ root });

      expect(report.result).toBe('fail');
      expect(findingsOf(report, 'package-version-resolvable')).toContain(
        'package.json does not expose a string "version"',
      );
    });
  });
});
