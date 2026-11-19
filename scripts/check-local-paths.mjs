#!/usr/bin/env node
/** Reject developer-local absolute paths in active repository documentation. */
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_PATH_PATTERN = /(?:Users[\\/]27933|file:\/\/\/c:\/Users|C:\\Users\\27933|C:\/Users\/27933)/i;
// This sealed review is consumed byte-for-byte by its original SHA256SUMS.
const SEALED_REVIEWS = new Map([
  ['docs/dev/evidence/project-rag/RAG-12/20261116-258457d6a/independent-review-notes.md', 'e49dede04f15312e778e4fbdd56349ffc0a25367b9de663b52d52135c49d8284'],
]);

export function findLocalPathDocs(root = ROOT) {
  const files = execFileSync('git', ['ls-files', 'AGENTS.md', 'docs/**/*.md'], { cwd: root, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);
  const findings = [];
  for (const file of files) {
    const bytes = readFileSync(resolve(root, file));
    if (SEALED_REVIEWS.get(file) === createHash('sha256').update(bytes).digest('hex')) continue;
    const lines = bytes.toString('utf8').split(/\r?\n/);
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

if (isMainEntrypoint(import.meta.url)) main();
