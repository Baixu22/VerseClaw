/**
 * P0-002 system maturity plan / status machine validator.
 *
 * Checks:
 *  - unique task IDs across plans/system-maturity
 *  - STATUS.json enums and phase/task consistency
 *  - dependency edges reference existing tasks
 *  - done tasks have delivery evidence + acceptance checked
 *  - phaseStatus=done only when all tasks done
 *  - INDEX/phase PLAN findings resolve into findings-registry when present
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const planRoot = path.join(root, 'plans/system-maturity');

const TASK_STATUSES = new Set(['todo', 'in_progress', 'blocked', 'done']);
const PHASE_STATUSES = new Set(['planned', 'in_progress', 'blocked', 'done']);

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

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function parseTaskFile(p) {
  const text = fs.readFileSync(p, 'utf8');
  const id = (text.match(/^#\s*(P\d+-\d+)/m) || [])[1] || path.basename(p, '.md');
  const owner = ((text.match(/Owner:\s*(.+)/i) || [])[1] || '').trim();
  const reviewer = ((text.match(/Reviewer:\s*(.+)/i) || [])[1] || '').trim();
  const findingsLine = (text.match(/Findings:\s*(.+)/i) || [])[1] || '';
  const findings = [...findingsLine.matchAll(/F-[A-Z]+-\d+/g)].map((m) => m[0]);
  const depsLine = (text.match(/Depends on:\s*(.+)/i) || [])[1] || '';
  const dependsOn = /none/i.test(depsLine)
    ? []
    : [...depsLine.matchAll(/P\d+-\d+/g)].map((m) => m[0]);
  const acceptance = [...text.matchAll(/- \[( |x|X)\]\s*(A\d+)\b/g)].map((m) => ({
    id: m[2],
    checked: m[1].toLowerCase() === 'x',
  }));
  return { id, path: p, owner, reviewer, findings, dependsOn, acceptance, text };
}

const taskFiles = walk(planRoot, (name) => /^P\d+-\d+\.md$/.test(name));
const tasks = taskFiles.map(parseTaskFile);
const byId = new Map();

// A1 unique IDs
for (const t of tasks) {
  if (byId.has(t.id)) fail(`A1 duplicate task ID ${t.id}: ${byId.get(t.id).path} and ${t.path}`);
  else byId.set(t.id, t);
}
info(`A1 unique task IDs: ${byId.size}`);

// Required metadata
for (const t of tasks) {
  if (!t.owner) fail(`task ${t.id} missing Owner`);
  if (!t.reviewer) fail(`task ${t.id} missing Reviewer`);
  if (!t.acceptance.length) warn(`task ${t.id} has no Acceptance checklist items`);
}

// STATUS files
const statusFiles = walk(planRoot, (name) => name === 'STATUS.json');
if (!statusFiles.length) fail('no STATUS.json found under plans/system-maturity');

const allStatusTasks = new Map(); // taskId -> {status, phase}

for (const sp of statusFiles) {
  let doc;
  try {
    doc = readJson(sp);
  } catch (e) {
    fail(`invalid STATUS.json ${sp}: ${e.message}`);
    continue;
  }
  const rel = path.relative(root, sp).replace(/\\/g, '/');
  if (!doc.phase) fail(`${rel} missing phase`);
  if (!PHASE_STATUSES.has(doc.phaseStatus)) {
    fail(`${rel} invalid phaseStatus=${doc.phaseStatus}; allowed=${[...PHASE_STATUSES].join('|')}`);
  } else {
    info(`${rel} phaseStatus=${doc.phaseStatus}`);
  }
  if (!doc.tasks || typeof doc.tasks !== 'object') {
    fail(`${rel} missing tasks map`);
    continue;
  }

  const statuses = Object.values(doc.tasks);
  let allDone = true;
  for (const [taskId, st] of Object.entries(doc.tasks)) {
    if (!TASK_STATUSES.has(st)) {
      fail(`${rel} task ${taskId} invalid status=${st}; allowed=${[...TASK_STATUSES].join('|')}`);
    }
    if (st !== 'done') allDone = false;
    if (!byId.has(taskId)) fail(`${rel} references unknown task ${taskId}`);
    if (allStatusTasks.has(taskId)) fail(`task ${taskId} appears in multiple STATUS files`);
    allStatusTasks.set(taskId, { status: st, phase: doc.phase, statusFile: rel });
  }

  if (doc.phaseStatus === 'done' && !allDone) {
    fail(`${rel} phaseStatus=done but not all tasks done`);
  }
  if (doc.allTasksDone === true && !allDone) {
    fail(`${rel} allTasksDone=true but not all tasks done`);
  }
  if (doc.allTasksDone === false && allDone && Object.keys(doc.tasks).length) {
    warn(`${rel} all tasks done but allTasksDone=false`);
  }
  if (allDone && doc.phaseStatus !== 'done' && Object.keys(doc.tasks).length) {
    warn(`${rel} all tasks done but phaseStatus!=done`);
  }
}

// Every task file must appear in some STATUS
for (const id of byId.keys()) {
  if (!allStatusTasks.has(id)) fail(`task file ${id} not registered in any STATUS.json`);
}

// Dependency integrity
for (const t of tasks) {
  for (const d of t.dependsOn) {
    if (!byId.has(d)) fail(`task ${t.id} depends on unknown ${d}`);
  }
}
info('dependency edges resolve');

// A3: done must bind acceptance evidence
for (const [taskId, meta] of allStatusTasks.entries()) {
  if (meta.status !== 'done') continue;
  const t = byId.get(taskId);
  const deliveryCandidates = [
    path.join(path.dirname(t.path), `${taskId}.delivery.md`),
    path.join(root, 'artifacts/system-maturity', taskId, 'delivery.md'),
    path.join(root, 'plans/system-maturity/evidence', `${taskId}.delivery.md`),
  ];
  const deliveryPath = deliveryCandidates.find((p) => fs.existsSync(p));
  if (!deliveryPath) {
    fail(`A3 ${taskId} is done but missing delivery file (${taskId}.delivery.md)`);
    continue;
  }
  const delivery = fs.readFileSync(deliveryPath, 'utf8');
  if (!/STATUS:\s*done/i.test(delivery)) fail(`A3 ${taskId} delivery STATUS is not done`);
  if (!/EVIDENCE:\s*\S+/i.test(delivery)) fail(`A3 ${taskId} delivery missing EVIDENCE`);
  if (!/ACCEPTANCE:\s*\S+/i.test(delivery)) fail(`A3 ${taskId} delivery missing ACCEPTANCE`);
  if (!/TESTS:\s*\S+/i.test(delivery)) fail(`A3 ${taskId} delivery missing TESTS`);
  if (!/RESULTS:\s*\S+/i.test(delivery)) fail(`A3 ${taskId} delivery missing RESULTS`);

  const unchecked = t.acceptance.filter((a) => !a.checked);
  if (unchecked.length) {
    fail(`A3 ${taskId} done but unchecked acceptance: ${unchecked.map((a) => a.id).join(',')}`);
  } else {
    info(`A3 ${taskId} delivery+acceptance OK (${path.relative(root, deliveryPath)})`);
  }
}

// findings registry linkage if present
const regPath = path.join(planRoot, 'findings-registry.json');
if (fs.existsSync(regPath)) {
  const reg = readJson(regPath);
  const ids = new Set(reg.findingIds || reg.findings?.map((f) => f.id) || []);
  for (const t of tasks) {
    for (const f of t.findings) {
      if (!ids.has(f)) fail(`task ${t.id} Finding ${f} not in findings-registry`);
    }
  }
  info('task Finding refs resolve against findings-registry');
} else {
  warn('findings-registry.json missing; skip Finding linkage');
}

// README enum documentation check
const readme = fs.readFileSync(path.join(planRoot, 'README.md'), 'utf8');
if (!/todo/.test(readme) || !/in_progress/.test(readme) || !/blocked/.test(readme) || !/done/.test(readme)) {
  fail('README.md missing required task status values');
}
if (!/planned/.test(readme)) {
  fail('README.md missing phaseStatus value planned (required by STATUS.json / INDEX)');
}


// INDEX.md Status column must match each phase STATUS.json.phaseStatus
{
  const indexPath = path.join(planRoot, 'INDEX.md');
  if (!fs.existsSync(indexPath)) {
    fail('missing plans/system-maturity/INDEX.md');
  } else {
    const indexText = fs.readFileSync(indexPath, 'utf8');
    const phaseDirs = [
      'phase0-foundation',
      'phase1-direct-boundaries',
      'phase2-authorization-isolation',
      'phase3-data-authority',
      'phase4-runtime-surfaces',
      'phase5-reliability-abuse',
      'phase6-supply-release',
      'phase7-continuous-governance',
      'phase8-residual-closure',
    ];
    for (const dir of phaseDirs) {
      const statusPath = path.join(planRoot, dir, 'STATUS.json');
      if (!fs.existsSync(statusPath)) continue;
      const phaseStatus = readJson(statusPath).phaseStatus || 'planned';
      const row = indexText.split(/\r?\n/).find((line) => line.match(new RegExp(`\\|\\s*${dir}\\s*\\|`)));
      if (!row) {
        fail(`INDEX missing row for ${dir}`);
        continue;
      }
      const cells = row.split('|').map((c) => c.trim()).filter(Boolean);
      const indexStatus = cells[cells.length - 1];
      if (indexStatus !== phaseStatus) {
        fail(`INDEX status mismatch for ${dir}: INDEX=${indexStatus} STATUS.json=${phaseStatus}`);
      } else {
        info(`INDEX status OK ${dir}=${phaseStatus}`);
      }
    }
  }
}

const report = {
  schemaVersion: 1,
  task: 'P0-002',
  checkedAt: new Date().toISOString(),
  ok: FAIL.length === 0,
  taskCount: byId.size,
  statusFileCount: statusFiles.length,
  enums: {
    taskStatus: [...TASK_STATUSES],
    phaseStatus: [...PHASE_STATUSES],
  },
  fail: FAIL,
  warn: WARN,
  info: INFO,
};

const outDir = path.join(root, 'artifacts/system-maturity/P0-002');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'validate-system-maturity-plan.json'), JSON.stringify(report, null, 2) + '\n');

for (const m of INFO) console.log(`INFO  ${m}`);
for (const m of WARN) console.warn(`WARN  ${m}`);
for (const m of FAIL) console.error(`FAIL  ${m}`);

if (FAIL.length) {
  console.error(`\nvalidate-system-maturity-plan: FAILED (${FAIL.length})`);
  process.exit(1);
}
console.log('\nvalidate-system-maturity-plan: OK');
process.exit(0);
