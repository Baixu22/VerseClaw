#!/usr/bin/env -S node --import tsx
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import {
  WINDOWS_UPDATE_ORIGIN,
  assertTrustedWindowsUpdateFeedUrl,
  assertWindowsUpdateTlsVerificationEnabled,
  checkWindowsUpdateWorkflowConsistency,
  getWindowsUpdateFeedPolicy,
  validateWindowsUpdateInfo,
} from '../shared/release-policy/windows-update-feed-policy.ts';

const root = resolve(import.meta.dirname, '..');
const args = parseArgs(process.argv.slice(2));

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) result[key] = true;
    else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

function ok(message: string): void {
  console.log(`[windows-update-feed] OK: ${message}`);
}

function fail(message: string): never {
  console.error(`[windows-update-feed] FAIL: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const matrix = [
    ['1.0.0', 'stable', 'latest'],
    ['1.0.0-alpha.1', 'alpha', 'alpha'],
    ['1.0.0-beta.2', 'beta', 'beta'],
  ] as const;
  for (const [version, channel, directory] of matrix) {
    const policy = getWindowsUpdateFeedPolicy(version);
    if (
      policy.releaseChannel !== channel ||
      policy.channelDirectory !== directory ||
      policy.metadataChannel !== 'latest' ||
      policy.feedUrl !== `${WINDOWS_UPDATE_ORIGIN}/${directory}/`
    ) {
      fail(`policy mismatch for ${version}: ${JSON.stringify(policy)}`);
    }
    assertTrustedWindowsUpdateFeedUrl(policy.metadataUrl, policy);
    ok(`${version} -> ${policy.feedUrl}${policy.metadataFile}`);
  }

  let unknownRejected = false;
  try {
    getWindowsUpdateFeedPolicy('1.0.0-rc.1');
  } catch {
    unknownRejected = true;
  }
  if (!unknownRejected) fail('unknown prerelease channel must fail closed');
  ok('unknown prerelease channel rejected');

  const workflowText = readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8');
  const workflow = checkWindowsUpdateWorkflowConsistency(workflowText);
  if (!workflow.ok) fail(`workflow missing anchors: ${workflow.missing.join(', ')}`);
  ok('release workflow source/channel anchors match client policy');

  const requestedVersion = typeof args.version === 'string' ? args.version : undefined;
  if (requestedVersion) {
    const policy = getWindowsUpdateFeedPolicy(requestedVersion);
    console.log(JSON.stringify(policy, null, 2));
  }

  if (args['probe-live']) {
    assertWindowsUpdateTlsVerificationEnabled();
    const version = requestedVersion || '1.0.0';
    const policy = getWindowsUpdateFeedPolicy(version);
    const response = await fetch(policy.metadataUrl, { redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) {
      fail(`live metadata redirected: ${response.status} ${response.headers.get('location') || ''}`);
    }
    if (!response.ok) fail(`live metadata unavailable: ${response.status}`);
    if (response.url) assertTrustedWindowsUpdateFeedUrl(response.url, policy);
    const info = validateWindowsUpdateInfo(policy, parse(await response.text()) as unknown);
    ok(`live metadata ${info.version} files=${info.files.length} fingerprint=${info.fingerprint}`);
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
