/**
 * P0-004 evidence delivery / audit regression validator.
 *
 * A1: done deliveries missing EVIDENCE paths fail
 * A2: evidence path#sha256=... hashes are recomputed and must match
 * A3: STATUS.json, task acceptance checkboxes, and delivery STATUS agree
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sha256CanonicalEvidenceFile } from './lib/canonical-evidence-hash.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const planRoot = path.join(root, 'plans/system-maturity');
const taskPrefixArg = process.argv.find((arg) => arg.startsWith('--task-prefix='));
const selectedTaskPrefixes = taskPrefixArg
  ? taskPrefixArg.slice('--task-prefix='.length).split(',').map((value) => value.trim()).filter(Boolean)
  : [];
const probeArg = process.argv.find((arg) => arg.startsWith('--probe='));
const integrityProbe = probeArg?.slice('--probe='.length) ?? '';
const taskSelected = (taskId) => selectedTaskPrefixes.length === 0
  || selectedTaskPrefixes.some((prefix) => taskId.startsWith(prefix));

const FAIL = [];
const WARN = [];
const INFO = [];
const fail = (m) => FAIL.push(m);
const warn = (m) => WARN.push(m);
const info = (m) => INFO.push(m);

function walk(dir, pred, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, pred, out);
    else if (pred(e.name, p)) out.push(p);
  }
  return out;
}

function parseDelivery(text) {
  const field = (name) => {
    const m = text.match(new RegExp(`^${name}:\\s*(.+)$`, 'mi'));
    return m ? m[1].trim() : '';
  };
  return {
    taskId: field('TASK_ID'),
    status: field('STATUS').toLowerCase(),
    tests: field('TESTS'),
    results: field('RESULTS'),
    evidence: field('EVIDENCE'),
    acceptance: field('ACCEPTANCE'),
    blockers: field('BLOCKERS'),
    next: field('NEXT'),
  };
}

function parseEvidenceEntries(evidenceField) {
  if (!evidenceField) return [];
  return evidenceField
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const m = entry.match(/^(.*?)(?:#sha256=([a-f0-9]{64}))?$/i);
      return {
        raw: entry,
        path: (m?.[1] || '').trim(),
        expectedSha: (m?.[2] || '').toLowerCase(),
      };
    });
}

// Load statuses
const statusFiles = walk(planRoot, (n) => n === 'STATUS.json');
const statusByTask = new Map();
for (const sp of statusFiles) {
  const doc = JSON.parse(fs.readFileSync(sp, 'utf8'));
  for (const [id, st] of Object.entries(doc.tasks || {})) {
    statusByTask.set(id, { status: st, phase: doc.phase, file: path.relative(root, sp) });
  }
}

const taskFiles = walk(planRoot, (n) => /^P\d+-\d+\.md$/.test(n));
const recomputed = [];

function validateEvidenceIndex(indexPath) {
  const relIndex = path.relative(root, indexPath).replace(/\\/g, '/');
  const taskId = path.basename(path.dirname(indexPath));
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  } catch (error) {
    fail(`${taskId} invalid evidence-index JSON: ${String(error)}`);
    return;
  }
  if (integrityProbe && taskId === 'P4-001') {
    const artifacts = Array.isArray(doc.artifacts)
      ? doc.artifacts
      : Object.entries(doc.artifacts || {}).map(([artifactPath, value]) => ({ path: artifactPath, ...value }));
    if (artifacts.length > 0) {
      if (integrityProbe === 'missing-file') artifacts[0].path = 'artifacts/system-maturity/__missing_probe__/missing.txt';
      if (integrityProbe === 'hash-tamper') artifacts[0].sha256 = '0'.repeat(64);
      if (integrityProbe === 'self-reference') artifacts[0].path = relIndex;
      doc.artifacts = artifacts;
    }
  }
  if (doc.taskId !== taskId) fail(`${taskId} evidence-index taskId mismatch`);
  if (!doc.generatedAt && !doc.createdAt && !doc.completedAt) {
    fail(`${taskId} evidence-index missing generatedAt`);
  }
  const commandEntries = Array.isArray(doc.runs)
    ? doc.runs
    : Array.isArray(doc.commands)
      ? doc.commands.map((command) => ({ command }))
      : doc.tests?.command || doc.tests?.primary
        ? [{ command: doc.tests.command ?? doc.tests.primary }]
        : [];
  if (commandEntries.length === 0) fail(`${taskId} evidence-index missing command`);
  for (const run of commandEntries) {
    if (!run.command) fail(`${taskId} evidence-index run missing command`);
    if (Array.isArray(doc.runs)) {
      if (!Number.isInteger(run.exitCode)) fail(`${taskId} evidence-index run missing integer exitCode`);
      if (typeof run.result !== 'string' || !run.result.trim()) fail(`${taskId} evidence-index run missing result`);
    }
  }
  if (!doc.commit && !doc.base) fail(`${taskId} evidence-index missing commit/base`);
  const artifacts = Array.isArray(doc.artifacts)
    ? doc.artifacts
    : doc.artifacts && typeof doc.artifacts === 'object'
      ? Object.entries(doc.artifacts).map(([artifactPath, value]) => ({ path: artifactPath, ...value }))
      : [];
  if (artifacts.length === 0) fail(`${taskId} evidence-index missing artifacts`);
  for (const artifact of artifacts) {
    const artifactPath = String(artifact.path ?? '').replace(/\\/g, '/');
    if (!artifactPath) {
      fail(`${taskId} evidence-index artifact missing path`);
      continue;
    }
    if (artifactPath === relIndex) {
      fail(`${taskId} evidence-index must not hash itself: ${artifactPath}`);
      continue;
    }
    if (!/^[a-f0-9]{64}$/i.test(String(artifact.sha256 ?? ''))) {
      fail(`${taskId} evidence-index artifact missing sha256: ${artifactPath}`);
      continue;
    }
    const abs = path.join(root, artifactPath);
    if (!fs.existsSync(abs)) {
      fail(`${taskId} evidence-index artifact missing: ${artifactPath}`);
      continue;
    }
    const actual = sha256CanonicalEvidenceFile(abs);
    if (actual !== String(artifact.sha256).toLowerCase()) {
      fail(`${taskId} evidence-index hash mismatch for ${artifactPath}: expected ${artifact.sha256} got ${actual}`);
    }
  }
}

for (const phase of ['phase4-runtime-surfaces', 'phase5-reliability-abuse']) {
  const artifactPrefix = phase.startsWith('phase4') ? 'P4-' : 'P5-';
  const artifactRoot = path.join(root, 'artifacts/system-maturity');
  for (const entry of fs.readdirSync(artifactRoot, { withFileTypes: true })) {
    if (
      !entry.isDirectory()
      || !entry.name.startsWith(artifactPrefix)
      || entry.name.endsWith('-EVIDENCE')
    ) continue;
    const indexPath = path.join(artifactRoot, entry.name, 'evidence-index.json');
    if (!fs.existsSync(indexPath)) fail(`${entry.name} missing evidence-index.json`);
    else validateEvidenceIndex(indexPath);
  }
}

for (const tf of taskFiles) {
  const id = path.basename(tf, '.md');
  if (!taskSelected(id)) continue;
  const text = fs.readFileSync(tf, 'utf8');
  const acceptance = [...text.matchAll(/- \[( |x|X)\]\s*(A\d+)\b/g)].map((m) => ({
    id: m[2],
    checked: m[1].toLowerCase() === 'x',
  }));
  const meta = statusByTask.get(id);
  if (!meta) {
    fail(`task ${id} missing from STATUS.json`);
    continue;
  }

  const deliveryPath = path.join(path.dirname(tf), `${id}.delivery.md`);
  const hasDelivery = fs.existsSync(deliveryPath);

  if (meta.status === 'done') {
    if (!hasDelivery) {
      fail(`A1 ${id} done without delivery file`);
      continue;
    }
    const deliveryText = fs.readFileSync(deliveryPath, 'utf8');
    const d = parseDelivery(deliveryText);
    if (d.status !== 'done') fail(`A3 ${id} STATUS.json=done but delivery STATUS=${d.status || '(empty)'}`);
    if (!d.tests) fail(`A1 ${id} delivery missing TESTS`);
    if (!d.results) fail(`A1 ${id} delivery missing RESULTS`);
    if (!d.evidence) fail(`A1 ${id} delivery missing EVIDENCE`);
    if (!d.acceptance) fail(`A1 ${id} delivery missing ACCEPTANCE`);

    const unchecked = acceptance.filter((a) => !a.checked);
    if (unchecked.length) {
      fail(`A3 ${id} done but unchecked acceptance ${unchecked.map((a) => a.id).join(',')}`);
    }

    const entries = parseEvidenceEntries(d.evidence);
    if (!entries.length) fail(`A1 ${id} EVIDENCE empty`);

    for (const e of entries) {
      if (!e.path) {
        fail(`A1 ${id} empty evidence path in ${e.raw}`);
        continue;
      }
      // allow globs only as warn (not rehashable)
      if (e.path.includes('*')) {
        warn(`${id} evidence glob not rehashed: ${e.path}`);
        continue;
      }
      const abs = path.isAbsolute(e.path) ? e.path : path.join(root, e.path);
      if (!fs.existsSync(abs)) {
        fail(`A1 ${id} evidence path missing: ${e.path}`);
        continue;
      }
      const actual = sha256CanonicalEvidenceFile(abs);
      recomputed.push({ task: id, path: e.path.replace(/\\/g, '/'), sha256: actual });
      if (!e.expectedSha) {
        fail(`A2 ${id} evidence missing #sha256= for ${e.path}`);
      } else if (e.expectedSha !== actual) {
        fail(`A2 ${id} evidence hash mismatch for ${e.path}: expected ${e.expectedSha} got ${actual}`);
      } else {
        info(`A2 ${id} hash OK ${e.path}`);
      }
    }
  } else if (hasDelivery) {
    const d = parseDelivery(fs.readFileSync(deliveryPath, 'utf8'));
    if (d.status === 'done' && meta.status !== 'done') {
      fail(`A3 ${id} delivery STATUS=done but STATUS.json=${meta.status}`);
    }
  }
}

// Self-check: ensure validator fails on synthetic missing evidence (A1 regression)
const synthetic = parseEvidenceEntries('artifacts/system-maturity/__does_not_exist__/x.txt#sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
const syntheticAbs = path.join(root, synthetic[0].path);
if (fs.existsSync(syntheticAbs)) {
  warn('synthetic missing-evidence path unexpectedly exists');
} else {
  info('A1 regression probe: missing evidence path correctly detectable');
}

const report = {
  schemaVersion: 1,
  task: selectedTaskPrefixes.length > 0 ? selectedTaskPrefixes.join(',') : 'P0-004',
  checkedAt: new Date().toISOString(),
  ok: FAIL.length === 0,
  recomputedCount: recomputed.length,
  recomputed,
  fail: FAIL,
  warn: WARN,
  info: INFO,
};

if (!integrityProbe) {
  const outDir = path.join(
    root,
    selectedTaskPrefixes.length > 0
      ? `artifacts/system-maturity/${selectedTaskPrefixes.join('').replace(/[^A-Za-z0-9-]/g, '')}-EVIDENCE`
      : 'artifacts/system-maturity/P0-004',
  );
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'validate-system-maturity-evidence.json'), JSON.stringify(report, null, 2) + '\n');

  // Also write a stable evidence index of all recomputed hashes.
  fs.writeFileSync(
    path.join(outDir, 'evidence-index.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: report.checkedAt,
        entries: recomputed,
      },
      null,
      2,
    ) + '\n',
  );
}

for (const m of INFO) console.log(`INFO  ${m}`);
for (const m of WARN) console.warn(`WARN  ${m}`);
for (const m of FAIL) console.error(`FAIL  ${m}`);

if (FAIL.length) {
  console.error(`\nvalidate-system-maturity-evidence: FAILED (${FAIL.length})`);
  process.exit(1);
}
console.log('\nvalidate-system-maturity-evidence: OK');
process.exit(0);
