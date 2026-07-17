import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WINDOWS_UPDATE_ORIGIN,
  assertSameWindowsUpdateInfo,
  assertTrustedWindowsUpdateFeedUrl,
  assertWindowsUpdateTlsVerificationEnabled,
  getWindowsUpdateFeedPolicy,
  validateWindowsUpdateInfo,
  verifyDownloadedWindowsUpdateFiles,
} from '../../shared/release-policy/windows-update-feed-policy';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

function sha512(value: string | Buffer): string {
  return createHash('sha512').update(value).digest('base64');
}

function metadata(version: string, fileName: string, bytes: Buffer | string) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const hash = sha512(buffer);
  return {
    version,
    files: [{ url: fileName, sha512: hash, size: buffer.length }],
    path: fileName,
    sha512: hash,
    releaseDate: '2026-07-17T00:00:00.000Z',
  };
}

describe('P6-002 Windows update feed integrity', () => {
  it('A1 selects a fixed HTTPS feed from the installed channel', () => {
    expect(getWindowsUpdateFeedPolicy('1.0.0')).toMatchObject({
      releaseChannel: 'stable',
      channelDirectory: 'latest',
      feedUrl: `${WINDOWS_UPDATE_ORIGIN}/latest/`,
      metadataFile: 'latest.yml',
      allowPrerelease: false,
    });
    expect(getWindowsUpdateFeedPolicy('1.0.0-alpha.2')).toMatchObject({
      releaseChannel: 'alpha',
      channelDirectory: 'alpha',
      feedUrl: `${WINDOWS_UPDATE_ORIGIN}/alpha/`,
      metadataChannel: 'latest',
      allowPrerelease: true,
    });
    expect(getWindowsUpdateFeedPolicy('1.0.0-beta.3').feedUrl).toBe(
      `${WINDOWS_UPDATE_ORIGIN}/beta/`,
    );
    expect(() => getWindowsUpdateFeedPolicy('1.0.0-rc.1')).toThrow(/unsupported/i);
  });

  it('A1/A3 rejects non-TLS, wrong-origin, decorated, and cross-channel sources', () => {
    const policy = getWindowsUpdateFeedPolicy('1.0.0-alpha.1');
    expect(assertTrustedWindowsUpdateFeedUrl(policy.metadataUrl, policy).origin).toBe(
      WINDOWS_UPDATE_ORIGIN,
    );
    expect(() => assertTrustedWindowsUpdateFeedUrl('http://oss.intelli-spectrum.com/alpha/latest.yml', policy)).toThrow(
      /HTTPS/i,
    );
    expect(() => assertTrustedWindowsUpdateFeedUrl('https://evil.example/alpha/latest.yml', policy)).toThrow(
      /stay under/i,
    );
    expect(() => assertTrustedWindowsUpdateFeedUrl(`${WINDOWS_UPDATE_ORIGIN}/latest/latest.yml`, policy)).toThrow(
      /stay under/i,
    );
    expect(() => assertTrustedWindowsUpdateFeedUrl(`${policy.metadataUrl}?channel=latest`, policy)).toThrow(
      /query/i,
    );
    expect(() => assertWindowsUpdateTlsVerificationEnabled('0')).toThrow(/certificate verification/i);
    expect(() => assertWindowsUpdateTlsVerificationEnabled('1')).not.toThrow();
  });

  it('A2/A3 validates metadata channel, source, SHA512, size, and preflight identity', () => {
    const bytes = Buffer.from('signed-update-package');
    const policy = getWindowsUpdateFeedPolicy('1.0.0-alpha.1');
    const valid = validateWindowsUpdateInfo(
      policy,
      metadata('1.0.1-alpha.0', 'Verse Claw-1.0.1-alpha.0-win-x64.exe', bytes),
    );
    expect(valid.files[0].resolvedUrl).toBe(
      `${WINDOWS_UPDATE_ORIGIN}/alpha/Verse%20Claw-1.0.1-alpha.0-win-x64.exe`,
    );

    expect(() =>
      validateWindowsUpdateInfo(
        policy,
        metadata('1.0.1-beta.0', 'Verse Claw-1.0.1-beta.0-win-x64.exe', bytes),
      ),
    ).toThrow(/cannot serve/i);
    expect(() =>
      validateWindowsUpdateInfo(policy, {
        ...metadata('1.0.1-alpha.0', 'x.exe', bytes),
        files: [{ url: 'https://evil.example/x.exe', sha512: sha512(bytes), size: bytes.length }],
      }),
    ).toThrow(/stay under/i);
    expect(() =>
      validateWindowsUpdateInfo(policy, {
        ...metadata('1.0.1-alpha.0', 'x.exe', bytes),
        files: [{ url: 'x.exe', sha512: '', size: bytes.length }],
      }),
    ).toThrow(/SHA512/i);

    const changed = validateWindowsUpdateInfo(
      policy,
      metadata('1.0.2-alpha.0', 'Verse Claw-1.0.2-alpha.0-win-x64.exe', bytes),
    );
    expect(() => assertSameWindowsUpdateInfo(valid, changed)).toThrow(/changed/i);
  });

  it('A2 rejects downloaded package size/hash tampering', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'clawx-p6-002-'));
    temporaryDirectories.push(directory);
    const fileName = 'Verse Claw-1.0.1-win-x64.exe';
    const filePath = join(directory, fileName);
    const bytes = Buffer.from('verified-package');
    await writeFile(filePath, bytes);
    const info = validateWindowsUpdateInfo(
      getWindowsUpdateFeedPolicy('1.0.0'),
      metadata('1.0.1', fileName, bytes),
    );
    await expect(verifyDownloadedWindowsUpdateFiles([filePath], info)).resolves.toHaveLength(1);

    await writeFile(filePath, Buffer.from('tampered-package'));
    await expect(verifyDownloadedWindowsUpdateFiles([filePath], info)).rejects.toThrow(/mismatch/i);
  });

  it('A1-A3 configures Main-owned updater, preflights metadata, and verifies download before install', async () => {
    vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '1');
    const directory = await mkdtemp(join(tmpdir(), 'clawx-p6-002-api-'));
    temporaryDirectories.push(directory);
    const fileName = 'Verse Claw-1.0.1-alpha.0-win-x64.exe';
    const filePath = join(directory, fileName);
    const bytes = Buffer.from('verified-alpha-package');
    await writeFile(filePath, bytes);
    const info = metadata('1.0.1-alpha.0', fileName, bytes);
    const setFeedURL = vi.fn();
    const quitAndInstall = vi.fn();
    const updater = {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      allowPrerelease: false,
      channel: null as string | null,
      requestHeaders: null as Record<string, string> | null,
      setFeedURL,
      checkForUpdates: vi.fn().mockResolvedValue({ updateInfo: info }),
      downloadUpdate: vi.fn().mockResolvedValue([filePath]),
      quitAndInstall,
    };
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(info), {
        status: 200,
        headers: { 'content-type': 'application/yaml' },
      }),
    );
    const logger = { info: vi.fn(), warn: vi.fn() };
    vi.doMock('electron', () => ({ app: { isPackaged: false, getVersion: () => '0.0.0' } }));
    vi.doMock('electron-updater', () => ({ autoUpdater: updater }));
    const { createUpdatesApi } = await import('../../electron/services/updates-api');
    const api = createUpdatesApi({
      updater,
      appAdapter: { isPackaged: true, getVersion: () => '1.0.0-alpha.1' },
      platform: 'win32',
      fetcher: fetcher as typeof fetch,
      logger,
    });

    await expect(api.check()).resolves.toMatchObject({
      success: true,
      status: { status: 'available', version: '1.0.1-alpha.0' },
    });
    expect(setFeedURL).toHaveBeenCalledWith({
      provider: 'generic',
      url: `${WINDOWS_UPDATE_ORIGIN}/alpha/`,
      channel: 'latest',
      useMultipleRangeRequest: false,
    });
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.allowPrerelease).toBe(true);
    expect(updater.channel).toBe('latest');
    expect(api.install()).toMatchObject({ success: false });
    await expect(api.download()).resolves.toMatchObject({
      success: true,
      status: { status: 'downloaded' },
    });
    expect(api.install()).toMatchObject({ success: true });
    expect(quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('A2 rejects redirecting metadata before electron-updater can check', async () => {
    vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '1');
    const updater = {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      allowPrerelease: false,
      channel: null as string | null,
      requestHeaders: null as Record<string, string> | null,
      setFeedURL: vi.fn(),
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      quitAndInstall: vi.fn(),
    };
    vi.doMock('electron', () => ({ app: { isPackaged: false, getVersion: () => '0.0.0' } }));
    vi.doMock('electron-updater', () => ({ autoUpdater: updater }));
    const { createUpdatesApi } = await import('../../electron/services/updates-api');
    const api = createUpdatesApi({
      updater,
      appAdapter: { isPackaged: true, getVersion: () => '1.0.0' },
      platform: 'win32',
      fetcher: vi.fn().mockResolvedValue(
        new Response('', { status: 302, headers: { location: 'https://evil.example/latest.yml' } }),
      ) as typeof fetch,
      logger: { info: vi.fn(), warn: vi.fn() },
    });
    await expect(api.check()).resolves.toMatchObject({ success: false, status: { status: 'error' } });
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });
});
