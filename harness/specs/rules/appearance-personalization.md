---
id: appearance-personalization
title: Scope and persistence of appearance preferences
type: rule
appliesTo:
  - appearance-personalization
pathPatterns:
  - src/lib/appearance.ts
  - src/components/settings/AppearanceControls.tsx
requiredTests:
  - tests/e2e/appearance-personalization.spec.ts
  - tests/unit/appearance-personalization.test.ts
---

- Missing or malformed saved fields use their individual defaults. Accept only bounded whole-pixel sizes, known typefaces and six-digit hex colors.
- Accent overrides apply to interaction roles. Status colors retain their semantic meaning in each theme.
- The reading sample and transcript use shared typography. Code keeps its monospace face.
- Reset restores theme, accent and conversation typography together and preserves unrelated settings.
- Settings page chrome, sidebar and portalled layers consume the same appearance scope. Controls use the shared Switch, Select and preview slider. The reading sample uses the chat question and Markdown reply renderers.
- Settings text size applies to navigation, headings, row labels and common controls independently of conversation text size. Old profiles use the standard scale.
- Verify rendered CSS in Electron across light and dark modes, contrasting presets, custom color and reset. Include page materials, switches and their thumbs, selection and focus, menus, dialogs, destructive actions and the responsive module selector.
