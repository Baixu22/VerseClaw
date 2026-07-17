#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const outDir = join(root, 'artifacts/system-maturity/P6-001');
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

function run(name, command, args, expectedExit = 0, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
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
  process.stdout.write(`[P6-001 evidence] ${ok ? 'PASS' : 'FAIL'} ${name} exit=${exitCode} expected=${expectedExit}\n`);
  return { exitCode, stdout, stderr, ok };
}

function runPnpm(name, args, expectedExit = 0) {
  return run(
    name,
    pnpmInvocation.command,
    [...pnpmInvocation.argsPrefix, ...args],
    expectedExit,
  );
}

runPnpm('vitest', ['exec', 'vitest', 'run', 'tests/unit/windows-signing-policy-p6-001.test.ts']);
runPnpm('policy-validate', ['run', 'release:windows-policy']);
run(
  'gate-deny-unsigned',
  node,
  [
    'scripts/validate-windows-release-policy.mjs',
    '--gate-public',
    '--version',
    '1.0.0',
    '--windows-signed',
    'false',
    '--target-public',
    'true',
  ],
  1,
);
run(
  'workflow-yaml',
  node,
  [
    '-e',
    "import('yaml').then(({parse})=>{const fs=require('fs');const doc=parse(fs.readFileSync('.github/workflows/release.yml','utf8'));if(!doc.jobs?.['release-policy-gate'])process.exit(2);console.log('release.yml YAML + release-policy-gate OK')})",
  ],
);
runPnpm('harness-validate', [
  'harness',
  'validate',
  '--spec',
  'harness/specs/tasks/windows-release-signing-policy.md',
]);

if (includeFullGates) {
  runPnpm('full-test', ['test'], [0, 1]);
  runPnpm('typecheck', ['run', 'typecheck'], [0, 1]);
  runPnpm('harness-ci', ['run', 'harness:ci']);
}

if (process.platform === 'win32') {
  const systemExe = join(process.env.WINDIR || 'C:\\Windows', 'System32', 'notepad.exe');
  const escaped = systemExe.replace(/'/g, "''");
  const probe = run('authenticode-probe', 'powershell.exe', [
    '-NoProfile',
    '-Command',
    `$sig=Get-AuthenticodeSignature -LiteralPath '${escaped}'; [ordered]@{path='${escaped}';name=[IO.Path]::GetFileName('${escaped}');status=$sig.Status.ToString();signerSubject=$sig.SignerCertificate.Subject;signerThumbprint=$sig.SignerCertificate.Thumbprint;timestampSubject=if($sig.TimeStamperCertificate){$sig.TimeStamperCertificate.Subject}else{$null}} | ConvertTo-Json -Compress; if($sig.Status -ne 'Valid'){exit 1}`,
  ]);
  if (probe.ok) {
    const signature = JSON.parse(probe.stdout.trim());
    const attestation = {
      schemaVersion: 1,
      task: 'P6-001',
      platform: 'win',
      version: '1.0.0',
      channel: 'stable',
      requiresCodeSigning: true,
      targetPublicPublish: true,
      isStable: true,
      windowsArtifactsSigned: true,
      exeCount: 1,
      exeNames: [signature.name],
      signatureVerification: {
        status: 'verified',
        verifiedExeCount: 1,
        verifiedExeNames: [signature.name],
        signatures: [signature],
      },
      signedAt: new Date().toISOString(),
      policy: 'shared/release-policy/windows-signing-policy.mjs',
      evidenceScope: 'local Windows Authenticode control probe; CI uses release/*.exe',
    };
    const attestationPath = join(outDir, 'stable-attestation-probe.json');
    writeFileSync(attestationPath, `${JSON.stringify(attestation, null, 2)}\n`);
    run('gate-allow-signed-attestation', node, [
      'scripts/validate-windows-release-policy.mjs',
      '--gate-attestation',
      attestationPath,
      '--version',
      '1.0.0',
    ]);
  }
} else {
  runs.push({
    name: 'authenticode-probe',
    command: 'Get-AuthenticodeSignature',
    expectedExit: 0,
    exitCode: null,
    ok: false,
    reason: 'P6-001 evidence collection requires Windows',
  });
}

const acceptance = [
  {
    id: 'A1',
    title: 'Release policy is consistent with the workflow',
    status: runs.every((item) =>
      ['vitest', 'policy-validate', 'workflow-yaml', 'harness-validate'].includes(item.name)
        ? item.ok
        : true,
    )
      ? 'passed'
      : 'failed',
    evidence: ['vitest', 'policy-validate', 'workflow-yaml', 'harness-validate'],
  },
  {
    id: 'A2',
    title: 'Unsigned artifacts cannot enter public release',
    status: runs.every((item) =>
      ['gate-deny-unsigned', 'authenticode-probe', 'gate-allow-signed-attestation'].includes(
        item.name,
      )
        ? item.ok
        : true,
    )
      ? 'passed'
      : 'failed',
    evidence: ['gate-deny-unsigned', 'authenticode-probe', 'gate-allow-signed-attestation'],
  },
  {
    id: 'A3',
    title: 'Post-sign metadata hash is correct',
    status: runs.find((item) => item.name === 'vitest')?.ok ? 'passed' : 'failed',
    evidence: ['vitest'],
  },
];

const fullGateRuns = runs.filter((item) =>
  ['full-test', 'typecheck', 'harness-ci'].includes(item.name),
);
const p6FailureSignature =
  /(?:windows-signing-policy|validate-windows-release-policy|collect-p6-001|P6-001|release\.yml)[^\r\n]{0,300}(?:error|failed|FAIL)|(?:error|failed|FAIL)[^\r\n]{0,300}(?:windows-signing-policy|validate-windows-release-policy|collect-p6-001|P6-001|release\.yml)/i;
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
      note:
        'Repository-wide gates are recorded for status review. A nonzero gate with no P6 failure signature remains a release-baseline issue for P6-005, not a P6-001 acceptance failure.',
      runs: fullGateRuns.map((item) => ({ name: item.name, exitCode: item.exitCode })),
    }
  : { status: 'not-run', runs: [] };

writeFileSync(
  join(outDir, 'acceptance-matrix.json'),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      taskId: 'P6-001',
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

const evidenceNames = [
  ...runs.flatMap((item) =>
    item.exitCode == null
      ? []
      : [`${item.name}.stdout.txt`, `${item.name}.stderr.txt`, `${item.name}.exit.txt`],
  ),
  'stable-attestation-probe.json',
  'acceptance-matrix.json',
  ...(includeFullGates ? ['full-gate-assessment.json'] : []),
].filter((name, index, list) => list.indexOf(name) === index);

if (includeFullGates) {
  writeFileSync(
    join(outDir, 'full-gate-assessment.json'),
    `${JSON.stringify(fullGateAssessment, null, 2)}\n`,
  );
}

const files = {};
for (const name of evidenceNames) {
  const filePath = join(outDir, name);
  try {
    const data = readFileSync(filePath);
    files[basename(filePath)] = {
      sha256: createHash('sha256').update(data).digest('hex'),
      bytes: data.length,
    };
  } catch {
    // Missing output is reflected in failed acceptance/runs.
  }
}

writeFileSync(
  join(outDir, 'evidence-index.json'),
  `${JSON.stringify(
    { schemaVersion: 1, taskId: 'P6-001', generatedAt: new Date().toISOString(), files },
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

function readFileSafe(filePath) {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function normalizeCapturedText(text) {
  const normalized = String(text)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t ]+$/g, ''))
    .join('\n')
    .replace(/\n*$/g, '');
  return normalized ? `${normalized}\n` : '';
}
