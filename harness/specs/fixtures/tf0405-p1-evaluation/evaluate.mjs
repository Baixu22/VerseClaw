#!/usr/bin/env node
/** TF-0405 measured evaluation for read-only caching and polling behavior. */
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] ?? process.cwd());
const out = resolve(process.argv[3] ?? 'D:/tmp/tf0405-evaluation.json');
const started = Date.now();
const { createGitApi, clearGitStatusCacheForTest } = await import(pathToFileURL(resolve(root, 'electron/services/git-api.ts')).href);
const { createPollScheduler } = await import(pathToFileURL(resolve(root, 'src/lib/poll-scheduler.ts')).href);
const api = createGitApi();
clearGitStatusCacheForTest();
const coldStart = performance.now();
const cold = await api.status();
const coldMs = performance.now() - coldStart;
const warmStart = performance.now();
const warm = await api.status();
const warmMs = performance.now() - warmStart;
const concurrent = await Promise.all([api.status(), api.status(), api.status()]);
let polls = 0;
let visible = true;
const stop = createPollScheduler({ intervalMs: 20, task: () => { polls += 1; }, isVisible: () => visible });
await new Promise(resolveWait => setTimeout(resolveWait, 100));
visible = false;
const beforeHidden = polls;
await new Promise(resolveWait => setTimeout(resolveWait, 100));
const hiddenDelta = polls - beforeHidden;
stop();
const result = {
  schema: 'clawx.tf0405.resource-evaluation/v1',
  driven_by: 'agent',
  actor: 'codex-tf0405',
  candidate: execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  measuredAt: new Date().toISOString(),
  durationMs: Date.now() - started,
  gitReadOnly: {
    coldMs,
    warmMs,
    warmFaster: warmMs < coldMs,
    coldStatus: cold.status,
    warmStatus: warm.status,
    concurrentResolved: concurrent.length,
  },
  scheduling: { pollsBeforeHidden: beforeHidden, pollsWhileHidden: hiddenDelta, stopsWhenHidden: hiddenDelta === 0 },
  boundaries: [
    'This is an in-process renderer/Main module evaluation, not an OS spawn-count benchmark.',
    'The actual cwd Git status calls may use native filesystem cache; no synthetic values are substituted.',
    'No real-human evidence is claimed.',
    'TF-0405 does not claim spawn-count reduction; TF-0398 remains the milestone gate for that target.',
  ],
};
await mkdir(dirname(out),{recursive:true});
await writeFile(out, JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({out,result},null,2));
