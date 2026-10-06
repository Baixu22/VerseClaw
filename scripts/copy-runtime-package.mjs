import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

function isInside(root, file) {
  const rel = relative(root, file);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep);
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
  for (const base of require.resolve.paths(name) ?? []) {
    const directory = join(base, name);
    if (existsSync(join(directory, 'package.json'))) return realpathSync(directory);
  }
  return null;
}

// Preserve each importer's installed version. Ancestors can satisfy matching
// versions; conflicts get normal nested node_modules, without development links.
export function copyRuntimeDependencies(source, destination, installationRoot = source) {
  installationRoot = realpathSync(installationRoot);
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
      const resolved = packageAt(current.source, name);
      const installed = resolved && isInside(installationRoot, resolved) ? resolved : null;
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
      cpSync(installed, target, {
        recursive: true,
        dereference: true,
        filter: (file) => !relative(installed, file).split(sep).includes('node_modules'),
      });
      copied++;
      queue.push({ source: installed, destination: target });
    }
  }
  return copied;
}
