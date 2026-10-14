---
id: verseshell-upstream-preservation
title: VerseShell upstream preservation and evidence-bound migration
type: ai-coding-rule
appliesTo:
  - verseshell-upstream-reintegration
severity: error
---

**Source authority.** Upstream commit c06f406e83566bb968448222d9c8caf429e580a0 owns the runtime implementation. Preserve its core, Cargo files and regression inputs. Only declared residual patches may change those bytes. Normalize CRLF/LF only; similarity scores, whitespace-insensitive diffs and a model's claim of semantic equivalence are not source preservation evidence.

**No rewrite migration.** Do not translate the Rust runtime into TypeScript, replace it with native shell wrappers, regenerate source from descriptions, reimplement reducers or copy a selective set of functions. Host work is limited to the existing adapter, contract, policy and observation seams. A new core source file, missing module, changed dependency or modified upstream test requires a prior, explicit exception record and re-frozen contract.

**Preserve total capability.** Treat the 32-operation inventory and cross-cutting behavior inventory as protected requirements. Every item keeps its upstream implementation and a declared host or internal owner. A runtime-internal capability need not become a public model tool, but it needs core acceptance and an ownership explanation. Existing 147 removed-module stubs are not delivered capabilities. No required item may be renamed away, deprecated, waived or marked not-applicable to obtain completion.

**Host ownership.** Use the current Typed ACI, governed process/exec, readonly facade, patch preview, result-query and write-journal chain. Keep command policy, approval, resources, model projection and product configuration under ClawX. MCP remains external compatibility. Do not add a second executor, resource manager, approval authority or user-workspace journal.

**Exact adaptation.** Declare every wire-to-host and host-to-model field mapping. Preserve error classes, partial failures, body text, pagination, omitted bytes and artifact ownership/TTL. Unknown identity or schema fails closed. Do not loosen all exactKeys checks, replace unknown byte counts with fabricated zeros, drop new guidance, suppress failed frames or treat a missing artifact as an empty success.

**No test laundering.** Frozen upstream tests and acceptance definitions are immutable to the migration implementation. Do not delete assertions, add skip/ignore, narrow discovery, substitute a mock for a real gate, update a golden from the candidate or treat a failing old gate as newly inapplicable. A genuine test defect is handled by a separate exception with a reproducer, preserved original and replacement that proves the intended behavior.

**Proof of real routing.** Require agent-driven host calls against the verified binary, with request/operation correlation and source/binary/host/fixture hashes. Intervention fixtures must prove that unavailable or wrong binaries and owner/policy/catalog/path conflicts fail, without native fallback or implicit replay. The checked effective source must be the exact source root used by the trusted build recipe; checking a pristine substitute while building another tree is invalid. Do not shadow-run writes, process start or external effects to compare versions; use separate disposable fixtures.

**Differential acceptance.** Compare the old effective baseline, standalone new effective runtime and host-routed new runtime. Normalize only declared unstable metadata and presentation mappings. Compare errors and information preservation, not just success flags. Core-only and fixture-only tests cannot replace host acceptance.

**Evidence authority.** Completion comes from current on-disk receipts for the final candidate, not an agent's prose or an editable passes field. Record command, exit, code/test/fixture/toolchain/source/binary identities, times and artifacts. Hash tested inputs before and after. A changed input invalidates dependent evidence; incomplete or unavailable collection is NOT_RUN or UNKNOWN, never PASS.

**Trust separation.** Run final acceptance from a separately frozen control checkout or protected CI configuration. Do not load the acceptance runner, expected values or source lock from the candidate being evaluated. Local hashes detect drift; they do not make the same agent's writable workspace tamper-proof. Any acceptance-contract change is separately reviewed and re-baselined before candidate testing.

**No migration-plus-cleanup.** No unsolicited formatting, rename, dependency modernization, DSL pruning, stub removal, product redesign or default changes in this task. Register necessary narrow exceptions with evidence. Source preservation and behavioral acceptance take priority over reduced line count or an attractive progress percentage.

**Boundaries and continuity.** Keep large outputs on D; preserve unrelated edits and local Task Forest data. Work one checkpoint at a time, and leave a state record with input hashes, commands, results and next action. Use automated agent-driven interaction, never fabricated human evidence. Do not change frozen defaults, scope, credential exposure or publication authority during routine migration closure.
