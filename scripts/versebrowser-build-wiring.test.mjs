import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('normal install, dev and build compile the embedded package before consuming dist', () => {
  assert.equal(scripts['versebrowser:build'], 'pnpm --filter @verse-claw/versebrowser build');
  assert.ok(scripts.postinstall.startsWith('node scripts/assert-pnpm-toolchain.mjs && pnpm run versebrowser:build && '));
  for (const entry of ['predev', 'predev:mock', 'prebuild:vite']) {
    assert.ok(scripts[entry].startsWith('pnpm run versebrowser:build && '), entry);
  }
});

test('credential-bearing runtime probes stay outside addable source paths', () => {
  const probe = readFileSync(new URL('./versebrowser-m08-runtime-verify.mjs', import.meta.url), 'utf8');
  const ignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.ok(probe.includes("mkdtempSync(join(tmpdir(), 'versebrowser-m08-runtime-'))"));
  assert.ok(ignore.split(/\r?\n/).includes('/.agent-workbench/m08-runtime-*/'));
});
