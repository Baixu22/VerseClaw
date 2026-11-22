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
const normalizeEnd = nativeSource.indexOf('\nfunction resolveNativePackageRoots(', normalizeStart);
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
const packageRootEnd = nativeSource.indexOf('\nfunction resolveAllowedParentRoots(', normalizeEnd);
assert(packageRootEnd > normalizeEnd, 'Native package-root implementation boundary is missing');
const packageRootScript = new vm.Script(
  stripTypeScriptTypes(nativeSource.slice(normalizeStart, packageRootEnd)),
  { filename: nativeSourcePath }
);

function packageRootFixture(files, modulePath, realpath = path.resolve) {
  const probes = [];
  const reads = [];
  const normalized = [];
  const context = vm.createContext({
    path,
    fs: {
      existsSync(file) {
        probes.push(file);
        return files.has(file);
      },
      readFileSync(file) {
        reads.push(file);
        const contents = files.get(file);
        if (contents === null) throw new Error('Unreadable package manifest');
        return contents;
      },
      realpathSync(file) {
        normalized.push(file);
        return realpath(file);
      },
    },
  });
  packageRootScript.runInContext(context);
  return {
    context,
    probes,
    reads,
    normalized,
    resolve: () => context.resolveNativePackageRoots(modulePath).packageRoot,
  };
}

const rootScanModule = path.resolve(
  'native-package-root-fixture',
  ...Array.from({ length: 14 }, (_, i) => `level-${i}`),
  'entry.js'
);
const rootScanDirectories = [path.dirname(rootScanModule)];
for (let i = 0; i < 12; i += 1) {
  rootScanDirectories.push(path.dirname(rootScanDirectories.at(-1)));
}
const packagePath = (directory) => path.join(directory, 'package.json');
const rootScanPaths = rootScanDirectories.slice(0, 12).map(packagePath);
for (const [name, manifests, expectedDepth, scanned] of [
  [
    'named OpenClaw ancestor',
    [
      [0, '{}'],
      [2, '{"name":"openclaw"}'],
    ],
    2,
    3,
  ],
  [
    'OpenClaw executable ancestor',
    [
      [0, '{}'],
      [2, '{"bin":{"openclaw":"cli.js"}}'],
    ],
    2,
    3,
  ],
  [
    'ordinary nearest package and invalid executable',
    [
      [0, '{}'],
      [2, '{"bin":{"openclaw":1}}'],
    ],
    0,
    12,
  ],
  [
    'nearest ancestor ordinary package',
    [
      [2, '{}'],
      [5, '{}'],
    ],
    2,
    12,
  ],
  [
    'malformed nearest manifest',
    [
      [0, '{'],
      [2, '{}'],
    ],
    0,
    12,
  ],
  [
    'unreadable nearest manifest',
    [
      [0, null],
      [2, '{}'],
    ],
    0,
    12,
  ],
  ['no package manifests', [], 0, 12],
  [
    'OpenClaw ancestor beyond the search limit',
    [
      [0, '{}'],
      [12, '{"name":"openclaw"}'],
    ],
    0,
    12,
  ],
]) {
  test(`native package-root scan retains ${name} without repeated probes`, () => {
    const files = new Map(
      manifests.map(([depth, contents]) => [packagePath(rootScanDirectories[depth]), contents])
    );
    const fixture = packageRootFixture(files, rootScanModule);
    assert.equal(fixture.resolve(), rootScanDirectories[expectedDepth]);
    assert.deepEqual(fixture.probes, rootScanPaths.slice(0, scanned));
    assert.deepEqual(
      fixture.reads,
      fixture.probes.filter((file) => files.has(file))
    );
  });
}

test('native package roots read new manifest facts on the following call', () => {
  const files = new Map([[rootScanPaths[0], '{}']]);
  const fixture = packageRootFixture(files, rootScanModule);
  assert.equal(fixture.resolve(), rootScanDirectories[0]);
  files.set(rootScanPaths[2], '{"name":"openclaw"}');
  assert.equal(fixture.resolve(), rootScanDirectories[2]);
  assert.deepEqual(fixture.probes, [...rootScanPaths, ...rootScanPaths.slice(0, 3)]);
});

test('native parent scopes retain bundled plugin roots and external package boundaries', () => {
  const root = path.resolve('native-package-owner-fixture');
  for (const parent of [
    'extensions',
    'dist/extensions',
    'dist-runtime/extensions',
    'node_modules',
  ]) {
    const pluginRoot = path.join(root, parent, 'example');
    const modulePath = path.join(pluginRoot, 'src', 'entry.js');
    const fixture = packageRootFixture(
      new Map([
        [packagePath(root), '{"name":"openclaw"}'],
        [packagePath(pluginRoot), '{}'],
      ]),
      modulePath
    );
    assert.equal(fixture.context.resolveAllowedParentRoot(modulePath), pluginRoot);
  }
});

for (const [name, manifests, expectedDepth, scanned] of [
  ['no manifests', [], 0, 12],
  [
    'ordinary ancestor packages',
    [
      [2, '{}'],
      [5, '{}'],
    ],
    2,
    12,
  ],
  [
    'trusted ancestor outside bundled directories',
    [
      [2, '{}'],
      [5, '{"name":"openclaw"}'],
    ],
    2,
    6,
  ],
  [
    'malformed nearest manifest',
    [
      [2, '{'],
      [5, '{"bin":{"openclaw":"cli.js"}}'],
    ],
    2,
    6,
  ],
]) {
  test(`native parent scopes reuse one package scan with ${name}`, () => {
    const fixture = packageRootFixture(
      new Map(
        manifests.map(([depth, contents]) => [packagePath(rootScanDirectories[depth]), contents])
      ),
      rootScanModule
    );
    assert.equal(
      fixture.context.resolveAllowedParentRoot(rootScanModule),
      rootScanDirectories[expectedDepth]
    );
    assert.deepEqual(fixture.probes, rootScanPaths.slice(0, scanned));
  });
}

test('native parent scopes preserve normalization order and fresh symlink destinations', () => {
  const root = path.resolve('native-parent-scope-link-fixture');
  const realRoot = path.resolve('native-parent-scope-real-fixture');
  const pluginRoot = path.join(root, 'node_modules', 'example');
  const modulePath = path.join(pluginRoot, 'src', 'entry.js');
  let destination = path.join(realRoot, 'extensions', 'example', 'entry.js');
  const fixture = packageRootFixture(
    new Map([
      [packagePath(root), '{"name":"openclaw"}'],
      [packagePath(pluginRoot), '{}'],
    ]),
    modulePath,
    (file) => (file === modulePath ? destination : file === root ? realRoot : path.resolve(file))
  );
  assert.equal(
    fixture.context.resolveAllowedParentRoot(modulePath),
    path.join(realRoot, 'extensions', 'example')
  );
  destination = path.join(realRoot, 'outside', 'entry.js');
  assert.equal(fixture.context.resolveAllowedParentRoot(modulePath), pluginRoot);
  assert.deepEqual(fixture.normalized, [modulePath, root, modulePath, root]);
  const expectedProbes = [path.dirname(modulePath), pluginRoot, path.dirname(pluginRoot), root].map(
    packagePath
  );
  assert.deepEqual(fixture.probes, [...expectedProbes, ...expectedProbes]);
});

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
