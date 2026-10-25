# TF-0505 surface cleanup acceptance

- Task: `TF-0505` — clean user-visible developer, experimental and retired surfaces.
- Actor: `codex` | Evidence driver: `agent`
- Product defaults changed: no
- VerseGit scope: excluded
- Release boundary: no public release, general availability, liveReady or productApproved claim

## Delivered behavior

- The retired `/dreams` route is redirect-only to `/`; the Dreams page is never lazily mounted.
- Unknown routes redirect to `/`.
- `/ui-v2-showcase` uses the shared surface policy and is limited to dev mode or a dev/test runtime.
- `/image-generation` remains dev-gated but is no longer advertised in the sidebar.
- Settings > Developer remains explicitly unlockable, but every raw diagnostic panel is hidden until the local dev switch is on.
- VToken Bridge is not mounted in Settings; the host bridge remains fail-closed for the retirement contract.
- Stale sidebar i18n keys for Dreams and Image Generation are removed from all locales.

## Acceptance mapping

| Criterion | Evidence |
|---|---|
| non-dev users cannot reach internal experiment pages by route | `surface-inventory.json`; `10-e2e.txt` |
| ordinary Settings has no raw DCS/VToken/C6/RC-03 flags | `surface-inventory.json`; `10-e2e.txt` |
| every product page has explicit entry, state and rollback | `surface-inventory.json#routes` |
| navigation/routes/i18n/tests are synchronized | `03-i18n-lint.txt`; `01-unit.txt`; `10-e2e.txt` |

## Reproduction

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  'tests/unit/fixtures/surface-cleanup-tf0505/run-verification.ps1'
```

## Boundary

This evidence proves route policy, navigation/settings cleanup, focused unit suites, production Vite build and Electron DOM E2E for the changed surfaces. It does not claim a broad visual redesign, live provider behavior, public release, general availability, liveReady, productApproved, or human evidence.