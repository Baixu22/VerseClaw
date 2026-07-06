---
id: i18n-locale-coverage
title: i18n Locale Coverage
type: rule
appliesTo:
  - agent-dev-ecosystem-regularization
pathPatterns:
  - shared/i18n/locales/**
  - src/**/*.tsx
  - scripts/agent-dev-scaffold.mjs
---

# i18n Locale Coverage

## Rule

User-facing renderer text must route through `react-i18next`, and locale namespaces must stay aligned across `en`, `zh`, `ja`, and `ru`.

## Requirements

- Namespace files exist for all four locales.
- Key paths match across all locale copies of a namespace.
- `useTranslation('<namespace>')` references an existing namespace.
- New scaffolded pages, skills, and plugins include locale stubs.
- Hardcoded user-visible TSX strings are treated as lint findings unless explicitly exempted.

## Validation

- `pnpm i18n:lint`
- `pnpm test tests/unit/i18n-lint.test.ts`
