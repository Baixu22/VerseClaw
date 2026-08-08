/**
 * SetupActionButton — the first-run wizard's navigation buttons.
 *
 * Wraps shadcn's Button rather than modifying it: src/components/ui/button.tsx
 * is shared by the whole app, and this treatment is deliberately scoped to the
 * one surface the user sees first.
 *
 * The label is rendered twice. At rest the duplicate waits one line below;
 * hovering rolls the original up and the duplicate into its place, on the
 * reference's expo curve. The duplicate is aria-hidden so the accessible name
 * stays "Next" and not "NextNext".
 *
 * The testid and all geometry stay on the Button element itself. Nothing here
 * animates the button's own box, which matters: Playwright requires two
 * consecutive stable bounding boxes before it will click, and a button that
 * breathes on hover would make every click in the setup E2E suite racy.
 */
import type { ReactNode } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface SetupActionButtonProps extends Omit<ButtonProps, 'children'> {
  /** Visible text. Rendered twice — plain string, so the duplicate matches. */
  label: string;
  /** Rendered before the label, outside the rolling slot (e.g. a back chevron). */
  iconBefore?: ReactNode;
  /** Rendered after the label, outside the rolling slot. */
  iconAfter?: ReactNode;
  /**
   * Add the dashed→solid frame. Only meaningful on transparent variants: on a
   * filled button the ring lands on the fill and reads as an artefact.
   */
  frame?: boolean;
}

export function SetupActionButton({
  label,
  iconBefore,
  iconAfter,
  frame = false,
  className,
  ...props
}: SetupActionButtonProps) {
  return (
    <Button className={cn('setup-btn', frame && 'setup-frame', className)} {...props}>
      {iconBefore}
      <span className="setup-btn__text">
        <span className="setup-btn__text-inner">
          <span className="setup-btn__text-layer setup-btn__text-layer--static">{label}</span>
          <span className="setup-btn__text-layer setup-btn__text-layer--hover" aria-hidden="true">
            {label}
          </span>
        </span>
      </span>
      {iconAfter}
    </Button>
  );
}
