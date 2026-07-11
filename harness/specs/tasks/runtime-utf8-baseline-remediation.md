---
id: runtime-utf8-baseline-remediation
title: Pruned Runtime UTF-8 baseline remediation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Recover malformed UTF-8 committed in the pruned OpenClaw Runtime from byte-level evidence, preserve retained Runtime ownership and behavior, and restore a real green Runtime build before DCS Stage 1 closure.
touchedAreas:
  - artifacts/runtime-utf8-recovery/allowlists/partition-a.txt
  - artifacts/runtime-utf8-recovery/allowlists/partition-b.txt
  - artifacts/runtime-utf8-recovery/allowlists/partition-c.txt
  - artifacts/runtime-utf8-recovery/allowlists/partition-d.txt
  - artifacts/runtime-utf8-recovery/baseline-scan-final.log
  - artifacts/runtime-utf8-recovery/baseline-scan-git-blobs.log
  - artifacts/runtime-utf8-recovery/baseline-scan.log
  - artifacts/runtime-utf8-recovery/inventory-summary.md
  - artifacts/runtime-utf8-recovery/inventory.json
  - artifacts/runtime-utf8-recovery/local-evidence/report.json
  - artifacts/runtime-utf8-recovery/local-evidence/summary.md
  - artifacts/runtime-utf8-recovery/manifest/freeze-evidence.md
  - artifacts/runtime-utf8-recovery/manifest/freeze-manifest.mjs
  - artifacts/runtime-utf8-recovery/manifest/freeze-manifest.test.mjs
  - artifacts/runtime-utf8-recovery/manifest/partition-map.json
  - artifacts/runtime-utf8-recovery/manifest/repair-manifest.json
  - artifacts/runtime-utf8-recovery/manifest/update-task-touched-areas.mjs
  - artifacts/runtime-utf8-recovery/red-green/w1-green-01.log
  - artifacts/runtime-utf8-recovery/red-green/w1-green-02.log
  - artifacts/runtime-utf8-recovery/red-green/w1-green-03.log
  - artifacts/runtime-utf8-recovery/red-green/w1-green-04.log
  - artifacts/runtime-utf8-recovery/red-green/w1-green-05.log
  - artifacts/runtime-utf8-recovery/red-green/w1-green-06-enobufs.log
  - artifacts/runtime-utf8-recovery/red-green/w1-green-07-git-blob-crlf.log
  - artifacts/runtime-utf8-recovery/red-green/w1-green-08-git-blob-buffer.log
  - artifacts/runtime-utf8-recovery/red-green/w1-green-09-variable-span.log
  - artifacts/runtime-utf8-recovery/red-green/w1-red-10-git-index-apply.log
  - artifacts/runtime-utf8-recovery/red-green/w1-green-10-git-index-apply.log
  - artifacts/runtime-utf8-recovery/red-green/w1-green-final.log
  - artifacts/runtime-utf8-recovery/red-green/w1-red-01.log
  - artifacts/runtime-utf8-recovery/red-green/w1-red-02.log
  - artifacts/runtime-utf8-recovery/red-green/w1-red-03.log
  - artifacts/runtime-utf8-recovery/red-green/w1-red-04.log
  - artifacts/runtime-utf8-recovery/red-green/w1-red-05.log
  - artifacts/runtime-utf8-recovery/red-green/w1-red-07-git-blob-crlf.log
  - artifacts/runtime-utf8-recovery/red-green/w1-red-09-variable-span.log
  - artifacts/runtime-utf8-recovery/semantic-evidence/anchored-codepoint-report.json
  - artifacts/runtime-utf8-recovery/semantic-evidence/report.json
  - artifacts/runtime-utf8-recovery/semantic-evidence/source-span-evidence.mjs
  - artifacts/runtime-utf8-recovery/semantic-evidence/source-span-evidence.test.mjs
  - artifacts/runtime-utf8-recovery/semantic-evidence/source-span-red-green.md
  - artifacts/runtime-utf8-recovery/semantic-evidence/source-span-report.json
  - artifacts/runtime-utf8-recovery/semantic-evidence/source-span-summary.md
  - artifacts/runtime-utf8-recovery/semantic-evidence/source-span-verification.md
  - artifacts/runtime-utf8-recovery/upstream-evidence/report.json
  - artifacts/runtime-utf8-recovery/upstream-evidence/summary.md
  - docs/superpowers/plans/2026-07-11-dcs-stage1-recovery-orchestration.md
  - docs/superpowers/plans/2026-07-11-runtime-utf8-recovery-window-launch-pack.md
  - docs/superpowers/specs/2026-07-11-dcs-stage1-recovery-orchestration-design.md
  - harness/specs/tasks/runtime-utf8-baseline-remediation.md
  - openclaw_runtime/extensions/active-memory/index.ts
  - openclaw_runtime/extensions/amazon-bedrock-mantle/discovery.ts
  - openclaw_runtime/extensions/amazon-bedrock/config-compat.ts
  - openclaw_runtime/extensions/amazon-bedrock/discovery.ts
  - openclaw_runtime/extensions/amazon-bedrock/embedding-provider.ts
  - openclaw_runtime/extensions/amazon-bedrock/register.sync.runtime.ts
  - openclaw_runtime/extensions/bonjour/src/advertiser.ts
  - openclaw_runtime/extensions/browser/src/browser-tool.ts
  - openclaw_runtime/extensions/browser/src/browser/cdp-proxy-bypass.ts
  - openclaw_runtime/extensions/browser/src/browser/cdp.helpers.ts
  - openclaw_runtime/extensions/browser/src/browser/cdp.ts
  - openclaw_runtime/extensions/browser/src/browser/chrome.executables.ts
  - openclaw_runtime/extensions/browser/src/browser/chrome.ts
  - openclaw_runtime/extensions/browser/src/browser/client-fetch.ts
  - openclaw_runtime/extensions/browser/src/browser/config.ts
  - openclaw_runtime/extensions/browser/src/browser/pw-session.ts
  - openclaw_runtime/extensions/browser/src/browser/pw-tools-core.interactions.ts
  - openclaw_runtime/extensions/browser/src/browser/routes/agent.act.ts
  - openclaw_runtime/extensions/browser/src/browser/server-context.availability.ts
  - openclaw_runtime/extensions/browser/src/browser/snapshot-roles.ts
  - openclaw_runtime/extensions/browser/src/cli/browser-cli-actions-input/register.element.ts
  - openclaw_runtime/extensions/chutes/index.ts
  - openclaw_runtime/extensions/codex/src/app-server/event-projector.ts
  - openclaw_runtime/extensions/codex/src/app-server/rate-limits.ts
  - openclaw_runtime/extensions/codex/src/command-account.ts
  - openclaw_runtime/extensions/codex/src/command-formatters.ts
  - openclaw_runtime/extensions/copilot/harness.ts
  - openclaw_runtime/extensions/copilot/src/attempt.ts
  - openclaw_runtime/extensions/copilot/src/auth-bridge.ts
  - openclaw_runtime/extensions/copilot/src/compaction-bridge.ts
  - openclaw_runtime/extensions/copilot/src/doctor-probes.ts
  - openclaw_runtime/extensions/copilot/src/dual-write-transcripts.ts
  - openclaw_runtime/extensions/copilot/src/replay-shim.ts
  - openclaw_runtime/extensions/copilot/src/telemetry-bridge.ts
  - openclaw_runtime/extensions/copilot/src/tool-bridge.ts
  - openclaw_runtime/extensions/copilot/src/user-input-bridge.ts
  - openclaw_runtime/extensions/copilot/src/workspace-bootstrap.ts
  - openclaw_runtime/extensions/deepinfra/media-models.ts
  - openclaw_runtime/extensions/deepinfra/provider-models.ts
  - openclaw_runtime/extensions/device-pair/index.ts
  - openclaw_runtime/extensions/device-pair/notify.ts
  - openclaw_runtime/extensions/device-pair/pair-command-approve.ts
  - openclaw_runtime/extensions/discord/src/channel.ts
  - openclaw_runtime/extensions/discord/src/doctor-contract.ts
  - openclaw_runtime/extensions/discord/src/internal/command-deploy.ts
  - openclaw_runtime/extensions/discord/src/monitor/agent-components-context.ts
  - openclaw_runtime/extensions/discord/src/monitor/agent-components.handlers.ts
  - openclaw_runtime/extensions/discord/src/monitor/exec-approvals.ts
  - openclaw_runtime/extensions/discord/src/monitor/listeners.ts
  - openclaw_runtime/extensions/discord/src/monitor/message-handler.context.ts
  - openclaw_runtime/extensions/discord/src/monitor/model-picker.state.ts
  - openclaw_runtime/extensions/discord/src/monitor/model-picker.view.ts
  - openclaw_runtime/extensions/discord/src/monitor/native-command-arg-ui.ts
  - openclaw_runtime/extensions/discord/src/monitor/native-command-model-picker-apply.ts
  - openclaw_runtime/extensions/discord/src/monitor/provider.allowlist.ts
  - openclaw_runtime/extensions/discord/src/monitor/provider.startup.ts
  - openclaw_runtime/extensions/discord/src/security-audit.ts
  - openclaw_runtime/extensions/discord/src/status-issues.ts
  - openclaw_runtime/extensions/discord/src/voice/command.ts
  - openclaw_runtime/extensions/elevenlabs/config-compat.ts
  - openclaw_runtime/extensions/feishu/src/app-registration.ts
  - openclaw_runtime/extensions/feishu/src/bot.ts
  - openclaw_runtime/extensions/feishu/src/card-action.ts
  - openclaw_runtime/extensions/feishu/src/client.ts
  - openclaw_runtime/extensions/feishu/src/dedup.ts
  - openclaw_runtime/extensions/feishu/src/docx-batch-insert.ts
  - openclaw_runtime/extensions/feishu/src/docx-color-text.ts
  - openclaw_runtime/extensions/feishu/src/docx-table-ops.ts
  - openclaw_runtime/extensions/feishu/src/docx.ts
  - openclaw_runtime/extensions/feishu/src/media.ts
  - openclaw_runtime/extensions/feishu/src/probe.ts
  - openclaw_runtime/extensions/feishu/src/reply-dispatcher.ts
  - openclaw_runtime/extensions/feishu/src/sequential-queue.ts
  - openclaw_runtime/extensions/feishu/src/setup-surface.ts
  - openclaw_runtime/extensions/feishu/src/streaming-card.ts
  - openclaw_runtime/extensions/feishu/src/types.ts
  - openclaw_runtime/extensions/feishu/src/wiki.ts
  - openclaw_runtime/extensions/file-transfer/src/node-host/dir-fetch.ts
  - openclaw_runtime/extensions/file-transfer/src/node-host/file-write.ts
  - openclaw_runtime/extensions/file-transfer/src/shared/audit.ts
  - openclaw_runtime/extensions/file-transfer/src/shared/policy.ts
  - openclaw_runtime/extensions/file-transfer/src/tools/descriptors.ts
  - openclaw_runtime/extensions/file-transfer/src/tools/dir-fetch-tool.ts
  - openclaw_runtime/extensions/file-transfer/src/tools/dir-list-tool.ts
  - openclaw_runtime/extensions/file-transfer/src/tools/file-fetch-tool.ts
  - openclaw_runtime/extensions/github-copilot/models.ts
  - openclaw_runtime/extensions/google/gemini-cli-provider.ts
  - openclaw_runtime/extensions/google/transport-stream.ts
  - openclaw_runtime/extensions/googlechat/src/doctor-contract.ts
  - openclaw_runtime/extensions/imessage/src/accounts.ts
  - openclaw_runtime/extensions/imessage/src/actions.runtime.ts
  - openclaw_runtime/extensions/imessage/src/actions.ts
  - openclaw_runtime/extensions/imessage/src/approval-auth.ts
  - openclaw_runtime/extensions/imessage/src/approval-handler.runtime.ts
  - openclaw_runtime/extensions/imessage/src/approval-reactions.ts
  - openclaw_runtime/extensions/imessage/src/constants.ts
  - openclaw_runtime/extensions/imessage/src/markdown-format.ts
  - openclaw_runtime/extensions/imessage/src/monitor-reply-cache.ts
  - openclaw_runtime/extensions/imessage/src/monitor/catchup-bridge.ts
  - openclaw_runtime/extensions/imessage/src/monitor/catchup.ts
  - openclaw_runtime/extensions/imessage/src/monitor/coalesce.ts
  - openclaw_runtime/extensions/imessage/src/monitor/echo-cache.ts
  - openclaw_runtime/extensions/imessage/src/monitor/group-allowlist-warnings.ts
  - openclaw_runtime/extensions/imessage/src/monitor/inbound-dedupe.ts
  - openclaw_runtime/extensions/imessage/src/monitor/inbound-processing.ts
  - openclaw_runtime/extensions/imessage/src/monitor/monitor-provider.ts
  - openclaw_runtime/extensions/imessage/src/monitor/reaction-context.ts
  - openclaw_runtime/extensions/imessage/src/monitor/recovery-cursor.ts
  - openclaw_runtime/extensions/imessage/src/probe.ts
  - openclaw_runtime/extensions/imessage/src/send.ts
  - openclaw_runtime/extensions/imessage/src/state-migrations.ts
  - openclaw_runtime/extensions/line/src/flex-templates/media-control-cards.ts
  - openclaw_runtime/extensions/line/src/flex-templates/schedule-cards.ts
  - openclaw_runtime/extensions/line/src/markdown-to-line.ts
  - openclaw_runtime/extensions/line/src/send.ts
  - openclaw_runtime/extensions/lmstudio/src/stream.ts
  - openclaw_runtime/extensions/matrix/src/approval-native.ts
  - openclaw_runtime/extensions/matrix/src/approval-reactions.ts
  - openclaw_runtime/extensions/matrix/src/doctor-contract.ts
  - openclaw_runtime/extensions/matrix/src/matrix/monitor/config.ts
  - openclaw_runtime/extensions/matrix/src/matrix/monitor/handler.ts
  - openclaw_runtime/extensions/matrix/src/matrix/monitor/room-history.ts
  - openclaw_runtime/extensions/matrix/src/matrix/monitor/startup.ts
  - openclaw_runtime/extensions/matrix/src/matrix/subagent-hooks.ts
  - openclaw_runtime/extensions/mattermost/src/mattermost/client.ts
  - openclaw_runtime/extensions/mattermost/src/mattermost/directory.ts
  - openclaw_runtime/extensions/mattermost/src/mattermost/interactions.ts
  - openclaw_runtime/extensions/mattermost/src/mattermost/monitor-websocket.ts
  - openclaw_runtime/extensions/mattermost/src/mattermost/monitor.ts
  - openclaw_runtime/extensions/mattermost/src/mattermost/no-visible-reply-diagnostic.ts
  - openclaw_runtime/extensions/mattermost/src/mattermost/slash-http.ts
  - openclaw_runtime/extensions/mattermost/src/mattermost/slash-state.ts
  - openclaw_runtime/extensions/mattermost/src/normalize.ts
  - openclaw_runtime/extensions/memory-core/src/cli.runtime.ts
  - openclaw_runtime/extensions/memory-core/src/concept-vocabulary.ts
  - openclaw_runtime/extensions/memory-core/src/dreaming-narrative.ts
  - openclaw_runtime/extensions/memory-core/src/dreaming.ts
  - openclaw_runtime/extensions/memory-core/src/memory-budget.ts
  - openclaw_runtime/extensions/memory-core/src/memory/manager-sync-ops.ts
  - openclaw_runtime/extensions/memory-core/src/memory/manager-vector-warning.ts
  - openclaw_runtime/extensions/memory-core/src/memory/qmd-manager.ts
  - openclaw_runtime/extensions/memory-core/src/rem-evidence.ts
  - openclaw_runtime/extensions/memory-lancedb/index.ts
  - openclaw_runtime/extensions/memory-wiki/src/config-compat.ts
  - openclaw_runtime/extensions/microsoft-foundry/auth.ts
  - openclaw_runtime/extensions/microsoft-foundry/onboard.ts
  - openclaw_runtime/extensions/minimax/oauth.ts
  - openclaw_runtime/extensions/msteams/src/attachments/download.ts
  - openclaw_runtime/extensions/msteams/src/attachments/graph.ts
  - openclaw_runtime/extensions/msteams/src/attachments/shared.ts
  - openclaw_runtime/extensions/msteams/src/errors.ts
  - openclaw_runtime/extensions/msteams/src/feedback-invoke.ts
  - openclaw_runtime/extensions/msteams/src/file-consent.ts
  - openclaw_runtime/extensions/msteams/src/graph-messages.ts
  - openclaw_runtime/extensions/msteams/src/graph-thread.ts
  - openclaw_runtime/extensions/msteams/src/graph-upload.ts
  - openclaw_runtime/extensions/msteams/src/inbound.ts
  - openclaw_runtime/extensions/msteams/src/messenger.ts
  - openclaw_runtime/extensions/msteams/src/monitor-handler.ts
  - openclaw_runtime/extensions/msteams/src/monitor-handler/message-handler.ts
  - openclaw_runtime/extensions/msteams/src/monitor-handler/reaction-handler.ts
  - openclaw_runtime/extensions/msteams/src/monitor-handler/thread-session.ts
  - openclaw_runtime/extensions/msteams/src/monitor.ts
  - openclaw_runtime/extensions/msteams/src/oauth.flow.ts
  - openclaw_runtime/extensions/msteams/src/reply-dispatcher.ts
  - openclaw_runtime/extensions/msteams/src/reply-stream-controller.ts
  - openclaw_runtime/extensions/msteams/src/resolve-allowlist.ts
  - openclaw_runtime/extensions/msteams/src/sdk-types.ts
  - openclaw_runtime/extensions/msteams/src/sdk.ts
  - openclaw_runtime/extensions/msteams/src/send-context.ts
  - openclaw_runtime/extensions/msteams/src/send.ts
  - openclaw_runtime/extensions/msteams/src/sso.ts
  - openclaw_runtime/extensions/msteams/src/token.ts
  - openclaw_runtime/extensions/msteams/src/user-agent.ts
  - openclaw_runtime/extensions/nextcloud-talk/src/signature.ts
  - openclaw_runtime/extensions/oc-path/src/cli.ts
  - openclaw_runtime/extensions/oc-path/src/oc-path/ast.ts
  - openclaw_runtime/extensions/oc-path/src/oc-path/dispatch.ts
  - openclaw_runtime/extensions/oc-path/src/oc-path/edit.ts
  - openclaw_runtime/extensions/oc-path/src/oc-path/emit.ts
  - openclaw_runtime/extensions/oc-path/src/oc-path/find.ts
  - openclaw_runtime/extensions/oc-path/src/oc-path/index.ts
  - openclaw_runtime/extensions/oc-path/src/oc-path/jsonc/ast.ts
  - openclaw_runtime/extensions/oc-path/src/oc-path/jsonc/emit.ts
  - openclaw_runtime/extensions/oc-path/src/oc-path/jsonc/parse.ts
  - openclaw_runtime/extensions/oc-path/src/oc-path/jsonl/ast.ts
  - openclaw_runtime/extensions/oc-path/src/oc-path/jsonl/edit.ts
  - openclaw_runtime/extensions/oc-path/src/oc-path/jsonl/parse.ts
  - openclaw_runtime/extensions/oc-path/src/oc-path/jsonl/resolve.ts
  - openclaw_runtime/extensions/oc-path/src/oc-path/oc-path.ts
  - openclaw_runtime/extensions/oc-path/src/oc-path/parse.ts
  - openclaw_runtime/extensions/oc-path/src/oc-path/resolve.ts
  - openclaw_runtime/extensions/oc-path/src/oc-path/sentinel.ts
  - openclaw_runtime/extensions/oc-path/src/oc-path/universal.ts
  - openclaw_runtime/extensions/ollama/src/media-understanding-provider.ts
  - openclaw_runtime/extensions/openai/openai-chatgpt-device-code.ts
  - openclaw_runtime/extensions/openai/openai-chatgpt-provider.ts
  - openclaw_runtime/extensions/parallel/src/parallel-free-web-search-provider.shared.ts
  - openclaw_runtime/extensions/parallel/src/parallel-free-web-search-provider.ts
  - openclaw_runtime/extensions/parallel/src/parallel-mcp-search.runtime.ts
  - openclaw_runtime/extensions/qa-lab/src/agentic-parity-report.ts
  - openclaw_runtime/extensions/qa-lab/src/docker-up.runtime.ts
  - openclaw_runtime/extensions/qa-lab/src/live-transports/discord/discord-live.runtime.ts
  - openclaw_runtime/extensions/qa-lab/src/providers/mock-openai/server.ts
  - openclaw_runtime/extensions/qa-lab/src/suite.ts
  - openclaw_runtime/extensions/qa-lab/src/tool-coverage-report.ts
  - openclaw_runtime/extensions/qa-lab/web/src/ui-render.ts
  - openclaw_runtime/extensions/qa-matrix/src/runners/contract/scenario-runtime-approval.ts
  - openclaw_runtime/extensions/qqbot/src/bridge/approval/capability.ts
  - openclaw_runtime/extensions/qqbot/src/bridge/approval/handler-runtime.ts
  - openclaw_runtime/extensions/qqbot/src/bridge/bootstrap.ts
  - openclaw_runtime/extensions/qqbot/src/bridge/commands/result-dispatcher.ts
  - openclaw_runtime/extensions/qqbot/src/bridge/config.ts
  - openclaw_runtime/extensions/qqbot/src/bridge/gateway.ts
  - openclaw_runtime/extensions/qqbot/src/bridge/logger.ts
  - openclaw_runtime/extensions/qqbot/src/bridge/plugin-version.ts
  - openclaw_runtime/extensions/qqbot/src/bridge/runtime.ts
  - openclaw_runtime/extensions/qqbot/src/bridge/setup/finalize.ts
  - openclaw_runtime/extensions/qqbot/src/channel.setup.ts
  - openclaw_runtime/extensions/qqbot/src/channel.ts
  - openclaw_runtime/extensions/qqbot/src/engine/adapter/audio.port.ts
  - openclaw_runtime/extensions/qqbot/src/engine/adapter/commands.port.ts
  - openclaw_runtime/extensions/qqbot/src/engine/adapter/history.port.ts
  - openclaw_runtime/extensions/qqbot/src/engine/adapter/mention-gate.port.ts
  - openclaw_runtime/extensions/qqbot/src/engine/adapter/types.ts
  - openclaw_runtime/extensions/qqbot/src/engine/api/api-client.ts
  - openclaw_runtime/extensions/qqbot/src/engine/api/media-chunked.ts
  - openclaw_runtime/extensions/qqbot/src/engine/api/media.ts
  - openclaw_runtime/extensions/qqbot/src/engine/api/retry.ts
  - openclaw_runtime/extensions/qqbot/src/engine/api/routes.ts
  - openclaw_runtime/extensions/qqbot/src/engine/api/token.ts
  - openclaw_runtime/extensions/qqbot/src/engine/approval/index.ts
  - openclaw_runtime/extensions/qqbot/src/engine/commands/builtin/log-helpers.ts
  - openclaw_runtime/extensions/qqbot/src/engine/commands/builtin/register-approve.ts
  - openclaw_runtime/extensions/qqbot/src/engine/commands/builtin/register-basic.ts
  - openclaw_runtime/extensions/qqbot/src/engine/commands/builtin/register-clear-storage.ts
  - openclaw_runtime/extensions/qqbot/src/engine/commands/builtin/register-logs.ts
  - openclaw_runtime/extensions/qqbot/src/engine/commands/builtin/register-streaming.ts
  - openclaw_runtime/extensions/qqbot/src/engine/commands/slash-command-auth.ts
  - openclaw_runtime/extensions/qqbot/src/engine/commands/slash-command-handler.ts
  - openclaw_runtime/extensions/qqbot/src/engine/commands/slash-commands-impl.ts
  - openclaw_runtime/extensions/qqbot/src/engine/commands/slash-commands.ts
  - openclaw_runtime/extensions/qqbot/src/engine/config/credential-backup.ts
  - openclaw_runtime/extensions/qqbot/src/engine/config/credentials.ts
  - openclaw_runtime/extensions/qqbot/src/engine/config/group.ts
  - openclaw_runtime/extensions/qqbot/src/engine/config/resolve.ts
  - openclaw_runtime/extensions/qqbot/src/engine/config/setup-logic.ts
  - openclaw_runtime/extensions/qqbot/src/engine/gateway/codec.ts
  - openclaw_runtime/extensions/qqbot/src/engine/gateway/constants.ts
  - openclaw_runtime/extensions/qqbot/src/engine/gateway/event-dispatcher.ts
  - openclaw_runtime/extensions/qqbot/src/engine/gateway/gateway-connection.ts
  - openclaw_runtime/extensions/qqbot/src/engine/gateway/interaction-handler.ts
  - openclaw_runtime/extensions/qqbot/src/engine/gateway/message-queue.ts
  - openclaw_runtime/extensions/qqbot/src/engine/gateway/outbound-dispatch.ts
  - openclaw_runtime/extensions/qqbot/src/engine/gateway/reconnect.ts
  - openclaw_runtime/extensions/qqbot/src/engine/gateway/response-timeout.ts
  - openclaw_runtime/extensions/qqbot/src/engine/gateway/stages/assembly-stage.ts
  - openclaw_runtime/extensions/qqbot/src/engine/gateway/stages/content-stage.ts
  - openclaw_runtime/extensions/qqbot/src/engine/gateway/stages/envelope-stage.ts
  - openclaw_runtime/extensions/qqbot/src/engine/gateway/stages/index.ts
  - openclaw_runtime/extensions/qqbot/src/engine/gateway/stages/quote-stage.ts
  - openclaw_runtime/extensions/qqbot/src/engine/gateway/stages/refidx-stage.ts
  - openclaw_runtime/extensions/qqbot/src/engine/gateway/types.ts
  - openclaw_runtime/extensions/qqbot/src/engine/group/history.ts
  - openclaw_runtime/extensions/qqbot/src/engine/group/mention.ts
  - openclaw_runtime/extensions/qqbot/src/engine/messaging/decode-media-path.ts
  - openclaw_runtime/extensions/qqbot/src/engine/messaging/media-source.ts
  - openclaw_runtime/extensions/qqbot/src/engine/messaging/media-type-detect.ts
  - openclaw_runtime/extensions/qqbot/src/engine/messaging/outbound-audio-port.ts
  - openclaw_runtime/extensions/qqbot/src/engine/messaging/outbound-deliver.ts
  - openclaw_runtime/extensions/qqbot/src/engine/messaging/outbound-media-send.ts
  - openclaw_runtime/extensions/qqbot/src/engine/messaging/outbound-result-helpers.ts
  - openclaw_runtime/extensions/qqbot/src/engine/messaging/outbound-types.ts
  - openclaw_runtime/extensions/qqbot/src/engine/messaging/outbound.ts
  - openclaw_runtime/extensions/qqbot/src/engine/messaging/reply-dispatcher.ts
  - openclaw_runtime/extensions/qqbot/src/engine/messaging/reply-limiter.ts
  - openclaw_runtime/extensions/qqbot/src/engine/messaging/sender.ts
  - openclaw_runtime/extensions/qqbot/src/engine/messaging/streaming-c2c.ts
  - openclaw_runtime/extensions/qqbot/src/engine/messaging/streaming-media-send.ts
  - openclaw_runtime/extensions/qqbot/src/engine/messaging/target-parser.ts
  - openclaw_runtime/extensions/qqbot/src/engine/ref/format-message-ref.ts
  - openclaw_runtime/extensions/qqbot/src/engine/ref/store.ts
  - openclaw_runtime/extensions/qqbot/src/engine/session/known-users.ts
  - openclaw_runtime/extensions/qqbot/src/engine/session/session-store.ts
  - openclaw_runtime/extensions/qqbot/src/engine/tools/channel-api.ts
  - openclaw_runtime/extensions/qqbot/src/engine/tools/remind-logic.ts
  - openclaw_runtime/extensions/qqbot/src/engine/types.ts
  - openclaw_runtime/extensions/qqbot/src/engine/utils/attachment-tags.ts
  - openclaw_runtime/extensions/qqbot/src/engine/utils/audio.ts
  - openclaw_runtime/extensions/qqbot/src/engine/utils/diagnostics.ts
  - openclaw_runtime/extensions/qqbot/src/engine/utils/format.ts
  - openclaw_runtime/extensions/qqbot/src/engine/utils/log.ts
  - openclaw_runtime/extensions/qqbot/src/engine/utils/platform.ts
  - openclaw_runtime/extensions/qqbot/src/engine/utils/stt.ts
  - openclaw_runtime/extensions/qqbot/src/engine/utils/text-parsing.ts
  - openclaw_runtime/extensions/qqbot/src/engine/utils/voice-text.ts
  - openclaw_runtime/extensions/qqbot/src/exec-approvals.ts
  - openclaw_runtime/extensions/qqbot/src/types.ts
  - openclaw_runtime/extensions/signal/src/install-signal-cli.ts
  - openclaw_runtime/extensions/signal/src/monitor/event-handler.ts
  - openclaw_runtime/extensions/slack/http-routes-api.ts
  - openclaw_runtime/extensions/slack/runtime-setter-api.ts
  - openclaw_runtime/extensions/slack/src/approval-handler.runtime.ts
  - openclaw_runtime/extensions/slack/src/channel.ts
  - openclaw_runtime/extensions/slack/src/doctor-contract.ts
  - openclaw_runtime/extensions/slack/src/monitor/channel-type.ts
  - openclaw_runtime/extensions/slack/src/monitor/events/channels.ts
  - openclaw_runtime/extensions/slack/src/monitor/events/interactions.ts
  - openclaw_runtime/extensions/slack/src/monitor/message-handler/dispatch.ts
  - openclaw_runtime/extensions/slack/src/monitor/message-handler/prepare.ts
  - openclaw_runtime/extensions/slack/src/monitor/provider-support.ts
  - openclaw_runtime/extensions/slack/src/monitor/provider.ts
  - openclaw_runtime/extensions/slack/src/monitor/reconnect-policy.ts
  - openclaw_runtime/extensions/slack/src/progress-blocks.ts
  - openclaw_runtime/extensions/slack/src/security-audit.ts
  - openclaw_runtime/extensions/slack/src/send.ts
  - openclaw_runtime/extensions/slack/src/threading-tool-context.ts
  - openclaw_runtime/extensions/synology-chat/src/client.ts
  - openclaw_runtime/extensions/synology-chat/src/webhook-handler.ts
  - openclaw_runtime/extensions/talk-voice/index.ts
  - openclaw_runtime/extensions/telegram/src/account-config.ts
  - openclaw_runtime/extensions/telegram/src/approval-native.ts
  - openclaw_runtime/extensions/telegram/src/bot-core.ts
  - openclaw_runtime/extensions/telegram/src/bot-handlers.runtime.ts
  - openclaw_runtime/extensions/telegram/src/bot-message-context.implicit-mention.test-support.ts
  - openclaw_runtime/extensions/telegram/src/bot-native-command-menu.ts
  - openclaw_runtime/extensions/telegram/src/bot/delivery.resolve-media.ts
  - openclaw_runtime/extensions/telegram/src/command-ui.ts
  - openclaw_runtime/extensions/telegram/src/doctor-contract.ts
  - openclaw_runtime/extensions/telegram/src/doctor.ts
  - openclaw_runtime/extensions/telegram/src/format.ts
  - openclaw_runtime/extensions/telegram/src/group-access.ts
  - openclaw_runtime/extensions/telegram/src/model-buttons.ts
  - openclaw_runtime/extensions/telegram/src/network-errors.ts
  - openclaw_runtime/extensions/telegram/src/polling-session.ts
  - openclaw_runtime/extensions/telegram/src/polling-transport-state.ts
  - openclaw_runtime/extensions/telegram/src/security-audit.ts
  - openclaw_runtime/extensions/telegram/src/send.ts
  - openclaw_runtime/extensions/telegram/src/sendchataction-401-backoff.ts
  - openclaw_runtime/extensions/telegram/src/sequential-key.ts
  - openclaw_runtime/extensions/telegram/src/shared.ts
  - openclaw_runtime/extensions/telegram/src/state-migrations.ts
  - openclaw_runtime/extensions/telegram/src/status-issues.ts
  - openclaw_runtime/extensions/telegram/src/status-reaction-variants.ts
  - openclaw_runtime/extensions/telegram/src/token.ts
  - openclaw_runtime/extensions/thread-ownership/index.ts
  - openclaw_runtime/extensions/tlon/src/monitor/approval.ts
  - openclaw_runtime/extensions/voice-call/src/config-compat.ts
  - openclaw_runtime/extensions/voice-call/src/manager.ts
  - openclaw_runtime/extensions/voice-call/src/providers/twilio.ts
  - openclaw_runtime/extensions/whatsapp/src/agent-tools-login.ts
  - openclaw_runtime/extensions/whatsapp/src/auto-reply/deliver-reply.ts
  - openclaw_runtime/extensions/whatsapp/src/auto-reply/mentions.ts
  - openclaw_runtime/extensions/whatsapp/src/auto-reply/monitor.ts
  - openclaw_runtime/extensions/whatsapp/src/auto-reply/monitor/group-gating.ts
  - openclaw_runtime/extensions/whatsapp/src/auto-reply/monitor/process-message.ts
  - openclaw_runtime/extensions/whatsapp/src/auto-reply/util.ts
  - openclaw_runtime/extensions/whatsapp/src/connection-controller.ts
  - openclaw_runtime/extensions/whatsapp/src/doctor.ts
  - openclaw_runtime/extensions/whatsapp/src/inbound/extract.ts
  - openclaw_runtime/extensions/whatsapp/src/inbound/monitor.ts
  - openclaw_runtime/extensions/whatsapp/src/login-qr.ts
  - openclaw_runtime/extensions/whatsapp/src/login.ts
  - openclaw_runtime/extensions/whatsapp/src/monitor-inbox.append-upsert.test-support.ts
  - openclaw_runtime/extensions/whatsapp/src/quoted-message.ts
  - openclaw_runtime/extensions/workboard/doctor-contract-api.ts
  - openclaw_runtime/extensions/xai/video-generation-provider.ts
  - openclaw_runtime/extensions/xai/xai-oauth.ts
  - openclaw_runtime/extensions/zalouser/src/doctor-contract.ts
  - openclaw_runtime/extensions/zalouser/src/monitor.ts
  - openclaw_runtime/scripts/runtime-utf8-inventory.mjs
  - openclaw_runtime/scripts/runtime-utf8-inventory.test.mjs
expectedUserBehavior:
  - The user's original workspace and mixed DCS closure clone remain byte-for-byte untouched by remediation work and recoverable from verified bundles, patches, untracked-file copies, and SHA-256 inventories.
  - Every tracked textual file in the pruned Runtime is valid UTF-8 after remediation, while retained runtime, plugin, channel, provider, protocol, and build behavior remains intact.
  - The pruned Runtime build completes successfully without restoring an unowned full CLI, adding an empty compatibility shell, externalizing business dependencies, or weakening a build gate.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - contract-first-boundary
  - comms-regression
requiredTests:
  - node --test openclaw_runtime/scripts/runtime-utf8-inventory.test.mjs
  - node openclaw_runtime/scripts/runtime-utf8-inventory.mjs --root . --pathspec openclaw_runtime --output artifacts/runtime-utf8-recovery/final-inventory.json
  - pnpm --dir openclaw_runtime build
  - pnpm run typecheck
  - pnpm run lint
  - pnpm test
  - pnpm --dir openclaw_runtime db:kysely:check
  - pnpm run harness:ci
  - pnpm contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Before any Runtime production source is edited, this task's touchedAreas is amended to list every frozen repair allowlist, every exact production source or test path, and every evidence report, then Harness context and validate both exit 0 without --no-diff.
  - The canonical inventory scans Git blob bytes, records Git object identity and SHA-256 preimages, reports deterministic malformed byte ranges and bounded context, and distinguishes clean-filter-equivalent Windows worktrees from real drift.
  - Recovery manifests use the version 2 source-aligned-variable-length span model; current remove spans and source insert spans may differ in length and offsets always address the immutable preimage.
  - Every span records matching left and right preserved-byte anchors so swallowed delimiters, punctuation, variation selectors, zero-width joiners, and adjacent sequence bytes cannot be omitted from reconstruction.
  - Recovery apply refuses unresolved, candidate, or conflict confidence, missing evidence, changed preimages, missing or mismatched expected postimage hashes, mismatched remove bytes or anchors, empty remove spans, overlapping ranges, and paths outside the repository before writing any file.
  - Recovery prepares and validates every file before writing any file, so a later invalid repair cannot leave an earlier file partially updated.
  - Git-index apply mode verifies clean-filter identity against the index, applies canonical Git-blob offsets, and writes through the repository's actual smudge filters so CRLF checkouts are preserved without blanket line-ending conversion.
  - Every repaired byte range has exact or independently corroborated evidence, preimage and expected postimage hashes, matching anchors, and a nonempty evidence source list; unresolved recovery entry count is zero.
  - Upstream trees are evidence only; no file is replaced wholesale unless all bytes outside the damaged ranges are proven identical.
  - No lossy decoder, U+FFFD substitution, guessed punctuation, guessed CJK text, guessed emoji, blanket conversion, blanket skip, assertion deletion, or weakened gate is used.
  - Repair workers edit pairwise-disjoint frozen path allowlists, and integration verifies each worker's changed-file list is a subset of its allowlist.
  - Retained src/entry.ts bootstrap, plugin SDK health API, Gateway protocol schemas, status runtime entry, plugin/channel/provider behavior, and pruned build ownership are covered by focused tests.
  - Renderer, Electron Main, host API, Gateway transport policy, DCS working-memory behavior, COMPASS, task_state, knowledge, notes, and handoff are not modified by this remediation.
  - Strict final inventory reports invalidFiles 0, invalidUnits 0, worktreeMismatches 0, and unresolved repairs 0.
  - All required tests and the real pnpm --dir openclaw_runtime build exit 0, and independent review reports Critical 0 and Important 0 before this baseline is used by DCS Stage 1.
docs:
  required: true
  files:
    - docs/superpowers/specs/2026-07-11-dcs-stage1-recovery-orchestration-design.md
    - docs/superpowers/plans/2026-07-11-dcs-stage1-recovery-orchestration.md
---

# Pruned Runtime UTF-8 Baseline Remediation

This task is an operational prerequisite for DCS Stage 1, not a DCS behavior
specification. It must remain a separate commit range and acceptance report.
DCS v1.6 remains the only authority for working-memory behavior.

## Current Phase

The current touchedAreas is intentionally limited to inventory tooling and
evidence. The baseline inventory at coordinator seed `addae094a` reports:

- 11,275 tracked Runtime files;
- 11,245 classified textual files;
- 30 classified binary files;
- 370 invalid textual files;
- 1,571 malformed UTF-8 units;
- zero worktree-to-Git mismatches after Git clean filters.

No Runtime production source may be edited in this phase. W0 must merge W1-W4
evidence, freeze exact pairwise-disjoint repair allowlists, append every
production source and focused test path to touchedAreas, and rerun both Harness
commands before creating repair branches.

## Component Ownership

- Inventory tooling owns strict byte validation, Git preimage identity,
  deterministic context capture, manifest validation, and guarded apply.
- Evidence workers own candidate provenance only and cannot alter Runtime
  source.
- Runtime owner modules retain their behavior and focused tests; byte repair
  cannot move policy across plugin, channel, provider, Gateway, protocol,
  storage, or build boundaries.
- The integration worker owns cherry-pick order, conflict review, full scan,
  Runtime build-contract integration, and acceptance evidence.
- DCS Stage 1 owns no file in this remediation task and begins only from the
  accepted remediation commit.

## RED Evidence

The `artifacts/runtime-utf8-recovery/red-green` logs preserve test-first
failures for the missing scanner API, complete UTF-8 validation and file
classification, Git preimage inventory, guarded apply, and CLI gate behavior.
`baseline-scan.log` preserves the real large-index `ENOBUFS` failure.
`w1-red-07-git-blob-crlf.log` proves why raw Windows worktree offsets were
unacceptable. Matching GREEN logs record the smallest passing implementation.

## Recovery Evidence Standard

An `exact` replacement requires byte alignment against a source with identical
undamaged context. The recovery unit is a complete, source-aligned,
variable-length byte span, not one malformed UTF-8 unit or one replacement
code point. Its current offset addresses the immutable preimage; `removeHex`
and `insertHex` may differ in length; left and right anchors prove the
preserved boundaries; and the complete reconstructed file must match the
expected postimage SHA-256.

A `corroborated` replacement requires at least two independent evidence sources
and a focused behavior test when the bytes affect runtime strings, regexes,
schemas, identifiers, vocabularies, or protocol content. Anything else remains
`candidate`, `conflict`, or `unresolved` and blocks source repair.
