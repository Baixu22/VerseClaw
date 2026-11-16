/**
 * TitleBar Component
 * macOS: empty drag region (native traffic lights handled by hiddenInset).
 * Windows: drag region with custom minimize/maximize/close controls; uses
 * theme-aware frame surface above the sidebar and conversation.
 * Linux: use native window chrome (no custom title bar).
 */
import { useState, useEffect } from 'react';
import { Minus, Square, X, Copy } from 'lucide-react';
import { hostApi } from '@/lib/host-api';
import { useTranslation } from 'react-i18next';

export function TitleBar() {
  const platform = window.electron?.platform;

  if (platform === 'darwin') {
    // macOS traffic lights live inside the sidebar area; keep the shell left/right.
    return null;
  }

  // Linux keeps the native frame/title bar for better IME compatibility.
  if (platform !== 'win32') {
    return null;
  }

  return <WindowsTitleBar />;
}

function WindowsTitleBar() {
  const { t } = useTranslation('common');
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    // Check initial state
    hostApi.window.isMaximized().then((val) => {
      setMaximized(val);
    });
  }, []);

  const handleMinimize = () => {
    void hostApi.window.minimize();
  };

  const handleMaximize = () => {
    hostApi.window.maximize().then(() => {
      hostApi.window.isMaximized().then((val) => {
        setMaximized(val);
      });
    });
  };

  const handleClose = () => {
    void hostApi.window.close();
  };

  return (
    <div
      data-testid="windows-titlebar"
      className="drag-region relative z-raised flex h-[34px] shrink-0 items-center justify-end border-b border-border bg-surface-sidebar"
    >
      {/* Right: Window Controls */}
      <div className="no-drag flex h-full">
        <button
          onClick={handleMinimize}
          className="flex h-full w-11 items-center justify-center text-muted-foreground transition-colors duration-150 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
          aria-label={t('window.minimize')}
          title={t('window.minimize')}
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          onClick={handleMaximize}
          className="flex h-full w-11 items-center justify-center text-muted-foreground transition-colors duration-150 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
          aria-label={maximized ? t('window.restore') : t('window.maximize')}
          title={maximized ? t('window.restore') : t('window.maximize')}
        >
          {maximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={handleClose}
          className="flex h-full w-11 items-center justify-center text-muted-foreground transition-colors duration-150 hover:bg-red-500 hover:text-white"
          aria-label={t('window.close')}
          title={t('window.close')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
