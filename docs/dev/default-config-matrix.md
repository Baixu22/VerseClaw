# Default configuration matrix (TF-0003)

> Status: Controlled Preview baseline
> Date: 2026-10-22
> Scope: Workspace Context, VToken, memory, SEKB, Browser private network
> Locked by: tests/unit/default-config-matrix.test.ts + tests/unit/p0-production-acceptance.test.ts

This matrix is the single source of truth for **product defaults**. A component changes its default only through its owner node, the predeclared benefit/quality/rollback gates, and an evidence-backed Task Forest closeout. Agent-driven evidence is admissible under the 2026-09-27 owner policy when it is labelled with `driven_by: agent` and a concrete actor; that evidence does not by itself authorize public release, general availability, live readiness or product approval.

> D9 scope note (2026-10-21, TF-0488): component productization, default-graduation decisions, and agent-driven automatic acceptance are in scope for this program. See [the D9 ADR](adr/2026-10-21-d9-component-graduation-scope.md) and [the current constraint matrix](component-graduation-scope-matrix-20261021.md).
>
> TF-0494 decision (2026-10-22): working-memory and tool-registry graduated together into one user-level **Workspace Context** profile. The profile defaults on; the two internal DCS flags are implementation details, not separate user features. This does not flip any other product default or change the release boundary.

## Matrix

| Surface | Config / env key | Product default | How to enable (canary) | Instant kill / stop |
|---|---|---|---|---|
| **VToken assembly** | runtime.vtoken.assembly.enabled | **false** (opt-in) | enabled:true or VERSE_VTOKEN_ASSEMBLY_ENABLED=1 | env=0 or enhancement kill switch |
| **VToken bridge** | VERSE_VTOKEN_BRIDGE_ENABLED / hostApi.vtoken.setEnabled | **false** | env=1 or Developer toggle | env=0 / setEnabled(false) / kill switch |
| **Workspace Context** | Settings > General single user profile over runtime.contextBlock.working-memory.enabled + runtime.contextBlock.tool-registry.enabled | **true** | baseline-on; one Settings toggle | toggle off or context enhancement kill switch |
| **working-memory** | runtime.contextBlock.working_memory.enabled | **true** | internal component of Workspace Context | Workspace Context off or kill switch |
| **tool-registry** | runtime.contextBlock.tool-registry.enabled | **true** | internal component of Workspace Context | Workspace Context off or kill switch |
| **Runtime Memory inject pilot** | runtime.memory.injectPilot.enabled | **false** | explicit true | flag off or kill switch |
| **Runtime Memory shadow/provider/persist** | runtime.memory.shadow / .provider / .persist | **false** | explicit opt-in only | flag off |
| **SEKB master** | runtime.contextBlock.sekb.enabled / OPENCLAW_SEKB_ENABLED | **false** | explicit true | flag/env off |
| **SEKB auto writeback** | (none) | **off** | N/A human confirm only | leave flags false |
| **SEKB shadow evaluation** | runtime.contextBlock.sekb.shadowEvaluation.enabled | **false** | SEKB master + explicit true | flags off |
| **Browser private network** | browser.ssrfPolicy.dangerouslyAllowPrivateNetwork (+ alias allowPrivateNetwork) | **false** (deny) | true AND ack (dangerouslyAllowPrivateNetworkAcknowledged or VERSE_BROWSER_ALLOW_PRIVATE_NETWORK=1) | set false; unacked legacy true auto-migrates |
| **Context enhancement kill switch** | runtime.contextEnhancement.killSwitch / VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH | **false** | N/A | true/env=1 cuts VToken + memory + DCS flags + CVK addition |
| **Coding auto verify** | runtime.coding.autoVerify.enabled | **auto** (detect runner, else skip) | enabled:"auto" / true; optional bounded command / timeoutSeconds (max 90) | set enabled:false |

## Semantics

1. Opt-in wins over absent-means-on for VToken. Omitted config means disabled.
2. Workspace Context is one user concept over two internal context blocks. Users select it once in Settings > General; the Developer DCS panel is diagnostics, not the normal control surface. Turning it off or engaging the context-enhancement kill switch restores the pre-enhancement prompt baseline.
3. Workspace Context is not long-term knowledge or approved memory. It carries the recent-action working window and a compact tool/resource registry within the shared turn budget; it must not become a second memory or knowledge authority.
4. Sync helpers do not overwrite arbitrary user config, with one safety exception: unacknowledged private-network allow (dangerouslyAllowPrivateNetwork or alias allowPrivateNetwork) is fail-closed migrated to deny on browser config sync.
5. Kill switch is fail-closed: enhancement paths no-op (including CVK addition); the agent turn continues without the extra context.
6. Do not graduate a default while production-path, benefit, quality/latency, effective-state, rollback, or explicit-decision gates remain incomplete. Agent-driven evidence is admissible when labelled; synthetic/scripted-only evidence cannot carry the decision, and passing evidence does not grant public release or general availability.
7. SEKB automatic experience writeback remains forbidden (TF-0004 is its own governed path).
8. Coding auto verify defaults to `"auto"` (runs only when a test runner is detected within budget; otherwise skips without invoking the exec tool). Explicit `true` forces the run; `false` disables it. When it runs it reuses the effective `exec` tool and never creates a second process, approval, sandbox, or timeout authority.

## Code anchors

| Area | Path |
|---|---|
| Browser private network seed/migrate | electron/utils/openclaw-auth.ts |
| VToken assembly resolve | openclaw_runtime/src/context-engine/chat-turn-vtoken-injection.ts |
| Memory inject pilot | openclaw_runtime/src/context-engine/chat-turn-memory-injection.ts |
| Workspace Context user control | electron/services/dcs-prod-flags-api.ts + shared/dcs/workspace-context-profile.ts |
| DCS assembler flags | openclaw_runtime/src/context-engine/assembler.ts |
| Enhancement kill switch | openclaw_runtime/src/context-engine/enhancement-kill-switch.ts |
| CVK addition kill gate | openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts |
| SEKB flags | openclaw_runtime/src/knowledge/sekb/feature-flags.ts |
| Rule | harness/specs/rules/vtoken-foundation-boundary.md |

## Acceptance (TF-0003)

- [x] Default configuration matrix documented (this file)
- [x] Unit tests lock the defaults (tests/unit/default-config-matrix.test.ts)
- [x] Kill switch cuts memory/context enhancement fail-closed (incl. CVK addition)
- [x] Private network default intercept + legacy/alias migration has regression coverage

## Private-network legacy migration (P0 production)

On every browser config sync (applyBrowserPrivateNetworkDefault / batchSyncConfigFields / syncBrowserConfigToOpenClaw):

1. Missing / undefined -> dangerouslyAllowPrivateNetwork: false
2. true without acknowledgement on either alias -> migrated to false and stamped privateNetworkLegacyAllowMigratedAt
3. true with dangerouslyAllowPrivateNetworkAcknowledged:true or env VERSE_BROWSER_ALLOW_PRIVATE_NETWORK=1 -> keep allow (canary only)

This closes the residual where old openclaw.json left private network open without opt-in ack (including the allowPrivateNetwork alias).
