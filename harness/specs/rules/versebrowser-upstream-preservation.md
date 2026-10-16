---
id: versebrowser-upstream-preservation
title: Preserve VerseBrowser implementation and task continuity during reintegration
type: ai-coding-rule
appliesTo:
  - versebrowser-upstream-reintegration
severity: error
---

**Pinned implementation.** The source authority is commit 47b076f85d4e37cdaea67c1564d1c4f4dbf2b011, not the 0.3.1 string or a floating branch. Protect the 127 product source files and the recorded build/license/test inputs in ../fixtures/versebrowser-reintegration/source-lock.json. Only CRLF/LF transport normalization is allowed without a declared patch. The source lock is preparation data; it does not itself implement a gate or grant acceptance.

**Preserve, do not regenerate.** Mechanically import the module and adapt existing host seams. Do not rewrite facade/service/upstream-control/recorders from descriptions, cherry-pick convenient functions, flatten directories, rename away methods, or simplify implementation during the move. Necessary changes have a narrow patch record, original bytes, reason, caller inventory and regression evidence. Source changes and dependency modernization are separate work.

**Module boundary.** Use a private workspace module or a content-pinned minimal package through public exports. Do not import the independent repository, its Git history, root policies, release/benchmark project, task forest, .local, .ae, node_modules or pre-existing dist. Preserve LICENSE and the required upstream patch. Select tests and their complete file/glob/fixture closure by actual consumers, not directory-name guesses. Excluded histories stay locally recoverable.

**Dual-sided behavior.** Preserve the existing 67 host methods and account for all 13 source additions. Retain ClawX SandboxDenialError, resource-envelope, safeStorage/profile state and Runtime provenance/ownership. Retain VB terminal-task protection, unknown-step rejection, sensitive URL protection, source-map/observation/verdict behavior and its Gateway sandbox gate. Matching method names or copied files is not behavioral parity.

**Task and state conservation.** Keep source project+task ID+source SHA as the external key. Never concatenate or overwrite canonical forests; all 190 source IDs collide with host IDs. Preserve complete original lists/evidence/status and allocate host IDs through Task Forest CLI. Source done is historical completion, not host integration acceptance. Keep the two intentionally deferred source scopes deferred. Preserve task store IDs/status/approval/recovery and workspace/profile/evidence state; no temporary-directory fallback or second default TaskService may replace host-owned state.

**Single host authority.** Renderer calls remain behind host-api/api-client; transport remains Main-owned. Use existing approval, workspace, audit, resource and governed lifecycle owners. Register actual permission hooks, per-call policy and audit availability. A facade or no-op recorder does not prove authorization. Do not add another planner, permission authority, process supervisor or write-effect replay mechanism.

**Exact result adaptation.** Preserve error categories and details, business verdict, collection completeness, body text, truncation/omissions, source/ownership/correlation IDs and recovery references. Unsupported/not_run/unknown are explicit. A successful action, screenshot, upstream isError=false, import, mocked UI or healthy console does not prove business success. Enforce catalog intersect policy intersect driver at exposure and invocation.

**Dependency and delivery integrity.** Record source lock and target pnpm resolution separately. Preserve the two intended Playwright families and the exact patched upstream version. Do not override them to the host's E2E version. Do not weaken the Node/libuv/Electron constraints. Validate pnpm patch ownership and store isolation before mutation. Include all production dependencies/assets in the actual packaged runtime; no .local or development checkout dependency is allowed.

**Cancellation and side effects.** New selection applies only to new sessions. Do not migrate page/ref/cursor handles across backends, claim another task's browser, or rewrite terminal tasks on late completion. No production shadow execution of clicks, submits, uploads or downloads. Uncertain effects are reported, never silently retried through another implementation. Cleanup affects owned resources only and preserves failure/recovery evidence.

**Acceptance independence.** Freeze expectations and the control runner outside the candidate before implementation. Preserve original assertions and discovery. No added skip, removed negative case, relaxed golden/schema or stale report may manufacture a pass. Compare A=current host, B=pinned source, C=host-integrated module on independent fixtures with declared normalization. Bind on-disk receipts to tested code, fixture, tests, lock, toolchain, build and package identities; changes invalidate dependent evidence.

**Honest automated interaction.** Under the owner's policy, any interaction or verdict needed for this migration is automated and labeled driven_by: agent and actor: codex. Do not wait for owner clicks/data, fabricate real-human evidence, solve real CAPTCHA or rewrite archived humanSteps. Use a separately registered agent-equivalent continuation fixture; the historical mig-22 not_run remains historical.

**Bounded execution and closure.** Preserve unrelated dirty edits; one ready checkpoint per session, large output on D. Task Forest proposal application requires current base_graph_hash and complete evidence; list fields are preserved in full. Product lock/default changes, major architecture/scope changes, publication/credential authority and destructive operations remain separate owner decisions. Routine verification and evidence-backed closure follow the repository override. Do not close the migration on source-preservation or preparation evidence alone.
