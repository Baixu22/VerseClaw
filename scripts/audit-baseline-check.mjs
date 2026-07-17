/**
 * P0-001 audit baseline validator.
 *
 * Verifies:
 *  - Canonical baseline freeze exists and is internally consistent
 *  - Dirty patch hash matches (LF-normalized)
 *  - Finding IDs are unique and related links resolve
 *  - Task Finding refs resolve into the registry
 *  - Manifest file hashes match working tree, with LF-normalization and known drift allowlist
 *
 * Exit 0 on pass; non-zero on failure.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const args = new Set(process.argv.slice(2));
const strictWorkingTree = args.has('--strict-working-tree');

const FAIL = [];
const WARN = [];
const INFO = [];

function fail(msg) {
  FAIL.push(msg);
}
function warn(msg) {
  WARN.push(msg);
}
function info(msg) {
  INFO.push(msg);
}

function readJson(rel) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) {
    fail(`missing JSON: ${rel}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    fail(`invalid JSON ${rel}: ${e.message}`);
    return null;
  }
}

function mustExist(rel) {
  if (!fs.existsSync(path.join(root, rel))) fail(`missing file: ${rel}`);
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function lfNormalizeBinary(buf) {
  return Buffer.from(buf.toString('binary').replace(/\r\n/g, '\n'), 'binary');
}

function lfNormalizeText(buf) {
  return Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

function walkTaskFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkTaskFiles(p, out);
    else if (/^P\d+-\d+\.md$/.test(e.name)) out.push(p);
  }
  return out;
}

const baseline = readJson('plans/system-maturity/BASELINE.json');
const registry = readJson('plans/system-maturity/findings-registry.json');
const findingsDoc = readJson('reports/CLAWX-UNIFIED-SYSTEM-HEALTH-AUDIT-2026-07-16.findings.json');
const manifest = readJson('reports/CLAWX-UNIFIED-SYSTEM-HEALTH-AUDIT-2026-07-16.manifest.json');

mustExist('reports/CLAWX-UNIFIED-SYSTEM-HEALTH-AUDIT-2026-07-16.md');
mustExist('reports/CLAWX-UNIFIED-SYSTEM-HEALTH-AUDIT-2026-07-16.dirty.patch');
mustExist('reports/CLAWX-UNIFIED-SYSTEM-HEALTH-AUDIT-2026-07-16.manifest.json');
mustExist('reports/CLAWX-UNIFIED-SYSTEM-HEALTH-AUDIT-2026-07-16.findings.json');
mustExist('plans/system-maturity/BRANCH-RECONCILIATION.md');
mustExist('plans/system-maturity/EXECUTION-ORDER.md');

if (baseline && findingsDoc && manifest && registry) {
  // --- A1: baseline hash consistency ---
  const expectedHead = baseline.canonical?.auditEvidenceHead;
  if (expectedHead !== findingsDoc.head) {
    fail(`A1 findings.head ${findingsDoc.head} != baseline.auditEvidenceHead ${expectedHead}`);
  } else {
    info(`A1 findings.head matches baseline: ${expectedHead}`);
  }
  if (expectedHead !== manifest.head) {
    fail(`A1 manifest.head ${manifest.head} != baseline.auditEvidenceHead ${expectedHead}`);
  } else {
    info(`A1 manifest.head matches baseline: ${expectedHead}`);
  }

  const patchRel = baseline.auditEvidence?.dirtyPatchPath;
  const patchPath = path.join(root, patchRel);
  if (!fs.existsSync(patchPath)) {
    fail(`A1 dirty patch missing: ${patchRel}`);
  } else {
    const raw = fs.readFileSync(patchPath);
    const lf = lfNormalizeBinary(raw);
    const measured = sha256(lf);
    const expected = baseline.auditEvidence.dirtyPatchSha256;
    if (measured !== expected) {
      fail(`A1 dirty patch sha mismatch: expected ${expected}, got ${measured}`);
    } else if (lf.length !== baseline.auditEvidence.dirtyPatchBytes) {
      fail(
        `A1 dirty patch bytes mismatch: expected ${baseline.auditEvidence.dirtyPatchBytes}, got ${lf.length}`,
      );
    } else {
      info(`A1 dirty patch hash OK (${measured}) bytes=${lf.length}`);
    }
    if (findingsDoc.dirtyPatchSha256 !== expected) {
      fail(
        `A1 findings.dirtyPatchSha256 ${findingsDoc.dirtyPatchSha256} != baseline ${expected}`,
      );
    }
    if (manifest.dirty?.patchSha256 && manifest.dirty.patchSha256 !== expected) {
      fail(
        `A1 manifest.dirty.patchSha256 ${manifest.dirty.patchSha256} != baseline ${expected}`,
      );
    }
  }

  // product baseline present
  if (!baseline.canonical?.productDevelopmentHead) {
    fail('A1 missing canonical.productDevelopmentHead');
  } else {
    info(`A1 productDevelopmentHead=${baseline.canonical.productDevelopmentHead}`);
  }
  if (!baseline.canonical?.branchReconciliationComparedAgainst) {
    fail('A1 missing branchReconciliationComparedAgainst');
  }

  // --- Manifest file hashes ---
  const allowDrift = new Set(
    (baseline.knownContentDriftFromAuditManifest || []).map((d) => d.path),
  );
  const allowMissing = new Set(baseline.missingGeneratedArtifactsAtFreeze || []);
  let matched = 0;
  let matchedLf = 0;
  let drifted = 0;
  let missing = 0;

  for (const [rel, meta] of Object.entries(manifest.files || {})) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) {
      if (allowMissing.has(rel)) {
        missing++;
        info(`manifest missing (allowlisted generated): ${rel}`);
      } else if (strictWorkingTree) {
        fail(`manifest file missing: ${rel}`);
      } else {
        missing++;
        warn(`manifest file missing (non-strict): ${rel}`);
      }
      continue;
    }
    const buf = fs.readFileSync(abs);
    if (sha256(buf) === meta.sha256 && buf.length === meta.bytes) {
      matched++;
      continue;
    }
    const lf = lfNormalizeText(buf);
    if (sha256(lf) === meta.sha256 && lf.length === meta.bytes) {
      matchedLf++;
      continue;
    }
    if (allowDrift.has(rel)) {
      drifted++;
      info(`known post-audit content drift allowed: ${rel}`);
      continue;
    }
    if (strictWorkingTree) {
      fail(`manifest hash mismatch (not allowlisted): ${rel}`);
    } else {
      drifted++;
      warn(`manifest hash mismatch (non-strict): ${rel}`);
    }
  }
  info(
    `manifest files: matched=${matched} lfNorm=${matchedLf} drift=${drifted} missing=${missing}`,
  );

  // --- A2: Finding ID uniqueness and link integrity ---
  const ids = findingsDoc.findings.map((f) => f.id);
  const idSet = new Set(ids);
  if (ids.length !== idSet.size) {
    const seen = new Set();
    const dups = [];
    for (const id of ids) {
      if (seen.has(id)) dups.push(id);
      seen.add(id);
    }
    fail(`A2 duplicate Finding IDs: ${dups.join(', ')}`);
  } else {
    info(`A2 unique Finding IDs: ${ids.length}`);
  }

  if (registry.findingIds?.length !== ids.length) {
    fail(
      `A2 registry findingIds count ${registry.findingIds?.length} != findings ${ids.length}`,
    );
  }
  for (const id of ids) {
    if (!registry.findingIds.includes(id)) fail(`A2 registry missing Finding ${id}`);
  }

  for (const f of findingsDoc.findings) {
    for (const rel of f.related || []) {
      if (!idSet.has(rel)) fail(`A2 broken related link ${f.id} -> ${rel}`);
    }
  }
  info('A2 related links OK');

  // Task Finding refs must resolve
  const planRoot = path.join(root, 'plans/system-maturity');
  const taskFiles = walkTaskFiles(planRoot);
  const unresolved = [];
  for (const tf of taskFiles) {
    const text = fs.readFileSync(tf, 'utf8');
    const line = (text.match(/Findings:\s*(.+)/i) || [])[1] || '';
    const refs = [...line.matchAll(/F-[A-Z]+-\d+/g)].map((m) => m[0]);
    for (const r of refs) {
      if (!idSet.has(r)) unresolved.push(`${path.basename(tf)}:${r}`);
    }
  }
  if (unresolved.length) fail(`A2 task Finding refs unresolved: ${unresolved.join(', ')}`);
  else info(`A2 task Finding refs resolve (${taskFiles.length} tasks scanned)`);

  // Registry/tasks consistency for owner bindings present
  if (!registry.tasks || Object.keys(registry.tasks).length < 30) {
    fail('A2 findings-registry tasks incomplete');
  }
}

// --- A3: exit code path ---
const report = {
  schemaVersion: 1,
  task: 'P0-001',
  checkedAt: new Date().toISOString(),
  ok: FAIL.length === 0,
  fail: FAIL,
  warn: WARN,
  info: INFO,
};

const outDir = path.join(root, 'artifacts/system-maturity/P0-001');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'audit-baseline-check.json'), JSON.stringify(report, null, 2) + '\n');

for (const m of INFO) console.log(`INFO  ${m}`);
for (const m of WARN) console.warn(`WARN  ${m}`);
for (const m of FAIL) console.error(`FAIL  ${m}`);

if (FAIL.length) {
  console.error(`\naudit-baseline-check: FAILED (${FAIL.length} error(s))`);
  process.exit(1);
}
console.log('\naudit-baseline-check: OK');
process.exit(0);
