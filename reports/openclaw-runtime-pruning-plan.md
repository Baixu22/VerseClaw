# OpenClaw Runtime Pruning Plan

## Background

ClawX now prefers connecting to the editable or bundled `openclaw_runtime` Gateway instead of relying on a much smaller ClawX-only backend surface. This gives ClawX access to richer OpenClaw functionality, but it also means the packaged runtime may include many channels, providers, media tools, QA tools, diagnostics, and extension packages that ClawX does not currently expose in its desktop UI.

The goal of pruning is to reduce runtime size, startup cost, and dependency risk without breaking the Gateway contract ClawX depends on.

This report is intentionally a planning document only. Do not delete runtime source directories as a first step. Prefer an allowlist-driven bundle/load strategy so the change can be reversed safely if a hidden runtime dependency is discovered.

## Current ClawX Runtime Contract

ClawX currently needs the Gateway to advertise and serve this core RPC surface:

- `health`
- `status`
- `system-presence`
- `config.get`
- `chat.history`
- `chat.send`
- `chat.abort`
- `sessions.list`
- `sessions.patch`
- `sessions.delete`
- `cron.list`
- `cron.add`
- `cron.update`
- `cron.remove`
- `cron.run`
- `channels.status`
- `channels.start`
- `channels.stop`
- `skills.status`
- `skills.search`
- `skills.detail`
- `skills.update`
- `agents.list`
- `models.list`

Anything required to keep these methods registered, advertised in the Gateway handshake, and functional must be treated as non-prunable for the first pass.

## Must Keep

Keep these runtime areas for the initial pruning pass:

- `src/gateway`
- `src/config`
- `src/chat`
- `src/sessions`
- `src/cron`
- `src/skills`
- `src/agents`
- `src/model-catalog`
- `src/channels`
- `src/routing`
- `src/transcripts`
- `src/trajectory`
- `src/secrets`
- `src/plugins`
- `src/plugin-sdk`
- `src/provider-runtime`
- `src/infra`
- `src/status`
- `src/utils`
- `src/shared`

These directories are too close to Gateway startup, RPC registration, config loading, transcript history, provider resolution, or channel status handling to remove safely without a deeper dependency graph.

## ClawX Channel Allowlist

ClawX UI currently presents or has explicit handling for these channel IDs:

- `telegram`
- `discord`
- `whatsapp`
- `openclaw-weixin` as the runtime ID for ClawX UI `wechat`
- `dingtalk`
- `feishu`
- `wecom`
- `qqbot`

These should remain in the first runtime bundle allowlist.

Do not remove the `src/channels` framework. Even if many individual channel plugins are omitted, `channels.status`, channel catalog generation, plugin registry access, channel health, and ClawX's Channels page all depend on the channel framework staying present.

## Candidate Channel Extensions To Exclude First

The following channel extensions appear outside ClawX's current primary UI surface and are good first-pass exclusion candidates:

- `slack`
- `line`
- `signal`
- `msteams`
- `googlechat`
- `mattermost`
- `matrix`
- `irc`
- `twitch`
- `zalo`
- `zalouser`
- `nextcloud-talk`
- `synology-chat`
- `imessage`
- `tlon`
- `nostr`
- `sms`
- `clickclack`
- `google-meet`
- `webhooks`

This should be done by bundle or plugin allowlist first, not by deleting source.

## Candidate Non-Channel Extensions To Exclude First

These extension groups are likely safe candidates for an initial ClawX-focused runtime bundle because they are not part of the current desktop core workflows:

- QA and harness tooling: `qa-lab`, `qa-matrix`, `qa-channel`, `test-support`, `synthetic`
- Observability exporters: `diagnostics-otel`, `diagnostics-prometheus`
- Voice and realtime media: `voice-call`, `talk-voice`, `azure-speech`, `deepgram`, `elevenlabs`, `tts-local-cli`, `senseaudio`
- Media generation extras: `video-generation-core`, `image-generation-core`, `media-understanding-core`, `pixverse`, `runway`, `fal`, `comfy`
- Standalone app/tool surfaces: `canvas`, `workboard`, `phone-control`, `file-transfer`
- Specialized migration or compatibility plugins: `migrate-claude`, `migrate-hermes`

Some of these may still be useful later, but they should not be required for a minimal ClawX Gateway runtime.

## Provider Extension Strategy

Do not blindly remove all model provider extensions. ClawX still needs `models.list` and chat send support to work with configured providers.

Recommended first pass:

1. Build a provider allowlist from ClawX Settings and existing provider code.
2. Keep only providers ClawX can configure or reasonably route today.
3. Exclude niche providers only from bundle output first.

Potential keep list to verify before implementation:

- `openai`
- `anthropic`
- `google`
- `openrouter`
- `deepseek`
- `qwen`
- `moonshot`
- `xai`
- `ollama`
- `lmstudio`
- `copilot`
- `github-copilot`
- `azure-speech` only if voice/STT is kept

Potential first-pass provider exclusions, pending confirmation:

- `arcee`
- `chutes`
- `novita`
- `qianfan`
- `sglang`
- `vllm`
- `venice`
- `together`
- `nvidia`
- `stepfun`
- `volcengine`
- `zai`
- `minimax`
- `mistral`
- `cerebras`
- `byteplus`
- `amazon-bedrock`
- `amazon-bedrock-mantle`
- `anthropic-vertex`
- `microsoft-foundry`

The agent should confirm against ClawX provider settings and `models.list` behavior before excluding provider packages.

## Recommended Implementation Phases

### Phase 1: Inventory

Produce a machine-readable inventory before any pruning:

- All Gateway RPC methods ClawX calls.
- All channel IDs ClawX displays, saves, aliases, or validates.
- All provider IDs ClawX settings can create or validate.
- All runtime extensions currently copied or bundled into the packaged runtime.
- Bundle size and startup timing baseline.

Suggested output:

- `reports/openclaw-runtime-pruning-inventory.json`
- `reports/openclaw-runtime-pruning-inventory.md`

### Phase 2: Bundle Allowlist

Add a ClawX-specific runtime bundle allowlist. Prefer names like:

- `CLAWX_RUNTIME_EXTENSION_ALLOWLIST`
- `CLAWX_RUNTIME_CHANNEL_ALLOWLIST`
- `CLAWX_RUNTIME_PROVIDER_ALLOWLIST`

Or place the allowlist in a script-owned config file, for example:

- `scripts/runtime-pruning/allowlist.json`

The allowlist should affect packaging/copying/loading, not source deletion.

### Phase 3: Runtime Guardrails

Keep the Gateway handshake capability check strict:

- If any ClawX-required Gateway method is missing, ClawX should not mark Gateway ready.
- The capability monitor should expose missing method diagnostics.
- `channels.status` should still return successfully even if non-allowlisted channels are absent.

Add tests that assert the minimal allowlist still advertises the ClawX-required methods.

### Phase 4: Channel Pruning

Start by excluding non-ClawX channel extensions from the bundled runtime.

Validation targets:

- ClawX Channels page still loads.
- `channels.status` returns channel metadata for allowlisted channels.
- `wechat` UI alias still maps to runtime `openclaw-weixin`.
- Saving channel config still mirrors credentials in the shape runtime expects.
- `channels.start` and `channels.stop` accept `{ channel, accountId }`.

### Phase 5: Provider Pruning

Exclude provider extensions only after confirming ClawX Settings and `models.list` still behave correctly.

Validation targets:

- Provider settings page loads.
- Configured provider accounts remain visible.
- `models.list` returns usable models for allowed providers.
- `chat.send` still works with at least one configured allowed provider.
- Missing excluded providers are reported as unavailable rather than crashing Gateway startup.

### Phase 6: Heavy Feature Pruning

After channels and providers are stable, evaluate excluding heavy feature areas:

- voice/realtime media
- video generation
- image generation extras
- observability exporters
- QA harness plugins
- browser/tooling plugins not surfaced by ClawX

Each group should be removed behind an allowlist flag first.

## Validation Checklist

Run these after each pruning phase:

- `pnpm run build:runtime`
- `pnpm run typecheck:node`
- `pnpm run typecheck:web`
- `pnpm exec vitest run tests/unit/gateway-ws-client.test.ts tests/unit/gateway-ready-fallback.test.ts tests/unit/channels-page.test.tsx`
- `pnpm run comms:replay`
- `pnpm run comms:compare`

When the worktree is clean enough for harness diff validation:

- `pnpm harness validate --spec harness/specs/tasks/connect-clawx-to-openclaw-runtime.md`
- `pnpm harness run --spec harness/specs/scenarios/gateway-backend-communication.md --dry-run`

Manual smoke target:

- Start ClawX.
- Confirm Gateway handshake completes.
- Confirm `gatewayReady=true` is reached without repeated `system-presence` readiness timeouts.
- Open Channels page.
- Confirm configured channels render.
- Confirm channel runtime status degrades gracefully if a specific external service is not configured.

## Main Risks

- Some runtime extensions register provider/channel metadata dynamically; excluding them may change `models.list` or `channels.status`.
- Some channel packages are plugin-backed but ClawX keeps local account-list state under `channels.<id>`. The mirror into `plugins.entries.<id>` must stay intact.
- `openclaw-weixin` must remain the runtime ID even though ClawX UI displays it as `wechat`.
- Removing source directories directly may break TypeScript aliases, generated metadata, or plugin catalog scans.
- Provider pruning can silently remove a model option a user already configured.

## Recommendation

Use a packaging allowlist first. Do not physically delete `openclaw_runtime/extensions/*` directories in the first implementation.

The safest first milestone is:

1. Keep all core `src/*` runtime framework code.
2. Bundle only ClawX-supported channel extensions.
3. Bundle only confirmed ClawX-supported provider extensions.
4. Keep all pruning reversible through a single allowlist.
5. Preserve Gateway method advertisement and ClawX readiness checks as the final safety net.

