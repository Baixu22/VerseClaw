# TF-0506 product semantics and claim acceptance

- Task: `TF-0506` - synchronize product semantics, defaults, claims, localized READMEs and the retired-surface list.
- Actor: `codex` | Evidence driver: `agent`
- Product locks changed: no
- VerseGit product state changed: no
- Release boundary: no public release, general availability, liveReady or productApproved claim

## Delivered

- The canonical component table now records Workspace Context and automatic healthy context view tools as product defaults, VToken as retired, C6 as internal, Browser as advanced, and coding write/journal safeguards as default.
- `ComponentDispositionManifest/v1` is the single source for the component matrix; a deterministic renderer regenerates the 53-row document.
- Product semantics, the default matrix and the retired-surface registry now match the actual runtime behavior and owning-node decisions.
- English, Chinese, Japanese and Russian READMEs carry the same positioning: VToken retired, Dreams retired, Image Generation developer/test-only, Workspace Context and healthy context view tools available by default.
- The capability claim matrix preserves the explicit no-automatic-memory-write, no-private-network-bypass and no-provider-quality-guarantee boundaries instead of deleting them.

## Verification

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/unit/fixtures/product-semantics-tf0506/run-verification.ps1
```

The verifier writes one receipt per gate, a machine-readable `verification.json`, and a SHA-256 manifest covering the fixture. It fails if any current-product-surface claim scan finds a forbidden term, a default-matrix row lacks an assertion, or localized copy diverges.

## Boundary

This evidence proves documentation, generated catalogs, localized copy, authority/disposition coverage and the current repository claim scan. It does not by itself prove live-provider behavior or model positioning; those belong to `TF-0507`.
