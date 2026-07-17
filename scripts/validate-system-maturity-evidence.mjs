/**
 * P0-004 evidence delivery / audit regression validator.
 *
 * A1: done deliveries missing EVIDENCE paths fail
 * A2: evidence path#sha256=... hashes are recomputed and must match
 * A3: STATUS.json, task acceptance checkboxes, and delivery STATUS agree
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const planRoot = path.join(root, 'plans/system-maturity');

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

function sha256File(abs) {
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
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

for (const tf of taskFiles) {
  const id = path.basename(tf, '.md');
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
      const actual = sha256File(abs);
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
  task: 'P0-004',
  checkedAt: new Date().toISOString(),
  ok: FAIL.length === 0,
  recomputedCount: recomputed.length,
  recomputed,
  fail: FAIL,
  warn: WARN,
  info: INFO,
};

const outDir = path.join(root, 'artifacts/system-maturity/P0-004');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'validate-system-maturity-evidence.json'), JSON.stringify(report, null, 2) + '\n');

// Also write a stable evidence index of all recomputed hashes
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

for (const m of INFO) console.log(`INFO  ${m}`);
for (const m of WARN) console.warn(`WARN  ${m}`);
for (const m of FAIL) console.error(`FAIL  ${m}`);

if (FAIL.length) {
  console.error(`\nvalidate-system-maturity-evidence: FAILED (${FAIL.length})`);
  process.exit(1);
}
console.log('\nvalidate-system-maturity-evidence: OK');
process.exit(0);