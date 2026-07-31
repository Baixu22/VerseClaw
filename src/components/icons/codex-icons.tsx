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
 * pure noise, so only the icons whose *geometry actually differs* live here —
 * Lucide redrew them after the vintage Codex pinned. Concretely:
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
