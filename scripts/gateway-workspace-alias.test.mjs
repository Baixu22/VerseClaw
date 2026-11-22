import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sourcePath = fileURLToPath(
  new URL('../openclaw_runtime/src/plugins/sdk-alias.ts', import.meta.url)
);
const source = fs.readFileSync(sourcePath, 'utf8');
const start = source.indexOf('function normalizePackageExportSubpath(');
const end = source.indexOf('\nfunction isUsableDistPluginSdkArtifact(', start);
assert(start >= 0 && end > start, 'Workspace alias implementation boundary is missing');
// Exercise the production enumerator without importing the complete SDK loader graph.
const implementation = stripTypeScriptTypes(
  source.slice(start, end).replace('export function ', 'function ')
);
const script = new vm.Script(implementation, { filename: sourcePath });
const packageName = '@openclaw/acp-core';
const packageDir = 'acp-core';
const selectedRoot = path.resolve('selected-workspace-alias-fixture');
const fallbackRoot = path.resolve('fallback-workspace-alias-fixture');
const manifestPath = (root) => path.join(root, 'packages', packageDir, 'package.json');
const localPath = manifestPath(selectedRoot);
const fallbackPath = manifestPath(fallbackRoot);
const manifest = JSON.stringify({
  exports: {
    './z': { import: './dist/z.mjs' },
    '.': './dist/index.mjs',
    './a': { default: './dist/a.mjs' },
    './ignored': './dist/ignored.js',
    './../escape': './dist/escape.mjs',
  },
});

function fixture(
  files,
  { fallback = fallbackRoot, forbidFallback = false, packaged = false } = {}
) {
  const reads = [];
  let rootLookups = 0;
  const distRoot = path.join(selectedRoot, 'dist', packageDir);
  const context = vm.createContext({
    path,
    process: { cwd: () => selectedRoot },
    resolveOpenClawPackageRootSync() {
      rootLookups += 1;
      assert(!forbidFallback, 'Selected manifest must not query the fallback root');
      return fallback;
    },
    tryReadJsonSync(file) {
      reads.push(file);
      try {
        return JSON.parse(files.get(file));
      } catch {
        return null;
      }
    },
    fs: {
      existsSync: (file) => packaged && file === distRoot,
      readdirSync: () =>
        ['index.js', 'worker.js', 'ignore.txt'].map((name) => ({
          name,
          isDirectory: () => false,
          isFile: () => true,
        })),
    },
  });
  script.runInContext(context);
  const result = context.listWorkspacePackageExportAliasEntries({
    packageRoot: selectedRoot,
    packageName,
    packageDir,
  });
  return { entries: JSON.parse(JSON.stringify(result)), reads, rootLookups };
}

const expected = ['', 'a', 'z'].map((subpath) => ({
  packageName,
  packageDir,
  subpath,
  srcFile: `${subpath || 'index'}.ts`,
  distFile: `${subpath || 'index'}.mjs`,
}));

test('selected manifest supplies ordered aliases without resolving another root', () => {
  const result = fixture(
    new Map([
      [localPath, manifest],
      [fallbackPath, '{'],
    ])
  );
  assert.deepEqual(result.entries, expected);
  assert.deepEqual(result.reads, [localPath]);
  assert.equal(result.rootLookups, 0);
});

test('missing selected manifest retains fallback-root aliases', () => {
  const result = fixture(new Map([[fallbackPath, manifest]]));
  assert.deepEqual(result.entries, expected);
  assert.deepEqual(result.reads, [localPath, fallbackPath]);
  assert.equal(result.rootLookups, 1);
});

test('invalid selected manifest retains fallback-root aliases', () => {
  const result = fixture(
    new Map([
      [localPath, '{'],
      [fallbackPath, manifest],
    ])
  );
  assert.deepEqual(result.entries, expected);
  assert.deepEqual(result.reads, [localPath, fallbackPath]);
  assert.equal(result.rootLookups, 1);
});

test('selected manifest without exports keeps the selected packaged entries', () => {
  const result = fixture(
    new Map([
      [localPath, '{}'],
      [fallbackPath, manifest],
    ]),
    { packaged: true }
  );
  assert.deepEqual(
    result.entries.map((entry) => entry.subpath),
    ['', 'worker']
  );
  assert.deepEqual(result.reads, [localPath]);
  assert.equal(result.rootLookups, 0);
});

test('unavailable fallback root keeps packaged entry discovery', () => {
  const result = fixture(new Map(), { fallback: null, packaged: true });
  assert.deepEqual(
    result.entries.map((entry) => entry.subpath),
    ['', 'worker']
  );
  assert.deepEqual(result.reads, [localPath]);
  assert.equal(result.rootLookups, 1);
});

test('a valid selected manifest does not depend on fallback-root availability', () => {
  assert.deepEqual(
    fixture(new Map([[localPath, manifest]]), { forbidFallback: true }).entries,
    expected
  );
});

test('non-null JSON values retain packaged entries without consulting another root', () => {
  for (const value of ['false', '0', '""', '[]']) {
    const result = fixture(new Map([[localPath, value]]), { packaged: true });
    assert.deepEqual(
      result.entries.map((entry) => entry.subpath),
      ['', 'worker']
    );
    assert.equal(result.rootLookups, 0);
  }
});

const nativeSourcePath = fileURLToPath(
  new URL('../openclaw_runtime/src/plugins/plugin-sdk-native-resolver.ts', import.meta.url)
);
const nativeSource = fs.readFileSync(nativeSourcePath, 'utf8');
const normalizeStart = nativeSource.indexOf('function normalizePathForBoundary(');
const normalizeEnd = nativeSource.indexOf('\nfunction findNearestPackageRoot(', normalizeStart);
const nativeStart = nativeSource.indexOf('function isWithinRoot(');
const nativeEnd = nativeSource.indexOf('\nfunction listPluginSdkNativeAliases(', nativeStart);
assert(
  normalizeStart >= 0 &&
    normalizeEnd > normalizeStart &&
    nativeStart >= 0 &&
    nativeEnd > nativeStart,
  'Native alias implementation boundaries are missing'
);
const nativeScript = new vm.Script(
  stripTypeScriptTypes(
    nativeSource.slice(normalizeStart, normalizeEnd) + nativeSource.slice(nativeStart, nativeEnd)
  ),
  { filename: nativeSourcePath }
);
const nativeRequest = 'openclaw/plugin-sdk/example';
const allowedRoot = path.resolve('native-alias-allowed-fixture');
const blockedRoot = path.resolve('native-alias-blocked-fixture');
const nativeParent = path.join(allowedRoot, 'parent.js');
const linkedParent = path.resolve('native-alias-link-fixture', 'parent.js');
const allowedTarget = path.join(allowedRoot, 'sdk.js');

function nativeFixture({
  roots = [blockedRoot, allowedRoot],
  resolvedParent = nativeParent,
  failRealpath = false,
} = {}) {
  const probes = [];
  let currentParent = resolvedParent;
  const context = vm.createContext({
    path,
    fileURLToPath,
    pluginSdkNativeAliases: new Map([
      [
        nativeRequest,
        roots.map((parentRoot) => ({ parentRoot, target: path.join(parentRoot, 'sdk.js') })),
      ],
    ]),
    fs: {
      realpathSync(filename) {
        probes.push(filename);
        if (failRealpath) throw new Error('Missing parent path');
        return currentParent;
      },
    },
  });
  nativeScript.runInContext(context);
  return {
    context,
    probes,
    setParent: (filename) => {
      currentParent = filename;
    },
  };
}

test('CJS and ESM aliases normalize one parent path once across candidate roots', () => {
  for (const resolve of [
    (context) => context.resolveAliasTargetForParent(nativeRequest, { filename: linkedParent }),
    (context) =>
      context.resolveAliasTargetForParentUrl(nativeRequest, pathToFileURL(linkedParent).href),
  ]) {
    const fixture = nativeFixture();
    assert.equal(resolve(fixture.context), allowedTarget);
    assert.deepEqual(fixture.probes, [linkedParent]);
  }
});

test('a sibling path stays outside native alias roots with one normalization', () => {
  const fixture = nativeFixture({ resolvedParent: `${allowedRoot}-outside/parent.js` });
  assert.equal(
    fixture.context.resolveAliasTargetForParentPath(nativeRequest, linkedParent),
    undefined
  );
  assert.deepEqual(fixture.probes, [linkedParent]);
});

test('missing native parent paths retain lexical boundary resolution', () => {
  const fixture = nativeFixture({ failRealpath: true });
  assert.equal(
    fixture.context.resolveAliasTargetForParentPath(nativeRequest, nativeParent),
    allowedTarget
  );
  assert.deepEqual(fixture.probes, [nativeParent]);
});

test('native parent normalization stays fresh when a symlink target changes between calls', () => {
  const fixture = nativeFixture();
  assert.equal(
    fixture.context.resolveAliasTargetForParentPath(nativeRequest, linkedParent),
    allowedTarget
  );
  fixture.setParent(path.join(allowedRoot, '..', 'native-alias-outside-fixture', 'parent.js'));
  assert.equal(
    fixture.context.resolveAliasTargetForParentPath(nativeRequest, linkedParent),
    undefined
  );
  assert.deepEqual(fixture.probes, [linkedParent, linkedParent]);
});

test('native aliases retain the first matching registered root', () => {
  const innerRoot = path.join(allowedRoot, 'nested');
  const fixture = nativeFixture({
    roots: [allowedRoot, innerRoot],
    resolvedParent: path.join(innerRoot, 'parent.js'),
  });
  assert.equal(
    fixture.context.resolveAliasTargetForParentPath(nativeRequest, linkedParent),
    allowedTarget
  );
  assert.deepEqual(fixture.probes, [linkedParent]);
});

test('unknown aliases, absent parents and non-file URLs skip filesystem normalization', () => {
  const fixture = nativeFixture();
  assert.equal(
    fixture.context.resolveAliasTargetForParentPath('unknown-alias', linkedParent),
    undefined
  );
  assert.equal(fixture.context.resolveAliasTargetForParent(nativeRequest, undefined), undefined);
  assert.equal(
    fixture.context.resolveAliasTargetForParentUrl(nativeRequest, 'https://example.test/parent.js'),
    undefined
  );
  assert.deepEqual(fixture.probes, []);
});
