import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { consolidatedIconsModuleId, consolidatedIconsPlugin } from './lib/consolidated-icons.mjs';

const require = createRequire(import.meta.url);
test('preserves all icon exports and rendered SVG while consolidating the build entry', async t => {
  const plugin = consolidatedIconsPlugin();
  await plugin.buildStart();
  const code = plugin.load(consolidatedIconsModuleId);
  assert.equal(plugin.resolveId('lucide-react'), consolidatedIconsModuleId);
  assert.equal(plugin.resolveId('lucide-react/dynamic'), null);
  const manifest = require.resolve('lucide-react/package.json');
  const original = await import(pathToFileURL(resolve(dirname(manifest), JSON.parse(readFileSync(manifest, 'utf8')).module)));
  const dir = mkdtempSync(join(tmpdir(), 'consolidated-icons-'));
  const file = join(dir, 'icons.mjs');
  try {
    writeFileSync(file, code.replace(/from ["']react["']/g, `from ${JSON.stringify(pathToFileURL(require.resolve('react')).href)}`));
    const compiled = await import(pathToFileURL(file));
    assert.deepEqual(Object.keys(compiled).sort(), Object.keys(original).sort());
    assert.deepEqual(Object.keys(compiled.icons).sort(), Object.keys(original.icons).sort());
    const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
    let rendered = 0;
    for (const key of Object.keys(original)) {
      if (original[key]?.$$typeof !== Symbol.for('react.forward_ref')) continue;
      const props = { size: 18, strokeWidth: 1.5, 'aria-label': 'contract', className: 'fixture' };
      if (key === 'Icon') props.iconNode = [['path', { d: 'M1 1h2', key: 'fixture' }]];
      assert.equal(renderToStaticMarkup(React.createElement(compiled[key], props)), renderToStaticMarkup(React.createElement(original[key], props)), key);
      rendered++;
    }
    t.diagnostic(`${Object.keys(compiled).length} exports, ${rendered} rendered components matched`);
  } finally { unlinkSync(file); rmdirSync(dir); }
});
