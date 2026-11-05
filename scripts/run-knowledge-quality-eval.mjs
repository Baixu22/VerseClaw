import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

// Reuse Vite's installed build toolchain; esbuild is not a root dependency.
const { build } = createRequire(import.meta.resolve('vite'))('esbuild');

const output = resolve(process.argv[2] ?? 'D:/tmp/knowledge-quality-eval');
if (process.platform === 'win32' && !/^[dD]:[\\/]/.test(output)) throw Error('Evaluation artifacts must be on D:');
await mkdir(output, { recursive: true });
const entry = join(output, 'knowledge-quality-eval.mjs');
await build({ entryPoints: [fileURLToPath(new URL('./knowledge-quality-eval.ts', import.meta.url))], outfile: entry,
  bundle: true, platform: 'node', format: 'esm', packages: 'external' });
const child = spawn(process.execPath, [entry, output], { stdio: 'inherit', windowsHide: true });
process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
