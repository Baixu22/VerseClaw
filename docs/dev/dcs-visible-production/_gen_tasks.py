# -*- coding: utf-8 -*-
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "tasks"
ROOT.mkdir(parents=True, exist_ok=True)

HARD = """## Hard locks (do not violate)
- Do not flip production defaults to "prove usable".
- SEKB: no auto writeback / cutoverAllowed stays false unless separate product policy change.
- Browser private network default deny.
- packaging path: defaultsUnchanged; no auto default-on.
- Prefer Settings/config-sync over env-only expert paths for end-state UX.
"""


def write_task(t: dict) -> None:
    tid = t["id"]
    nongoals = t.get(
        "nongoals",
        "- Joint-system GA claims\n- Flipping unrelated flags\n- Scope expansion beyond this task",
    )
    anchors = t.get(
        "anchors",
        "- See gap doc section 2-4\n- `openclaw_runtime/src/context-engine/`\n- `shared/dcs/prod-flags-catalog.ts`",
    )
    tests = t.get("tests", "```powershell\n# fill when implementing\n```")
    why = t.get(
        "why",
        "Part of dcs-visible-production: visible features must be production-usable, not shelfware.",
    )
    blocked = t.get("blockedBy") or "—"
    owner = t.get("owner") or "TBD"
    gap_refs = t.get("gapRefs", "—")
    estimate = t.get("estimate", "TBD")

    parts = [
        f"# {tid}: {t['title']}",
        "",
        "| field | value |",
        "|-------|-------|",
        f"| **id** | `{tid}` |",
        f"| **milestone** | `{t['milestone']}` |",
        f"| **priority** | `{t['priority']}` |",
        f"| **status** | `{t['status']}` |",
        f"| **blockedBy** | {blocked} |",
        f"| **owner** | {owner} |",
        f"| **gapRefs** | {gap_refs} |",
        f"| **estimate** | {estimate} |",
        "| **lastUpdated** | 2026-07-22 |",
        "",
        "## Goal (user-visible outcome)",
        t["goal"],
        "",
        "## Why this exists",
        why,
        "",
        "## Non-goals",
        nongoals,
        "",
        "## Context / code anchors",
        anchors,
        "",
        "## Acceptance criteria",
        t["acceptance"],
        "",
        "## Implementation slices (one PR / one session each)",
        t["slices"],
        "",
        "## Test / evidence commands",
        tests,
        "",
        "## Progress log",
        "| when | slice | result | note |",
        "|------|-------|--------|------|",
        "| 2026-07-22 | — | created | task doc persisted; implementation not started |",
        "",
        "## Handoff notes (for next agent)",
        "- Read `../STATUS.md` first; only implement slices marked next.",
        "- Keep this file updated; keep STATUS.md metadata-only.",
        "- Link commits/PRs here when they exist.",
        "",
        HARD,
    ]
    body = "\n".join(parts)
    path = ROOT / f"{tid}.md"
    path.write_text(body, encoding="utf-8")
    print("wrote", path.name)


TASKS = [
    dict(
        id="TASK-P0-01",
        title="DCS Flag panel writable control plane",
        milestone="M0-honesty",
        priority="P0",
        status="ready",
        gapRefs="GAP-P0-01, UI-01",
        estimate="3-5d",
        goal=(
            "In Settings > Developer > DCS production flags, user can Switch/Select "
            "to really enable capabilities and see runtime status applied|pending-restart|error. "
            "End state is NOT read-only enable-string instructions."
        ),
        why="Read-only DcsProdFlagsPanel is the largest shelfware; product entry gate for all opt-in surfaces.",
        anchors=(
            "- `src/components/settings/DcsProdFlagsPanel.tsx` (read-only today)\n"
            "- `shared/dcs/prod-flags-catalog.ts`\n"
            "- `electron/gateway/config-sync.ts` (whole-key runtime sync)\n"
            "- `docs/dcs-production-p0-runbook.zh-CN.md`\n"
            "- host-api config read/write (add if missing)"
        ),
        acceptance=(
            "- [ ] At least one opt-in flag (prefer view-tools or working-memory) writable from UI\n"
            "- [ ] After config-sync, new session shows tool-table or injection change\n"
            "- [ ] UI status: applied | pending-restart | error\n"
            "- [ ] Disable restores baseline; E2E covers on/off\n"
            "- [ ] Remaining catalog rows still show correct default/risk\n"
            "- [ ] i18n en/zh minimum"
        ),
        slices=(
            "1. **API design**: host-api read/write runtime.*; no senderAuth bypass\n"
            "2. **Panel**: FlagRow + Switch; optimistic UI + failure toast rollback\n"
            "3. **Readback**: from openclaw-source-state or gateway status\n"
            "4. **E2E**: settings on -> agent path observable change -> off\n"
            "5. **Docs**: runbook prefers Settings; env becomes advanced-only"
        ),
        tests=(
            "```powershell\n"
            "pnpm run test:e2e -- tests/e2e/dcs-prod-p0-settings.spec.ts --workers=1\n"
            "pnpm run typecheck\n"
            "```"
        ),
    ),
    dict(
        id="TASK-P0-02",
        title="Kill dead factViews config gate",
        milestone="M0-honesty",
        priority="P0",
        status="ready",
        gapRefs="GAP-P0-02, C-01",
        estimate="0.5-1d",
        goal=(
            "Single source of truth for Fact view tool gating. "
            "Remove false confidence from runtime.coding.factViews.enabled=true with zero callers."
        ),
        anchors=(
            "- `openclaw_runtime/src/context-engine/coding-runtime-flags.ts`\n"
            "- `openclaw_runtime/src/context-engine/dcs-context-tools-flags.ts`\n"
            "- `openclaw_runtime/src/agents/tools/context-agent-tools.ts`\n"
            "- `shared/dcs/prod-flags-catalog.ts`"
        ),
        acceptance=(
            "- [ ] Choose A: wire config into resolveViewToolsEnabled; or B: deprecate config, env+UI only\n"
            "- [ ] Dead code removed or @deprecated with tests locking behavior\n"
            "- [ ] catalog/runbook/i18n aligned\n"
            "- [ ] unit tests: default-off product behavior preserved if still default-off"
        ),
        slices=(
            "1. ADR decision (5 lines in this file)\n"
            "2. Wire or delete + unit tests\n"
            "3. Docs + catalog align"
        ),
        tests=(
            "```powershell\n"
            "pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run src/agents/tools/context-agent-tools.test.ts\n"
            "pnpm run test:dcs\n"
            "```"
        ),
    ),
    dict(
        id="TASK-P0-03",
        title="Discoverability for hidden view tools",
        milestone="M0-honesty",
        priority="P0",
        status="ready",
        blockedBy="TASK-P0-01 optional",
        gapRefs="GAP-P0-03, T-04..T-07",
        estimate="1-2d",
        goal=(
            "Users can discover that context_understand/impact/reuse/verify are disabled "
            "and enable them so tools enter the catalog (with FactService)."
        ),
        acceptance=(
            "- [ ] Visible hint when disabled (Settings or empty state), not silent absence\n"
            "- [ ] After enable, tools appear in catalog same or next session\n"
            "- [ ] No production default flip unless separate graduation task\n"
            "- [ ] i18n"
        ),
        slices=(
            "1. Discoverability UI (banner/settings)\n"
            "2. Wire to P0-01 toggle\n"
            "3. Tool-table refresh strategy\n"
            "4. unit + light e2e"
        ),
    ),
    dict(
        id="TASK-P0-04",
        title="BlockStore/state DB failure user-visible",
        milestone="M0-honesty",
        priority="P0",
        status="ready",
        gapRefs="GAP-P0-04, T-01",
        estimate="1d",
        goal="When state DB/BlockStore cannot open, user sees explicit error/degraded status, not silent missing tools.",
        anchors=(
            "- `openclaw_runtime/src/agents/embedded-agent-runner/dcs-extension-deps.ts`\n"
            "- attempt/compact tool mounting"
        ),
        acceptance=(
            "- [ ] failure path log + user-visible hint (chat system or settings health)\n"
            "- [ ] failure is not presented as feature-does-not-exist\n"
            "- [ ] unit test simulates open failure"
        ),
        slices=(
            "1. Error types + report channel\n"
            "2. UI/system message\n"
            "3. tests"
        ),
    ),
    dict(
        id="TASK-P0-05",
        title="Product copy: shell vs core",
        milestone="M0-honesty",
        priority="P0",
        status="ready",
        gapRefs="GAP-P0-05, M-05, G-D1",
        estimate="0.5-1d",
        goal="UI/docs distinguish CVK navigation shell vs DCS working memory vs VToken packing.",
        acceptance=(
            "- [ ] Settings copy revised for DCS / VToken / Context Engine if present\n"
            "- [ ] i18n en/zh (ja/ru if required)\n"
            "- [ ] cross-link gap doc"
        ),
        slices=(
            "1. Copy table zh/en\n"
            "2. i18n keys\n"
            "3. smoke Settings UI"
        ),
    ),
    dict(
        id="TASK-P0-06",
        title="Retire/hide dead surfaces + doc sweep",
        milestone="M0-honesty",
        priority="P0",
        status="ready",
        gapRefs="GAP-P0-06, G-F1..F3",
        estimate="1d",
        goal="User paths no longer present RETIRED codegraph / deleted provider-registry pilot / stale unregistered claims as live features.",
        acceptance=(
            "- [ ] entries hidden or marked Retired\n"
            "- [ ] team/docs stale claim sweep\n"
            "- [ ] main coding path unaffected"
        ),
        slices=(
            "1. code entry audit\n"
            "2. docs grep cleanup\n"
            "3. checklist close"
        ),
    ),
    dict(
        id="TASK-P1-01",
        title="Fact view four tools productionizable",
        milestone="M1-productive",
        priority="P1",
        status="backlog",
        blockedBy="TASK-P0-01, TASK-P0-02, TASK-P0-03",
        gapRefs="GAP-P1-01, T-04..T-07",
        estimate="1-2w",
        goal="After Settings enable, four view tools are stably usable with human live A/B evidence (not only synthetic canary).",
        acceptance=(
            "- [ ] stable UI enable path\n"
            "- [ ] >=10 human task records (OPS-01 template)\n"
            "- [ ] live-ab report draft (TF-0006 subset ok)\n"
            "- [ ] may remain default-off but production-usable\n"
            "- [ ] one-step kill"
        ),
        slices=(
            "1. stabilize enable path (depends P0)\n"
            "2. quality/routing prompt tune\n"
            "3. live protocol + execute\n"
            "4. evidence archive (gitignore policy)\n"
            "5. graduation readiness assessment (no auto flip)"
        ),
    ),
    dict(
        id="TASK-P1-02",
        title="working-memory injection actually lands in prompt",
        milestone="M1-productive",
        priority="P1",
        status="backlog",
        blockedBy="TASK-P0-01",
        gapRefs="GAP-P1-02, M-01",
        estimate="1-2w",
        goal="When working-memory is on, long sessions show real injection (exactly-once); off restores baseline bytes.",
        anchors=(
            "- `assembler.ts` DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS working_memory false\n"
            "- producers edit/write/apply_patch envelopes\n"
            "- `handlers/working-memory-handler.ts`"
        ),
        acceptance=(
            "- [ ] Settings/config on -> injection observable (snapshot or e2e)\n"
            "- [ ] exactly-once / budget safe\n"
            "- [ ] long-session soak note (short 1h ok first)\n"
            "- [ ] kill works"
        ),
        slices=(
            "1. config key kebab/snake + UI\n"
            "2. injection visibility harness\n"
            "3. token budget/dedup regression\n"
            "4. human long-session record\n"
            "5. docs"
        ),
    ),
    dict(
        id="TASK-P1-03",
        title="tool_registry injection catalog consistency",
        milestone="M1-productive",
        priority="P1",
        status="backlog",
        blockedBy="TASK-P0-01, TASK-P1-01",
        gapRefs="GAP-P1-03, M-02",
        estimate="3-5d",
        goal="When tool_registry is on, system tool summary matches real catalog and works with view on_demand.",
        acceptance=(
            "- [ ] flag on injects tools summary\n"
            "- [ ] no contradiction vs real tool table\n"
            "- [ ] unit + optional e2e"
        ),
        slices=(
            "1. config/UI switch\n"
            "2. consistency tests\n"
            "3. align C1 schema mode summary/full"
        ),
    ),
    dict(
        id="TASK-P1-04",
        title="VToken vs DCS primary-path product decision",
        milestone="M1-productive",
        priority="P1",
        status="ready",
        gapRefs="GAP-P1-04, M-07, UI-02",
        estimate="1-2d decision + follow-ups",
        goal="Written choice of Working Context primary path (DCS injection / VToken / layered) and budget rules; fix bridge vs assembly double-door confusion.",
        nongoals="- Enable both tracks by default without budget\n- Flip defaults without decision",
        acceptance=(
            "- [ ] 1-page ADR: primary, secondary, forbidden combos, budget\n"
            "- [ ] UI copy/switches match decision\n"
            "- [ ] follow-up task IDs linked here"
        ),
        slices=(
            "1. comparison table\n"
            "2. ADR in this file\n"
            "3. open follow-up implementation tasks"
        ),
    ),
    dict(
        id="TASK-P1-05",
        title="SEKB human-confirm production loop",
        milestone="M1-productive",
        priority="P1",
        status="backlog",
        gapRefs="GAP-P1-05, UI-03, M-08",
        estimate="1w",
        goal="Task end -> candidates -> confirm in <=3 steps -> next-turn recall; zero unconfirmed writes; no auto writeback.",
        anchors=(
            "- `docs/dev/sekb-golden-path.md`\n"
            "- host sekb* APIs\n"
            "- e2e sekb-golden-path"
        ),
        acceptance=(
            "- [ ] 10 human confirm path records\n"
            "- [ ] 0 unconfirmed persist\n"
            "- [ ] discoverable UI entry\n"
            "- [ ] e2e still green"
        ),
        slices=(
            "1. UX friction list\n"
            "2. fix top 1-2 frictions\n"
            "3. 10 human runs\n"
            "4. evidence"
        ),
    ),
    dict(
        id="TASK-P1-06",
        title="Browser supervised production soak",
        milestone="M1-productive",
        priority="P1",
        status="backlog",
        gapRefs="GAP-P1-06, UI-04",
        estimate="3-5d",
        goal="Public allowlist tasks repeatable; approval/recovery explainable; private network stays deny.",
        acceptance=(
            "- [ ] >=10 supervised task records\n"
            "- [ ] 0 private-network bypass\n"
            "- [ ] approval-deny path verified\n"
            "- [ ] recovery e2e green"
        ),
        slices=(
            "1. soak protocol\n"
            "2. execute + records\n"
            "3. defect queue"
        ),
    ),
    dict(
        id="TASK-P1-07",
        title="staleWriteGuard production candidate",
        milestone="M1-productive",
        priority="P1",
        status="backlog",
        blockedBy="TASK-P0-01",
        gapRefs="GAP-P1-07, T-10",
        estimate="1w",
        goal="Real editor-churn false-block data + override UX before any default-on discussion; Settings safe opt-in before that.",
        acceptance=(
            "- [ ] false-block corpus + metrics\n"
            "- [ ] explainable block + override UX\n"
            "- [ ] UI on/off\n"
            "- [ ] default remains off unless metrics pass"
        ),
        slices=(
            "1. metrics/logging\n"
            "2. override UX\n"
            "3. corpus experiment\n"
            "4. assessment report"
        ),
    ),
    dict(
        id="TASK-P1-08",
        title="TaskLoop acceptance scenario coverage",
        milestone="M1-productive",
        priority="P1",
        status="ready",
        gapRefs="GAP-P1-08, G-D3",
        estimate="1-2d",
        goal="Any marketed task_state/phase/SEKB trajectory feature must be accepted on TaskLoop path, not single-turn chat only.",
        acceptance=(
            "- [ ] acceptance checklist doc\n"
            "- [ ] at least one e2e/harness covers phase producer\n"
            "- [ ] product copy notes loop dependency"
        ),
        slices=(
            "1. scenario checklist\n"
            "2. automation gap fill\n"
            "3. docs"
        ),
    ),
    dict(
        id="TASK-P2-01",
        title="TF-0006 four evidence files",
        milestone="M2-default-candidate",
        priority="P2",
        status="backlog",
        blockedBy="TASK-P1-01, TASK-P1-02",
        gapRefs="GAP-P2-01, TF-0006",
        estimate="3-6w calendar",
        goal="Produce four evidence files enabling liveReady/productApproved discussion (same PR must NOT flip defaults).",
        anchors=(
            "- `docs/dev/tf0006-evidence-upgrade-unblock.md`\n"
            "- `artifacts/tf0006-evidence-upgrade/status.json`"
        ),
        acceptance=(
            "- [ ] corpus-manifest.json real corpus\n"
            "- [ ] live-ab-report.json human\n"
            "- [ ] soak-report.json\n"
            "- [ ] product-approval.json named scope\n"
            "- [ ] status.json unblocked only via process\n"
            "- [ ] honesty locks remain true until approval"
        ),
        slices=(
            "1. corpus plan\n"
            "2. collect + manifest\n"
            "3. live A/B\n"
            "4. soak\n"
            "5. approval meeting + product-approval.json\n"
            "6. update status (no default flip)"
        ),
    ),
    dict(
        id="TASK-P2-02",
        title="Per-surface default-on graduation",
        milestone="M2-default-candidate",
        priority="P2",
        status="backlog",
        blockedBy="TASK-P2-01",
        gapRefs="GAP-P2-02",
        estimate="per flag 0.5-1w",
        goal="Graduate surfaces one-by-one to default-on with matrix updates and one-line rollback each.",
        acceptance=(
            "- [ ] ordered graduation list executed\n"
            "- [ ] each flag independent PR + evidence links\n"
            "- [ ] matrix + catalog updated\n"
            "- [ ] no joint one-shot flip"
        ),
        slices=(
            "1. graduation playbook template\n"
            "2. flag #1 canary default\n"
            "3. flag #2...\n"
            "4. rollback drill record"
        ),
    ),
    dict(
        id="TASK-P2-03",
        title="Dynamic multi-injection budget coordinator",
        milestone="M2-default-candidate",
        priority="P2",
        status="backlog",
        blockedBy="TASK-P1-04",
        gapRefs="GAP-P2-03",
        estimate="1w",
        goal="Shared dynamic budget across CVK + DCS + VToken injections with overflow observability.",
        acceptance=(
            "- [ ] coordinator or single budget point\n"
            "- [ ] metrics export\n"
            "- [ ] unit tests"
        ),
        slices=(
            "1. design\n"
            "2. implement\n"
            "3. tests + metrics"
        ),
    ),
    dict(
        id="TASK-P2-04",
        title="Productized observability panel",
        milestone="M2-default-candidate",
        priority="P2",
        status="backlog",
        blockedBy="TASK-P0-01",
        gapRefs="GAP-P2-04, UI-07",
        estimate="1w",
        goal="Settings/Observability shows injection hits, view tool calls, falseBlockRate, kill state — not process counters only.",
        acceptance=(
            "- [ ] minimal panel or export button\n"
            "- [ ] metrics align codingObservability/dcsObservability\n"
            "- [ ] i18n"
        ),
        slices=(
            "1. metrics API\n"
            "2. UI\n"
            "3. tests"
        ),
    ),
    dict(
        id="TASK-P2-05",
        title="C4/C5 default hardening (on demand)",
        milestone="M2-default-candidate",
        priority="P2",
        status="deferred",
        blockedBy="product-pain",
        gapRefs="GAP-P2-05",
        estimate="TBD",
        goal="Only if real concurrency pain: evaluate git worktree / WAL defaults; else stay safe defaults without UI implying isolation is default-on.",
        acceptance=(
            "- [ ] pain record\n"
            "- [ ] if proceed: Windows soak + evidence\n"
            "- [ ] else remain deferred with honest UI"
        ),
        slices=(
            "1. confirm pain\n"
            "2. evidence plan or formal deferral reason"
        ),
    ),
    dict(
        id="TASK-OPS-01",
        title="L3 human canary execution pack",
        milestone="OPS",
        priority="P0",
        status="ready",
        blockedBy="profiles-real-names",
        gapRefs="O-02, checklist section F",
        estimate="2-3d",
        goal="Execute minimal human opt-in tasks per ops runbook with runs/*.json; do not flip defaults.",
        anchors=(
            "- `docs/dev/dcs-ops-canary-runbook.md`\n"
            "- `artifacts/dcs-deep-test-week1/profiles.json`"
        ),
        acceptance=(
            "- [ ] real human names in profiles\n"
            "- [ ] preflight green\n"
            "- [ ] >=10 runs per relevant profile or written shrink reason\n"
            "- [ ] decision continue|shrink|stop"
        ),
        slices=(
            "1. fill real profiles\n"
            "2. preflight + critical e2e\n"
            "3. dcs-coding runs\n"
            "4. decision summary"
        ),
        tests=(
            "```powershell\n"
            "pnpm run dcs:ops:preflight\n"
            "pnpm run build:vite\n"
            "```"
        ),
    ),
    dict(
        id="TASK-OPS-02",
        title="Real kill/rollback drill",
        milestone="OPS",
        priority="P0",
        status="ready",
        gapRefs="O-04",
        estimate="0.5d",
        goal="Actually disable enhancements and verify baseline recovery; not dry-run JSON only.",
        acceptance=(
            "- [ ] execute runbook kill order for real\n"
            "- [ ] before/after record\n"
            "- [ ] baseline chat works\n"
            "- [ ] enhanced tools unreachable"
        ),
        slices=(
            "1. drill checklist\n"
            "2. execute\n"
            "3. write artifacts + progress log"
        ),
    ),
    dict(
        id="TASK-OPS-03",
        title="M1 exit review",
        milestone="OPS",
        priority="P1",
        status="backlog",
        blockedBy="TASK-P1-01, TASK-P1-02, TASK-OPS-01",
        gapRefs="gap doc section 6 M1",
        estimate="0.5d",
        goal="Review whether main-path shelfware is cleared; go/no-go for M2.",
        acceptance=(
            "- [ ] main table UI-01/T-04/M-01 statuses updated\n"
            "- [ ] written go/no-go\n"
            "- [ ] STATUS phase updated"
        ),
        slices=(
            "1. tick gap table\n"
            "2. review meeting\n"
            "3. update STATUS"
        ),
    ),
]


def main() -> None:
    for t in TASKS:
        write_task(t)

    lines = [
        "# Task index (one file per task)",
        "",
        "Authority progress table: [`../STATUS.md`](../STATUS.md).",
        "",
        "| id | file | milestone | priority | status |",
        "|----|------|-----------|----------|--------|",
    ]
    for t in TASKS:
        lines.append(
            f"| {t['id']} | [{t['id']}.md](./{t['id']}.md) | {t['milestone']} | {t['priority']} | {t['status']} |"
        )
    lines.append("")
    lines.append("## Rules")
    lines.append("")
    lines.append("1. One task == one file. Do not merge implementations into STATUS.")
    lines.append("2. Multi-session work uses **Implementation slices** inside the task file.")
    lines.append("3. High information, low density: keep slices short; link code, do not paste dumps.")
    lines.append("4. After each slice: append Progress log; update one row in STATUS.")
    lines.append("")
    (ROOT / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    # program README
    prog = Path(__file__).resolve().parent / "README.md"
    prog.write_text(
        """# dcs-visible-production

Program to make every **visible** DCS-related feature **production-usable** (not shelfware).

## Layout

| path | role |
|------|------|
| [STATUS.md](./STATUS.md) | **Metadata only**: progress, locks, next task |
| [tasks/](./tasks/) | **One task one doc** with slices, acceptance, log |
| [tasks/README.md](./tasks/README.md) | Task index |
| `../DCS-VISIBLE-FEATURES-PRODUCTION-GAP.md` | Full gap inventory (reference, not work log) |

## Recover after context loss

1. Open `STATUS.md`
2. Open `activeTaskId` or `nextTaskId` under `tasks/`
3. Do **one slice** only
4. Update task Progress log + STATUS row

## Do not

- Put long designs into STATUS
- Put multiple tasks into one markdown file
- Flip production defaults to prove usability
""",
        encoding="utf-8",
    )
    print("tasks", len(list(ROOT.glob("TASK-*.md"))))


if __name__ == "__main__":
    main()
