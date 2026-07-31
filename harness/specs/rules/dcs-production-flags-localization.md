---
id: dcs-production-flags-locale-quality
title: DCS Production Flags Localization
type: rule
appliesTo:
  - dcs-production-flags-localization
pathPatterns:
  - shared/i18n/locales/**/settings.json
  - src/components/settings/DcsProdFlagsPanel.tsx
---

# Rule: the shipped DCS control surface is localized as one unit

The Settings > Developer DCS control surface includes `contextLayers`,
`dcsPreview`, and `dcsProdFlags`. Japanese and Russian must localize all three
trees together; translating only acknowledgement keys leaves the same panel in
a mixed-language state.

Translations must preserve every `{{interpolation}}` token, technical
identifier, command, and documentation path. Acknowledgement hints must retain
an explicit next action such as start, restart, refresh, inspect, or open.

Exact English fallback values in these three Japanese or Russian trees are a
validation failure. Locale files must retain their existing key order and line
ending convention.

## Validation

- `pnpm i18n:lint`
- `pnpm exec vitest run tests/unit/dcs-production-flags-localization.test.ts tests/unit/i18n-locale-parity.test.ts`
- `pnpm run test:e2e tests/e2e/dcs-prod-p0-settings.spec.ts`
