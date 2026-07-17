#!/usr/bin/env node
import { chmod, copyFile, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadVerifiedAssetToFile } from './lib/verified-download.mjs';
import { getReleaseAsset } from './release-integrity-manifest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(readArg('--output') || join(root, 'temp_ossutil_bin'));
const archive = join(output, 'ossutil-linux-amd64.zip');
const extracted = join(output, 'extract');
const destination = join(output, 'ossutil');
const policy = getReleaseAsset('ossutil', 'ossutil-linux-amd64.zip');

await rm(output, { recursive: true, force: true });
await mkdir(extracted, { recursive: true });

try {
  const verified = await downloadVerifiedAssetToFile(policy, archive);
  const unzip = spawnSync('unzip', ['-q', archive, '-d', extracted], { stdio: 'inherit' });
  if (unzip.status !== 0) throw new Error(`unzip failed with exit=${unzip.status ?? 1}`);
  await copyFile(join(extracted, 'ossutil-linux-amd64', 'ossutil'), destination);
  await chmod(destination, 0o755);
  const version = spawnSync(destination, ['--version'], { encoding: 'utf8' });
  const versionText = `${version.stdout || ''}\n${version.stderr || ''}`;
  if (version.status !== 0 || !versionText.includes(policy.version.replace(/^v/u, ''))) {
    throw new Error(`ossutil version mismatch: expected=${policy.version} actual=${versionText.trim()}`);
  }
  await rm(archive, { force: true });
  await rm(extracted, { recursive: true, force: true });
  console.log(
    `[ossutil-integrity] installed ${policy.version} sha256=${verified.sha256} path=${destination}`,
  );
} catch (error) {
  await rm(output, { recursive: true, force: true });
  throw error;
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
