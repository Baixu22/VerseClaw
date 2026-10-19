#!/usr/bin/env node
/**
 * Regenerates the renderer's file-type icon assets from the pinned dependency.
 *
 * Why this exists
 * ---------------
 * The composer renders file-type icons for non-image attachments through
 * `@lobehub/ui`'s `MaterialFileTypeIcon`. That component resolves its image URL
 * as `<cdnBase>/<iconName>.svg`, and `src/pages/Chat/ChatInput.tsx` points
 * `cdnBase` at `./lobe-icons` (relative to the renderer URL) with
 * `LobeConfigProvider`'s `customCdnFn`. So the running app — dev server and
 * packaged build alike — serves these files from `public/lobe-icons/`.
 *
 * The bytes themselves are third-party assets from the MIT-licensed
 * `@lobehub/assets-fileicon` package, which is already a declared dependency.
 * Tracking a second copy in Git cost 910 files (~4.8% of tracked paths at the
 * time issue #82 was filed) with no provenance recorded next to them. This
 * script makes `public/lobe-icons/` a generated directory instead:
 *
 *   - `public/lobe-icons/` is .gitignore'd and produced by this script.
 *   - `predev` / `prebuild:vite` run it, so dev and `pnpm run test:e2e` work
 *     after a plain `pnpm install`.
 *   - `PROVENANCE.json` inside the generated directory records the exact
 *     package, version, licence and per-file digests.
 *   - The bytes are byte-identical to `@lobehub/assets-fileicon@1.0.0`, so the
 *     icon URLs the renderer requests keep resolving to the same images.
 *
 * Usage
 * -----
 *   node scripts/sync-lobe-icons.mjs              # write (idempotent)
 *   node scripts/sync-lobe-icons.mjs --check      # verify only; exit 1 on drift
 *   node scripts/sync-lobe-icons.mjs --json       # machine-readable report
 *   node scripts/sync-lobe-icons.mjs --target <dir>
 *
 * `LOBE_ICONS_TARGET_DIR` overrides the target directory (used by tests so they
 * do not mutate the checkout).
 */
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PACKAGE_NAME = '@lobehub/assets-fileicon';
export const SOURCE_DIR = path.join(ROOT, 'node_modules', ...PACKAGE_NAME.split('/'), 'assets');
export const DEFAULT_TARGET_DIR = path.join(ROOT, 'public', 'lobe-icons');
export const PROVENANCE_FILE = 'PROVENANCE.json';
/** The renderer requests `<iconName>.svg` only; PROVENANCE.json is not served. */
const ICON_EXTENSION = '.svg';

export function resolveTargetDir(override) {
  return path.resolve(override ?? process.env.LOBE_ICONS_TARGET_DIR ?? DEFAULT_TARGET_DIR);
}

export function readDependencyIdentity() {
  const manifestPath = path.join(ROOT, 'node_modules', ...PACKAGE_NAME.split('/'), 'package.json');
  if (!existsSync(manifestPath)) {
    throw new Error(
      `${PACKAGE_NAME} is not installed at ${manifestPath}; run "pnpm install" before generating lobe icons.`,
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  return {
    name: manifest.name ?? PACKAGE_NAME,
    version: manifest.version ?? 'unknown',
    license: manifest.license ?? 'unknown',
    homepage: manifest.homepage ?? null,
    repository: manifest.repository?.url ?? null,
  };
}

export function listSourceIcons() {
  if (!existsSync(SOURCE_DIR)) {
    throw new Error(`${PACKAGE_NAME} has no assets directory at ${SOURCE_DIR}; the pinned package layout changed.`);
  }
  return readdirSync(SOURCE_DIR)
    .filter((name) => name.endsWith(ICON_EXTENSION))
    .sort();
}

function listTargetIcons(targetDir) {
  if (!existsSync(targetDir)) return [];
  return readdirSync(targetDir)
    .filter((name) => name.endsWith(ICON_EXTENSION))
    .sort();
}

export const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

/** Digest over the sorted `name sha256` list — one value identifying the whole set. */
export function aggregateDigest(names, digestFor) {
  const lines = names.map((name) => `${name} ${digestFor(name)}`);
  return sha256(Buffer.from(`${lines.join('\n')}\n`));
}

export function readSourceIcons() {
  const names = listSourceIcons();
  const buffers = new Map();
  for (const name of names) buffers.set(name, readFileSync(path.join(SOURCE_DIR, name)));
  return { names, buffers };
}

export function collectDrift(targetDir = resolveTargetDir()) {
  const { names, buffers } = readSourceIcons();
  const expected = new Set(names);
  const present = listTargetIcons(targetDir);
  const missing = [];
  const differing = [];
  for (const name of names) {
    const file = path.join(targetDir, name);
    if (!existsSync(file)) {
      missing.push(name);
      continue;
    }
    if (sha256(readFileSync(file)) !== sha256(buffers.get(name))) differing.push(name);
  }
  const extra = present.filter((name) => !expected.has(name));
  return { missing, differing, extra, iconCount: names.length };
}

export function syncLobeIcons({ targetDir = resolveTargetDir(), check = false } = {}) {
  const identity = readDependencyIdentity();
  const { names, buffers } = readSourceIcons();
  const drift = check ? collectDrift(targetDir) : { missing: [], differing: [], extra: [] };

  if (check) {
    return {
      ...identity,
      targetDir,
      iconCount: names.length,
      aggregateDigest: aggregateDigest(names, (name) => sha256(buffers.get(name))),
      drift,
      written: false,
      copied: 0,
      unchanged: names.length - drift.missing.length - drift.differing.length,
      removed: [],
    };
  }

  mkdirSync(targetDir, { recursive: true });
  let copied = 0;
  let unchanged = 0;
  for (const name of names) {
    const target = path.join(targetDir, name);
    const bytes = buffers.get(name);
    if (existsSync(target) && sha256(readFileSync(target)) === sha256(bytes)) {
      unchanged += 1;
      continue;
    }
    writeFileSync(target, bytes);
    copied += 1;
  }

  // Stale generated icons from a previous package version must not linger.
  const expected = new Set(names);
  const removed = listTargetIcons(targetDir).filter((name) => !expected.has(name));
  for (const name of removed) rmSync(path.join(targetDir, name));

  const provenance = {
    generatedBy: 'scripts/sync-lobe-icons.mjs',
    doNotEdit: 'Generated file. Run "pnpm run lobe-icons:sync" to regenerate.',
    package: identity.name,
    version: identity.version,
    license: identity.license,
    homepage: identity.homepage,
    repository: identity.repository,
    servedAt: '/lobe-icons/<iconName>.svg',
    requestedBy: 'src/pages/Chat/ChatInput.tsx (LobeConfigProvider customCdnFn)',
    iconCount: names.length,
    aggregateSha256: aggregateDigest(names, (name) => sha256(buffers.get(name))),
    icons: names.map((name) => ({ name, sha256: sha256(buffers.get(name)) })),
  };
  writeFileSync(path.join(targetDir, PROVENANCE_FILE), `${JSON.stringify(provenance, null, 2)}\n`);

  return {
    ...identity,
    targetDir,
    iconCount: names.length,
    aggregateDigest: provenance.aggregateSha256,
    drift: { missing: [], differing: [], extra: [] },
    written: true,
    copied,
    unchanged,
    removed,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const asJson = args.includes('--json');
  const targetIndex = args.indexOf('--target');
  const targetDir = resolveTargetDir(targetIndex === -1 ? undefined : args[targetIndex + 1]);

  let report;
  try {
    report = syncLobeIcons({ targetDir, check });
  } catch (error) {
    console.error(`[lobe-icons] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else if (check) {
    const driftCount = report.drift.missing.length + report.drift.differing.length + report.drift.extra.length;
    if (driftCount > 0) {
      console.error(
        `[lobe-icons] drift against ${report.name}@${report.version}: ` +
          `missing=${report.drift.missing.length} differing=${report.drift.differing.length} extra=${report.drift.extra.length}`,
      );
      for (const name of [...report.drift.missing, ...report.drift.differing, ...report.drift.extra].slice(0, 20)) {
        console.error(`  ${name}`);
      }
      process.exitCode = 1;
      return;
    }
    console.log(
      `[lobe-icons] ${report.iconCount} icons match ${report.name}@${report.version} (${report.license}); aggregate=${report.aggregateDigest.slice(0, 16)}…`,
    );
  } else {
    console.log(
      `[lobe-icons] ${report.iconCount} icons from ${report.name}@${report.version} (${report.license}) -> ` +
        `${path.relative(ROOT, report.targetDir) || report.targetDir} (copied=${report.copied} unchanged=${report.unchanged} removed=${report.removed.length})`,
    );
  }
}

if (isMainEntrypoint(import.meta.url)) await main();
