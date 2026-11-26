import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export function SettingsPageChrome({
  title,
  description,
  titleTestId,
  children,
}: {
  title: string;
  description?: string;
  titleTestId?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation('settings');
  return (
    <div data-testid="settings-page" data-presentation="page" data-settings-appearance="" className="codex-settings-page">
      <div className="codex-settings-page__surface">
        <div className="codex-settings-page__header">
          <span className="codex-settings-page__header-label">{t('title')}</span>
        </div>
        <div className="codex-settings-page__panel">
          <div className="codex-settings-page__topfade" aria-hidden="true" />
          <div className="codex-settings-page__scroll">
            <div className="codex-settings-page__content">
              <header className="codex-settings-page__intro">
                <h1 data-testid={titleTestId} className="codex-settings-page__title">{title}</h1>
                {description ? <p className="codex-settings-page__description">{description}</p> : null}
              </header>
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
