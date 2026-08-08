/** @type {import('tailwindcss').Config} */

/* ──────────────────────────────────────────────────────────────────────────
 * ClawX Tailwind design tokens
 * ──────────────────────────────────────────────────────────────────────────
 *
 * This config layers ClawX's own visual language on top of shadcn/ui:
 *
 *   1. fontFamily — All three stacks (sans / serif / mono) are pinned
 *      explicitly so we never silently inherit Tailwind's evolving defaults.
 *      This locks the rendering on macOS, Windows, and Linux to the same
 *      glyph sources we ship to designers.
 *
 *   2. fontSize — We only *add* missing rungs to Tailwind's default scale.
 *      All new tokens come from the orphan pixel values (10/11/13/17/40px)
 *      that occurred most often in the codebase. Naming is semantic
 *      (`meta`, `tiny`, `subtitle`, `2xs`, `stat`) so a future density
 *      change only touches this file.
 *
 *   3. colors — On top of shadcn's semantic tokens (primary / destructive /
 *      ...) we add three ClawX-private groups:
 *        - brand        : Apple-system blue used for primary CTAs
 *        - skill        : highlight blue for inline /skill chips in chat
 *        - surface.{modal,input,sidebar}: a 3-layer cream-paper background
 *                          system in light mode. In dark mode each layer
 *                          collapses to an existing shadcn token through
 *                          CSS variables, so callers don't need to write
 *                          `dark:bg-card` style double-declarations.
 *
 *   4. Naming — All ClawX-private tokens live under their own top-level
 *      key (`brand`, `skill`, `surface`) instead of being merged into
 *      the root `colors` namespace, so they're trivially distinguishable
 *      from shadcn semantic tokens.
 *
 * Usage references:
 *     - Sizes        : see fontSize block below
 *     - Colors       : see colors block below
 *     - CSS variables: src/styles/globals.css
 *
 * ────────────────────────────────────────────────────────────────────────── */

module.exports = {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      /* ──────────────────────────────────────────────────────────────
       * fontFamily
       * ──────────────────────────────────────────────────────────────
       *
       * All three stacks are pinned explicitly to remove dependency on
       * Tailwind's default fontFamily values. The intent:
       *
       *   - sans  : the everyday UI body / control font. Apple-first
       *             on macOS (-apple-system), then BlinkMacSystemFont
       *             so Chromium on macOS picks the same metrics, then
       *             Segoe UI for Windows, Roboto for Linux/Android,
       *             and finally the four Apple/Segoe/Noto color emoji
       *             fonts so emoji never fall back to a serif.
       *
       *   - serif : Georgia-first display stack used by all page H1/H2.
       *             Previously written as inline `style={{ fontFamily }}`
       *             in 17 places — that's been collapsed to this token,
       *             so `font-serif` alone now reproduces the original
       *             rendering exactly. (NOTE: deliberately omits
       *             `ui-serif` — on macOS that resolves to "New York"
       *             which we explicitly do not want.)
       *
       *   - mono  : standard developer-font stack. Used for IDs, paths,
       *             tokens, timestamps, code blocks, CLI output etc.
       *             We pin this so behaviour is identical to Tailwind's
       *             current default but immune to upstream changes.
       * ────────────────────────────────────────────────────────────── */
      fontFamily: {
        sans: [
          '"Segoe UI Variable Text"',
          '"Segoe UI Variable"',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          '"Noto Sans"',
          'sans-serif',
          '"Apple Color Emoji"',
          '"Segoe UI Emoji"',
          '"Segoe UI Symbol"',
          '"Noto Color Emoji"',
        ],
        serif: [
          'Georgia',
          'Cambria',
          '"Times New Roman"',
          'Times',
          'serif',
        ],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          '"SF Mono"',
          'Menlo',
          'Monaco',
          'Consolas',
          '"Liberation Mono"',
          '"Courier New"',
          'monospace',
        ],
      },

      /* ──────────────────────────────────────────────────────────────
       * fontSize
       * ──────────────────────────────────────────────────────────────
       *
       * Naming is by visual *role*, not pixel count, so a future density
       * change only edits the values here. ClawX's full size ladder
       * (combining Tailwind defaults + ClawX additions, smallest first):
       *
       *   ┌──────────────┬──────────┬─────────────┬──────────────────────────────┐
       *   │ Token        │ FontSize │ LineHeight  │ Primary use                  │
       *   ├──────────────┼──────────┼─────────────┼──────────────────────────────┤
       *   │ 2xs   (new)  │ 10px     │ 14px        │ micro labels, chip suffixes  │
       *   │ tiny  (new)  │ 11px     │ 16px        │ ultra-small captions, tips   │
       *   │ xs    (TW)   │ 12px     │ 16px        │ secondary helpers, badges    │
       *   │ meta  (new)  │ 13px     │ 18px        │ form/button/modal description│
       *   │ sm    (TW)   │ 14px     │ 20px        │ body (Label / CardDescription│
       *   │ base  (TW)   │ 16px     │ 24px        │ rare; Textarea fallback only │
       *   │ subtitle(new)│ 17px     │ 24px        │ subtitle right under page H1 │
       *   │ lg    (TW)   │ 18px     │ 28px        │ Sheet / Confirm titles       │
       *   │ xl    (TW)   │ 20px     │ 28px        │ Setup steps, large emoji     │
       *   │ 2xl   (TW)   │ 24px     │ 32px        │ CardTitle                    │
       *   │ 3xl   (TW)   │ 30px     │ 36px        │ section H2 (serif)           │
       *   │ 4xl   (TW)   │ 36px     │ 40px        │ Chat empty-state H1          │
       *   │ stat  (new)  │ 40px     │ 1           │ dashboard hero numbers       │
       *   │ 5xl   (TW)   │ 48px     │ 1           │ page H1 (narrow viewport)    │
       *   │ 6xl   (TW)   │ 60px     │ 1           │ page H1 (md and up)          │
       *   └──────────────┴──────────┴─────────────┴──────────────────────────────┘
       *
       * Tailwind defaults marked (TW) are intentionally untouched so
       * shadcn components keep their original rendering.
       * ────────────────────────────────────────────────────────────── */
      fontSize: {
        '2xs':      ['10px', { lineHeight: '14px' }],
        tiny:       ['11px', { lineHeight: '16px' }],
        meta:       ['13px', { lineHeight: '18px' }],
        subtitle:   ['17px', { lineHeight: '24px' }],
        // Display-size token used only by the Cron dashboard hero counters.
        // line-height: 1 (unitless) keeps the number tightly aligned with
        // the icon next to it, which is why we don't reuse 4xl/5xl here.
        stat:       ['40px', { lineHeight: '1' }],
      },

      /* ──────────────────────────────────────────────────────────────
       * colors
       * ──────────────────────────────────────────────────────────────
       *
       * Three groups:
       *   A. shadcn standard semantic tokens — read via `hsl(var(--xxx))`
       *      from globals.css. Kept fully compatible.
       *   B. ClawX brand tokens (brand / skill) — plain hex values that
       *      do not change between light and dark themes.
       *   C. ClawX surface tokens (surface.{modal,input,sidebar}) — use
       *      `hsl(var(--surface-xxx) / <alpha-value>)` so the alpha
       *      modifier still works (e.g. `bg-surface-sidebar/60`). The
       *      actual values live in globals.css, where dark mode redirects
       *      each surface to an existing shadcn token (--card / --muted /
       *      --background) — that way callers don't double-declare a
       *      `dark:bg-card` etc. on every surface element.
       *
       * Examples:
       *   - bg-brand                → primary CTA
       *   - hover:bg-brand-hover    → CTA hover
       *   - bg-skill-bg/14          → skill-chip backdrop in chat input
       *   - text-skill-fg           → skill-chip text in light mode
       *   - dark:text-skill-fg-dark → skill-chip text in dark mode
       *   - bg-surface-modal        → large rounded modal panels
       *   - bg-surface-input        → input fields / code panes
       *   - bg-surface-sidebar/60   → translucent left rail
       * ────────────────────────────────────────────────────────────── */
      colors: {
        // ── A. shadcn semantic tokens (do NOT rename — Radix/shadcn
        //       components read these names directly) ──
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },

        // ── B. ClawX brand tokens ────────────────────────────────────
        // Apple-system blue used for primary CTAs. The same pixel value
        // works in both themes (sufficient WCAG-AA contrast in light
        // mode and stays vivid in dark mode), so no CSS variable needed.
        // Pair with `brand-hover` for the hover state.
        brand: {
          DEFAULT: '#0a84ff',
          hover: '#007aff',
        },

        // Highlight blue for inline /skill chips in the chat input.
        // The chip combines bg + text + text-shadow to produce a glow
        // effect, so we expose three separate tokens (bg, light fg,
        // dark fg) instead of a 50/100/.../900 ramp — this palette is
        // intentionally not extensible.
        skill: {
          bg: '#2F6BFF',          // chip backdrop (used at /14 or /18)
          fg: '#1D4ED8',          // chip text (light mode)
          'fg-dark': '#2563EB',   // chip text (dark mode)
        },

        // ── C. ClawX cream surfaces ──────────────────────────────────
        // We use `<alpha-value>` placeholders so Tailwind auto-emits
        // `bg-surface-xxx/{alpha}` rules. Concrete pixel values live in
        // globals.css; in dark mode the same CSS variables redirect to
        // shadcn's existing dark tokens to avoid maintaining a second
        // (dark) cream palette.
        surface: {
          modal: 'hsl(var(--surface-modal) / <alpha-value>)',
          input: 'hsl(var(--surface-input) / <alpha-value>)',
          sidebar: 'hsl(var(--surface-sidebar) / <alpha-value>)',
        },

        material: {
          canvas: 'hsl(var(--material-canvas) / <alpha-value>)',
          sidebar: 'hsl(var(--material-sidebar) / <alpha-value>)',
          panel: 'hsl(var(--material-panel) / <alpha-value>)',
          elevated: 'hsl(var(--material-elevated) / <alpha-value>)',
          control: 'hsl(var(--material-control) / <alpha-value>)',
          scrim: 'hsl(var(--material-scrim) / <alpha-value>)',
        },

        // ── D. ClawX usage accents ──────────────────────────────────
        // Semantic chart palette shared by the Models token-usage
        // visualisation and any future input/output/cache indicator.
        // Mirrors Cron's stat-tile palette (blue / green / yellow).
        // Values live in globals.css; dark mode brightens each one.
        usage: {
          input: 'hsl(var(--usage-input) / <alpha-value>)',
          output: 'hsl(var(--usage-output) / <alpha-value>)',
          cache: 'hsl(var(--usage-cache) / <alpha-value>)',
        },

        // ── E. Conversation flow tokens ──────────────────────────────
        // The chat transcript is the one surface where restraint matters
        // most, so it gets a deliberately tiny palette instead of the
        // full semantic set: exactly three text lightness levels
        // (foreground / body / tertiary) and two border weights. This
        // replaces the ad-hoc `border-black/[0.07]`-style variants that
        // had drifted to 15 distinct values across the chat components.
        //
        //   text-conversation-body      → default transcript prose
        //   text-conversation-tertiary  → timestamps, counts, meta
        //   border-conversation         → default hairline boundary
        //   border-conversation-strong  → boundary that must stay visible
        //
        // The third text level is shadcn's `foreground`, used on hover
        // only, so a resting transcript never shows high contrast.
        conversation: {
          body: 'hsl(var(--conversation-text-body) / <alpha-value>)',
          tertiary: 'hsl(var(--conversation-text-tertiary) / <alpha-value>)',
          DEFAULT: 'hsl(var(--conversation-border-light) / <alpha-value>)',
          strong: 'hsl(var(--conversation-border-heavy) / <alpha-value>)',
        },

        // ── F. Codex semantic roles ──────────────────────────────────
        // Direct handles on the --color-* layer in styles/codex-tokens.css,
        // for the cases that used to reach for a literal or a dark: pair.
        //
        // These carry no `<alpha-value>` slot on purpose: the values are
        // already color-mix(in oklab, …) composites, and Tailwind's alpha
        // modifier only works on a bare hsl/rgb channel triplet. An overlay
        // that needs to be lighter should use the role one step down
        // (tertiary under secondary) rather than an opacity suffix — the
        // steps are calibrated, arbitrary alphas are not.
        //
        //   bg-elevated            floating panel: dropdown, popover, tooltip
        //   bg-elevated-opaque     same, where backdrop-filter cannot apply
        //   bg-elevated-secondary  recessed flat card inside a panel
        //   bg-row-hover           list-row and menu-item hover wash
        //   bg-overlay-backdrop    modal scrim
        //   text-fg / -secondary / -tertiary   the three text levels
        //   border-hairline / -heavy / -light  boundary weights
        elevated: 'var(--color-background-elevated-primary)',
        'elevated-opaque': 'var(--color-background-elevated-primary-opaque)',
        'elevated-secondary': 'var(--color-background-elevated-secondary)',
        'row-hover': 'var(--color-background-row-hover)',
        'overlay-backdrop': 'var(--color-overlay-backdrop)',
        fg: {
          DEFAULT: 'var(--color-text-foreground)',
          secondary: 'var(--color-text-foreground-secondary)',
          tertiary: 'var(--color-text-foreground-tertiary)',
        },
        hairline: 'var(--color-border)',
        'hairline-heavy': 'var(--color-border-heavy)',
        'hairline-light': 'var(--color-border-light)',
      },

      /* ──────────────────────────────────────────────────────────────
       * boxShadow
       * ──────────────────────────────────────────────────────────────
       *
       * A closed set. `hairline` is a 0.5px ring for a boundary that must
       * read as a drawn line; the six ambient steps run sm → 2xl. The
       * values live in styles/codex-tokens.css and deepen in dark mode,
       * because a 12% black shadow is invisible on a #181818 canvas.
       *
       *   hairline → 0.5px ring
       *   subtle   → legacy alias of sm, kept for existing callers
       *   sm/md    → resting controls, surface cards
       *   lg       → hover lift
       *   xl       → dropdowns (usually via xl-spread)
       *   2xl      → modals and drawers
       *
       * `xl-spread` composes the hairline with xl and is what every
       * floating menu uses: the ring keeps a translucent panel from
       * dissolving into a canvas of similar lightness, the xl gives it
       * depth. Anything needing more than `subtle` inside the transcript
       * is a signal the element should be a plain indented row instead.
       * ────────────────────────────────────────────────────────────── */
      boxShadow: {
        hairline: 'var(--shadow-hairline)',
        subtle: 'var(--shadow-subtle)',
        sm: 'var(--shadow-sm)',
        DEFAULT: 'var(--shadow-md)',
        md: 'var(--shadow-md)',
        'md-stronger': 'var(--shadow-md-stronger)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
        '2xl': 'var(--shadow-2xl)',
        'xl-spread': 'var(--shadow-xl-spread)',
      },

      /* ──────────────────────────────────────────────────────────────
       * borderRadius
       * ──────────────────────────────────────────────────────────────
       *
       * Every rung resolves to a token whose value is a base radius times
       * --corner-radius-scale (1.25). That multiplier is what makes the UI
       * read softer than stock Tailwind without tipping into iOS roundness,
       * and it is why the halves (2.5 / 7.5 / 12.5) are correct, not typos.
       *
       * Remapping the scale here rather than rewriting call sites is
       * deliberate: `rounded-md`, `rounded-lg` and `rounded-xl` account for
       * ~980 usages, and they were already applied with the right *intent*
       * (md on controls, lg on rows, xl on panels). They were just resolving
       * to unscaled values. Retuning the scale moves all of them onto the
       * rhythm at once, with no churn in components.
       *
       *   2xs 2.5   xs 5     sm 7.5   md 10    lg 12.5
       *   xl  15    2xl 20   3xl 25   4xl 30   full 9999
       *
       * The three that carry the rhythm: 3xl composer, 2xl dropdown/dialog,
       * lg list row. A floating layer sits one step below the surface it
       * springs from — never two, or it looks sunken into it.
       * ────────────────────────────────────────────────────────────── */
      borderRadius: {
        '2xs': 'var(--radius-2xs)',
        xs: 'var(--radius-xs)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
        '3xl': 'var(--radius-3xl)',
        '4xl': 'var(--radius-4xl)',
        full: 'var(--radius-full)',
      },

      /* ──────────────────────────────────────────────────────────────
       * zIndex
       * ──────────────────────────────────────────────────────────────
       *
       * Five rungs, nothing between them. The audit found 13 distinct
       * values including a `z-[95]` whose only meaning was "clear 90, duck
       * under 100" — a value that encodes a past collision rather than an
       * intent, which guarantees the next one.
       *
       * A backdrop shares `modal` with the dialog it dims; the dialog wins
       * by DOM order, not by a bigger number. `toast` outranks everything
       * because a tooltip can be summoned from inside any other layer.
       * ────────────────────────────────────────────────────────────── */
      zIndex: {
        base: 'var(--z-base)',
        raised: 'var(--z-raised)',
        dropdown: 'var(--z-dropdown)',
        modal: 'var(--z-modal)',
        toast: 'var(--z-toast)',
      },

      /* Blur scale — 8px (`sm`) is the glass standard, paired with a ~96%
       * color-mix. Neither half reads as frosted glass alone. */
      backdropBlur: {
        xs: 'var(--blur-xs)',
        sm: 'var(--blur-sm)',
        md: 'var(--blur-md)',
        lg: 'var(--blur-lg)',
        xl: 'var(--blur-xl)',
        '2xl': 'var(--blur-2xl)',
        '3xl': 'var(--blur-3xl)',
      },

      /* Entering and leaving are not symmetric: arrivals decelerate hard so
       * they feel placed, exits accelerate away because attention has
       * already moved on. */
      transitionTimingFunction: {
        enter: 'var(--ease-enter)',
        'enter-snappy': 'var(--ease-enter-snappy)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
