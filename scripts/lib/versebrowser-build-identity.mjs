import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { PROVENANCE_PATH, COMPILED_ROOTS, sha256, validBuildProvenance } from './versebrowser-build-provenance.mjs';

const require = createRequire(import.meta.url);
const asar = createRequire(require.resolve('electron-builder'))('@electron/asar');

/** Captured by each runner before execution, not supplied as acceptance input. */
export async function browserBuildIdentity(exePath) {
  const files = [exePath, path.join(path.dirname(exePath), 'resources/app.asar'), path.join(path.dirname(exePath), 'resources/main-runtime.asar')];
  const artifacts = [];
  for (const file of files) {
    artifacts.push({ path: path.relative(path.dirname(exePath), file).replaceAll('\\', '/'),
      bytes: (await stat(file)).size, sha256: createHash('sha256').update(await readFile(file)).digest('hex') });
  }
  const resources = path.join(path.dirname(exePath),'resources');
  for (const name of ['app.asar','main-runtime.asar']) asar.uncache(path.join(resources,name));
  const proofBytes = asar.extractFile(path.join(resources,'app.asar'),path.normalize(PROVENANCE_PATH));
  const provenance = JSON.parse(proofBytes.toString('utf8'));
  if (!validBuildProvenance(provenance)) throw new Error('Package has no clean, bound browser build provenance');
  const recorded = new Set();
  for (const output of provenance.outputs) {
    const key = output.archive+'/'+output.path;
    if (recorded.has(key)) throw new Error('Duplicate compiled build output');
    recorded.add(key);
    if (sha256(asar.extractFile(path.join(resources,output.archive),path.normalize(output.path))) !== output.sha256) throw new Error(`Packaged build output differs: ${key}`);
  }
  for (const mapping of COMPILED_ROOTS) {
    const archive = path.join(resources,mapping.archive);
    for (const item of asar.listPackage(archive)) {
      const file = item.replace(/^[/\\]+/u,'').replaceAll('\\','/');
      if (!file.startsWith(mapping.prefix) || file === PROVENANCE_PATH || asar.statFile(archive,path.normalize(file)).files) continue;
      if (!recorded.has(mapping.archive+'/'+file)) throw new Error(`Unrecorded packaged build output: ${file}`);
    }
  }
  return { schemaVersion: 2, artifacts, digest: createHash('sha256').update(JSON.stringify(artifacts)).digest('hex'), provenance, provenanceSha256:sha256(proofBytes) };
}
