/**
 * Settings controls, ported from
 *   FakeCoding-main/web/src/components/settings/SettingsControls.tsx
 *
 * Styles live in src/styles/codex-settings-controls.css (single source). The
 * anatomy notes are the source's CDP measurements, kept verbatim.
 *
 * DEVIATIONS from the source:
 *   1. Labels/placeholders are passed in by callers rather than hardcoded in
 *      Chinese — ClawX is localized through i18next.
 *   2. The repeated outside-click/Escape effect is factored into
 *      useDismissOnOutside so the controls cannot drift apart.
 *   3. SettingsSelect takes option `value`s distinct from labels, because
 *      ClawX selects are bound to enum-ish store values, not display strings.
 */
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { SettingsChevronDownIcon, SettingsCheckIcon, SettingsMoreIcon } from './SettingsGlyphs';
import { useDismissOnOutside, usePopover } from './usePopover';

/**
 * Toggle switch, official anatomy: transparent 32x20 button > colored track >
 * 16px thumb (travel 2px->14px). ON #339cff, OFF 10% fill,
 * disabled opacity .6.
 */
export function SettingsSwitch({
  checked,
  onChange,
  ariaLabel,
  disabled = false,
  id,
  testId,
}: {
  checked: boolean;
  onChange?: (v: boolean) => void;
  ariaLabel: string;
  disabled?: boolean;
  id?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      data-testid={testId}
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      data-state={checked ? 'checked' : 'unchecked'}
      className={checked ? 'sp-switch on' : 'sp-switch'}
      onClick={() => onChange?.(!checked)}
    >
      <span className="sp-switch-track">
        <span className="sp-switch-thumb" />
      </span>
    </button>
  );
}

export type SettingsSelectOption = {
  value: string;
  label: string;
  icon?: ReactNode;
};

/**
 * Select trigger + dropdown. Trigger: h28 / pad 0 12 / fog bg + hairline /
 * 14px, chevron 14px; shows the selected option's icon when present.
 * Menu (official): fixed 220px, below-right of trigger, translucent shell
 * + blur(8px), radius 15, pad 4; items 13px, pad 5x8, 18px leading icons.
 */
export function SettingsSelect({
  value,
  options,
  ariaLabel,
  onChange,
  leading,
  disabled = false,
  testId,
  placeholder,
}: {
  value: string;
  options: SettingsSelectOption[];
  ariaLabel: string;
  onChange: (v: string) => void;
  leading?: ReactNode;
  disabled?: boolean;
  testId?: string;
  placeholder?: string;
}) {
  const popover = usePopover<HTMLButtonElement>({ align: 'right', gap: 2, fixedWidth: 220 });
  const { open, setOpen } = popover;

  useDismissOnOutside({
    open,
    onDismiss: () => setOpen(false),
    refs: [popover.triggerRef, popover.layerRef],
  });

  const selected = options.find((o) => o.value === value);
  const triggerIcon = leading ?? selected?.icon;

  return (
    <div className="sp-select-wrap">
      <button
        ref={popover.triggerRef}
        type="button"
        data-testid={testId}
        className={open ? 'sp-select-btn open' : 'sp-select-btn'}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {triggerIcon ? <span className="sp-select-leading">{triggerIcon}</span> : null}
        <span className="sp-select-value">{selected?.label ?? placeholder ?? value}</span>
        <SettingsChevronDownIcon />
      </button>
      {open
        && createPortal(
          <div
            ref={popover.layerRef}
            className={popover.placement === 'top' ? 'sp-select-menu flip-top' : 'sp-select-menu'}
            role="listbox"
            aria-label={ariaLabel}
            style={popover.style}
          >
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={opt.value === value}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                {opt.icon ? <span className="sp-opt-icon">{opt.icon}</span> : null}
                <span className="sp-opt-label">{opt.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** Pill segmented control: gap 2, active bg 5% fill. */
export function SettingsSegmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  testId,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode; icon?: ReactNode; testId?: string }>;
  onChange: (v: T) => void;
  ariaLabel?: string;
  testId?: string;
}) {
  return (
    <div className="sp-segmented" role="group" aria-label={ariaLabel} data-testid={testId}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={value === opt.value ? 'active' : undefined}
          aria-pressed={value === opt.value}
          data-testid={opt.testId}
          onClick={() => onChange(opt.value)}
        >
          {opt.icon ? <span className="sp-segmented-icon">{opt.icon}</span> : null}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** Row action button: h28, bg 5% fill. */
export function SettingsButton({
  children,
  onClick,
  variant = 'secondary',
  ariaLabel,
  disabled = false,
  testId,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'secondary' | 'primary' | 'danger';
  ariaLabel?: string;
  disabled?: boolean;
  testId?: string;
}) {
  const className = variant === 'primary'
    ? 'sp-btn-primary'
    : variant === 'danger'
      ? 'sp-btn-secondary sp-btn-danger'
      : 'sp-btn-secondary';
  return (
    <button
      type="button"
      className={className}
      aria-label={ariaLabel}
      disabled={disabled}
      data-testid={testId}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** 28px square icon button used by manage rows. */
export function SettingsIconButton({
  label,
  open = false,
  onClick,
  children,
  testId,
}: {
  label: string;
  open?: boolean;
  onClick?: () => void;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      className={open ? 'sp-icon-btn open' : 'sp-icon-btn'}
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={open}
      data-testid={testId}
      onClick={onClick}
    >
      {children ?? <SettingsMoreIcon />}
    </button>
  );
}

export type SettingsMenuItem = {
  label: string;
  danger?: boolean;
  onSelect: () => void;
};

/** Row action dropdown + anchor. Renders trigger and, when open, the menu shell. */
export function SettingsRowMenu({
  items,
  triggerLabel,
  testId,
}: {
  items: SettingsMenuItem[];
  triggerLabel: string;
  testId?: string;
}) {
  const popover = usePopover<HTMLSpanElement>({ align: 'right', gap: 4, minWidth: 148 });
  const { open, setOpen } = popover;

  useDismissOnOutside({
    open,
    onDismiss: () => setOpen(false),
    refs: [popover.triggerRef, popover.layerRef],
  });

  return (
    <div className="sp-row-menu-anchor">
      <span ref={popover.triggerRef} className="sp-row-menu-trigger">
        <SettingsIconButton
          label={triggerLabel}
          open={open}
          testId={testId}
          onClick={() => setOpen((v) => !v)}
        />
      </span>
      {open
        && createPortal(
          <div
            ref={popover.layerRef}
            className={popover.placement === 'top' ? 'sp-row-menu flip-top' : 'sp-row-menu'}
            role="menu"
            style={popover.style}
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={item.danger ? 'danger' : undefined}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** Compact text input used by row-level fields. */
export function SettingsInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  type = 'text',
  wide = false,
  id,
  disabled = false,
  testId,
  onKeyDown,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  type?: 'text' | 'number' | 'password';
  wide?: boolean;
  id?: string;
  disabled?: boolean;
  testId?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <input
      id={id}
      className={wide ? 'sp-input sp-input-wide' : 'sp-input'}
      type={type}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel ?? placeholder}
      disabled={disabled}
      data-testid={testId}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}

/** Multi-line field for instruction-style settings. */
export function SettingsTextarea({
  value,
  onChange,
  placeholder,
  ariaLabel,
  rows = 6,
  id,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  rows?: number;
  id?: string;
  testId?: string;
}) {
  return (
    <textarea
      id={id}
      className="sp-textarea"
      value={value}
      rows={rows}
      placeholder={placeholder}
      aria-label={ariaLabel ?? placeholder}
      data-testid={testId}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export type SettingsMultiOption = { label: string; value: string };

/**
 * Multi-select dropdown. Trigger mirrors SettingsSelect (h28 / fog bg /
 * hairline / chevron); the portal layer renders a checkbox list whose entries
 * toggle membership in `value` via `onChange`. The last selected entry cannot
 * be removed, matching the source.
 */
export function SettingsMultiSelect({
  options,
  value,
  ariaLabel,
  onChange,
  triggerLabel,
  testId,
}: {
  options: SettingsMultiOption[];
  value: string[];
  ariaLabel: string;
  onChange: (next: string[]) => void;
  triggerLabel: string;
  testId?: string;
}) {
  const popover = usePopover<HTMLButtonElement>({ align: 'right', gap: 2, fixedWidth: 220 });
  const { open, setOpen } = popover;

  useDismissOnOutside({
    open,
    onDismiss: () => setOpen(false),
    refs: [popover.triggerRef, popover.layerRef],
  });

  const toggle = (v: string) => {
    if (value.includes(v)) {
      // never allow the last selected entry to be removed
      if (value.length <= 1) return;
      onChange(value.filter((x) => x !== v));
    } else {
      // preserve option order so the menu keeps a stable top->bottom pitch
      onChange(options.map((o) => o.value).filter((ov) => value.includes(ov) || ov === v));
    }
  };

  return (
    <div className="sp-select-wrap">
      <button
        ref={popover.triggerRef}
        type="button"
        data-testid={testId}
        className={open ? 'sp-select-btn open' : 'sp-select-btn'}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="sp-select-value">{triggerLabel}</span>
        <SettingsChevronDownIcon />
      </button>
      {open
        && createPortal(
          <div
            ref={popover.layerRef}
            className={popover.placement === 'top'
              ? 'sp-select-menu sp-multiselect flip-top'
              : 'sp-select-menu sp-multiselect'}
            role="listbox"
            aria-label={ariaLabel}
            aria-multiselectable="true"
            style={popover.style}
          >
            {options.map((opt) => {
              const checked = value.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  onClick={() => toggle(opt.value)}
                >
                  <span className="sp-opt-check" aria-hidden="true">
                    {checked ? <SettingsCheckIcon /> : null}
                  </span>
                  <span className="sp-opt-label">{opt.label}</span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** Keyboard shortcut pill(s). */
export function SettingsKbd({ keys, emptyLabel }: { keys: string[]; emptyLabel: string }) {
  if (!keys.length) {
    return <span className="sp-kbd-empty">{emptyLabel}</span>;
  }
  return (
    <span className="sp-kbd-group">
      {keys.map((k) => (
        <kbd key={k} className="sp-kbd">{k}</kbd>
      ))}
    </span>
  );
}

/** Shared controlled-open state for a row's action menu. */
export function useSettingsRowMenu() {
  const [openId, setOpenId] = useState<string | null>(null);
  return {
    openId,
    isOpen: (id: string) => openId === id,
    toggle: (id: string) => setOpenId((cur) => (cur === id ? null : id)),
    close: () => setOpenId(null),
  };
}
