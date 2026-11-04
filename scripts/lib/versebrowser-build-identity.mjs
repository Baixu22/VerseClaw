import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

/** Captured by each runner before execution, not supplied as acceptance input. */
export async function browserBuildIdentity(exePath) {
  const files = [exePath, path.join(path.dirname(exePath), 'resources/app.asar'), path.join(path.dirname(exePath), 'resources/main-runtime.asar')];
  const artifacts = [];
  for (const file of files) {
    artifacts.push({ path: path.relative(path.dirname(exePath), file).replaceAll('\\', '/'),
      bytes: (await stat(file)).size, sha256: createHash('sha256').update(await readFile(file)).digest('hex') });
  }
  return { schemaVersion: 1, artifacts, digest: createHash('sha256').update(JSON.stringify(artifacts)).digest('hex') };
}
