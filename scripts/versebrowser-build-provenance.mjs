import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { snapshotBuildSource, collectCompiledOutputs, PROVENANCE_PATH } from './lib/versebrowser-build-provenance.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function recordBuildProvenance(root = ROOT, capture = false) {
  const marker = path.join(root,'build/versebrowser-source-at-start.json');
  const source = snapshotBuildSource(root);
  if (capture) {
    await mkdir(path.dirname(marker),{recursive:true});
    await writeFile(marker,JSON.stringify(source)+'\n');
    return source;
  }
  const start = JSON.parse(await readFile(marker,'utf8'));
  const status = !source.dirty && JSON.stringify(start) === JSON.stringify(source) ? 'bound' : 'source-changed-or-dirty';
  const proof = {schemaVersion:1,scope:'versebrowser-desktop-build-v1',status,driven_by:'agent',actor:'build:vite',...source,outputs:await collectCompiledOutputs(root)};
  await writeFile(path.join(root,PROVENANCE_PATH),JSON.stringify(proof)+'\n');
  console.log(`[versebrowser-build] ${status}; ${proof.outputs.length} compiled outputs`);
  return proof;
}
if (isMainEntrypoint(import.meta.url)) await recordBuildProvenance(ROOT,process.argv.includes('--capture'));
