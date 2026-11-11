import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';

// Each emitted Main chunk resolves external packages from the complete copied
// graph before electron-builder's partial ASAR dependency collection.
export const packagedMainDependencyBanner = `'use strict';
if (process.type === 'browser' && require('electron').app.isPackaged && !globalThis[Symbol.for('verse.main.dependencies')]) {
  const path = require('node:path');
  const url = require('node:url');
  const loader = require('node:module');
  const archive = path.join(process.resourcesPath, 'main-runtime.asar');
  if (!require('node:fs').existsSync(path.join(archive, 'node_modules'))) throw new Error('Packaged main dependencies are missing');
  const appPrefix = url.pathToFileURL(require('electron').app.getAppPath()).href + '/';
  const parentURL = url.pathToFileURL(path.join(archive, 'entry.cjs')).href;
  const requireDependencies = loader.createRequire(parentURL);
  globalThis[Symbol.for('verse.main.dependencies')] = loader.registerHooks({
    resolve(specifier, context, nextResolve) {
      const bare = !specifier.startsWith('.') && !specifier.startsWith('#') && !path.isAbsolute(specifier) && !/^[a-zA-Z][a-zA-Z+.-]*:/.test(specifier);
      if (bare && context.parentURL?.startsWith(appPrefix) && specifier !== 'electron' && !specifier.startsWith('electron/') && !loader.isBuiltin(specifier)) {
        if (context.conditions.includes('require')) return { url: url.pathToFileURL(requireDependencies.resolve(specifier)).href, shortCircuit: true };
        return nextResolve(specifier, { ...context, parentURL });
      }
      return nextResolve(specifier, context);
    }
  });
}`;

function isInside(root, file) {
  const rel = relative(root, file);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep);
}

function installationRoots(root) {
  const roots = [root], modules = join(root, 'node_modules');
  if (existsSync(modules)) roots.push(realpathSync(modules));
  const metadata = join(modules, '.modules.yaml');
  if (existsSync(metadata)) {
    const store = parseYaml(readFileSync(metadata, 'utf8'))?.virtualStoreDir;
    if (typeof store === 'string' && existsSync(resolve(modules, store))) {
      roots.push(realpathSync(resolve(modules, store)));
    }
  }
  return roots;
}

// Node 24's native recursive copy can preserve nested Windows junctions despite
// dereference:true. A filter selects the JS traversal, which follows each link.
export function copyRuntimeTree(source, destination) {
  cpSync(source, destination, {
    recursive: true,
    dereference: true,
    filter: (file) => !relative(source, file).split(sep).includes('.bin'),
  });
}

function packageAt(importer, name) {
  const require = createRequire(join(importer, 'package.json'));
  try {
    return realpathSync(dirname(require.resolve(`${name}/package.json`)));
  } catch {
    // Some Node 24 + pnpm combinations return null resolve.paths() for optional
    // native packages; the explicit ancestor walk below is the fallback.
  }
  let cursor = realpathSync(importer);
  while (true) {
    const directory = join(cursor, 'node_modules', name);
    if (existsSync(join(directory, 'package.json'))) return realpathSync(directory);
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return null;
}

// Resolves the reachable dependency graph inside the supplied workspace. The
// same package name may legitimately appear at multiple versions, so identity
// is the resolved realpath rather than the bare package name.
export function collectRuntimeDependencyPackages(source, installationRoot = source) {
  installationRoot = realpathSync(installationRoot);
  // Admit the workspace's declared pnpm store, never unrelated parent packages.
  const ownedRoots = installationRoots(installationRoot);
  const hostName = JSON.parse(readFileSync(join(installationRoot, 'package.json'), 'utf8')).name;
  const collected = new Map();
  const queue = [{ importer: source, destination: source, packageName: null }];
  const visited = new Set();
  while (queue.length) {
    const current = queue.shift();
    const key = current.destination;
    if (visited.has(key)) continue;
    visited.add(key);
    if (current.packageName) {
      const existing = collected.get(current.destination);
      if (existing && existing.name !== current.packageName) {
        throw new Error(`Dependency identity collision: ${current.destination}`);
      }
      collected.set(current.destination, { name: current.packageName, source: current.importer, destination: current.destination });
    }
    const manifest = JSON.parse(readFileSync(join(current.importer, 'package.json'), 'utf8'));
    const dependencies = { ...manifest.peerDependencies, ...manifest.dependencies, ...manifest.optionalDependencies };
    for (const name of Object.keys(dependencies)) {
      if (name === hostName && name in (manifest.peerDependencies ?? {}) &&
          !(name in (manifest.dependencies ?? {})) && !(name in (manifest.optionalDependencies ?? {}))) continue;
      const resolved = packageAt(current.importer, name);
      const installed = resolved && ownedRoots.some(root => isInside(root, resolved)) ? resolved : null;
      if (!installed) {
        if (name in (manifest.optionalDependencies ?? {}) || manifest.peerDependenciesMeta?.[name]?.optional) continue;
        throw new Error(`Missing installed dependency ${name} of ${current.importer}`);
      }
      queue.push({
        importer: installed,
        destination: join(current.destination, 'node_modules', name),
        packageName: name,
      });
    }
  }
  return collected;
}

// Preserve each importer's installed version. Ancestors can satisfy matching
// versions; conflicts get normal nested node_modules, without development links.
export function copyRuntimeDependencies(source, destination, installationRoot = source) {
  installationRoot = realpathSync(installationRoot);
  const ownedRoots = installationRoots(installationRoot);
  const hostName = JSON.parse(readFileSync(join(installationRoot, 'package.json'), 'utf8')).name;
  const queue = [{ source, destination }];
  const visited = new Set();
  let copied = 0;
  while (queue.length) {
    const current = queue.shift();
    if (visited.has(current.destination)) continue;
    visited.add(current.destination);
    const manifest = JSON.parse(readFileSync(join(current.source, 'package.json'), 'utf8'));
    const dependencies = { ...manifest.peerDependencies, ...manifest.dependencies, ...manifest.optionalDependencies };
    for (const name of Object.keys(dependencies)) {
      if (name === hostName && name in (manifest.peerDependencies ?? {}) &&
          !(name in (manifest.dependencies ?? {})) && !(name in (manifest.optionalDependencies ?? {}))) continue;
      const resolved = packageAt(current.source, name);
      const installed = resolved && ownedRoots.some(root => isInside(root, resolved)) ? resolved : null;
      if (!installed) {
        if (name in (manifest.optionalDependencies ?? {}) || manifest.peerDependenciesMeta?.[name]?.optional) continue;
        throw new Error(`Missing installed dependency ${name} of ${current.source}`);
      }
      const expected = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
      const existing = packageAt(current.destination, name);
      // Never accept a parent outside the delivered tree (e.g. user node_modules).
      const inside = existing && isInside(destination, existing);
      if (inside && JSON.parse(readFileSync(join(existing, 'package.json'), 'utf8')).version === expected.version) continue;
      const target = join(current.destination, 'node_modules', name);
      mkdirSync(dirname(target), { recursive: true });
      // Private workspace packages ship only what their own manifest allows; every
      // package drops git-ignored .ae runtime evidence, which is never a package input.
      const shipped = Array.isArray(expected.files) && expected.private === true ? expected.files : null;
      cpSync(installed, target, {
        recursive: true,
        dereference: true,
        filter: (file) => {
          const rel = relative(installed, file);
          if (rel === '') return true;
          const parts = rel.split(sep);
          if (parts.includes('node_modules')) return false;
          if (parts[parts.length - 1] === '.ae') return false;
          if (!shipped) return true;
          if (rel === 'package.json') return true;
          const top = parts[0];
          return shipped.some((entry) => {
            const normalized = String(entry).replace(/^\.\//, '').replace(/\/$/, '');
            return normalized === top || normalized.startsWith(top + '/');
          });
        },
      });
      copied++;
      queue.push({ source: installed, destination: target });
    }
  }
  return copied;
}
