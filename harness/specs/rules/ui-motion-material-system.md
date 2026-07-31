---
id: ui-motion-material-system
title: UI Motion and Material System
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

Windows UI v2 uses a restrained ClawX/Apple material and motion language without changing runtime behavior.

Requirements:

- Large moving surfaces animate only compositor-friendly transform and opacity properties.
- Opening an overlay must not transform the mounted background application tree; animate only the overlay itself.
- UI v2 code does not add `transition-all`, `ease-in`, or `scale(0)` entrances.
- Motion is purposeful, interruptible where user-driven, and removed or reduced for high-frequency keyboard navigation.
- Reduced-motion replaces large movement and spring behavior with short opacity/color transitions.
- Sidebar, toolbar, drawer, elevated panel, control, and scrim materials come from shared tokens rather than local arbitrary colors.
- Translucent materials are not stacked without an opaque or sufficiently frosted separation layer.
- Modal scrims and large drawers must not use `backdrop-filter` while hardware acceleration is unavailable.
- Settings drawer navigation selection must not use layout-projection animation; preserve the selected material with compositor-friendly opacity or color transitions.
- Overlay state and stable visual-version state use separate React contexts so opening an overlay does not invalidate background page consumers.
- Windows title-bar controls remain outside modal scrims and fully interactive.
- Renderer-visible text uses `react-i18next` with complete `en`, `zh`, `ja`, and `ru` locale coverage.
- Settings URLs and existing stable E2E test ids remain compatible.

Validation:

- `pnpm run i18n:lint`
- `pnpm run typecheck`
- `pnpm run build:vite`
- `pnpm run test:e2e:run tests/e2e/windows-ui-v2.spec.ts tests/e2e/settings-drawer.spec.ts`

