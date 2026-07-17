/**
 * P0-003 test gate validator.
 * - Enforces passWithNoTests:false in vitest configs
 * - Ensures empty test shards fail
 * - Ensures daily/cached/smoke cannot be classified as release evidence
 * - Emits machine-executable release gate list
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const listOnly = args.includes('--list');
const loopArg = (() => {
  const i = args.indexOf('--loop');
  return i >= 0 ? args[i + 1] : null;
})();
const skipEmptyShard = args.includes('--skip-empty-shard');

const FAIL = [];
const WARN = [];
const INFO = [];
const fail = (m) => FAIL.push(m);
const warn = (m) => WARN.push(m);
const info = (m) => INFO.push(m);

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}

const gates = readJson('plans/system-maturity/gates.json');

// Policy checks
const daily = gates.loops.dailyFast;
const pr = gates.loops.prFull;
const release = gates.loops.release;

if (daily.substitutesForRelease !== false) fail('dailyFast.substitutesForRelease must be false');
if (daily.substitutesForPrFull !== false) fail('dailyFast.substitutesForPrFull must be false');
if (pr.substitutesForRelease !== false) fail('prFull.substitutesForRelease must be false');
info('A2 daily/pr loops cannot substitute release');

for (const bad of release.forbiddenAsReleaseEvidence || []) {
  const releaseCmds = (release.commands || []).map((c) => c.id);
  if (releaseCmds.includes(bad)) fail(`release commands include forbidden evidence id ${bad}`);
}
info('A2 forbidden release evidence ids not present in release.commands');

// vitest passWithNoTests
for (const cfg of gates.vitestPolicy.configs || []) {
  const abs = path.join(root, cfg);
  if (!fs.existsSync(abs)) {
    warn(`vitest config missing: ${cfg}`);
    continue;
  }
  const text = fs.readFileSync(abs, 'utf8');
  if (/passWithNoTests\s*:\s*true/.test(text)) {
    fail(`${cfg} sets passWithNoTests:true`);
  } else if (!/passWithNoTests\s*:\s*false/.test(text)) {
    fail(`${cfg} must explicitly set passWithNoTests:false`);
  } else {
    info(`${cfg} passWithNoTests:false`);
  }
}

// A1 empty shard must fail
if (!skipEmptyShard) {
  const emptyTarget = 'tests/unit/__maturity_empty_shard_must_not_exist__.test.ts';
  const r = spawnSync(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['exec', 'vitest', 'run', '--config', 'vitest.config.ts', emptyTarget],
    { cwd: root, encoding: 'utf8', env: process.env },
  );
  const code = r.status ?? 1;
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  if (code === 0) {
    fail('A1 empty test shard unexpectedly passed (passWithNoTests may be enabled)');
  } else {
    info(`A1 empty test shard failed as required (exit=${code})`);
  }
  fs.mkdirSync(path.join(root, 'artifacts/system-maturity/P0-003'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'artifacts/system-maturity/P0-003/empty-shard.stdout.txt'),
    out,
  );
}

// A3 machine-executable list
const selectedLoop = loopArg || 'release';
const loop = gates.loops[selectedLoop] || gates.loops.release;
const commandList = (loop.commands || []).map((c) => c.run);

if (listOnly) {
  console.log(JSON.stringify({ loop: selectedLoop, commands: commandList }, null, 2));
}

const report = {
  schemaVersion: 1,
  task: 'P0-003',
  checkedAt: new Date().toISOString(),
  ok: FAIL.length === 0,
  selectedLoop,
  releaseCommands: (gates.loops.release.commands || []).map((c) => c.run),
  prCommands: (gates.loops.prFull.commands || []).map((c) => c.run),
  dailyCommands: (gates.loops.dailyFast.commands || []).map((c) => c.run),
  fail: FAIL,
  warn: WARN,
  info: INFO,
};

const outDir = path.join(root, 'artifacts/system-maturity/P0-003');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'validate-test-gates.json'), JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(
  path.join(outDir, 'release-gates.commands.json'),
  JSON.stringify({ loop: 'release', commands: report.releaseCommands }, null, 2) + '\n',
);

for (const m of INFO) console.log(`INFO  ${m}`);
for (const m of WARN) console.warn(`WARN  ${m}`);
for (const m of FAIL) console.error(`FAIL  ${m}`);

if (FAIL.length) {
  console.error(`\nvalidate-test-gates: FAILED (${FAIL.length})`);
  process.exit(1);
}
console.log('\nvalidate-test-gates: OK');
process.exit(0);