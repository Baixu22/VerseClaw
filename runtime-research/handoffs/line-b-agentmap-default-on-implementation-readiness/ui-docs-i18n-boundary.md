# UI Docs I18n Boundary

## UI

No user-visible UI is added or changed by this readiness task.

## Docs

This task adds internal harness and runtime-research documents only. It does not change public behavior, public API, settings UI, or operator flows.

## i18n

No renderer text is added. Locale files are not required for this readiness-only task.

## Required Scan

The final synthesis must record the README/i18n docs sync scan across:

```text
README.md README.zh-CN.md README.ja-JP.md README.ru-RU.md
```

If the scan finds no AgentMap/default-on public docs surface requiring updates, README/i18n updates are skipped.
