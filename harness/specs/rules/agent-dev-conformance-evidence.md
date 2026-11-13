---
id: agent-dev-conformance-evidence
title: Agent Dev Conformance Evidence
type: rule
appliesTo:
  - agent-dev-ecosystem-regularization
pathPatterns:
  - scripts/agent-dev-*.mjs
  - scripts/channel-conformance.mjs
  - shared/agent-dev/**
  - artifacts/**
---

# Agent Dev Conformance Evidence

## Rule

Agent Dev feature work must produce machine-readable evidence for scaffolds, scenarios, contracts, quality, and conformance checks.

## Requirements

- `agent-dev:make` scaffolds must refuse to overwrite existing files.
- Skill/channel/plugin scaffolds include manifest, schema, fixture, tests, and i18n stubs when applicable.
- Scenario scaffolds update `shared/agent-dev/scenarios.ts` and generated E2E specs assert the Agent Dev snapshot so unregistered scenarios cannot pass as no-op routes.
- Channel work includes a `channel:conformance` report under `artifacts/channel-conformance/<name>/`.
- Scenario recordings are redacted artifacts and are not automatically promoted into `harness/specs/**`.
- Scenario recordings must include review/promotion guidance and redact token, API key, secret, password, authorization, credential-like string values, and local home-path data before writing artifacts.
- Reviewed scenario recordings may be promoted only through an explicit developer action such as `pnpm agent-dev:promote-scenario <artifact> <name>`; promotion must write fixture, shared registry seed, harness scenario, and snapshot-backed E2E together without overwriting existing files.
- Standalone E2E scaffolds must target an existing `shared/agent-dev/scenarios.ts` id; new scenario scaffolds must create the registry entry, harness scenario, and snapshot-backed E2E together.
- Trace, cost, and sandbox reports expose typed host-api surfaces before Workbench UI depends on them.
- Gateway trace collection consumes the normal chat:message and chat:runtime-event channels. Cost reports deduplicate stable message identities and prefer reported run totals over duplicated message usage; execution observations omit raw tool arguments and results.
- Workbench may exist as both a static artifact and an in-app Settings > Developer panel, but it must index real registry, contract, host-api, conformance, recording, trace, cost, and sandbox evidence. Renderer Workbench code must use host-api/api-client and four-locale i18n.
- Page scaffolds must create real renderer routes and four-locale locale namespaces. Host-route scaffolds must connect contract, renderer facade, Main registry, and service implementation.
- Gate responsibilities are layered: `pnpm agent-dev:fast` covers contract/i18n/focused unit/workbench without rebuilding Electron; full local gates add task-spec validation, built E2E, and relevant conformance; nightly/release gates add deep diagnostics, comms replay/compare, and broader E2E/report evidence.
- Built E2E loops should expose a no-build command such as `pnpm run test:e2e:agent-dev-quality:run` so repeated local diagnostics can reuse a fresh Vite/Electron build instead of hiding the build cost inside every Playwright run.
- Deep diagnostics should be repeatable via `pnpm agent-dev:deep-test`, with machine-readable timing, separate build/runtime bottlenecks, and a quality report under `artifacts/agent-dev-quality/` for Workbench indexing.
- The root typecheck gate must fail when node, web, or test typechecking fails. Cached checks must include test sources and imported runtime/package sources in their fingerprint; observation-only test failures must never produce a successful full gate.
- Uncached typechecking compiles every project directly and omits the unused
  cache fingerprint scan. Cached runs still hash all declared source inputs and
  invalidate previous success after test or runtime dependency changes.
  Node and web compile together; the test project follows them to bound peak
  compiler memory while retaining all three results in the same gate.

## Validation

- `pnpm agent-dev:make <kind> <name>`
- `pnpm channel:conformance <channel-name>`
- `pnpm agent-dev:promote-scenario <artifact> <name>`
- `pnpm agent-dev:deep-test`
- `pnpm test tests/unit/agent-dev-regularization.test.ts`
