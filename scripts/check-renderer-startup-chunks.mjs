import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const INITIAL_JS_LIMIT = 2.5 * 1024 * 1024;
const CHAT_CORE_LIMIT = 4 * 1024 * 1024;
const SETTINGS_OVERVIEW_LIMIT = 250 * 1024;
const FORBIDDEN_STARTUP_ASSET = /(?:editor|document-viewers|math-rendering|artifactpanel)/i;

const distDir = resolve(process.argv[2] ?? 'dist');
const manifestPath = resolve(distDir, '.vite/manifest.json');

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function assetPathFromHref(href) {
  return href.replace(/^\.\//, '').replace(/^\//, '').split(/[?#]/, 1)[0];
}

async function fileSize(fileName) {
  return (await stat(resolve(distDir, fileName))).size;
}

function findManifestKey(manifest, source, chunkName) {
  if (manifest[source]) return source;
  return Object.keys(manifest).find((key) => (
    manifest[key]?.src === source || manifest[key]?.name === chunkName
  ));
}

function collectStaticFiles(manifest, entryKey) {
  const visited = new Set();
  const files = new Set();

  function visit(key) {
    if (!key || visited.has(key)) return;
    visited.add(key);
    const record = manifest[key];
    if (!record) return;
    if (record.file?.endsWith('.js')) files.add(record.file);
    for (const importedKey of record.imports ?? []) visit(importedKey);
  }

  visit(entryKey);
  return files;
}

async function sizeOfFiles(files) {
  let total = 0;
  for (const file of files) total += await fileSize(file);
  return total;
}

function difference(files, excluded) {
  return new Set([...files].filter((file) => !excluded.has(file)));
}

const failures = [];
const notes = [];
const html = await readFile(resolve(distDir, 'index.html'), 'utf8');
const referencedAssets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
  .map((match) => assetPathFromHref(match[1]));
const initialJs = new Set(referencedAssets.filter((asset) => asset.endsWith('.js')));
const initialJsBytes = await sizeOfFiles(initialJs);

if (initialJsBytes > INITIAL_JS_LIMIT) {
  failures.push(
    `Initial renderer JavaScript is ${formatBytes(initialJsBytes)} (limit ${formatBytes(INITIAL_JS_LIMIT)}).`,
  );
}

const forbiddenAssets = referencedAssets.filter((asset) => FORBIDDEN_STARTUP_ASSET.test(asset));
if (forbiddenAssets.length > 0) {
  failures.push(`Forbidden startup assets are referenced by dist/index.html: ${forbiddenAssets.join(', ')}`);
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const mainKey = findManifestKey(manifest, 'index.html', 'index');
const appKey = findManifestKey(manifest, 'src/App.tsx', 'App');
const chatKey = findManifestKey(manifest, 'src/pages/Chat/index.tsx', 'chat-core');
const settingsKey = findManifestKey(
  manifest,
  'src/pages/Settings/SettingsRoute.tsx',
  'settings-overview',
);

if (!mainKey || !appKey || !chatKey || !settingsKey) {
  failures.push('Renderer manifest is missing main, App, Chat core, or Settings overview chunks.');
} else {
  const mainFiles = collectStaticFiles(manifest, mainKey);
  const appFiles = collectStaticFiles(manifest, appKey);
  const loadedBeforeChat = new Set([...mainFiles, ...appFiles]);
  const chatFiles = difference(collectStaticFiles(manifest, chatKey), loadedBeforeChat);
  // SettingsRoute is deliberately an explicit chunk so its eager overview shell can be
  // budgeted independently from App and from the lazy settings-detail implementation.
  const settingsOverviewBytes = await fileSize(manifest[settingsKey].file);
  const chatCoreBytes = await sizeOfFiles(chatFiles);

  notes.push(`Initial HTML JavaScript: ${formatBytes(initialJsBytes)}`);
  notes.push(`Synchronous Settings overview increment: ${formatBytes(settingsOverviewBytes)}`);
  notes.push(`Chat core increment: ${formatBytes(chatCoreBytes)}`);

  if (settingsOverviewBytes > SETTINGS_OVERVIEW_LIMIT) {
    failures.push(
      `Synchronous Settings overview increment is ${formatBytes(settingsOverviewBytes)} (limit ${formatBytes(SETTINGS_OVERVIEW_LIMIT)}).`,
    );
  }
  if (chatCoreBytes > CHAT_CORE_LIMIT) {
    failures.push(`Chat core increment is ${formatBytes(chatCoreBytes)} (limit ${formatBytes(CHAT_CORE_LIMIT)}).`);
  }
}

for (const note of notes) console.log(note);

if (failures.length > 0) {
  for (const failure of failures) console.error(`ERROR: ${failure}`);
  process.exitCode = 1;
} else {
  console.log('Renderer startup chunk budgets passed.');
}
