import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { spawnSync as nodeSpawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_WINDOWS_PNPM_DIR = 'C:\\Users\\27933\\AppData\\Roaming\\npm';

function toText(value) {
  if (value == null) {
    return '';
  }
  return Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
}

function extractVersion(output) {
  return output.match(/\d+\.\d+\.\d+(?:-[^\s]+)?/)?.[0];
}

function readPackageManagerSpec(cwd) {
  const packageJsonPath = path.join(cwd, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  if (typeof packageJson.packageManager !== 'string') {
    throw new Error(`Missing packageManager field in ${packageJsonPath}`);
  }
  return packageJson.packageManager;
}

function shouldUseShell(command) {
  return process.platform === 'win32' && (command.endsWith('.cmd') || command.endsWith('.bat'));
}

export function parsePackageManagerSpec(spec) {
  const match = spec.trim().match(/^([^@]+)@([^+\s]+)(?:\+.*)?$/);
  if (!match) {
    throw new Error(`Unsupported packageManager spec: ${spec}`);
  }
  return { name: match[1], version: match[2] };
}

export function defaultPnpmCandidates(env = process.env) {
  const candidates = [
    { label: 'PATH pnpm', command: 'pnpm', argsPrefix: [] },
    { label: 'corepack pnpm', command: 'corepack', argsPrefix: ['pnpm'] },
  ];

  if (process.platform === 'win32' && env.APPDATA) {
    candidates.push({
      label: 'Windows user pnpm shim',
      command: path.join(env.APPDATA, 'npm', 'pnpm.cmd'),
      argsPrefix: [],
    });
  }

  return candidates;
}

export function resolvePinnedPnpm(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const spawnSync = options.spawnSync ?? nodeSpawnSync;
  const packageManagerSpec = options.packageManagerSpec ?? readPackageManagerSpec(cwd);
  const parsed = parsePackageManagerSpec(packageManagerSpec);

  if (parsed.name !== 'pnpm') {
    throw new Error(`Expected packageManager to use pnpm, got ${parsed.name}`);
  }

  const attempts = [];
  for (const candidate of options.candidates ?? defaultPnpmCandidates(env)) {
    const args = [...candidate.argsPrefix, '--version'];
    const result = spawnSync(candidate.command, args, {
      cwd,
      env,
      encoding: 'utf8',
      shell: shouldUseShell(candidate.command),
      windowsHide: true,
    });
    const stdout = toText(result.stdout);
    const stderr = toText(result.stderr);
    const version = result.status === 0 ? extractVersion(stdout) : undefined;
    const attempt = {
      label: candidate.label,
      command: candidate.command,
      argsPrefix: candidate.argsPrefix,
      status: result.status,
      version,
      stdout,
      stderr,
      error: result.error?.message,
    };
    attempts.push(attempt);

    if (version === parsed.version) {
      return {
        ok: true,
        packageManagerSpec,
        expectedVersion: parsed.version,
        label: candidate.label,
        command: candidate.command,
        argsPrefix: candidate.argsPrefix,
        version,
        attempts,
      };
    }
  }

  return {
    ok: false,
    packageManagerSpec,
    expectedVersion: parsed.version,
    attempts,
  };
}

export function buildPnpmMismatchMessage(resolution) {
  if (resolution.ok) {
    return `Using pnpm ${resolution.version} via ${resolution.label}.`;
  }

  const attemptLines = resolution.attempts.map((attempt) => {
    if (attempt.version) {
      return `- ${attempt.label}: ${attempt.version}`;
    }
    const reason = attempt.error || attempt.stderr.trim() || `exit ${attempt.status}`;
    return `- ${attempt.label}: unavailable (${reason})`;
  });

  return [
    `Expected pnpm ${resolution.expectedVersion} from package.json packageManager.`,
    'No available pnpm candidate matched that version.',
    ...attemptLines,
    '',
    'Repair this shell by putting the pinned user pnpm shim before the Codex runtime pnpm:',
    `$env:PATH = '${DEFAULT_WINDOWS_PNPM_DIR};' + $env:PATH`,
    '',
    'Or bypass PATH for verification commands:',
    'node scripts/run-with-pinned-pnpm.mjs <pnpm args...>',
  ].join('\n');
}

export function runWithPinnedPnpm(args, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const spawnSync = options.spawnSync ?? nodeSpawnSync;
  const resolution = resolvePinnedPnpm({ ...options, cwd, env, spawnSync });

  if (!resolution.ok) {
    options.stderr?.write?.(`${buildPnpmMismatchMessage(resolution)}\n`);
    return { status: 1, resolution };
  }

  options.stdout?.write?.(`Using pnpm ${resolution.version} via ${resolution.label}\n`);
  const result = spawnSync(resolution.command, [...resolution.argsPrefix, ...args], {
    cwd,
    env,
    stdio: options.stdio ?? 'inherit',
    shell: shouldUseShell(resolution.command),
    windowsHide: true,
  });

  return {
    status: typeof result.status === 'number' ? result.status : 1,
    resolution,
  };
}

function isCliEntry() {
  return isMainEntrypoint(import.meta.url);
}

if (isCliEntry()) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node scripts/run-with-pinned-pnpm.mjs <pnpm args...>');
    process.exit(2);
  }
  const result = runWithPinnedPnpm(args, {
    stdout: process.stdout,
    stderr: process.stderr,
  });
  process.exit(result.status);
}
