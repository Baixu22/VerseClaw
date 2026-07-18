import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const waveRoot = path.join(root, 'plans', 'system-maturity', 'orchestration-gap-closure');
const statusPath = path.join(waveRoot, 'ORCHESTRATION_STATUS.json');
const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
const failures = [];
const allowed = new Set(['todo', 'in_progress', 'blocked', 'done']);

function field(text, name) {
  return (text.match(new RegExp(`^${name}:\\s*(.+)$`, 'mi'))?.[1] ?? '').trim();
}

function currentHead() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

const head = currentHead();
for (const [taskId, taskStatus] of Object.entries(status.tasks ?? {})) {
  if (!allowed.has(taskStatus)) failures.push(`${taskId}: invalid status ${taskStatus}`);
  if (taskStatus !== 'done') continue;

  const deliveryPath = path.join(waveRoot, `${taskId}.delivery.md`);
  if (!fs.existsSync(deliveryPath)) {
    failures.push(`${taskId}: done without delivery file`);
    continue;
  }
  const text = fs.readFileSync(deliveryPath, 'utf8');
  for (const name of ['IMPLEMENTATION', 'TESTS', 'ACCEPTANCE', 'EVIDENCE', 'RESULTS', 'COMMIT', 'VALIDATED_AT']) {
    if (!field(text, name)) failures.push(`${taskId}: done delivery missing ${name}`);
  }
  const commit = field(text, 'COMMIT');
  if (commit) {
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', commit, head], { cwd: root, stdio: 'ignore' });
    } catch {
      failures.push(`${taskId}: COMMIT ${commit} is not reachable from HEAD ${head}`);
    }
  }
  const acceptance = field(text, 'ACCEPTANCE');
  const evidence = field(text, 'EVIDENCE');
  for (const ref of `${acceptance};${evidence}`.split(';').map((value) => value.trim()).filter(Boolean)) {
    const target = path.isAbsolute(ref) ? ref : path.join(root, ref);
    if (!fs.existsSync(target)) failures.push(`${taskId}: missing referenced evidence ${ref}`);
  }
}

const report = { schemaVersion: 1, wave: status.wave, checkedAt: new Date().toISOString(), head, ok: failures.length === 0, failures };
const outDir = path.join(root, 'artifacts', 'system-maturity', 'orchestration-gap-closure');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'status-gate.json'), `${JSON.stringify(report, null, 2)}\n`);
for (const failure of failures) console.error(`FAIL ${failure}`);
if (failures.length) process.exit(1);
console.log(`orchestration-gap-status: OK (${Object.keys(status.tasks ?? {}).length} tasks, HEAD ${head})`);
