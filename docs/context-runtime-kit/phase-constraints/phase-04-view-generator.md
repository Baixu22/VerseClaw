# Phase 04: View Generator and Lazy Exposure

## Goal

Generate registry and compact views that are navigation-only and carry selectors required for exact evidence.

## Allowed Changes

- View generation module in the scoped CRK/CVK area.
- Fixture resources for tools, skills, and rules.
- Unit tests for view content and token estimates.

## Forbidden Changes

- Default prompt replacement.
- Active lazy skill/tool exposure in live runs.
- Tool-call enforcement.
- Runtime provider registry activation except test-only construction.

## Required View Levels

- Level 0 registry view: names, short purpose, trigger hints, `resource_id`.
- Level 1 compact view: entry points, key fields, required workflow, `hard_selectors`, `must_expand_before_call`.
- Level 2 raw chunks: original source selectors only, not included by default.

## Required Tests

Use TDD. Add failing tests for:

- navigation-only marker on every view,
- source-backed selectors for hard facts,
- tool compact views include all required selector families,
- 50-skill fixture exposes registry view only by default,
- selected skill expands only required workflow selectors,
- token estimate is deterministic.

Run:

```powershell
corepack pnpm exec vitest run tests/unit/<view-generator-tests> --reporter=verbose
corepack pnpm run typecheck
```

## Acceptance

- Views are short, stable, navigation-only, and checksum-backed through selectors.
- No raw hard facts become authoritative through summary text.
- No live prompt behavior changes.

## Stop Conditions

Stop if generated views need runtime routing, prompt injection, or provider integration. That belongs to Phase 5.
