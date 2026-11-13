import { copyFileSync, existsSync, mkdirSync, statSync, utimesSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export const AGENT_DEV_EVIDENCE_INPUTS = Object.freeze([
  { id: 'workbench', path: 'agent-dev-workbench/evidence.json' },
  { id: 'deep-test', path: 'agent-dev-deep-test/report.json' },
  { id: 'deep-test-history', path: 'agent-dev-deep-test/history.json' },
  { id: 'quality', path: 'agent-dev-quality/report.json' },
]);

export function acceptanceArtifactPath(root, name) {
  const override = process.env.CLAWX_ACCEPTANCE_ARTIFACT_ROOT;
  if (override && !isAbsolute(override)) throw new Error('CLAWX_ACCEPTANCE_ARTIFACT_ROOT must be absolute');
  const base = resolve(override || resolve(root, 'artifacts'));
  const result = resolve(base, name);
  const local = relative(base, result);
  if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) throw new Error('artifact path escapes its output root');
  return result;
}

// Preserve the committed report inputs and timestamps before a role writes its
// own reports. Later reads use this directory, so deleted results stay missing.
export function prepareAcceptanceArtifacts(root, outputRoot) {
  mkdirSync(outputRoot, { recursive: true });
  for (const input of AGENT_DEV_EVIDENCE_INPUTS) {
    const source = resolve(root, 'artifacts', input.path);
    const target = resolve(outputRoot, input.path);
    if (!existsSync(source) || existsSync(target)) continue;
    const info = statSync(source);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    utimesSync(target, info.atime, info.mtime);
  }
}
