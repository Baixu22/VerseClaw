/** Apache-2.0 Playwright modification; provenance and retirement: docs/integration/upstream-log-patch.md. */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const originalHash = 'cd6730be1bbcff00771a0fc1390f200306d28428ce68e305420ca623cb39cdeb';
const edits = [
  ['role === "generic" && box.inline && element.childNodes.length === 1', 'role === "generic" && box.cursor !== "pointer" && box.inline && element.childNodes.length === 1'],
  ['      appendLine(wallTime, text2) {', '      appendLine(wallTime, text2) {\n        // VerseBrowser: redact and bound logs before the upstream write queue.\n        if (this._context.config.vbLogSink) { this._context.config.vbLogSink(wallTime, text2); return; }'],
  ['async function createConnection(userConfig = {}, contextGetter) {', 'createConnection.versebrowserLogSinkVersion = 1;\nasync function createConnection(userConfig = {}, contextGetter) {'],
  ['        await tab2.page.bringToFront();\n        await tab2.updateWebMCPTools();', '        if (!this.config.vbPreserveFocus) await tab2.page.bringToFront();\n        await tab2.updateWebMCPTools();'],
  ['createConnection.versebrowserLogSinkVersion = 1;', 'createConnection.versebrowserLogSinkVersion = 1;\ncreateConnection.versebrowserFocusVersion = 1;'],
  ['await modalState.fileChooser.setFiles(paths);', 'await modalState.fileChooser.setFiles(tab2.context.config.vbFilePayloads ? tab2.context.config.vbFilePayloads(paths) : paths);'],
  ['createConnection.versebrowserFocusVersion = 1;', 'createConnection.versebrowserFocusVersion = 1;\ncreateConnection.versebrowserFilesVersion = 1;'],
  ['  async _downloadStarted(download) {', '  async _downloadStarted(download) {\n    if (this.context.config.vbManualDownloads) return;'],
  ['createConnection.versebrowserFilesVersion = 1;', 'createConnection.versebrowserFilesVersion = 1;\ncreateConnection.versebrowserDownloadsVersion = 1;'],
];
const hash = value => createHash('sha256').update(value).digest('hex');

export function patchText(source) {
  let original = source;
  for (const [before, after] of [...edits].reverse()) original = original.replace(after, before);
  if (hash(original) !== originalHash) throw new Error('E_UPSTREAM_PATCH: unexpected bundle SHA-256; review a new upstream version explicitly');
  let patched = original;
  for (const [before, after] of edits) {
    if (patched.split(before).length !== 2) throw new Error('E_UPSTREAM_PATCH: patch anchor is not unique');
    patched = patched.replace(before, after);
  }
  const prior = original.replace(edits[1][0], edits[1][1]).replace(edits[2][0], edits[2][1]);
  const previous = edits.slice(0,3).reduce((text,[before,after])=>text.replace(before,after),original);
  const focused = edits.slice(0,5).reduce((text,[before,after])=>text.replace(before,after),original);
  const buffered = edits.slice(0,7).reduce((text,[before,after])=>text.replace(before,after),original);
  if (source !== original && source !== patched && source !== prior && source !== previous && source !== focused && source !== buffered) throw new Error('E_UPSTREAM_PATCH: partially modified bundle');
  return patched;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const require = createRequire(import.meta.url);
  for (const owner of ['@playwright/mcp', 'playwright']) {
  const upstream = createRequire(require.resolve(owner));
  const pkg = upstream('playwright-core/package.json');
  if (pkg.version !== '1.64.0-alpha-1790635538000') throw new Error('E_UPSTREAM_PATCH: unexpected playwright-core version');
  const path = upstream.resolve('playwright-core/lib/coreBundle');
  const source = readFileSync(path, 'utf8'), patched = patchText(source);
  if (process.argv.includes('--check')) {
    if (source !== patched) throw new Error('E_UPSTREAM_PATCH: run npm run patch:upstream');
  } else if (source !== patched) {
    const temp = `${path}.${randomUUID()}.vb-patch.tmp`;
    writeFileSync(temp, patched, { flag: 'wx' });
    renameSync(temp, path);
  }
  console.log(JSON.stringify({ patch: 'versebrowser-log-pointer-focus-files-downloads-v1', owner, upstream: pkg.version, sha256: hash(patched) }));
  }
}
