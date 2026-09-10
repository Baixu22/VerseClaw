// Entrypoint detection that survives Windows directory junctions.
//
// node realpath-resolves import.meta.url, so when the repo is reached through
// a junction (Desktop\clawx\ClawX -> D:\ClawX) the C: argv[1] and the D:
// module URL disagree and naive comparisons (`resolve(argv[1]) ===
// fileURLToPath(import.meta.url)`, `import.meta.url ===
// pathToFileURL(argv[1]).href`) never match — the script silently becomes a
// no-op. Comparing realpaths makes both spellings agree.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function isMainEntrypoint(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  const modulePath = fileURLToPath(moduleUrl);
  try {
    return realpathSync(argv1) === realpathSync(modulePath);
  } catch {
    return modulePath === argv1 || modulePath === argv1.replaceAll('\\', '/');
  }
}
