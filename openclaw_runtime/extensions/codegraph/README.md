# CodeGraph — RETIRED (do not use as a product feature)

> **Status:** RETIRED (context-engine rebuild Task I).  
> **Superseded by:** in-process FactStore / DCS view tools  
> (`context_understand` / `context_impact` / `context_reuse` / `context_verify` — opt-in via Settings → Developer → DCS Production Flags).  
> **Default:** `enabledByDefault: false` in `openclaw.plugin.json`.  
> **Retained for:** impact-parity harness / historical dist only.  
> **Not:** a default coding tool surface, Settings feature, or recommended agent path.

## What users should use instead

| Need | Use |
|------|-----|
| Symbol / impact / understand | DCS Fact view tools (opt-in, TASK-P0-01+) |
| Working memory | DCS `working_memory` flags (opt-in) |
| Working Context packing | Verse Token (Settings → Developer) |
| Navigation shell | CVK (default engine shell — not memory) |

## Runtime contract (historical only)

The flow below is **legacy documentation** for the retired plugin. Prefer FactStore tools.

```text
(retired) codegraph_decide -> codegraph_context_plan -> direct source read
```

Hard boundaries if someone force-enables the plugin:

- Still verify claims by reading real source.
- Prefer FactStore / direct reads over CodeGraph for product work.
- Treat stale/unchecked index as untrusted.

## Quality gate (harness only)

```bash
# from openclaw_runtime/ — parity harness, not product enablement
pnpm test:codegraph-runtime
```

## Related

- `openclaw.plugin.json` — `enabledByDefault: false`, description starts with RETIRED  
- TASK-P0-06 — hide/retire dead surfaces  
- Settings Context layers explainer (TASK-P0-05)
