#!/usr/bin/env zx

import 'zx/globals';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const lockPath = join(ROOT, 'build', 'preinstalled-skills', '.preinstalled-lock.json');
const bundleScript = join(ROOT, 'scripts', 'bundle-preinstalled-skills.mjs');

if (process.env.VERSE_CLAW_SKIP_PREINSTALLED_SKILLS_PREPARE === '1') {
  echo`Skipping preinstalled skills prepare (VERSE_CLAW_SKIP_PREINSTALLED_SKILLS_PREPARE=1).`;
  process.exit(0);
}

if (existsSync(lockPath)) {
  echo`Preinstalled skills bundle already exists, skipping prepare.`;
  process.exit(0);
}

echo`Preinstalled skills bundle missing, preparing for dev startup...`;

function runNodeScript(scriptPath) {
  return new Promise((resolve, reject) => {
    // Avoid zx template string interpolation of Windows paths: backslashes like
    // \U, \D, \c become escape sequences and mangle the path (Users933\Desktopawx).
    // Pass path via argv with shell:false so separators stay literal.
    const child = spawn(process.execPath, [scriptPath], {
      cwd: ROOT,
      stdio: 'inherit',
      shell: false,
      env: process.env,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`bundle-preinstalled-skills exited with code ${code}`));
    });
  });
}

try {
  await runNodeScript(bundleScript);
} catch (error) {
  // Dev startup should remain available even if network-based skill fetching fails.
  echo`Warning: failed to prepare preinstalled skills for dev startup: ${error?.message || error}`;
  process.exit(0);
}
