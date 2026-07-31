/**
 * Settings section / card / row wrappers, ported from
 *   FakeCoding-main/web/src/components/settings/SettingsSection.tsx
 *
 * Styles live in src/styles/codex-settings-controls.css (single source); the
 * geometry in those comments is CDP-measured off the official Codex settings
 * surface, so prefer fixing the CSS over overriding it at call sites.
 */
import type { ReactNode } from 'react';

/** Rounded card; children get inset hairline dividers automatically. */
export function SettingsCard({
  children,
  ariaLabel,
  testId,
}: {
  children: ReactNode;
  ariaLabel?: string;
  testId?: string;
}) {
  return (
    <div className="sp-card" aria-label={ariaLabel} data-testid={testId}>
      {children}
    </div>
  );
}

/** Section = 14px/500 title + card (16px apart, 50px below the card). */
export function SettingsSection({
  title,
  children,
  action,
  description,
  testId,
}: {
  title?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  description?: ReactNode;
  testId?: string;
}) {
  return (
    <section className="sp-section" data-testid={testId}>
      {title || action ? (
        <div className="sp-section-head">
          <div className="sp-section-head-text">
            {title ? <h2 className="sp-section-title">{title}</h2> : null}
            {description ? <p className="sp-section-desc">{description}</p> : null}
          </div>
          {action ? <div className="sp-section-action">{action}</div> : null}
        </div>
      ) : null}
      <SettingsCard>{children}</SettingsCard>
    </section>
  );
}

/** Standalone block that is not wrapped in a card (custom panels, empty states). */
export function SettingsBlock({
  title,
  description,
  children,
  action,
  testId,
}: {
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  testId?: string;
}) {
  return (
    <section className="sp-section" data-testid={testId}>
      {title || action || description ? (
        <div className="sp-section-head">
          <div className="sp-section-head-text">
            {title ? <h2 className="sp-section-title">{title}</h2> : null}
            {description ? <p className="sp-section-desc">{description}</p> : null}
          </div>
          {action ? <div className="sp-section-action">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Amber / info callout under page titles. */
export function SettingsBanner({ children, tone = 'warn' }: { children: ReactNode; tone?: 'warn' | 'info' }) {
  return <div className={tone === 'info' ? 'sp-banner info' : 'sp-banner'}>{children}</div>;
}

/**
 * Card row: 13px/500 title + optional 12px secondary description on the left,
 * control pinned right (pad 12x16, gap 24, vertically centered).
 */
export function SettingsRow({
  title,
  description,
  control,
  testId,
}: {
  title: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  testId?: string;
}) {
  return (
    <div className="sp-row" data-testid={testId}>
      <div className="sp-row-label">
        <b>{title}</b>
        {description ? <small>{description}</small> : null}
      </div>
      {control ? <div className="sp-row-control">{control}</div> : null}
    </div>
  );
}

/**
 * Full-width row for content that cannot sit in the label/control split
 * (nested editors, lists, textareas). ClawX addition: the reference only ever
 * needed the two-column row, but several ClawX panels are inherently stacked.
 */
export function SettingsStackRow({
  title,
  description,
  children,
  testId,
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div className="sp-stack-row" data-testid={testId}>
      {title || description ? (
        <div className="sp-row-label">
          {title ? <b>{title}</b> : null}
          {description ? <small>{description}</small> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** Inline link used inside row descriptions. */
export function SettingsInlineLink({
  children,
  href,
  onClick,
}: {
  children: ReactNode;
  href?: string;
  onClick?: () => void;
}) {
  if (href) {
    return (
      <a className="sp-inline-link" href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  }
  return (
    <button type="button" className="sp-inline-link" onClick={onClick}>
      {children}
    </button>
  );
}
