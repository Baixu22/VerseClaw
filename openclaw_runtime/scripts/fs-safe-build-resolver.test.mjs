import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fsSafeExports } from './lib/fs-safe-build-resolver.mjs';

const require = createRequire(import.meta.url);
const { rolldown } = require(require.resolve('rolldown', { paths: [require.resolve('tsdown')] }));
test('bundles the installed filesystem boundary through package exports', async () => {
  const unresolved = [];
  const bundle = await rolldown({
    input: 'src/infra/boundary-file-read.ts', platform: 'node',
    plugins: [fsSafeExports],
    external: id => id !== '@openclaw/fs-safe/advanced' && !id.startsWith('.') && !id.includes('boundary-file-read'),
    onLog(_level, log) { if (log.code === 'UNRESOLVED_IMPORT') unresolved.push(log.message); },
  });
  try {
    const { output } = await bundle.generate({ format: 'esm' });
    assert.deepEqual(unresolved, []);
    assert.ok(output.some(item => item.type === 'chunk' && item.code.includes('openRootFileSync')));
  } finally { await bundle.close(); }
  assert.equal(fsSafeExports.resolveId('node:fs'), null);
  assert.throws(() => fsSafeExports.resolveId('@openclaw/fs-safe/private-not-exported'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
});
