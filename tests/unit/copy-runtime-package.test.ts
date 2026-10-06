// @vitest-environment node
import { createRequire } from 'node:module';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { copyRuntimeDependencies, copyRuntimeTree } from '../../scripts/copy-runtime-package.mjs';

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
