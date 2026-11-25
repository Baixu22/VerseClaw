import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const source = fs.readFileSync(
  new URL('../openclaw_runtime/src/plugins/sdk-alias.ts', import.meta.url),
  'utf8'
);

const loaderSourcePath = fileURLToPath(
  new URL('../openclaw_runtime/src/plugins/plugin-module-loader-cache.ts', import.meta.url)
);
const loaderSource = fs.readFileSync(loaderSourcePath, 'utf8');
const importSource = fs.readFileSync(
  new URL('../openclaw_runtime/src/shared/import-specifier.ts', import.meta.url),
  'utf8'
);

function loaderSourceSlice(text, first, next) {
  const start = text.indexOf(first);
  const end = next ? text.indexOf(next, start) : text.length;
  assert(start >= 0 && end > start, `Loader implementation boundary is missing: ${first}`);
  return text.slice(start, end);
}

const loaderScript = new vm.Script(
  stripTypeScriptTypes(
    (
      loaderSourceSlice(
        source,
        'function createJitiAliasContentCacheKey(',
        '\nfunction isConcreteJitiAliasTarget('
      ) +
      loaderSourceSlice(
        source,
        'function supportsNativeModuleRuntime(',
        '\nexport function isBundledPluginExtensionPath('
      ) +
      loaderSourceSlice(importSource, 'export function toSafeImportPath(') +
      loaderSourceSlice(
        loaderSource,
        'function resolveDefaultPluginModuleLoaderConfig(',
        '\nfunction createLazySourceTransformLoader('
      ) +
      loaderSourceSlice(loaderSource, 'export function getCachedPluginModuleLoader(')
    ).replaceAll('export function ', 'function ')
  ),
  { filename: loaderSourcePath }
);
const loaderModulePath = path.resolve('plugin-loader-config-fixture', 'entry.js');
const loaderParams = {
  modulePath: loaderModulePath,
  importerUrl: pathToFileURL(loaderModulePath).href,
};

function loaderFixture({ versions = process.versions, rejectDefault = false } = {}) {
  const defaults = [];
  const builds = [];
  const installs = [];
  const created = [];
  const defaultAliases = { 'openclaw/plugin-sdk/example': path.resolve('default-sdk.js') };
  const context = vm.createContext({
    path,
    pathToFileURL,
    process: { platform: process.platform, argv: process.argv, versions },
    normalizeLowercaseStringOrEmpty: (value) => value.toLowerCase(),
    pluginLoaderModuleCacheKeyByAliasMap: new WeakMap(),
    pluginLoaderModuleConfigCache: new Map(),
    buildPluginLoaderModuleConfigCacheKey(params) {
      defaults.push(params);
      assert(!rejectDefault, 'Explicit aliases must not prepare the default SDK configuration');
      return JSON.stringify(params);
    },
    buildPluginLoaderAliasMap(...args) {
      builds.push(args);
      return defaultAliases;
    },
    installOpenClawInternalCorePackageNativeResolver: (options) => installs.push(options),
    createPluginModuleLoader(params) {
      created.push(params);
      return () => params;
    },
  });
  loaderScript.runInContext(context);
  return { context, defaults, builds, installs, created, defaultAliases };
}

test('complete loader overrides skip default SDK preparation, including empty aliases and false', () => {
  for (const aliasMap of [{}, { example: path.resolve('override.js') }]) {
    for (const tryNative of [false, true]) {
      const fixture = loaderFixture({ rejectDefault: true });
      fixture.context.resolvePluginLoaderTryNative = () =>
        assert.fail('Explicit mode must skip native policy resolution');
      const entry = fixture.context.resolvePluginModuleLoaderCacheEntry({
        ...loaderParams,
        aliasMap,
        tryNative,
      });
      assert.equal(entry.aliasMap, aliasMap);
      assert.equal(entry.tryNative, tryNative);
      assert.deepEqual(fixture.defaults, []);
      assert.deepEqual(fixture.builds, []);
    }
  }
});

test('alias-only overrides retain Node, Bun, built-dist and bundled source loading policy', () => {
  const aliasMap = { example: path.resolve('override.js') };
  for (const [relative, preferBuiltDist, versions, expected] of [
    ['entry.js', false, {}, true],
    ['entry.MJS', false, {}, true],
    ['entry.cjs', false, {}, true],
    ['entry.json', false, {}, true],
    ['entry.ts', false, {}, false],
    ['dist/entry.ts', true, {}, true],
    ['dist/extensions/example/entry.ts', true, {}, false],
    ['entry.js', true, { bun: '1.0.0' }, false],
  ]) {
    const fixture = loaderFixture({ versions, rejectDefault: true });
    const entry = fixture.context.resolvePluginModuleLoaderCacheEntry({
      ...loaderParams,
      modulePath: path.resolve('plugin-loader-config-fixture', relative),
      preferBuiltDist,
      aliasMap,
    });
    assert.equal(entry.aliasMap, aliasMap);
    assert.equal(entry.tryNative, expected, relative);
    assert.deepEqual(fixture.defaults, []);
    assert.deepEqual(fixture.builds, []);
  }
});

test('default loader configuration retains its cached aliases and resolution inputs', () => {
  const fixture = loaderFixture();
  const params = {
    ...loaderParams,
    argvEntry: 'entry-override',
    preferBuiltDist: true,
    devSourceRoot: 'source-override',
    pluginSdkResolution: 'dist',
  };
  const first = fixture.context.resolvePluginModuleLoaderCacheEntry(params);
  const second = fixture.context.resolvePluginModuleLoaderCacheEntry(params);
  assert.equal(first.aliasMap, fixture.defaultAliases);
  assert.equal(second.aliasMap, first.aliasMap);
  assert.equal(second.cacheKey, first.cacheKey);
  assert.equal(first.tryNative, true);
  assert.equal(fixture.defaults.length, 2);
  assert.equal(fixture.builds.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.defaults[0])), {
    modulePath: loaderModulePath,
    argv1: 'entry-override',
    moduleUrl: loaderParams.importerUrl,
    devSourceRoot: 'source-override',
    preferBuiltDist: true,
    pluginSdkResolution: 'dist',
  });
});

test('mode-only overrides retain default aliases and the effective content cache key', () => {
  for (const tryNative of [false, true]) {
    const fixture = loaderFixture();
    const entry = fixture.context.resolvePluginModuleLoaderCacheEntry({
      ...loaderParams,
      tryNative,
    });
    assert.equal(entry.aliasMap, fixture.defaultAliases);
    assert.equal(entry.tryNative, tryNative);
    assert.equal(
      entry.cacheKey,
      fixture.context.createPluginLoaderModuleCacheKey({
        aliasMap: fixture.defaultAliases,
        tryNative,
      })
    );
    assert.equal(fixture.defaults.length, 1);
    assert.equal(fixture.builds.length, 1);
  }
});

test('loader cache keys retain alias content, filename and explicit scope precedence', () => {
  const fixture = loaderFixture();
  const firstAliases = { b: '/b.js', a: '/a.js' };
  const secondAliases = { a: '/a.js', b: '/b.js' };
  const resolve = (params) =>
    fixture.context.resolvePluginModuleLoaderCacheEntry({
      ...loaderParams,
      tryNative: false,
      aliasMap: firstAliases,
      ...params,
    });
  const first = resolve({ cacheScopeKey: 'owner' });
  assert.equal(
    resolve({ cacheScopeKey: 'owner', aliasMap: secondAliases }).scopedCacheKey,
    first.scopedCacheKey
  );
  assert.notEqual(resolve({ cacheScopeKey: 'other' }).scopedCacheKey, first.scopedCacheKey);
  assert.notEqual(resolve({ tryNative: true }).cacheKey, first.cacheKey);
  assert.notEqual(resolve({ aliasMap: { a: '/changed.js', b: '/b.js' } }).cacheKey, first.cacheKey);
  assert.notEqual(
    resolve({ loaderFilename: path.resolve('another-loader.js') }).loaderFilename,
    first.loaderFilename
  );
  assert.equal(
    resolve({ cacheScopeKey: 'ignored', sharedCacheScopeKey: 'shared' }).scopedCacheKey,
    `${first.loaderFilename}::shared`
  );
  assert.equal(
    resolve({ cacheScopeKey: 'ignored', sharedCacheScopeKey: '' }).scopedCacheKey,
    `${first.loaderFilename}::`
  );
});

test('cached loaders retain source-mode identity and reinstall aliases on a cache hit', () => {
  const fixture = loaderFixture();
  const cache = new Map();
  const params = {
    ...loaderParams,
    cache,
    aliasMap: { example: '/override.js' },
    tryNative: false,
  };
  const first = fixture.context.getCachedPluginModuleLoader(params);
  assert.equal(fixture.context.getCachedPluginModuleLoader(params), first);
  assert.equal(fixture.context.getCachedPluginSourceModuleLoader(params), first);
  assert.equal(fixture.created.length, 1);
  assert.equal(fixture.installs.length, 3);
  cache.clear();
  assert.notEqual(fixture.context.getCachedPluginModuleLoader(params), first);
  assert.equal(fixture.created.length, 2);
  assert.equal(fixture.installs.length, 4);
});

test('loader SDK imports link real policy exports and detect missing bindings', async () => {
  const sdkImport = loaderSource.match(/import \{[^}]+\} from "\.\/sdk-alias\.js";/)?.[0];
  assert(sdkImport?.includes('resolvePluginLoaderTryNative,'), 'Native policy import is missing');
  const sdkProjection =
    'import path from "node:path";\n' +
    'const normalizeLowercaseStringOrEmpty = value => value.toLowerCase();\n' +
    'const pluginLoaderModuleCacheKeyByAliasMap = new WeakMap();\n' +
    'const pluginLoaderModuleConfigCache = new Map();\n' +
    loaderSourceSlice(
      source,
      'function createJitiAliasContentCacheKey(',
      '\nfunction isConcreteJitiAliasTarget('
    ) +
    loaderSourceSlice(
      source,
      'export function buildPluginLoaderJitiOptions(',
      '\nfunction supportsNativeModuleRuntime('
    ) +
    loaderSourceSlice(
      source,
      'function supportsNativeModuleRuntime(',
      '\nexport function isBundledPluginExtensionPath('
    );
  const entryProjection = loaderSourceSlice(
    loaderSource,
    'function resolveDefaultPluginModuleLoaderConfig(',
    '\nfunction createLazySourceTransformLoader('
  );
  const tempRoot = path.resolve(process.platform === 'win32' ? 'D:/tmp' : os.tmpdir());
  fs.mkdirSync(tempRoot, { recursive: true });
  const fixtureRoot = fs.mkdtempSync(path.join(tempRoot, 'g3-loader-wiring-'));
  try {
    for (const variant of ['linked', 'missing-export', 'missing-import']) {
      const folder = path.join(fixtureRoot, variant);
      fs.mkdirSync(folder);
      fs.writeFileSync(path.join(folder, 'package.json'), '{"type":"module"}');
      fs.writeFileSync(
        path.join(folder, 'sdk-alias.js'),
        stripTypeScriptTypes(
          variant === 'missing-export'
            ? sdkProjection.replace(
                'export function resolvePluginLoaderTryNative(',
                'function resolvePluginLoaderTryNative('
              )
            : sdkProjection
        )
      );
      const loaderPath = path.join(folder, 'loader.mjs');
      fs.writeFileSync(
        loaderPath,
        stripTypeScriptTypes(
          (variant === 'missing-import'
            ? sdkImport.replace('resolvePluginLoaderTryNative,', '')
            : sdkImport) +
            '\n' +
            importSource +
            '\n' +
            entryProjection
        )
      );
      const aliasMap = { example: '/override.js' };
      const resolve = async () => {
        const loaded = await import(pathToFileURL(loaderPath).href);
        return loaded.resolvePluginModuleLoaderCacheEntry({ ...loaderParams, aliasMap });
      };
      if (variant === 'linked') {
        const entry = await resolve();
        assert.equal(entry.aliasMap, aliasMap);
        assert.equal(entry.tryNative, true);
        const loaded = await import(pathToFileURL(loaderPath).href);
        assert.equal(
          loaded.resolvePluginModuleLoaderCacheEntry({
            ...loaderParams,
            aliasMap,
            tryNative: false,
          }).tryNative,
          false
        );
      } else {
        await assert.rejects(
          resolve,
          variant === 'missing-export'
            ? /does not provide an export named 'resolvePluginLoaderTryNative'/
            : /resolvePluginLoaderTryNative is not defined/
        );
      }
    }
  } finally {
    assert.equal(path.dirname(path.resolve(fixtureRoot)), tempRoot);
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
