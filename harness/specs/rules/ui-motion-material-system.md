---
id: ui-motion-material-system
title: FakeCoding UI Motion and Material System
type: rule
appliesTo:
  - windows-ui-v2
pathPatterns:
  - src/App.tsx
  - src/styles/**
  - src/components/ui/**
  - src/components/layout/**
  - src/pages/**
  - shared/i18n/locales/**
requiredTests:
  - tests/e2e/windows-ui-v2.spec.ts
  - tests/e2e/settings-drawer.spec.ts
---

# UI Motion and Material System

UI v2 uses a restrained, cross-platform FakeCoding work-surface and motion language without changing runtime behavior.

Requirements:

- Management pages use continuous work surfaces, fine dividers, and compact toolbars rather than nested cards or hero layouts.
- Management page headings use the sans stack, stay at or below 28px, and use zero letter spacing.
- Normal controls are 28-32px high; text inputs are 32-36px high. Regular actions must not use full-width blue fills or press-scale effects.
- The default primary action is a grayscale foreground/background inversion. Blue is reserved for links, keyboard focus, and running state.
- A visible state exposes at most one primary action; secondary actions use ghost, icon, or overflow-menu treatment.
- Navigation rows are approximately 31px high with 13-14px type, 16px icons, an 8px inner radius, and a low-contrast grayscale selected state.
- Sidebar, toolbar, popover, elevated panel, control, and scrim materials come from shared grayscale tokens rather than local arbitrary colors.
- Product icons prefer the migrated FakeCoding `codex-icons` or `officialMenuIcons` SVG with its source stroke/fill rules; use normalized Lucide icons only when no reference asset exists.
- Large moving surfaces animate only compositor-friendly transform and opacity properties.
- Opening an overlay must not transform the mounted background application tree; animate only the overlay itself.
- UI v2 code does not add `transition-all`, `ease-in`, `scale(0)` entrances, spring decoration, or `active:scale` feedback.
- Motion is purposeful, interruptible where user-driven, and removed or reduced for high-frequency keyboard navigation.
- An outgoing animated Setup control or delayed installation completion can only advance its own active step. Leaving a step cancels its pending visual transition; it cannot bypass Provider, Model or Workspace verification.
- Setup verification results remain bound to the current Provider/Model selection and component instance. Obsolete completions cannot initiate subsequent writes or restore readiness for a different selection.
- Reduced-motion replaces large movement and spring behavior with short opacity/color transitions.
- Color, opacity, and necessary movement transitions stay within 120-180ms.
- Translucent materials are not stacked without an opaque or sufficiently frosted separation layer.
- Modal scrims and large drawers must not use `backdrop-filter` while hardware acceleration is unavailable.
- Settings navigation selection must not use layout-projection animation; preserve the selected material with compositor-friendly opacity or color transitions.
- Chat layout and message consumers do not subscribe to changing overlay state. The retired visual-version switch must not return through a separate context or fallback branch.
- Platform-native title-bar controls remain outside modal scrims and fully interactive.
- Renderer-visible text uses `react-i18next` with complete `en`, `zh`, `ja`, and `ru` locale coverage.
- Settings URLs and existing stable E2E test ids remain compatible.

Validation:

- `pnpm run i18n:lint`
- `pnpm run typecheck`
- `pnpm run build:vite`
- `pnpm run test:e2e:run tests/e2e/windows-ui-v2.spec.ts tests/e2e/settings-drawer.spec.ts`
