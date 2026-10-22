# TF-0495 acceptance evidence

- Task: `TF-0495` — expose the four DCS context view tools as a standard tool surface
- Actor: `codex`
- Evidence driver: `agent`
- VerseGit scope: excluded
- Release boundary: public release, GA, liveReady and productApproved remain unclaimed

## Delivered contract

- The four names `context_understand`, `context_impact`, `context_reuse` and
  `context_verify` are already present in the standard core coding catalog and
  are checked against the runtime factory catalog. This node does not edit the
  generated catalog files; that would exceed the TF-0495 path scope.
- With a healthy workspace, available FactService and permitted read-only policy,
  the four tools register without an environment variable or Developer switch.
- `OPENCLAW_DCS_CONTEXT_VIEW_TOOLS` remains an explicit rollback/override. A
  false value keeps the tools out; a true value does not bypass dependency or
  permission health.
- Missing dependency, unavailable context store and permission denial are
  represented in `ContextViewToolSurface/v1` with a reason and no active names.
- Discovery uses name, selector and short summary. Full schemas remain available
  through the existing on-demand registry expansion.
- Each view-tool execution rechecks the surface. A stale/denied surface returns
  `ok:false`, `failClosed:true` before touching the FactStore.
- No product default was flipped: the production flag catalog retains
  `defaultValue:false` and the authority manifest remains unchanged.
- `shared/dcs/prod-flags-catalog.ts` is in the allowed scope. Its committed
  generated projection `docs/generated/catalogs/prod-flags.md` is included via
  the applied `TFP-TF-0495-derived-catalog-authority-20261022` authority delta,
  matching the TF-0494 precedent. `tools.md` required no content change.

## Acceptance mapping

| Criterion | Evidence |
|---|---|
| Four tools visible in standard catalog and digest-consistent with runtime | `raw-evidence.json#catalog`; `context-view-tool-surface.test.ts`; `context-agent-tools.test.ts` |
| Healthy / missing-dependency / permission-denied states readable from disk | `raw-evidence.json#surfaceStates`; surface unit contract |
| Model cannot claim a tool exists when it is not callable | `raw-evidence.json#discoverability`; unavailable states expose no active names |
| Unauthorized invocation fails closed | `raw-evidence.json#permissionNegative`; stale-surface execution test |

## Reproduction

```powershell
& '.\openclaw_runtime\node_modules\.bin\tsx.CMD' 'tests/unit/fixtures/context-view-tool-surface/acceptance/TF-0495/generate-acceptance.mts'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'tests/unit/fixtures/context-view-tool-surface/acceptance/TF-0495/run-verification.ps1'
```

## Unverified boundary

- Evidence is agent-driven and contract/unit/E2E based; it is not real-human
  evidence.
- Public release, GA, liveReady and productApproved are not authorized.
- No VerseGit files or nodes are touched.
