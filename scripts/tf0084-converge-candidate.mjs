// One-off convergence driver for the TF-0084 acceptance candidate.
//
//   node scripts/tf0084-converge-candidate.mjs [maxRounds]
//
// Repeatedly rebuilds the detached candidate, typechecks it, and adds to
// scripts/tf0084-candidate-inherited.json any file the typecheck names that is
// uncommitted in the authoritative tree. It stops when the typecheck is clean,
// when a round adds nothing (the remaining errors are not fixable by importing
// an uncommitted file), or at maxRounds.
//
// Everything happens inside the throwaway worktree: no commit is made on the
// shared branch, and the measured inherited set is the evidence either way.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'D:/ClawX';
const DST = 'D:/ClawX-tf0084-candidate';
const INHERITED_PATH = path.join(SRC, 'scripts/tf0084-candidate-inherited.json');
const maxRounds = Number(process.argv[2] ?? 8);

function run(cmd, args, cwd, allowFail = false) {
  try {
    return { ok: true, out: execFileSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) };
  } catch (error) {
    if (!allowFail) throw error;
    return { ok: false, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

function dirtyPaths() {
  return new Set(
    run('git', ['status', '--porcelain'], SRC)
      .out.split('\n')
      .map((line) => line.slice(3).trim())
      .filter(Boolean),
  );
}

function errorFiles(output) {
  const files = new Set();
  for (const line of output.split('\n')) {
    // tsc: "path/to/file.ts(12,3): error TS1234: ..."
    const match = /^(.+?)\((\d+),(\d+)\): error TS/.exec(line.trim());
    if (match) files.add(match[1].replace(/\\/g, '/'));
  }
  return [...files];
}

const rounds = [];
for (let round = 1; round <= maxRounds; round += 1) {
  run('node', ['scripts/tf0084-build-candidate.mjs'], SRC);
  run('node', ['scripts/generate-ext-bridge.mjs'], DST, true);
  const tsc = run(
    'node',
    ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.node.json', '--composite', 'false'],
    DST,
    true,
  );
  const failures = errorFiles(tsc.out);
  const inherited = JSON.parse(fs.readFileSync(INHERITED_PATH, 'utf8'));
  const dirty = dirtyPaths();
  const added = failures.filter((file) => dirty.has(file) && !inherited.includes(file));
  rounds.push({ round, typecheckClean: tsc.ok, errorFiles: failures.length, added });
  console.log(
    `round ${round}: typecheck ${tsc.ok ? 'CLEAN' : 'errors'} | error files ${failures.length} | adding ${added.length}${added.length ? `: ${added.join(', ')}` : ''}`,
  );
  if (tsc.ok) break;
  if (added.length === 0) {
    console.log('unfixable by importing uncommitted files; remaining errors:');
    console.log(tsc.out.split('\n').filter((line) => line.includes('error TS')).slice(0, 12).join('\n'));
    break;
  }
  fs.writeFileSync(INHERITED_PATH, `${JSON.stringify([...inherited, ...added], null, 2)}\n`, 'utf8');
}

console.log(
  JSON.stringify(
    {
      rounds,
      inheritedCount: JSON.parse(fs.readFileSync(INHERITED_PATH, 'utf8')).length,
    },
    null,
    2,
  ),
);
