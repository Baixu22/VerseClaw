# Phase 02: Toolset, Skill, and Project Rule Compiler

## Goal

Compile deterministic hard-constraint sources into resources, chunks, selectors, checksums, compact views, and build reports for fixture coverage.

## Allowed Changes

- A scoped compiler module such as `openclaw_runtime/src/context-engine/cvk/**`.
- Fixture sources under `tests/fixtures/context-runtime-kit/**`.
- Unit tests under `tests/unit/context-engine/**` or a focused CRK test path.
- Build report types or helpers needed by the compiler.

## Forbidden Changes

- Prompt assembly integration.
- Provider registry activation.
- Tool-call blocking.
- Runtime artifact persistence outside fixtures.
- LLM extraction for deterministic constraints.
- Runtime mutation of skills, tools, rules, or project docs.

## Required Source Families

Compiler coverage must include:

- tool schema required fields,
- tool schema enum values,
- tool schema field types,
- defaults and nullable semantics,
- permission and side-effect notes,
- skill summary, triggers, required workflow, safety rules, examples, and source selector,
- AGENTS.md and selected harness rules as project rule resources.

## Required Tests

Use TDD. Add failing fixture tests for:

- source coverage equals 100% for eligible hard-constraint spans,
- reference resolution rate equals 100% for generated selectors,
- artifact reproducibility equals 100% across repeated builds,
- no LLM dependency,
- deterministic selector names for identical inputs,
- changed source checksum changes resource or chunk metadata.

Run:

```powershell
corepack pnpm exec vitest run tests/unit/<cvk-compiler-tests> --reporter=verbose
corepack pnpm harness validate --spec harness/specs/tasks/context-runtime-kit.md
corepack pnpm run typecheck
```

## Acceptance

- Fixture compiler emits resources, chunks, selectors, checksums, views, and build report.
- SC = 100% for eligible fixture source spans.
- RRR = 100% for generated selectors.
- AR = 100% for repeated fixture builds.
- Runtime prompt and tool behavior remain unchanged.

## Stop Conditions

Stop if compiler output must be consumed by live prompt assembly or live tool calls. That belongs to shadow/router/gate phases.
