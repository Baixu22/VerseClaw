#!/usr/bin/env node
/**
 * Fail if source files start with a UTF-8 BOM (EF BB BF).
 * BOMs break shebang parsing (openclaw_runtime/src/index.ts) and some parsers.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const ROOTS = [
  'electron',
  'src',
  'shared',
  'scripts',
  'tests',
  'harness',
  'openclaw_runtime/src',
  'openclaw_runtime/extensions',
  'openclaw_runtime/packages',
];
const ROOT_FILES = [
  'package.json',
  'pnpm-workspace.yaml',
  'vite.config.ts',
  'electron-builder.yml',
  'tsconfig.json',
  'tsconfig.node.json',
  'tsconfig.web.json',
];
const EXTS = new Set(['.ts', '.tsx', '.mjs', '.js', '.cjs', '.json', '.yaml', '.yml']);
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-electron',
  '.git',
  'coverage',
  'artifacts',
  'build',
  'out',
  'release',
  '.vite',
  '.tmp',
]);

const bomFiles = [];

function checkFile(full) {
  let buf;
  try {
    buf = readFileSync(full);
  } catch {
    return;
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    bomFiles.push(relative(ROOT, full).replace(/\\/g, '/'));
  }
}

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full);
      continue;
    }
    const ext = entry.name.includes('.') ? entry.name.slice(entry.name.lastIndexOf('.')) : '';
    if (!EXTS.has(ext)) continue;
    checkFile(full);
  }
}

for (const file of ROOT_FILES) {
  checkFile(join(ROOT, file));
}
for (const root of ROOTS) {
  walk(join(ROOT, root));
}

if (bomFiles.length > 0) {
  console.error('UTF-8 BOM detected in:');
  for (const file of bomFiles) console.error(`  ${file}`);
  console.error('Strip BOM (keep content); shebang files must start with #! bytes.');
  process.exit(1);
}

console.log('check-no-bom: ok');