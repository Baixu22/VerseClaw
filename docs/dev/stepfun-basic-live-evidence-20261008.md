# StepFun basic live evidence — 2026-10-08

`driven_by: agent` · `actor: codex-stepfun-evidence`

In progress. Authenticated model discovery and one bounded direct completion
returned step-5-preview. Desktop conversation evidence is not yet established.
The task is limited to real-provider basic turns, context recall and usage,
using synthetic prompts and isolated configuration. No credential is retained
in this document or committed evidence.

The first desktop attempt stopped during Playwright configuration validation:
trace/video options must be declared at file scope, not inside describe. No test
or model turn executed in that attempt. The receipt remains under attempt-1.

The owner selected script-only validation. Desktop attempts remain failed evidence
and the original desktop test is restored. New validation uses HTTPS and the real
Gateway RPC, with synthetic data and bounded request counts. No UI pass is claimed.

Script attempt 1 received HTTP 200 streaming output and usage, then hit a local
report-formatting bug on an absent error object. The helper now handles undefined;
the original request receipt is preserved and is not marked as a complete pass.

Script attempt 2 passed streaming and synthetic function-call roundtrip. Gateway
received HTTP 200 and 25,035 reported tokens, but persisted an empty assistant
content array. This is retained as a runtime-response failure; diagnostic reads
will inspect response shape without retaining credentials or internal prompts.

The real-provider empty response exposed a production transport defect: a usage
object caused an early continue, discarding text/tool deltas and finish reason
in the same SSE frame. Two synthetic regression cases fail the original parser.
The minimal fix processes both usage and choices; no provider default is changed.
README English/Chinese/Japanese provider setup claims remain applicable.
