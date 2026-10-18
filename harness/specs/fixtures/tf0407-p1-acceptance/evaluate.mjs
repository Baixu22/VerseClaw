#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const fixture = resolve(process.argv[2] ?? 'harness/specs/fixtures/tf0407-p1-acceptance');
const output = resolve(process.argv[3] ?? resolve(fixture, 'comparison.json'));
const before = JSON.parse(await readFile(resolve(fixture, 'before-controlled.json'), 'utf8'));
const after = JSON.parse(await readFile(resolve(fixture, 'after-controlled.json'), 'utf8'));
const pureBefore = JSON.parse(await readFile(resolve(fixture, 'pure-idle-before.json'), 'utf8'));
const pureAfter = JSON.parse(await readFile(resolve(fixture, 'pure-idle-after.json'), 'utf8'));
const beforeSpawns = before.main.counters.spawnCount;
const afterSpawns = after.main.counters.spawnCount;
const reduction = beforeSpawns === 0 ? 0 : (beforeSpawns - afterSpawns) / beforeSpawns;
const comparison = {
  schema: 'clawx.tf0407.p1-comparison/v1',
  driven_by: 'agent',
  actor: 'codex-tf0407-evaluator',
  controlled: {
    beforeCandidate: before.candidate,
    afterCandidate: after.candidate,
    beforeReadCount: before.readCallCount,
    afterReadCount: after.readCallCount,
    beforeSpawnCount: beforeSpawns,
    afterSpawnCount: afterSpawns,
    reduction,
    reductionPercent: Math.round(reduction * 10000) / 100,
    targetAtLeast80Percent: reduction >= 0.8,
    readErrorCount: before.readErrorCount + after.readErrorCount,
  },
  pureIdle: {
    beforeCandidate: pureBefore.candidate,
    afterCandidate: pureAfter.candidate,
    beforeSpawnCount: pureBefore.main.counters.spawnCount,
    afterSpawnCount: pureAfter.main.counters.spawnCount,
    note: 'No repeated git status reads occurred in pure idle; both runs observed the same 7 startup spawns. This is retained as counter-evidence and is not used as the controlled read-path target.',
  },
  boundaries: [
    'The controlled path issues git.status once per second for five minutes from the renderer host bridge.',
    'The pure-idle result is explicitly not a reduction claim.',
    'The pre-P1 build is instrumentation-only: commit a41d68cfc4dee3cd5df688e51b35deb4709f8123.',
  ],
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(comparison, null, 2) + '\n');
console.log(JSON.stringify({ output, ...comparison.controlled, pureIdle: comparison.pureIdle }, null, 2));
