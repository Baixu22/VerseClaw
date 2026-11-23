import { readFile, writeFile, cp, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { evaluateOfflineRagReport } from './lib/project-rag-promotion.mjs';
import { normalizeRetrievalPolicy, retrievalPolicyDigest } from '../openclaw_runtime/src/knowledge/retrieval/policy';
import { verifyOfflineRagPolicyPackage } from './lib/project-rag-promotion.mjs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Offline artifact preparation. Activation remains an explicit owner-scoped Host operation. */
async function main() {
  const [reportFile, policyFile, outputFile, captureManifest] = process.argv.slice(2);
  if (!reportFile || !policyFile || !outputFile) throw new Error('Usage: knowledge-rag-policy <report.json> <policy.json> <output.json>');
  const raw = await readFile(resolve(reportFile), 'utf8');
  if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw new Error('Offline report exceeds 2 MiB');
  const offlineReport: unknown = JSON.parse(raw);
  const candidate = normalizeRetrievalPolicy(JSON.parse(await readFile(resolve(policyFile), 'utf8')));
  const evaluation = evaluateOfflineRagReport(offlineReport);
  if (evaluation.candidateDigest !== retrievalPolicyDigest(candidate)) throw new Error('Report does not bind this ranking policy');
  if (!captureManifest) throw new Error('Provide the sealed raw query/task capture manifest as the fourth argument');
  const captures = JSON.parse(await readFile(resolve(captureManifest), 'utf8'));
  const manifest = { schema: 'OfflineRagPolicyPackage/v1', driven_by: 'agent', candidate,
    report: captures.report, queryCaptures: captures.queryCaptures, taskExecutions: captures.taskExecutions };
  const bytes = JSON.stringify(manifest, null, 2) + '\n';
  const frozenDirectory = resolve(dirname(outputFile), 'frozen-corpus');
  const existing = await stat(frozenDirectory).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (!existing) await cp(fileURLToPath(new URL('../harness/specs/fixtures/project-rag/v4', import.meta.url)),
    frozenDirectory, { recursive: true, errorOnExist: true, force: false });
  await writeFile(resolve(outputFile), bytes, { flag: 'wx' });
  verifyOfflineRagPolicyPackage(dirname(resolve(outputFile)), 'sha256:' + createHash('sha256').update(bytes).digest('hex'), basename(outputFile));
  console.log(JSON.stringify({ status: 'prepared', reportDigest: evaluation.reportDigest, activated: false }));
}
void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
