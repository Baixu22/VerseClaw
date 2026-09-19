---
id: verseshell-external-write-policy-boundary
title: VerseShell External Write Policy Boundary
type: ai-coding-rule
appliesTo:
  - verseshell-p3-external-write-policy
  - gateway-backend-communication
severity: error
---

# VerseShell External Write Policy Boundary

- External process writes are classified on the host-owned immutable command plan before approval. The model cannot select, override, or suppress the classification.
- The existing OpenClaw exec approval pipeline is the only authorization surface. External-write classification adds visibility; it never widens authority, bypasses ask/allow/deny, or creates a second approval channel.
- Compiler, script, Git hook, terminal-shell, and unknown mutating commands are external writes. Read-only Git and common read-only commands are not.
- A read-only claim is keyed on the operator's own bare command name, never on a basename alone. A path-specified executable, a script payload, and an audited `windows-cmd` interpreter plan are external writes regardless of which profile their name resembles.
- Read-only claims enumerate the permitted flags and reject anything unrecognized. A flag that writes a file, mutates config or refs, or executes a command value defeats the claim even when it appears beside a read flag.
- Every external-write policy records `rollbackClaim=false`. ClawX write journal remains the only commit, undo, stale-write, and recovery authority.
- The approval warning is static and bounded. It must not copy argv, command text, paths, environment values, credentials, or tool output.
- The renderer redaction for an external-write approval removes every field derived from the request, including any request digest built from command, path, or parameter content. Every surface that shows an approval reads it through that redaction helper, never off the raw event.
- An external write must not be surfaced as less severe than a journal-covered risk. It is the one class with no automatic rollback.
- A runtime approval event that carries the static warning keeps its rendered row. The runtime exec approval plane and the ClawX host permission store are disjoint, so a promotion that drops the row removes the only rendering of that text.
- The two planes stay disjoint by decision (2026-09-19). The repository-wide metric "undeclared external write = 0" is retired: it measures a cross-plane property this boundary does not provide. The metric is scoped to the ClawX host permission plane, where the out-of-workspace `files.writeText` classification is the only `external-write` producer. Do not re-open a bridge between the runtime exec approval and the ClawX approval store. The runtime classification may cross the boundary as display-only `risk` data; it must never gain a decision affordance.
- Effectful requests are never automatically replayed, and a VerseShell failure must not fall back to native shell, MCP, or legacy eval.
- Do not add a feature flag, journal, undo stack, transaction owner, telemetry authority, or product-lock change for this classification.
