import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateInfo } from 'electron-updater';
import { parse } from 'yaml';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import {
  assertSameWindowsUpdateInfo,
  assertTrustedWindowsUpdateFeedUrl,
  assertWindowsUpdateTlsVerificationEnabled,
  getWindowsUpdateFeedPolicy,
  validateWindowsUpdateInfo,
  verifyDownloadedWindowsUpdateFiles,
  type ValidatedWindowsUpdateInfo,
  type WindowsUpdateFeedPolicy,
} from '../../shared/release-policy/windows-update-feed-policy';

type AutoUpdaterPort = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  channel: string | null;
  requestHeaders: Record<string, string> | null;
  setFeedURL(options: { provider: 'generic'; url: string; channel: string; useMultipleRangeRequest: false }): void;
  checkForUpdates(): Promise<{ updateInfo: UpdateInfo } | null>;
  downloadUpdate(): Promise<string[]>;
  quitAndInstall(): void;
};

type UpdatesApiDeps = {
  updater?: AutoUpdaterPort;
  appAdapter?: Pick<typeof app, 'isPackaged' | 'getVersion'>;
  platform?: NodeJS.Platform;
  fetcher?: typeof fetch;
  logger?: Pick<Console, 'info' | 'warn'>;
};

type PendingWindowsUpdate = {
  policy: WindowsUpdateFeedPolicy;
  info: ValidatedWindowsUpdateInfo;
};

export function createUpdatesApi(deps: UpdatesApiDeps = {}): CompleteHostServiceRegistry['updates'] {
  const updater = deps.updater ?? (autoUpdater as AutoUpdaterPort);
  const appAdapter = deps.appAdapter ?? app;
  const platform = deps.platform ?? process.platform;
  const fetcher = deps.fetcher ?? fetch;
  const logger = deps.logger ?? console;
  let pendingWindowsUpdate: PendingWindowsUpdate | null = null;
  let verifiedWindowsDownload = false;

  async function configureAndPreflightWindowsFeed(): Promise<PendingWindowsUpdate | null> {
    if (platform !== 'win32') return null;
    assertWindowsUpdateTlsVerificationEnabled();
    const policy = getWindowsUpdateFeedPolicy(appAdapter.getVersion());
    assertTrustedWindowsUpdateFeedUrl(policy.feedUrl, policy);
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = policy.allowPrerelease;
    updater.channel = policy.metadataChannel;
    updater.requestHeaders = {
      Accept: 'application/yaml, text/yaml, text/plain;q=0.9',
      'Cache-Control': 'no-cache',
    };
    updater.setFeedURL({
      provider: 'generic',
      url: policy.feedUrl,
      channel: policy.metadataChannel,
      useMultipleRangeRequest: false,
    });

    logger.info('[updates] Windows feed policy', {
      releaseChannel: policy.releaseChannel,
      feedUrl: policy.feedUrl,
      metadataFile: policy.metadataFile,
      allowPrerelease: policy.allowPrerelease,
    });

    const response = await fetcher(policy.metadataUrl, {
      redirect: 'manual',
      headers: updater.requestHeaders,
    });
    if (response.status >= 300 && response.status < 400) {
      throw new Error(`Windows update metadata redirect rejected: status=${response.status}`);
    }
    if (!response.ok) {
      throw new Error(`Windows update metadata unavailable: status=${response.status}`);
    }
    if (response.url) assertTrustedWindowsUpdateFeedUrl(response.url, policy);
    const metadataText = await response.text();
    if (Buffer.byteLength(metadataText, 'utf8') > 1024 * 1024) {
      throw new Error('Windows update metadata exceeds 1 MiB policy limit');
    }
    const preflight = validateWindowsUpdateInfo(policy, parse(metadataText) as unknown);
    return { policy, info: preflight };
  }

  return {
    check: async () => {
      if (!appAdapter.isPackaged) {
        return { success: true, status: { status: 'not-available' } };
      }
      try {
        pendingWindowsUpdate = null;
        verifiedWindowsDownload = false;
        const preflight = await configureAndPreflightWindowsFeed();
        const result = await updater.checkForUpdates();
        if (!result) {
          pendingWindowsUpdate = null;
          return { success: true, status: { status: 'not-available' } };
        }
        const version = result.updateInfo.version;
        const updateAvailable = Boolean(version && version !== appAdapter.getVersion());
        if (preflight) {
          const updaterInfo = validateWindowsUpdateInfo(preflight.policy, result.updateInfo);
          assertSameWindowsUpdateInfo(preflight.info, updaterInfo);
          pendingWindowsUpdate = updateAvailable
            ? { policy: preflight.policy, info: updaterInfo }
            : null;
        }
        return {
          success: true,
          status: updateAvailable
            ? { status: 'available', version }
            : { status: 'not-available' },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          status: { status: 'error' },
        };
      }
    },
    download: async () => {
      try {
        if (platform === 'win32') verifiedWindowsDownload = false;
        if (platform === 'win32' && !pendingWindowsUpdate) {
          throw new Error('Windows update download requires a validated update check');
        }
        const downloadedPaths = await updater.downloadUpdate();
        if (pendingWindowsUpdate) {
          await verifyDownloadedWindowsUpdateFiles(downloadedPaths, pendingWindowsUpdate.info);
          verifiedWindowsDownload = true;
        }
        return { success: true, status: { status: 'downloaded' } };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          status: { status: 'error' },
        };
      }
    },
    install: () => {
      if (platform === 'win32' && !verifiedWindowsDownload) {
        return { success: false, error: 'Windows update install requires a verified download' };
      }
      updater.quitAndInstall();
      return { success: true };
    },
  };
}
