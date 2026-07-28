# Default configuration matrix (TF-0003)

> Status: Controlled Preview baseline
> Date: 2026-07-27
> Scope: safety defaults for VToken / memory / SEKB / Browser private network
> Locked by: tests/unit/default-config-matrix.test.ts + tests/unit/p0-production-acceptance.test.ts

This matrix is the single source of truth for **product defaults**. It must stay fail-closed / opt-in until the human-canary and release-approval gates explicitly permit graduation; those gates are not complete today.

## Matrix

| Surface | Config / env key | Product default | How to enable (canary) | Instant kill / stop |
|---|---|---|---|---|
| **VToken assembly** | runtime.vtoken.assembly.enabled | **false** (opt-in) | enabled:true or VERSE_VTOKEN_ASSEMBLY_ENABLED=1 | env=0 or enhancement kill switch |
| **VToken bridge** | VERSE_VTOKEN_BRIDGE_ENABLED / hostApi.vtoken.setEnabled | **false** | env=1 or Developer toggle | env=0 / setEnabled(false) / kill switch |
| **working-memory** | runtime.contextBlock.working_memory.enabled | **false** | explicit true | flag off or kill switch |
| **Runtime Memory inject pilot** | runtime.memory.injectPilot.enabled | **false** | explicit true | flag off or kill switch |
| **Runtime Memory shadow/provider/persist** | runtime.memory.shadow / .provider / .persist | **false** | explicit opt-in only | flag off |
| **SEKB master** | runtime.contextBlock.sekb.enabled / OPENCLAW_SEKB_ENABLED | **false** | explicit true | flag/env off |
| **SEKB auto writeback** | (none) | **off** | N/A human confirm only | leave flags false |
| **SEKB shadow evaluation** | runtime.contextBlock.sekb.shadowEvaluation.enabled | **false** | SEKB master + explicit true | flags off |
| **Browser private network** | browser.ssrfPolicy.dangerouslyAllowPrivateNetwork (+ alias allowPrivateNetwork) | **false** (deny) | true AND ack (dangerouslyAllowPrivateNetworkAcknowledged or VERSE_BROWSER_ALLOW_PRIVATE_NETWORK=1) | set false; unacked legacy true auto-migrates |
| **Context enhancement kill switch** | runtime.contextEnhancement.killSwitch / VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH | **false** | N/A | true/env=1 cuts VToken + memory + DCS flags + CVK addition |

## Semantics

1. Opt-in wins over absent-means-on for VToken. Omitted config means disabled.
2. Sync helpers do not overwrite arbitrary user config, with one safety exception: unacknowledged private-network allow (dangerouslyAllowPrivateNetwork or alias allowPrivateNetwork) is fail-closed migrated to deny on browser config sync.
3. Kill switch is fail-closed: enhancement paths no-op (including CVK addition); the agent turn continues without the extra context.
4. Do not graduate defaults to true while human-canary, soak, and joint-system release gates remain incomplete.
5. SEKB automatic experience writeback remains forbidden (TF-0004 is human-gated golden path only).

## Code anchors

| Area | Path |
|---|---|
| Browser private network seed/migrate | electron/utils/openclaw-auth.ts |
| VToken assembly resolve | openclaw_runtime/src/context-engine/chat-turn-vtoken-injection.ts |
| Memory inject pilot | openclaw_runtime/src/context-engine/chat-turn-memory-injection.ts |
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
