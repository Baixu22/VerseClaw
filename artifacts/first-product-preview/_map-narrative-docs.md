Survey complete. Findings below.

---

# FP-P1-08 Doc/Narrative Survey

## 1. README.md (root) — `C:\Users\27933\Desktop\clawx\ClawX-maturity-p0\README.md` (614 lines)

**What it claims.** A general-purpose cross-platform desktop app for OpenClaw agents. Scope is unbounded: platform badge (L22) says `MacOS | Windows | Linux`, System Requirements (L244) says "macOS 11+, Windows 10+, or Linux (Ubuntu 20.04+)". There is **no mention anywhere of "Windows x64 · DCS Coding Controlled Preview"**, no first-release scope section, and no exclusions list. `grep -c "DCS"` on README returns exactly **one** hit (L494, inside the VToken paragraph). The FP-P1-03 one-switch product path (Settings → Developer → DCS Coding Preview) is **absent from README entirely**.

**Good news on banned words:** README has **0 hits** for all five patterns. The narrative problem is not banned vocabulary — it is *unmarked* feature paragraphs presented in the same declarative present tense as shipped features.

**Production-readiness claims by component** (all written as plain indicative "Verse Claw does X", which reads as production):

| Line | Component | Current text (quoted) | Problem |
|---|---|---|---|
| 494 | **VToken** | "Verse Token (`packages/vtoken`) is an **opt-in** Working Context assembly foundation... It is **disabled by default** and does not replace the production DCS ContextEngine path." | **Already correct.** Only component in README with an explicit annotation word. Use as the template for the rest. |
| 169 | **SEKB** shadow eval | "`runtime.contextBlock.sekb.shadowEvaluation.enabled` is an explicit **default-off** operator flag." | Says default-off but never says `deferred`. Per task word table SEKB auto writeback = `deferred`. |
| 171 | **SEKB** batch distillation | "The optional `...batchDistillationAssistant.enabled` is also **default-off**..." | Same — flag state stated, annotation word missing. |
| 173 | **SEKB** Hermes | "All features remain **default-off** and never auto-write principles... Offline artifacts... are non-authoritative evaluation evidence." | Strongest of the SEKB three; still no `deferred` tag. |
| 179-186 | **SEKB** CLI/Host API | Bare bullet list of `pnpm sekb:hermes:*` commands + Host API method names | Listed with no status qualifier at all. Reads as shipped tooling. |
| 192 | **worktree** | "The Workspace sidebar includes a Git workbench for... stashes, **worktrees**, and GitHub pull requests... **Worktree add supports** new-branch and existing-branch flows, with new worktrees **placed next to the repository by default**." | **Highest-severity claim.** Flatly indicative. Program README L46 explicitly excludes 默认 worktree; runbook L14 pins `worktree.backend = inprocess` and L72 lists reverting to `inprocess` in the kill order. README implies worktree is a normal working feature. |
| 204, 206 | **Browser** | L204 "Scheduled tasks **can also run** Agent Browser automations... so jobs such as check-ins, page monitoring, or draft publishing **can reuse persisted login state**"; L206 "The sidebar Agent Browser workbench **exposes** isolated profiles, tabs, and sessions" | Program README excludes "Browser 无监督/私网". Task table says Browser supervised = `experimental`. Neither line says supervised-only or experimental. L204's unattended-cron framing is the direct opposite of "no unsupervised browsing". |
| 208 | **Browser** Reach Readers | "the existing Agent Browser profile provides a guarded page fallback or visible login handoff" | Same surface, same missing `experimental`. |
| 110 | **Runtime Memory** (Dreams) | "the sidebar also provides a native Dreams page for OpenClaw **memory review**, dream diary inspection, and basic maintenance actions" | Task table: Runtime Memory = `diagnostics-only`. Presented as a memory feature. |
| 167 | **Runtime Memory** / Knowledge Hub | Very long paragraph: "The Knowledge page **manages** source-backed wiki context... **It offers** status, search, inspect, compile, lint, Knowledge Inbox, draft/proposal review, provenance, and governance workflows." | Densest unqualified feature block in the file. Read-only scope is described, but no `diagnostics-only` / `opt-in` tag. |
| — | **patch-flow** | **Zero mentions in README.** | Runbook L57 says "do **not** set `patchFlow.default=true`"; program README L46 excludes 默认 patch-flow. Absence is safe; no annotation needed, but note it so the implementer does not add one. |
| — | **WAL** | **Zero mentions in README.** | Excluded in program README L46. Safe by absence. |
| 40 | Capability Claim Boundary | "Product capability statements must be checked against the canonical matrix in `shared/capability-claims.ts`... before being described as implemented, productized, stable, or end-to-end verified." | The governance hook already exists at the top of README. **This is where the first-release scope + exclusions block should be attached.** |

## 2. docs/clawx-product-semantics.md (79 lines)

**0 banned-word hits.** This doc is structurally the healthiest of the three — it is built around boundaries, has an explicit "Unsafe Claims" section (L23-31), and already distinguishes semantic status from implementation status (L65-69: `done` / `todo` / `defer`).

**Gaps:**
- L3 `Last updated: 2026-07-06` — 20 days stale relative to the FP program (task doc dated 2026-07-26).
- **Its vocabulary is a different, incompatible axis from FP-P1-08's.** It uses `done`/`todo`/`defer` (L67-69) and `null`/`shadow`/`active` (L21, L38). The task's mandated table is `production (preview)` / `opt-in` / `deferred` / `experimental` / `diagnostics-only` / `retired`. Note `defer` (L69) vs `deferred` (task table) — near-collision, must be reconciled or explicitly declared as separate axes.
- Concept Boundaries table (L14-21) covers Chat / Plan mode / Chat Plan / Task Ledger / Workboard / Task Loop / Routing Memo. It contains **no row for DCS Coding, SEKB, Browser, VToken, Runtime Memory, worktree, patch-flow, or WAL** — i.e. none of the FP-P1-08 components. This is the natural home for the component annotation table (task slice 5).
- Positioning (L9) "ClawX is an agent workbench" — still uses the old "ClawX" name while README uses "Verse Claw" throughout. Naming drift worth flagging.

## 3. docs/dcs-production-p0-runbook.md (132 lines) — flag-enable path

**0 banned-word hits.** Directly answers your question: it documents **both**, correctly layered, and the one-switch path is already first.

Three tiers, in this order:
1. **L24-34 "Simplest: the one-switch DCS Coding Preview (FP-P1-03)"** — one switch composing `context-view-tools` + `working-memory` + `tool-registry` + `stale-write-guard`, single gateway restart, single child acknowledgement. Explicitly names the excluded set (L33-34): "Excluded components (VToken, RM inject, SEKB writeback, Browser, shadows, symbol-lease) are NOT part of this switch". Says "Default off; upgrades never auto-enable it."
2. **L36-49 "Per-flag: Settings control plane (TASK-P0-01)"** — 5-row allowlist table of individual UI switches.
3. **L51-59 "Advanced: env / hand-edited config"** — 7 numbered env/config recipes.

So the answer is: **one switch is documented as the product path, with N switches retained below it as per-flag and advanced escape hatches.** Task acceptance criterion "runbook 更新为 `FP-P1-03` 的「一个开关」路径" (task L51) **appears already satisfied**. The zh-CN mirror `docs/dcs-production-p0-runbook.zh-CN.md` (127 lines) also has the section at L24 ("最简：一个开关的 DCS Coding Preview（FP-P1-03）") and L34 — the two runbooks are in sync. Recommend the implementer verify and tick this criterion rather than re-doing it.

Other runbook content worth reusing: Safe defaults table (L7-20), kill/close order (L64-75), Windows notes (L77-82, incl. "Prefer `inprocess` worktree backend"), Forbidden in P0 (L126-132).

## 4. docs/dev/first-product-controlled-preview/README.md (61 lines) — authoritative scope

The canonical source. Key content the other docs must be reconciled against:

- **Product name (L5-6):** "Verse Claw Windows x64 · DCS Coding Controlled Preview / 内部、单 workspace、显式 opt-in、可回滚"
- **Graduation ladder (L22-30):** `P0 engineering green → Controlled Preview → P1 limited canary → liveReady → productApproved → per-surface default graduation → joint GA`. Note lines 26/27/29 contain `liveReady`, `productApproved`, `joint GA` — these are **legitimate ladder-rung names, exempt**.
- **纳入 / INCLUDED (L44):** DCS context read/search/view、指定 workspace 受控写入、write journal + undo、workspace/permission authority、token/latency/outcome 最小观测、runtime acknowledgement、restart/recovery、kill/rollback、脱敏 support bundle
- **排除 / EXCLUDED (L46):** Runtime Memory 注入、SEKB 自动写回、Browser 无监督/私网、VToken 默认能力、C6 自动 context ladder、C7 knowledge/routing cutover、**WAL**、**默认 worktree**、**默认 patch-flow**、联合系统 GA
- **禁止 (L56-60):** includes "翻默认值来「证明可用」" and "不得用文案升级掩盖能力缺口" (echoed in task Hard locks L85)

## 5. docs/dev/dcs-visible-production/RETIRED-SURFACES.md (23 lines) — annotation style to reuse

The pattern to copy:

- **Title carries the task id:** `# Retired / non-product surfaces (TASK-P0-06)`
- **Blockquote purpose line (L3):** "> Living list of **do-not-sell / do-not-recommend** surfaces so agents and docs do not present them as live product features."
- **4-column table (L5):** `| Surface | Product status | User path | Replacement |`
- **Status cell format:** bolded word + `·` + machine-checkable evidence, e.g. `**RETIRED** · enabledByDefault: false`
- **User path cell** names where a user can/cannot reach it: "No Settings feature; plugin desc starts with RETIRED"
- **Replacement cell** always points somewhere live: "DCS Fact view tools (opt-in Settings → Developer → DCS Production Flags)"
- **"## Agent rules" numbered list (L12-17)** — imperative do/don't for agents reading the doc
- **"## Verified <date>" footer (L19-23)** — dated checklist of what was confirmed

For FP-P1-08 the analogous table should be `| Surface | Annotation | Where user sees it | Evidence / gate |` with annotation drawn from the task's six-word table.

## 6. Banned-word scan

Command: `grep -rnE "liveReady|productApproved|\bGA\b|default-on|生产可用" README.md docs/ src/`

**255 hits across 66 files.** Distribution:

| Location | Files |
|---|---|
| docs/dev (+ subdirs) | 55 |
| docs/context-family, docs/context-runtime-kit | 8 |
| docs/superpowers/plans, docs/enhancements | 5 |
| **README.md** | **0** |
| **docs/clawx-product-semantics.md** | **0** |
| **docs/dcs-production-p0-runbook.md (+ .zh-CN)** | **0** |
| **src/ (text files)** | **0** |

`src/` matched 16 paths but **all are binary false positives** — PNG/JPG assets under `src/assets/brand/` where the byte sequence `GA` appears in image data. Re-scanning with `--include='*.ts' --include='*.tsx' --include='*.js' --include='*.json' --include='*.md' --include='*.css'` returns **zero hits**. No UI string or i18n key contains a banned word. Task slice 4 (UI 文案与 i18n) has no banned-word remediation to do — only the positive work of adding annotation words.

**The critical finding: the three primary narrative surfaces are already clean.** ~95% of the 255 hits are governance docs using the words in *prohibitive* context ("禁止 default-on", "Not liveReady", "NO-GO"), which the task's own carve-out "（除对应门禁任务 done）" permits. These need an exemption note, not edits.

### Hits requiring an actual judgement call

These are the only ones where the word is used **assertively**, not prohibitively:

| File:line | Current text | Recommended annotation |
|---|---|---|
| `docs/context-runtime-kit/README.md:36` | `## Default-On Promotion` (section heading) | Heading is assertive. Retitle `## Default-On Promotion (backend CRK only — scope note)` or add blockquote scoping it to CRK backend, distinct from DCS surfaces. |
| `docs/context-runtime-kit/README.md:41-43` | "Backend context, prompt addition, and recovery **may use** the core-owned `context-runtime-kit` engine **by default** when `plugins.slots.contextEngine` is absent" | Real shipped default-on for CRK backend — legitimate but easily misread as DCS default-on. Add explicit scope line: this is CRK engine selection, **not** a DCS/coding surface graduation. |
| `docs/context-runtime-kit/goal-progress.md:561` | "Status: **complete for backend default-on promotion**" | Assertive completion claim. Annotate `opt-in` scope boundary + note it does not imply any FP component graduated. |
| `docs/dev/DCS-VISIBLE-FEATURES-PRODUCTION-GAP.md:427` | "**出口**：对你定义的「看得见的主功能」**已生产可用**（可仍非全员默认）" | Forward-looking exit criterion phrased in perfect tense. Reword to conditional or mark the whole §as target-state, not current-state. |
| `docs/dev/DCS-VISIBLE-FEATURES-PRODUCTION-GAP.md:540` | "此时主可见 DCS 能力从 shelfware 变成**生产可用**（仍可非全员默认）" | Same — hypothetical framed as achieved. Add `production (preview)` scoping or subjunctive. |
| `docs/dev/DCS-VISIBLE-FEATURES-PRODUCTION-GAP.md:475` | "\| 已接近生产可用 \| 仍是只能看 / 专家才能用 \|" | Comparison-table cell; mildly assertive. Low priority. |
| `docs/dev/DCS-VISIBLE-FEATURES-PRODUCTION-GAP.md:1,15,34` | Title "DCS 可见功能 → 真正生产可用：完整缺口清单"; "§0 你要的「生产可用」定义"; glossary row "生产可用（Production-usable）" | These *define* the term rather than claim it. **Exempt** — but the doc should carry a header note saying it is a gap-analysis target-state document. |
| `docs/context-family/task-slices.md:86` | "- Production default-on registration." (under a non-goals/exclusions list) | Prohibitive context. **Exempt.** |
| `docs/enhancements/sekb-hermes-inspired-optimization-design.md:64` | "Filter / default-on remain **deferred**" | Already uses the exact task-table word `deferred`. **Exempt — and it is the best existing example in the repo.** |
| `docs/enhancements/sekb-runtime-roadmap.md:15` | "The current branch intentionally **does not add** a desktop UI, default-on runtime..." | Prohibitive. **Exempt.** |
| `docs/superpowers/plans/*.md` (3 hits) | All "No ... default-on ..." negations | Prohibitive. **Exempt.** |

---

# Worklist

Ordered by risk. Files are absolute paths.

### A. README.md — the main body of work
`C:\Users\27933\Desktop\clawx\ClawX-maturity-p0\README.md`

| # | Line | Action | Annotation word |
|---|---|---|---|
| A1 | after 40 | **Add first-release scope block** under the existing "Capability Claim Boundary" heading: name "Windows x64 · DCS Coding Controlled Preview", copy 纳入/排除 verbatim from program README L44/L46, link `docs/dev/first-product-controlled-preview/README.md` | `production (preview)` |
| A2 | 192 | Qualify the worktree sentence — backend default is `inprocess`, git worktree is request-only | `opt-in` (git backend), note default worktree is **excluded** |
| A3 | 204 | Qualify Agent Browser cron automation — supervised only, no unsupervised/private-network | `experimental` |
| A4 | 206 | Qualify Agent Browser workbench | `experimental` |
| A5 | 208 | Qualify Reach Readers browser fallback | `experimental` |
| A6 | 110 | Qualify Dreams / memory review page | `diagnostics-only` |
| A7 | 167 | Qualify Knowledge Hub block; state RM injection is excluded from first release | `diagnostics-only` |
| A8 | 169, 171, 173 | Add explicit word to the three SEKB paragraphs (they already say default-off) | `deferred` (auto writeback), `opt-in` (shadow eval flags) |
| A9 | 179-186 | Add one status line above the SEKB CLI/Host API lists | `deferred` |
| A10 | 494 | **No change** — already correct; use as style template | `opt-in` ✓ |
| A11 | 22, 244 | Reconcile platform breadth with Windows-x64-only first release: keep app-level cross-platform, but scope the *preview* to Windows x64 | scope note |
| A12 | — | Do **not** introduce patch-flow or WAL text (currently absent, correctly) | n/a |

### B. docs/clawx-product-semantics.md
`C:\Users\27933\Desktop\clawx\ClawX-maturity-p0\docs\clawx-product-semantics.md`

| # | Line | Action |
|---|---|---|
| B1 | 3 | Bump `Last updated` to edit date |
| B2 | 14-21 | Add component rows to Concept Boundaries: DCS Coding, SEKB, Browser, VToken, Runtime Memory, worktree, patch-flow, WAL — each with exactly one annotation word (task acceptance L48) |
| B3 | 23-31 | Extend "Unsafe Claims" with the FP exclusions (RM injection is a memory feature / SEKB auto-writes / Browser unsupervised / worktree is default) |
| B4 | 65-69 | Reconcile `done`/`todo`/`defer` with the FP six-word table; call out `defer` vs `deferred` explicitly so they are not conflated |
| B5 | 9 | Naming drift: "ClawX" vs README's "Verse Claw" |

### C. docs/dcs-production-p0-runbook.md (+ .zh-CN.md)
`C:\Users\27933\Desktop\clawx\ClawX-maturity-p0\docs\dcs-production-p0-runbook.md`

| # | Action |
|---|---|
| C1 | **Verify-only.** One-switch FP-P1-03 path already documented at L24-34, zh-CN mirror at L24. Tick task acceptance L51; no rewrite needed. |
| C2 | Optional: cross-link runbook L33-34 excluded-components list to program README L46 so the two exclusion lists cannot drift. |

### D. New component annotation table (task slice 5)
Create alongside `RETIRED-SURFACES.md`, reusing its exact style (title-with-task-id, blockquote purpose, 4-col table, "## Agent rules", "## Verified <date>"). One row per component; annotation cell restricted to the six task words. This becomes the single lookup that satisfies "每个组件在文档中有且仅有一个标注词".

### E. Banned-word exemption note
Add to the FP-P1-08 task doc's "Test / evidence" section (line 67, "禁止词扫描结果贴此处"): the 255-hit scan result, the finding that README + product-semantics + both runbooks + all `src/` text files are **0-hit**, that all 16 `src/` matches are binary image false positives, and the ~11 assertive hits from the table above as the only real remediation candidates. Everything else is prohibitive-context and exempt under the task's own "（除对应门禁任务 done）" carve-out.