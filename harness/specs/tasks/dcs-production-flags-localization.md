---
lifecycleStatus: archived
id: dcs-production-flags-localization
title: DCS production flags Japanese and Russian localization
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Replace Japanese and Russian English placeholders across the complete Settings Developer DCS control surface while preserving key parity, interpolation tokens, and actionable acknowledgement guidance.
touchedAreas:
  - harness/specs/tasks/dcs-production-flags-localization.md
  - harness/specs/rules/dcs-production-flags-localization.md
  - shared/i18n/locales/ja/settings.json
  - shared/i18n/locales/ru/settings.json
  - tests/unit/dcs-production-flags-localization.test.ts
  - tests/e2e/dcs-prod-p0-settings.spec.ts
  - docs/dev/first-product-controlled-preview/STATUS.md
  - docs/dev/first-product-controlled-preview/tasks/FP-P4-07.md
  - docs/dev/first-product-controlled-preview/tasks/README.md
  - docs/dev/handoffs/LATEST.md
expectedUserBehavior:
  - Japanese users see Japanese context-layer, DCS preview, production-flag, status, recovery, discovery, and observability text.
  - Russian users see the same complete surface in Russian.
  - Runtime acknowledgement hints still tell the operator exactly what to inspect, restart, refresh, or open next.
  - Technical identifiers, file paths, commands, and interpolation values remain intact.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - i18n-locale-coverage
  - dcs-production-flags-locale-quality
  - docs-sync
requiredTests:
  - tests/unit/dcs-production-flags-localization.test.ts
  - tests/unit/i18n-locale-parity.test.ts
  - tests/e2e/dcs-prod-p0-settings.spec.ts
acceptance:
  - Japanese and Russian locale trees retain exact English key and interpolation parity.
  - The contextLayers, dcsPreview, and dcsProdFlags trees contain no exact English placeholder values.
  - Every acknowledgement hint retains a locale-specific actionable next step.
  - Electron E2E renders representative Japanese and Russian DCS control text.
  - Locale files retain CRLF endings and no keys are reordered.
docs:
  required: true
---

Use this task spec for `FP-P4-07`. This is a copy-only UI change. It does not
change DCS flags, acknowledgement semantics, transport, defaults, or product
approval.
