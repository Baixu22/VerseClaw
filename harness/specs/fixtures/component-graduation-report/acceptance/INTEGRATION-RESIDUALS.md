# Component graduation integration residuals

Date: 2026-10-22

## Scope reviewed

The scoped component-graduation Task Forest records `TF-0488`, `TF-0489`, `TF-0490`,
`TF-0491` and `TF-0492` as `done`. Its next active leaf is `TF-0493 / ready`; this
integration does not implement TF-0493 or change a product default.

## Current verification

- focused graduation, authority, disposition and model-profile tests: 4 files / 46 passed;
- full node/web/test typecheck: pass;
- ESLint for the implemented TypeScript/test surfaces: pass;
- `catalogs:check`: pass;
- `contract:check`: pass;
- TF-0490 and TF-0492 graduation gates: pass;
- scoped Task Forest validation: pass;
- all evidence paths listed by TF-0488 through TF-0492 exist on disk.

## Historical checksum drift retained

The five node checksum manifests contain 123 entries. 114 entries match current bytes;
9 historical entries intentionally do not:

- eight entries across TF-0488, TF-0489, TF-0490 and TF-0491 bind mutable scoped Task
  Forest `graph/nodes.json` or `exports/task-forest.html`, which changed as later nodes
  were activated;
- TF-0489 binds `docs/dev/runtime-control-planes.md` before TF-0491 added the disposition
  matrix section.

These manifests are retained as historical evidence and are not presented as a current
all-green checksum surface. The source fingerprints and artifact hashes that bind the
implemented code and node-specific fixtures continue to match.

## Authority boundary

This integration is `driven_by: agent` with actor `codex`. It does not claim real-human
evidence, public release, GA, live readiness, product approval, a product-default change
or authorization to execute `TF-0493` or any later node.
