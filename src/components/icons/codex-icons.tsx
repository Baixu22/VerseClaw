/*
 * codex-icons.tsx — conversation-area icons ported from the FakeCoding reference app.
 *
 * PROVENANCE. Every path below is copied verbatim from
 *   C:\Users\27933\Desktop\FakeCoding-main\codex-icons\<name>.svg
 * which is the 189-icon system set extracted from the Codex Electron bundle
 * (24x24 viewBox, stroke-width 2, round caps/joins — a pinned Lucide vintage).
 *
 * WHY THIS FILE EXISTS. 125 of those 189 SVGs are byte-identical to the
 * lucide-react version this repo ships (0.563). Re-exporting those would be
 * pure noise for generic controls, so geometry-different icons plus the small
 * product-navigation set used by Verse Claw live here. Navigation icons stay
 * pinned even when they currently match Lucide, preventing future drift.
 * Concretely, the geometry differences include:
 *
 *   file / file-text     corner fold is a hard 45° cut at x=15; Lucide 0.563
 *                        rounds it with a 2.4-radius arc and moves the flap.
 *   laptop               single-path lid + wedge base; Lucide splits it into a
 *                        lid path plus a separate 20.054/3.946 baseline.
 *   list-checks          rows sit at y=6/12/18; Lucide uses 5/12/19.
 *   message-square       tail is a hard `l-4 4` corner; Lucide rounds it into a
 *                        2-unit arc and widens the balloon to x=22.
 *   search               handle is `m21 21-4.3-4.3`; Lucide lengthened it to 4.34.
 *   sliders-horizontal   nine <line> elements; Lucide reshaped them into paths.
 *   sparkles             4-point star + two tick marks; Lucide swapped the
 *                        lower-left ticks for a filled circle.
 *   users                back figure arc starts at 3.13; Lucide uses 3.128.
 *
 * Those deltas are small in isolation and very visible side by side at 14-16px,
 * which is the whole point of the alignment pass.
 *
 * The component contract is deliberately lucide-react's: a forwarded-ref SVG
 * taking `size`, `strokeWidth`, `absoluteStrokeWidth` and `className`, defaulting
 * to 24 / 2, so these are drop-in replacements at every call site and existing
 * `h-4 w-4` utilities keep winning over the width/height attributes.
 */
import { forwardRef, type SVGProps } from 'react';

export interface CodexIconProps extends SVGProps<SVGSVGElement> {
  size?: number | string;
  absoluteStrokeWidth?: boolean;
}

type IconNode = Array<[string, Record<string, string>]>;

function createCodexIcon(iconName: string, nodes: IconNode) {
  const Component = forwardRef<SVGSVGElement, CodexIconProps>(function CodexIcon(
    { size = 24, strokeWidth = 2, absoluteStrokeWidth, className, children, ...rest },
    ref,
  ) {
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={
          absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth
        }
        strokeLinecap="round"
        strokeLinejoin="round"
        className={['lucide', `lucide-${iconName}`, className].filter(Boolean).join(' ')}
        aria-hidden="true"
        {...rest}
      >
        {nodes.map(([Tag, attrs], index) => {
          const Element = Tag as 'path';
          return <Element key={`${iconName}-${index}`} {...attrs} />;
        })}
        {children}
      </svg>
    );
  });
  Component.displayName = iconName;
  return Component;
}

// codex-icons/pen-line.svg
export const PenLine = createCodexIcon('pen-line', [
  ['path', { d: 'M12 20h9' }],
  ['path', { d: 'M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z' }],
]);

// codex-icons/inbox.svg
export const Inbox = createCodexIcon('inbox', [
  ['polyline', { points: '22 12 16 12 14 15 10 15 8 12 2 12' }],
  ['path', { d: 'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z' }],
]);

// codex-icons/calendar-days.svg
export const CalendarDays = createCodexIcon('calendar-days', [
  ['path', { d: 'M8 2v4' }],
  ['path', { d: 'M16 2v4' }],
  ['rect', { width: '18', height: '18', x: '3', y: '4', rx: '2' }],
  ['path', { d: 'M3 10h18' }],
  ['path', { d: 'M8 14h.01' }],
  ['path', { d: 'M12 14h.01' }],
  ['path', { d: 'M16 14h.01' }],
  ['path', { d: 'M8 18h.01' }],
  ['path', { d: 'M12 18h.01' }],
  ['path', { d: 'M16 18h.01' }],
]);

// codex-icons/settings.svg
export const Settings = createCodexIcon('settings', [
  ['path', { d: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z' }],
  ['circle', { cx: '12', cy: '12', r: '3' }],
]);

// codex-icons/file.svg
export const File = createCodexIcon('file', [
  ['path', { d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' }],
  ['path', { d: 'M14 2v4a2 2 0 0 0 2 2h4' }],
]);

// codex-icons/file-text.svg
export const FileText = createCodexIcon('file-text', [
  ['path', { d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' }],
  ['path', { d: 'M14 2v4a2 2 0 0 0 2 2h4' }],
  ['path', { d: 'M10 9H8' }],
  ['path', { d: 'M16 13H8' }],
  ['path', { d: 'M16 17H8' }],
]);

// codex-icons/laptop.svg
export const Laptop = createCodexIcon('laptop', [
  [
    'path',
    {
      d: 'M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16',
    },
  ],
]);

// codex-icons/list-checks.svg
export const ListChecks = createCodexIcon('list-checks', [
  ['path', { d: 'm3 17 2 2 4-4' }],
  ['path', { d: 'm3 7 2 2 4-4' }],
  ['path', { d: 'M13 6h8' }],
  ['path', { d: 'M13 12h8' }],
  ['path', { d: 'M13 18h8' }],
]);

// codex-icons/message-square.svg
export const MessageSquare = createCodexIcon('message-square', [
  ['path', { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' }],
]);

// codex-icons/search.svg
export const Search = createCodexIcon('search', [
  ['circle', { cx: '11', cy: '11', r: '8' }],
  ['path', { d: 'm21 21-4.3-4.3' }],
]);

// codex-icons/sliders-horizontal.svg
export const SlidersHorizontal = createCodexIcon('sliders-horizontal', [
  ['line', { x1: '21', x2: '14', y1: '4', y2: '4' }],
  ['line', { x1: '10', x2: '3', y1: '4', y2: '4' }],
  ['line', { x1: '21', x2: '12', y1: '12', y2: '12' }],
  ['line', { x1: '8', x2: '3', y1: '12', y2: '12' }],
  ['line', { x1: '21', x2: '16', y1: '20', y2: '20' }],
  ['line', { x1: '12', x2: '3', y1: '20', y2: '20' }],
  ['line', { x1: '14', x2: '14', y1: '2', y2: '6' }],
  ['line', { x1: '8', x2: '8', y1: '10', y2: '14' }],
  ['line', { x1: '16', x2: '16', y1: '18', y2: '22' }],
]);

// codex-icons/sparkles.svg
export const Sparkles = createCodexIcon('sparkles', [
  [
    'path',
    {
      d: 'M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z',
    },
  ],
  ['path', { d: 'M20 3v4' }],
  ['path', { d: 'M22 5h-4' }],
  ['path', { d: 'M4 17v2' }],
  ['path', { d: 'M5 18H3' }],
]);

// codex-icons/users.svg
export const Users = createCodexIcon('users', [
  ['path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }],
  ['circle', { cx: '9', cy: '7', r: '4' }],
  ['path', { d: 'M22 21v-2a4 4 0 0 0-3-3.87' }],
  ['path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' }],
]);

// Product controls ported verbatim from FakeCoding-main/codex-icons.
export const Terminal = createCodexIcon('terminal', [
  ['polyline', { points: '4 17 10 11 4 5' }],
  ['line', { x1: '12', x2: '20', y1: '19', y2: '19' }],
]);

export const Globe = createCodexIcon('globe', [
  ['circle', { cx: '12', cy: '12', r: '10' }],
  ['path', { d: 'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20' }],
  ['path', { d: 'M2 12h20' }],
]);

export const Folder = createCodexIcon('folder', [
  ['path', { d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z' }],
]);

export const GitBranch = createCodexIcon('git-branch', [
  ['line', { x1: '6', x2: '6', y1: '3', y2: '15' }],
  ['circle', { cx: '18', cy: '6', r: '3' }],
  ['circle', { cx: '6', cy: '18', r: '3' }],
  ['path', { d: 'M18 9a9 9 0 0 1-9 9' }],
]);

export const PanelBottom = createCodexIcon('panel-bottom', [
  ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2' }],
  ['path', { d: 'M3 15h18' }],
]);

export const PanelRight = createCodexIcon('panel-right', [
  ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2' }],
  ['path', { d: 'M15 3v18' }],
]);

export const PanelRightOpen = createCodexIcon('panel-right-open', [
  ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2' }],
  ['path', { d: 'M15 3v18' }],
  ['path', { d: 'm10 15-3-3 3-3' }],
]);

export const Expand = createCodexIcon('expand', [
  ['path', { d: 'm21 21-6-6m6 6v-4.8m0 4.8h-4.8' }],
  ['path', { d: 'M3 16.2V21m0 0h4.8M3 21l6-6' }],
  ['path', { d: 'M21 7.8V3m0 0h-4.8M21 3l-6 6' }],
  ['path', { d: 'M3 7.8V3m0 0h4.8M3 3l6 6' }],
]);

export const ArrowLeft = createCodexIcon('arrow-left', [
  ['path', { d: 'm12 19-7-7 7-7' }],
  ['path', { d: 'M19 12H5' }],
]);

export const ArrowRight = createCodexIcon('arrow-right', [
  ['path', { d: 'M5 12h14' }],
  ['path', { d: 'm12 5 7 7-7 7' }],
]);

export const Camera = createCodexIcon('camera', [
  ['path', { d: 'M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z' }],
  ['circle', { cx: '12', cy: '13', r: '3' }],
]);

export const ExternalLink = createCodexIcon('external-link', [
  ['path', { d: 'M15 3h6v6' }],
  ['path', { d: 'M10 14 21 3' }],
  ['path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }],
]);

export const RefreshCw = createCodexIcon('refresh-cw', [
  ['path', { d: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8' }],
  ['path', { d: 'M21 3v5h-5' }],
  ['path', { d: 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16' }],
  ['path', { d: 'M8 16H3v5' }],
]);

export const Plus = createCodexIcon('plus', [
  ['path', { d: 'M5 12h14' }],
  ['path', { d: 'M12 5v14' }],
]);

export const Ellipsis = createCodexIcon('ellipsis', [
  ['circle', { cx: '12', cy: '12', r: '1' }],
  ['circle', { cx: '19', cy: '12', r: '1' }],
  ['circle', { cx: '5', cy: '12', r: '1' }],
]);

// codex-icons/x.svg
export const X = createCodexIcon('x', [
  ['path', { d: 'M18 6 6 18' }],
  ['path', { d: 'm6 6 12 12' }],
]);

export const Eye = createCodexIcon('eye', [
  ['path', { d: 'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0' }],
  ['circle', { cx: '12', cy: '12', r: '3' }],
]);

export const Monitor = createCodexIcon('monitor', [
  ['rect', { width: '20', height: '14', x: '2', y: '3', rx: '2' }],
  ['line', { x1: '8', x2: '16', y1: '21', y2: '21' }],
  ['line', { x1: '12', x2: '12', y1: '17', y2: '21' }],
]);

// Permission-mode icons ported from FakeCoding-main/web/src/components/Icon.tsx
// (handmadeIconPaths). These are the four glyphs used by Codex's approval menu
// on the composer; ClawX maps them onto its own WorkspacePermissionMode set:
//   readOnly    -> hand         (Codex `suggest` — "always ask")
//   plan        -> lightbulb    (no Codex equivalent; placeholder after suggest)
//   acceptEdits -> shield-check (Codex `auto` — ShieldCheck from lucide-react)
//   fullAccess  -> shield-alert (Codex `full`  — warning variant)
// ShieldCheck is re-exported from lucide-react at the call site, so only the
// three handmade paths live here.

// codex-icons/hand.svg — "request approval" raised hand
export const Hand = createCodexIcon('hand', [
  ['path', { d: 'M7.7 11.4V6.8a1.25 1.25 0 0 1 2.5 0v3.1-4.3a1.25 1.25 0 0 1 2.5 0v4.1-3.3a1.25 1.25 0 0 1 2.5 0v4.1-2.3a1.25 1.25 0 0 1 2.5 0v5.3c0 4.1-2.5 6.7-6.3 6.7-2.4 0-4.1-1.1-5.4-3l-1.8-2.7a1.35 1.35 0 0 1 2.1-1.7l1.4 1.4' }],
]);

// codex-icons/lightbulb.svg — plan-mode placeholder
export const Lightbulb = createCodexIcon('lightbulb', [
  ['path', { d: 'M8.6 17h6.8M9.4 20h5.2' }],
  ['path', { d: 'M8.1 14.5c-1.2-1-2-2.5-2-4.2a5.9 5.9 0 0 1 11.8 0c0 1.7-.8 3.2-2 4.2-.8.7-1.2 1.3-1.3 2.5H9.4c-.1-1.2-.5-1.8-1.3-2.5Z' }],
]);

// codex-icons/shield-alert.svg — full-access warning
export const ShieldAlert = createCodexIcon('shield-alert', [
  ['path', { d: 'M12 3.2 19 6v5.1c0 4.5-2.6 7.8-7 9.7-4.4-1.9-7-5.2-7-9.7V6l7-2.8Z' }],
  ['path', { d: 'M12 8v5M12 16.2h.01' }],
]);
