# Runtime Token Savings V2 Design

## Status

This document persists the redesign after the Runtime Intensity V1 audit.

The previous V1 work is real but narrow. It maps `thinkLevel` to a typed policy
and applies prompt mode, transient skill prompt limits, tool-result caps,
context guard tightening, runtime context metadata, and report metadata. It does
not implement global VerseShell output reduction, RTK-style command-aware
reducers, Caveman-style safe prose compression, or a Ponytail-style low/medium
skill strategy.

Current local state also matters:

- `codex/sekb-runtime-knowledge` contains many unrelated runtime knowledge and
  UX changes. Do not build this feature by mixing those changes into the token
  savings branch.
- Runtime Intensity V1 was previously completed in a separate worktree and
  branch: `codex/runtime-intensity-v1`.
- The current OpenClaw runtime already has a VerseShell execution host and MCP
  bridge, but VerseShell is not yet the default token-saving shell layer.

## Design Principle

Do not copy RTK, Caveman, or Ponytail code.

Use their design ideas as local OpenClaw and VerseShell capabilities:

- RTK idea: command-aware output economics. Reduce command output before it
  reaches the model, preserve failure evidence, provide raw recovery pointers,
  and measure savings.
- Caveman idea: safe terse language. Compress prose without changing code,
  commands, paths, URLs, versions, diagnostics, tables, or structure.
- Ponytail idea: least necessary component. At lower intensity, select fewer
  skills and prefer existing, native, or standard capabilities before adding
  components.
- VerseShell role: local structured execution substrate. It should reduce
  Windows shell quoting noise and provide a better place to attach structured
  output reducers.

The goal is a native `RuntimeTokenSavingsPolicy`, not a hard dependency on any
external savings component.

## Architecture

### 1. Runtime Token Savings Policy

Add a typed policy layer derived from `RuntimeIntensityPolicy`.

The policy should describe runtime behavior in one place:

```ts
type RuntimeTokenSavingsPolicy = {
  level: "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "off" | "auto" | "unset";
  policyId: string;
  shell: {
    mode: "preserve" | "verseshell-preferred" | "verseshell-required-for-eligible";
    preserveExplicitHost: true;
  };
  outputReduction: {
    mode: "off" | "conservative" | "compact" | "aggressive";
    recovery: "none" | "raw-pointer-on-truncate" | "raw-pointer-on-failure" | "raw-pointer";
  };
  proseCompression: {
    mode: "off" | "safe-compact";
    protectTechnicalSpans: true;
  };
  skills: {
    mode: "preserve" | "ponytail-lite" | "ponytail-full" | "top-k-compact";
    maxSkillsInPrompt?: number;
    preferCompact?: boolean;
  };
  metrics: {
    reportSavings: boolean;
  };
};
```

V1 may keep `RuntimeIntensityPolicy`, but token-saving decisions should be
centralized. Consumers must not reparse raw `thinkLevel`.

### 2. VerseShell As Token-Saving Execution Substrate

VerseShell should become more than an alternate `execHost`.

V2 should make VerseShell preferred for eligible local shell/process execution,
while preserving explicit user configuration:

- If the user or session explicitly sets `tools.exec.host`, honor it.
- If a call explicitly requests `sandbox`, `gateway`, `node`, or `verseshell`,
  preserve that request and the existing allow/deny semantics.
- For eligible local shell/process calls at low token-saving intensities,
  prefer VerseShell when available.
- If VerseShell is unavailable, fall back only through existing runtime fallback
  paths and record the fallback in diagnostics.
- Do not silently bypass approvals or security policy.

The existing config boundary must be made consistent. Current code accepts
`verseshell` in runtime types and session patching, but the agent runtime Zod
schema still needs to accept it everywhere `tools.exec.host` is valid.

### 3. RTK-Style Output Reducers Inside OpenClaw

Implement local command-aware reducers. These are not external RTK calls.

Reducer pipeline:

1. Classify command family from the original command and execution metadata.
2. Preserve exit code, status, duration, stderr presence, command family, and
   failure kind.
3. Apply a reducer only when a family-specific or safe generic reducer exists.
4. Preserve high-value evidence:
   - failed test names
   - file paths and line numbers
   - first meaningful stack/error block
   - git changed file counts
   - search match counts and paths
   - command summary and exit code
5. Deduplicate repeated lines with counts.
6. Group lists by file, directory, rule, or failure kind when useful.
7. Truncate only after preserving the summary and critical evidence.
8. Attach a raw recovery pointer when truncating or when a failing command has
   hidden raw output.
9. Record before/after chars and estimated saved tokens.

Initial reducer families:

- `git status`, `git diff`, `git log`
- `rg`/`grep`/search output
- directory/listing/tree output
- file read/cat/head/tail output
- `pnpm test`, Vitest, Jest, Playwright
- TypeScript/lint/build output
- generic fallback reducer for long stdout/stderr

Raw recovery pointer options:

- Use an existing OpenClaw artifact/session directory if one already exists for
  tool outputs.
- If a new persistence path is needed, it must follow repository storage rules.
  Do not add ad hoc JSON/TXT state files for runtime state. Raw output recovery
  must be either a named artifact/log contract or stored through the existing
  runtime artifact mechanism.

### 4. Caveman-Style Safe Prose Compression

Add a local safe prose compressor for prompt/report prose only.

It may compress:

- skill descriptions
- runtime preference prose
- report summaries
- non-diagnostic explanatory text

It must not modify:

- fenced code blocks
- inline code
- commands
- file paths
- URLs
- environment variables
- versions and numbers
- error messages and stack frames
- markdown table structure
- JSON or other structured payloads

This compressor should be deterministic and testable. It should use simple
structured span protection and conservative rewrite rules, not model calls.

### 5. Ponytail-Style Skill Strategy

Ponytail belongs primarily in `low` and `medium`, not only `minimal`.

Skill prompt behavior:

| Level | Skill strategy |
| --- | --- |
| `minimal` | Top 8 compact. Only include the most likely skills. |
| `low` | Top 16 with Ponytail full. Prefer fewer components and compact descriptions. |
| `medium` | Ponytail lite. Keep broader awareness through summaries or an index, but avoid expanding every skill by default. |
| `high` | Preserve full skill prompt and full orchestration capability. |
| `xhigh`/`max` | Preserve full capability and encourage deliberate use of long-task tools, ClawGraph, subagents, and multi-model support when useful. |

The skill registry must not be mutated. All limits are transient prompt-rendering
decisions.

Ponytail-style rules are behavioral preferences, not capability removals:

- Reuse existing repo helpers before adding new abstractions.
- Prefer native or standard capabilities where sufficient.
- Load the smallest set of skills needed for the task.
- Do not remove safety checks, validation, error handling, accessibility, or
  explicitly requested behavior.

## Policy Matrix

| Level | Shell | Output reducer | Prose | Skills | Recovery |
| --- | --- | --- | --- | --- | --- |
| `minimal` | VerseShell preferred | aggressive | safe compact | top 8 compact | raw pointer |
| `low` | VerseShell preferred | compact | safe compact | Ponytail full, top 16 | raw pointer |
| `medium` | VerseShell preferred when eligible | conservative | safe compact for prompt prose | Ponytail lite | raw pointer on truncate/failure |
| `auto`/`off`/unset | preserve | off | off | preserve | preserve |
| `high` | preserve | off or report-only | off | preserve | preserve |
| `xhigh`/`max` | preserve | off | off | preserve | preserve |

Explicit `promptMode`, `promptMode: "none"`, raw model runs, and explicit exec
host configuration keep their original meaning.

## Reports And Metrics

Reports must contain structured metadata, not raw prompts or raw outputs.

Required report fields:

- level
- policy id
- shell mode
- effective exec host when available
- reducer mode
- reducer family
- raw recovery pointer presence
- skills mode
- skills included
- skills total
- prompt chars before/after when measured
- tool output chars before/after
- estimated saved chars
- estimated saved tokens
- fallback reason if VerseShell was attempted and not used

Do not store raw system prompt text, raw skill prompt text, raw tool output, or
raw shell output in the report.

## Branch And Worktree Hygiene

Implementation should start from a clean dedicated branch or worktree, not from
the dirty `codex/sekb-runtime-knowledge` state.

Recommended branch:

`codex/runtime-token-savings-v2`

Before implementation:

1. Create or switch to the dedicated branch.
2. Port or cherry-pick the Runtime Intensity V1 commits only if they are not
   already present.
3. Keep Runtime Knowledge/SEKB changes separate unless a design document and
   harness task explicitly says they are part of this feature.

## Subagent Review Lanes

Goal mode should use subagents for independent review lanes:

- Policy lane: verify `thinkLevel` mapping, prompt mode preservation, and no raw
  `thinkLevel` reparsing.
- VerseShell lane: verify host selection, schema consistency, fallback,
  approvals, and Windows execution behavior.
- Reducer lane: verify command classifiers, reducers, recovery pointer, and
  evidence preservation.
- Skills lane: verify Ponytail low/medium behavior and transient skill prompt
  limits.
- Privacy/report lane: verify reports have structured metrics and no raw prompt
  or raw output leakage.
- Metrics lane: verify before/after char counts, estimated token savings, and
  fixture benchmark output.

Subagent reports are advisory. The main agent must personally inspect the code
and tests before claiming completion.

## Acceptance Criteria

Implementation is complete only when all criteria pass:

- Runtime token savings policy is a typed object consumed by runtime code.
- No runtime consumer reparses raw `thinkLevel`.
- Explicit prompt mode, raw model run, and explicit exec host semantics are
  preserved.
- VerseShell is consistently valid across types, Zod schema, session patching,
  directives, and runtime host resolution.
- VerseShell preference is live for eligible calls at configured levels, or the
  report clearly says why it was not used.
- Output reducers produce compact output for supported command families.
- Reducers never hide exit code, failure status, critical stderr, file paths, or
  first meaningful error evidence.
- Truncated or failing compacted output has a raw recovery pointer when raw
  output exists.
- Caveman-style prose compression protects technical spans.
- Ponytail-style skill behavior affects `low` and `medium` prompt rendering.
- Skill registry and persisted skill snapshots are not mutated by transient
  prompt limits.
- Reports include structured savings metrics and no raw prompt/output payloads.
- Quantitative fixture benchmark is checked in and gives before/after chars and
  estimated tokens.
- Existing Runtime Intensity V1 tests still pass.
- New reducer, VerseShell preference, report privacy, and skill strategy tests
  pass.

## Required Verification

Implementation should include at least:

- Unit tests for policy mapping and preservation semantics.
- Unit tests for VerseShell host/schema consistency.
- Unit tests for reducer families and generic fallback reducer.
- Unit tests for raw recovery pointer behavior.
- Unit tests for Caveman protected span compression.
- Unit tests for Ponytail low/medium skill prompt strategy.
- Unit tests for report privacy and savings metadata.
- A fixture benchmark command that outputs before/after chars and token
  estimates.
- `pnpm harness validate --spec harness/specs/tasks/runtime-token-savings-v2.md`
- Narrow Vitest runs for new tests.
- Typecheck or repository-approved equivalent.
- Comms replay/compare if runtime communication paths are touched.

## Non-Goals

- Do not vendor or execute external RTK, Caveman, or Ponytail code.
- Do not change VerseShell permission model without a separate security task.
- Do not add UI unless runtime behavior becomes user-visible and a UI spec is
  written.
- Do not claim real token savings from synthetic unit tests alone.
- Do not merge this with Runtime Knowledge/SEKB UX work.
