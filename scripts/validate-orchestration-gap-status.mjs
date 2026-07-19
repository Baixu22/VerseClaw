import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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

function resolveCommit(commit) {
  return execFileSync('git', ['rev-parse', `${commit}^{commit}`], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
}

function isReachable(commit, head) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, head], {
      cwd: root,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function splitRefs(value) {
  return value
    .split(';')
    .map((ref) => ref.trim())
    .filter(Boolean);
}

function validateManifest(taskId, manifestRef, deliveryCommit, head) {
  const manifestPath = path.isAbsolute(manifestRef) ? manifestRef : path.join(root, manifestRef);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    failures.push(`${taskId}: invalid evidence manifest ${manifestRef}: ${String(error)}`);
    return;
  }

  if (manifest.schemaVersion !== 2) {
    failures.push(`${taskId}: evidence manifest must use schemaVersion 2`);
  }
  if (manifest.taskId !== taskId) {
    failures.push(`${taskId}: evidence manifest taskId mismatch (${manifest.taskId ?? 'missing'})`);
  }
  if (manifest.hashAlgorithm !== 'sha256' || manifest.contentSource !== 'git-blob') {
    failures.push(`${taskId}: evidence manifest must use sha256 git-blob content`);
  }

  let resolvedImplementationCommit;
  try {
    resolvedImplementationCommit = resolveCommit(manifest.implementationCommit);
    if (resolvedImplementationCommit !== resolveCommit(deliveryCommit)) {
      failures.push(`${taskId}: manifest implementationCommit does not match delivery COMMIT`);
    }
  } catch {
    failures.push(`${taskId}: invalid manifest implementationCommit ${manifest.implementationCommit ?? 'missing'}`);
  }

  for (const [label, commit] of [
    ['implementationCommit', manifest.implementationCommit],
    ['deliveryCommit', manifest.deliveryCommit],
  ]) {
    if (!commit) {
      failures.push(`${taskId}: manifest missing ${label}`);
      continue;
    }
    try {
      const resolved = resolveCommit(commit);
      if (!isReachable(resolved, head)) {
        failures.push(`${taskId}: manifest ${label} ${commit} is not reachable from HEAD ${head}`);
      }
    } catch {
      failures.push(`${taskId}: manifest ${label} ${commit} is not a commit`);
    }
  }

  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    failures.push(`${taskId}: evidence manifest has no files`);
    return;
  }

  for (const entry of manifest.files) {
    const entryPath = typeof entry?.path === 'string' ? entry.path.replaceAll('\\', '/') : '';
    if (!entryPath || path.isAbsolute(entryPath) || entryPath.split('/').includes('..')) {
      failures.push(`${taskId}: invalid manifest file path ${entry?.path ?? 'missing'}`);
      continue;
    }
    if (typeof entry.commit !== 'string' || typeof entry.sha256 !== 'string') {
      failures.push(`${taskId}: manifest entry missing commit or sha256 for ${entryPath}`);
      continue;
    }
    try {
      const resolvedEntryCommit = resolveCommit(entry.commit);
      if (!isReachable(resolvedEntryCommit, head)) {
        failures.push(`${taskId}: manifest entry commit ${entry.commit} is not reachable for ${entryPath}`);
        continue;
      }
      const bytes = execFileSync('git', ['show', `${resolvedEntryCommit}:${entryPath}`], {
        cwd: root,
        encoding: null,
        maxBuffer: 50 * 1024 * 1024,
      });
      const actual = crypto.createHash('sha256').update(bytes).digest('hex');
      if (actual !== entry.sha256) {
        failures.push(`${taskId}: evidence hash mismatch for ${entryPath}`);
      }
    } catch {
      failures.push(`${taskId}: cannot read manifest git blob ${entry.commit}:${entryPath}`);
    }
  }
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
    if (!isReachable(commit, head)) {
      failures.push(`${taskId}: COMMIT ${commit} is not reachable from HEAD ${head}`);
    }
  }
  const acceptance = field(text, 'ACCEPTANCE');
  const evidence = field(text, 'EVIDENCE');
  const evidenceRefs = splitRefs(evidence);
  for (const ref of splitRefs(`${acceptance};${evidence}`)) {
    const target = path.isAbsolute(ref) ? ref : path.join(root, ref);
    if (!fs.existsSync(target)) failures.push(`${taskId}: missing referenced evidence ${ref}`);
  }
  const manifests = evidenceRefs.filter((ref) => ref.endsWith('/evidence-manifest.json'));
  if (manifests.length !== 1) {
    failures.push(`${taskId}: done delivery must reference exactly one evidence-manifest.json`);
  } else if (commit) {
    validateManifest(taskId, manifests[0], commit, head);
  }
}

const report = { schemaVersion: 1, wave: status.wave, checkedAt: new Date().toISOString(), head, ok: failures.length === 0, failures };
const outDir = path.join(root, 'artifacts', 'system-maturity', 'orchestration-gap-closure');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'status-gate.json'), `${JSON.stringify(report, null, 2)}\n`);
for (const failure of failures) console.error(`FAIL ${failure}`);
if (failures.length) process.exit(1);
console.log(`orchestration-gap-status: OK (${Object.keys(status.tasks ?? {}).length} tasks, HEAD ${head})`);
