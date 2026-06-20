// Shared role-first visual mapping: role name / effort / span kind → tone color.
//
// Used by both the RolesOrchestrationPanel (surface 1) and the Observability
// TraceWaterfall (surface 2) so role/orchestration visuals stay consistent.
//
// All tones follow the project design convention (globals.css substitution
// table): `bg-*-500/10 text-*-700 dark:text-*-400` for tints, plain
// `text-*-700 dark:text-*-400` for inline text. Surfaces stay on the
// surface-modal / surface-input tokens.

import type { ObservabilitySpanKind } from '@shared/types/observability';

/** Visual tone name mapped to a Tailwind color family. */
export type RoleTone = 'violet' | 'blue' | 'emerald' | 'amber' | 'red' | 'rose' | 'sky' | 'cyan' | 'zinc' | 'muted';

/**
 * Map a role name to a stable tone. Builtin roles get a fixed semantic tone;
 * unknown/config-defined roles fall back to a hash-derived deterministic tone
 * so the same role always renders the same color.
 */
export function roleTone(roleName: string | undefined | null): RoleTone {
  if (!roleName) return 'muted';
  const builtin: Record<string, RoleTone> = {
    planner: 'blue',
    architect: 'sky',
    implementer: 'emerald',
    tester: 'amber',
    reviewer: 'violet',
    'security-reviewer': 'red',
    'docs-writer': 'cyan',
    skeptic: 'rose',
  };
  if (builtin[roleName]) return builtin[roleName];
  // Deterministic hash → pick from the palette so config roles are stable.
  let hash = 0;
  for (let i = 0; i < roleName.length; i += 1) {
    hash = (hash * 31 + roleName.charCodeAt(i)) >>> 0;
  }
  const palette: RoleTone[] = ['blue', 'emerald', 'amber', 'violet', 'cyan', 'sky'];
  return palette[hash % palette.length];
}

/**
 * Map an effort level to a tone. Higher effort = warmer/more intense.
 */
export function effortTone(effort: string | undefined | null): RoleTone {
  switch (effort) {
    case 'xhigh':
      return 'violet';
    case 'high':
      return 'blue';
    case 'medium':
      return 'emerald';
    default:
      return 'muted';
  }
}

/**
 * Map a span kind to a tone for the trace waterfall.
 */
export function spanKindTone(kind: ObservabilitySpanKind | undefined | null): RoleTone {
  switch (kind) {
    case 'orchestrator':
      return 'violet';
    case 'role-router':
      return 'blue';
    case 'subagent':
      return 'emerald';
    case 'verifier':
      return 'amber';
    case 'model':
      return 'sky';
    case 'tool':
      return 'zinc';
    case 'memory':
      return 'cyan';
    case 'context-pack':
      return 'cyan';
    case 'gatekeeper':
      return 'red';
    case 'team':
      return 'violet';
    case 'input-mode':
      return 'amber';
    default:
      return 'muted';
  }
}

/**
 * Resolve a tone name to concrete Tailwind class fragments, following the
 * project status-color convention: `*-700 dark:*-400` for text,
 * `*-500/10 border-*-500/20` for tinted panels, `*-500/30 border-*-500/50`
 * for stronger bars (waterfall).
 */
export function toneClasses(tone: RoleTone): {
  /** Inline text color. */
  text: string;
  /** Tinted panel background + text + border (for cards/badges). */
  tint: string;
  /** Stronger bar fill + border (for waterfall span bars). */
  bar: string;
  /** Solid dot fill. */
  dot: string;
} {
  // muted + zinc share the neutral palette to avoid raw gray-* classes.
  const neutral = {
    text: 'text-muted-foreground',
    tint: 'bg-black/5 dark:bg-white/5 text-foreground border-transparent',
    bar: 'bg-muted-foreground/30 border-muted-foreground/50',
    dot: 'bg-muted-foreground',
  };
  const map: Record<Exclude<RoleTone, 'muted' | 'zinc'>, { text: string; tint: string; bar: string; dot: string }> = {
    violet: {
      text: 'text-violet-700 dark:text-violet-400',
      tint: 'bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20',
      bar: 'bg-violet-500/30 border-violet-500/50',
      dot: 'bg-violet-500',
    },
    blue: {
      text: 'text-blue-700 dark:text-blue-400',
      tint: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
      bar: 'bg-blue-500/30 border-blue-500/50',
      dot: 'bg-blue-500',
    },
    emerald: {
      text: 'text-emerald-700 dark:text-emerald-400',
      tint: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
      bar: 'bg-emerald-500/30 border-emerald-500/50',
      dot: 'bg-emerald-500',
    },
    amber: {
      text: 'text-amber-700 dark:text-amber-400',
      tint: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
      bar: 'bg-amber-500/30 border-amber-500/50',
      dot: 'bg-amber-500',
    },
    red: {
      text: 'text-red-700 dark:text-red-400',
      tint: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
      bar: 'bg-red-500/30 border-red-500/50',
      dot: 'bg-red-500',
    },
    rose: {
      text: 'text-rose-700 dark:text-rose-400',
      tint: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20',
      bar: 'bg-rose-500/30 border-rose-500/50',
      dot: 'bg-rose-500',
    },
    sky: {
      text: 'text-sky-700 dark:text-sky-400',
      tint: 'bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20',
      bar: 'bg-sky-500/30 border-sky-500/50',
      dot: 'bg-sky-500',
    },
    cyan: {
      text: 'text-cyan-700 dark:text-cyan-400',
      tint: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-500/20',
      bar: 'bg-cyan-500/30 border-cyan-500/50',
      dot: 'bg-cyan-500',
    },
  };
  if (tone === 'muted' || tone === 'zinc') return neutral;
  return map[tone];
}
