#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { summarizeCodingRunJsonl } from '../shared/types/coding-run.ts';

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/coding-run-summary.mjs <coding-run.jsonl>');
    process.exitCode = 2;
    return;
  }
  let input;
  try {
    input = readFileSync(resolve(file), 'utf8');
  } catch (error) {
    console.error(`Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
    return;
  }
  const summary = summarizeCodingRunJsonl(input);
  if ('status' in summary && summary.status === 'error') {
    console.error(JSON.stringify(summary));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
