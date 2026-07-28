---
id: coding-runtime-workspace-dcs-producer-boundary
title: Coding Runtime Workspace and DCS Producer Boundary
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
---

# Coding Runtime Workspace and DCS Producer Boundary

## Workspace Authority

- Renderer submits workspace identity only. Electron Main resolves the trusted
  `rootPath`; renderer-provided paths, cwd values, sandbox roots, and tool
  authority are untrusted input.
- One accepted workspace authority becomes the run's `workspaceDir`, cwd,
  file-tool boundary, and sandbox root. A run with disagreeing values is an
  error, not a best-effort fallback.
- Bind each runtime session to a workspace fingerprint derived from the trusted
  resolved root. A workspace change invalidates the old DCS scope or creates a
  new session. Never reuse Blocks from a different workspace silently.

## Producer Boundary

- Only production mutation tools (`edit`, `write`, `apply_patch`) may emit a
  `details.working_memory` envelope in this slice.
- A successful producer may explicitly emit `high` with a structured
  `result_summary` of at most 100 characters. A failure or partial result may
  emit `medium` only when that producer owns explicit structured status;
  otherwise it emits nothing.
- Hook and extension code must not derive summary or significance from tool
  names, arguments, stdout, raw text, or error strings.
- Read, search, CodeGraph, generic exec/process, and planner tools emit no
  working-memory envelope in this slice.

## DCS and Prompt Boundary

- Stage 1 owns persistence and visibility. A valid producer envelope reaches
  the existing sink/handler and is visible on the next LLM call only.
- `## Recent Actions` is a transient per-call context transform. It is exactly
  one block per call, does not append to transcript history, and does not
  accumulate between calls.
- Missing, malformed, or absent `details.working_memory` means zero inference,
  zero handler call, zero BlockStore write, and zero injection.
- The working-memory flag remains default false. Flag-off and no-envelope paths
  are reference/byte-level no-ops with no BlockStore construction, query,
  write, or producer-metadata dependency.

## Post-Write Verification Boundary

- Automatic test execution is explicit opt-in and default false through
  `runtime.coding.autoVerify.enabled`.
- Detection may select one nearest project root for the changed paths. Changes
  spanning multiple project roots must skip with a visible reason unless an
  explicit workspace-level custom command is configured.
- Execution must call the final effective `exec` tool after tool-policy and hook
  wrapping. Do not spawn from write-side effects or create another approval,
  sandbox, process, or timeout service.
- Pass, failure, timeout, denial, approval-required, crash, unavailable, and
  disabled outcomes are bounded and visible. No verify outcome may roll back or
  reclassify a successful mutation or its write-journal record.

## Prohibitions

- Do not implement DCS Stage 2 task_state/handoff, COMPASS, AgentMap, AST,
  SEKB, LSP, CodeGraph ranking/indexing, or always-on promotion.
- Do not create a second workspace store, context engine, event bus, session
  classifier, or direct Renderer-to-Gateway/IPC/HTTP/WebSocket path.
- Do not claim coding benefit from injection, BlockStore reads, or a synthetic
  envelope alone. Effect evidence compares matched coding replays and reports
  task pass rate, verification pass rate, tokens, latency, repeated tools, and
  wrong-workspace access.
