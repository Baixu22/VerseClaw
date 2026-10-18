# TF-0390 Final Evidence and Boundary Report

Generated: 2026-10-18T11:48:19.246Z

## Engineering evidence

- Workbench: generated, 15 scenarios, scenario recordings present.
- Deep-test: success=true, 148379ms (full run), 43266ms (smoke daily-loop refresh).
- Full Agent Dev E2E: 4/4 passed in 55.9s; teardown fix also validated independently at 4/4 in 24.2s.
- Required full gates executed: pnpm run typecheck exit 0 (53.4s); pnpm run build:vite exit 0 (77.5s); full Agent Dev E2E exit 0 (24.2s).

## Audit truth

Audit status is **fail** (grade B, score 80/100, maturity blocked). It is not called green.

- typecheck 69858ms > 45000ms.
- playwright-agent-dev 58623ms > 40000ms.
- Smoke daily-loop evidence is needs-full-gate, not release-ready.
- Evidence freshness: 4 fresh generated sources; no stale source reported.

## Release boundary

- No current release/ installer exists for this candidate.
- NSIS installer success is **unproven**; no executable/installer claim is made. Historical failure remains recorded.
- No publishing, tag, public-repo change, product lock or frozen-default change is included.

## Deliberate exclusions

- Full OS sandbox.
- Manus cloud VM, Website Builder, realtime collaboration.
- A second trace, task or goal authority.
