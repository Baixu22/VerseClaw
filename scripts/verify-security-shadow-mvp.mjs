import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '..');
const spec = 'harness/specs/tasks/runtime-security-verification-shadow-mvp.md';
const runtimeVerificationSpec = 'harness/specs/tasks/runtime-event-log-verification-shadow.md';
const autoSamplingSpec = 'harness/specs/tasks/runtime-verification-auto-sampling-mvp.md';

function withWindowsNodePath(env) {
  if (process.platform !== 'win32') return env;

  const candidates = [
    'C:\\Program Files\\nodejs',
    env.APPDATA ? path.join(env.APPDATA, 'npm') : undefined,
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'pnpm') : undefined,
  ].filter(Boolean);
  const currentPath = env.Path ?? env.PATH ?? '';
  const lowerPath = currentPath.toLowerCase();
  const missingPaths = candidates.filter((candidate) => !lowerPath.includes(candidate.toLowerCase()));

  return {
    ...env,
    Path: `${missingPaths.join(';')}${missingPaths.length > 0 && currentPath ? ';' : ''}${currentPath}`,
    PATH: `${missingPaths.join(';')}${missingPaths.length > 0 && currentPath ? ';' : ''}${currentPath}`,
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

function commandExists(command) {
  const pathValue = process.env.Path ?? process.env.PATH ?? '';
  const extensions = process.platform === 'win32'
    ? ['', '.cmd', '.exe', '.bat']
    : [''];
  return pathValue
    .split(path.delimiter)
    .filter(Boolean)
    .some((entry) => extensions.some((ext) => existsSync(path.join(entry, `${command}${ext}`))));
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

  if (commandExists('pnpm')) {
    return {
      command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
      argsPrefix: ['--pm-on-fail=ignore'],
      displayPrefix: ['--pm-on-fail=ignore'],
      label: 'pnpm',
    };
  }

  return undefined;
}

const pnpm = pnpmCommand();
const rootVitest = ['node_modules/vitest/vitest.mjs'];
const runtimeVitest = ['node_modules/vitest/vitest.mjs'];
const tsc = ['node_modules/typescript/bin/tsc'];

function pnpmOrNodeStep({
  name,
  pnpmArgs,
  nodeArgs,
  cwd = repoRoot,
}) {
  if (pnpm) {
    return {
      name,
      command: pnpm.command,
      args: [...pnpm.argsPrefix, ...pnpmArgs],
      displayArgs: [...pnpm.displayPrefix, ...pnpmArgs],
      label: pnpm.label,
      cwd,
    };
  }
  return {
    name,
    command: process.execPath,
    args: nodeArgs,
    cwd,
  };
}

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
  pnpmOrNodeStep({
    name: 'Shadow evaluator and RPC contract tests',
    pnpmArgs: [
      'exec',
      'vitest',
      'run',
      'tests/unit/security-verification-shadow.test.ts',
      'tests/unit/security-verification-shadow-contract.test.ts',
      'tests/unit/runtime-verification-auto-sampling.test.ts',
    ],
    nodeArgs: [
      ...rootVitest,
      'run',
      'tests/unit/security-verification-shadow.test.ts',
      'tests/unit/security-verification-shadow-contract.test.ts',
      'tests/unit/runtime-verification-auto-sampling.test.ts',
    ],
  }),
  pnpmOrNodeStep({
    name: 'Gateway tools.invoke regression tests',
    pnpmArgs: [
      '--dir',
      'openclaw_runtime',
      'exec',
      'vitest',
      'run',
      '--config',
      'test/vitest/vitest.gateway-methods.config.ts',
      'src/gateway/server-methods/tools-invoke-mcp-fallback.test.ts',
    ],
    nodeArgs: [
      ...runtimeVitest,
      'run',
      '--config',
      'test/vitest/vitest.gateway-methods.config.ts',
      'src/gateway/server-methods/tools-invoke-mcp-fallback.test.ts',
    ],
    cwd: path.join(repoRoot, 'openclaw_runtime'),
  }),
  pnpmOrNodeStep({
    name: 'Typecheck node',
    pnpmArgs: ['run', 'typecheck:node'],
    nodeArgs: [...tsc, '--noEmit', '-p', 'tsconfig.node.json', '--composite', 'false'],
  }),
  pnpmOrNodeStep({
    name: 'Typecheck web',
    pnpmArgs: ['run', 'typecheck:web'],
    nodeArgs: [...tsc, '--noEmit', '-p', 'tsconfig.web.json', '--composite', 'false'],
  }),
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
      cwd: step.cwd ?? repoRoot,
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
