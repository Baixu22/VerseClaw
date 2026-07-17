#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const outDir = join(root, 'artifacts/system-maturity/P6-002');
mkdirSync(outDir, { recursive: true });
const includeFullGates = process.argv.includes('--full');
const node = process.execPath;
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
const childEnv = { ...process.env };
delete childEnv.NODE_TLS_REJECT_UNAUTHORIZED;

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
  console.log(`[P6-002 evidence] ${ok ? 'PASS' : 'FAIL'} ${name} exit=${exitCode}`);
  return { ok, exitCode };
}

function runPnpm(name, args, expectedExit = 0) {
  return run(name, pnpmInvocation.command, [...pnpmInvocation.argsPrefix, ...args], expectedExit);
}

runPnpm('vitest', ['exec', 'vitest', 'run', 'tests/unit/windows-update-feed-p6-002.test.ts']);
runPnpm('policy-validate', ['run', 'release:windows-update-policy']);
runPnpm('live-feed-probe', ['run', 'release:windows-update-policy:live']);
run(
  'unknown-channel-deny',
  node,
  ['scripts/validate-windows-update-feed-policy.mts', '--version', '1.0.0-rc.1'],
  1,
);
runPnpm('harness-validate', [
  'harness',
  'validate',
  '--spec',
  'harness/specs/tasks/windows-update-feed-integrity.md',
  '--since',
  '3d67e200e',
]);
runPnpm('comms-replay', ['run', 'comms:replay']);
runPnpm('comms-compare', ['run', 'comms:compare']);
run(
  'workflow-yaml',
  node,
  [
    '-e',
    "import('yaml').then(({parse})=>{const fs=require('fs');const doc=parse(fs.readFileSync('.github/workflows/release.yml','utf8'));const gate=doc.jobs?.['release-policy-gate'];const text=JSON.stringify(gate);if(!text.includes('validate-windows-update-feed-policy'))process.exit(2);console.log('release.yml P6-002 gate OK')})",
  ],
);

if (includeFullGates) {
  runPnpm('full-test', ['test'], [0, 1]);
  runPnpm('typecheck', ['run', 'typecheck'], [0, 1]);
  runPnpm('harness-ci', ['run', 'harness:ci']);
}

const acceptance = [
  {
    id: 'A1',
    title: 'Client locates the correct feed',
    status: allOk(['vitest', 'policy-validate', 'live-feed-probe', 'workflow-yaml'])
      ? 'passed'
      : 'failed',
  },
  {
    id: 'A2',
    title: 'Tampered metadata/package is rejected',
    status: allOk(['vitest', 'unknown-channel-deny']) ? 'passed' : 'failed',
  },
  {
    id: 'A3',
    title: 'Feed source and channel are auditable',
    status: allOk(['policy-validate', 'harness-validate', 'comms-replay', 'comms-compare'])
      ? 'passed'
      : 'failed',
  },
];

const fullGateRuns = runs.filter((item) =>
  ['full-test', 'typecheck', 'harness-ci'].includes(item.name),
);
const p6FailureSignature =
  /(?:windows-update-feed|updates-api|P6-002|release\.yml)[^\r\n]{0,300}(?:error|failed|FAIL)|(?:error|failed|FAIL)[^\r\n]{0,300}(?:windows-update-feed|updates-api|P6-002|release\.yml)/i;
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
      taskId: 'P6-002',
      finding: 'F-SUPPLY-001',
      checkedAt: new Date().toISOString(),
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
  files[basename(name)] = {
    sha256: createHash('sha256').update(data).digest('hex'),
    bytes: data.length,
  };
}
writeFileSync(
  join(outDir, 'evidence-index.json'),
  `${JSON.stringify(
    { schemaVersion: 1, taskId: 'P6-002', generatedAt: new Date().toISOString(), files },
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
    'acceptance-matrix.json',
    'full-gate-assessment.json',
  ];
}
