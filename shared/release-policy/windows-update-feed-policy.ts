import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';

export const WINDOWS_UPDATE_ORIGIN = 'https://oss.intelli-spectrum.com';
export const WINDOWS_UPDATE_METADATA_CHANNEL = 'latest';
export const WINDOWS_UPDATE_METADATA_FILE = 'latest.yml';

export type WindowsUpdateReleaseChannel = 'stable' | 'alpha' | 'beta';

export type WindowsUpdateFeedPolicy = {
  releaseChannel: WindowsUpdateReleaseChannel;
  channelDirectory: 'latest' | 'alpha' | 'beta';
  metadataChannel: typeof WINDOWS_UPDATE_METADATA_CHANNEL;
  metadataFile: typeof WINDOWS_UPDATE_METADATA_FILE;
  feedUrl: string;
  metadataUrl: string;
  allowPrerelease: boolean;
};

export type UpdateFileMetadata = {
  url: string;
  sha512: string;
  size: number;
  resolvedUrl: string;
  fileName: string;
};

export type ValidatedWindowsUpdateInfo = {
  version: string;
  releaseChannel: WindowsUpdateReleaseChannel;
  files: UpdateFileMetadata[];
  fingerprint: string;
};

export class WindowsUpdatePolicyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'WindowsUpdatePolicyError';
    this.code = code;
  }
}

export function assertWindowsUpdateTlsVerificationEnabled(
  nodeTlsRejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED,
): void {
  if (nodeTlsRejectUnauthorized === '0') {
    throw new WindowsUpdatePolicyError(
      'ERR_UPDATE_TLS_VERIFICATION_DISABLED',
      'Windows update checks require TLS certificate verification',
    );
  }
}

export function detectWindowsUpdateReleaseChannel(versionRaw: string): WindowsUpdateReleaseChannel {
  const version = String(versionRaw || '').trim().replace(/^v/i, '');
  if (!version) throw new WindowsUpdatePolicyError('ERR_UPDATE_VERSION_EMPTY', 'update version is empty');
  const dash = version.indexOf('-');
  if (dash < 0) return 'stable';
  const prerelease = version.slice(dash + 1).toLowerCase();
  if (prerelease === 'alpha' || prerelease.startsWith('alpha.')) return 'alpha';
  if (prerelease === 'beta' || prerelease.startsWith('beta.')) return 'beta';
  throw new WindowsUpdatePolicyError(
    'ERR_UPDATE_CHANNEL_UNCLASSIFIED',
    `unsupported Windows update prerelease channel: ${prerelease}`,
  );
}

export function getWindowsUpdateFeedPolicy(
  version: string,
  origin = WINDOWS_UPDATE_ORIGIN,
): WindowsUpdateFeedPolicy {
  const trustedOrigin = normalizeTrustedOrigin(origin);
  const releaseChannel = detectWindowsUpdateReleaseChannel(version);
  const channelDirectory = releaseChannel === 'stable' ? 'latest' : releaseChannel;
  const feedUrl = `${trustedOrigin}/${channelDirectory}/`;
  return {
    releaseChannel,
    channelDirectory,
    metadataChannel: WINDOWS_UPDATE_METADATA_CHANNEL,
    metadataFile: WINDOWS_UPDATE_METADATA_FILE,
    feedUrl,
    metadataUrl: `${feedUrl}${WINDOWS_UPDATE_METADATA_FILE}`,
    allowPrerelease: releaseChannel !== 'stable',
  };
}

export function assertTrustedWindowsUpdateFeedUrl(
  candidate: string,
  policy: WindowsUpdateFeedPolicy,
): URL {
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new WindowsUpdatePolicyError('ERR_UPDATE_SOURCE_INVALID', `invalid update source URL: ${candidate}`);
  }
  const expected = new URL(policy.feedUrl);
  if (parsed.protocol !== 'https:') {
    throw new WindowsUpdatePolicyError('ERR_UPDATE_SOURCE_TLS_REQUIRED', 'Windows update source must use HTTPS');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new WindowsUpdatePolicyError(
      'ERR_UPDATE_SOURCE_DECORATED',
      'Windows update source must not contain credentials, query, or fragment',
    );
  }
  if (parsed.origin !== expected.origin || !parsed.pathname.startsWith(expected.pathname)) {
    throw new WindowsUpdatePolicyError(
      'ERR_UPDATE_SOURCE_MISMATCH',
      `Windows update source must stay under ${policy.feedUrl}`,
    );
  }
  return parsed;
}

export function validateWindowsUpdateInfo(
  policy: WindowsUpdateFeedPolicy,
  input: unknown,
): ValidatedWindowsUpdateInfo {
  if (!input || typeof input !== 'object') {
    throw new WindowsUpdatePolicyError('ERR_UPDATE_METADATA_INVALID', 'update metadata must be an object');
  }
  const record = input as Record<string, unknown>;
  const version = typeof record.version === 'string' ? record.version.trim() : '';
  if (!version) {
    throw new WindowsUpdatePolicyError('ERR_UPDATE_METADATA_VERSION', 'update metadata version is missing');
  }
  const metadataChannel = detectWindowsUpdateReleaseChannel(version);
  if (metadataChannel !== policy.releaseChannel) {
    throw new WindowsUpdatePolicyError(
      'ERR_UPDATE_CHANNEL_MISMATCH',
      `feed channel=${policy.releaseChannel} cannot serve version channel=${metadataChannel}`,
    );
  }

  if (!Array.isArray(record.files) || record.files.length === 0) {
    throw new WindowsUpdatePolicyError('ERR_UPDATE_FILES_EMPTY', 'update metadata files must be non-empty');
  }

  const names = new Set<string>();
  const files = record.files.map((value, index) => {
    if (!value || typeof value !== 'object') {
      throw new WindowsUpdatePolicyError(
        'ERR_UPDATE_FILE_INVALID',
        `update metadata file[${index}] must be an object`,
      );
    }
    const file = value as Record<string, unknown>;
    const url = typeof file.url === 'string' ? file.url.trim() : '';
    const sha512 = typeof file.sha512 === 'string' ? file.sha512.trim() : '';
    const size = typeof file.size === 'number' ? file.size : Number.NaN;
    if (!url || url.includes('\\') || url.split('/').includes('..')) {
      throw new WindowsUpdatePolicyError('ERR_UPDATE_FILE_URL', `invalid update file URL: ${url}`);
    }
    if (!isSha512Base64(sha512)) {
      throw new WindowsUpdatePolicyError(
        'ERR_UPDATE_FILE_SHA512',
        `update file ${url} must have a 64-byte base64 SHA512`,
      );
    }
    if (!Number.isSafeInteger(size) || size <= 0) {
      throw new WindowsUpdatePolicyError(
        'ERR_UPDATE_FILE_SIZE',
        `update file ${url} must have a positive integer size`,
      );
    }
    const resolved = assertTrustedWindowsUpdateFeedUrl(new URL(url, policy.feedUrl).toString(), policy);
    const fileName = basename(decodeURIComponent(resolved.pathname));
    if (!fileName || names.has(fileName)) {
      throw new WindowsUpdatePolicyError(
        'ERR_UPDATE_FILE_DUPLICATE',
        `duplicate or empty update file name: ${fileName}`,
      );
    }
    names.add(fileName);
    return { url, sha512, size, resolvedUrl: resolved.toString(), fileName };
  });

  if (typeof record.path === 'string' && record.path.trim()) {
    const topName = basename(record.path.trim());
    const topFile = files.find((file) => file.fileName === topName);
    if (!topFile || record.sha512 !== topFile.sha512) {
      throw new WindowsUpdatePolicyError(
        'ERR_UPDATE_TOP_LEVEL_MISMATCH',
        'top-level path/sha512 must match one files[] entry',
      );
    }
  }

  return {
    version,
    releaseChannel: metadataChannel,
    files,
    fingerprint: fingerprintWindowsUpdateInfo({ version, files }),
  };
}

export function assertSameWindowsUpdateInfo(
  expected: ValidatedWindowsUpdateInfo,
  actual: ValidatedWindowsUpdateInfo,
): void {
  if (expected.fingerprint !== actual.fingerprint) {
    throw new WindowsUpdatePolicyError(
      'ERR_UPDATE_METADATA_CHANGED',
      'update metadata changed between trusted preflight and electron-updater check',
    );
  }
}

export async function verifyDownloadedWindowsUpdateFiles(
  downloadedPaths: string[],
  updateInfo: ValidatedWindowsUpdateInfo,
): Promise<Array<{ path: string; fileName: string; sha512: string; size: number }>> {
  if (!Array.isArray(downloadedPaths) || downloadedPaths.length === 0) {
    throw new WindowsUpdatePolicyError('ERR_UPDATE_DOWNLOAD_EMPTY', 'electron-updater returned no downloaded files');
  }
  const expectedByName = new Map(updateInfo.files.map((file) => [file.fileName, file]));
  const verified = [];
  for (const filePath of downloadedPaths) {
    const fileName = basename(filePath);
    const expected = expectedByName.get(fileName);
    if (!expected) {
      throw new WindowsUpdatePolicyError(
        'ERR_UPDATE_DOWNLOAD_UNEXPECTED',
        `downloaded file is not declared by metadata: ${fileName}`,
      );
    }
    const fileStat = await stat(filePath);
    if (!fileStat.isFile() || fileStat.size !== expected.size) {
      throw new WindowsUpdatePolicyError(
        'ERR_UPDATE_DOWNLOAD_SIZE',
        `downloaded file size mismatch for ${fileName}: expected=${expected.size} actual=${fileStat.size}`,
      );
    }
    const sha512 = await sha512FileBase64(filePath);
    if (sha512 !== expected.sha512) {
      throw new WindowsUpdatePolicyError(
        'ERR_UPDATE_DOWNLOAD_SHA512',
        `downloaded file SHA512 mismatch for ${fileName}`,
      );
    }
    verified.push({ path: filePath, fileName, sha512, size: fileStat.size });
  }
  return verified;
}

export function checkWindowsUpdateWorkflowConsistency(workflowText: string): {
  ok: boolean;
  missing: string[];
} {
  const checks: Array<[string, RegExp]> = [
    ['trusted-origin', /https:\/\/oss\.intelli-spectrum\.com/],
    ['latest-directory', /CHANNEL="latest"/],
    ['channel-directory', /CHANNEL="\$\{BASH_REMATCH\[1\]\}"/],
    ['metadata-name', /latest\.yml/],
    ['published-metadata-file', /test -f "staging\/\$\{CHANNEL\}\/latest\.yml"/],
    ['pre-publish-gate', /release-policy-gate:/],
    ['client-policy-validator', /validate-windows-update-feed-policy/],
  ];
  const missing = checks.filter(([, pattern]) => !pattern.test(workflowText)).map(([id]) => id);
  return { ok: missing.length === 0, missing };
}

function normalizeTrustedOrigin(origin: string): string {
  const parsed = new URL(origin);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new WindowsUpdatePolicyError(
      'ERR_UPDATE_ORIGIN_INVALID',
      'Windows update origin must be a bare HTTPS origin',
    );
  }
  return parsed.origin;
}

function isSha512Base64(value: string): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  try {
    return Buffer.from(value, 'base64').length === 64;
  } catch {
    return false;
  }
}

function fingerprintWindowsUpdateInfo(input: {
  version: string;
  files: UpdateFileMetadata[];
}): string {
  const canonical = JSON.stringify({
    version: input.version,
    files: [...input.files]
      .map((file) => ({
        fileName: file.fileName,
        resolvedUrl: file.resolvedUrl,
        sha512: file.sha512,
        size: file.size,
      }))
      .sort((a, b) => a.fileName.localeCompare(b.fileName)),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

async function sha512FileBase64(filePath: string): Promise<string> {
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('base64');
}
