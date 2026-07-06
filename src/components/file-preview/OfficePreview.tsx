import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileWarning, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { hostApi } from '@/lib/host-api';

const NOT_INSTALLED = 'NOT_INSTALLED';

type WatchState =
  | { status: 'loading' }
  | { status: 'ready'; port: number; cap: string }
  | { status: 'error'; code: string; message: string };

function splitFilePath(filePath: string): { rootPath: string; path: string } {
  const normalized = filePath.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  if (index < 0) return { rootPath: '.', path: filePath };
  return {
    rootPath: filePath.slice(0, index) || '/',
    path: filePath.slice(index + 1),
  };
}

function watchErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const match = /(?:^|\s)([A-Z_]{2,}):/.exec(message);
  return match?.[1] ?? 'START_FAILED';
}

function watchErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function OfficePreview({
  filePath,
  fileName,
}: {
  filePath: string;
  fileName: string;
}) {
  const { t } = useTranslation('chat');
  const target = useMemo(() => splitFilePath(filePath), [filePath]);
  const [state, setState] = useState<WatchState>({ status: 'loading' });
  const [retryKey, setRetryKey] = useState(0);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let acquired = false;
    setState({ status: 'loading' });

    hostApi.officeTools.startWatch(target)
      .then((result) => {
        acquired = true;
        if (cancelled) {
          void Promise.resolve(hostApi.officeTools.stopWatch(target)).catch(() => {});
          return;
        }
        setState({ status: 'ready', port: result.port, cap: result.cap });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({
          status: 'error',
          code: watchErrorCode(error),
          message: watchErrorMessage(error),
        });
      });

    return () => {
      cancelled = true;
      if (acquired) {
        void Promise.resolve(hostApi.officeTools.stopWatch(target)).catch(() => {});
      }
    };
  }, [target, retryKey]);

  const retry = useCallback(() => {
    setRetryKey((value) => value + 1);
  }, []);

  const installAndRetry = useCallback(async () => {
    setInstalling(true);
    try {
      await hostApi.officeTools.install();
      await hostApi.officeTools.syncSkills().catch(() => undefined);
      retry();
    } catch (error) {
      setState({
        status: 'error',
        code: watchErrorCode(error),
        message: watchErrorMessage(error),
      });
    } finally {
      setInstalling(false);
    }
  }, [retry]);

  if (state.status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('filePreview.office.loading', 'Loading Office preview...')}
      </div>
    );
  }

  if (state.status === 'error') {
    const notInstalled = state.code === NOT_INSTALLED;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <FileWarning className="h-8 w-8 text-muted-foreground" />
        <div className="text-sm font-medium text-foreground">
          {notInstalled
            ? t('filePreview.office.notInstalledTitle', 'OfficeCLI is not installed')
            : t('filePreview.office.failedTitle', 'Office preview failed')}
        </div>
        <div className="max-w-sm break-words text-xs text-muted-foreground">
          {notInstalled
            ? t('filePreview.office.notInstalledHint', 'Install OfficeCLI, then retry the preview.')
            : state.message}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {notInstalled && (
            <Button size="sm" onClick={installAndRetry} disabled={installing}>
              {installing
                ? t('filePreview.office.installing', 'Installing...')
                : t('filePreview.office.install', 'Install OfficeCLI')}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={retry}>
            {t('filePreview.office.retry', 'Retry')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <iframe
      data-testid="office-preview-frame"
      title={t('filePreview.office.title', { defaultValue: 'Office preview: {{fileName}}', fileName })}
      src={`http://127.0.0.1:${state.port}/`}
      sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
      referrerPolicy="no-referrer"
      className="h-full w-full border-0 bg-white"
    />
  );
}

export default OfficePreview;
