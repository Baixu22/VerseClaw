import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sha256CanonicalEvidenceFile } from './canonical-evidence-hash.mjs';

const TASK_FILE_RE = /^P\d+-\d+\.md$/u;
const FINDING_ID_RE = /F-[A-Z]+-\d+/gu;
const TEST_ID_RE = /T-[A-Z]+-\d+/gu;
const SELF_REPORT_PATH = 'artifacts/system-maturity/P7-001/traceability-report.json';

function toPosix(value) {
  return value.replace(/\\/gu, '/');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function walk(dir, predicate, output = []) {
  if (!fs.existsSync(dir)) return output;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute, predicate, output);
    else if (predicate(entry.name, absolute)) output.push(absolute);
  }
  return output;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function field(text, name) {
  return (text.match(new RegExp(`^${name}:\\s*(.+)$`, 'mi'))?.[1] || '').trim();
}

function sectionBullets(text, name) {
  const heading = new RegExp(`^## ${name}\\s*$`, 'mi');
  const match = heading.exec(text);
  if (!match) return [];
  const remainder = text.slice(match.index + match[0].length);
  const nextHeading = remainder.search(/^## /mu);
  const section = nextHeading >= 0 ? remainder.slice(0, nextHeading) : remainder;
  return [...section.matchAll(/^\s*-\s+(.+)$/gmu)].map((match) => match[1].trim());
}

function parseTaskFile(root, file) {
  const text = fs.readFileSync(file, 'utf8');
  const id = text.match(/^#\s*(P\d+-\d+)/mu)?.[1] || path.basename(file, '.md');
  const dependsLine = field(text, 'Depends on');
  return {
    id,
    path: toPosix(path.relative(root, file)),
    owner: field(text, 'Owner'),
    reviewer: field(text, 'Reviewer'),
    findings: unique(field(text, 'Findings').match(FINDING_ID_RE) || []),
    dependsOn: /none/iu.test(dependsLine) ? [] : unique(dependsLine.match(/P\d+-\d+/gu) || []),
    tests: sectionBullets(text, 'Tests'),
    acceptance: [...text.matchAll(/^- \[( |x|X)\]\s*(A\d+)\b/gmu)].map((match) => ({
      id: match[2],
      checked: match[1].toLowerCase() === 'x',
    })),
  };
}

function parseDelivery(file) {
  if (!file || !fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  return {
    path: file,
    taskId: field(text, 'TASK_ID'),
    status: field(text, 'STATUS').toLowerCase(),
    changed: field(text, 'CHANGED'),
    tests: field(text, 'TESTS'),
    results: field(text, 'RESULTS'),
    evidence: field(text, 'EVIDENCE'),
    acceptance: field(text, 'ACCEPTANCE'),
  };
}

function splitSemicolon(value) {
  return String(value || '').split(';').map((item) => item.trim()).filter(Boolean);
}

function parseEvidenceEntries(value) {
  return splitSemicolon(value).map((entry) => {
    const match = entry.match(/^(.*?)(?:#sha256=([a-f0-9]{64}))?$/iu);
    return {
      path: toPosix((match?.[1] || '').trim()),
      expectedSha256: (match?.[2] || '').toLowerCase(),
    };
  });
}

function extractPathCandidates(root, values) {
  const output = [];
  for (const value of values) {
    const matches = String(value).match(/[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@{}*+-]+)+/gu) || [];
    for (const raw of matches) {
      const candidate = raw.replace(/[),:]+$/gu, '');
      if (candidate.includes('*') || candidate.includes('{') || candidate.includes('}')) continue;
      if (candidate.startsWith('plans/system-maturity/') || candidate.startsWith('artifacts/system-maturity/')) continue;
      const absolute = path.join(root, candidate);
      if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) output.push(toPosix(candidate));
    }
  }
  return unique(output);
}

function auditCodePaths(root, auditFinding) {
  const values = auditFinding?.evidence || [];
  const direct = [];
  for (const value of values) {
    const match = String(value).match(/^([^:（\s]+(?:\/[^:（\s]+)+)/u);
    if (!match) continue;
    const candidate = match[1].replace(/[,;)]+$/gu, '');
    const absolute = path.join(root, candidate);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) direct.push(toPosix(candidate));
  }
  return unique([...direct, ...extractPathCandidates(root, values)]);
}

function loadStatuses(planRoot, root) {
  const statuses = new Map();
  for (const file of walk(planRoot, (name) => name === 'STATUS.json')) {
    const document = readJson(file);
    for (const [taskId, status] of Object.entries(document.tasks || {})) {
      statuses.set(taskId, {
        status,
        phase: document.phase,
        path: toPosix(path.relative(root, file)),
      });
    }
  }
  return statuses;
}

function defaultModifiedAtFactory(root) {
  const cache = new Map();
  const dirty = new Set();
  try {
    const porcelain = execFileSync('git', ['status', '--porcelain=v1', '-z'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const record of porcelain.split('\0').filter(Boolean)) {
      const named = record.slice(3).split(' -> ').at(-1);
      if (named) dirty.add(toPosix(named));
    }
  } catch {
    // Non-Git fixtures use filesystem mtimes.
  }

  return (relativePath) => {
    const normalized = toPosix(relativePath);
    if (cache.has(normalized)) return cache.get(normalized);
    const absolute = path.join(root, normalized);
    if (!fs.existsSync(absolute)) return null;
    let value = null;
    if (!dirty.has(normalized)) {
      try {
        const output = execFileSync('git', ['log', '-1', '--format=%cI', '--', normalized], {
          cwd: root,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        if (output) value = new Date(output).getTime();
      } catch {
        // Fall through to mtime for untracked fixtures or unavailable Git.
      }
    }
    if (!Number.isFinite(value)) value = fs.statSync(absolute).mtimeMs;
    cache.set(normalized, value);
    return value;
  };
}

function iso(timestamp) {
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function compareSets(left, right) {
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.length === rightSorted.length
    && leftSorted.every((value, index) => value === rightSorted[index]);
}

export function validateSystemMaturityTraceability(options) {
  const root = path.resolve(options.root);
  const planRoot = path.join(root, 'plans/system-maturity');
  const registryPath = path.join(planRoot, 'findings-registry.json');
  const registry = readJson(registryPath);
  const auditPath = path.join(root, registry.source?.findingsPath || '');
  const audit = readJson(auditPath);
  const auditFindings = new Map((audit.findings || []).map((finding) => [finding.id, finding]));
  const findings = registry.findings || [];
  const findingsById = new Map(findings.map((finding) => [finding.id, finding]));
  const taskFiles = walk(planRoot, (name) => TASK_FILE_RE.test(name));
  const tasks = taskFiles.map((file) => parseTaskFile(root, file));
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const statuses = loadStatuses(planRoot, root);
  const getModifiedAt = options.getModifiedAt || defaultModifiedAtFactory(root);
  const now = options.now instanceof Date ? options.now.getTime() : Number(options.now || Date.now());
  const fail = [];
  const warn = [];
  const testOwners = new Map();
  const findingReports = [];
  const evidenceHashCache = new Map();

  const evidenceHash = (relativePath) => {
    const normalized = toPosix(relativePath);
    if (evidenceHashCache.has(normalized)) return evidenceHashCache.get(normalized);
    const absolute = path.join(root, normalized);
    const value = fs.existsSync(absolute) && fs.statSync(absolute).isFile()
      ? sha256CanonicalEvidenceFile(absolute)
      : null;
    evidenceHashCache.set(normalized, value);
    return value;
  };

  const globalEvidence = [];
  for (const configuredPath of registry.traceabilityPolicy?.globalEvidence || []) {
    const evidencePath = toPosix(configuredPath);
    const absolute = path.join(root, evidencePath);
    if (!fs.existsSync(absolute)) continue;
    if (!evidencePath.endsWith('.json')) {
      globalEvidence.push({
        path: evidencePath,
        expectedSha256: evidenceHash(evidencePath),
        taskId: 'P7-001',
        kind: 'global-validation',
      });
      continue;
    }
    let document;
    try {
      document = readJson(absolute);
    } catch (error) {
      fail.push(`global evidence ${evidencePath} is invalid JSON: ${error.message}`);
      continue;
    }
    if (document.ok !== true || !Array.isArray(document.commands) || document.commands.some((command) => command.exitCode !== 0)) {
      fail.push(`global evidence ${evidencePath} is not a zero-exit successful report`);
      continue;
    }
    let valid = true;
    const reportDir = toPosix(path.dirname(evidencePath));
    for (const command of document.commands) {
      for (const stream of ['stdout', 'stderr']) {
        const declaredPath = command[stream] || command[`${stream}Path`] || '';
        const streamPath = command[stream]
          ? toPosix(declaredPath)
          : toPosix(path.join(reportDir, declaredPath));
        const expected = String(command[`${stream}Sha256`] || '').toLowerCase();
        const actual = streamPath ? evidenceHash(streamPath) : null;
        if (!streamPath || !expected || !actual || expected !== actual) {
          fail.push(`global evidence ${evidencePath} ${command.id || '(unknown)'}.${stream} hash mismatch or missing`);
          valid = false;
        }
      }
    }
    if (valid) {
      globalEvidence.push({
        path: evidencePath,
        expectedSha256: evidenceHash(evidencePath),
        taskId: document.task || 'P7-001',
        kind: 'global-validation',
        findingIds: Array.isArray(document.findingIds) ? document.findingIds : null,
      });
    }
  }

  if (!registry.traceabilityPolicy?.reviewCycleDaysBySeverity) {
    fail.push('traceabilityPolicy.reviewCycleDaysBySeverity is required');
  }

  for (const [taskId, registered] of Object.entries(registry.tasks || {})) {
    const task = tasksById.get(taskId);
    if (!task) {
      fail.push(`orphan registry task ${taskId}`);
      continue;
    }
    if (registered.path !== task.path) fail.push(`task ${taskId} path mismatch: registry=${registered.path} task=${task.path}`);
    if (registered.owner !== task.owner) fail.push(`task ${taskId} owner mismatch`);
    if (registered.reviewer !== task.reviewer) fail.push(`task ${taskId} reviewer mismatch`);
    if (!compareSets(registered.findings || [], task.findings)) fail.push(`task ${taskId} Finding links differ between registry and task file`);
    if (!compareSets(registered.dependsOn || [], task.dependsOn)) fail.push(`task ${taskId} dependencies differ between registry and task file`);
  }
  for (const task of tasks) {
    if (!registry.tasks?.[task.id]) fail.push(`orphan task file ${task.id} missing from findings-registry.tasks`);
    if (!statuses.has(task.id)) fail.push(`orphan task ${task.id} missing from STATUS.json`);
  }

  for (const finding of findings) {
    const findingFail = [];
    const taskIds = unique(finding.tasks || []);
    if (!taskIds.length) findingFail.push('no linked tasks');
    const linkedTasks = taskIds.map((taskId) => tasksById.get(taskId)).filter(Boolean);
    for (const taskId of taskIds) {
      const task = tasksById.get(taskId);
      if (!task) findingFail.push(`orphan task link ${taskId}`);
      else if (!task.findings.includes(finding.id)) findingFail.push(`task ${taskId} does not link back to ${finding.id}`);
    }
    for (const task of tasks.filter((candidate) => candidate.findings.includes(finding.id))) {
      if (!taskIds.includes(task.id)) findingFail.push(`task ${task.id} links to ${finding.id} but Finding does not link back`);
    }

    const expectedTestId = finding.id.replace(/^F-/u, 'T-');
    const auditFinding = auditFindings.get(finding.id);
    const declaredTestIds = unique((auditFinding?.acceptance || []).flatMap((item) => String(item).match(TEST_ID_RE) || []));
    for (const testId of declaredTestIds) {
      if (testId !== expectedTestId) findingFail.push(`orphan or mismatched test ${testId}; expected ${expectedTestId}`);
    }
    if (testOwners.has(expectedTestId) && testOwners.get(expectedTestId) !== finding.id) {
      findingFail.push(`test ${expectedTestId} also belongs to ${testOwners.get(expectedTestId)}`);
    }
    testOwners.set(expectedTestId, finding.id);

    const deliveries = linkedTasks.map((task) => {
      const deliveryFile = path.join(root, path.dirname(task.path), `${task.id}.delivery.md`);
      return { task, delivery: parseDelivery(deliveryFile) };
    });
    const testCommands = unique(deliveries.flatMap(({ task, delivery }) => delivery ? splitSemicolon(delivery.tests) : task.tests));
    if (!testCommands.length) findingFail.push(`test ${expectedTestId} has no command or planned test`);

    const deliveryEvidence = [];
    const changedValues = [];
    for (const { task, delivery } of deliveries) {
      const status = statuses.get(task.id)?.status;
      if (status === 'done') {
        if (!delivery) findingFail.push(`done task ${task.id} has no delivery`);
        if (task.acceptance.some((item) => !item.checked)) findingFail.push(`done task ${task.id} has unchecked acceptance`);
        if (delivery && delivery.status !== 'done') findingFail.push(`done task ${task.id} delivery status is ${delivery.status || '(empty)'}`);
        if (delivery && (!delivery.acceptance || !delivery.results || !delivery.tests)) findingFail.push(`done task ${task.id} delivery is incomplete`);
      }
      if (!delivery) continue;
      changedValues.push(delivery.changed);
      for (const entry of parseEvidenceEntries(delivery.evidence)) {
        if (!entry.path) continue;
        if (entry.path === SELF_REPORT_PATH) continue;
        if (!entry.expectedSha256) findingFail.push(`task ${task.id} evidence lacks sha256: ${entry.path}`);
        if (!entry.path.includes('*')) {
          const actual = evidenceHash(entry.path);
          if (!actual) findingFail.push(`task ${task.id} evidence is missing: ${entry.path}`);
          else if (entry.expectedSha256 && actual !== entry.expectedSha256) {
            findingFail.push(`task ${task.id} evidence hash mismatch: ${entry.path}`);
          }
        }
        deliveryEvidence.push({ ...entry, taskId: task.id, kind: 'task' });
      }
    }

    const auditEvidencePath = toPosix(path.relative(root, auditPath));
    const scopedGlobalEvidence = globalEvidence.filter((item) => !item.findingIds?.length || item.findingIds.includes(finding.id));
    const evidence = [{
      path: auditEvidencePath,
      expectedSha256: sha256CanonicalEvidenceFile(auditPath),
      taskId: 'P0-001',
      kind: 'frozen-audit',
    }, ...deliveryEvidence, ...scopedGlobalEvidence];
    const evidencePaths = unique(evidence.map((item) => item.path));
    if (!evidencePaths.length) findingFail.push('no evidence');

    const codePaths = unique([
      ...auditCodePaths(root, auditFinding),
      ...extractPathCandidates(root, changedValues),
      ...extractPathCandidates(root, testCommands),
    ]);
    if (!codePaths.length) findingFail.push('no code/test source paths');

    const sourceTimes = codePaths.map((item) => getModifiedAt(item)).filter(Number.isFinite);
    const evidenceTimes = evidencePaths.map((item) => getModifiedAt(item)).filter(Number.isFinite);
    const latestSourceAt = sourceTimes.length ? Math.max(...sourceTimes) : null;
    const latestEvidenceAt = evidenceTimes.length ? Math.max(...evidenceTimes) : null;
    const cycleDays = registry.traceabilityPolicy?.reviewCycleDaysBySeverity?.[finding.severity];
    if (!Number.isFinite(cycleDays) || cycleDays <= 0) findingFail.push(`no review cycle for severity ${finding.severity}`);
    const nextReviewAt = Number.isFinite(latestEvidenceAt) && Number.isFinite(cycleDays)
      ? latestEvidenceAt + cycleDays * 86_400_000
      : null;
    const staleReasons = [];
    if (Number.isFinite(latestSourceAt) && Number.isFinite(latestEvidenceAt) && latestSourceAt > latestEvidenceAt + 1_000) {
      staleReasons.push('linked source is newer than evidence');
    }
    if (Number.isFinite(nextReviewAt) && now > nextReviewAt) staleReasons.push('review cycle expired');
    if (staleReasons.length) findingFail.push(`stale evidence: ${staleReasons.join(', ')}`);

    const owners = unique(linkedTasks.map((task) => task.owner));
    const reviewers = unique(linkedTasks.map((task) => task.reviewer));
    if (!owners.length) findingFail.push('no owner');
    if (!reviewers.length) findingFail.push('no reviewer');

    const report = {
      id: finding.id,
      status: finding.status,
      severity: finding.severity,
      owner: owners[0] || null,
      owners,
      reviewers,
      taskIds,
      testIds: [expectedTestId],
      testCommands,
      acceptanceIds: unique(linkedTasks.flatMap((task) => task.acceptance.map((item) => `${task.id}:${item.id}`))),
      codePaths,
      evidence: evidence.map((item) => ({
        path: item.path,
        sha256: item.expectedSha256,
        taskId: item.taskId,
        kind: item.kind,
        findingIds: item.findingIds || undefined,
      })),
      reviewCycleDays: Number.isFinite(cycleDays) ? cycleDays : null,
      latestSourceAt: iso(latestSourceAt),
      latestEvidenceAt: iso(latestEvidenceAt),
      nextReviewAt: iso(nextReviewAt),
      freshness: staleReasons.length ? 'stale' : 'fresh',
      failures: findingFail,
    };
    findingReports.push(report);
    for (const message of findingFail) fail.push(`${finding.id}: ${message}`);
  }

  for (const auditFinding of audit.findings || []) {
    if (!findingsById.has(auditFinding.id)) fail.push(`orphan audit Finding ${auditFinding.id}`);
  }
  for (const finding of findings) {
    if (!auditFindings.has(finding.id)) warn.push(`${finding.id}: not present in frozen audit source`);
  }

  return {
    schemaVersion: 1,
    task: 'P7-001',
    evaluatedAt: new Date(options.evaluatedAt || now).toISOString(),
    ok: fail.length === 0,
    summary: {
      findingCount: findings.length,
      taskCount: tasks.length,
      testCount: testOwners.size,
      freshCount: findingReports.filter((item) => item.freshness === 'fresh').length,
      staleCount: findingReports.filter((item) => item.freshness === 'stale').length,
      failureCount: fail.length,
      warningCount: warn.length,
    },
    policy: registry.traceabilityPolicy,
    findings: findingReports,
    fail,
    warn,
  };
}
