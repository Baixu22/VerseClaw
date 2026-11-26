/**
 * Adapted from Rare UI Theme Selector. Copyright (c) 2026 Swami Malode.
 * MIT + Commons Clause + Attribution; see LICENSE in this directory.
 *
 * Source: https://rareui.com/components/themeselector
 *
 * DEVIATIONS from the registry source:
 *   1. Palette. The source ships one hardcoded palette per theme option. Here
 *      each preview declares its own `--ts-*` colours in
 *      `rareui-interactions.css`, so the light card stays light while the app
 *      is dark (and vice versa) — the light miniature must depict Light, not
 *      inherit the current shell.
 *   2. Geometry. Sizing uses container query units and the same 4:3 card,
 *      top-left app-corner crop, hover ring and selected ring are preserved.
 *      The container is declared in CSS because this repo does not install
 *      `@tailwindcss/container-queries`, so a bare `@container` utility would
 *      silently fall back to viewport units.
 *   3. Options gain a `split` preview: System renders the light and dark
 *      miniatures cut on a diagonal instead of a single third palette.
 *   4. Accessibility/locale. Group and option labels are passed in by the
 *      caller so they go through react-i18next like every other surface.
 *   5. The arbitrary `#FC4C01` focus accent is replaced with the shared
 *      `--color-border-focus` ring, and motion reduction comes from the media
 *      query in `rareui-interactions.css`.
 *   6. The uncontrolled state stays mounted-safe when `options` is empty.
 */
import {
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
} from 'react';
import { cn } from '@/lib/utils';

export type ThemeSelectorPreview = 'light' | 'dark' | 'split';

export type ThemeSelectorOption = {
  value: string;
  label: string;
  /**
   * Which miniature to draw. `split` shows the light and dark previews cut
   * diagonally, which is how a "follow the system" choice reads at this size.
   */
  preview?: ThemeSelectorPreview;
};

const STEPS = new Map([
  ['ArrowRight', 1],
  ['ArrowDown', 1],
  ['ArrowLeft', -1],
  ['ArrowUp', -1],
]);

const ring =
  'rare-theme-selector__ring pointer-events-none absolute -inset-[3.5px] rounded-[15.5px] border-[1.5px] transition-opacity duration-150 sm:rounded-[19.5px]';

function Preview() {
  return (
    <span aria-hidden data-slot="theme-selector-preview" className="rare-theme-selector__preview">
      <span className="rare-theme-selector__sidebar">
        <span className="rare-theme-selector__dots">
          {[0, 1, 2].map((dot) => (
            <span key={dot} className="rare-theme-selector__dot" />
          ))}
        </span>
        <span className="rare-theme-selector__nav">
          <span className="rare-theme-selector__nav-row rare-theme-selector__nav-row--active">
            <span className="rare-theme-selector__bar rare-theme-selector__bar--strong" />
          </span>
          <span className="rare-theme-selector__nav-row">
            <span className="rare-theme-selector__bar" />
          </span>
          <span className="rare-theme-selector__nav-row">
            <span className="rare-theme-selector__bar" />
          </span>
        </span>
        <span className="rare-theme-selector__account">
          <span className="rare-theme-selector__avatar" />
          <span className="rare-theme-selector__bar" />
        </span>
      </span>
      <span className="rare-theme-selector__panel">
        <span className="rare-theme-selector__heading">
          <span className="rare-theme-selector__bar rare-theme-selector__bar--strong" />
          <span className="rare-theme-selector__bar" />
        </span>
        <span className="rare-theme-selector__rows">
          {[0, 1, 2].map((row) => (
            <span key={row} className="rare-theme-selector__row">
              <span className="rare-theme-selector__bar" />
              <span className="rare-theme-selector__control" />
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}

export type ThemeSelectorProps = Omit<
  ComponentProps<'div'>,
  'defaultValue' | 'onChange'
> & {
  options: ThemeSelectorOption[];
  value?: string | null;
  defaultValue?: string;
  onChange?: (value: string) => void;
  labels?: boolean;
  disabled?: boolean;
  itemClassName?: string;
};

export function ThemeSelector({
  options,
  value,
  defaultValue,
  onChange,
  labels = true,
  disabled,
  className,
  itemClassName,
  ...props
}: ThemeSelectorProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultValue ?? options[0]?.value);
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  // null keeps it controlled with nothing picked, like before the theme is
  // known on the client.
  const selected = value === undefined ? uncontrolled : value;
  const selectedIndex = options.findIndex((option) => option.value === selected);

  const select = (next: string) => {
    if (next === selected) return;
    if (value === undefined) setUncontrolled(next);
    onChange?.(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = STEPS.get(event.key);
    let target: number;
    if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = options.length - 1;
    else if (step) target = (index + step + options.length) % options.length;
    else return;
    event.preventDefault();
    if (!options[target]) return;
    items.current[target]?.focus();
    select(options[target].value);
  };

  return (
    <div
      role="radiogroup"
      aria-disabled={disabled || undefined}
      data-slot="theme-selector"
      {...props}
      className={cn(
        'flex min-w-0 flex-wrap gap-4',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      {options.map((option, index) => {
        const active = option.value === selected;

        return (
          <div
            key={option.value}
            data-slot="theme-selector-option"
            className="flex min-w-0 flex-col items-center gap-2"
          >
            <button
              ref={(element) => {
                items.current[index] = element;
              }}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={option.label}
              // with no match, the first item stays reachable by tab
              tabIndex={(selectedIndex === -1 ? index === 0 : active) ? 0 : -1}
              disabled={disabled}
              data-slot="theme-selector-item"
              data-state={active ? 'checked' : 'unchecked'}
              onClick={() => select(option.value)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                'rare-theme-selector__item group relative aspect-[4/3] w-[136px] max-w-full cursor-pointer outline-none',
                itemClassName,
              )}
            >
              <span
                className="rare-theme-selector__stage absolute inset-0 overflow-hidden rounded-xl sm:rounded-2xl"
                data-preview={option.preview ?? 'light'}
              >
                {option.preview === 'split' ? (
                  <span aria-hidden data-slot="theme-selector-split" className="rare-theme-selector__split">
                    <span className="rare-theme-selector__pane rare-theme-selector__pane--light">
                      <Preview />
                    </span>
                    <span className="rare-theme-selector__pane rare-theme-selector__pane--dark">
                      <Preview />
                    </span>
                  </span>
                ) : (
                  <span className="rare-theme-selector__pane">
                    <Preview />
                  </span>
                )}
              </span>
              <span
                className={cn(
                  ring,
                  'border-black/10 opacity-0 dark:border-white/15',
                  !active && 'group-hover:opacity-100',
                )}
              />
              <span
                data-slot="theme-selector-ring"
                className={cn(
                  ring,
                  'border-black/35 dark:border-white/40',
                  active ? 'opacity-100' : 'opacity-0',
                )}
              />
              <span
                data-slot="theme-selector-focus"
                className="rare-theme-selector__focus pointer-events-none absolute -inset-[7px] rounded-[19px] border-[1.5px] sm:rounded-[23px]"
              />
            </button>
            {labels && (
              <span
                aria-hidden
                data-slot="theme-selector-label"
                className={cn(
                  'rare-theme-selector__label text-xs font-medium transition-colors duration-150',
                  active ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {option.label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default ThemeSelector;
