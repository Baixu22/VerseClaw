#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME_ROOT = join(ROOT, 'openclaw_runtime');
const ENTRY = join(RUNTIME_ROOT, 'dist', 'entry.js');
const PROVIDER_WRAPPER = join(
  RUNTIME_ROOT,
  'dist-runtime',
  'extensions',
  'deepseek',
  'provider-policy-api.js',
);
const PROVIDER_ARTIFACT = join(
  RUNTIME_ROOT,
  'dist',
  'extensions',
  'deepseek',
  'provider-policy-api.js',
);
const TOKEN = 'clawx-runtime-build-smoke';
const TIMEOUT_MS = 90_000;

function allocatePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('failed to allocate runtime smoke port')));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve(true);
  return Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}

async function stopChild(child) {
  if (child.exitCode !== null || child.pid === undefined) return;
  child.kill();
  if (await waitForExit(child, 5_000)) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    child.kill('SIGKILL');
  }
  await waitForExit(child, 5_000);
}

async function waitForReady(port, child, output) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`gateway exited before ready (code ${child.exitCode})\n${output()}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/readyz`, {
        signal: AbortSignal.timeout(3_000),
      });
      const body = await response.json();
      if (response.ok && body?.ready === true) return;
    } catch {
      // Gateway is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`gateway did not become ready within ${TIMEOUT_MS}ms\n${output()}`);
}

for (const artifact of [ENTRY, PROVIDER_WRAPPER, PROVIDER_ARTIFACT]) {
  if (!existsSync(artifact)) {
    throw new Error(`required runtime build artifact is missing: ${artifact}`);
  }
}

// This wrapper is the exact boundary that a core-only clean build broke: it
// resolves through dist-runtime into the public bundled-provider artifact.
await import(pathToFileURL(PROVIDER_WRAPPER).href);

const tempRoot = mkdtempSync(join(tmpdir(), 'clawx-runtime-smoke-'));
const stateDir = join(tempRoot, 'state');
const configPath = join(tempRoot, 'openclaw.json');
writeFileSync(configPath, `${JSON.stringify({
  gateway: { mode: 'local', controlUi: { enabled: false } },
}, null, 2)}\n`);

const port = await allocatePort();
let outputTail = '';
const child = spawn(
  process.execPath,
  [
    ENTRY,
    'gateway',
    'run',
    '--port',
    String(port),
    '--bind',
    'loopback',
    '--token',
    TOKEN,
    '--tailscale',
    'off',
    '--allow-unconfigured',
  ],
  {
    cwd: RUNTIME_ROOT,
    env: {
      ...process.env,
      OPENCLAW_CONFIG_PATH: configPath,
      OPENCLAW_STATE_DIR: stateDir,
      OPENCLAW_DISABLE_BONJOUR: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  },
);

const appendOutput = (chunk) => {
  outputTail = `${outputTail}${chunk.toString('utf8')}`.slice(-16_000);
};
child.stdout?.on('data', appendOutput);
child.stderr?.on('data', appendOutput);

try {
  await waitForReady(port, child, () => outputTail);
  console.log(`[runtime-build-smoke] gateway ready on port ${port}`);
} finally {
  await stopChild(child);
  rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
