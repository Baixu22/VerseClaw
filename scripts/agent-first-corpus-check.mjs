#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { checkCorpus } from './lib/agent-first-task-corpus.mjs';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

export function checkAgentFirstCorpus(root = resolve(import.meta.dirname, '..')) {
  return { schemaVersion: 'AgentFirstCorpusValidation/v1', driven_by: 'agent', actor: 'codex/agent-first-corpus-checker', scope: 'task definitions and deterministic grader calibration, not current-system evaluation', ...checkCorpus(root) };
}

if (isMainEntrypoint(import.meta.url)) {
  const report = checkAgentFirstCorpus();
  const index = process.argv.indexOf('--out');
  if (index !== -1) {
    const path = resolve(process.argv[index + 1]);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify({ ok: report.ok, taskCount: report.taskCount, counts: report.counts, calibration: report.calibration.length, errors: report.errors, evaluationStatus: report.evaluationStatus }));
  if (!report.ok) process.exitCode = 1;
}
