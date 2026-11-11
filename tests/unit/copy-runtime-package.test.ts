// @vitest-environment node
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { collectRuntimeDependencyPackages, copyRuntimeDependencies, copyRuntimeTree, packagedMainDependencyBanner } from '../../scripts/copy-runtime-package.mjs';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'runtime-copy-'));
  roots.push(root);
  return root;
}
function pkg(directory: string, name: string, version: string, dependencies = {}) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, version, dependencies, main: 'index.js' }));
  writeFileSync(join(directory, 'index.js'), `module.exports = '${version}';`);
}

it('materializes nested pnpm junctions rather than copying their development targets', () => {
  const root = fixture();
  const source = join(root, 'source');
  const dependency = join(root, 'store', 'typebox');
  pkg(dependency, 'typebox', '1.1.39');
  mkdirSync(join(source, 'packages', 'agent', 'node_modules'), { recursive: true });
  symlinkSync(dependency, join(source, 'packages', 'agent', 'node_modules', 'typebox'), 'junction');
  const output = join(root, 'output');
  copyRuntimeTree(source, output);
  rmSync(source, { recursive: true, force: true });
  rmSync(join(root, 'store'), { recursive: true, force: true });
  const copied = join(output, 'packages', 'agent', 'node_modules', 'typebox');
  expect(lstatSync(copied).isSymbolicLink()).toBe(false);
  expect(JSON.parse(readFileSync(join(copied, 'package.json'), 'utf8')).version).toBe('1.1.39');
});

it('collects a native package graph beside the plugin while preserving dependency versions', () => {
  const root = fixture();
  const source = join(root, 'source');
  pkg(source, '@openclaw/codex', '1', {
    '@openai/codex': '0.137.0',
    alpha: '1',
    beta: '1',
  });
  pkg(join(source, 'node_modules', '@openai', 'codex'), '@openai/codex', '0.137.0', {
    '@openai/codex-win32-x64': 'npm:@openai/codex@0.137.0-win32-x64',
  });
  pkg(join(source, 'node_modules', '@openai', 'codex-win32-x64'), '@openai/codex', '0.137.0-win32-x64');
  pkg(join(source, 'node_modules', 'alpha'), 'alpha', '1', { 'content-type': '1' });
  pkg(join(source, 'node_modules', 'alpha', 'node_modules', 'content-type'), 'content-type', '1');
  pkg(join(source, 'node_modules', 'beta'), 'beta', '1', { 'content-type': '2' });
  pkg(join(source, 'node_modules', 'beta', 'node_modules', 'content-type'), 'content-type', '2');
  const collected = collectRuntimeDependencyPackages(source, source);
  const destinations = [...collected.keys()].sort();
  expect(destinations).toEqual(expect.arrayContaining([
    join(source, 'node_modules', '@openai', 'codex'),
    join(source, 'node_modules', '@openai', 'codex', 'node_modules', '@openai', 'codex-win32-x64'),
    join(source, 'node_modules', 'alpha', 'node_modules', 'content-type'),
    join(source, 'node_modules', 'beta', 'node_modules', 'content-type'),
  ]));
  expect(collected.get(join(source, 'node_modules', '@openai', 'codex', 'node_modules', '@openai', 'codex-win32-x64'))?.name).toBe('@openai/codex-win32-x64');
  const output = join(root, 'output');
  pkg(output, '@openclaw/codex', '1');
  for (const { source: installedSource, destination } of collected.values()) {
    const target = join(output, destination.slice(source.length));
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'package.json'), readFileSync(join(installedSource, 'package.json'), 'utf8'));
  }
  expect(createRequire(join(output, 'node_modules', 'alpha', 'package.json'))('content-type/package.json').version).toBe('1');
  expect(createRequire(join(output, 'node_modules', 'beta', 'package.json'))('content-type/package.json').version).toBe('2');
});

it('ships transitive dependency conflicts and never relies on parent node_modules', () => {
  const root = fixture();
  const source = join(root, 'source');
  pkg(source, 'mcp', '1', { sdk: '1', schema: '2' });
  pkg(join(source, 'node_modules', 'sdk'), 'sdk', '1', { schema: '1' });
  pkg(join(source, 'node_modules', 'sdk', 'node_modules', 'schema'), 'schema', '1');
  pkg(join(source, 'node_modules', 'schema'), 'schema', '2');
  pkg(join(root, 'node_modules', 'sdk'), 'sdk', '1');
  const output = join(root, 'output');
  pkg(output, 'mcp', '1', { sdk: '1', schema: '2' });
  expect(copyRuntimeDependencies(source, output)).toBe(3);
  rmSync(source, { recursive: true, force: true });
  rmSync(join(root, 'node_modules'), { recursive: true, force: true });
  expect(createRequire(join(output, 'index.js'))('schema')).toBe('2');
  expect(createRequire(join(output, 'node_modules', 'sdk', 'index.js'))('schema')).toBe('1');
});

it('ships only a private workspace package allowlist and drops .ae runtime evidence', () => {
  const root = fixture();
  const source = join(root, 'source');
  const module = join(source, 'node_modules', '@verse-claw', 'versebrowser');
  mkdirSync(join(module, 'dist'), { recursive: true });
  mkdirSync(join(module, 'tests'), { recursive: true });
  mkdirSync(join(module, '.ae', 'evidence'), { recursive: true });
  writeFileSync(join(module, 'package.json'), JSON.stringify({ name: '@verse-claw/versebrowser', version: '1', private: true, files: ['dist', 'LICENSE'], main: 'dist/index.js' }));
  writeFileSync(join(module, 'dist', 'index.js'), "module.exports = 'ok';");
  writeFileSync(join(module, 'tests', 'dev.test.ts'), 'x');
  writeFileSync(join(module, '.ae', 'evidence', 'console.log'), 'x');
  pkg(source, 'mcp', '1', { '@verse-claw/versebrowser': '1' });
  const output = join(root, 'output');
  pkg(output, 'mcp', '1');
  copyRuntimeDependencies(source, output);
  const copied = join(output, 'node_modules', '@verse-claw', 'versebrowser');
  expect(JSON.parse(readFileSync(join(copied, 'package.json'), 'utf8')).version).toBe('1');
  expect(readFileSync(join(copied, 'dist', 'index.js'), 'utf8')).toContain('ok');
  expect(() => readFileSync(join(copied, 'tests', 'dev.test.ts'), 'utf8')).toThrow();
  expect(() => readFileSync(join(copied, '.ae', 'evidence', 'console.log'), 'utf8')).toThrow();
});

it('rejects missing installed dependencies even when a user-level copy is available', () => {
  const root = fixture();
  const source = join(root, 'source');
  pkg(source, 'mcp', '1', { sdk: '1' });
  pkg(join(root, 'node_modules', 'sdk'), 'sdk', '1');
  const output = join(root, 'output');
  pkg(output, 'mcp', '1');
  expect(() => copyRuntimeDependencies(source, output)).toThrow('Missing installed dependency sdk');
});

it('ships owner dependencies from its managed node_modules junction without copying the host peer', () => {
  const root = fixture(), installation = join(root, 'runtime'), source = join(installation, 'extensions', 'wiki');
  const store = join(root, 'installed-store', 'node_modules'), output = join(root, 'output');
  pkg(installation, 'openclaw', '1');
  pkg(source, '@openclaw/wiki', '1', { vector: '1' });
  writeFileSync(join(source, 'package.json'), JSON.stringify({
    name: '@openclaw/wiki', version: '1', dependencies: { vector: '1' },
    peerDependencies: { openclaw: '1' }, peerDependenciesMeta: { openclaw: { optional: true } },
  }));
  pkg(join(store, 'vector'), 'vector', '1', { native: '1' });
  pkg(join(store, 'native'), 'native', '1');
  pkg(join(store, 'openclaw'), 'openclaw', '1', { 'host-only': '1' });
  symlinkSync(store, join(installation, 'node_modules'), 'junction');
  const packages = collectRuntimeDependencyPackages(source, installation);
  expect([...packages.values()].map(row => row.name).sort()).toEqual(['native', 'vector']);
  pkg(output, '@openclaw/wiki', '1');
  expect(copyRuntimeDependencies(source, output, installation)).toBe(2);
  rmSync(installation, { recursive: true, force: true });
  rmSync(store, { recursive: true, force: true });
  expect(createRequire(join(output, 'index.js'))('vector')).toBe('1');
  expect(createRequire(join(output, 'node_modules', 'vector', 'index.js'))('native')).toBe('1');
});

it('loads Main dependencies and their children from the complete packaged graph', () => {
  const root = fixture();
  const main = join(root, 'app.asar', 'dist-electron', 'main', 'index.js');
  const complete = join(root, 'main-runtime.asar', 'node_modules');
  pkg(join(root, 'app.asar', 'node_modules', 'updater'), 'updater', 'broken');
  pkg(join(complete, 'updater'), 'updater', '1', { ms: '2' });
  writeFileSync(join(complete, 'updater', 'index.js'), "module.exports = require('ms');");
  pkg(join(complete, 'updater', 'node_modules', 'ms'), 'ms', '2');
  mkdirSync(join(root, 'app.asar', 'dist-electron', 'main'), { recursive: true });
  writeFileSync(main, packagedMainDependencyBanner + "\nmodule.exports = async () => [require('updater'), (await import('updater')).default, require('node:module').createRequire(__filename)('updater')];");
  const harness = `const Module = require('node:module'); const original = Module._load;
    Module._load = function(name, ...args) { return name === 'electron' ? { app: { isPackaged: true, getAppPath: () => process.argv[1] } } : original.call(this, name, ...args); };
    process.type = 'browser'; process.resourcesPath = process.argv[2];
    require(process.argv[3])().then(result => console.log(JSON.stringify(result)));`;
  const output = execFileSync(process.execPath, ['-e', harness, join(root, 'app.asar'), root, main], { encoding: 'utf8', windowsHide: true });
  expect(JSON.parse(output)).toEqual(['2', '2', '2']);
});
