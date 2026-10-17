import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_RUNTIME = resolve(ROOT, '.local/runtime/node.exe');
const MIN_UV = [1, 52, 1];

export function isCompatibleRuntime(runtime = process) {
  if (runtime.platform !== 'win32') return true;
  const parts = String(runtime.versions?.uv ?? '').split('.').map(Number);
  if (parts.some(Number.isNaN)) return false;
  for (let index = 0; index < MIN_UV.length; index += 1) {
    if ((parts[index] ?? 0) !== MIN_UV[index]) return (parts[index] ?? 0) > MIN_UV[index];
  }
  return true;
}

async function inspectRuntime(executable) {
  try {
    const { stdout } = await execFileAsync(executable, ['-e', 'process.stdout.write(JSON.stringify({ platform: process.platform, versions: { node: process.version, uv: process.versions.uv } }))'], {
      windowsHide: true,
      timeout: 3000,
      maxBuffer: 4096,
    });
    const runtime = JSON.parse(stdout);
    return isCompatibleRuntime(runtime) ? runtime : null;
  } catch {
    return null;
  }
}

export async function resolveCompatibleNode({ current = process, candidates = [process.env.VERSEBROWSER_NODE, LOCAL_RUNTIME] } = {}) {
  if (isCompatibleRuntime(current)) return current.execPath;
  for (const candidate of candidates) {
    if (!candidate) continue;
    const executable = resolve(String(candidate));
    if (executable === current.execPath || !existsSync(executable)) continue;
    if (await inspectRuntime(executable)) return executable;
  }
  return null;
}

async function main() {
  const [target, ...args] = process.argv.slice(2);
  if (!target) {
    console.error('usage: with-compatible-node.mjs <script> [args...]');
    process.exitCode = 2;
    return;
  }
  const executable = await resolveCompatibleNode();
  if (!executable) {
    console.error(
      `E_NODE_RUNTIME: Windows browser operations require libuv >=1.52.1 (Node.js 24.16.0 or later). ` +
      'Install a supported Node.js runtime or set VERSEBROWSER_NODE to its node.exe path.',
    );
    process.exitCode = 1;
    return;
  }
  const targetPath = resolve(ROOT, target);
  const nodeArgs = extname(targetPath) === '.ts' ? ['--experimental-strip-types'] : [];
  const child = spawn(executable, [...nodeArgs, targetPath, ...args], { stdio: 'inherit', windowsHide: true });
  child.on('error', error => {
    console.error(`failed to start compatible Node.js runtime: ${error.message}`);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
