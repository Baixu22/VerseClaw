// Rebuilds the throwaway TF-0084 acceptance candidate at D:/ClawX-tf0084-candidate.
//
//   node scripts/tf0084-build-candidate.mjs
//
// Layout: HEAD -> base commit (TF-0079..TF-0083 owned files + inherited
// uncommitted dependencies owned by other workstreams) -> candidate commit
// (TF-0084's own new artifacts). `--since <base>` then diffs exactly TF-0084's
// paths, so the harness changed-path ownership check is meaningful.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'D:/ClawX';
const DST = 'D:/ClawX-tf0084-candidate';
const BASE_REF = 'e07b874b3';

const TF0084_NEW = [
  'harness/specs/tasks/session-ecosystem-lifecycle-ledger-acceptance.md',
  'openclaw_runtime/src/gateway/server-methods/session-lifecycle-owner-views.ts',
  'openclaw_runtime/src/gateway/server-methods/session-lifecycle-ledger.ts',
  'openclaw_runtime/src/gateway/server-methods/session-lifecycle-ledger.test.ts',
  'openclaw_runtime/src/gateway/server-methods/session-lifecycle-consistency.test.ts',
  'openclaw_runtime/src/gateway/session-ecosystem-lifecycle-reachability.test.ts',
];

// Uncommitted files owned by OTHER workstreams that the TF-0078 chain imports.
// Recharacterized by TF-0088 (2026-08-23): the 26 formerly listed chain-owned
// files moved into spec touchedAreas declarations (see
// session-ecosystem-goal-wake-continuation.md and the amended
// cross-session-control / safety-gate specs); the stale subagent-control.ts
// entry was removed. Remaining entries are genuine cross-workstream
// dependencies (TF-0072 lineage chain, DCS/SEKB bridges, git-api,
// session-activity-sidebar, content-provenance).
const INHERITED = JSON.parse(
  fs.readFileSync(path.join(SRC, 'scripts/tf0084-candidate-inherited.json'), 'utf8'),
);

const SPECS = [
  'session-ecosystem-production-reachability',
  'session-ecosystem-safety-gate-consistency',
  'session-ecosystem-resource-reclamation',
  'session-ecosystem-cross-session-control',
  'runtime-lifecycle-governance',
  'runtime-lifecycle-governance-ga-hardening',
  'session-ecosystem-lifecycle-ledger-acceptance',
  'session-ecosystem-goal-wake-continuation',
  'session-ecosystem-audit-remediation',
].map((id) => `harness/specs/tasks/${id}.md`);

function ownedPatterns() {
  const owned = new Set();
  for (const spec of SPECS) {
    // Normalise CRLF first: some specs in this repo are checked out with CRLF and
    // an anchored `\n` pattern would silently match nothing, quietly shrinking
    // the owned set instead of failing.
    const text = fs.readFileSync(path.join(SRC, spec), 'utf8').replace(/\r\n/g, '\n');
    const block = /^touchedAreas:\n((?:  - .*\n)+)/m.exec(text);
    if (!block) throw new Error(`spec has no touchedAreas block: ${spec}`);
    for (const line of block[1].split('\n')) {
      const value = line.trim().replace(/^-\s*/, '');
      if (value) owned.add(value);
    }
  }
  return [...owned];
}

function isOwned(file, owned) {
  return owned.some((pattern) =>
    pattern.endsWith('/**') ? file.startsWith(pattern.slice(0, -2)) : file === pattern,
  );
}

function git(args, cwd = DST) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function copy(files) {
  let copied = 0;
  for (const file of files) {
    const from = path.join(SRC, file);
    if (!fs.existsSync(from) || !fs.statSync(from).isFile()) continue;
    const to = path.join(DST, file);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    copied += 1;
  }
  return copied;
}

function commit(message) {
  git(['add', '-A']);
  git(['-c', 'user.name=TF-0084 Candidate', '-c', 'user.email=candidate@local', 'commit', '-q', '-m', message]);
  return git(['rev-parse', 'HEAD']).trim();
}

const owned = ownedPatterns();
const dirty = git(['status', '--porcelain'], SRC)
  .split('\n')
  .map((line) => line.slice(3).trim())
  .filter(Boolean);
const baseFiles = dirty.filter((file) => isOwned(file, owned) && !TF0084_NEW.includes(file));

git(['reset', '-q', '--hard', BASE_REF]);
git(['clean', '-qfd']);

const baseCopied = copy([...baseFiles, ...INHERITED]);
const baseSha = commit(
  'base(tf-0078-chain): TF-0079..TF-0083 owned files, TF-0084 edits to shared files, and inherited uncommitted dependencies',
);
const candidateCopied = copy(TF0084_NEW);
const candidateSha = commit(
  'candidate(tf-0084): read-only lifecycle ledger, shared owner-read layer and lifecycle reachability census',
);

const diff = git(['diff', '--name-only', `${baseSha}`, candidateSha]).split('\n').filter(Boolean);
console.log(
  JSON.stringify(
    {
      baseRef: BASE_REF,
      baseSha,
      candidateSha,
      baseOwnedFiles: baseFiles.length,
      inheritedFiles: INHERITED.length,
      baseCopied,
      candidateCopied,
      candidateDiff: diff,
      worktreeClean: git(['status', '--porcelain']).trim() === '',
    },
    null,
    2,
  ),
);
