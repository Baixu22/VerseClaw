/**
 * Full-screen boot splash shown while the renderer is still starting.
 *
 * Timing: the "verse" color sweep starts immediately when this mounts (which
 * happens right after the React shell commits, ~100ms after page load). The
 * splash then stays until BootShellHandoff starts fading out the static boot
 * shell — it listens for the `verse:boot-leaving` event and fades out on the
 * same 160ms schedule, so the handoff is seamless. A hard cap keeps the
 * splash from hanging around forever if the handoff never fires.
 */
import { useEffect, useRef, useState } from 'react';
import { DiaTextReveal } from '@/components/magicui/dia-text-reveal';
import { cn } from '@/lib/utils';

const BOOT_SHELL_TRANSITION_MS = 160;
const MAX_SPLASH_HOLD_MS = 6_000;

export function VerseBootSplash() {
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const leaveTimerRef = useRef(0);

  useEffect(() => {
    const onLeaving = () => {
      setLeaving(true);
      leaveTimerRef.current = window.setTimeout(() => setGone(true), BOOT_SHELL_TRANSITION_MS);
    };

    window.addEventListener('verse:boot-leaving', onLeaving);

    // Hard cap so the splash can never block the UI.
    const capTimer = window.setTimeout(onLeaving, MAX_SPLASH_HOLD_MS);

    return () => {
      window.removeEventListener('verse:boot-leaving', onLeaving);
      window.clearTimeout(capTimer);
      window.clearTimeout(leaveTimerRef.current);
    };
  }, []);

  if (gone) return null;

  return (
    <div
      data-testid="boot-splash"
      data-state={leaving ? 'leaving' : 'visible'}
      aria-hidden="true"
      className={cn(
        'fixed inset-0 z-[2147483646] flex items-center justify-center',
        'bg-background transition-opacity duration-150 ease-out',
        leaving && 'pointer-events-none opacity-0',
      )}
    >
      <DiaTextReveal
        text="verse"
        duration={1.5}
        startOnView={false}
        once
        className="text-5xl font-semibold tracking-tight sm:text-6xl"
      />
    </div>
  );
}
