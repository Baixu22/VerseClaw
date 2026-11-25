// @vitest-environment node
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { resolvePluginSdkScopedAliasMap } from '../../openclaw_runtime/src/plugins/sdk-alias';

const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'clawx-sdk-dependencies-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'dist/plugin-sdk'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/plugin-sdk'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'openclaw', type: 'module', bin: { openclaw: './openclaw.mjs' },
    exports: {
      './plugin-sdk': './dist/plugin-sdk/index.js',
      './plugin-sdk/one': './dist/plugin-sdk/one.js',
      './plugin-sdk/two': './dist/plugin-sdk/two.js',
    },
  }));
  fs.writeFileSync(path.join(root, 'dist/plugin-sdk/one.js'),
    'export { shared } from "../shared.js"; export { shared as again } from "../shared.js";');
  fs.writeFileSync(path.join(root, 'dist/plugin-sdk/two.js'),
    'export const shared = import("../shared.js");');
  fs.writeFileSync(path.join(root, 'src/plugin-sdk/one.ts'), 'export const shared = 1;');
  return root;
}
const aliases = (root: string) => resolvePluginSdkScopedAliasMap({
  modulePath: path.join(root, 'dist/extensions/fixture/index.js'),
  argv1: path.join(root, 'dist/entry.js'), devSourceRoot: null,
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir())) throw new Error('Unexpected fixture root');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it('checks a shared compiled dependency once while resolving both public SDK package names', () => {
  const root = fixture();
  const dependency = path.join(root, 'dist/shared.js');
  fs.writeFileSync(dependency, 'export const shared = 1;');
  const exists = vi.spyOn(fs, 'existsSync');
  const result = aliases(root);
  for (const name of ['openclaw/plugin-sdk', '@openclaw/plugin-sdk']) {
    expect(result[`${name}/one`]).toBe(path.join(root, 'dist/plugin-sdk/one.js'));
    expect(result[`${name}/two`]).toBe(path.join(root, 'dist/plugin-sdk/two.js'));
  }
  expect(exists.mock.calls.filter(([file]) => file === dependency)).toHaveLength(1);
});

it('falls back to source and omits an unavailable export when a compiled dependency is missing', () => {
  const root = fixture();
  const result = aliases(root);
  expect(result['openclaw/plugin-sdk/one']).toBe(path.join(root, 'src/plugin-sdk/one.ts'));
  expect(result['@openclaw/plugin-sdk/one']).toBe(path.join(root, 'src/plugin-sdk/one.ts'));
  expect(result['openclaw/plugin-sdk/two']).toBeUndefined();
  expect(result['@openclaw/plugin-sdk/two']).toBeUndefined();
});

it('falls back to source when a listed compiled barrel cannot be read', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'dist/shared.js'), 'export const shared = 1;');
  const unreadable = path.join(root, 'dist/plugin-sdk/one.js');
  const read = fs.readFileSync;
  vi.spyOn(fs, 'readFileSync').mockImplementation((file, options) => {
    if (file === unreadable) throw Object.assign(new Error('Fixture read denied'), { code: 'EACCES' });
    return read(file, options);
  });
  expect(aliases(root)['openclaw/plugin-sdk/one']).toBe(path.join(root, 'src/plugin-sdk/one.ts'));
});

it('keeps dependency availability separate for different SDK package roots', () => {
  const complete = fixture();
  const incomplete = fixture();
  fs.writeFileSync(path.join(complete, 'dist/shared.js'), 'export const shared = 1;');
  expect(aliases(complete)['openclaw/plugin-sdk/one']).toBe(path.join(complete, 'dist/plugin-sdk/one.js'));
  expect(aliases(incomplete)['openclaw/plugin-sdk/one']).toBe(path.join(incomplete, 'src/plugin-sdk/one.ts'));
});
