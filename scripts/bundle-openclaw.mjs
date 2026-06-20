#!/usr/bin/env zx

/**
 * bundle-openclaw.mjs
 *
 * Bundles the openclaw npm package with ALL its dependencies (including
 * transitive ones) into a self-contained directory (build/openclaw/) for
 * electron-builder to pick up.
 *
 * pnpm uses a content-addressable virtual store with symlinks. A naive copy
 * of node_modules/openclaw/ will miss runtime dependencies entirely. Even
 * copying only direct siblings misses transitive deps (e.g. @clack/prompts
 * depends on @clack/core which lives in a separate virtual store entry).
 *
 * This script performs a recursive BFS through pnpm's virtual store to
 * collect every transitive dependency into a flat node_modules structure.
 */

import 'zx/globals';
import { ELECTRON_MAIN_RUNTIME_PACKAGES, EXTRA_BUNDLED_PACKAGES } from './openclaw-bundle-config.mjs';
import { patchExtensionOpenClawSelfImports } from './openclaw-self-import-patch.mjs';

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'build', 'openclaw');
const NODE_MODULES = path.join(ROOT, 'node_modules');
const BUNDLED_OPENCLAW_SKILL_ALLOWLIST = new Set(['skill-creator']);

// On Windows, pnpm virtual store paths can exceed MAX_PATH (260 chars).
function normWin(p) {
  if (process.platform !== 'win32') return p;
  if (p.startsWith('\\\\?\\')) return p;
  return '\\\\?\\' + p.replace(/\//g, '\\');
}

echo`📦 Bundling openclaw for electron-builder...`;

// 1. Resolve the real path of node_modules/openclaw (follows pnpm symlink)
const openclawLink = path.join(NODE_MODULES, 'openclaw');
if (!fs.existsSync(openclawLink)) {
  echo`❌ node_modules/openclaw not found. Run pnpm install first.`;
  process.exit(1);
}

const openclawReal = fs.realpathSync(openclawLink);
echo`   openclaw resolved: ${openclawReal}`;

function shouldCopyOpenClawPackageEntry(src) {
  const rel = path.relative(openclawReal, src);
  if (!rel || rel.startsWith('..')) return true;
  const parts = rel.split(path.sep);

  for (let i = 0; i < parts.length - 1; i += 1) {
    if (parts[i] === 'node_modules' && parts[i + 1] === '.bin') {
      return false;
    }
  }

  return true;
}

function trimBundledOpenClawSkills(skillsRoot) {
  if (!fs.existsSync(skillsRoot)) return { removed: 0, kept: [...BUNDLED_OPENCLAW_SKILL_ALLOWLIST] };

  let removed = 0;
  for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (BUNDLED_OPENCLAW_SKILL_ALLOWLIST.has(entry.name)) continue;

    const skillDir = path.join(skillsRoot, entry.name);
    if (!fs.existsSync(path.join(skillDir, 'SKILL.md'))) continue;
    fs.rmSync(skillDir, { recursive: true, force: true });
    removed += 1;
  }

  return { removed, kept: [...BUNDLED_OPENCLAW_SKILL_ALLOWLIST] };
}

function removeDirRobust(targetDir) {
  if (!fs.existsSync(targetDir)) return;

  try {
    fs.rmSync(targetDir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (fs.existsSync(targetDir) && (code === 'EACCES' || code === 'ENOTEMPTY' || code === 'EPERM')) {
      try {
        fs.removeSync(targetDir);
      } catch {
        // fall through to final existence check below
      }
    } else {
      throw error;
    }
  }

  if (fs.existsSync(targetDir)) {
    throw new Error(`Failed to remove directory: ${targetDir}`);
  }
}

// 2. Clean and create output directory
removeDirRobust(OUTPUT);
fs.mkdirSync(OUTPUT, { recursive: true });

// 3. Copy openclaw package itself to OUTPUT root
echo`   Copying openclaw package...`;
fs.cpSync(openclawReal, OUTPUT, {
  recursive: true,
  dereference: true,
  filter: shouldCopyOpenClawPackageEntry,
});

const bundledSkillsTrim = trimBundledOpenClawSkills(path.join(OUTPUT, 'skills'));
if (bundledSkillsTrim.removed > 0) {
  echo`   Trimmed bundled OpenClaw skills: removed ${bundledSkillsTrim.removed}, kept ${bundledSkillsTrim.kept.join(', ')}`;
}

// 4. Recursively collect ALL transitive dependencies via pnpm virtual store BFS
//
// pnpm structure example:
//   .pnpm/openclaw@ver/node_modules/
//     openclaw/          <- real files
//     chalk/             <- symlink -> .pnpm/chalk@ver/node_modules/chalk
//     @clack/prompts/    <- symlink -> .pnpm/@clack+prompts@ver/node_modules/@clack/prompts
//
//   .pnpm/@clack+prompts@ver/node_modules/
//     @clack/prompts/    <- real files
//     @clack/core/       <- symlink (transitive dep, NOT in openclaw's siblings!)
//
// We BFS from openclaw's virtual store node_modules, following each symlink
// to discover the target's own virtual store node_modules and its deps.

const collected = new Map(); // realPath -> packageName (for deduplication)
const queue = []; // BFS queue of virtual-store node_modules dirs to visit

/**
 * Given a real path of a package, find the containing virtual-store node_modules.
 * e.g. .pnpm/chalk@5.4.1/node_modules/chalk -> .pnpm/chalk@5.4.1/node_modules
 * e.g. .pnpm/@clack+core@0.4.1/node_modules/@clack/core -> .pnpm/@clack+core@0.4.1/node_modules
 */
function getVirtualStoreNodeModules(realPkgPath) {
  let dir = realPkgPath;
  while (dir !== path.dirname(dir)) {
    if (path.basename(dir) === 'node_modules') {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * List all package entries in a virtual-store node_modules directory.
 * Handles both regular packages (chalk) and scoped packages (@clack/prompts).
 * Returns array of { name, fullPath }.
 */
function listPackages(nodeModulesDir) {
  const result = [];
  const nDir = normWin(nodeModulesDir);
  if (!fs.existsSync(nDir)) return result;

  for (const entry of fs.readdirSync(nDir)) {
    if (entry === '.bin') continue;
    // Use original (non-normWin) path so callers can call
    // getVirtualStoreNodeModules() on fullPath correctly.
    const entryPath = path.join(nodeModulesDir, entry);

    if (entry.startsWith('@')) {
      try {
        const scopeEntries = fs.readdirSync(normWin(entryPath));
        for (const sub of scopeEntries) {
          result.push({
            name: `${entry}/${sub}`,
            fullPath: path.join(entryPath, sub),
          });
        }
      } catch {
        // Not a directory, skip
      }
    } else {
      result.push({ name: entry, fullPath: entryPath });
    }
  }
  return result;
}

// Start BFS from openclaw's virtual store node_modules
const openclawVirtualNM = getVirtualStoreNodeModules(openclawReal);
if (!openclawVirtualNM) {
  echo`❌ Could not determine pnpm virtual store for openclaw`;
  process.exit(1);
}

echo`   Virtual store root: ${openclawVirtualNM}`;
queue.push({ nodeModulesDir: openclawVirtualNM, skipPkg: 'openclaw' });

const SKIP_PACKAGES = new Set([
  // Extra bundled extensions can declare openclaw as a peer/optional dependency.
  // The bundle already copies openclaw to OUTPUT root,
  // so do not also copy a duplicate into OUTPUT/node_modules/openclaw.
  'openclaw',
  'typescript',
  '@playwright/test',
  // @discordjs/opus is a native .node addon compiled for the system Node.js
  // ABI. The Gateway runs inside Electron's utilityProcess which has a
  // different ABI, so the binary fails with "Cannot find native binding".
  // The package is optional — openclaw gracefully degrades when absent
  // (only Discord voice features are affected; text chat works fine).
  '@discordjs/opus',
]);
const SKIP_SCOPES = ['@cloudflare/', '@types/'];
let skippedDevCount = 0;

while (queue.length > 0) {
  const { nodeModulesDir, skipPkg } = queue.shift();
  const packages = listPackages(nodeModulesDir);

  for (const { name, fullPath } of packages) {
    // Skip the package that owns this virtual store entry (it's the package itself, not a dep)
    if (name === skipPkg) continue;

    if (SKIP_PACKAGES.has(name) || SKIP_SCOPES.some(s => name.startsWith(s))) {
      skippedDevCount++;
      continue;
    }

    let realPath;
    try {
      realPath = fs.realpathSync(fullPath);
    } catch {
      continue; // broken symlink, skip
    }

    if (collected.has(realPath)) continue; // already visited
    collected.set(realPath, name);

    // Find this package's own virtual store node_modules to discover ITS deps
    const depVirtualNM = getVirtualStoreNodeModules(realPath);
    if (depVirtualNM && depVirtualNM !== nodeModulesDir) {
      // Determine the package's "self name" in its own virtual store
      // For scoped: @clack/core -> skip "@clack/core" when scanning
      queue.push({ nodeModulesDir: depVirtualNM, skipPkg: name });
    }
  }
}

echo`   Found ${collected.size} total packages (direct + transitive)`;
echo`   Skipped ${skippedDevCount} dev-only package references`;

// 4b. Collect extra packages required by ClawX's Electron main process that are
//     NOT deps of openclaw.  These are resolved from openclaw's context at runtime
//     (via createRequire from the openclaw directory) so they must live in the
//     bundled openclaw/node_modules/.
//
//     For each package we resolve it from the workspace's own node_modules,
//     then BFS its transitive deps exactly like we did for openclaw above.
let extraCount = 0;
for (const pkgName of EXTRA_BUNDLED_PACKAGES) {
  const pkgLink = path.join(NODE_MODULES, ...pkgName.split('/'));
  if (!fs.existsSync(pkgLink)) {
    echo`   ⚠️  Extra package ${pkgName} not found in workspace node_modules, skipping.`;
    continue;
  }

  let pkgReal;
  try { pkgReal = fs.realpathSync(pkgLink); } catch { continue; }

  if (!collected.has(pkgReal)) {
    collected.set(pkgReal, pkgName);
    extraCount++;

    // BFS this package's own transitive deps
    const depVirtualNM = getVirtualStoreNodeModules(pkgReal);
    if (depVirtualNM) {
      const extraQueue = [{ nodeModulesDir: depVirtualNM, skipPkg: pkgName }];
      while (extraQueue.length > 0) {
        const { nodeModulesDir, skipPkg } = extraQueue.shift();
        const packages = listPackages(nodeModulesDir);
        for (const { name, fullPath } of packages) {
          if (name === skipPkg) continue;
          if (SKIP_PACKAGES.has(name) || SKIP_SCOPES.some(s => name.startsWith(s))) continue;
          let realPath;
          try { realPath = fs.realpathSync(fullPath); } catch { continue; }
          if (collected.has(realPath)) continue;
          collected.set(realPath, name);
          extraCount++;
          const innerVirtualNM = getVirtualStoreNodeModules(realPath);
          if (innerVirtualNM && innerVirtualNM !== nodeModulesDir) {
            extraQueue.push({ nodeModulesDir: innerVirtualNM, skipPkg: name });
          }
        }
      }
    }
  }
}

if (extraCount > 0) {
  echo`   Added ${extraCount} extra packages (+ transitive deps) for Electron main process`;
}

// 5. Copy all collected packages into OUTPUT/node_modules/ (flat structure)
//
// IMPORTANT: BFS guarantees direct deps are encountered before transitive deps.
// When the same package name appears at different versions (e.g. chalk@5 from
// openclaw directly, chalk@4 from a transitive dep), we keep the FIRST one
// (direct dep version) and skip later duplicates. This prevents version
// conflicts like CJS chalk@4 overwriting ESM chalk@5.
const outputNodeModules = path.join(OUTPUT, 'node_modules');
fs.mkdirSync(outputNodeModules, { recursive: true });

const copiedNames = new Set(); // Track package names already copied
let copiedCount = 0;
let skippedDupes = 0;

const preferredBundledPackages = new Set(EXTRA_BUNDLED_PACKAGES);
const preferredBundledPackageRealPaths = new Set();
for (const pkgName of EXTRA_BUNDLED_PACKAGES) {
  const pkgLink = path.join(NODE_MODULES, ...pkgName.split('/'));
  if (!fs.existsSync(pkgLink)) continue;
  try {
    preferredBundledPackageRealPaths.add(fs.realpathSync(pkgLink));
  } catch {
    // ignore
  }
}

const collectedEntries = [...collected].sort(([leftRealPath, leftName], [rightRealPath, rightName]) => {
  const leftPreferredRealPath = preferredBundledPackageRealPaths.has(leftRealPath);
  const rightPreferredRealPath = preferredBundledPackageRealPaths.has(rightRealPath);
  if (leftPreferredRealPath !== rightPreferredRealPath) return leftPreferredRealPath ? -1 : 1;

  const leftPreferred = preferredBundledPackages.has(leftName);
  const rightPreferred = preferredBundledPackages.has(rightName);
  if (leftPreferred !== rightPreferred) return leftPreferred ? -1 : 1;

  return 0;
});

for (const [realPath, pkgName] of collectedEntries) {
  if (copiedNames.has(pkgName)) {
    skippedDupes++;
    continue; // Keep the first version (closer to openclaw in dep tree)
  }
  copiedNames.add(pkgName);

  const dest = path.join(outputNodeModules, pkgName);

  try {
    fs.mkdirSync(normWin(path.dirname(dest)), { recursive: true });
    fs.cpSync(normWin(realPath), normWin(dest), { recursive: true, dereference: true });
    copiedCount++;
  } catch (err) {
    echo`   ⚠️  Skipped ${pkgName}: ${err.message}`;
  }
}

// 5b. Merge built-in extension node_modules into top-level node_modules
//
// OpenClaw 3.31+ ships built-in extensions (telegram, discord, etc.) under
// dist/extensions/<ext>/node_modules/.  The Rollup bundler creates shared
// chunks at dist/ root (e.g. sticker-cache-*.js) that eagerly import
// extension-specific packages like "grammy".  Node.js resolves bare
// specifiers from the importing file's directory upward:
//   dist/ → openclaw/ → openclaw/node_modules/
// It does NOT search dist/extensions/telegram/node_modules/.
//
// Fix: copy extension deps into the top-level node_modules/ so they are
// resolvable from shared chunks.  Skip-if-exists preserves version priority
// (openclaw's own deps take precedence over extension deps).
const extensionsDir = path.join(OUTPUT, 'dist', 'extensions');
function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function listPackageDeps(pkgJson) {
  return Object.keys({
    ...(pkgJson?.dependencies && typeof pkgJson.dependencies === 'object' ? pkgJson.dependencies : {}),
    ...(pkgJson?.optionalDependencies && typeof pkgJson.optionalDependencies === 'object' ? pkgJson.optionalDependencies : {}),
  }).sort((a, b) => a.localeCompare(b));
}

let mergedExtCount = 0;
let mirroredExtRuntimeDeps = 0;
if (fs.existsSync(extensionsDir)) {
  for (const extEntry of fs.readdirSync(extensionsDir, { withFileTypes: true })) {
    if (!extEntry.isDirectory()) continue;
    const extRoot = path.join(extensionsDir, extEntry.name);
    const extNM = path.join(extRoot, 'node_modules');

    if (fs.existsSync(extNM)) {
      for (const pkgEntry of fs.readdirSync(extNM, { withFileTypes: true })) {
        if (!pkgEntry.isDirectory() || pkgEntry.name === '.bin') continue;
        const srcPkg = path.join(extNM, pkgEntry.name);

        if (pkgEntry.name.startsWith('@')) {
          // Scoped package — iterate sub-entries
          let scopeEntries;
          try { scopeEntries = fs.readdirSync(srcPkg, { withFileTypes: true }); } catch { continue; }
          for (const scopeEntry of scopeEntries) {
            if (!scopeEntry.isDirectory()) continue;
            const scopedName = `${pkgEntry.name}/${scopeEntry.name}`;
            if (copiedNames.has(scopedName)) continue;
            const srcScoped = path.join(srcPkg, scopeEntry.name);
            const destScoped = path.join(outputNodeModules, pkgEntry.name, scopeEntry.name);
            try {
              fs.mkdirSync(normWin(path.dirname(destScoped)), { recursive: true });
              fs.cpSync(normWin(srcScoped), normWin(destScoped), { recursive: true, dereference: true });
              copiedNames.add(scopedName);
              mergedExtCount++;
            } catch { /* skip on copy error */ }
          }
        } else {
          if (copiedNames.has(pkgEntry.name)) continue;
          const destPkg = path.join(outputNodeModules, pkgEntry.name);
          try {
            fs.cpSync(normWin(srcPkg), normWin(destPkg), { recursive: true, dereference: true });
            copiedNames.add(pkgEntry.name);
            mergedExtCount++;
          } catch { /* skip on copy error */ }
        }
      }
    }

    const extPkg = readJsonSafe(path.join(extRoot, 'package.json'));
    for (const depName of listPackageDeps(extPkg)) {
      const srcPkg = path.join(outputNodeModules, ...depName.split('/'));
      const destPkg = path.join(extNM, ...depName.split('/'));
      if (!fs.existsSync(srcPkg) || fs.existsSync(destPkg)) continue;
      try {
        fs.mkdirSync(normWin(path.dirname(destPkg)), { recursive: true });
        fs.cpSync(normWin(srcPkg), normWin(destPkg), { recursive: true, dereference: true });
        mirroredExtRuntimeDeps++;
      } catch { /* skip on copy error */ }
    }
  }
}

if (mergedExtCount > 0) {
  echo`   Merged ${mergedExtCount} extension packages into top-level node_modules`;
}
if (mirroredExtRuntimeDeps > 0) {
  echo`   Mirrored ${mirroredExtRuntimeDeps} extension runtime deps into dist/extensions/*/node_modules`;
}

function patchBundledExtensionPackageJsons(extensionsRoot) {
  let patchedCount = 0;

  const discordPkgPath = path.join(extensionsRoot, 'discord', 'package.json');
  if (fs.existsSync(discordPkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(discordPkgPath, 'utf8'));
      if (pkg?.dependencies?.opusscript === '^0.0.8') {
        pkg.dependencies.opusscript = '^0.1.1';
        fs.writeFileSync(discordPkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
        patchedCount++;
        echo`   🩹 Patched discord bundled runtime dep range: opusscript ^0.0.8 -> ^0.1.1`;
      }
    } catch {
      // ignore
    }
  }

  return patchedCount;
}

patchBundledExtensionPackageJsons(extensionsDir);

// 6. Clean up the bundle to reduce package size
//
// This removes platform-agnostic waste: dev artifacts, docs, source maps,
// type definitions, test directories, and known large unused subdirectories.
// Platform-specific cleanup (e.g. koffi binaries) is handled in after-pack.cjs
// which has access to the target platform/arch context.

function getDirSize(dir) {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) total += getDirSize(p);
      else if (entry.isFile()) total += fs.statSync(p).size;
    }
  } catch { /* ignore */ }
  return total;
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}G`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}M`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${bytes}B`;
}

function rmSafe(target) {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isDirectory()) fs.rmSync(target, { recursive: true, force: true });
    else fs.rmSync(target, { force: true });
    return true;
  } catch { return false; }
}

function cleanupNodeModulesRuntimeJunk(nodeModulesDir) {
  let removedCount = 0;

  const nodeWavDir = path.join(nodeModulesDir, 'node-wav');
  for (const name of ['x.json', 'x.js', 'x.js~', 'file.wav']) {
    if (rmSafe(path.join(nodeWavDir, name))) removedCount++;
  }

  // tree-sitter-bash ships C sources for rebuilding its native addon. Packaged
  // builds use the prebuilt addon/wasm; keep node-types.json because the CJS
  // entry exposes it as optional runtime metadata.
  const treeSitterSrc = path.join(nodeModulesDir, 'tree-sitter-bash', 'src');
  for (const name of ['parser.c', 'scanner.c', 'grammar.json', 'tree_sitter']) {
    if (rmSafe(path.join(treeSitterSrc, name))) removedCount++;
  }

  return removedCount;
}

function cleanupKnownRuntimeJunk(rootDir) {
  let removedCount = 0;
  const stack = [rootDir];

  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }

    if (path.basename(dir) === 'node_modules') {
      removedCount += cleanupNodeModulesRuntimeJunk(dir);
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      stack.push(path.join(dir, entry.name));
    }
  }

  return removedCount;
}

function cleanupBundle(outputDir) {
  let removedCount = 0;
  const nm = path.join(outputDir, 'node_modules');
  // OpenClaw 3.x ships built-in extensions under dist/extensions/<ext>/, not
  // extensions/. The previous `path.join(outputDir, 'extensions')` silently
  // resolved to a non-existent directory so the entire walkExt() pass below
  // (which is what cleans .d.ts / .d.mts / source maps inside per-extension
  // node_modules) was a no-op. That left ~28k .d.mts files in the bundle and
  // contributed to the macOS codesign EMFILE blow-up.
  const ext = path.join(outputDir, 'dist', 'extensions');

  // --- openclaw root junk ---
  for (const name of ['CHANGELOG.md', 'README.md']) {
    if (rmSafe(path.join(outputDir, name))) removedCount++;
  }

  // docs/ is kept — contains prompt templates and other runtime-used prompts

  // --- extensions: clean junk from source, aggressively clean nested node_modules ---
  // Extension source (.ts files) are runtime entry points — must be preserved.
  // Only nested node_modules/ inside extensions get the aggressive cleanup.
  if (fs.existsSync(ext)) {
    const JUNK_EXTS = new Set(['.prose', '.ignored_openclaw', '.keep']);
    const NM_REMOVE_DIRS = new Set([
      'test', 'tests', '__tests__', '.github', 'docs', 'examples', 'example',
    ]);
    // .d.mts / .d.cts are TypeScript declaration files for ESM/CJS dual-package
    // builds. They are useless at runtime but show up in huge volumes from
    // typed packages (e.g. typebox), and inflate the per-process file count
    // that codesign opens during macOS signing → EMFILE.
    const NM_REMOVE_FILE_EXTS = [
      '.d.ts', '.d.ts.map',
      '.d.mts', '.d.mts.map',
      '.d.cts', '.d.cts.map',
      '.js.map', '.mjs.map', '.cjs.map', '.ts.map',
      '.markdown',
    ];
    const NM_REMOVE_FILE_NAMES = new Set([
      '.DS_Store', 'README.md', 'CHANGELOG.md', 'LICENSE.md', 'CONTRIBUTING.md',
      'tsconfig.json', '.npmignore', '.eslintrc', '.prettierrc', '.editorconfig',
    ]);

    // .md files inside skills/ directories are runtime content (SKILL.md,
    // block-types.md, etc.) and must NOT be removed.
    const JUNK_MD_NAMES = new Set([
      'README.md', 'CHANGELOG.md', 'LICENSE.md', 'CONTRIBUTING.md',
    ]);

    function walkExt(dir, insideNodeModules, insideSkills) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (insideNodeModules && NM_REMOVE_DIRS.has(entry.name)) {
            if (rmSafe(full)) removedCount++;
          } else {
            walkExt(
              full,
              insideNodeModules || entry.name === 'node_modules',
              insideSkills || entry.name === 'skills',
            );
          }
        } else if (entry.isFile()) {
          if (insideNodeModules) {
            const name = entry.name;
            if (NM_REMOVE_FILE_NAMES.has(name) || NM_REMOVE_FILE_EXTS.some(e => name.endsWith(e))) {
              if (rmSafe(full)) removedCount++;
            }
          } else {
            // Inside skills/ directories, .md files are skill content — keep them.
            // Outside skills/, remove known junk .md files only.
            const isMd = entry.name.endsWith('.md');
            const isJunkMd = isMd && JUNK_MD_NAMES.has(entry.name);
            const isJunkExt = JUNK_EXTS.has(path.extname(entry.name));
            if (isJunkExt || (isMd && !insideSkills && isJunkMd)) {
              if (rmSafe(full)) removedCount++;
            }
          }
        }
      }
    }
    walkExt(ext, false, false);
  }

  // --- node_modules: remove unnecessary file types and directories ---
  if (fs.existsSync(nm)) {
    const REMOVE_DIRS = new Set([
      'test', 'tests', '__tests__', '.github', 'docs', 'examples', 'example',
    ]);
    const REMOVE_FILE_EXTS = [
      '.d.ts', '.d.ts.map',
      '.d.mts', '.d.mts.map',
      '.d.cts', '.d.cts.map',
      '.js.map', '.mjs.map', '.cjs.map', '.ts.map',
      '.markdown',
    ];
    const REMOVE_FILE_NAMES = new Set([
      '.DS_Store', 'README.md', 'CHANGELOG.md', 'LICENSE.md', 'CONTRIBUTING.md',
      'tsconfig.json', '.npmignore', '.eslintrc', '.prettierrc', '.editorconfig',
    ]);

    function walkClean(dir) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (REMOVE_DIRS.has(entry.name)) {
            if (rmSafe(full)) removedCount++;
          } else {
            walkClean(full);
          }
        } else if (entry.isFile()) {
          const name = entry.name;
          if (REMOVE_FILE_NAMES.has(name) || REMOVE_FILE_EXTS.some(e => name.endsWith(e))) {
            if (rmSafe(full)) removedCount++;
          }
        }
      }
    }
    walkClean(nm);
  }

  // --- known large unused subdirectories ---
  const LARGE_REMOVALS = [
    'node_modules/pdfjs-dist/legacy',
    'node_modules/pdfjs-dist/types',
    'node_modules/node-llama-cpp/llama',
    'node_modules/koffi/src',
    'node_modules/koffi/vendor',
    'node_modules/koffi/doc',
    'dist/extensions/feishu', // Removed in favor of official @larksuite/openclaw-lark plugin
  ];
  for (const rel of LARGE_REMOVALS) {
    if (rmSafe(path.join(outputDir, rel))) removedCount++;
  }

  removedCount += cleanupKnownRuntimeJunk(outputDir);

  return removedCount;
}

echo``;
echo`🧹 Cleaning up bundle (removing dev artifacts, docs, source maps, type defs)...`;
const sizeBefore = getDirSize(OUTPUT);
const cleanedCount = cleanupBundle(OUTPUT);
const sizeAfter = getDirSize(OUTPUT);
echo`   Removed ${cleanedCount} files/directories`;
echo`   Size: ${formatSize(sizeBefore)} → ${formatSize(sizeAfter)} (saved ${formatSize(sizeBefore - sizeAfter)})`;

// 7. Patch known broken packages
//
// Some packages in the ecosystem have transpiled CJS output that sets
// `module.exports = exports.default` without ever assigning `exports.default`,
// resulting in `module.exports = undefined`.  This causes a TypeError in
// Node.js 22+ ESM interop when the translators try to call hasOwnProperty on
// the undefined exports object.
//
// We also patch Windows child_process spawn sites in the bundled agent runtime
// so shell/tool execution does not flash a console window for each tool call.
// We patch these files in-place after the copy so the bundle is safe to run.
function patchBrokenModules(nodeModulesDir) {
  const rewritePatches = {
    // node-domexception@1.0.0: transpiled index.js leaves module.exports = undefined.
    // Node.js 18+ ships DOMException as a built-in global, so a simple shim works.
    'node-domexception/index.js': [
      `'use strict';`,
      `// Shim: the original transpiled file sets module.exports = exports.default`,
      `// (which is undefined), causing TypeError in Node.js 22+ ESM interop.`,
      `// Node.js 18+ has DOMException as a built-in global.`,
      `const dom = globalThis.DOMException ||`,
      `  class DOMException extends Error {`,
      `    constructor(msg, name) { super(msg); this.name = name || 'Error'; }`,
      `  };`,
      `module.exports = dom;`,
      `module.exports.DOMException = dom;`,
      `module.exports.default = dom;`,
    ].join('\n'),
  };
  const replacePatches = [
    // Note: @mariozechner/pi-coding-agent is no longer a dep of openclaw 3.31.
  ];

  let count = 0;
  for (const [rel, content] of Object.entries(rewritePatches)) {
    const target = path.join(nodeModulesDir, rel);
    if (fs.existsSync(target)) {
      fs.writeFileSync(target, content + '\n', 'utf8');
      count++;
    }
  }
  for (const { rel, search, replace } of replacePatches) {
    const target = path.join(nodeModulesDir, rel);
    if (!fs.existsSync(target)) continue;

    const current = fs.readFileSync(target, 'utf8');
    if (!current.includes(search)) {
      echo`   ⚠️  Skipped patch for ${rel}: expected source snippet not found`;
      continue;
    }

    const next = current.replace(search, replace);
    if (next !== current) {
      fs.writeFileSync(target, next, 'utf8');
      count++;
    }
  }
  // lru-cache CJS/ESM interop fix (recursive):
  // Multiple versions of lru-cache may exist in the output tree — not just
  // at node_modules/lru-cache/ but also nested inside other packages.
  // Older CJS versions (v5, v6) export the class via `module.exports = LRUCache`
  // without a named `LRUCache` property, so `import { LRUCache } from 'lru-cache'`
  // fails in Node.js 22+ ESM interop (used by Electron 40+).
  // We recursively scan the entire output for ALL lru-cache installations and
  // patch each CJS entry to ensure `exports.LRUCache` always exists.
  function patchAllLruCacheInstances(rootDir) {
    let lruCount = 0;
    const stack = [rootDir];
    while (stack.length > 0) {
      const dir = stack.pop();
      let entries;
      try { entries = fs.readdirSync(normWin(dir), { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        let isDirectory = entry.isDirectory();
        if (!isDirectory) {
          // pnpm layout may contain symlink/junction directories on Windows.
          try { isDirectory = fs.statSync(normWin(fullPath)).isDirectory(); } catch { isDirectory = false; }
        }
        if (!isDirectory) continue;
        if (entry.name === 'lru-cache') {
          const pkgPath = path.join(fullPath, 'package.json');
          if (!fs.existsSync(normWin(pkgPath))) { stack.push(fullPath); continue; }
          try {
            const pkg = JSON.parse(fs.readFileSync(normWin(pkgPath), 'utf8'));
            if (pkg.type === 'module') continue; // ESM version — already has named exports
            const mainFile = pkg.main || 'index.js';
            const entryFile = path.join(fullPath, mainFile);
            if (!fs.existsSync(normWin(entryFile))) continue;
            const original = fs.readFileSync(normWin(entryFile), 'utf8');
            if (!original.includes('exports.LRUCache')) {
              const patched = [
                original,
                '',
                '// ClawX patch: add LRUCache named export for Node.js 22+ ESM interop',
                'if (typeof module.exports === "function" && !module.exports.LRUCache) {',
                '  module.exports.LRUCache = module.exports;',
                '}',
                '',
              ].join('\n');
              fs.writeFileSync(normWin(entryFile), patched, 'utf8');
              lruCount++;
              echo`   🩹 Patched lru-cache CJS (v${pkg.version}) at ${path.relative(rootDir, fullPath)}`;
            }

            // lru-cache v7 ESM entry exports default only; add named export.
            const moduleFile = typeof pkg.module === 'string' ? pkg.module : null;
            if (moduleFile) {
              const esmEntry = path.join(fullPath, moduleFile);
              if (fs.existsSync(normWin(esmEntry))) {
                const esmOriginal = fs.readFileSync(normWin(esmEntry), 'utf8');
                if (
                  esmOriginal.includes('export default LRUCache') &&
                  !esmOriginal.includes('export { LRUCache')
                ) {
                  const esmPatched = [esmOriginal, '', 'export { LRUCache }', ''].join('\n');
                  fs.writeFileSync(normWin(esmEntry), esmPatched, 'utf8');
                  lruCount++;
                  echo`   🩹 Patched lru-cache ESM (v${pkg.version}) at ${path.relative(rootDir, fullPath)}`;
                }
              }
            }
          } catch (err) {
            echo`   ⚠️  Failed to patch lru-cache at ${fullPath}: ${err.message}`;
          }
        } else {
          stack.push(fullPath);
        }
      }
    }
    return lruCount;
  }
  const lruPatched = patchAllLruCacheInstances(nodeModulesDir);
  count += lruPatched;

  if (count > 0) {
    echo`   🩹 Patched ${count} broken module(s) in node_modules`;
  }
}

function findFirstFileByName(rootDir, matcher) {
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && matcher.test(entry.name)) {
        return fullPath;
      }
    }
  }
  return null;
}

function findFilesByName(rootDir, matcher) {
  const matches = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && matcher.test(entry.name)) {
        matches.push(fullPath);
      }
    }
  }
  return matches;
}

// ─── ClawX file-tool patch helpers ─────────────────────────────────────────

function patchEditDiffTool(piToolsDir) {
  const target = path.join(piToolsDir, 'edit-diff.js');
  if (!fs.existsSync(target)) {
    echo`   ⚠️  Skipped edit-diff patches: target file not found`;
    return;
  }

  let content = fs.readFileSync(target, 'utf8');
  let patchCount = 0;

  // ── P1: Enhance normalizeForFuzzyMatch with additional Unicode replacements ──
  const p1Search = `.replace(/[\\u00A0\\u2002-\\u200A\\u202F\\u205F\\u3000]/g, " "));`;
  const p1Replace = [
    `        // ClawX patch: additional Unicode normalization`,
    `        .replace(/[\\u00A0\\u2002-\\u200A\\u202F\\u205F\\u3000]/g, " ")`,
    `        .replace(/\\u2260/g, "!=")`,
    `        .replace(/\\u2044/g, "/")`,
    `        .replace(/[\\u200B-\\u200D\\uFEFF]/g, ""));`,
  ].join('\n');
  if (content.includes(p1Search)) {
    content = content.replace(p1Search, p1Replace);
    patchCount++;
  } else {
    echo`   ⚠️  Skipped P1 (Unicode enhancement): search anchor not found`;
  }

  // ── P2: Inject all helper functions before fuzzyFindText ──
  const HELPERS = [
    `// ═══════════════════════════════════════════════════════════════════════`,
    `// ClawX patch: Enhanced matching helpers (ported from oh-my-pi)`,
    `// ═══════════════════════════════════════════════════════════════════════`,
    ``,
    `// P2a: Comment prefix stripping — handles LLM sending "// code" or "# code"`,
    `function stripCommentPrefix(line) {`,
    `    let t = line.trimStart();`,
    `    if (t.startsWith("/*")) t = t.slice(2);`,
    `    else if (t.startsWith("*/")) t = t.slice(2);`,
    `    else if (t.startsWith("//")) t = t.slice(2);`,
    `    else if (t.startsWith("*")) t = t.slice(1);`,
    `    else if (t.startsWith("#")) t = t.slice(1);`,
    `    else if (t.startsWith(";")) t = t.slice(1);`,
    `    else if (t.startsWith("/") && t.length > 1 && t[1] === " ") t = t.slice(1);`,
    `    return t.trimStart();`,
    `}`,
    ``,
    `// P2b: Line-trimmed matching — trims both ends of each line (fixes indentation mismatch)`,
    `function _cxLtIndexOf(content, needle) {`,
    `    const cLines = content.split("\\n");`,
    `    const nLines = needle.split("\\n").map(l => l.trim());`,
    `    if (nLines.length === 0 || nLines.every(l => l.length === 0)) return -1;`,
    `    for (let start = 0; start <= cLines.length - nLines.length; start++) {`,
    `        let ok = true;`,
    `        for (let j = 0; j < nLines.length; j++) {`,
    `            if (cLines[start + j].trim() !== nLines[j]) { ok = false; break; }`,
    `        }`,
    `        if (ok) {`,
    `            let offset = 0;`,
    `            for (let k = 0; k < start; k++) offset += cLines[k].length + 1;`,
    `            return offset;`,
    `        }`,
    `    }`,
    `    return -1;`,
    `}`,
    ``,
    `// P2c: Comment-prefix matching — strips comment markers before comparing`,
    `function _cxCommentPrefixIndexOf(content, needle) {`,
    `    const cLines = content.split("\\n");`,
    `    const nLines = needle.split("\\n").map(l => stripCommentPrefix(l));`,
    `    if (nLines.length === 0 || nLines.every(l => l.length === 0)) return -1;`,
    `    for (let start = 0; start <= cLines.length - nLines.length; start++) {`,
    `        let ok = true;`,
    `        for (let j = 0; j < nLines.length; j++) {`,
    `            if (stripCommentPrefix(cLines[start + j]) !== nLines[j]) { ok = false; break; }`,
    `        }`,
    `        if (ok) {`,
    `            let offset = 0;`,
    `            for (let k = 0; k < start; k++) offset += cLines[k].length + 1;`,
    `            return offset;`,
    `        }`,
    `    }`,
    `    return -1;`,
    `}`,
    ``,
    `// P2d: Block-anchor matching — uses first/last non-empty lines as anchors`,
    `function _cxBlockAnchorIndexOf(content, needle) {`,
    `    const nLines = needle.split("\\n").filter(l => l.trim().length > 0);`,
    `    if (nLines.length < 3) return -1;`,
    `    const firstA = nLines[0].trim();`,
    `    const lastA = nLines[nLines.length - 1].trim();`,
    `    if (firstA.length < 8 || lastA.length < 8) return -1;`,
    `    const cLines = content.split("\\n");`,
    `    for (let i = 0; i < cLines.length; i++) {`,
    `        if (cLines[i].trim() !== firstA) continue;`,
    `        const end = i + nLines.length - 1;`,
    `        if (end >= cLines.length) continue;`,
    `        if (cLines[end].trim() !== lastA) continue;`,
    `        let offset = 0;`,
    `        for (let k = 0; k < i; k++) offset += cLines[k].length + 1;`,
    `        return offset;`,
    `    }`,
    `    return -1;`,
    `}`,
    ``,
    `// P2e: Levenshtein distance + sliding-window fuzzy match (line-level)`,
    `function _cxLevDist(a, b) {`,
    `    if (a === b) return 0;`,
    `    const aL = a.length, bL = b.length;`,
    `    if (aL === 0) return bL;`,
    `    if (bL === 0) return aL;`,
    `    let prev = new Array(bL + 1), curr = new Array(bL + 1);`,
    `    for (let j = 0; j <= bL; j++) prev[j] = j;`,
    `    for (let i = 1; i <= aL; i++) {`,
    `        curr[0] = i;`,
    `        const ac = a.charCodeAt(i - 1);`,
    `        for (let j = 1; j <= bL; j++) {`,
    `            curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (ac === b.charCodeAt(j - 1) ? 0 : 1));`,
    `        }`,
    `        const tmp = prev; prev = curr; curr = tmp;`,
    `    }`,
    `    return prev[bL];`,
    `}`,
    `function _cxLevFuzzyMatch(content, oldText, threshold) {`,
    `    const cLines = content.split("\\n");`,
    `    const oLines = oldText.split("\\n");`,
    `    if (oLines.length < 3 || oLines.length > cLines.length) return null;`,
    `    const norm = s => s.trim().replace(/[\\u2018\\u2019\\u201A\\u201B]/g, "'").replace(/[\\u201C-\\u201F]/g, '"').replace(/[\\u2010-\\u2015\\u2212]/g, "-");`,
    `    const nOld = oLines.map(norm);`,
    `    let best = -1, bestScore = 0, secondBest = 0, aboveCount = 0;`,
    `    for (let start = 0; start <= cLines.length - oLines.length; start++) {`,
    `        let score = 0;`,
    `        for (let j = 0; j < oLines.length; j++) {`,
    `            const a = nOld[j], b = norm(cLines[start + j]);`,
    `            const mx = Math.max(a.length, b.length);`,
    `            score += mx === 0 ? 1 : 1 - _cxLevDist(a, b) / mx;`,
    `        }`,
    `        score /= oLines.length;`,
    `        if (score >= threshold) aboveCount++;`,
    `        if (score > bestScore) { secondBest = bestScore; bestScore = score; best = start; }`,
    `        else if (score > secondBest) secondBest = score;`,
    `    }`,
    `    if (best === -1 || bestScore < threshold) return null;`,
    `    const dominant = aboveCount > 1 && bestScore >= 0.97 && (bestScore - secondBest) >= 0.08;`,
    `    if (aboveCount > 1 && !dominant) return null;`,
    `    let offset = 0;`,
    `    for (let k = 0; k < best; k++) offset += cLines[k].length + 1;`,
    `    let matchLen = 0;`,
    `    for (let k = best; k < best + oLines.length; k++) matchLen += cLines[k].length + (k < best + oLines.length - 1 ? 1 : 0);`,
    `    return { offset, matchLen, score: bestScore, dominant };`,
    `}`,
    ``,
    `// P2f: Enhanced nearest-match finder with similarity % and line-level diff`,
    `function findNearestMatchLine(content, oldText) {`,
    `    if (!oldText || oldText.length === 0) return null;`,
    `    const oldLines = oldText.split("\\n");`,
    `    const nonEmptyOld = oldLines.filter(l => l.trim().length > 0);`,
    `    if (nonEmptyOld.length === 0) return null;`,
    `    const contentLines = content.split("\\n");`,
    `    const norm = s => s.trim().replace(/[\\u2018\\u2019\\u201A\\u201B]/g, "'").replace(/[\\u201C-\\u201F]/g, '"').replace(/[\\u2010-\\u2015\\u2212]/g, "-").replace(/\\s+/g, " ");`,
    `    const nOld = nonEmptyOld.map(norm);`,
    `    let bestLine = -1, bestScore = 0, bestActualStart = -1;`,
    `    for (let start = 0; start <= contentLines.length - nOld.length; start++) {`,
    `        let score = 0;`,
    `        for (let j = 0; j < nOld.length; j++) {`,
    `            const a = nOld[j], b = norm(contentLines[start + j]);`,
    `            const mx = Math.max(a.length, b.length);`,
    `            score += mx === 0 ? 1 : 1 - _cxLevDist(a, b) / mx;`,
    `        }`,
    `        score /= nOld.length;`,
    `        if (score > bestScore) { bestScore = score; bestLine = start + 1; bestActualStart = start; }`,
    `    }`,
    `    if (bestLine === -1 || bestScore < 0.3) return null;`,
    `    const simPct = Math.round(bestScore * 100);`,
    `    let diffInfo = "";`,
    `    if (bestActualStart >= 0) {`,
    `        const maxL = Math.max(oldLines.length, nonEmptyOld.length);`,
    `        for (let i = 0; i < maxL; i++) {`,
    `            const oLine = (i < oldLines.length) ? oldLines[i] : "";`,
    `            const aLine = (bestActualStart + i < contentLines.length) ? contentLines[bestActualStart + i] : "";`,
    `            if (oLine !== aLine) {`,
    `                diffInfo = "\\n  - " + oLine + "\\n  + " + aLine;`,
    `                break;`,
    `            }`,
    `        }`,
    `    }`,
    `    const start = Math.max(0, bestLine - 3);`,
    `    const end = Math.min(contentLines.length, bestLine + nonEmptyOld.length + 2);`,
    `    const snippet = contentLines.slice(start, end).map((l, idx) => (start + idx + 1) + "| " + l).join("\\n");`,
    `    return { line: bestLine, snippet, similarity: simPct, diffInfo };`,
    `}`,
    ``,
  ].join('\n');

  const p2Search = `export function fuzzyFindText(content, oldText) {`;
  const p2Replace = HELPERS + '\nexport function fuzzyFindText(content, oldText) {';
  if (content.includes(p2Search)) {
    content = content.replace(p2Search, p2Replace);
    patchCount++;
  } else {
    echo`   ⚠️  Skipped P2 (helper injection): search anchor not found`;
  }

  // ── P3: Replace fuzzyFindText body with full matching chain ──
  const p3Search = `    // Try fuzzy match - work entirely in normalized space
    const fuzzyContent = normalizeForFuzzyMatch(content);
    const fuzzyOldText = normalizeForFuzzyMatch(oldText);
    const fuzzyIndex = fuzzyContent.indexOf(fuzzyOldText);
    if (fuzzyIndex === -1) {
        return {
            found: false,
            index: -1,
            matchLength: 0,
            usedFuzzyMatch: false,
            contentForReplacement: content,
        };
    }
    // When fuzzy matching, we work in the normalized space for replacement.
    // This means the output will have normalized whitespace/quotes/dashes,
    // which is acceptable since we're fixing minor formatting differences anyway.
    return {
        found: true,
        index: fuzzyIndex,
        matchLength: fuzzyOldText.length,
        usedFuzzyMatch: true,
        contentForReplacement: fuzzyContent,
    };
}`;
  const p3Replace = [
    `    // ClawX patch: Full matching chain (ported from oh-my-pi)`,
    `    // exact → line-trimmed → comment-prefix → block-anchor → normalized indexOf → Levenshtein`,
    ``,
    `    // Level 2: Line-trimmed match (trims both ends of each line)`,
    `    const _cxLtIdx = _cxLtIndexOf(content, oldText);`,
    `    if (_cxLtIdx !== -1) {`,
    `        return { found: true, index: _cxLtIdx, matchLength: oldText.length, usedFuzzyMatch: false, contentForReplacement: content };`,
    `    }`,
    ``,
    `    // Level 3: Comment-prefix match (strips //, #, *, etc.)`,
    `    const _cxCPIdx = _cxCommentPrefixIndexOf(content, oldText);`,
    `    if (_cxCPIdx !== -1) {`,
    `        return { found: true, index: _cxCPIdx, matchLength: oldText.length, usedFuzzyMatch: false, contentForReplacement: content };`,
    `    }`,
    ``,
    `    // Level 4: Block-anchor match (first/last lines as anchors)`,
    `    const _cxBAIdx = _cxBlockAnchorIndexOf(content, oldText);`,
    `    if (_cxBAIdx !== -1) {`,
    `        return { found: true, index: _cxBAIdx, matchLength: oldText.length, usedFuzzyMatch: false, contentForReplacement: content };`,
    `    }`,
    ``,
    `    // Level 5: Normalized fuzzy indexOf`,
    `    const _cxFuzzyContent = normalizeForFuzzyMatch(content);`,
    `    const _cxFuzzyOld = normalizeForFuzzyMatch(oldText);`,
    `    const _cxFuzzyIdx = _cxFuzzyContent.indexOf(_cxFuzzyOld);`,
    `    if (_cxFuzzyIdx !== -1) {`,
    `        return { found: true, index: _cxFuzzyIdx, matchLength: _cxFuzzyOld.length, usedFuzzyMatch: true, contentForReplacement: _cxFuzzyContent };`,
    `    }`,
    ``,
    `    // Level 6: Levenshtein line-level fuzzy match (only for >=3 line oldText)`,
    `    const _cxLevResult = _cxLevFuzzyMatch(content, oldText, 0.85);`,
    `    if (_cxLevResult) {`,
    `        return { found: true, index: _cxLevResult.offset, matchLength: _cxLevResult.matchLen, usedFuzzyMatch: false, contentForReplacement: content };`,
    `    }`,
    ``,
    `    // No match found`,
    `    return {`,
    `        found: false,`,
    `        index: -1,`,
    `        matchLength: 0,`,
    `        usedFuzzyMatch: false,`,
    `        contentForReplacement: content,`,
    `    };`,
    `}`,
  ].join('\n');
  if (content.includes(p3Search)) {
    content = content.replace(p3Search, p3Replace);
    patchCount++;
  } else {
    echo`   ⚠️  Skipped P3 (matching chain): search anchor not found`;
  }

  // ── P4: Replace getNotFoundError with enhanced version ──
  const p4Search = `function getNotFoundError(path, editIndex, totalEdits) {
    if (totalEdits === 1) {
        return new Error(\`Could not find the exact text in \${path}. The old text must match exactly including all whitespace and newlines.\`);
    }
    return new Error(\`Could not find edits[\${editIndex}] in \${path}. The oldText must match exactly including all whitespace and newlines.\`);
}`;
  const p4Replace = [
    `// ClawX patch: enhanced error with similarity % and line-level diff`,
    `function getNotFoundError(path, editIndex, totalEdits, content, oldText) {`,
    `    const base = totalEdits === 1`,
    `        ? \`Could not find the exact text in \${path}.\``,
    `        : \`Could not find edits[\${editIndex}] in \${path}.\`;`,
    `    const nearest = (content && oldText) ? findNearestMatchLine(content, oldText) : null;`,
    `    if (nearest) {`,
    `        const hint = nearest.diffInfo`,
    `            ? \`

Closest match (\${nearest.similarity}% similar) at line \${nearest.line}:\${nearest.diffInfo}

Provide more context or correct the differences above.\``,
    `            : \`\\n\\nNearest match found around line \${nearest.line}:\\n\${nearest.snippet}\`;`,
    `        return new Error(base + hint);`,
    `    }`,
    `    return new Error(base + \` The old text must match exactly including all whitespace and newlines.\`);`,
    `}`,
  ].join('\n');
  if (content.includes(p4Search)) {
    content = content.replace(p4Search, p4Replace);
    patchCount++;
  } else {
    echo`   ⚠️  Skipped P4 (error message): search anchor not found`;
  }

  // ── P5: Replace getDuplicateError with multi-match context ──
  const p5Search = `function getDuplicateError(path, editIndex, totalEdits, occurrences) {
    if (totalEdits === 1) {
        return new Error(\`Found \${occurrences} occurrences of the text in \${path}. The text must be unique. Please provide more context to make it unique.\`);
    }
    return new Error(\`Found \${occurrences} occurrences of edits[\${editIndex}] in \${path}. Each oldText must be unique. Please provide more context to make it unique.\`);
}`;
  const p5Replace = [
    `// ClawX patch: enhanced duplicate error with occurrence previews`,
    `function getDuplicateError(path, editIndex, totalEdits, occurrences, content, oldText) {`,
    `    const base = totalEdits === 1`,
    `        ? \`Found \${occurrences} occurrences of the text in \${path}.\``,
    `        : \`Found \${occurrences} occurrences of edits[\${editIndex}] in \${path}.\`;`,
    `    let previews = "";`,
    `    if (content && oldText) {`,
    `        const contentLines = content.split("\\n");`,
    `        const maxPreviews = Math.min(occurrences, 5);`,
    `        let searchFrom = 0;`,
    `        for (let i = 0; i < maxPreviews; i++) {`,
    `            const idx = content.indexOf(oldText, searchFrom);`,
    `            if (idx === -1) break;`,
    `            const lineNum = content.slice(0, idx).split("\\n").length;`,
    `            const start = Math.max(0, lineNum - 4);`,
    `            const end = Math.min(contentLines.length, lineNum + 3);`,
    `            const snip = contentLines.slice(start, end).map((l, j) => (start + j + 1) + "| " + l).join("\\n");`,
    `            previews += "\\n\\nOccurrence " + (i + 1) + " (line " + lineNum + "):\\n" + snip;`,
    `            searchFrom = idx + 1;`,
    `        }`,
    `    }`,
    `    return new Error(base + \` Add more context to disambiguate.\` + previews);`,
    `}`,
  ].join('\n');
  if (content.includes(p5Search)) {
    content = content.replace(p5Search, p5Replace);
    patchCount++;
  } else {
    echo`   ⚠️  Skipped P5 (duplicate error): search anchor not found`;
  }

  // ── P6: Update call site to pass content + oldText to getNotFoundError ──
  const p6Search = `            throw getNotFoundError(path, i, normalizedEdits.length);`;
  const p6Replace = `            throw getNotFoundError(path, i, normalizedEdits.length, normalizedContent, edit.oldText);`;
  if (content.includes(p6Search)) {
    content = content.replace(p6Search, p6Replace);
    patchCount++;
  } else {
    echo`   ⚠️  Skipped P6 (call site update): search anchor not found`;
  }

  // ── P6b: Update call site to pass content + oldText to getDuplicateError ──
  const p6bSearch = `            throw getDuplicateError(path, i, normalizedEdits.length, occurrences);`;
  const p6bReplace = `            throw getDuplicateError(path, i, normalizedEdits.length, occurrences, normalizedContent, edit.oldText);`;
  if (content.includes(p6bSearch)) {
    content = content.replace(p6bSearch, p6bReplace);
    patchCount++;
  } else {
    echo`   ⚠️  Skipped P6b (duplicate call site update): search anchor not found`;
  }

  // ── P7: Enhance countOccurrences for better duplicate detection ──
  const p7Search = `function countOccurrences(content, oldText) {
    const fuzzyContent = normalizeForFuzzyMatch(content);
    const fuzzyOldText = normalizeForFuzzyMatch(oldText);
    return fuzzyContent.split(fuzzyOldText).length - 1;
}`;
  const p7Replace = [
    `// ClawX patch: enhanced countOccurrences checks exact + line-trimmed + comment-prefix`,
    `function countOccurrences(content, oldText) {`,
    `    const exactCount = content.split(oldText).length - 1;`,
    `    if (exactCount > 1) return exactCount;`,
    `    const ltCount = (() => {`,
    `        const cLines = content.split("\\n");`,
    `        const nLines = oldText.split("\\n").map(l => l.trim());`,
    `        if (nLines.length === 0) return 0;`,
    `        let count = 0;`,
    `        for (let s = 0; s <= cLines.length - nLines.length; s++) {`,
    `            let ok = true;`,
    `            for (let j = 0; j < nLines.length; j++) {`,
    `                if (cLines[s + j].trim() !== nLines[j]) { ok = false; break; }`,
    `            }`,
    `            if (ok) count++;`,
    `        }`,
    `        return count;`,
    `    })();`,
    `    if (ltCount > 1) return ltCount;`,
    `    const fuzzyContent = normalizeForFuzzyMatch(content);`,
    `    const fuzzyOldText = normalizeForFuzzyMatch(oldText);`,
    `    return fuzzyContent.split(fuzzyOldText).length - 1;`,
    `}`,
  ].join('\n');
  if (content.includes(p7Search)) {
    content = content.replace(p7Search, p7Replace);
    patchCount++;
  } else {
    echo`   ⚠️  Skipped P7 (countOccurrences): search anchor not found`;
  }

  if (patchCount > 0) {
    fs.writeFileSync(target, content, 'utf8');
    echo`   🩹 Patched edit-diff.js with ${patchCount} improvement(s) (unicode, comment-prefix, levenshtein, error-messages, duplicate-previews)`;
  }
}

/**
 * PATCH B: openclaw-tools-*.js — smarter appendMismatchHint.
 */
function patchEditRecoveryWrapper(distDir) {
  const target = findFirstFileByName(distDir, /^openclaw-tools-.*\.js$/);
  if (!target || !fs.existsSync(target)) {
    echo`   ⚠️  Skipped openclaw-tools mismatch hint patch: target file not found`;
    return;
  }

  let content = fs.readFileSync(target, 'utf8');
  const search = `function appendMismatchHint(error, currentContent) {
\tconst snippet = currentContent.length <= EDIT_MISMATCH_HINT_LIMIT ? currentContent : \`\${currentContent.slice(0, EDIT_MISMATCH_HINT_LIMIT)}\\n... (truncated)\`;`;
  const replace = `function appendMismatchHint(error, currentContent) {
\t// ClawX patch: smarter truncation with line count hint
\tlet snippet;
\tif (currentContent.length <= EDIT_MISMATCH_HINT_LIMIT) {
\t\tsnippet = currentContent;
\t} else {
\t\tconst totalLines = currentContent.split("\\n").length;
\t\tsnippet = \`\${currentContent.slice(0, EDIT_MISMATCH_HINT_LIMIT)}\\n... (truncated, \${totalLines} total lines. Use read tool to inspect specific sections)\`;
\t}`;
  if (content.includes(search)) {
    content = content.replace(search, replace);
    fs.writeFileSync(target, content, 'utf8');
    echo`   🩹 Patched openclaw-tools appendMismatchHint with smarter context`;
  } else {
    echo`   ⚠️  Skipped openclaw-tools mismatch hint patch: search anchor not found`;
  }
}

/**
 * PATCH C: find.js — sort results to prioritize source directories.
 */
function patchFindTool(piToolsDir) {
  const target = path.join(piToolsDir, 'find.js');
  if (!fs.existsSync(target)) {
    echo`   ⚠️  Skipped find.js priority sort patch: target file not found`;
    return;
  }

  let content = fs.readFileSync(target, 'utf8');
  const search = `                            const resultLimitReached = relativized.length >= effectiveLimit;
                            const rawOutput = relativized.join("\\n");`;
  const replace = `                            // ClawX patch: sort results to prioritize source directories
                            const HIGH_PRIORITY_PREFIXES = ['src/', 'lib/', 'app/', 'components/', 'pages/', 'services/', 'utils/', 'hooks/', 'store/', 'stores/', 'electron/', 'shared/'];
                            const LOW_PRIORITY_PREFIXES = ['node_modules/', 'dist/', 'build/', '.git/', '.cache/', 'coverage/', '__pycache__/', '.next/', '.nuxt/'];
                            relativized.sort((a, b) => {
                                const aHigh = HIGH_PRIORITY_PREFIXES.some(p => a.startsWith(p));
                                const bHigh = HIGH_PRIORITY_PREFIXES.some(p => b.startsWith(p));
                                const aLow = LOW_PRIORITY_PREFIXES.some(p => a.startsWith(p));
                                const bLow = LOW_PRIORITY_PREFIXES.some(p => b.startsWith(p));
                                if (aHigh && !bHigh) return -1;
                                if (!aHigh && bHigh) return 1;
                                if (!aLow && bLow) return -1;
                                if (aLow && !bLow) return 1;
                                return a.localeCompare(b);
                            });
                            const resultLimitReached = relativized.length >= effectiveLimit;
                            const rawOutput = relativized.join("\\n");`;
  if (content.includes(search)) {
    content = content.replace(search, replace);
    fs.writeFileSync(target, content, 'utf8');
    echo`   🩹 Patched find.js with source-directory priority sorting`;
  } else {
    echo`   ⚠️  Skipped find.js priority sort patch: search anchor not found`;
  }
}

/**
 * PATCH D: grep.js — add default exclusions for noise directories.
 */
function patchGrepTool(piToolsDir) {
  const target = path.join(piToolsDir, 'grep.js');
  if (!fs.existsSync(target)) {
    echo`   ⚠️  Skipped grep.js smart defaults patch: target file not found`;
    return;
  }

  let content = fs.readFileSync(target, 'utf8');
  const search = `                        if (glob)
                            args.push("--glob", glob);
                        args.push("--", pattern, searchPath);`;
  const replace = `                        if (glob)
                            args.push("--glob", glob);
                        // ClawX patch: add default exclusions when no explicit glob/path is given
                        if (!glob && !searchDir) {
                            args.push("--glob", "!node_modules/**");
                            args.push("--glob", "!dist/**");
                            args.push("--glob", "!build/**");
                            args.push("--glob", "!coverage/**");
                            args.push("--glob", "!__pycache__/**");
                        }
                        args.push("--", pattern, searchPath);`;
  if (content.includes(search)) {
    content = content.replace(search, replace);
    fs.writeFileSync(target, content, 'utf8');
    echo`   🩹 Patched grep.js with smart default exclusions`;
  } else {
    echo`   ⚠️  Skipped grep.js smart defaults patch: search anchor not found`;
  }
}

function patchBundledRuntime(outputDir) {
  const replacePatches = [
    {
      label: 'workspace command runner',
      target: () => findFirstFileByName(path.join(outputDir, 'dist'), /^workspace-.*\.js$/),
      search: `\tconst child = spawn(resolvedCommand, finalArgv.slice(1), {
\t\tstdio,
\t\tcwd,
\t\tenv: resolvedEnv,
\t\twindowsVerbatimArguments,
\t\t...shouldSpawnWithShell({
\t\t\tresolvedCommand,
\t\t\tplatform: process$1.platform
\t\t}) ? { shell: true } : {}
\t});`,
      replace: `\tconst child = spawn(resolvedCommand, finalArgv.slice(1), {
\t\tstdio,
\t\tcwd,
\t\tenv: resolvedEnv,
\t\twindowsVerbatimArguments,
\t\twindowsHide: true,
\t\t...shouldSpawnWithShell({
\t\t\tresolvedCommand,
\t\t\tplatform: process$1.platform
\t\t}) ? { shell: true } : {}
\t});`,
    },
    // Note: OpenClaw 3.31 removed the hash-suffixed agent-scope-*.js, chrome-*.js,
    // and qmd-manager-*.js files from dist/plugin-sdk/. Patches for those spawn
    // sites are no longer needed — the runtime now uses windowsHide natively.
  ];

  let count = 0;
  for (const patch of replacePatches) {
    const target = patch.target();
    if (!target || !fs.existsSync(target)) {
      echo`   ⚠️  Skipped patch for ${patch.label}: target file not found`;
      continue;
    }

    const current = fs.readFileSync(target, 'utf8');
    if (!current.includes(patch.search)) {
      echo`   ⚠️  Skipped patch for ${patch.label}: expected source snippet not found`;
      continue;
    }

    const next = current.replace(patch.search, patch.replace);
    if (next !== current) {
      fs.writeFileSync(target, next, 'utf8');
      count++;
    }
  }

  if (count > 0) {
    echo`   🩹 Patched ${count} bundled runtime spawn site(s)`;
  }

  const ptyTargets = findFilesByName(
    path.join(outputDir, 'dist'),
    /^(subagent-registry|reply|pi-embedded)-.*\.js$/,
  );
  const ptyPatches = [
    {
      label: 'pty launcher windowsHide',
      search: `\tconst pty = spawn(params.shell, params.args, {
\t\tcwd: params.cwd,
\t\tenv: params.env ? toStringEnv(params.env) : void 0,
\t\tname: params.name ?? process.env.TERM ?? "xterm-256color",
\t\tcols: params.cols ?? 120,
\t\trows: params.rows ?? 30
\t});`,
      replace: `\tconst pty = spawn(params.shell, params.args, {
\t\tcwd: params.cwd,
\t\tenv: params.env ? toStringEnv(params.env) : void 0,
\t\tname: params.name ?? process.env.TERM ?? "xterm-256color",
\t\tcols: params.cols ?? 120,
\t\trows: params.rows ?? 30,
\t\twindowsHide: true
\t});`,
    },
    {
      label: 'disable pty on windows',
      search: `\t\t\tconst usePty = params.pty === true && !sandbox;`,
      replace: `\t\t\tconst usePty = params.pty === true && !sandbox && process.platform !== "win32";`,
    },
    {
      label: 'disable approval pty on windows',
      search: `\t\t\t\t\tpty: params.pty === true && !sandbox,`,
      replace: `\t\t\t\t\tpty: params.pty === true && !sandbox && process.platform !== "win32",`,
    },
  ];

  let ptyCount = 0;
  for (const patch of ptyPatches) {
    let matchedAny = false;
    for (const target of ptyTargets) {
      const current = fs.readFileSync(target, 'utf8');
      if (!current.includes(patch.search)) continue;
      matchedAny = true;
      const next = current.replaceAll(patch.search, patch.replace);
      if (next !== current) {
        fs.writeFileSync(target, next, 'utf8');
        ptyCount++;
      }
    }
    if (!matchedAny) {
      echo`   ⚠️  Skipped patch for ${patch.label}: expected source snippet not found`;
    }
  }

  if (ptyCount > 0) {
    echo`   🩹 Patched ${ptyCount} bundled PTY site(s)`;
  }

  // --- Browser tool hint patch ---
  // OpenClaw's BROWSER_TOOL_MODEL_HINT tells the model "Do NOT retry the
  // browser tool — it will keep failing" after ANY error, causing the model
  // to permanently refuse browser usage even on transient failures.
  // Replace with a gentler hint that allows retries on transient errors.
  const ORIGINAL_HINT =
    'Do NOT retry the browser tool \u2014 it will keep failing. Use an alternative approach or inform the user that the browser is currently unavailable.';
  const PATCHED_HINT =
    'If this was a transient error (timeout, network), you may retry once. If the same error persists after retry, try an alternative approach and let the user know.';
  const ORIGINAL_SHORT = 'Do NOT retry the browser tool.';
  const PATCHED_SHORT = 'You may retry once if this was a transient error.';

  const distDir = path.join(outputDir, 'dist');
  let hintCount = 0;
  if (fs.existsSync(distDir)) {
    for (const file of fs.readdirSync(distDir)) {
      if (!file.endsWith('.js')) continue;
      const filePath = path.join(distDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        if (!content.includes(ORIGINAL_HINT) && !content.includes(ORIGINAL_SHORT)) continue;
        const patched = content
          .replaceAll(ORIGINAL_HINT, PATCHED_HINT)
          .replaceAll(ORIGINAL_SHORT, PATCHED_SHORT);
        if (patched !== content) {
          fs.writeFileSync(filePath, patched, 'utf8');
          hintCount++;
        }
      } catch { /* skip on error */ }
    }
  }

  if (hintCount > 0) {
    echo`   🩹 Patched ${hintCount} browser tool hint(s) to allow transient error retry`;
  }

  // =========================================================================
  // ClawX file-tool patches — improve edit matching, error recovery, and
  // file locating for the bundled pi-coding-agent tools.
  // =========================================================================
  const piToolsDir = path.join(outputDir, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'core', 'tools');

  // --- PATCH A: edit-diff.js improvements (Tasks 1-3) ---
  patchEditDiffTool(piToolsDir);

  // --- PATCH B: openclaw-tools wrapper mismatch hint (Task 4) ---
  patchEditRecoveryWrapper(path.join(outputDir, 'dist'));

  // --- PATCH C: find.js result priority sorting (Task 5) ---
  patchFindTool(piToolsDir);

  // --- PATCH D: grep.js smart default exclusions (Task 6) ---
  patchGrepTool(piToolsDir);

}

patchBrokenModules(outputNodeModules);
patchBundledRuntime(OUTPUT);

const openclawSelfImportPatch = patchExtensionOpenClawSelfImports(OUTPUT);
if (openclawSelfImportPatch.specifiersPatched > 0) {
  echo`   🩹 Rewrote ${openclawSelfImportPatch.specifiersPatched} OpenClaw plugin-sdk self-import(s) in ${openclawSelfImportPatch.filesPatched} extension file(s)`;
}

// 8. Verify the bundle
const entryExists = fs.existsSync(path.join(OUTPUT, 'openclaw.mjs'));
const distExists = fs.existsSync(path.join(OUTPUT, 'dist', 'entry.js'));

echo``;
echo`✅ Bundle complete: ${OUTPUT}`;
echo`   Unique packages copied: ${copiedCount}`;
echo`   Dev-only packages skipped: ${skippedDevCount}`;
echo`   Duplicate versions skipped: ${skippedDupes}`;
echo`   Total discovered: ${collected.size}`;
echo`   openclaw.mjs: ${entryExists ? '✓' : '✗'}`;
echo`   dist/entry.js: ${distExists ? '✓' : '✗'}`;

if (!entryExists || !distExists) {
  echo`❌ Bundle verification failed!`;
  process.exit(1);
}

const missingRuntimePackages = ELECTRON_MAIN_RUNTIME_PACKAGES.filter((pkgName) => {
  const pkgJson = path.join(outputNodeModules, ...pkgName.split('/'), 'package.json');
  return !fs.existsSync(pkgJson);
});

if (missingRuntimePackages.length > 0) {
  echo`❌ Bundle verification failed: missing Electron main runtime packages:`;
  for (const pkgName of missingRuntimePackages) {
    echo`   - ${pkgName}`;
  }
  process.exit(1);
}
