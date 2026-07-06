# Context Runtime Kit Goal-Mode Development Protocol

## Purpose

This protocol makes long-task development auditable. It prevents a goal-mode worker from inventing scope, skipping tests, or merging later-phase runtime behavior into earlier contract phases.

## Binding Inputs

A goal-mode worker must read:

- the global repository instructions in `AGENTS.md`,
- the product plan in `docs/superpowers/plans/2026-07-06-context-runtime-kit.md`,
- this protocol,
- `docs/context-runtime-kit/acceptance-and-test-matrix.md`,
- the current phase constraint file,
- the harness task, rule, and scenario specs for Context Runtime Kit.

If any listed file is missing, the worker must stop before implementation and report the missing file.

## One-Phase Rule

Each goal-mode run owns one phase.

Allowed:

- completing all acceptance criteria for the active phase,
- adding tests and fixtures required by the active phase,
- updating docs that explain the active phase,
- adding follow-up notes for future phases.

Forbidden:

- implementing later-phase deliverables,
- silently changing runtime behavior before the phase allows it,
- widening ownership because a later phase looks nearby,
- replacing existing context owners.

## TDD and Evidence Rule

For production code phases, the worker must:

1. write a focused failing test,
2. run it and record the expected failure,
3. implement the smallest code change,
4. rerun the focused test to green,
5. run the phase gate suite.

For documentation-only phases, the worker must:

1. run the relevant harness command before editing when possible,
2. record the failure or missing coverage,
3. edit the smallest spec/doc set,
4. rerun harness validation.

Completion claims require fresh command evidence from the current run.

## Source-of-Truth Boundaries

Context Runtime Kit must not create a parallel durable source of truth.

Durable policy belongs in:

- `AGENTS.md`,
- `harness/specs/**`,
- phase docs under `docs/context-runtime-kit/**` until promoted into harness specs.

Runtime data artifacts may be created only in phases that explicitly allow them.

## Runtime Behavior Boundaries

Before a phase explicitly allows active behavior:

- legacy prompt assembly remains authoritative,
- tool calls are not blocked by CVK gates,
- approvals, retries, fallback, transport, and MCP tool lists are unchanged,
- `CompressionArtifact v1` consumers remain compatible,
- Context Pack, `LoopContextPack`, Task Ledger, ClawGraph, Observability, Memory, and Knowledge keep their current authority.

Shadow or report-only output must never change user-visible behavior.

## Dirty Worktree Rule

The repository may contain unrelated local changes.

The worker must:

- inspect `git status --short` before edits,
- identify phase-owned files,
- avoid reset, checkout, or revert of user changes,
- stage only phase-owned files when asked to stage,
- call out unrelated dirty files in the final report.

## Required End-of-Phase Report

The final report must include:

- active phase name,
- files changed and their responsibilities,
- tests run and exact results,
- RED to GREEN evidence where applicable,
- acceptance checklist with pass/fail status,
- unimplemented future-phase items,
- unrelated failures or dirty files,
- whether the phase is ready for review.

Do not write "should pass" or "looks complete". Report only verified status.
