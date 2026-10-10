#!/usr/bin/env node
/** Reject developer-local absolute paths in active repository documentation. */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_PATH_PATTERN = /(?:Users[\\/]27933|file:\/\/\/c:\/Users|C:\\Users\\27933|C:\/Users\/27933)/i;

export function findLocalPathDocs(root = ROOT) {
  const files = execFileSync('git', ['ls-files', 'AGENTS.md', 'docs/**/*.md'], { cwd: root, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);
  const findings = [];
  for (const file of files) {
    const lines = readFileSync(resolve(root, file), 'utf8').split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (LOCAL_PATH_PATTERN.test(line)) findings.push({ file, line: index + 1, text: line.trim() });
    }
  }
  return findings;
}

function main() {
  const findings = findLocalPathDocs(ROOT);
  if (findings.length > 0) {
    console.error('[local-paths] FAIL developer-local paths in active docs:');
    for (const finding of findings) console.error(`  ${finding.file}:${finding.line} ${finding.text}`);
    process.exitCode = 1;
    return;
  }
  console.log('[local-paths] PASS active docs contain no developer-local absolute paths');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
