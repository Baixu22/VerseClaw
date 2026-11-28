import { writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { verifyKnowledgeAdaptationPackage } from './lib/project-rag-adaptation-readback.mjs';

async function main() {
  const [manifest, digest, candidate, policyDigest, profile, baselineDigest, output] = process.argv.slice(2);
  if (!manifest || !digest || !candidate || !policyDigest || !output || !baselineDigest || !['local', 'quality', 'research'].includes(profile))
    throw new Error('Usage: knowledge-rag-adaptation-readback <manifest.json> <sha256:digest> <candidate> <policy-digest> <local|quality|research> <baseline-digest> <new-output.json>');
  const result = verifyKnowledgeAdaptationPackage(dirname(resolve(manifest)), { path: basename(manifest), digest }, candidate, policyDigest,
    profile as 'local' | 'quality' | 'research', baselineDigest);
  await writeFile(resolve(output), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  if (result.status !== 'qualified') process.exitCode = 1;
}
void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
