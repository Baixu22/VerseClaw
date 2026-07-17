#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'artifacts/system-maturity/P6-004');
const fixtureDir = join(outDir, 'metadata-fixture');
const tamperDir = join(outDir, 'metadata-tamper-fixture');
const includeFullGates = process.argv.includes('--full');
const packagedAppDir = resolve(readArg('--packaged-app-dir') || join(root, 'release'));
const node = process.execPath;
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const commit = gitValue(['rev-parse', 'HEAD']);
const childEnv = { ...process.env };
delete childEnv.NODE_TLS_REJECT_UNAUTHORIZED;
const pnpmInvocation =
  process.platform === 'win32'
    ? {
        command: node,
        argsPrefix: [
          process.env.npm_execpath ||
            join(process.env.APPDATA || '', 'npm/node_modules/pnpm/bin/pnpm.mjs'),
        ],
      }
    : { command: 'pnpm', argsPrefix: [] };
const runs = [];

mkdirSync(outDir, { recursive: true });
prepareFixture(fixtureDir);
prepareFixture(tamperDir);

function normalizeCapturedText(text) {
  const normalized = String(text)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t ]+$/g, ''))
    .join('\n')
    .replace(/\n*$/g, '');
  return normalized ? `${normalized}\n` : '';
}

function run(name, command, args, expectedExit = 0) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: childEnv,
    encoding: 'utf8',
    shell: false,
    timeout: 10 * 60 * 1000,
  });
  const exitCode = result.status ?? 1;
  const stdout = normalizeCapturedText(result.stdout || '');
  const stderr = normalizeCapturedText(
    [result.stderr || '', result.error ? `${result.error.stack || result.error}\n` : ''].join(''),
  );
  writeFileSync(join(outDir, `${name}.stdout.txt`), stdout);
  writeFileSync(join(outDir, `${name}.stderr.txt`), stderr);
  writeFileSync(join(outDir, `${name}.exit.txt`), String(exitCode));
  const expectedExits = Array.isArray(expectedExit) ? expectedExit : [expectedExit];
  const ok = expectedExits.includes(exitCode);
  runs.push({ name, command: [command, ...args].join(' '), expectedExit, exitCode, ok });
  console.log(`[P6-004 evidence] ${ok ? 'PASS' : 'FAIL'} ${name} exit=${exitCode}`);
  return { ok, exitCode };
}

function runPnpm(name, args, expectedExit = 0) {
  return run(name, pnpmInvocation.command, [...pnpmInvocation.argsPrefix, ...args], expectedExit);
}

function metadataArgs(directory) {
  return [
    '--artifacts',
    join(directory, 'artifacts'),
    '--out',
    join(directory, 'trust'),
    '--version',
    packageJson.version,
    '--commit',
    commit,
    '--repository',
    'IntelliSpectrum/ClawX',
    '--ref',
    'refs/heads/evidence',
    '--run-id',
    'local-p6-004',
    '--run-attempt',
    '1',
  ];
}

function validationArgs(directory) {
  return [
    '--artifacts',
    join(directory, 'artifacts'),
    '--inventory',
    join(directory, 'trust/release-artifact-inventory.json'),
    '--sbom',
    join(directory, 'trust/release-sbom.cdx.json'),
    '--provenance',
    join(directory, 'trust/release-provenance.intoto.json'),
    '--version',
    packageJson.version,
    '--commit',
    commit,
    '--repository',
    'IntelliSpectrum/ClawX',
    '--ref',
    'refs/heads/evidence',
  ];
}

runPnpm('vitest', [
  'exec',
  'vitest',
  'run',
  'tests/unit/release-artifact-integrity-p6-004.test.ts',
  'tests/unit/supply-chain-integrity-p6-003.test.ts',
]);
runPnpm('trust-policy', ['run', 'release:trust-policy']);
runPnpm('supply-policy', ['run', 'release:supply-chain-policy']);
run('metadata-generate', node, ['scripts/generate-release-trust-metadata.mjs', ...metadataArgs(fixtureDir)]);
run('metadata-validate', node, [
  'scripts/validate-release-trust-metadata.mjs',
  ...validationArgs(fixtureDir),
]);
run('tamper-metadata-generate', node, [
  'scripts/generate-release-trust-metadata.mjs',
  ...metadataArgs(tamperDir),
]);
appendFileSync(join(tamperDir, 'artifacts/ClawX.exe'), 'tampered');
run(
  'tamper-deny',
  node,
  ['scripts/validate-release-trust-metadata.mjs', ...validationArgs(tamperDir)],
  1,
);
rmSync(tamperDir, { recursive: true, force: true });
run('packaged-trust-report', node, [
  'scripts/verify-packaged-electron-trust.mjs',
  '--app-dir',
  packagedAppDir,
  '--platform',
  'win',
  '--output',
  join(outDir, 'win-electron-trust.json'),
]);
run('packaged-trust-replay', node, [
  'scripts/verify-packaged-electron-trust.mjs',
  '--app-dir',
  packagedAppDir,
  '--verify-report',
  join(outDir, 'win-electron-trust.json'),
]);
runPnpm('harness-validate', [
  'harness',
  'validate',
  '--spec',
  'harness/specs/tasks/release-artifact-attestation-integrity.md',
  '--since',
  '95e21e4eb',
]);
run(
  'workflow-yaml',
  node,
  [
    '-e',
    "const fs=require('fs'),path=require('path'),yaml=require('yaml');for(const name of fs.readdirSync('.github/workflows').filter(n=>/\\.ya?ml$/.test(n))){yaml.parse(fs.readFileSync(path.join('.github/workflows',name),'utf8'));}console.log('workflow YAML parse OK')",
  ],
);
runPnpm('focused-eslint', [
  'exec',
  'eslint',
  'scripts/generate-release-trust-metadata.mjs',
  'scripts/validate-release-trust-metadata.mjs',
  'scripts/verify-packaged-electron-trust.mjs',
  'scripts/collect-p6-004-evidence.mjs',
  'tests/unit/release-artifact-integrity-p6-004.test.ts',
]);

if (includeFullGates) {
  runPnpm('full-test', ['test'], [0, 1]);
  runPnpm('typecheck', ['run', 'typecheck'], [0, 1]);
  runPnpm('harness-ci', ['run', 'harness:ci']);
}

const acceptance = [
  {
    id: 'A1',
    title: 'CycloneDX SBOM is bound to exact release artifact SHA256 subjects',
    status: allOk(['vitest', 'metadata-generate', 'metadata-validate']) ? 'passed' : 'failed',
  },
  {
    id: 'A2',
    title: 'SLSA provenance and GitHub attestations are independently verifiable',
    status: allOk(['trust-policy', 'metadata-validate', 'workflow-yaml']) ? 'passed' : 'failed',
  },
  {
    id: 'A3',
    title: 'Tampered metadata, ASAR bytes, or critical Electron fuses are denied',
    status: allOk([
      'vitest',
      'tamper-deny',
      'packaged-trust-report',
      'packaged-trust-replay',
    ])
      ? 'passed'
      : 'failed',
  },
];

const fullGateRuns = runs.filter((item) =>
  ['full-test', 'typecheck', 'harness-ci'].includes(item.name),
);
const p6FailureSignature =
  /(?:release-artifact-integrity-p6-004|release-trust-metadata|verify-packaged-electron-trust|generate-release-trust-metadata|P6-004)[^\r\n]{0,300}(?:error|failed|FAIL)|(?:error|failed|FAIL)[^\r\n]{0,300}(?:release-artifact-integrity-p6-004|release-trust-metadata|verify-packaged-electron-trust|generate-release-trust-metadata|P6-004)/i;
const fullGateAssessment = includeFullGates
  ? {
      status: fullGateRuns.every((item) => item.exitCode === 0)
        ? 'passed'
        : fullGateRuns.some((item) => {
              const text = `${readFileSafe(join(outDir, `${item.name}.stdout.txt`))}\n${readFileSafe(
                join(outDir, `${item.name}.stderr.txt`),
              )}`;
              return item.exitCode !== 0 && p6FailureSignature.test(text);
            })
          ? 'p6-regression'
          : 'baseline-fail-no-p6-signature',
      runs: fullGateRuns.map((item) => ({ name: item.name, exitCode: item.exitCode })),
      note:
        'Repository-wide non-P6 failures remain P6-005 release-baseline work; a P6 signature fails this collector.',
    }
  : { status: 'not-run', runs: [] };

writeFileSync(
  join(outDir, 'acceptance-matrix.json'),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      taskId: 'P6-004',
      finding: 'F-SUPPLY-002',
      checkedAt: new Date().toISOString(),
      packagedAppDir: relative(root, packagedAppDir).replaceAll('\\', '/'),
      runs,
      acceptance,
      fullGateAssessment,
    },
    null,
    2,
  )}\n`,
);
writeFileSync(
  join(outDir, 'full-gate-assessment.json'),
  `${JSON.stringify(fullGateAssessment, null, 2)}\n`,
);

const files = {};
for (const name of readEvidenceNames()) {
  const data = readFileSync(join(outDir, name));
  files[name.replaceAll('\\', '/')] = {
    sha256: createHash('sha256').update(data).digest('hex'),
    bytes: data.length,
  };
}
writeFileSync(
  join(outDir, 'evidence-index.json'),
  `${JSON.stringify(
    { schemaVersion: 1, taskId: 'P6-004', generatedAt: new Date().toISOString(), files },
    null,
    2,
  )}\n`,
);

if (
  runs.some((item) => !item.ok) ||
  acceptance.some((item) => item.status !== 'passed') ||
  fullGateAssessment.status === 'p6-regression'
) {
  process.exit(1);
}

function allOk(names) {
  return names.every((name) => runs.find((item) => item.name === name)?.ok === true);
}

function gitValue(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

function prepareFixture(directory) {
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(join(directory, 'artifacts'), { recursive: true });
  writeFileSync(join(directory, 'artifacts/ClawX.exe'), 'signed-executable');
  writeFileSync(join(directory, 'artifacts/latest.yml'), `version: ${packageJson.version}\n`);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readFileSafe(filePath) {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function readEvidenceNames() {
  return [
    ...runs.flatMap((item) => [
      `${item.name}.stdout.txt`,
      `${item.name}.stderr.txt`,
      `${item.name}.exit.txt`,
    ]),
    'metadata-fixture/trust/release-artifact-inventory.json',
    'metadata-fixture/trust/release-sbom.cdx.json',
    'metadata-fixture/trust/release-provenance.intoto.json',
    'win-electron-trust.json',
    'acceptance-matrix.json',
    'full-gate-assessment.json',
  ];
}
