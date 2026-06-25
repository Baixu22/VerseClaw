import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '..');
const spec = 'harness/specs/tasks/runtime-security-verification-shadow-mvp.md';
const runtimeVerificationSpec = 'harness/specs/tasks/runtime-event-log-verification-shadow.md';
const autoSamplingSpec = 'harness/specs/tasks/runtime-verification-auto-sampling-mvp.md';

function withWindowsNodePath(env) {
  if (process.platform !== 'win32') return env;

  const nodeDir = 'C:\\Program Files\\nodejs';
  const currentPath = env.Path ?? env.PATH ?? '';
  if (currentPath.toLowerCase().includes(nodeDir.toLowerCase())) {
    return env;
  }

  return {
    ...env,
    Path: `${nodeDir};${currentPath}`,
    PATH: `${nodeDir};${currentPath}`,
  };
}

function makeEnv() {
  return withWindowsNodePath({
    ...process.env,
    COREPACK_ENABLE_STRICT: '0',
    npm_config_pm_on_fail: 'ignore',
    npm_config_manage_package_manager_versions: 'false',
  });
}

function pnpmCommand() {
  const npmExecPath = process.env.npm_execpath;
  if (
    npmExecPath &&
    path.basename(npmExecPath).toLowerCase().includes('pnpm') &&
    existsSync(npmExecPath)
  ) {
  return {
    command: process.execPath,
    argsPrefix: [npmExecPath, '--pm-on-fail=ignore'],
    displayPrefix: ['--pm-on-fail=ignore'],
    label: 'pnpm',
  };
}

  return {
    command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    argsPrefix: ['--pm-on-fail=ignore'],
    displayPrefix: ['--pm-on-fail=ignore'],
  label: 'pnpm',
};
}

const pnpm = pnpmCommand();

const steps = [
  {
    name: 'Harness context',
    command: process.execPath,
    args: ['harness/src/cli.mjs', 'context', '--spec', spec],
  },
  {
    name: 'Harness validate',
    command: process.execPath,
    args: ['harness/src/cli.mjs', 'validate', '--spec', spec],
  },
  {
    name: 'Runtime verification harness context',
    command: process.execPath,
    args: ['harness/src/cli.mjs', 'context', '--spec', runtimeVerificationSpec],
  },
  {
    name: 'Runtime verification harness validate',
    command: process.execPath,
    args: ['harness/src/cli.mjs', 'validate', '--spec', runtimeVerificationSpec],
  },
  {
    name: 'Runtime auto-sampling harness context',
    command: process.execPath,
    args: ['harness/src/cli.mjs', 'context', '--spec', autoSamplingSpec],
  },
  {
    name: 'Runtime auto-sampling harness validate',
    command: process.execPath,
    args: ['harness/src/cli.mjs', 'validate', '--spec', autoSamplingSpec],
  },
  {
    name: 'Shadow evaluator and RPC contract tests',
    command: pnpm.command,
    args: [
      ...pnpm.argsPrefix,
      'exec',
      'vitest',
      'run',
      'tests/unit/security-verification-shadow.test.ts',
      'tests/unit/security-verification-shadow-contract.test.ts',
      'tests/unit/runtime-verification-auto-sampling.test.ts',
    ],
    displayArgs: [
      ...pnpm.displayPrefix,
      'exec',
      'vitest',
      'run',
      'tests/unit/security-verification-shadow.test.ts',
      'tests/unit/security-verification-shadow-contract.test.ts',
      'tests/unit/runtime-verification-auto-sampling.test.ts',
    ],
    label: pnpm.label,
  },
  {
    name: 'Gateway tools.invoke regression tests',
    command: pnpm.command,
    args: [
      ...pnpm.argsPrefix,
      '--dir',
      'openclaw_runtime',
      'exec',
      'vitest',
      'run',
      '--config',
      'test/vitest/vitest.gateway-methods.config.ts',
      'src/gateway/server-methods/tools-invoke-mcp-fallback.test.ts',
    ],
    displayArgs: [
      ...pnpm.displayPrefix,
      '--dir',
      'openclaw_runtime',
      'exec',
      'vitest',
      'run',
      '--config',
      'test/vitest/vitest.gateway-methods.config.ts',
      'src/gateway/server-methods/tools-invoke-mcp-fallback.test.ts',
    ],
    label: pnpm.label,
  },
  {
    name: 'Typecheck',
    command: pnpm.command,
    args: [...pnpm.argsPrefix, 'run', 'typecheck'],
    displayArgs: [...pnpm.displayPrefix, 'run', 'typecheck'],
    label: pnpm.label,
  },
  {
    name: 'Comms replay',
    command: process.execPath,
    args: ['scripts/comms/replay.mjs'],
  },
  {
    name: 'Comms compare',
    command: process.execPath,
    args: ['scripts/comms/compare.mjs'],
  },
];

async function runStep(step) {
  const printableCommand = step.label ?? path.basename(step.command);
  const printableArgs = step.displayArgs ?? step.args;
  console.log(`\n==> ${step.name}`);
  console.log(`$ ${[printableCommand, ...printableArgs].join(' ')}`);

  await new Promise((resolve, reject) => {
    const child = spawn(step.command, step.args, {
      cwd: repoRoot,
      env: makeEnv(),
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          signal
            ? `${step.name} terminated by ${signal}`
            : `${step.name} failed with exit code ${code}`,
        ),
      );
    });
  });
}

try {
  for (const step of steps) {
    await runStep(step);
  }
  console.log('\nSecurity shadow MVP verification passed.');
} catch (error) {
  console.error(`\nSecurity shadow MVP verification failed: ${error.message}`);
  process.exitCode = 1;
}
