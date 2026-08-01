import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('FakeCoding design-system contract', () => {
  it('keeps shared actions compact, grayscale, and free of press-scale feedback', () => {
    const button = source('src/components/ui/button.tsx');
    const tabs = source('src/components/ui/tabs.tsx');

    expect(button).toContain("default: 'bg-foreground text-background");
    expect(button).toContain("default: 'h-8 px-3'");
    expect(button).toContain("lg: 'h-9 px-4 text-sm'");
    expect(button).not.toContain('bg-primary text-primary-foreground');
    expect(button).not.toContain('active:scale');
    expect(tabs).not.toContain('active:scale');
  });

  it('uses neutral light and dark work-surface tokens without a decorative main gradient', () => {
    const globals = source('src/styles/globals.css');

    expect(globals).toContain("--material-canvas: 0 0% 100%");
    expect(globals).toContain("--material-canvas: 0 0% 9.4%");
    expect(globals).toContain("--primary: 210 9% 11%");
    expect(globals).toContain("--primary: 0 0% 100%");
    expect(globals).toContain('background: hsl(var(--material-canvas));');
    expect(globals).not.toContain('radial-gradient(circle at 80% -10%');
  });

  it('defaults the shared page shell to a 28px sans heading with zero letter spacing', () => {
    const pageShell = source('src/components/ui/page-shell.tsx');

    expect(pageShell).toContain('text-[28px] font-normal leading-[34px] tracking-normal');
    expect(pageShell).not.toContain('tracking-[-0.02em]');
  });

  it('keeps shared badges and switches compact and grayscale by default', () => {
    const badge = source('src/components/ui/badge.tsx');
    const toggle = source('src/components/ui/switch.tsx');

    expect(badge).toContain('inline-flex h-5 items-center rounded-md');
    expect(badge).toContain('text-[11px] font-medium');
    expect(badge).toContain('bg-black/5 text-foreground dark:bg-white/10');
    expect(badge).not.toContain('bg-primary');
    expect(toggle).toContain('h-5 w-8');
    expect(toggle).toContain('data-[state=checked]:bg-foreground');
    expect(toggle).toContain('data-[state=checked]:translate-x-[13px]');
    expect(toggle).not.toContain('data-[state=checked]:bg-primary');
  });

  it('uses opaque compact work surfaces for cards, textareas, and sheets', () => {
    const card = source('src/components/ui/card.tsx');
    const textarea = source('src/components/ui/textarea.tsx');
    const sheet = source('src/components/ui/sheet.tsx');

    expect(card).toContain('rounded-lg border border-border bg-material-panel');
    expect(card).toContain('text-[15px] font-medium leading-5 tracking-normal');
    expect(card).not.toContain('backdrop-blur');
    expect(card).not.toContain('tracking-[-');
    expect(textarea).toContain('rounded-lg border border-input bg-surface-input');
    expect(textarea).toContain('text-[13px] leading-5');
    expect(textarea).toContain('duration-150');
    expect(sheet).toContain('bg-black/24 duration-150');
    expect(sheet).toContain('bg-surface-modal p-5 shadow-xl');
    expect(sheet).toContain('duration-180');
    expect(sheet).not.toContain('backdrop-blur');
  });

  it('limits shared overlay and shell motion to short opacity or necessary movement', () => {
    const globals = source('src/styles/globals.css');
    const drawer = source('src/components/ui/apple-drawer.tsx');
    const sidebar = source('src/components/layout/Sidebar.tsx');
    const tooltip = source('src/components/ui/tooltip.tsx');

    expect(globals).toContain('verse-claw-dialog-content-in 150ms');
    expect(globals).toContain('translate(-50%, calc(-50% + 4px))');
    expect(globals).not.toContain('translate(-50%, -50%) scale');
    expect(globals).toContain('@apply transition-colors duration-150');
    expect(drawer).toContain('reduceMotion ? 100 : 180');
    expect(sidebar).toContain("transition-[width] duration-180 ease-out");
    expect(tooltip).toContain('shadow-md duration-150');
  });

  it('keeps the fixed sidebar to three business links plus the New task command', () => {
    const sidebar = source('src/components/layout/Sidebar.tsx');
    const coreNavigation = sidebar.match(/const coreNavItems = \[([\s\S]*?)\n {2}\];/)?.[1] ?? '';

    expect(coreNavigation.match(/\bto:/g)).toHaveLength(3);
    expect(coreNavigation).toContain("to: '/inbox'");
    expect(coreNavigation).toContain("to: '/cron'");
    expect(coreNavigation).toContain("to: '/knowledge'");
    expect(coreNavigation).not.toContain("to: '/browser'");
    expect(coreNavigation).not.toContain("to: '/code-review'");
    expect(sidebar).toContain('<PenLine className="h-4 w-4"');
    expect(sidebar).toContain('<CodexInbox className="h-4 w-4"');
  });
});
