# TASK-P1-04: VToken vs DCS primary-path product decision

| field | value |
|-------|-------|
| **id** | `TASK-P1-04` |
| **milestone** | `M1-productive` |
| **priority** | `P1` |
| **status** | `done` |
| **blockedBy** | — |
| **owner** | Claude |
| **gapRefs** | GAP-P1-04, M-07, UI-02 |
| **estimate** | 1-2d decision + follow-ups |
| **lastUpdated** | 2026-07-22 |
| **completedAt** | 2026-07-22 |

## Goal
Written choice of Working Context primary path and budget rules; clarify bridge vs assembly.

## Acceptance criteria
- [x] 1-page ADR: primary, secondary, forbidden combos, budget
- [x] UI copy already aligned via P0-05 ContextLayersExplainer (no further flip this task)
- [x] follow-up task IDs listed
- [x] **no default flips** in this task

---

## ADR-P1-04: Layered Working Context (2026-07-22)

### Decision

**Primary product model: layered, not single-winner.**

| Layer | Role | Product default (today) | User control |
|-------|------|-------------------------|--------------|
| **CVK** | Navigation / tool-routing **shell** | On as default context engine | Engine slot / kill switch |
| **VToken assembly** | **## Working Context** packing of md/tools/memory sources | Gateway env defaults assembly **ON** (`VERSE_VTOKEN_ASSEMBLY_ENABLED` default 1) | Kill `=0`; Settings bridge is diagnostics (separate) |
| **DCS BlockStore** | **Structured memory** (working_memory, tool_registry, knowledge, context_* tools) | **All contextBlock flags OFF** | Settings DCS panel (P0-01+; working-memory P1-02) |

### Rationale

1. **Different jobs:** CVK = chrome; VToken = turn packing from files; DCS = session BlockStore + tool surface. Collapsing to one system re-creates parallel-memory debt.
2. **Risk:** DCS injection is higher-risk (token, privacy, exactly-once). Keep opt-in. VToken packing is lower-risk source assembly already on in gateway forkEnv — keep kill-switch, do not also force dual default DCS injection on.
3. **Settings honesty (P0-05):** already teaches three layers; ADR freezes that story as product policy.

### Forbidden combinations / anti-patterns

| Forbidden | Why |
|-----------|-----|
| Claim “context engine remembers everything” when only CVK is on | Shell ≠ memory |
| Default-on DCS working_memory + default-on heavy knowledge inject without budget coordination | Token blow-ups; violates hardLocks |
| Reintroduce provider-registry pilot / CodeGraph as primary memory | Retired (P0-06) |
| Flip packaging defaults in same change as “enable for demo” | NO-GO (OPS-03) |

### Budget policy (until P2-03 lands)

| Injection | Budget rule (now) |
|-----------|-------------------|
| DCS knowledge / transformContext | `KNOWLEDGE_INJECTION_CHAR_BUDGET = 2000` (assembler constant); exactly-once headings |
| DCS working_memory | Window merge + exactly-once `## Recent Actions` |
| VToken assembly | Token budget in assemble API / gateway path |
| CVK systemPromptAddition | Kill-switchable; not dynamically coordinated yet |

**Cross-point dynamic trim:** deferred to **TASK-P2-03**. Until then: do not enable all DCS injectors at once in production without measuring.

### Bridge vs assembly (double-door)

| Surface | Meaning |
|---------|---------|
| Settings **VT bridge** switch | Host-api diagnostics worker (opt-in style UX) |
| `VERSE_VTOKEN_ASSEMBLY_ENABLED` | **Production assembly** in gateway (default on unless killed) |

**Product rule:** Document assembly as the production path; bridge is advanced diagnostics. Future follow-up may unify labels (optional TASK-P1-04b below) — **no behavior change required to close this ADR**.

### Comparison table (options considered)

| Option | Pros | Cons | Chosen? |
|--------|------|------|---------|
| A. DCS-only primary | One memory spine | Throws away working VT packing already shipped | No |
| B. VToken-only primary | Simple pack story | No BlockStore tools / task_state spine | No |
| C. Layered (CVK + VT pack + DCS opt-in) | Matches code + risk | Needs clear copy + future budget coord | **Yes** |

---

## Follow-up tasks

| ID | Action |
|----|--------|
| **TASK-P1-02** | done — working-memory Settings enable path |
| **TASK-P1-01** | Fact view live usefulness / A/B class |
| **TASK-P2-03** | Dynamic multi-injection budget coordinator |
| **TASK-P1-04b** (optional, not registered) | Unify VT bridge vs assembly Settings labels if users still confuse |

---

## Progress log
| when | slice | result | note |
|------|-------|--------|------|
| 2026-07-22 | — | created | |
| 2026-07-22 | ADR | done | layered C chosen |
| 2026-07-22 | close | **done** | no default flips |

## Hard locks
- Do not flip production defaults to prove usable.
- SEKB no auto writeback.
- Prefer Settings for DCS opt-in; VT assembly kill via env.
