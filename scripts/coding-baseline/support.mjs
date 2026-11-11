import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
export const outRoot = process.env.CODING_BASELINE_OUTPUT;
if (!outRoot || !path.isAbsolute(outRoot) || !fs.statSync(outRoot).isDirectory()) {
  throw new Error('Probe requires an existing absolute CODING_BASELINE_OUTPUT allocated by run.mjs');
}

// Each child gets its own freshly-created output directory. Never load the
// developer's credentials, config, plugins, transcripts or runtime database.
for (const name of ['home', 'state']) fs.mkdirSync(path.join(outRoot, name), { recursive: true });
process.env.OPENCLAW_HOME = path.join(outRoot, 'home');
process.env.OPENCLAW_STATE_DIR = path.join(outRoot, 'state');
process.env.OPENCLAW_CONFIG_PATH = path.join(outRoot, 'state', 'openclaw.json');
fs.writeFileSync(process.env.OPENCLAW_CONFIG_PATH, '{}\n', { flag: 'wx' });

export function sourceUrl(relativePath) {
  const absolute = path.resolve(repoRoot, relativePath);
  const rel = path.relative(repoRoot, absolute);
  if (path.isAbsolute(rel) || rel.startsWith('..')) throw new Error('Source outside the current worktree');
  return pathToFileURL(absolute).href;
}
