---
id: sekb-runtime-development-loop
title: SEKB Runtime Development Loop
type: ai-coding-rule
appliesTo:
  - sekb-runtime-long-task-development
  - sekb-mvp
requiredProfiles:
  - fast
---

SEKB work must use a spec-driven implementation loop. Start each long task by
running `pnpm harness context --spec harness/specs/tasks/sekb-runtime-long-task-development.md`
or a narrower SEKB task spec, then read the returned task, scenario, rule,
guide, and layer files before editing.

Each SEKB long task must start with branch hygiene: confirm the current branch,
inspect `git status --short --branch`, identify unrelated dirty or untracked
files, and keep unrelated work out of staged changes and commits.

SEKB remains runtime-side, explicit, and advisory unless a new approved task
spec says otherwise. Do not add renderer UI, automatic pause, automatic retry,
hidden correction, output rewriting, tool blocking, autonomous L2 principle
writes, a required external database, a required vector service, JSON sidecar
runtime state, or a new config/env surface as part of ordinary SEKB work.

Persistent SEKB state belongs in OpenClaw SQLite state. Schema changes must
update `openclaw_runtime/src/state/openclaw-state-schema.sql` and generated
Kysely schema/types in the same change set, then run
`node scripts/generate-kysely-types.mjs --verify` from `openclaw_runtime`.

Every implementation stage must be test-first unless it is docs-only. Add or
update focused unit tests before production code, run the failing test, make the
minimum implementation pass, then rerun the same focused test before moving to
the next stage.

When a stage touches AgentHarness or real runtime hook wiring, include an
integration-style test that proves the real hook/event shape. Fake targets are
acceptable only when the touched surface is still an adapter contract and no
real runtime call site changed.

When a stage touches renderer, Electron Main, host-api, api-client, Gateway, or
channel delivery paths, it must preserve the renderer/Main boundary and run the
communication regression profile: `pnpm run comms:replay` and
`pnpm run comms:compare`.

User-visible UI changes require full locale coverage under
`shared/i18n/locales/{en,zh,ja,ru}/`, design-token-compliant styling, and an
Electron E2E test that covers the new workflow.

Before claiming a SEKB long task is complete, rerun the required focused tests,
run harness validation for the active task spec, inspect the final diff, and
state the README translation decision. All planned items must be implemented
with proof or explicitly deferred in a tracked document with rationale.
