import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(repoRoot, 'shared/capability-claims.ts');
const outputDir = resolve(repoRoot, 'artifacts/capability-claims');
const outputPath = resolve(outputDir, 'status-table.json');

const {
  CAPABILITY_CLAIM_MATRIX,
} = await import(pathToFileURL(sourcePath).href);

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

const items = CAPABILITY_CLAIM_MATRIX.map((entry) => ({
  id: entry.id,
  reportItem: entry.reportItem,
  title: entry.title,
  classification: entry.classification,
  status: entry.runtimeProof.status,
  evidenceLevels: unique(entry.evidence.map((evidence) => evidence.level)),
  lastVerifiedAt: entry.runtimeProof.lastVerifiedAt ?? '2026-07-04',
  evidenceRefs: unique(entry.evidence.flatMap((evidence) => evidence.refs)),
  runtimeProofRefs: unique(entry.runtimeProof.refs),
  userPath: entry.userPath,
  knownExclusions: entry.knownExclusions,
  relatedTaskIds: entry.relatedTaskIds,
}));

const artifact = {
  schemaVersion: 1,
  source: 'shared/capability-claims.ts',
  generatedAt: new Date().toISOString(),
  matrixReport: 'reports/report-authenticity-true-false-positive-matrix-2026-07-04.md',
  total: items.length,
  items,
};

await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

console.log(`Wrote ${items.length} capability claim records to ${outputPath}`);
