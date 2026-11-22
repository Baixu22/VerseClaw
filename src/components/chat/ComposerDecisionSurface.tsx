import { useId, type ReactNode, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Decisions occupy the composer's own surface and keep the transcript scrollable. */
export function ComposerDecisionSurface({ title, description, icon: Icon, count = 1, titleRef, children, footer, testId, kind, tone, hero = false }: {
  title: string;
  description?: string;
  icon: LucideIcon;
  count?: number;
  titleRef?: Ref<HTMLHeadingElement>;
  children: ReactNode;
  footer?: ReactNode;
  testId: string;
  kind: 'runtime-approval' | 'permission' | 'question' | 'plan';
  tone?: 'neutral' | 'warning' | 'danger';
  hero?: boolean;
}) {
  const titleId = useId();
  const { t } = useTranslation('chat');
  return (
    <div className={cn('codex-composer-host composer-decision-host mx-auto w-full max-w-[768px] px-4 pb-5 pt-2', hero && 'codex-composer-host--hero')}>
      <section className="codex-composer-shell composer-decision-panel" aria-labelledby={titleId} data-testid={testId} data-decision-kind={kind}
        data-decision-tone={tone ?? (kind === 'runtime-approval' || kind === 'permission' ? 'warning' : 'neutral')}>
        <header className="composer-decision-header">
          <span className="composer-decision-symbol" aria-hidden="true"><Icon className="composer-decision-icon" /></span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} ref={titleRef} tabIndex={-1} className="composer-decision-title">{title}</h2>
            {description && <p className="composer-decision-description">{description}</p>}
          </div>
          <span className="composer-decision-count" role="status">{t('composerRequests.pendingCount', { count })}</span>
        </header>
        <div className="composer-decision-content" data-testid="chat-composer-request-content">{children}</div>
        {footer && <footer className="composer-decision-footer">{footer}</footer>}
      </section>
    </div>
  );
}
