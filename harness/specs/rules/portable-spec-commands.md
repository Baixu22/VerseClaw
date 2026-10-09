---
id: portable-spec-commands
title: Task spec commands must run from a clean checkout
type: ai-coding-rule
severity: error
requiredTests:
  - tests/unit/harness-spec-portability.test.ts
---

# Portable spec commands

## Rule

Every `requiredTests` entry and every command a task spec instructs an agent to
run must execute from a clean checkout on a CI runner, not only on the machine
that wrote the spec. A declared gate that starts with an operator's home
directory is unrunnable everywhere else, so the spec silently degrades into
undocumented local knowledge.

Forbidden in `harness/specs/**`:

- absolute user-profile paths: `C:\Users\<name>\...`, `C:\Users\<name>` with
  escaped separators, `/home/<name>/...`, `/Users/<name>/...`;
- machine-local wrapper executables (for example an operator's
  `C:\Users\<name>\.cherrystudio\bin\rtk.exe`);
- tools the repository neither declares as a dependency nor ships: a
  system-wide `rg`, a personal `pnpm.cmd` path.

Required instead:

- repository-relative commands: `pnpm ...`, `node scripts/...`,
  `node harness/src/cli.mjs ...`, `node node_modules/<pkg>/...`;
- portable user-scope references written with `%USERPROFILE%`, `$HOME` or `~`;
- `node scripts/scan-pattern.mjs --pattern '<regex>' <path...>` for the pattern
  scans that previously relied on an undeclared local ripgrep wrapper.

Illustrative shapes (`C:\Users\...\workspace`) and portable user-scope
references such as `~/.openclaw/openclaw.json` remain allowed. Historical
evidence keeps its recorded bytes: fix the spec text, never rewrite an old
receipt to hide the machine dependency it recorded.

## Enforcement

`pnpm harness validate --spec <task-spec>` fails closed for every spec family,
including `--no-diff` structural runs, through `validateSpecPortability`
(`harness/src/rules.mjs`, wired in `harness/src/cli.mjs`).
`tests/unit/harness-spec-portability.test.ts` scans the whole checked-in spec
library so a new spec cannot reintroduce a machine-local path.
`scripts/scan-pattern.mjs` is the tracked replacement for undeclared scan tools
and has its own unit test.
