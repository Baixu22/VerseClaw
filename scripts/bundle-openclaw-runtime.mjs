#!/usr/bin/env zx

/**
 * bundle-openclaw-runtime.mjs
 *
 * Bundles the openclaw_runtime source workspace into a self-contained
 * build/openclaw-runtime/ directory for electron-builder to ship as an
 * extraResource (resources/openclaw-runtime/).
 *
 * Like bundle-openclaw.mjs: BFS through pnpm virtual store to collect all
 * transitive deps into a flat node_modules.  At runtime the Gateway
 * utilityProcess executes src/entry.ts via tsx (--import loader hook).
 */

import 'zx/globals';
import { ELECTRON_MAIN_RUNTIME_PACKAGES, isLocalRuntimeArtifact } from './openclaw-bundle-config.mjs';
import { copyRuntimeTree } from './copy-runtime-package.mjs';

const ROOT = path.resolve(__dirname, '..');
const RUNTIME_ROOT = path.join(ROOT, 'openclaw_runtime');
const OUTPUT = path.join(ROOT, 'build', 'openclaw-runtime');

// === Reused utility functions (copied from bundle-openclaw.mjs) ===

function normWin(p) {
  if (process.platform !== 'win32') return p;
  if (p.startsWith('\\\\?\\')) return p;
  return '\\\\?\\' + p.replace(/\//g, '\\');
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

function listPackages(nodeModulesDir) {
  const result = [];
  const nDir = normWin(nodeModulesDir);
  if (!fs.existsSync(nDir)) return result;

  for (const entry of fs.readdirSync(nDir)) {
    if (entry === '.bin') continue;
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

// === SKIP constants ===
const SKIP_PACKAGES = new Set([
  'openclaw',           // the workspace root itself; not a dep to copy
  'typescript',          // tsx handles transpilation, tsc not needed at runtime
  '@playwright/test',   // dev-only
  '@discordjs/opus',    // native addon, wrong ABI
]);

const SKIP_SCOPES = [
  '@cloudflare/',
  '@types/',
];

// tsx is in devDependencies of openclaw_runtime but REQUIRED at runtime.
// typescript may be needed by tsx for transpilation.
// ELECTRON_MAIN_RUNTIME_PACKAGES are required by the Electron main process.
const RUNTIME_EXTRA_PACKAGES = [
  'tsx',
  'typescript',
  // dist/sessions imports this bare runtime dependency; source pnpm linking
  // hides it during development, but the flattened packaged runtime needs it.
  'picomatch',
  // Agent tool startup imports the bundled Tree-sitter grammars by bare name.
  'tree-sitter',
  'tree-sitter-bash',
  'tree-sitter-go',
  'tree-sitter-java',
  'tree-sitter-python',
  'tree-sitter-rust',
  'tree-sitter-wasms',
  'web-tree-sitter',
  ...ELECTRON_MAIN_RUNTIME_PACKAGES,
];

echo`📦 Bundling openclaw_runtime for electron-builder...`;

// === 1. Validate entry ===
const runtimePkgPath = path.join(RUNTIME_ROOT, 'package.json');
if (!fs.existsSync(runtimePkgPath)) {
  echo`❌ openclaw_runtime/package.json not found at ${runtimePkgPath}`;
  process.exit(1);
}

const runtimePkg = readJsonSafe(runtimePkgPath);
if (!runtimePkg) {
  echo`❌ Failed to parse openclaw_runtime/package.json`;
  process.exit(1);
}

const RUNTIME_PKG_NAME = runtimePkg.name || 'openclaw';
echo`   Runtime package: ${RUNTIME_PKG_NAME}@${runtimePkg.version}`;

// === 2. Clean and create output ===
removeDirRobust(OUTPUT);
fs.mkdirSync(normWin(OUTPUT), { recursive: true });

// === 3. Copy runtime source files (exclude node_modules, .git, lock files) ===
echo`   Copying runtime source files...`;
for (const entry of fs.readdirSync(RUNTIME_ROOT, { withFileTypes: true })) {
  if (entry.name === 'node_modules' || entry.name === '.git' ||
      entry.name === 'pnpm-lock.yaml' ||
      entry.name === '.pnpm-workspace-state-v1.json' ||
      isLocalRuntimeArtifact(entry.name)) continue;
  const src = path.join(RUNTIME_ROOT, entry.name);
  const dest = path.join(OUTPUT, entry.name);
  copyRuntimeTree(normWin(src), normWin(dest));
}
echo`   Source files copied.`;

// === 4. BFS dependency collection from runtime's own pnpm virtual store ===
const runtimeNM = path.join(RUNTIME_ROOT, 'node_modules');
// Seed from this workspace's installed dependencies, not a similarly named
// published openclaw package that happens to live in its virtual store.
const collected = new Map(); // realPath -> packageName
const queue = [];
for (const name of listPackageDeps(runtimePkg)) {
  const fullPath = path.join(runtimeNM, name);
  if (!fs.existsSync(fullPath)) {
    if (name in (runtimePkg.optionalDependencies ?? {})) continue;
    throw new Error('Missing runtime dependency: ' + name);
  }
  const realPath = fs.realpathSync(fullPath);
  collected.set(realPath, name);
  const depVirtualNM = getVirtualStoreNodeModules(realPath);
  if (depVirtualNM) queue.push({ nodeModulesDir: depVirtualNM, skipPkg: name });
}

let skippedDevCount = 0;

while (queue.length > 0) {
  const { nodeModulesDir, skipPkg } = queue.shift();
  const packages = listPackages(nodeModulesDir);

  for (const { name, fullPath } of packages) {
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

    if (collected.has(realPath)) continue;
    collected.set(realPath, name);

    const depVirtualNM = getVirtualStoreNodeModules(realPath);
    if (depVirtualNM && depVirtualNM !== nodeModulesDir) {
      queue.push({ nodeModulesDir: depVirtualNM, skipPkg: name });
    }
  }
}

echo`   Found ${collected.size} total packages (direct + transitive)`;
echo`   Skipped ${skippedDevCount} dev-only package references`;

// === 4b. Collect extra packages (tsx, typescript, ELECTRON_MAIN_RUNTIME_PACKAGES) ===
let extraCount = 0;
for (const pkgName of RUNTIME_EXTRA_PACKAGES) {
  const pkgLink = path.join(runtimeNM, ...pkgName.split('/'));
  if (!fs.existsSync(pkgLink)) {
    echo`   ⚠️  Extra package ${pkgName} not found in runtime node_modules, skipping.`;
    continue;
  }

  let pkgReal;
  try { pkgReal = fs.realpathSync(pkgLink); } catch { continue; }

  if (!collected.has(pkgReal)) {
    collected.set(pkgReal, pkgName);
    extraCount++;

    // BFS this package's transitive deps
    const depVirtualNM = getVirtualStoreNodeModules(pkgReal);
    if (depVirtualNM) {
      const extraQueue = [{ nodeModulesDir: depVirtualNM, skipPkg: pkgName }];
      while (extraQueue.length > 0) {
        const { nodeModulesDir: nmDir, skipPkg: skip } = extraQueue.shift();
        const packages = listPackages(nmDir);
        for (const { name, fullPath } of packages) {
          if (name === skip) continue;
          if (SKIP_PACKAGES.has(name) || SKIP_SCOPES.some(s => name.startsWith(s))) continue;
          let realPath;
          try { realPath = fs.realpathSync(fullPath); } catch { continue; }
          if (collected.has(realPath)) continue;
          collected.set(realPath, name);
          extraCount++;
          const innerVirtualNM = getVirtualStoreNodeModules(realPath);
          if (innerVirtualNM && innerVirtualNM !== nmDir) {
            extraQueue.push({ nodeModulesDir: innerVirtualNM, skipPkg: name });
          }
        }
      }
    }
  }
}

if (extraCount > 0) {
  echo`   Added ${extraCount} extra packages (+ transitive deps) for source runtime`;
}

// === 5. Flatten collected packages into OUTPUT/node_modules/ ===
const outputNodeModules = path.join(OUTPUT, 'node_modules');
fs.mkdirSync(normWin(outputNodeModules), { recursive: true });

const copiedNames = new Set();
let copiedCount = 0;
let skippedDupes = 0;

// Sort: ELECTRON_MAIN_RUNTIME_PACKAGES first (they are critical for QR login)
const preferredPackages = new Set(ELECTRON_MAIN_RUNTIME_PACKAGES);
const collectedEntries = [...collected].sort((left, right) => {
  const leftPreferred = preferredPackages.has(left[1]);
  const rightPreferred = preferredPackages.has(right[1]);
  if (leftPreferred !== rightPreferred) return leftPreferred ? -1 : 1;
  return 0;
});

for (const [realPath, pkgName] of collectedEntries) {
  if (copiedNames.has(pkgName)) {
    skippedDupes++;
    continue; // First-version-wins
  }
  copiedNames.add(pkgName);

  const dest = path.join(outputNodeModules, pkgName);

  try {
    fs.mkdirSync(normWin(path.dirname(dest)), { recursive: true });
    copyRuntimeTree(normWin(realPath), normWin(dest));
    copiedCount++;
  } catch (err) {
    echo`   ⚠️  Skipped ${pkgName}: ${err.message}`;
  }
}

echo`   Copied ${copiedCount} packages (skipped ${skippedDupes} version duplicates)`;

// === 6. Cleanup bundle (same patterns as bundle-openclaw.mjs, minus extensions) ===
echo``;
echo`🧹 Cleaning up runtime bundle (removing dev artifacts, docs, source maps, type defs)...`;

function cleanupRuntimeBundle(outputDir) {
  let removedCount = 0;
  const nm = path.join(outputDir, 'node_modules');

  // --- openclaw-runtime root junk ---
  for (const name of ['CHANGELOG.md', 'README.md']) {
    if (rmSafe(path.join(outputDir, name))) removedCount++;
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

  return removedCount;
}

const sizeBefore = getDirSize(OUTPUT);
const cleanedCount = cleanupRuntimeBundle(OUTPUT);
const sizeAfter = getDirSize(OUTPUT);
echo`   Removed ${cleanedCount} files/directories`;
echo`   Size: ${formatSize(sizeBefore)} → ${formatSize(sizeAfter)} (saved ${formatSize(sizeBefore - sizeAfter)})`;

// === 7. Patch broken modules (node-domexception, https-proxy-agent, lru-cache) ===
echo``;
echo`🩹 Patching broken modules...`;

function patchBrokenModules(nodeModulesDir) {
  const rewritePatches = {
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

  let count = 0;
  for (const [rel, content] of Object.entries(rewritePatches)) {
    const target = path.join(nodeModulesDir, rel);
    if (fs.existsSync(target)) {
      fs.writeFileSync(target, content + '\n', 'utf8');
      count++;
    }
  }

  // lru-cache CJS/ESM interop fix (recursive)
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
          try { isDirectory = fs.statSync(normWin(fullPath)).isDirectory(); } catch { isDirectory = false; }
        }
        if (!isDirectory) continue;
        if (entry.name === 'lru-cache') {
          const pkgPath = path.join(fullPath, 'package.json');
          if (!fs.existsSync(normWin(pkgPath))) { stack.push(fullPath); continue; }
          try {
            const pkg = JSON.parse(fs.readFileSync(normWin(pkgPath), 'utf8'));
            if (pkg.type === 'module') continue;
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
            }

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

patchBrokenModules(outputNodeModules);

// === 8. Verify ELECTRON_MAIN_RUNTIME_PACKAGES exist ===
echo``;
echo`✅ Verifying ELECTRON_MAIN_RUNTIME_PACKAGES...`;
const missingRuntimePackages = ELECTRON_MAIN_RUNTIME_PACKAGES.filter((pkgName) => {
  const pkgJson = path.join(outputNodeModules, ...pkgName.split('/'), 'package.json');
  return !fs.existsSync(pkgJson);
});
if (missingRuntimePackages.length > 0) {
  echo`   ⚠️  Missing: ${missingRuntimePackages.join(', ')}`;
} else {
  echo`   All ${ELECTRON_MAIN_RUNTIME_PACKAGES.length} ELECTRON_MAIN_RUNTIME_PACKAGES present.`;
}

// === Summary ===
const totalSize = getDirSize(OUTPUT);
echo``;
echo`✅ Bundle complete: ${OUTPUT}`;
echo`   Total packages: ${collected.size}`;
echo`   Total size: ${formatSize(totalSize)}`;
echo`   Copied: ${copiedCount} unique packages`;
echo`   Skipped: ${skippedDupes} version duplicates, ${skippedDevCount} dev-only`;
echo`   Extra: ${extraCount} runtime-required packages`;
echo``;
