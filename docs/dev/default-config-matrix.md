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
| **DCS Fact view tools** | OPENCLAW_DCS_CONTEXT_VIEW_TOOLS | **auto** (healthy prerequisites; env override off) | automatic discovery when workspace, FactService and permission are healthy | env=0 disables; missing dependency or permission denies execution |
| **VToken assembly** | runtime.vtoken.assembly.enabled / VERSE_VTOKEN_ASSEMBLY_ENABLED | **retired** (always off) | none; VTOKEN_RETIRED keeps the production request inert | always off; rollback requires a new frozen A/B and materiality pass |
| **VToken bridge** | VERSE_VTOKEN_BRIDGE_ENABLED / hostApi.vtoken.setEnabled | **retired** (always off) | none; no renderer toggle and no host enable path | always off; sidecar never starts |
| **Workspace Context** | Settings > General single user profile over runtime.contextBlock.working-memory.enabled + runtime.contextBlock.tool-registry.enabled | **true** | baseline-on; one Settings toggle | toggle off or context enhancement kill switch |
| **working-memory** | runtime.contextBlock.working_memory.enabled | **true** | internal component of Workspace Context | Workspace Context off or kill switch |
| **tool-registry** | runtime.contextBlock.tool-registry.enabled | **true** | internal component of Workspace Context | Workspace Context off or kill switch |
| **Runtime Memory inject pilot** | runtime.memory.injectPilot.enabled | **false** | explicit true for a bounded pilot | flag off or kill switch |
| **Runtime Memory shadow/provider/persist** | runtime.memory.shadow / .provider / .persist / .proposeFacts | **retired** (always off) | none; RETIRED_RUNTIME_MEMORY_FLAGS pins these to false, so no config can enable them (TF-0500) | always off |
| **SEKB master** | runtime.contextBlock.sekb.enabled / OPENCLAW_SEKB_ENABLED | **false** | explicit true | flag/env off |
| **SEKB auto writeback** | (none) | **off** | no automatic path; explicit review can create a governed proposal | leave flags false |
| **SEKB shadow evaluation** | runtime.contextBlock.sekb.shadowEvaluation.enabled | **false** | SEKB master + explicit true | flags off |
| **Browser private network** | browser.ssrfPolicy.dangerouslyAllowPrivateNetwork (+ alias allowPrivateNetwork) | **false** (deny) | true AND acknowledgement; a separate bounded session/origin approval is still required | set false; unacknowledged legacy true auto-migrates |
| **Context enhancement kill switch** | runtime.contextEnhancement.killSwitch / VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH | **false** | N/A | true/env=1 cuts remaining enhancement additions and CVK injection |
| **Coding auto verify** | runtime.coding.autoVerify.enabled | **auto** (detect runner, else skip) | enabled:"auto" / true; optional bounded command / timeoutSeconds (max 90) | set enabled:false |

## Semantics

1. VToken is retired. The assembly and bridge names remain recognised for compatibility but cannot enable production packing or start the sidecar; rollback needs a new frozen protocol that clears the materiality bar.
2. DCS Fact view tools are automatic when their workspace, FactService and permission prerequisites are healthy. The env key is a rollback/override, not a normal user enablement step.
3. Workspace Context is one user concept over two internal context blocks. Users select it once in Settings > General; the Developer DCS panel is diagnostics, not the normal control surface. Turning it off or engaging the context-enhancement kill switch restores the pre-enhancement prompt baseline.
4. Workspace Context is not long-term knowledge or approved memory. It carries the recent-action working window and a compact tool/resource registry within the shared turn budget; it must not become a second memory or knowledge authority.
5. Sync helpers do not overwrite arbitrary user config, with one safety exception: unacknowledged private-network allow (dangerouslyAllowPrivateNetwork or alias allowPrivateNetwork) is fail-closed migrated to deny on browser config sync.
6. Kill switch is fail-closed: remaining enhancement paths no-op (including CVK addition); the agent turn continues without the extra context.
7. Do not graduate a default while production-path, benefit, quality/latency, effective-state, rollback, or explicit-decision gates remain incomplete. Agent-driven evidence is admissible when labelled; synthetic/scripted-only evidence cannot carry the decision, and passing evidence does not grant public release or general availability.
8. SEKB automatic experience writeback remains forbidden; explicit review is the only governed write path.
9. Coding auto verify defaults to `"auto"` (runs only when a test runner is detected within budget; otherwise skips without invoking the exec tool). Explicit `true` forces the run; `false` disables it. When it runs it reuses the effective `exec` tool and never creates a second process, approval, sandbox, or timeout authority.

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
