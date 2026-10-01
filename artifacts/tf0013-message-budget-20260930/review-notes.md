Review the TF-0013 embedded ContextEngine message replacement budget change only.
Every finding code_location.file_path MUST contain a
repository-relative path with forward slashes (for example
openclaw_runtime/src/context-engine/context-candidate.ts); this helper rejects
Windows drive-letter absolute paths.
The scope is the modified context-candidate, turn-injection-budget, registry,
rc03-seal-hook, embedded extensions, attempt, and their test files, plus
the UAS-02 Harness spec and documentation. Do not review the unrelated untracked
verseconf exploration document or Windows cache directory. Do not run tests or
edit files; the main agent owns serial validation.

Trace the actual before_agent_start/context/tool-loop lifecycle, candidate
precedence and atomic accounting, immutable history snapshots, registry fallback,
and wire/receipt binding. Existing native Codex plugin-owned assembly is not
changed or claimed closed by this slice. Identify concrete regressions in this
patch, including retained history, rewritten summaries and structured tool pairs.
The original 6000/0.1 defaults and product locks remain unchanged.

Focused proof after the lifecycle fixes: 20 actual embedded-entry tests, 115 unit tests,
24 extension tests passed. Two additional tool-registry preparation checks and the
final full scoped verification are running serially in the main agent. The new real
entry tests replace only the core ContextEngine producer via a prototype spy;
the runner, history load, projection, tool loop, seal, wire serialization and
receipt store are real, with fetch intercepted before networking. Evidence is
development-only, not a new formal RC verdict. Registry fallback clones assemble
messages before invocation so a producer that mutates and then throws cannot
contaminate the fallback transcript.

Prior review findings are saved in autoreview-r1.json. All three were accepted.
Assembly now runs after orphan repair/heartbeat filtering; the existing projection
factory exposes its preparation step for precheck, and the admitted replacement is
materialized into activeSession before pressure estimation. Tool-registry preparation
is shared with before_agent_start through one promise, and is kill-switch guarded.
Candidate admission validates the live prefix before charging. Pure pass-through
is compared by value, so cloning does not mark a producer. New real-entry modes
cover 200k-character history reduced to a fitting summary, orphan repair, plain
pass-through, and free windowing. Please verify the final code, not the old approach.

Second valid review is saved in autoreview-r2.json; both findings were accepted.
The runner now materializes the admitted replacement exactly once. Cached
projectContextCandidates no longer applies replacements; only the attempt calls
the owner helper before precheck. Optional source preparation errors are caught
around gathering only, so final budget arbitration still runs on valid collected
candidates. New real-entry modes exercise empty-history content normalized by
replay and a throwing production BlockStore.query. Tests/lint are being rerun.
