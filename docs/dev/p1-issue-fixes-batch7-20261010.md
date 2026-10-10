# P1 batch 7: unreferenced asset cleanup

- Date: 2026-10-10
- Issues: #79, #80, #81
- driven_by: agent
- actor: codex-p1-batch7

## Removed

- `resources/screenshot/**` - 24 localization screenshots with no README,
  source import, or packaging reference.
- `src/assets/brand/**` - 26 unreferenced brand-exploration files, including
  the incorrectly named `.jpg-lx2` entries.
- 26 of 29 `resources/icons/clawx-logo-kit/**` files. The retained inputs are:
  `logo-dock-1024.png`, `logo-dock-1024-dark.png`,
  `logo-menubar-128.png`, `logo-menubar-128-dark.png`.

## Verification

- `node scripts/generate-icons.mjs` regenerated icons successfully from the
  retained inputs.
- `pnpm run build:vite` completed with exit 0.
- Repository artifact retention passed after the removals.

No product defaults, permission policies or historical evidence snapshots were
changed by this batch.
