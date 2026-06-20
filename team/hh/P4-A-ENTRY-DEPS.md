# hh P4-A Entry.ts Dependency Analysis

Scope: read-only audit of `openclaw_runtime/src/entry.ts` and the static TypeScript import graph under `openclaw_runtime/src`. No runtime source files were modified.

## 1. entry.ts → gateway 启动最小路径

Current ClawX source-runtime startup still enters the CLI wrapper:

- `src/entry.ts:5` statically imports CLI argv helpers; `src/entry.ts:6` imports container target parsing; `src/entry.ts:7` imports CLI profile parsing; `src/entry.ts:9` imports Windows argv normalization.
- `src/entry.ts:157` calls `runMainOrRootHelp(process.argv)` after bootstrap/respawn/profile handling.
- `src/entry.ts:292` dynamically imports `./cli/run-main.js`; `src/entry.ts:296` calls `runCli(argv)`.
- `src/cli/run-main.ts:161` starts the gateway fast path if `isGatewayRunFastPathArgv(argv)` is true.
- `src/cli/run-main.ts:168`-`183` imports `commander`, `./gateway-cli/run-command.js`, version/banner/startup policy/logging.
- `src/cli/run-main.ts:202`-`207` registers `gateway` and nested `gateway run` with `addGatewayRunCommand`.
- `src/cli/gateway-cli/run-command.ts:56` lazy-loads `./run.js`; `src/cli/gateway-cli/run-command.ts:58` calls `runGatewayCommand(resolveGatewayRunOptions(opts, command))`.
- `src/cli/gateway-cli/run.ts:259`-`287` implements the `--allow-unconfigured` CLI preflight guard.
- `src/cli/gateway-cli/run.ts:685` reads `--token`; `src/cli/gateway-cli/run.ts:706`-`713` builds `authOverride`.
- `src/cli/gateway-cli/run.ts:808`-`812` imports `../../gateway/server.js`.
- `src/cli/gateway-cli/run.ts:829`-`838` calls `startGatewayServer(port, { bind, auth, tailscale, startupStartedAt, startupConfigSnapshotRead?, deferStartupSidecars? })`.
- `src/gateway/server.ts:30`-`35` lazily loads `src/gateway/server.impl.ts`.
- `src/gateway/server.impl.ts:541`-`545` exports the actual `startGatewayServer(port = 18789, opts = {})`.

Electron launch evidence:

- `electron/gateway/config-sync.ts:817` builds `gatewayArgs = ['gateway', '--port', String(port), '--token', appSettings.gatewayToken, '--allow-unconfigured']`.
- `electron/gateway/config-sync.ts:871`-`875` sets `OPENCLAW_GATEWAY_TOKEN`, channel skip envs, `OPENCLAW_NO_RESPAWN`, and source-runtime `NODE_OPTIONS=--import tsx`.
- `electron/gateway/process-launcher.ts:165` forks `entryScript` with `finalArgs` via `utilityProcess.fork(...)`.

Minimal gateway startup path after P4-B should bypass `src/cli/run-main.ts` and call `src/gateway/server.ts:startGatewayServer` directly.

## 2. CLI/TUI/Commands/Wizard 文件分类表

| class | files | size | meaning |
|---|---:|---:|---|
| 🔴 必需 | 200 | 1.46 MiB | reachable from gateway core roots; cannot delete before extraction |
| 🟡 CLI-only | 424 | 3.23 MiB | imported only by CLI/command/TUI/wizard-side graph, not gateway core |
| 🟢 孤立 | 66 | 0.44 MiB | no static TS importers found under `src` |

Static roots used for gateway core reachability: `src/gateway/server.ts`, `src/gateway/server.impl.ts`, `src/gateway/server-methods.ts`. Literal dynamic imports were included.

### 2.1 🔴 必需 — direct gateway imports

| file | size | gateway evidence |
|---|---:|---|
| `cli/deps.ts` | 3.7 KiB | gateway/openai-http.ts:22 `import { createDefaultDeps } from "../cli/deps.js";`<br>gateway/openresponses-http.ts:15 `import { createDefaultDeps } from "../cli/deps.js";`<br>gateway/server-methods/send.ts:20 `import { createOutboundSendDeps } from "../../cli/deps.js";` |
| `cli/deps.types.ts` | 0.2 KiB | gateway/boot.ts:13 `import type { CliDeps } from "../cli/deps.types.js";`<br>gateway/local-request-context.ts:4 `import type { CliDeps } from "../cli/deps.types.js";`<br>gateway/openresponses-http.ts:16 `import type { CliDeps } from "../cli/deps.types.js";` |
| `cli/outbound-send-deps.ts` | 0.5 KiB | gateway/server-node-events.runtime.ts:8 `export { createOutboundSendDeps } from "../cli/outbound-send-deps.js";` |
| `commands/agent.ts` | 0.1 KiB | gateway/boot.ts:14 `import { agentCommand } from "../commands/agent.js";`<br>gateway/openai-http.ts:23 `import { agentCommandFromIngress } from "../commands/agent.js";`<br>gateway/openresponses-http.ts:17 `import { agentCommandFromIngress } from "../commands/agent.js";` |
| `commands/agents.config.ts` | 6.6 KiB | gateway/assistant-identity.ts:5 `import { loadAgentIdentity } from "../commands/agents.config.js";`<br>gateway/server-methods/agents.ts:40 `import { applyAgentConfig } from "../../commands/agents.config.js";` |
| `commands/health.ts` | 32.9 KiB | gateway/server/health-state.ts:4 `import { getHealthSnapshot, type HealthSummary } from "../../commands/health.js";`<br>gateway/server-maintenance.ts:4 `import type { HealthSummary } from "../commands/health.js";`<br>gateway/server-node-events-types.ts:5 `import type { HealthSummary } from "../commands/health.js";` |
| `commands/health.types.ts` | 2.4 KiB | gateway/server-methods/health.ts:5 `import type { ChannelHealthSummary, HealthSummary } from "../../commands/health.types.js";`<br>gateway/server-methods/shared-types.ts:10 `import type { HealthSummary } from "../../commands/health.types.js";` |
| `commands/onboard-types.ts` | 3.5 KiB | gateway/server-methods/shared-types.ts:143 `opts: import("../../commands/onboard-types.js").OnboardOptions,`<br>gateway/server.impl.ts:515 `opts: import("../commands/onboard-types.js").OnboardOptions,` |
| `commands/status.ts` | 0.3 KiB | gateway/server-methods/health.ts:6 `import { getStatusSummary } from "../../commands/status.js";` |
| `wizard/prompts.ts` | 1.7 KiB | gateway/server-methods/shared-types.ts:145 `prompter: import("../../wizard/prompts.js").WizardPrompter,`<br>gateway/server.impl.ts:517 `prompter: import("../wizard/prompts.js").WizardPrompter,` |
| `wizard/session.ts` | 7.8 KiB | gateway/server-methods/shared-types.ts:15 `import type { WizardSession } from "../../wizard/session.js";`<br>gateway/server-methods/wizard.ts:14 `import { WizardSession } from "../../wizard/session.js";`<br>gateway/server-wizard-sessions.ts:3 `import type { WizardSession } from "../wizard/session.js";` |
| `wizard/setup.ts` | 30.4 KiB | gateway/server.impl.ts:538 `const { runSetupWizard } = await import("../wizard/setup.js");` |

### 2.1b 🔴 必需 — indirect gateway-reachable closure

These are pulled through the direct gateway imports above. They need extraction or a deliberate retained shared module before deletion.

| file | size | import-chain evidence sample |
|---|---:|---|
| `cli/argv.ts` | 12.3 KiB | cli/banner.ts:12 `import { hasRootVersionAlias } from "./argv.js";`<br>cli/command-catalog.ts:2 `import { hasFlag } from "./argv.js";`<br>cli/command-path-policy.ts:3 `import { getCommandPathWithRootOptions } from "./argv.js";` |
| `cli/cli-name.ts` | 1.0 KiB | cli/command-format.ts:2 `import { replaceCliName, resolveCliName } from "./cli-name.js";`<br>cli/nodes-camera.ts:7 `import { resolveCliName } from "./cli-name.js";`<br>cli/program/help.ts:9 `import { replaceCliName, resolveCliName } from "../cli-name.js";` |
| `cli/command-config-resolution.runtime.ts` | 0.2 KiB | agents/agent-runtime-config.ts:38 `await import("../cli/command-config-resolution.runtime.js")` |
| `cli/command-config-resolution.ts` | 1.9 KiB | cli/capability-cli.ts:106 `import { resolveCommandConfigWithSecrets } from "./command-config-resolution.js";`<br>cli/command-config-resolution.runtime.ts:2 `export { resolveCommandConfigWithSecrets } from "./command-config-resolution.js";`<br>commands/channels/resolve.ts:12 `import { resolveCommandConfigWithSecrets } from "../../cli/command-config-resolution.js";` |
| `cli/command-format.ts` | 1.9 KiB | agents/agent-command.ts:15 `import { formatCliCommand } from "../cli/command-format.js";`<br>agents/auth-profiles/oauth-refresh-failure.ts:8 `import { formatCliCommand } from "../../cli/command-format.js";`<br>agents/failover-error.ts:7 `import { formatCliCommand } from "../cli/command-format.js";` |
| `cli/command-secret-gateway.ts` | 35.6 KiB | agents/tools/message-tool.ts:35 `import { resolveCommandSecretRefsViaGateway } from "../../cli/command-secret-gateway.js";`<br>auto-reply/reply/agent-runner-utils.ts:12 `import { resolveCommandSecretRefsViaGateway } from "../../cli/command-secret-gateway.js";`<br>cli/qr-cli.ts:14 `import { resolveCommandSecretRefsViaGateway } from "./command-secret-gateway.js";` |
| `cli/command-secret-targets.ts` | 33.3 KiB | agents/agent-runtime-config.ts:2 `import { getAgentRuntimeCommandSecretTargetIds } from "../cli/command-secret-targets.js";`<br>agents/tools/message-tool.ts:36 `import { getScopedChannelsCommandSecretTargets } from "../../cli/command-secret-targets.js";`<br>cli/qr-cli.ts:15 `import { getQrRemoteCommandSecretTargetIds } from "./command-secret-targets.js";` |
| `cli/daemon-cli/probe.ts` | 5.1 KiB | cli/daemon-cli/status.gather.ts:123 `const daemonProbeModuleLoader = createLazyImportLoader(() => import("./probe.js"));`<br>commands/doctor-gateway-health.ts:3 `import { probeGatewayStatus } from "../cli/daemon-cli/probe.js";`<br>commands/health.ts:17 `import { probeGatewayStatus } from "../cli/daemon-cli/probe.js";` |
| `cli/error-format.ts` | 4.6 KiB | cli/channel-auth.ts:20 `import { formatUnsupportedChannelActionMessage } from "./error-format.js";`<br>cli/config-cli.ts:85 `import { formatStrictJsonParseFailure } from "./error-format.js";`<br>cli/daemon-cli/install.ts:28 `import { formatInvalidConfigPort, formatInvalidPortOption } from "../error-format.js";` |
| `cli/message-secret-scope.ts` | 2.3 KiB | agents/tools/message-tool.ts:37 `import { resolveMessageSecretScope } from "../../cli/message-secret-scope.js";`<br>auto-reply/reply/agent-runner-utils.ts:17 `import { resolveMessageSecretScope } from "../../cli/message-secret-scope.js";`<br>cli/program/message/helpers.ts:8 `import { resolveMessageSecretScope } from "../../../cli/message-secret-scope.js";` |
| `cli/npm-resolution.ts` | 3.5 KiB | auto-reply/reply/commands-plugins.ts:4 `import { buildNpmInstallRecordFields } from "../../cli/npm-resolution.js";`<br>cli/plugins-install-command.ts:41 `import { resolvePinnedNpmInstallRecordForCli } from "./npm-resolution.js";` |
| `cli/outbound-send-mapping.ts` | 3.8 KiB | cli/deps.types.ts:2 `import type { CliOutboundSendSource } from "./outbound-send-mapping.js";`<br>cli/outbound-send-deps.ts:4 `import { createOutboundSendDepsFromCliSource } from "./outbound-send-mapping.js";` |
| `cli/parse-bytes.ts` | 1.6 KiB | config/byte-size.ts:2 `import { parseByteSize } from "../cli/parse-bytes.js";`<br>config/sessions/store-maintenance.ts:6 `import { parseByteSize } from "../../cli/parse-bytes.js";`<br>config/zod-schema.session.ts:4 `import { parseByteSize } from "../cli/parse-bytes.js";` |
| `cli/parse-duration.ts` | 2.7 KiB | agents/acp-spawn.ts:43 `import { parseDurationMs } from "../cli/parse-duration.js";`<br>agents/agent-hooks/context-pruning/settings.ts:2 `import { parseDurationMs } from "../../../cli/parse-duration.js";`<br>agents/heartbeat-system-prompt.ts:9 `import { parseDurationMs } from "../cli/parse-duration.js";` |
| `cli/parse-timeout.ts` | 1.7 KiB | cli/capability-cli.ts:114 `import { parseTimeoutMsWithFallback } from "./parse-timeout.js";`<br>cli/devices-cli.runtime.ts:42 `import { parseTimeoutMsWithFallback } from "./parse-timeout.js";`<br>cli/gateway-cli/call.ts:9 `import { parseTimeoutMsWithFallback } from "../parse-timeout.js";` |
| `cli/plugin-install-plan.ts` | 5.3 KiB | auto-reply/reply/commands-plugins.ts:5 `import { resolveOfficialExternalNpmPackageTrust } from "../../cli/plugin-install-plan.js";`<br>commands/onboarding-plugin-install.ts:11 `import { resolveBundledInstallPlanForCatalogEntry } from "../cli/plugin-install-plan.js";` |
| `cli/plugins-install-persist.ts` | 9.8 KiB | auto-reply/reply/commands-plugins.ts:10 `import { persistPluginInstall } from "../../cli/plugins-install-persist.js";`<br>auto-reply/reply/commands-plugins.ts:10 `import { persistPluginInstall } from "../../cli/plugins-install-persist.js";`<br>cli/plugins-install-command.ts:60 `import { persistHookPackInstall, persistPluginInstall } from "./plugins-install-persist.js";` |
| `cli/plugins-install-record-commit.ts` | 9.6 KiB | cli/channel-auth.ts:21 `import { commitConfigWithPendingPluginInstalls } from "./plugins-install-record-commit.js";`<br>cli/directory-cli.ts:20 `import { commitConfigWithPendingPluginInstalls } from "./plugins-install-record-commit.js";`<br>cli/plugins-install-persist.ts:30 `import { commitPluginInstallRecordsWithConfig } from "./plugins-install-record-commit.js";` |
| `cli/plugins-registry-refresh.ts` | 2.7 KiB | auto-reply/reply/commands-plugins.ts:12 `import { refreshPluginRegistryAfterConfigMutation } from "../../cli/plugins-registry-refresh.js";`<br>cli/plugins-cli.runtime.ts:39 `() => import("./plugins-registry-refresh.js"),`<br>cli/plugins-install-persist.ts:31 `import { refreshPluginRegistryAfterConfigMutation } from "./plugins-registry-refresh.js";` |
| `cli/profile-utils.ts` | 0.7 KiB | cli/command-format.ts:3 `import { normalizeProfileName } from "./profile-utils.js";`<br>cli/profile.ts:11 `import { isValidProfileName } from "./profile-utils.js";` |
| `cli/program/command-descriptor-utils.ts` | 4.1 KiB | cli/program/core-command-descriptors.ts:2 `import { defineCommandDescriptorCatalog } from "./command-descriptor-utils.js";`<br>cli/program/subcli-descriptors.ts:2 `import { defineCommandDescriptorCatalog } from "./command-descriptor-utils.js";`<br>plugins/cli-registry-loader.ts:4 `import { collectUniqueCommandDescriptors } from "../cli/program/command-descriptor-utils.js";` |
| `cli/program/command-group-descriptors.ts` | 5.2 KiB | cli/program/command-descriptor-utils.ts:4 `import type { NamedCommandDescriptor } from "./command-group-descriptors.js";`<br>cli/program/core-command-descriptors.ts:3 `import type { NamedCommandDescriptor } from "./command-group-descriptors.js";`<br>cli/program/subcli-descriptors.ts:3 `import type { NamedCommandDescriptor } from "./command-group-descriptors.js";` |
| `cli/program/core-command-descriptors.ts` | 4.0 KiB | cli/argv.ts:9 `import { CORE_CLI_COMMAND_DESCRIPTORS } from "./program/core-command-descriptors.js";`<br>cli/program/help.ts:12 `import { getCoreCliCommandsWithSubcommands } from "./core-command-descriptors.js";`<br>cli/program/root-help.ts:11 `import { getCoreCliCommandDescriptors } from "./core-command-descriptors.js";` |
| `cli/program/private-qa-cli.ts` | 2.7 KiB | cli/program/register.subclis-core.ts:16 `import { loadPrivateQaCliModule } from "./private-qa-cli.js";`<br>cli/program/subcli-descriptors.ts:4 `import { isPrivateQaCliEnabled } from "./private-qa-cli.js";` |
| `cli/program/subcli-descriptors.ts` | 6.0 KiB | cli/argv.ts:10 `import { SUB_CLI_DESCRIPTORS } from "./program/subcli-descriptors.js";`<br>cli/program/help.ts:14 `import { getSubCliCommandsWithSubcommands } from "./subcli-descriptors.js";`<br>cli/program/root-help.ts:13 `import { getSubCliEntries } from "./subcli-descriptors.js";` |
| `cli/progress.ts` | 6.9 KiB | cli/daemon-cli/probe.ts:6 `import { withProgress } from "../progress.js";`<br>cli/devices-cli.runtime.ts:43 `import { withProgress } from "./progress.js";`<br>cli/gateway-cli/call.ts:10 `import { withProgress } from "../progress.js";` |
| `cli/prompt.ts` | 2.3 KiB | cli/plugins-uninstall-command.ts:26 `PromptInputClosedError: typeof import("./prompt.js").PromptInputClosedError,`<br>cli/plugins-uninstall-command.ts:26 `PromptInputClosedError: typeof import("./prompt.js").PromptInputClosedError,`<br>cli/plugins-update-command.ts:24 `import { promptYesNo } from "./prompt.js";` |
| `cli/send-runtime/channel-outbound-send.ts` | 3.4 KiB | cli/deps.ts:85 `await import("./send-runtime/channel-outbound-send.js");` |
| `commands/auth-choice-legacy.ts` | 3.7 KiB | commands/auth-choice-options.static.ts:2 `import { resolveLegacyAuthChoiceAliasesForCli } from "./auth-choice-legacy.js";`<br>commands/auth-choice.apply.ts:17 `const { normalizeLegacyOnboardAuthChoice } = await import("./auth-choice-legacy.js");`<br>plugins/provider-auth-choice-preference.ts:2 `import { normalizeLegacyOnboardAuthChoice } from "../commands/auth-choice-legacy.js";` |
| `commands/auth-choice-options.static.ts` | 1.6 KiB | commands/auth-choice-prompt.ts:6 `import type { AuthChoiceGroup } from "./auth-choice-options.static.js";` |
| `commands/auth-choice-options.ts` | 5.8 KiB | cli/program/register.onboard.ts:5 `import { formatAuthChoiceChoicesForCli } from "../../commands/auth-choice-options.js";`<br>commands/auth-choice-prompt.ts:5 `import { buildAuthChoiceGroups, compareAuthChoiceGroups } from "./auth-choice-options.js";` |
| `commands/auth-choice-prompt.ts` | 4.6 KiB | commands/agents.commands.add.ts:40 `import { promptAuthChoiceGrouped } from "./auth-choice-prompt.js";`<br>commands/configure.gateway-auth.ts:9 `import { promptAuthChoiceGrouped } from "./auth-choice-prompt.js";`<br>wizard/setup.ts:659 `| (typeof import("../commands/auth-choice-prompt.js"))["promptAuthChoiceGrouped"]` |
| `commands/auth-choice.apply-helpers.ts` | 0.2 KiB | commands/auth-choice.apply.api-providers.ts:5 `import { normalizeTokenProviderInput } from "./auth-choice.apply-helpers.js";`<br>commands/onboard-non-interactive/local/auth-choice.ts:20 `import { normalizeSecretInputModeInput } from "../../auth-choice.apply-helpers.js";` |
| `commands/auth-choice.apply.api-providers.ts` | 2.5 KiB | commands/auth-choice.apply.ts:36 `await import("./auth-choice.apply.api-providers.js");`<br>commands/onboard-non-interactive/local/auth-choice.ts:21 `import { normalizeApiKeyTokenProviderAuthChoice } from "../../auth-choice.apply.api-providers.js";` |
| `commands/auth-choice.apply.ts` | 4.1 KiB | commands/auth-choice.ts:2 `export { applyAuthChoice } from "./auth-choice.apply.js";` |
| `commands/auth-choice.apply.types.ts` | 0.8 KiB | commands/auth-choice.apply.api-providers.ts:6 `import type { ApplyAuthChoiceParams, ApplyAuthChoiceResult } from "./auth-choice.apply.types.js";`<br>commands/auth-choice.apply.ts:4 `import type { ApplyAuthChoiceParams, ApplyAuthChoiceResult } from "./auth-choice.apply.types.js";` |
| `commands/auth-choice.model-check.ts` | 4.2 KiB | commands/auth-choice.ts:3 `export { warnIfModelConfigLooksOff } from "./auth-choice.model-check.js";` |
| `commands/auth-choice.preferred-provider.ts` | 0.1 KiB | commands/auth-choice.ts:4 `export { resolvePreferredProviderForAuthChoice } from "./auth-choice.preferred-provider.js";` |
| `commands/auth-choice.ts` | 0.3 KiB | commands/agents.commands.add.ts:41 `import { applyAuthChoice, warnIfModelConfigLooksOff } from "./auth-choice.js";`<br>commands/configure.gateway-auth.ts:10 `import { applyAuthChoice, resolvePreferredProviderForAuthChoice } from "./auth-choice.js";`<br>wizard/setup.ts:41 `type AuthChoiceModule = typeof import("../commands/auth-choice.js");` |
| `commands/backup-verify.ts` | 13.3 KiB | cli/program/register.backup.ts:5 `import { backupVerifyCommand } from "../../commands/backup-verify.js";`<br>commands/backup.ts:12 `type BackupVerifyRuntime = typeof import("./backup-verify.js");`<br>commands/backup.ts:12 `type BackupVerifyRuntime = typeof import("./backup-verify.js");` |
| `commands/backup.ts` | 1.5 KiB | cli/program/register.backup.ts:6 `import { backupCreateCommand } from "../../commands/backup.js";`<br>commands/migrate/apply.ts:8 `import { backupCreateCommand } from "../backup.js";` |
| `commands/channel-account-context.ts` | 4.7 KiB | commands/doctor-security.ts:25 `import { resolveDefaultChannelAccountContext } from "./channel-account-context.js";`<br>commands/status.link-channel.ts:8 `import { resolveDefaultChannelAccountContext } from "./channel-account-context.js";` |
| `commands/cleanup-utils.ts` | 8.1 KiB | commands/backup-shared.ts:11 `import { buildCleanupPlan, isPathWithin } from "./cleanup-utils.js";`<br>commands/cleanup-plan.ts:9 `import { buildCleanupPlan } from "./cleanup-utils.js";`<br>infra/backup-create.ts:16 `import { isPathWithin } from "../commands/cleanup-utils.js";` |
| `commands/codex-runtime-plugin-install.ts` | 1.5 KiB | commands/models/auth.ts:67 `import { repairCodexRuntimePluginInstallForModelSelection } from "../codex-runtime-plugin-install.js";`<br>commands/models/set.ts:5 `import { repairCodexRuntimePluginInstallForModelSelection } from "../codex-runtime-plugin-install.js";`<br>plugins/provider-auth-choice.ts:167 `await import("../commands/codex-runtime-plugin-install.js");` |
| `commands/copilot-runtime-plugin-install.ts` | 1.5 KiB | commands/models/auth.ts:68 `import { repairCopilotRuntimePluginInstallForModelSelection } from "../copilot-runtime-plugin-install.js";`<br>commands/models/set.ts:6 `import { repairCopilotRuntimePluginInstallForModelSelection } from "../copilot-runtime-plugin-install.js";`<br>commands/onboard-non-interactive/local/auth-choice.plugin-providers.ts:30 `import { ensureCopilotRuntimePluginForModelSelection } from "../../copilot-runtime-plugin-install.js";` |
| `commands/daemon-runtime.ts` | 0.7 KiB | cli/daemon-cli/start-repair.ts:3 `import { DEFAULT_GATEWAY_DAEMON_RUNTIME } from "../../commands/daemon-runtime.js";`<br>cli/program/register.onboard.ts:6 `import type { GatewayDaemonRuntime } from "../../commands/daemon-runtime.js";`<br>commands/daemon-install-helpers.ts:52 `import type { GatewayDaemonRuntime } from "./daemon-runtime.js";` |
| `commands/doctor-completion.ts` | 7.7 KiB | flows/doctor-health-contributions.ts:811 `const { doctorShellCompletion } = await import("../commands/doctor-completion.js");`<br>wizard/setup.completion.ts:10 `import type { ShellCompletionStatus } from "../commands/doctor-completion.js";` |
| `commands/doctor-prompter.ts` | 3.9 KiB | commands/doctor/cron/index.ts:16 `import type { DoctorPrompter, DoctorOptions } from "../../doctor-prompter.js";`<br>commands/doctor-auth-flat-profiles.ts:36 `import type { DoctorPrompter } from "./doctor-prompter.js";`<br>commands/doctor-auth-legacy-oauth.ts:6 `import type { DoctorPrompter } from "./doctor-prompter.js";` |
| `commands/doctor.types.ts` | 0.3 KiB | commands/doctor-prompter.ts:13 `import type { DoctorOptions } from "./doctor.types.js";`<br>commands/doctor-prompter.ts:13 `import type { DoctorOptions } from "./doctor.types.js";`<br>commands/doctor-repair-mode.ts:3 `import type { DoctorOptions } from "./doctor.types.js";` |
| `commands/doctor/shared/legacy-config-issues.ts` | 2.0 KiB | commands/doctor-config-flow.ts:151 `await import("./doctor/shared/legacy-config-issues.js");`<br>commands/doctor-config-preflight.ts:16 `import { findDoctorLegacyConfigIssues } from "./doctor/shared/legacy-config-issues.js";`<br>config/io.ts:1357 `await import("../commands/doctor/shared/legacy-config-issues.js");` |
| `commands/doctor/shared/legacy-config-migrations.audio.ts` | 2.0 KiB | commands/doctor/shared/legacy-config-migrations.ts:2 `import { LEGACY_CONFIG_MIGRATIONS_AUDIO } from "./legacy-config-migrations.audio.js";` |
| `commands/doctor/shared/legacy-config-migrations.channels.ts` | 18.2 KiB | commands/doctor/shared/legacy-config-migrations.ts:3 `import { LEGACY_CONFIG_MIGRATIONS_CHANNELS } from "./legacy-config-migrations.channels.js";` |
| `commands/doctor/shared/legacy-config-migrations.queue.ts` | 2.6 KiB | commands/doctor/shared/legacy-config-migrations.ts:4 `import { LEGACY_CONFIG_MIGRATIONS_QUEUE } from "./legacy-config-migrations.queue.js";` |
| `commands/doctor/shared/legacy-config-migrations.runtime.agents.ts` | 46.0 KiB | commands/doctor/shared/legacy-config-migrations.runtime.ts:3 `import { LEGACY_CONFIG_MIGRATIONS_RUNTIME_AGENTS } from "./legacy-config-migrations.runtime.agents.js";` |
| `commands/doctor/shared/legacy-config-migrations.runtime.diagnostics.ts` | 1.9 KiB | commands/doctor/shared/legacy-config-migrations.runtime.ts:4 `import { LEGACY_CONFIG_MIGRATIONS_RUNTIME_DIAGNOSTICS } from "./legacy-config-migrations.runtime.diagnostics.js";` |
| `commands/doctor/shared/legacy-config-migrations.runtime.gateway.ts` | 5.0 KiB | commands/doctor/shared/legacy-config-migrations.runtime.ts:5 `import { LEGACY_CONFIG_MIGRATIONS_RUNTIME_GATEWAY } from "./legacy-config-migrations.runtime.gateway.js";` |
| `commands/doctor/shared/legacy-config-migrations.runtime.mcp.ts` | 2.2 KiB | commands/doctor/shared/legacy-config-migrations.runtime.ts:6 `import { LEGACY_CONFIG_MIGRATIONS_RUNTIME_MCP } from "./legacy-config-migrations.runtime.mcp.js";` |
| `commands/doctor/shared/legacy-config-migrations.runtime.models.ts` | 53.3 KiB | commands/doctor/shared/legacy-config-migrations.runtime.ts:7 `import { LEGACY_CONFIG_MIGRATIONS_RUNTIME_MODELS } from "./legacy-config-migrations.runtime.models.js";`<br>commands/doctor/shared/preview-warnings.ts:783 `await import("./legacy-config-migrations.runtime.models.js");` |
| `commands/doctor/shared/legacy-config-migrations.runtime.providers.ts` | 5.4 KiB | commands/doctor/shared/legacy-config-migrations.runtime.ts:8 `import { LEGACY_CONFIG_MIGRATIONS_RUNTIME_PROVIDERS } from "./legacy-config-migrations.runtime.providers.js";` |
| `commands/doctor/shared/legacy-config-migrations.runtime.session.ts` | 2.3 KiB | commands/doctor/shared/legacy-config-migrations.runtime.ts:9 `import { LEGACY_CONFIG_MIGRATIONS_RUNTIME_SESSION } from "./legacy-config-migrations.runtime.session.js";` |
| `commands/doctor/shared/legacy-config-migrations.runtime.ts` | 1.5 KiB | commands/doctor/shared/legacy-config-migrations.ts:5 `import { LEGACY_CONFIG_MIGRATIONS_RUNTIME } from "./legacy-config-migrations.runtime.js";` |
| `commands/doctor/shared/legacy-config-migrations.runtime.tts.ts` | 19.2 KiB | commands/doctor/shared/legacy-config-migrations.runtime.ts:10 `import { LEGACY_CONFIG_MIGRATIONS_RUNTIME_TTS } from "./legacy-config-migrations.runtime.tts.js";` |
| `commands/doctor/shared/legacy-config-migrations.ts` | 1.2 KiB | commands/doctor/shared/legacy-config-compat.ts:3 `import { LEGACY_CONFIG_MIGRATIONS } from "./legacy-config-migrations.js";`<br>commands/doctor/shared/legacy-config-rules.ts:2 `export { LEGACY_CONFIG_MIGRATION_RULES as LEGACY_CONFIG_RULES } from "./legacy-config-migrations.js";` |
| `commands/doctor/shared/legacy-config-migrations.web-search.ts` | 1.6 KiB | commands/doctor/shared/legacy-config-migrations.ts:6 `import { LEGACY_CONFIG_MIGRATIONS_WEB_SEARCH } from "./legacy-config-migrations.web-search.js";` |
| `commands/doctor/shared/legacy-config-record-shared.ts` | 0.9 KiB | commands/doctor/shared/channel-legacy-config-migrate.ts:9 `import { isRecord } from "./legacy-config-record-shared.js";`<br>commands/doctor/shared/legacy-config-core-normalizers.ts:13 `import { hasOwnKey, isRecord } from "./legacy-config-record-shared.js";`<br>commands/doctor/shared/legacy-config-migrations.runtime.mcp.ts:11 `import { isRecord } from "./legacy-config-record-shared.js";` |
| `commands/doctor/shared/legacy-config-rules.ts` | 0.2 KiB | config/legacy.rules.ts:2 `export { LEGACY_CONFIG_RULES } from "../commands/doctor/shared/legacy-config-rules.js";` |
| `commands/doctor/shared/legacy-models-add-metadata.ts` | 1.4 KiB | commands/doctor/shared/legacy-config-core-normalizers.ts:14 `import { isLegacyModelsAddCodexMetadataModel } from "./legacy-models-add-metadata.js";`<br>commands/doctor/shared/legacy-config-migrations.runtime.models.ts:12 `import { isLegacyModelsAddCodexMetadataModel } from "./legacy-models-add-metadata.js";` |
| `commands/doctor/shared/legacy-runtime-model-providers.ts` | 3.4 KiB | commands/doctor/shared/legacy-config-migrations.runtime.agents.ts:17 `import { listLegacyRuntimeModelProviderAliases } from "./legacy-runtime-model-providers.js";` |
| `commands/doctor/shared/legacy-x-search-migrate.ts` | 3.4 KiB | commands/doctor/shared/legacy-config-compatibility-base.ts:17 `import { migrateLegacyXSearchConfig } from "./legacy-x-search-migrate.js";`<br>commands/doctor/shared/legacy-config-migrations.runtime.providers.ts:8 `import { migrateLegacyXSearchConfig } from "./legacy-x-search-migrate.js";` |
| `commands/gateway-install-token.ts` | 7.3 KiB | cli/daemon-cli/install.ts:10 `import { resolveGatewayInstallToken } from "../../commands/gateway-install-token.js";`<br>cli/daemon-cli/start-repair.ts:4 `import { resolveGatewayInstallToken } from "../../commands/gateway-install-token.js";`<br>commands/configure.daemon.ts:16 `import { resolveGatewayInstallToken } from "./gateway-install-token.js";` |
| `commands/gateway-presence.ts` | 1.7 KiB | commands/gateway-status/helpers.ts:13 `import { pickGatewaySelfPresence } from "../gateway-presence.js";`<br>commands/status.gateway-probe.ts:9 `export { pickGatewaySelfPresence } from "./gateway-presence.js";`<br>commands/status.scan.shared.ts:23 `import { pickGatewaySelfPresence } from "./gateway-presence.js";` |
| `commands/gateway-status/helpers.ts` | 13.6 KiB | commands/gateway-status/output.ts:181 `network: ReturnType<typeof import("./helpers.js").buildNetworkHints>;`<br>commands/status.scan.shared.ts:24 `import { isProbeReachable } from "./gateway-status/helpers.js";` |
| `commands/health-format.ts` | 8.3 KiB | commands/configure.wizard.ts:42 `import { formatHealthCheckFailure } from "./health-format.js";`<br>commands/doctor-gateway-daemon-flow.ts:50 `import { formatHealthCheckFailure } from "./health-format.js";`<br>commands/doctor-gateway-health.ts:21 `import { formatHealthCheckFailure } from "./health-format.js";` |
| `commands/migrate.ts` | 17.8 KiB | wizard/setup.post-install-migration.ts:211 `import("../commands/migrate.js"),` |
| `commands/migrate/apply.ts` | 4.8 KiB | commands/migrate.ts:20 `import { runMigrationApply } from "./migrate/apply.js";`<br>wizard/setup.migration-import.ts:251 `import("../commands/migrate/apply.js"),` |
| `commands/migrate/context.ts` | 2.1 KiB | commands/migrate/apply.ts:9 `import { buildMigrationContext, buildMigrationReportDir } from "./context.js";`<br>commands/migrate/providers.ts:10 `import { buildMigrationContext } from "./context.js";`<br>wizard/setup.migration-import.ts:36 `let migrationContextModulePromise: Promise<typeof import("../commands/migrate/context.js")> | null =` |
| `commands/migrate/output.ts` | 9.1 KiB | commands/migrate/apply.ts:10 `import { assertApplySucceeded, assertConflictFreePlan, writeApplyResult } from "./output.js";`<br>commands/migrate/selection.ts:8 `import { MIGRATION_CONFLICT_REASON_PHRASES } from "./output.js";`<br>commands/migrate.ts:21 `import { formatMigrationPreview } from "./migrate/output.js";` |
| `commands/migrate/providers.ts` | 2.5 KiB | commands/migrate/apply.ts:11 `import { buildMigrationProviderOptions } from "./providers.js";`<br>commands/migrate.ts:22 `import { createMigrationPlan, resolveMigrationProvider } from "./migrate/providers.js";` |
| `commands/migrate/selection.ts` | 18.7 KiB | commands/migrate/apply.ts:12 `import { applyMigrationPluginSelection, applyMigrationSkillSelection } from "./selection.js";` |
| `commands/migrate/skill-selection-prompt.ts` | 9.3 KiB | commands/migrate.ts:44 `import { promptMigrationSelectionValues } from "./migrate/skill-selection-prompt.js";` |
| `commands/migrate/types.ts` | 1.8 KiB | commands/migrate/apply.ts:13 `import type { MigrateApplyOptions } from "./types.js";`<br>commands/migrate/output.ts:8 `import type { MigrateApplyOptions } from "./types.js";`<br>commands/migrate/providers.ts:11 `import type { MigrateCommonOptions } from "./types.js";` |
| `commands/model-picker.ts` | 0.4 KiB | wizard/setup.ts:43 `type ModelPickerModule = typeof import("../commands/model-picker.js");`<br>wizard/setup.ts:43 `type ModelPickerModule = typeof import("../commands/model-picker.js");` |
| `commands/models/alias-name.ts` | 0.4 KiB | commands/models/shared.ts:23 `export { normalizeAlias } from "./alias-name.js";`<br>commands/onboard-custom-config.ts:20 `import { normalizeAlias } from "./models/alias-name.js";` |
| `commands/models/list.local-url.ts` | 0.6 KiB | commands/models/list.model-row.ts:3 `import { isLocalBaseUrl } from "./list.local-url.js";`<br>commands/models/shared.ts:24 `export { isLocalBaseUrl } from "./list.local-url.js";` |
| `commands/models/provider-aliases.ts` | 5.0 KiB | commands/models/list.configured.ts:14 `import { createModelCatalogProviderAliasCanonicalizer } from "./provider-aliases.js";`<br>commands/models/list.list-command.ts:15 `import { canonicalizeModelCatalogProviderAlias } from "./provider-aliases.js";`<br>commands/models/list.rows.ts:21 `import { canonicalizeModelCatalogProviderAlias } from "./provider-aliases.js";` |
| `commands/models/shared.ts` | 9.9 KiB | commands/models/auth-list.ts:17 `import { resolveKnownAgentId } from "./shared.js";`<br>commands/models/auth-order.ts:16 `import { resolveKnownAgentId } from "./shared.js";`<br>commands/models/auth.ts:70 `import { loadValidConfigOrThrow, resolveKnownAgentId, updateConfig } from "./shared.js";` |
| `commands/onboard-channels.ts` | 0.3 KiB | commands/agents.commands.add.ts:42 `import { setupChannels } from "./onboard-channels.js";`<br>commands/channels/add.ts:32 `type OnboardChannelsModule = typeof import("../onboard-channels.js");`<br>commands/channels/add.ts:32 `type OnboardChannelsModule = typeof import("../onboard-channels.js");` |
| `commands/onboard-config.ts` | 1.6 KiB | commands/onboard-non-interactive/local.ts:15 `import { applyLocalSetupWorkspaceConfig, applySkipBootstrapConfig } from "../onboard-config.js";`<br>commands/onboard-non-interactive/remote.ts:12 `import { applySkipBootstrapConfig } from "../onboard-config.js";`<br>wizard/setup.migration-import.ts:249 `import("../commands/onboard-config.js"),` |
| `commands/onboard-custom.ts` | 14.8 KiB | commands/configure.gateway-auth.ts:19 `import { promptCustomApiConfig } from "./onboard-custom.js";`<br>wizard/setup.ts:683 `const { promptCustomApiConfig } = await import("../commands/onboard-custom.js");` |
| `commands/onboard-helpers.ts` | 14.4 KiB | cli/gateway-cli/dev.ts:8 `import { handleReset } from "../../commands/onboard-helpers.js";`<br>commands/agents.commands.add.ts:43 `import { ensureWorkspaceAndSessions } from "./onboard-helpers.js";`<br>commands/agents.commands.delete.ts:29 `import { moveToTrash } from "./onboard-helpers.js";` |
| `commands/onboard-hooks.ts` | 2.8 KiB | wizard/setup.ts:861 `const { setupInternalHooks } = await import("../commands/onboard-hooks.js");` |
| `commands/onboard-remote.ts` | 10.4 KiB | commands/configure.wizard.ts:55 `import { promptRemoteGatewayConfig } from "./onboard-remote.js";`<br>wizard/setup.ts:617 `const { promptRemoteGatewayConfig } = await import("../commands/onboard-remote.js");` |
| `commands/onboard-search.ts` | 0.5 KiB | commands/configure.wizard.ts:318 `const { resolveSearchProviderOptions, setupSearch } = await import("./onboard-search.js");`<br>wizard/setup.finalize.ts:56 `type OnboardSearchModule = typeof import("../commands/onboard-search.js");`<br>wizard/setup.finalize.ts:56 `type OnboardSearchModule = typeof import("../commands/onboard-search.js");` |
| `commands/onboard-skills.ts` | 9.4 KiB | commands/configure.wizard.ts:56 `import { setupSkills } from "./onboard-skills.js";`<br>wizard/setup.ts:838 `const { setupSkills } = await import("../commands/onboard-skills.js");` |
| `commands/onboarding-plugin-install.ts` | 41.9 KiB | commands/runtime-plugin-install.ts:113 `const { ensureOnboardingPluginInstalled } = await import("./onboarding-plugin-install.js");`<br>flows/search-setup.ts:371 `await import("../commands/onboarding-plugin-install.js");`<br>plugins/provider-auth-choice.ts:420 `await import("../commands/onboarding-plugin-install.js");` |
| `commands/random-token.ts` | 0.3 KiB | commands/configure.gateway-auth.ts:20 `import { randomToken } from "./random-token.js";`<br>commands/doctor/shared/hooks-token-reuse-repair.ts:9 `import { randomToken } from "../../random-token.js";`<br>commands/gateway-install-token.ts:20 `import { randomToken } from "./random-token.js";` |
| `commands/session-state-migration.ts` | 3.0 KiB | commands/agent-via-gateway.ts:138 `const { ensureSessionStateMigratedForCommand } = await import("./session-state-migration.js");`<br>commands/agents.commands.delete.ts:30 `import { ensureSessionStateMigratedForCommand } from "./session-state-migration.js";`<br>commands/health.ts:60 `import { ensureSessionStateMigratedForCommand } from "./session-state-migration.js";` |
| `commands/status-all.ts` | 2.2 KiB | commands/status.command.ts:33 `const statusAllModuleLoader = createLazyImportLoader(() => import("./status-all.js"));` |
| `commands/status-all/channel-issues.ts` | 0.6 KiB | commands/status-all/channels-table.ts:4 `import { groupChannelIssuesByChannel } from "./channel-issues.js";`<br>commands/status.command.text-runtime.ts:20 `export { groupChannelIssuesByChannel } from "./status-all/channel-issues.js";` |
| `commands/status-all/channels.ts` | 18.2 KiB | commands/status.scan-overview.ts:10 `import type { buildChannelsTable as buildChannelsTableFn } from "./status-all/channels.js";`<br>commands/status.scan-result.ts:9 `import type { buildChannelsTable as buildChannelsTableFn } from "./status-all/channels.js";`<br>commands/status.scan.runtime.ts:5 `import { buildChannelsTable } from "./status-all/channels.js";` |
| `commands/status-all/diagnosis.ts` | 17.4 KiB | commands/status-all/report-lines.ts:7 `import { appendStatusAllDiagnosis } from "./diagnosis.js";` |
| `commands/status-all/format.ts` | 18.1 KiB | commands/models/list.probe.ts:37 `import { redactSecrets } from "../status-all/format.js";`<br>commands/status-all/channels.ts:34 `import { formatTimeAgo } from "./format.js";`<br>commands/status-all/diagnosis.ts:32 `import { formatTimeAgo, redactSecrets } from "./format.js";` |
| `commands/status-all/gateway.ts` | 6.2 KiB | commands/status-all/diagnosis.ts:33 `import { readFileTailLines, summarizeLogTail } from "./gateway.js";` |
| `commands/status-all/report-data.ts` | 8.7 KiB | commands/status-all.ts:6 `import { buildStatusAllReportData } from "./status-all/report-data.js";` |
| `commands/status-all/report-lines.ts` | 3.4 KiB | commands/status-all.ts:7 `import { buildStatusAllReportLines } from "./status-all/report-lines.js";` |
| `commands/status-all/text-report.ts` | 2.9 KiB | commands/status-all/report-lines.ts:14 `import { appendStatusReportSections, appendStatusSectionHeading } from "./text-report.js";`<br>commands/status-all/report-sections.ts:12 `import type { StatusReportSection } from "./text-report.js";`<br>commands/status-all/report-tables.ts:6 `import type { StatusReportSection } from "./text-report.js";` |
| `commands/status-json-command.ts` | 1.3 KiB | commands/status-json.ts:5 `import { runStatusJsonCommand } from "./status-json-command.ts";`<br>commands/status.command.ts:15 `import { runStatusJsonCommand } from "./status-json-command.ts";` |
| `commands/status-json-payload.ts` | 2.2 KiB | commands/status-json-runtime.ts:6 `import { buildStatusJsonPayload } from "./status-json-payload.ts";` |
| `commands/status-json-runtime.ts` | 2.9 KiB | commands/status-json-command.ts:5 `import { resolveStatusJsonOutput } from "./status-json-runtime.ts";` |
| `commands/status-overview-rows.ts` | 7.9 KiB | commands/status-all/report-data.ts:12 `import { buildStatusAllOverviewRows } from "../status-overview-rows.ts";`<br>commands/status.command-report-data.ts:16 `import { buildStatusCommandOverviewRows } from "./status-overview-rows.ts";`<br>commands/status.test-support.ts:7 `import type { buildStatusCommandOverviewRows } from "./status-overview-rows.ts";` |
| `commands/status-overview-surface.ts` | 7.7 KiB | commands/status-json-runtime.ts:7 `import { buildStatusOverviewSurfaceFromScan } from "./status-overview-surface.ts";`<br>commands/status.command-report-data.ts:17 `import type { StatusOverviewSurface } from "./status-overview-surface.ts";`<br>commands/status.command.ts:16 `import { buildStatusOverviewSurfaceFromScan } from "./status-overview-surface.ts";` |
| `commands/status-runtime-shared.ts` | 9.7 KiB | commands/status-all.ts:8 `import { resolveStatusServiceSummaries } from "./status-runtime-shared.ts";`<br>commands/status-json-runtime.ts:8 `import { resolveStatusRuntimeSnapshot } from "./status-runtime-shared.ts";` |
| `commands/status-update-restart.ts` | 3.4 KiB | commands/status-all/report-data.ts:22 `import { formatUpdateRestartStatusValue } from "../status-update-restart.ts";`<br>commands/status.command.ts:24 `import { formatUpdateRestartStatusValue } from "./status-update-restart.ts";` |
| `commands/status.agent-local.ts` | 3.1 KiB | commands/status-overview-rows.ts:21 `import type { AgentLocalStatus } from "./status.agent-local.js";`<br>commands/status.command-report-data.ts:18 `import type { AgentLocalStatus } from "./status.agent-local.js";`<br>commands/status.command-sections.ts:15 `import type { AgentLocalStatus } from "./status.agent-local.js";` |
| `commands/status.command-report-data.ts` | 9.0 KiB | commands/status.command.ts:25 `import { buildStatusCommandReportData } from "./status.command-report-data.ts";`<br>commands/status.test-support.ts:10 `import type { buildStatusCommandReportData } from "./status.command-report-data.ts";` |
| `commands/status.command-report.ts` | 4.4 KiB | commands/status.command.ts:26 `import { buildStatusCommandReportLines } from "./status.command-report.ts";` |
| `commands/status.command.text-runtime.ts` | 1.6 KiB | commands/status.command.ts:35 `() => import("./status.command.text-runtime.js"),` |
| `commands/status.command.ts` | 9.9 KiB | commands/status.ts:4 `export { statusCommand } from "./status.command.js";`<br>crestodian/operations.ts:917 `const { statusCommand } = await import("../commands/status.command.js");` |
| `commands/status.daemon.ts` | 1.8 KiB | commands/status-runtime-shared.ts:9 `import { getDaemonStatusSummary, getNodeDaemonStatusSummary } from "./status.daemon.js";` |
| `commands/status.format.ts` | 4.8 KiB | commands/status.daemon.ts:6 `import { formatDaemonRuntimeShort } from "./status.format.js";` |
| `commands/status.gateway-connection.ts` | 1.7 KiB | commands/health.ts:61 `import { logGatewayConnectionDetails } from "./status.gateway-connection.js";`<br>commands/status-all/report-data.ts:23 `import { resolveStatusAllConnectionDetails } from "../status.gateway-connection.ts";`<br>commands/status.command.ts:27 `import { logGatewayConnectionDetails } from "./status.gateway-connection.ts";` |
| `commands/status.gateway-probe.ts` | 1.2 KiB | commands/status.scan.shared.ts:27 `const gatewayProbeModuleLoader = createLazyImportLoader(() => import("./status.gateway-probe.js"));` |
| `commands/status.link-channel.ts` | 2.4 KiB | commands/status.summary.ts:36 `const linkChannelModuleLoader = createLazyImportLoader(() => import("./status.link-channel.js"));` |
| `commands/status.node-mode.ts` | 2.4 KiB | commands/status-all/diagnosis.ts:31 `import type { NodeOnlyGatewayInfo } from "../status.node-mode.js";`<br>commands/status-all/report-data.ts:24 `import type { NodeOnlyGatewayInfo } from "../status.node-mode.js";`<br>commands/status-all.ts:9 `import { resolveNodeOnlyGatewayInfo } from "./status.node-mode.js";` |
| `commands/status.scan-execute.ts` | 2.5 KiB | commands/status.scan.fast-json.ts:8 `import { executeStatusScanFromOverview } from "./status.scan-execute.ts";`<br>commands/status.scan.ts:8 `import { executeStatusScanFromOverview } from "./status.scan-execute.ts";` |
| `commands/status.scan-memory.ts` | 1.8 KiB | commands/status.scan.ts:9 `import { resolveStatusMemoryStatusSnapshot } from "./status.scan-memory.ts";` |
| `commands/status.scan-overview.ts` | 12.6 KiB | commands/status-all/report-data.ts:25 `import type { StatusScanOverviewResult } from "../status.scan-overview.ts";`<br>commands/status-all.ts:10 `import { collectStatusScanOverview } from "./status.scan-overview.ts";`<br>commands/status-overview-surface.ts:12 `import type { StatusScanOverviewResult } from "./status.scan-overview.ts";` |
| `commands/status.scan-result.ts` | 4.0 KiB | commands/status-overview-surface.ts:13 `import type { StatusScanResult } from "./status.scan-result.ts";`<br>commands/status.scan-execute.ts:8 `import { buildStatusScanResult, type StatusScanResult } from "./status.scan-result.ts";`<br>commands/status.scan.fast-json.ts:14 `import type { StatusScanResult } from "./status.scan-result.ts";` |
| `commands/status.scan.config-shared.ts` | 2.6 KiB | commands/status.scan-overview.ts:16 `import { loadStatusScanCommandConfig } from "./status.scan.config-shared.js";` |
| `commands/status.scan.deps.runtime.ts` | 1.6 KiB | commands/status.scan-memory.ts:18 `() => import("./status.scan.deps.runtime.js"),`<br>commands/status.scan-overview.ts:22 `() => import("./status.scan.deps.runtime.js"),` |
| `commands/status.scan.fast-json.ts` | 5.2 KiB | commands/status-json.ts:6 `import { scanStatusJsonFast } from "./status.scan.fast-json.js";`<br>commands/status.command.ts:31 `() => import("./status.scan.fast-json.js"),`<br>commands/status.scan.ts:12 `import { scanStatusJsonWithPolicy } from "./status.scan.fast-json.js";` |
| `commands/status.scan.runtime.ts` | 0.4 KiB | commands/status.scan-overview.ts:29 `() => import("./status.scan.runtime.js"),` |
| `commands/status.scan.shared.ts` | 13.1 KiB | commands/status-overview-rows.ts:30 `import type { MemoryPluginStatus, MemoryStatusSnapshot } from "./status.scan.shared.js";`<br>commands/status.command-report-data.ts:32 `import type { MemoryPluginStatus, MemoryStatusSnapshot } from "./status.scan.shared.js";`<br>commands/status.command-sections.ts:16 `import type { MemoryStatusSnapshot, MemoryPluginStatus } from "./status.scan.shared.js";` |
| `commands/status.scan.ts` | 3.8 KiB | commands/status.command.ts:29 `const statusScanModuleLoader = createLazyImportLoader(() => import("./status.scan.js"));` |
| `commands/status.service-summary.ts` | 2.0 KiB | commands/status.daemon.ts:7 `import { readServiceStatusSummary } from "./status.service-summary.js";` |
| `commands/status.summary.runtime.ts` | 7.6 KiB | commands/status.summary.ts:54 `() => import("./status.summary.runtime.js"),` |
| `commands/status.summary.ts` | 14.8 KiB | commands/status.scan-overview.ts:32 `const statusSummaryModuleLoader = createLazyImportLoader(() => import("./status.summary.js"));`<br>commands/status.scan-result.ts:17 `import type { getStatusSummary as getStatusSummaryFn } from "./status.summary.js";`<br>commands/status.ts:5 `export { getStatusSummary } from "./status.summary.js";` |
| `commands/status.types.ts` | 2.2 KiB | commands/doctor-gateway-health.ts:22 `import type { StatusSummary } from "./status.types.js";`<br>commands/doctor-whatsapp-responsiveness.ts:7 `import type { StatusSummary } from "./status.types.js";`<br>commands/status-overview-rows.ts:31 `import type { StatusSummary } from "./status.types.js";` |
| `commands/status.update.ts` | 5.5 KiB | commands/status-all/format.ts:15 `import { formatUpdateOneLiner, resolveUpdateAvailability } from "../status.update.js";`<br>commands/status.command.text-runtime.ts:46 `export { formatUpdateAvailableHint } from "./status.update.js";`<br>commands/status.scan-overview.ts:27 `const statusUpdateModuleLoader = createLazyImportLoader(() => import("./status.update.js"));` |
| `commands/systemd-linger.ts` | 3.8 KiB | commands/configure.daemon.ts:18 `import { ensureSystemdUserLingerInteractive } from "./systemd-linger.js";`<br>commands/onboard-non-interactive/local/daemon-install.ts:16 `import { ensureSystemdUserLingerNonInteractive } from "../../systemd-linger.js";`<br>flows/doctor-health-contributions.ts:706 `const { ensureSystemdUserLingerInteractive } = await import("../commands/systemd-linger.js");` |
| `commands/text-format.ts` | 0.4 KiB | commands/message-format.ts:12 `import { shortenText } from "./text-format.js";`<br>commands/sessions-tail.ts:26 `import { shortenText } from "./text-format.js";`<br>commands/status.format.ts:9 `export { shortenText } from "./text-format.js";` |
| `tui/commands.ts` | 6.9 KiB | tui/tui-command-handlers.ts:20 `import { helpText, parseCommand } from "./commands.js";`<br>tui/tui.ts:30 `import { getSlashCommands } from "./commands.js";` |
| `tui/components/assistant-message.ts` | 0.8 KiB | tui/components/btw-inline-message.ts:4 `import { AssistantMessageComponent } from "./assistant-message.js";`<br>tui/components/chat-log.ts:5 `import { AssistantMessageComponent } from "./assistant-message.js";` |
| `tui/components/btw-inline-message.ts` | 1.1 KiB | tui/components/chat-log.ts:6 `import { BtwInlineMessage } from "./btw-inline-message.js";` |
| `tui/components/chat-log.ts` | 11.5 KiB | tui/tui-command-handlers.ts:21 `import type { ChatLog } from "./components/chat-log.js";`<br>tui/tui-session-actions.ts:13 `import type { ChatLog } from "./components/chat-log.js";`<br>tui/tui.ts:31 `import { ChatLog } from "./components/chat-log.js";` |
| `tui/components/custom-editor.ts` | 3.3 KiB | tui/tui.ts:32 `import { CustomEditor } from "./components/custom-editor.js";` |
| `tui/components/filterable-select-list.ts` | 3.9 KiB | tui/components/selectors.ts:8 `import { FilterableSelectList, type FilterableSelectItem } from "./filterable-select-list.js";` |
| `tui/components/fuzzy-filter.ts` | 3.8 KiB | tui/components/filterable-select-list.ts:12 `import { fuzzyFilterLower, prepareSearchItems } from "./fuzzy-filter.js";`<br>tui/components/searchable-select-list.ts:14 `import { findWordBoundaryIndex, fuzzyFilterLower } from "./fuzzy-filter.js";` |
| `tui/components/hyperlink-markdown.ts` | 1.1 KiB | tui/components/assistant-message.ts:4 `import { HyperlinkMarkdown } from "./hyperlink-markdown.js";`<br>tui/components/markdown-message.ts:4 `import { HyperlinkMarkdown } from "./hyperlink-markdown.js";` |
| `tui/components/markdown-message.ts` | 0.9 KiB | tui/components/user-message.ts:3 `import { MarkdownMessageComponent } from "./markdown-message.js";` |
| `tui/components/searchable-select-list.ts` | 12.3 KiB | tui/components/selectors.ts:9 `import { SearchableSelectList } from "./searchable-select-list.js";`<br>tui/theme/theme.ts:10 `import type { SearchableSelectListTheme } from "../components/searchable-select-list.js";` |
| `tui/components/selectors.ts` | 1.2 KiB | tui/tui-local-shell.ts:4 `import { createSearchableSelectList } from "./components/selectors.js";` |
| `tui/components/tool-execution.ts` | 4.4 KiB | tui/components/chat-log.ts:7 `import { ToolExecutionComponent } from "./tool-execution.js";` |
| `tui/components/user-message.ts` | 0.5 KiB | tui/components/chat-log.ts:8 `import { UserMessageComponent } from "./user-message.js";` |
| `tui/embedded-backend.ts` | 32.3 KiB | tui/tui.ts:723 `const { EmbeddedTuiBackend } = await import("./embedded-backend.js");` |
| `tui/gateway-chat.ts` | 11.4 KiB | tui/tui.ts:726 `const { GatewayChatClient } = await import("./gateway-chat.js");` |
| `tui/local-run-shutdown.ts` | 0.6 KiB | tui/embedded-backend.ts:65 `import { resolveLocalRunShutdownGraceMs } from "./local-run-shutdown.js";`<br>tui/tui.ts:33 `import { resolveLocalRunShutdownGraceMs } from "./local-run-shutdown.js";` |
| `tui/osc8-hyperlinks.ts` | 6.5 KiB | tui/components/hyperlink-markdown.ts:4 `import { addOsc8Hyperlinks, extractUrls } from "../osc8-hyperlinks.js";` |
| `tui/setup-launch-env.ts` | 0.2 KiB | tui/gateway-chat.ts:32 `import { TUI_SETUP_AUTH_SOURCE_CONFIG, TUI_SETUP_AUTH_SOURCE_ENV } from "./setup-launch-env.js";`<br>tui/tui-launch.ts:6 `import { TUI_SETUP_AUTH_SOURCE_CONFIG, TUI_SETUP_AUTH_SOURCE_ENV } from "./setup-launch-env.js";` |
| `tui/theme/theme.ts` | 6.8 KiB | tui/components/assistant-message.ts:3 `import { markdownTheme, theme } from "../theme/theme.js";`<br>tui/components/btw-inline-message.ts:3 `import { theme } from "../theme/theme.js";`<br>tui/components/chat-log.ts:4 `import { theme } from "../theme/theme.js";` |
| `tui/tui-backend.ts` | 4.3 KiB | tui/tui-command-handlers.ts:27 `import type { TuiBackend, TuiSessionMutationResult } from "./tui-backend.js";`<br>tui/tui-last-session.ts:7 `import type { TuiSessionList } from "./tui-backend.js";`<br>tui/tui-session-actions.ts:14 `import type { TuiAgentsList, TuiBackend, TuiSessionMutationResult } from "./tui-backend.js";` |
| `tui/tui-command-handlers.ts` | 26.7 KiB | tui/tui.ts:36 `import { createCommandHandlers } from "./tui-command-handlers.js";` |
| `tui/tui-event-handlers.ts` | 29.0 KiB | tui/tui.ts:37 `import { createEventHandlers } from "./tui-event-handlers.js";` |
| `tui/tui-formatters.ts` | 15.1 KiB | tui/components/tool-execution.ts:5 `import { sanitizeRenderableText } from "../tui-formatters.js";`<br>tui/tui-command-handlers.ts:28 `import { sanitizeRenderableText } from "./tui-formatters.js";`<br>tui/tui-event-handlers.ts:6 `import { asString, extractTextFromMessage, isCommandMessage } from "./tui-formatters.js";` |
| `tui/tui-launch.ts` | 4.2 KiB | wizard/setup.finalize.ts:36 `import { launchTuiCli } from "../tui/tui-launch.js";` |
| `tui/tui-local-shell.ts` | 4.6 KiB | tui/tui.ts:45 `import { createLocalShellRunner } from "./tui-local-shell.js";` |
| `tui/tui-overlays.ts` | 0.7 KiB | tui/tui.ts:46 `import { createOverlayHandlers } from "./tui-overlays.js";` |
| `tui/tui-session-actions.ts` | 22.4 KiB | tui/tui.ts:47 `import { createSessionActions } from "./tui-session-actions.js";` |
| `tui/tui-session-list-policy.ts` | 0.2 KiB | tui/tui-session-actions.ts:16 `import { TUI_SESSION_LOOKUP_LIMIT } from "./tui-session-list-policy.js";`<br>tui/tui.ts:48 `import { TUI_SESSION_LOOKUP_LIMIT } from "./tui-session-list-policy.js";` |
| `tui/tui-status-summary.ts` | 3.5 KiB | tui/tui-command-handlers.ts:33 `import { formatStatusSummary } from "./tui-status-summary.js";` |
| `tui/tui-stream-assembler.ts` | 6.8 KiB | tui/tui-event-handlers.ts:7 `import { TuiStreamAssembler } from "./tui-stream-assembler.js";` |
| `tui/tui-types.ts` | 3.6 KiB | crestodian/operations.ts:7 `import type { TuiResult } from "../tui/tui-types.js";`<br>tui/tui-backend.ts:9 `import type { ResponseUsageMode, SessionInfo, SessionScope } from "./tui-types.js";`<br>tui/tui-event-handlers.ts:8 `import type { AgentEvent, BtwEvent, ChatEvent, TuiStateAccess } from "./tui-types.js";` |
| `tui/tui-waiting.ts` | 1.6 KiB | tui/tui.ts:62 `import { buildWaitingStatusMessage, defaultWaitingPhrases } from "./tui-waiting.js";` |
| `tui/tui.ts` | 45.2 KiB | cli/tui-cli.ts:51 `const { runTui } = await import("../tui/tui.js");`<br>crestodian/operations.ts:994 `const runTui = opts.deps?.runTui ?? (await import("../tui/tui.js")).runTui;`<br>crestodian/tui-backend.ts:17 `import { runTui as defaultRunTui } from "../tui/tui.js";` |
| `wizard/i18n/index.ts` | 4.0 KiB | commands/onboard-custom.ts:14 `import { t } from "../wizard/i18n/index.js";`<br>commands/onboard-hooks.ts:7 `import { t } from "../wizard/i18n/index.js";`<br>commands/onboard-remote.ts:20 `import { t } from "../wizard/i18n/index.js";` |
| `wizard/i18n/locales/en.ts` | 55.6 KiB | wizard/i18n/index.ts:2 `import { en } from "./locales/en.js";` |
| `wizard/i18n/locales/zh-CN.ts` | 55.9 KiB | wizard/i18n/index.ts:3 `import { zh_CN } from "./locales/zh-CN.js";` |
| `wizard/i18n/locales/zh-TW.ts` | 56.2 KiB | wizard/i18n/index.ts:4 `import { zh_TW } from "./locales/zh-TW.js";` |
| `wizard/i18n/types.ts` | 0.4 KiB | wizard/i18n/locales/en.ts:2 `import type { WizardTranslationMap } from "../types.js";`<br>wizard/i18n/locales/zh-CN.ts:2 `import type { WizardTranslationMap } from "../types.js";`<br>wizard/i18n/locales/zh-TW.ts:2 `import type { WizardTranslationMap } from "../types.js";` |
| `wizard/setup.completion.ts` | 4.0 KiB | wizard/setup.finalize.ts:41 `import { setupWizardShellCompletion } from "./setup.completion.js";` |
| `wizard/setup.finalize.ts` | 25.9 KiB | wizard/setup.ts:870 `const { finalizeSetupWizard } = await import("./setup.finalize.js");` |
| `wizard/setup.gateway-config.ts` | 13.6 KiB | wizard/setup.ts:779 `const { configureGatewayForSetup } = await import("./setup.gateway-config.js");` |
| `wizard/setup.migration-import.ts` | 12.0 KiB | commands/onboard-non-interactive.ts:37 `await import("../wizard/setup.migration-import.js");`<br>wizard/setup.ts:30 `import { detectSetupMigrationSources, runSetupMigrationImport } from "./setup.migration-import.js";` |
| `wizard/setup.official-plugins.ts` | 4.5 KiB | wizard/setup.ts:844 `const { setupOfficialPluginInstalls } = await import("./setup.official-plugins.js");` |
| `wizard/setup.plugin-config.ts` | 13.4 KiB | commands/configure.wizard.ts:60 `type SetupPluginConfigModule = typeof import("../wizard/setup.plugin-config.js");`<br>commands/configure.wizard.ts:60 `type SetupPluginConfigModule = typeof import("../wizard/setup.plugin-config.js");`<br>wizard/setup.ts:851 `const { setupPluginConfig } = await import("./setup.plugin-config.js");` |
| `wizard/setup.post-install-migration.ts` | 8.3 KiB | commands/onboard-non-interactive/local/auth-choice.plugin-providers.ts:204 `await import("../../../wizard/setup.post-install-migration.js");`<br>plugins/provider-auth-choice.ts:184 `await import("../wizard/setup.post-install-migration.js");` |
| `wizard/setup.secret-input.ts` | 1.5 KiB | commands/configure.wizard.ts:24 `import { resolveSetupSecretInputString } from "../wizard/setup.secret-input.js";`<br>wizard/setup.finalize.ts:42 `import { resolveSetupSecretInputString } from "./setup.secret-input.js";`<br>wizard/setup.gateway-config.ts:29 `import { resolveSetupSecretInputString } from "./setup.secret-input.js";` |
| `wizard/setup.types.ts` | 0.9 KiB | wizard/setup.completion.ts:18 `import type { WizardFlow } from "./setup.types.js";`<br>wizard/setup.finalize.ts:43 `import type { GatewayWizardSettings, WizardFlow } from "./setup.types.js";`<br>wizard/setup.ts:37 `import type { QuickstartGatewayDefaults, WizardFlow } from "./setup.types.js";` |

### 2.2 🟡 CLI-only

| file | size | non-gateway evidence sample |
|---|---:|---|
| `cli/acp-cli.ts` | 3.9 KiB | cli/program/register.subclis-core.ts:96 `loadModule: () => import("../acp-cli.js"),` |
| `cli/argv-invocation.ts` | 0.8 KiB | cli/channels-cli.ts:8 `import { resolveCliArgvInvocation } from "./argv-invocation.js";`<br>cli/command-execution-startup.ts:4 `import { resolveCliArgvInvocation } from "./argv-invocation.js";`<br>cli/command-registration-policy.ts:3 `import { resolveCliArgvInvocation } from "./argv-invocation.js";` |
| `cli/banner-config-lite.ts` | 0.8 KiB | cli/banner.ts:13 `import { parseTaglineMode, readCliBannerTaglineMode } from "./banner-config-lite.js";` |
| `cli/banner.ts` | 7.0 KiB | cli/command-execution-startup.ts:55 `const { emitCliBanner } = await import("./banner.js");`<br>cli/program/help.ts:8 `import { formatCliBannerLine, hasEmittedCliBanner } from "../banner.js";`<br>cli/run-main.ts:181 `import("./banner.js"),` |
| `cli/capability-cli.ts` | 94.9 KiB | cli/program/register.subclis-core.ts:126 `loadModule: () => import("../capability-cli.js"),` |
| `cli/channel-auth.ts` | 9.8 KiB | cli/channels-cli.ts:9 `import { runChannelLogin, runChannelLogout } from "./channel-auth.js";` |
| `cli/channel-options.ts` | 1.5 KiB | cli/channels-cli.ts:10 `import { formatCliChannelOptions } from "./channel-options.js";`<br>cli/program/context.ts:3 `import { resolveCliChannelOptions } from "../channel-options.js";` |
| `cli/channels-cli.ts` | 11.7 KiB | cli/program/register.subclis-core.ts:245 `const mod = await import("../channels-cli.js");` |
| `cli/clawbot-cli.ts` | 0.6 KiB | cli/program/register.subclis-core.ts:210 `loadModule: () => import("../clawbot-cli.js"),` |
| `cli/cli-utils.ts` | 1.7 KiB | cli/capability-cli.ts:105 `import { runCommandWithRuntime } from "./cli-utils.js";`<br>cli/channels-cli.ts:11 `import { runCommandWithRuntime } from "./cli-utils.js";`<br>cli/docs-cli.ts:7 `import { runCommandWithRuntime } from "./cli-utils.js";` |
| `cli/command-bootstrap.ts` | 1.6 KiB | cli/command-execution-startup.ts:5 `import { ensureCliCommandBootstrap } from "./command-bootstrap.js";` |
| `cli/command-catalog.ts` | 11.9 KiB | cli/command-bootstrap.ts:4 `import type { CliPluginRegistryPolicy } from "./command-catalog.js";`<br>cli/command-startup-policy.ts:3 `import type { CliCommandPluginLoadPolicy } from "./command-catalog.js";`<br>cli/plugin-registry-loader.ts:5 `import type { CliPluginRegistryScope } from "./command-catalog.js";` |
| `cli/command-options.ts` | 1.5 KiB | cli/acp-cli.ts:10 `import { inheritOptionFromParent } from "./command-options.js";`<br>cli/channels-cli.ts:12 `import { hasExplicitOptions } from "./command-options.js";`<br>cli/daemon-cli/register-service-commands.ts:4 `import { inheritOptionFromParent } from "../command-options.js";` |
| `cli/command-path-matches.ts` | 1.7 KiB | cli/command-path-policy.ts:9 `import { matchesCommandPath } from "./command-path-matches.js";`<br>cli/program/route-specs.ts:4 `import { matchesCommandPath } from "../command-path-matches.js";` |
| `cli/command-path-policy.ts` | 2.5 KiB | cli/command-bootstrap.ts:5 `import { resolveCliCommandPathPolicy } from "./command-path-policy.js";`<br>cli/command-startup-policy.ts:4 `import { resolveCliCommandPathPolicy } from "./command-path-policy.js";`<br>cli/program/register.subclis-core.ts:5 `import { resolveCliCommandPathPolicy } from "../command-path-policy.js";` |
| `cli/command-registration-policy.ts` | 1.8 KiB | cli/program/command-registry-core.ts:4 `import { shouldRegisterPrimaryCommandOnly } from "../command-registration-policy.js";`<br>cli/run-main-policy.ts:21 `import { isReservedNonPluginCommandRoot } from "./command-registration-policy.js";`<br>plugin-sdk/cli-runtime.ts:17 `export { shouldEagerRegisterSubcommands } from "../cli/command-registration-policy.js";` |
| `cli/command-startup-policy.ts` | 3.0 KiB | cli/command-execution-startup.ts:6 `import { resolveCliStartupPolicy } from "./command-startup-policy.js";`<br>cli/program/preaction.ts:14 `import { shouldBypassConfigGuardForCommandPath } from "../command-startup-policy.js";`<br>cli/run-main.ts:182 `import("./command-startup-policy.js"),` |
| `cli/completion-cli.ts` | 16.2 KiB | cli/program/register.subclis.ts:41 `loadModule: () => import("../completion-cli.js"),` |
| `cli/completion-runtime.ts` | 10.6 KiB | cli/update-cli/shared.ts:28 `import { COMPLETION_SKIP_PLUGIN_COMMANDS_ENV } from "../completion-runtime.js";`<br>cli/update-cli/update-command.ts:112 `import { installCompletion } from "../completion-runtime.js";` |
| `cli/config-cli.ts` | 86.9 KiB | cli/program/command-registry-core.ts:77 `loadModule: () => import("../config-cli.js"),`<br>cli/program/routed-command-definitions.ts:25 `type ConfigCliModule = typeof import("../config-cli.js");`<br>cli/program/routed-command-definitions.ts:25 `type ConfigCliModule = typeof import("../config-cli.js");` |
| `cli/config-recovery-hints.ts` | 0.8 KiB | cli/config-cli.ts:70 `import { formatPluginPackagingRuntimeOutputRecoveryHint } from "./config-recovery-hints.js";`<br>cli/program/config-guard.ts:246 `import("../config-recovery-hints.js"),`<br>commands/config-validation.ts:3 `import { formatPluginPackagingRuntimeOutputRecoveryHint } from "../cli/config-recovery-hints.js";` |
| `cli/config-set-input.ts` | 4.4 KiB | crestodian/operations.ts:3 `import type { ConfigSetOptions } from "../cli/config-set-input.js";` |
| `cli/config-set-parser.ts` | 1.4 KiB | cli/config-cli.ts:84 `import { resolveConfigSetMode } from "./config-set-parser.js";` |
| `cli/container-target.ts` | 9.4 KiB | cli/run-main.ts:22 `import { maybeRunCliInContainer, parseCliContainerArgs } from "./container-target.js";`<br>entry.ts:7 `import { parseCliContainerArgs, resolveCliContainerTarget } from "./cli/container-target.js";`<br>entry.version-fast-path.ts:3 `import { resolveCliContainerTarget } from "./cli/container-target.js";` |
| `cli/cron-cli.ts` | 0.2 KiB | cli/program/register.subclis-core.ts:170 `loadModule: () => import("../cron-cli.js"),` |
| `cli/cron-cli/register.cron-edit.ts` | 23.5 KiB | cli/cron-cli/register.ts:11 `import { registerCronEditCommand } from "./register.cron-edit.js";` |
| `cli/cron-cli/register.cron-simple.ts` | 9.6 KiB | cli/cron-cli/register.ts:12 `import { registerCronSimpleCommands } from "./register.cron-simple.js";` |
| `cli/cron-cli/register.ts` | 1.2 KiB | cli/cron-cli.ts:3 `export { registerCronCli } from "./cron-cli/register.js";` |
| `cli/cron-cli/schedule-options.ts` | 5.8 KiB | cli/cron-cli/register.cron-add.ts:14 `import { resolveCronCreateScheduleFromArgs } from "./schedule-options.js";` |
| `cli/cron-cli/shared.ts` | 15.2 KiB | cli/cron-cli/schedule-options.ts:4 `import { parseAt, parseCronStaggerMs, parseDurationMs } from "./shared.js";` |
| `cli/cron-cli/thread-id-shared.ts` | 1.2 KiB | cli/cron-cli/register.cron-add.ts:27 `import { normalizeCronSessionTargetOption, parseCronThreadIdOption } from "./thread-id-shared.js";`<br>cli/cron-cli/register.cron-edit.ts:25 `import { normalizeCronSessionTargetOption, parseCronThreadIdOption } from "./thread-id-shared.js";` |
| `cli/daemon-cli.ts` | 0.5 KiB | cli/program/register.subclis-core.ts:106 `loadModule: () => import("../daemon-cli.js"),`<br>cli/update-cli/update-command.ts:113 `import { runDaemonInstall, runDaemonRestart } from "../daemon-cli.js";` |
| `cli/daemon-cli/gateway-token-drift.ts` | 1.7 KiB | cli/daemon-cli/lifecycle-core.ts:28 `import { resolveGatewayTokenForDriftCheck } from "./gateway-token-drift.js";` |
| `cli/daemon-cli/install.runtime.ts` | 0.1 KiB | cli/daemon-cli/register-service-commands.ts:7 `const daemonInstallModuleLoader = createLazyImportLoader(() => import("./install.runtime.js"));`<br>commands/gateway-readiness.ts:12 `() => import("../cli/daemon-cli/install.runtime.js"),` |
| `cli/daemon-cli/install.ts` | 12.6 KiB | cli/daemon-cli/install.runtime.ts:2 `export { runDaemonInstall } from "./install.js";`<br>cli/daemon-cli/runners.ts:2 `export { runDaemonInstall } from "./install.js";`<br>cli/daemon-cli/start-repair.ts:16 `import { mergeInstallInvocationEnv } from "./install.js";` |
| `cli/daemon-cli/launchd-recovery.ts` | 1.4 KiB | cli/daemon-cli/lifecycle.ts:24 `import { recoverInstalledLaunchAgent } from "./launchd-recovery.js";`<br>cli/update-cli/update-command.ts:114 `import { recoverInstalledLaunchAgent } from "../daemon-cli/launchd-recovery.js";` |
| `cli/daemon-cli/lifecycle.runtime.ts` | 0.2 KiB | cli/daemon-cli/register-service-commands.ts:8 `const daemonLifecycleModuleLoader = createLazyImportLoader(() => import("./lifecycle.runtime.js"));` |
| `cli/daemon-cli/lifecycle.ts` | 16.2 KiB | commands/gateway-readiness.ts:15 `() => import("../cli/daemon-cli/lifecycle.js"),`<br>crestodian/operations.ts:434 `const lifecycle = await import("../cli/daemon-cli/lifecycle.js");` |
| `cli/daemon-cli/register-service-commands.ts` | 5.6 KiB | cli/daemon-cli/register.ts:5 `import { addGatewayServiceCommands } from "./register-service-commands.js";`<br>cli/daemon-cli.ts:3 `export { addGatewayServiceCommands } from "./daemon-cli/register-service-commands.js";`<br>cli/gateway-cli/register.ts:20 `import { addGatewayServiceCommands } from "../daemon-cli/register-service-commands.js";` |
| `cli/daemon-cli/register.ts` | 0.8 KiB | cli/daemon-cli.ts:2 `export { registerDaemonCli } from "./daemon-cli/register.js";` |
| `cli/daemon-cli/response.ts` | 5.6 KiB | cli/daemon-cli/install.ts:29 `import { buildDaemonServiceSnapshot, installDaemonServiceAndEmit } from "./response.js";`<br>cli/daemon-cli/lifecycle.ts:31 `import { createNullWriter } from "./response.js";`<br>cli/daemon-cli/shared.ts:18 `import { createDaemonActionContext } from "./response.js";` |
| `cli/daemon-cli/restart-health.ts` | 21.5 KiB | cli/daemon-cli/status.gather.ts:124 `const restartHealthModuleLoader = createLazyImportLoader(() => import("./restart-health.js"));` |
| `cli/daemon-cli/shared.ts` | 7.5 KiB | cli/daemon-cli/lifecycle-core.ts:34 `import { filterContainerGenericHints } from "./shared.js";`<br>cli/daemon-cli/lifecycle.ts:42 `import { parsePortFromArgs, renderGatewayServiceStartHints } from "./shared.js";`<br>cli/daemon-cli/status.gather.ts:56 `import { normalizeListenerAddress, parsePortFromArgs, pickProbeHostForBind } from "./shared.js";` |
| `cli/daemon-cli/start-repair.ts` | 3.4 KiB | cli/daemon-cli/lifecycle.ts:43 `import { repairLoadedGatewayServiceForStart } from "./start-repair.js";` |
| `cli/daemon-cli/status.gather.ts` | 24.7 KiB | cli/daemon-cli/status.ts:4 `import { gatherDaemonStatus } from "./status.gather.js";`<br>cli/gateway-cli/register.ts:48 `() => import("../daemon-cli/status.gather.js"),`<br>commands/gateway-health-auth-diagnostic.ts:2 `import type { DaemonStatus } from "../cli/daemon-cli/status.gather.js";` |
| `cli/daemon-cli/status.print.ts` | 18.5 KiB | cli/daemon-cli/status.ts:5 `import { printDaemonStatus } from "./status.print.js";` |
| `cli/daemon-cli/status.runtime.ts` | 0.1 KiB | cli/daemon-cli/register-service-commands.ts:9 `const daemonStatusModuleLoader = createLazyImportLoader(() => import("./status.runtime.js"));` |
| `cli/daemon-cli/status.ts` | 1.3 KiB | cli/daemon-cli/runners.ts:9 `export { runDaemonStatus } from "./status.js";`<br>cli/daemon-cli/status.runtime.ts:2 `export { runDaemonStatus } from "./status.js";`<br>cli/program/routed-command-definitions.ts:114 `const { runDaemonStatus } = await import("../daemon-cli/status.js");` |
| `cli/daemon-cli/types.ts` | 1.0 KiB | cli/daemon-cli/install.ts:35 `import type { DaemonInstallOptions } from "./types.js";`<br>cli/daemon-cli/lifecycle.ts:44 `import type { DaemonLifecycleOptions } from "./types.js";`<br>cli/daemon-cli/register-service-commands.ts:5 `import type { DaemonInstallOptions, DaemonLifecycleOptions, GatewayRpcOpts } from "./types.js";` |
| `cli/devices-cli.runtime.ts` | 32.5 KiB | cli/devices-cli.ts:21 `type DevicesRuntimeModule = typeof import("./devices-cli.runtime.js");`<br>cli/devices-cli.ts:21 `type DevicesRuntimeModule = typeof import("./devices-cli.runtime.js");` |
| `cli/devices-cli.ts` | 4.3 KiB | cli/program/register.subclis-core.ts:150 `loadModule: () => import("../devices-cli.js"),` |
| `cli/directory-cli.ts` | 10.7 KiB | cli/program/register.subclis-core.ts:254 `loadModule: () => import("../directory-cli.js"),` |
| `cli/dns-cli.ts` | 9.2 KiB | cli/program/register.subclis-core.ts:175 `loadModule: () => import("../dns-cli.js"),` |
| `cli/docs-cli.ts` | 0.9 KiB | cli/program/register.subclis-core.ts:180 `loadModule: () => import("../docs-cli.js"),` |
| `cli/dotenv.ts` | 0.9 KiB | cli/gateway-dispatch-dotenv.ts:12 `const { loadCliDotEnv } = await import("./dotenv.js");`<br>cli/run-main.ts:513 `const { loadCliDotEnv } = await import("./dotenv.js");` |
| `cli/exec-approvals-cli.ts` | 21.5 KiB | cli/program/register.subclis-core.ts:131 `loadModule: () => import("../exec-approvals-cli.js"),` |
| `cli/exec-policy-cli.ts` | 14.3 KiB | cli/program/register.subclis-core.ts:136 `loadModule: () => import("../exec-policy-cli.js"),` |
| `cli/failure-output.ts` | 1.7 KiB | cli/run-main.ts:794 `import("./failure-output.js"),`<br>entry.ts:299 `const { formatCliFailureLines } = await import("./cli/failure-output.js");`<br>index.ts:6 `import { formatCliFailureLines } from "./cli/failure-output.js";` |
| `cli/gateway-cli.ts` | 0.2 KiB | cli/program/register.subclis-core.ts:101 `loadModule: () => import("../gateway-cli.js"),` |
| `cli/gateway-cli/call.ts` | 1.8 KiB | cli/gateway-cli/register.ts:22 `import type { GatewayRpcOpts } from "./call.js";`<br>cli/gateway-cli/register.ts:22 `import type { GatewayRpcOpts } from "./call.js";` |
| `cli/gateway-cli/dev.ts` | 4.7 KiB | cli/gateway-cli/run.ts:526 `const { ensureDevGatewayConfig } = await import("./dev.js");` |
| `cli/gateway-cli/discover.ts` | 3.0 KiB | cli/gateway-cli/register.ts:23 `import type { GatewayDiscoverOpts } from "./discover.js";`<br>cli/gateway-cli/register.ts:23 `import type { GatewayDiscoverOpts } from "./discover.js";` |
| `cli/gateway-cli/lifecycle.runtime.ts` | 1.6 KiB | cli/gateway-cli/run-loop.ts:40 `type GatewayLifecycleRuntimeModule = typeof import("./lifecycle.runtime.js");`<br>cli/gateway-cli/run-loop.ts:40 `type GatewayLifecycleRuntimeModule = typeof import("./lifecycle.runtime.js");` |
| `cli/gateway-cli/qa-parent-watchdog.ts` | 5.4 KiB | cli/gateway-cli/run.ts:48 `import { installQaParentWatchdog } from "./qa-parent-watchdog.js";` |
| `cli/gateway-cli/register.ts` | 28.1 KiB | cli/gateway-cli.ts:3 `export { registerGatewayCli } from "./gateway-cli/register.js";` |
| `cli/gateway-cli/run-command.ts` | 2.5 KiB | cli/gateway-cli/register.ts:24 `import { addGatewayRunCommand } from "./run-command.js";`<br>cli/program/register.subclis-core.ts:58 `const { addGatewayRunCommand } = await import("../gateway-cli/run-command.js");`<br>cli/run-main.ts:179 `import("./gateway-cli/run-command.js"),` |
| `cli/gateway-cli/run-loop.ts` | 33.7 KiB | cli/gateway-cli/run.ts:49 `import { runGatewayLoop } from "./run-loop.js";` |
| `cli/gateway-cli/run.ts` | 29.3 KiB | cli/gateway-cli/run-command.ts:58 `const { resolveGatewayRunOptions, runGatewayCommand } = await import("./run.js");` |
| `cli/gateway-cli/shared.ts` | 1.8 KiB | cli/gateway-cli/run.ts:869 `const { maybeExplainGatewayServiceStop } = await import("./shared.js");` |
| `cli/gateway-dispatch-dotenv.ts` | 0.9 KiB | cli/run-main.ts:510 `const { loadGatewayDispatchCliDotEnv } = await import("./gateway-dispatch-dotenv.js");` |
| `cli/gateway-rpc.runtime.ts` | 1.7 KiB | cli/gateway-rpc.ts:13 `type GatewayRpcRuntimeModule = typeof import("./gateway-rpc.runtime.js");`<br>cli/gateway-rpc.ts:13 `type GatewayRpcRuntimeModule = typeof import("./gateway-rpc.runtime.js");` |
| `cli/gateway-rpc.ts` | 1.7 KiB | cli/cron-cli/register.cron-add.ts:11 `import type { GatewayRpcOpts } from "../gateway-rpc.js";`<br>cli/cron-cli/register.cron-add.ts:11 `import type { GatewayRpcOpts } from "../gateway-rpc.js";`<br>cli/cron-cli/register.cron-edit.ts:12 `import { addGatewayClientOptions, callGatewayFromCli } from "../gateway-rpc.js";` |
| `cli/gateway-rpc.types.ts` | 0.3 KiB | cli/gateway-rpc.runtime.ts:7 `import type { GatewayRpcOpts } from "./gateway-rpc.types.js";`<br>cli/gateway-rpc.ts:10 `import type { GatewayRpcOpts } from "./gateway-rpc.types.js";`<br>cli/gateway-rpc.ts:10 `import type { GatewayRpcOpts } from "./gateway-rpc.types.js";` |
| `cli/gateway-run-argv.ts` | 2.7 KiB | cli/command-path-policy.ts:10 `import { resolveGatewayCatalogCommandPath } from "./gateway-run-argv.js";` |
| `cli/gateway-secret-options.ts` | 1.8 KiB | cli/acp-cli.ts:11 `import { resolveGatewayAuthOptions } from "./gateway-secret-options.js";`<br>cli/mcp-cli.ts:37 `import { resolveGatewayAuthOptions } from "./gateway-secret-options.js";` |
| `cli/help-format.ts` | 1.0 KiB | cli/channels-cli.ts:13 `import { formatHelpExamples } from "./help-format.js";`<br>cli/directory-cli.ts:19 `import { formatHelpExamples } from "./help-format.js";`<br>cli/gateway-cli/register.ts:21 `import { formatHelpExamples } from "../help-format.js";` |
| `cli/hooks-cli.ts` | 19.2 KiB | cli/program/register.subclis-core.ts:195 `loadModule: () => import("../hooks-cli.js"),` |
| `cli/install-spec.ts` | 0.4 KiB | cli/plugins-install-command.ts:40 `import { looksLikeLocalInstallSpec } from "./install-spec.js";` |
| `cli/json-output-mode.ts` | 1.1 KiB | cli/nodes-cli/register.ts:6 `import { withConsoleLogsRoutedToStderrForJson } from "../json-output-mode.js";`<br>cli/run-main.ts:27 `import { hasJsonOutputFlag, withConsoleLogsRoutedToStderrForJson } from "./json-output-mode.js";` |
| `cli/log-level-option.ts` | 0.5 KiB | cli/program/help.ts:10 `import { CLI_LOG_LEVEL_VALUES, parseCliLogLevelOption } from "../log-level-option.js";` |
| `cli/logs-cli.runtime.ts` | 2.7 KiB | cli/logs-cli.ts:46 `type LogsCliRuntimeModule = typeof import("./logs-cli.runtime.js");`<br>cli/logs-cli.ts:46 `type LogsCliRuntimeModule = typeof import("./logs-cli.runtime.js");` |
| `cli/logs-cli.ts` | 21.8 KiB | cli/program/register.subclis-core.ts:111 `loadModule: () => import("../logs-cli.js"),` |
| `cli/mcp-cli.ts` | 46.1 KiB | cli/program/command-registry-core.ts:108 `loadModule: () => import("../mcp-cli.js"),` |
| `cli/models-cli.runtime.ts` | 1.2 KiB | cli/models-cli.ts:6 `type ModelsCliRuntime = typeof import("./models-cli.runtime.js");`<br>cli/models-cli.ts:6 `type ModelsCliRuntime = typeof import("./models-cli.runtime.js");` |
| `cli/models-cli.ts` | 20.2 KiB | cli/program/register.subclis-core.ts:121 `loadModule: () => import("../models-cli.js"),` |
| `cli/native-hook-relay-cli.ts` | 10.7 KiB | cli/hooks-cli.ts:26 `import { runNativeHookRelayCli, type NativeHookRelayCliOptions } from "./native-hook-relay-cli.js";` |
| `cli/node-cli.ts` | 0.2 KiB | cli/program/register.subclis-core.ts:155 `loadModule: () => import("../node-cli.js"),` |
| `cli/node-cli/register.ts` | 5.3 KiB | cli/node-cli.ts:3 `export { registerNodeCli } from "./node-cli/register.js";` |
| `cli/nodes-camera.ts` | 8.8 KiB | cli/nodes-screen.ts:3 `import { writeBase64ToFile } from "./nodes-camera.js";` |
| `cli/nodes-cli.ts` | 0.1 KiB | cli/program/register.subclis-core.ts:143 `const mod = await import("../nodes-cli.js");` |
| `cli/nodes-cli/cli-utils.ts` | 1.2 KiB | cli/nodes-cli/register.camera.ts:19 `import { getNodesTheme, runNodesCommand } from "./cli-utils.js";`<br>cli/nodes-cli/register.invoke.ts:9 `import { getNodesTheme, runNodesCommand } from "./cli-utils.js";`<br>cli/nodes-cli/register.location.ts:6 `import { runNodesCommand } from "./cli-utils.js";` |
| `cli/nodes-cli/format.ts` | 0.9 KiB | cli/nodes-cli/register.pairing.ts:10 `import { parsePairingList } from "./format.js";`<br>cli/nodes-cli/register.status.ts:16 `import { formatPermissions, parseNodeList, parsePairingList } from "./format.js";`<br>cli/nodes-cli/rpc.ts:13 `import { parseNodeList, parsePairingList } from "./format.js";` |
| `cli/nodes-cli/pairing-render.ts` | 1.5 KiB | cli/nodes-cli/register.pairing.ts:11 `import { renderPendingPairingRequestsTable } from "./pairing-render.js";`<br>cli/nodes-cli/register.status.ts:17 `import { renderPendingPairingRequestsTable } from "./pairing-render.js";` |
| `cli/nodes-cli/register.camera.ts` | 9.9 KiB | cli/nodes-cli/register.ts:7 `import { registerNodesCameraCommands } from "./register.camera.js";` |
| `cli/nodes-cli/register.invoke.ts` | 2.7 KiB | cli/nodes-cli/register.ts:8 `import { registerNodesInvokeCommands } from "./register.invoke.js";` |
| `cli/nodes-cli/register.location.ts` | 3.7 KiB | cli/nodes-cli/register.ts:9 `import { registerNodesLocationCommands } from "./register.location.js";` |
| `cli/nodes-cli/register.notify.ts` | 2.6 KiB | cli/nodes-cli/register.ts:10 `import { registerNodesNotifyCommand } from "./register.notify.js";` |
| `cli/nodes-cli/register.pairing.ts` | 6.8 KiB | cli/nodes-cli/register.ts:11 `import { registerNodesPairingCommands } from "./register.pairing.js";` |
| `cli/nodes-cli/register.push.ts` | 3.3 KiB | cli/nodes-cli/register.ts:12 `import { registerNodesPushCommand } from "./register.push.js";` |
| `cli/nodes-cli/register.screen.ts` | 3.5 KiB | cli/nodes-cli/register.ts:13 `import { registerNodesScreenCommands } from "./register.screen.js";` |
| `cli/nodes-cli/register.status.ts` | 18.8 KiB | cli/nodes-cli/register.ts:14 `import { registerNodesStatusCommands } from "./register.status.js";` |
| `cli/nodes-cli/register.ts` | 2.6 KiB | cli/nodes-cli.ts:2 `export { registerNodesCli } from "./nodes-cli/register.js";` |
| `cli/nodes-cli/rpc.runtime.ts` | 2.5 KiB | cli/nodes-cli/rpc.ts:16 `type NodesCliRpcRuntimeModule = typeof import("./rpc.runtime.js");`<br>cli/nodes-cli/rpc.ts:16 `type NodesCliRpcRuntimeModule = typeof import("./rpc.runtime.js");` |
| `cli/nodes-cli/rpc.ts` | 6.2 KiB | cli/exec-approvals-cli.ts:25 `import { nodesCallOpts, resolveNodeId } from "./nodes-cli/rpc.js";`<br>cli/nodes-cli/cli-utils.ts:5 `import { unauthorizedHintForMessage } from "./rpc.js";`<br>cli/nodes-cli/register.push.ts:9 `import { callGatewayCli, nodesCallOpts, resolveNodeId } from "./rpc.js";` |
| `cli/nodes-cli/types.ts` | 1.2 KiB | cli/exec-approvals-cli.ts:26 `import type { NodesRpcOpts } from "./nodes-cli/types.js";`<br>cli/nodes-cli/pairing-render.ts:5 `import type { PendingRequest } from "./types.js";`<br>cli/nodes-cli/register.camera.ts:30 `import type { NodesRpcOpts } from "./types.js";` |
| `cli/nodes-media-utils.ts` | 1.2 KiB | cli/nodes-screen.ts:4 `import { asRecord, asString, resolveTempPathParts } from "./nodes-media-utils.js";` |
| `cli/pairing-cli.ts` | 8.6 KiB | cli/program/register.subclis-core.ts:221 `const mod = await import("../pairing-cli.js");` |
| `cli/plugin-registry-loader.ts` | 1.5 KiB | cli/command-bootstrap.ts:6 `import { ensureCliPluginRegistryLoaded } from "./plugin-registry-loader.js";` |
| `cli/plugin-registry.ts` | 0.2 KiB | cli/plugin-registry-loader.ts:7 `const pluginRegistryModuleLoader = createLazyImportLoader(() => import("./plugin-registry.js"));`<br>cli/program/message/helpers.ts:20 `import { ensurePluginRegistryLoaded, type PluginRegistryScope } from "../../plugin-registry.js";` |
| `cli/plugins-authoring-command.ts` | 15.1 KiB | cli/plugins-cli.ts:63 `() => import("./plugins-authoring-command.js"),` |
| `cli/plugins-cli.runtime.ts` | 18.0 KiB | cli/plugins-cli.ts:61 `const loadPluginsRuntime = createModuleLoader(() => import("./plugins-cli.runtime.js"));` |
| `cli/plugins-cli.ts` | 9.1 KiB | cli/plugins-cli.runtime.ts:20 `import type { PluginMarketplaceListOptions, PluginRegistryOptions } from "./plugins-cli.js";`<br>cli/program/register.subclis-core.ts:235 `const mod = await import("../plugins-cli.js");` |
| `cli/plugins-command-helpers.ts` | 7.4 KiB | cli/plugin-install-config-policy.ts:16 `import { parseNpmPrefixSpec, resolveFileNpmSpecToLocalPath } from "./plugins-command-helpers.js";`<br>cli/plugins-cli.runtime.ts:37 `const loadPluginsCommandHelpers = createModuleLoader(() => import("./plugins-command-helpers.js"));`<br>cli/plugins-inspect-command.ts:13 `import { quietPluginJsonLogger } from "./plugins-command-helpers.js";` |
| `cli/plugins-config.ts` | 0.2 KiB | cli/plugins-cli.runtime.ts:234 `const { setPluginEnabledInConfig } = await import("./plugins-config.js");` |
| `cli/plugins-inspect-command.ts` | 13.3 KiB | cli/plugins-cli.ts:5 `import type { PluginInspectOptions } from "./plugins-inspect-command.js";`<br>cli/plugins-cli.ts:5 `import type { PluginInspectOptions } from "./plugins-inspect-command.js";` |
| `cli/plugins-install-command.ts` | 32.7 KiB | cli/hooks-cli.ts:27 `import { runPluginInstallCommand } from "./plugins-install-command.js";`<br>cli/plugins-cli.runtime.ts:269 `const { runPluginInstallCommand } = await import("./plugins-install-command.js");`<br>crestodian/operations.ts:794 `const { runPluginInstallCommand } = await import("../cli/plugins-install-command.js");` |
| `cli/plugins-list-command.ts` | 5.0 KiB | cli/plugins-cli.ts:6 `import type { PluginsListOptions } from "./plugins-list-command.js";`<br>cli/plugins-cli.ts:6 `import type { PluginsListOptions } from "./plugins-list-command.js";`<br>cli/program/routed-command-definitions.ts:191 `const { runPluginsListCommand } = await import("../plugins-list-command.js");` |
| `cli/plugins-list-format.ts` | 2.5 KiB | cli/plugins-list-command.ts:26 `import("./plugins-list-format.js"),` |
| `cli/plugins-location-bridges.ts` | 3.3 KiB | cli/update-cli/update-command.ts:122 `import { listPersistedBundledPluginLocationBridges } from "../plugins-location-bridges.js";` |
| `cli/plugins-search-command.ts` | 3.6 KiB | cli/plugins-cli.ts:94 `const { runPluginsSearchCommand } = await import("./plugins-search-command.js");`<br>crestodian/operations.ts:604 `const { runPluginsSearchCommand } = await import("../cli/plugins-search-command.js");` |
| `cli/plugins-uninstall-command.ts` | 7.2 KiB | cli/plugins-cli.ts:138 `const { runPluginUninstallCommand } = await import("./plugins-uninstall-command.js");`<br>crestodian/operations.ts:825 `const { runPluginUninstallCommand } = await import("../cli/plugins-uninstall-command.js");` |
| `cli/plugins-uninstall-selection.ts` | 1.6 KiB | cli/plugins-uninstall-command.ts:58 `const { resolvePluginUninstallId } = await import("./plugins-uninstall-selection.js");` |
| `cli/plugins-update-command.ts` | 5.9 KiB | cli/hooks-cli.ts:28 `import { runPluginUpdateCommand } from "./plugins-update-command.js";`<br>cli/plugins-cli.ts:191 `const { runPluginUpdateCommand } = await import("./plugins-update-command.js");` |
| `cli/plugins-update-outcomes.ts` | 1.2 KiB | cli/plugins-update-command.ts:19 `import { logPluginUpdateOutcomes } from "./plugins-update-outcomes.js";` |
| `cli/ports.ts` | 12.3 KiB | cli/gateway-cli/run.ts:597 `const { forceFreePortAndWait, waitForPortBindable } = await import("../ports.js");`<br>cli/program.ts:3 `export { forceFreePort } from "./ports.js";` |
| `cli/profile.ts` | 3.9 KiB | cli/run-main.ts:28 `import { applyCliProfileEnv, parseCliProfileArgs } from "./profile.js";`<br>entry.ts:8 `import { applyCliProfileEnv, parseCliProfileArgs } from "./cli/profile.js";` |
| `cli/program.ts` | 0.3 KiB | cli/run-main.ts:792 `import("./program.js"),` |
| `cli/program/action-reparse.ts` | 1.2 KiB | cli/program/register-lazy-command.ts:3 `import { reparseProgramFromActionArgs } from "./action-reparse.js";` |
| `cli/program/build-program.ts` | 1.1 KiB | cli/program.ts:5 `export { buildProgram } from "./program/build-program.js";` |
| `cli/program/command-registry-core.ts` | 5.4 KiB | cli/completion-cli.ts:21 `import { getCoreCliCommandNames, registerCoreCliByName } from "./program/command-registry-core.js";` |
| `cli/program/command-registry.ts` | 1.0 KiB | cli/program/build-program.ts:4 `import { registerProgramCommands } from "./command-registry.js";`<br>cli/run-main.ts:840 `const { registerCoreCliByName } = await import("./program/command-registry.js");` |
| `cli/program/command-tree.ts` | 0.8 KiB | cli/capability-cli.ts:115 `import { removeCommandByName } from "./program/command-tree.js";`<br>cli/program/register-command-groups.ts:4 `import { removeCommandByName } from "./command-tree.js";`<br>cli/program/register-lazy-command.ts:4 `import { removeCommandByName } from "./command-tree.js";` |
| `cli/program/config-guard.ts` | 9.9 KiB | cli/command-bootstrap.ts:8 `const configGuardModuleLoader = createLazyImportLoader(() => import("./program/config-guard.js"));` |
| `cli/program/context.ts` | 1.1 KiB | cli/program/build-program.ts:5 `import { createProgramContext } from "./context.js";`<br>cli/program/command-registry-core.ts:11 `import type { ProgramContext } from "./context.js";`<br>cli/program/command-registry.ts:11 `import type { ProgramContext } from "./context.js";` |
| `cli/program/error-output.ts` | 3.2 KiB | cli/program/help.ts:13 `import { formatCliParseErrorOutput } from "./error-output.js";` |
| `cli/program/help.ts` | 6.0 KiB | cli/program/build-program.ts:6 `import { configureProgramHelp } from "./help.js";`<br>cli/program/root-help.ts:12 `import { configureProgramHelp } from "./help.js";`<br>cli/setup-onboard-configure-help-fast-path.ts:6 `import { configureProgramHelp } from "./program/help.js";` |
| `cli/program/helpers.ts` | 3.1 KiB | cli/capability-cli.ts:116 `import { collectOption } from "./program/helpers.js";`<br>cli/cron-cli/register.cron-add.ts:13 `import { parsePositiveIntOrUndefined } from "../program/helpers.js";`<br>cli/plugins-cli.ts:7 `import { parseStrictPositiveIntOption } from "./program/helpers.js";` |
| `cli/program/json-mode.ts` | 1.9 KiB | cli/config-cli.ts:86 `import { setCommandJsonMode } from "./program/json-mode.js";`<br>cli/program/preaction.ts:19 `import { isCommandJsonOutputMode } from "./json-mode.js";` |
| `cli/program/message/helpers.ts` | 7.4 KiB | cli/program/message/register.broadcast.ts:4 `import type { MessageCliHelpers } from "./helpers.js";`<br>cli/program/message/register.discord-admin.ts:3 `import type { MessageCliHelpers } from "./helpers.js";`<br>cli/program/message/register.emoji-sticker.ts:4 `import type { MessageCliHelpers } from "./helpers.js";` |
| `cli/program/message/register.broadcast.ts` | 0.9 KiB | cli/program/register.message.ts:8 `import { registerMessageBroadcastCommand } from "./message/register.broadcast.js";` |
| `cli/program/message/register.discord-admin.ts` | 5.0 KiB | cli/program/register.message.ts:9 `import { registerMessageDiscordAdminCommands } from "./message/register.discord-admin.js";` |
| `cli/program/message/register.pins.ts` | 1.4 KiB | cli/program/register.message.ts:18 `import { registerMessagePinCommands } from "./message/register.pins.js";` |
| `cli/program/message/register.poll.ts` | 1.4 KiB | cli/program/register.message.ts:19 `import { registerMessagePollCommand } from "./message/register.poll.js";` |
| `cli/program/message/register.reactions.ts` | 1.4 KiB | cli/program/register.message.ts:20 `import { registerMessageReactionsCommands } from "./message/register.reactions.js";` |
| `cli/program/message/register.read-edit-delete.ts` | 1.7 KiB | cli/program/register.message.ts:21 `import { registerMessageReadEditDeleteCommands } from "./message/register.read-edit-delete.js";` |
| `cli/program/message/register.send.ts` | 1.7 KiB | cli/program/register.message.ts:22 `import { registerMessageSendCommand } from "./message/register.send.js";` |
| `cli/program/message/register.thread.ts` | 2.7 KiB | cli/program/register.message.ts:23 `import { registerMessageThreadCommands } from "./message/register.thread.js";` |
| `cli/program/parent-default-help.ts` | 1.6 KiB | cli/channels-cli.ts:14 `import { applyParentDefaultHelpAction } from "./program/parent-default-help.js";`<br>cli/cron-cli/register.ts:5 `import { applyParentDefaultHelpAction } from "../program/parent-default-help.js";`<br>cli/devices-cli.ts:3 `import { applyParentDefaultHelpAction } from "./program/parent-default-help.js";` |
| `cli/program/preaction.ts` | 4.7 KiB | cli/program/build-program.ts:7 `import { registerPreActionHooks } from "./preaction.js";` |
| `cli/program/program-context.ts` | 0.8 KiB | cli/completion-cli.ts:22 `import { getProgramContext } from "./program/program-context.js";`<br>cli/program/build-program.ts:8 `import { setProgramContext } from "./program-context.js";`<br>cli/run-main.ts:837 `const { getProgramContext } = await import("./program/program-context.js");` |
| `cli/program/register-lazy-command.ts` | 1.7 KiB | cli/program/register-command-groups.ts:5 `import { registerLazyCommand } from "./register-lazy-command.js";` |
| `cli/program/register.agent-turn.ts` | 4.7 KiB | cli/program/command-registry-core.ts:120 `() => import("./register.agent-turn.js"),`<br>cli/program/register.agent.ts:8 `import { registerAgentTurnCommand } from "./register.agent-turn.js";` |
| `cli/program/register.agent.ts` | 10.7 KiB | cli/program/command-registry-core.ts:129 `() => import("./register.agent.js"),` |
| `cli/program/register.backup.ts` | 3.7 KiB | cli/program/command-registry-core.ts:82 `loadModule: () => import("./register.backup.js"),` |
| `cli/program/register.configure.ts` | 1.4 KiB | cli/program/command-registry-core.ts:72 `loadModule: () => import("./register.configure.js"),`<br>cli/setup-onboard-configure-help-fast-path.ts:65 `const { registerConfigureCommand } = await import("./program/register.configure.js");` |
| `cli/program/register.crestodian.ts` | 1.6 KiB | cli/program/command-registry-core.ts:57 `loadModule: () => import("./register.crestodian.js"),` |
| `cli/program/register.maintenance.ts` | 7.5 KiB | cli/program/command-registry-core.ts:92 `loadModule: () => import("./register.maintenance.js"),` |
| `cli/program/register.message.ts` | 3.1 KiB | cli/program/command-registry-core.ts:99 `() => import("./register.message.js"),` |
| `cli/program/register.migrate.ts` | 8.2 KiB | cli/program/command-registry-core.ts:87 `loadModule: () => import("./register.migrate.js"),` |
| `cli/program/register.onboard.ts` | 11.6 KiB | cli/program/command-registry-core.ts:67 `loadModule: () => import("./register.onboard.js"),`<br>cli/setup-onboard-configure-help-fast-path.ts:61 `const { registerOnboardCommand } = await import("./program/register.onboard.js");` |
| `cli/program/register.setup.ts` | 3.6 KiB | cli/program/command-registry-core.ts:62 `loadModule: () => import("./register.setup.js"),`<br>cli/setup-onboard-configure-help-fast-path.ts:56 `const { registerSetupCommand } = await import("./program/register.setup.js");` |
| `cli/program/register.status-health-sessions.ts` | 24.7 KiB | cli/program/command-registry-core.ts:138 `loadModule: () => import("./register.status-health-sessions.js"),` |
| `cli/program/register.subclis-core.ts` | 9.6 KiB | cli/completion-cli.ts:23 `import { getSubCliEntries, registerSubCliByName } from "./program/register.subclis-core.js";` |
| `cli/program/register.subclis.ts` | 2.7 KiB | cli/program/command-registry.ts:12 `import { registerSubCliCommands } from "./register.subclis.js";`<br>cli/run-main.ts:843 `const { registerSubCliByName } = await import("./program/register.subclis.js");` |
| `cli/program/register.transcripts.ts` | 9.9 KiB | cli/program/command-registry-core.ts:113 `loadModule: () => import("./register.transcripts.js"),` |
| `cli/program/root-help.ts` | 2.7 KiB | cli/root-help-live-config.ts:3 `import type { RootHelpRenderOptions } from "./program/root-help.js";`<br>cli/run-main.ts:598 `const { outputRootHelp } = await import("./program/root-help.js");`<br>entry.ts:9 `import type { RootHelpRenderOptions } from "./cli/program/root-help.js";` |
| `cli/program/route-specs.ts` | 2.2 KiB | cli/program/routes.ts:2 `import { routedCommands, type RouteSpec } from "./route-specs.js";`<br>cli/program/routes.ts:2 `import { routedCommands, type RouteSpec } from "./route-specs.js";` |
| `cli/program/routes.ts` | 0.6 KiB | cli/route.ts:11 `import { findRoutedCommand } from "./program/routes.js";` |
| `cli/proxy-cli.runtime.ts` | 10.6 KiB | cli/proxy-cli.ts:7 `type ProxyCliRuntime = typeof import("./proxy-cli.runtime.js");`<br>cli/proxy-cli.ts:7 `type ProxyCliRuntime = typeof import("./proxy-cli.runtime.js");` |
| `cli/proxy-cli.ts` | 6.0 KiB | cli/program/register.subclis-core.ts:190 `loadModule: () => import("../proxy-cli.js"),` |
| `cli/qr-cli.ts` | 9.0 KiB | cli/clawbot-cli.ts:5 `import { registerQrCli } from "./qr-cli.js";`<br>cli/program/register.subclis-core.ts:205 `loadModule: () => import("../qr-cli.js"),` |
| `cli/root-help-live-config.ts` | 1.8 KiB | cli/run-main.ts:72 `const loadRootHelpLiveConfigModule = async () => await import("./root-help-live-config.js");`<br>entry.ts:31 `const loadRootHelpLiveConfigModule = async () => await import("./cli/root-help-live-config.js");` |
| `cli/root-help-metadata.ts` | 5.0 KiB | cli/run-main.ts:73 `const loadRootHelpMetadataModule = async () => await import("./root-help-metadata.js");`<br>entry.ts:32 `const loadRootHelpMetadataModule = async () => await import("./cli/root-help-metadata.js");` |
| `cli/root-option-forward.ts` | 0.7 KiB | cli/root-option-scan.ts:3 `import { forwardConsumedCliRootOption } from "./root-option-forward.js";` |
| `cli/root-option-scan.ts` | 1.7 KiB | cli/container-target.ts:7 `import { scanCliRootOptions } from "./root-option-scan.js";`<br>cli/profile.ts:12 `import { scanCliRootOptions } from "./root-option-scan.js";` |
| `cli/root-option-value.ts` | 0.8 KiB | cli/container-target.ts:8 `import { takeCliRootOptionValue } from "./root-option-value.js";`<br>cli/profile.ts:13 `import { takeCliRootOptionValue } from "./root-option-value.js";` |
| `cli/route.ts` | 2.3 KiB | cli/run-main.ts:751 `const { tryRouteCli } = await startupTrace.measure("route-import", () => import("./route.js"));` |
| `cli/run-main.ts` | 31.0 KiB | entry.ts:295 `() => import("./cli/run-main.js"),`<br>index.ts:46 `const { runCli } = await import("./cli/run-main.js");` |
| `cli/sandbox-cli.ts` | 6.5 KiB | cli/program/register.subclis-core.ts:160 `loadModule: () => import("../sandbox-cli.js"),` |
| `cli/secrets-cli.ts` | 12.8 KiB | cli/program/register.subclis-core.ts:264 `loadModule: () => import("../secrets-cli.js"),` |
| `cli/security-cli.ts` | 9.6 KiB | cli/program/register.subclis-core.ts:259 `loadModule: () => import("../security-cli.js"),` |
| `cli/setup-onboard-configure-help-fast-path.ts` | 2.9 KiB | cli/run-main.ts:612 `await import("./setup-onboard-configure-help-fast-path.js");` |
| `cli/shared/parse-port.ts` | 0.4 KiB | cli/daemon-cli/shared.ts:17 `import { parsePort } from "../shared/parse-port.js";`<br>cli/gateway-cli/run.ts:47 `import { parsePort } from "../shared/parse-port.js";`<br>cli/program/register.onboard.ts:19 `import { parsePort } from "../shared/parse-port.js";` |
| `cli/skills-cli.format.ts` | 17.2 KiB | cli/skills-cli.ts:49 `import { formatSkillInfo, formatSkillsCheck, formatSkillsList } from "./skills-cli.format.js";`<br>cli/skills-cli.ts:49 `import { formatSkillInfo, formatSkillsCheck, formatSkillsList } from "./skills-cli.format.js";` |
| `cli/skills-cli.ts` | 28.8 KiB | cli/program/register.subclis-core.ts:269 `loadModule: () => import("../skills-cli.js"),` |
| `cli/startup-metadata.ts` | 1.5 KiB | cli/channel-options.ts:3 `import { readCliStartupMetadata } from "./startup-metadata.js";`<br>cli/root-help-metadata.ts:2 `import { readCliStartupMetadata } from "./startup-metadata.js";` |
| `cli/system-cli.ts` | 4.7 KiB | cli/program/register.subclis-core.ts:116 `loadModule: () => import("../system-cli.js"),` |
| `cli/tagline.ts` | 11.9 KiB | cli/banner-config-lite.ts:3 `import type { TaglineMode } from "./tagline.js";`<br>cli/banner.ts:14 `import { pickTagline, type TaglineMode, type TaglineOptions } from "./tagline.js";` |
| `cli/tui-cli.ts` | 3.3 KiB | cli/program/register.subclis-core.ts:165 `loadModule: () => import("../tui-cli.js"),` |
| `cli/update-cli.ts` | 7.7 KiB | cli/program/register.subclis-core.ts:274 `loadModule: () => import("../update-cli.js"),` |
| `cli/update-cli/progress.ts` | 8.3 KiB | cli/update-cli/update-command.ts:128 `import { createUpdateProgress, printResult } from "./progress.js";` |
| `cli/update-cli/restart-helper.ts` | 14.6 KiB | cli/update-cli/update-command.ts:129 `import { prepareRestartScript, runRestartScript } from "./restart-helper.js";` |
| `cli/update-cli/shared.ts` | 10.4 KiB | cli/update-cli/progress.ts:12 `import type { UpdateCommandOptions } from "./shared.js";`<br>cli/update-cli/status.ts:18 `import { parseTimeoutMsOrExit, resolveUpdateRoot, type UpdateStatusOptions } from "./shared.js";` |
| `cli/update-cli/status.ts` | 3.9 KiB | cli/update-cli.ts:14 `import { updateStatusCommand } from "./update-cli/status.js";` |
| `cli/update-cli/suppress-deprecations.ts` | 0.5 KiB | cli/update-cli/update-command.ts:148 `import { suppressDeprecations } from "./suppress-deprecations.js";` |
| `cli/update-cli/update-command.ts` | 124.9 KiB | cli/update-cli/wizard.ts:24 `import { updateCommand } from "./update-command.js";`<br>cli/update-cli.ts:15 `import { updateCommand, updateFinalizeCommand } from "./update-cli/update-command.js";` |
| `cli/update-cli/wizard.ts` | 4.5 KiB | cli/update-cli.ts:16 `import { updateWizardCommand } from "./update-cli/wizard.js";` |
| `cli/wait.ts` | 0.7 KiB | library.ts:6 `import { waitForever } from "./cli/wait.js";`<br>plugin-sdk/cli-runtime.ts:18 `export * from "../cli/wait.js";` |
| `cli/webhooks-cli.ts` | 7.4 KiB | cli/program/register.subclis-core.ts:200 `loadModule: () => import("../webhooks-cli.js"),` |
| `cli/windows-argv.ts` | 2.5 KiB | cli/channels-cli.ts:15 `import { normalizeWindowsArgv } from "./windows-argv.js";`<br>cli/run-main.ts:45 `import { normalizeWindowsArgv } from "./windows-argv.js";`<br>entry.respawn.ts:9 `import { normalizeWindowsArgv } from "./cli/windows-argv.js";` |
| `commands/agent-via-gateway.ts` | 30.1 KiB | cli/program/register.agent-turn.ts:8 `type AgentViaGatewayModule = typeof import("../../commands/agent-via-gateway.js");`<br>cli/program/register.agent-turn.ts:8 `type AgentViaGatewayModule = typeof import("../../commands/agent-via-gateway.js");` |
| `commands/agent/session.ts` | 0.2 KiB | commands/agent-via-gateway.ts:102 `type AgentSessionModule = typeof import("./agent/session.js");`<br>commands/agent-via-gateway.ts:102 `type AgentSessionModule = typeof import("./agent/session.js");` |
| `commands/agents.binding-format.ts` | 0.6 KiB | commands/agents.bindings.ts:17 `export { describeBinding } from "./agents.binding-format.js";`<br>commands/agents.commands.bind.ts:13 `import { describeBinding } from "./agents.binding-format.js";` |
| `commands/agents.bindings.ts` | 10.8 KiB | commands/agents.commands.bind.ts:16 `type AgentBindingsModule = typeof import("./agents.bindings.js");`<br>commands/agents.commands.bind.ts:16 `type AgentBindingsModule = typeof import("./agents.bindings.js");`<br>commands/agents.commands.list.ts:9 `import { describeBinding } from "./agents.bindings.js";` |
| `commands/agents.command-shared.ts` | 1.0 KiB | commands/agents.commands.add.ts:38 `import { createQuietRuntime, requireValidConfigFileSnapshot } from "./agents.command-shared.js";`<br>commands/agents.commands.bind.ts:14 `import { requireValidConfig, requireValidConfigFileSnapshot } from "./agents.command-shared.js";`<br>commands/agents.commands.delete.ts:27 `import { createQuietRuntime, requireValidConfigFileSnapshot } from "./agents.command-shared.js";` |
| `commands/agents.commands.add.ts` | 17.1 KiB | cli/program/register.agent.ts:10 `type AgentsAddModule = typeof import("../../commands/agents.commands.add.js");`<br>cli/program/register.agent.ts:10 `type AgentsAddModule = typeof import("../../commands/agents.commands.add.js");`<br>crestodian/operations.ts:857 `(await import("../commands/agents.commands.add.js")).agentsAddCommand;` |
| `commands/agents.commands.bind.ts` | 12.3 KiB | cli/program/register.agent.ts:11 `type AgentsBindModule = typeof import("../../commands/agents.commands.bind.js");`<br>cli/program/register.agent.ts:11 `type AgentsBindModule = typeof import("../../commands/agents.commands.bind.js");`<br>commands/agents.bind.test-support.ts:51 `() => import("./agents.commands.bind.js"),` |
| `commands/agents.commands.delete.ts` | 6.9 KiB | cli/program/register.agent.ts:12 `type AgentsDeleteModule = typeof import("../../commands/agents.commands.delete.js");`<br>cli/program/register.agent.ts:12 `type AgentsDeleteModule = typeof import("../../commands/agents.commands.delete.js");` |
| `commands/agents.commands.identity.ts` | 7.2 KiB | cli/program/register.agent.ts:13 `type AgentsIdentityModule = typeof import("../../commands/agents.commands.identity.js");`<br>cli/program/register.agent.ts:13 `type AgentsIdentityModule = typeof import("../../commands/agents.commands.identity.js");` |
| `commands/agents.commands.list.ts` | 5.1 KiB | cli/program/register.agent.ts:14 `type AgentsListModule = typeof import("../../commands/agents.commands.list.js");`<br>cli/program/register.agent.ts:14 `type AgentsListModule = typeof import("../../commands/agents.commands.list.js");`<br>cli/program/routed-command-definitions.ts:24 `type AgentsListCommandModule = typeof import("../../commands/agents.commands.list.js");` |
| `commands/auth-token.ts` | 0.2 KiB | commands/models/auth.ts:66 `import { validateAnthropicSetupToken } from "../auth-token.js";` |
| `commands/backup-shared.ts` | 9.8 KiB | commands/backup.test-support.ts:6 `import * as backupShared from "./backup-shared.js";`<br>commands/backup.test-support.ts:6 `import * as backupShared from "./backup-shared.js";` |
| `commands/channel-setup/channel-plugin-resolution.ts` | 6.9 KiB | cli/channel-auth.ts:10 `import { resolveInstallableChannelPlugin } from "../commands/channel-setup/channel-plugin-resolution.js";`<br>cli/directory-cli.ts:12 `import { resolveInstallableChannelPlugin } from "../commands/channel-setup/channel-plugin-resolution.js";`<br>commands/channels/capabilities.ts:32 `import { resolveInstallableChannelPlugin } from "../channel-setup/channel-plugin-resolution.js";` |
| `commands/channel-setup/discovery.ts` | 6.4 KiB | commands/channels/add.ts:342 `const { isCatalogChannelInstalled } = await import("../channel-setup/discovery.js");`<br>commands/channels/list.ts:19 `import { isCatalogChannelInstalled } from "../channel-setup/discovery.js";`<br>flows/channel-setup.status.ts:12 `import { resolveChannelSetupEntries } from "../commands/channel-setup/discovery.js";` |
| `commands/channel-setup/plugin-install.ts` | 6.1 KiB | commands/channels/add.ts:31 `type ChannelSetupPluginInstallModule = typeof import("../channel-setup/plugin-install.js");`<br>commands/channels/add.ts:31 `type ChannelSetupPluginInstallModule = typeof import("../channel-setup/plugin-install.js");` |
| `commands/channel-setup/registry.ts` | 2.6 KiB | flows/channel-setup.status.ts:14 `import { resolveChannelSetupWizardAdapterForPlugin } from "../commands/channel-setup/registry.js";`<br>flows/channel-setup.ts:19 `import { resolveChannelSetupWizardAdapterForPlugin } from "../commands/channel-setup/registry.js";` |
| `commands/channel-setup/trusted-catalog.ts` | 3.3 KiB | commands/channel-setup/plugin-install.ts:21 `import { getTrustedChannelPluginCatalogEntry } from "./trusted-catalog.js";`<br>commands/channels/add.ts:63 `? await import("../channel-setup/trusted-catalog.js").then(`<br>commands/channels/list.ts:20 `import { listTrustedChannelPluginCatalogEntries } from "../channel-setup/trusted-catalog.js";` |
| `commands/channel-setup/types.ts` | 0.1 KiB | commands/channel-setup/registry.ts:7 `import type { ChannelSetupWizardAdapter } from "./types.js";` |
| `commands/channel-test-registry.ts` | 1.7 KiB | plugin-sdk/plugin-test-runtime.ts:3 `export { setDefaultChannelPluginRegistryForTests } from "../commands/channel-test-registry.js";`<br>plugin-sdk/testing.ts:32 `export { setDefaultChannelPluginRegistryForTests } from "../commands/channel-test-registry.js";` |
| `commands/channels.ts` | 1.0 KiB | cli/channels-cli.ts:17 `type ChannelsCommandsModule = typeof import("../commands/channels.js");`<br>cli/channels-cli.ts:17 `type ChannelsCommandsModule = typeof import("../commands/channels.js");` |
| `commands/channels/add-mutators.ts` | 1.6 KiB | commands/channels/add.ts:27 `import { applyAccountName, applyChannelAccountConfig } from "./add-mutators.js";` |
| `commands/channels/add.ts` | 16.9 KiB | commands/channels.ts:2 `export type { ChannelsAddOptions } from "./channels/add.js";`<br>commands/channels.ts:2 `export type { ChannelsAddOptions } from "./channels/add.js";` |
| `commands/channels/capabilities.ts` | 11.5 KiB | commands/channels.ts:4 `export type { ChannelsCapabilitiesOptions } from "./channels/capabilities.js";`<br>commands/channels.ts:4 `export type { ChannelsCapabilitiesOptions } from "./channels/capabilities.js";` |
| `commands/channels/list.ts` | 11.9 KiB | cli/channels-cli.ts:127 `const { channelsListCommand } = await import("../commands/channels/list.js");`<br>cli/program/routed-command-definitions.ts:177 `const { channelsListCommand } = await import("../../commands/channels/list.js");`<br>commands/channels.ts:6 `export type { ChannelsListOptions } from "./channels/list.js";` |
| `commands/channels/logs.ts` | 4.4 KiB | commands/channels.ts:8 `export type { ChannelsLogsOptions } from "./channels/logs.js";`<br>commands/channels.ts:8 `export type { ChannelsLogsOptions } from "./channels/logs.js";` |
| `commands/channels/remove.ts` | 9.6 KiB | commands/channels.ts:10 `export type { ChannelsRemoveOptions } from "./channels/remove.js";`<br>commands/channels.ts:10 `export type { ChannelsRemoveOptions } from "./channels/remove.js";` |
| `commands/channels/resolve.ts` | 8.4 KiB | commands/channels.ts:12 `export type { ChannelsResolveOptions } from "./channels/resolve.js";`<br>commands/channels.ts:12 `export type { ChannelsResolveOptions } from "./channels/resolve.js";` |
| `commands/channels/runtime-label.ts` | 0.6 KiB | commands/channels/add.ts:28 `import { channelLabel } from "./runtime-label.js";`<br>commands/channels/remove.ts:21 `import { channelLabel } from "./runtime-label.js";` |
| `commands/channels/shared.ts` | 5.3 KiB | commands/channels/add.ts:29 `import { requireValidConfigFileSnapshot, shouldUseWizard } from "./shared.js";`<br>commands/channels/capabilities.ts:33 `import { formatChannelAccountLabel, requireValidConfig } from "./shared.js";`<br>commands/channels/list.ts:21 `import { formatChannelAccountLabel, requireValidConfig } from "./shared.js";` |
| `commands/channels/status-config-format.ts` | 4.9 KiB | commands/channels/status.ts:27 `import { formatConfigChannelsStatusLines } from "./status-config-format.js";` |
| `commands/channels/status.ts` | 11.2 KiB | cli/channels-cli.ts:141 `const { channelsStatusCommand } = await import("../commands/channels/status.js");`<br>cli/program/routed-command-definitions.ts:184 `const { channelsStatusCommand } = await import("../../commands/channels/status.js");`<br>commands/channels.ts:14 `export type { ChannelsStatusOptions } from "./channels/status.js";` |
| `commands/chutes-oauth.ts` | 7.3 KiB | plugin-sdk/provider-auth-login.runtime.ts:2 `export { loginChutes } from "../commands/chutes-oauth.js";` |
| `commands/cleanup-plan.ts` | 0.9 KiB | commands/reset.ts:19 `import { resolveCleanupPlanFromDisk } from "./cleanup-plan.js";`<br>commands/uninstall.ts:17 `import { resolveCleanupPlanFromDisk } from "./cleanup-plan.js";` |
| `commands/commitments.ts` | 5.0 KiB | cli/program/register.status-health-sessions.ts:30 `const loadCommitmentsCommands = createModuleLoader(() => import("../../commands/commitments.js"));` |
| `commands/configure.channels.ts` | 4.6 KiB | commands/configure.wizard.ts:25 `import { removeChannelConfigWizard } from "./configure.channels.js";` |
| `commands/configure.commands.ts` | 1.5 KiB | cli/program/register.configure.ts:28 `await import("../../commands/configure.commands.js");`<br>commands/configure.ts:2 `export { configureCommandFromSectionsArg } from "./configure.commands.js";` |
| `commands/configure.daemon.ts` | 5.7 KiB | commands/configure.wizard.ts:26 `import { maybeInstallDaemon } from "./configure.daemon.js";` |
| `commands/configure.gateway-auth.ts` | 10.8 KiB | commands/configure.gateway.ts:23 `import { buildGatewayAuthConfig } from "./configure.gateway-auth.js";`<br>commands/configure.ts:3 `export { buildGatewayAuthConfig } from "./configure.gateway-auth.js";`<br>commands/configure.wizard.ts:27 `import { promptAuthConfig } from "./configure.gateway-auth.js";` |
| `commands/configure.gateway.ts` | 10.9 KiB | commands/configure.wizard.ts:28 `import { promptGatewayConfig } from "./configure.gateway.js";` |
| `commands/configure.shared.ts` | 3.4 KiB | cli/program/register.configure.ts:5 `import { CONFIGURE_WIZARD_SECTIONS } from "../../commands/configure.shared.js";`<br>commands/configure.channels.ts:11 `import { confirm, select } from "./configure.shared.js";`<br>commands/configure.commands.ts:5 `import type { WizardSection } from "./configure.shared.js";` |
| `commands/configure.ts` | 0.3 KiB | cli/config-cli.ts:2533 `const { configureCommandFromSectionsArg } = await import("../commands/configure.js");` |
| `commands/configure.wizard.ts` | 27.6 KiB | commands/configure.commands.ts:7 `import { runConfigureWizard } from "./configure.wizard.js";` |
| `commands/daemon-install-auth-profiles-source.runtime.ts` | 0.2 KiB | commands/daemon-install-helpers.ts:64 `| Promise<typeof import("./daemon-install-auth-profiles-source.runtime.js")>`<br>commands/daemon-install-helpers.ts:64 `| Promise<typeof import("./daemon-install-auth-profiles-source.runtime.js")>` |
| `commands/daemon-install-auth-profiles-store.runtime.ts` | 0.2 KiB | commands/daemon-install-helpers.ts:67 `| Promise<typeof import("./daemon-install-auth-profiles-store.runtime.js")>`<br>commands/daemon-install-helpers.ts:67 `| Promise<typeof import("./daemon-install-auth-profiles-store.runtime.js")>` |
| `commands/daemon-install-helpers.ts` | 24.5 KiB | cli/daemon-cli/install.ts:4 `import { buildGatewayInstallPlan } from "../../commands/daemon-install-helpers.js";`<br>cli/daemon-cli/start-repair.ts:2 `import { buildGatewayInstallPlan } from "../../commands/daemon-install-helpers.js";`<br>commands/configure.daemon.ts:10 `import { buildGatewayInstallPlan, gatewayInstallErrorHint } from "./daemon-install-helpers.js";` |
| `commands/daemon-install-plan.shared.ts` | 4.8 KiB | commands/daemon-install-helpers.ts:54 `export { resolveGatewayDevMode } from "./daemon-install-plan.shared.js";` |
| `commands/daemon-install-runtime-warning.ts` | 0.8 KiB | commands/daemon-install-helpers.ts:51 `import type { DaemonInstallWarnFn } from "./daemon-install-runtime-warning.js";`<br>commands/node-daemon-install-helpers.ts:11 `import type { DaemonInstallWarnFn } from "./daemon-install-runtime-warning.js";` |
| `commands/dashboard.ts` | 4.5 KiB | cli/program/register.maintenance.ts:113 `const { dashboardCommand } = await import("../../commands/dashboard.js");` |
| `commands/docs.ts` | 4.2 KiB | cli/docs-cli.ts:5 `import { docsSearchCommand } from "../commands/docs.js";` |
| `commands/doctor-auth-flat-profiles.ts` | 45.5 KiB | flows/doctor-health-contributions.ts:167 `await import("../commands/doctor-auth-flat-profiles.js");` |
| `commands/doctor-auth-legacy-oauth.ts` | 2.6 KiB | flows/doctor-health-contributions.ts:169 `await import("../commands/doctor-auth-legacy-oauth.js");` |
| `commands/doctor-auth-oauth-sidecar.ts` | 11.2 KiB | commands/doctor/repair-sequencing.ts:10 `import { maybeRepairLegacyOAuthSidecarProfiles } from "../doctor-auth-oauth-sidecar.js";`<br>flows/doctor-health-contributions.ts:171 `await import("../commands/doctor-auth-oauth-sidecar.js");` |
| `commands/doctor-auth-profile-config.ts` | 7.6 KiB | commands/doctor/shared/config-flow-steps.ts:3 `import { protectActiveAuthProfileConfig } from "../../doctor-auth-profile-config.js";` |
| `commands/doctor-auth.ts` | 13.4 KiB | flows/doctor-health-contributions.ts:173 `await import("../commands/doctor-auth.js");` |
| `commands/doctor-bootstrap-size.ts` | 4.0 KiB | flows/doctor-health-contributions.ts:797 `const { noteBootstrapFileSize } = await import("../commands/doctor-bootstrap-size.js");` |
| `commands/doctor-browser.ts` | 4.2 KiB | flows/doctor-health-contributions.ts:566 `const { noteChromeMcpBrowserReadiness } = await import("../commands/doctor-browser.js");` |
| `commands/doctor-claude-cli.ts` | 10.7 KiB | flows/doctor-core-checks.ts:542 `const { noteClaudeCliHealth } = await import("../commands/doctor-claude-cli.js");`<br>flows/doctor-health-contributions.ts:354 `const { noteClaudeCliHealth } = await import("../commands/doctor-claude-cli.js");` |
| `commands/doctor-command-owner.ts` | 2.3 KiB | flows/doctor-core-checks.ts:10 `import { hasConfiguredCommandOwners } from "../commands/doctor-command-owner.js";`<br>flows/doctor-health-contributions.ts:314 `const { noteCommandOwnerHealth } = await import("../commands/doctor-command-owner.js");` |
| `commands/doctor-config-analysis.ts` | 8.3 KiB | commands/doctor/shared/config-flow-steps.ts:4 `import { stripUnknownConfigKeys } from "../../doctor-config-analysis.js";`<br>commands/doctor/shared/legacy-tools-by-sender.ts:5 `import { formatConfigPath, resolveConfigPathTarget } from "../../doctor-config-analysis.js";`<br>commands/doctor-config-preflight.ts:15 `import { noteIncludeConfinementWarning } from "./doctor-config-analysis.js";` |
| `commands/doctor-config-audit-scrub.ts` | 2.4 KiB | flows/doctor-health-contributions.ts:503 `const { maybeScrubConfigAuditLog } = await import("../commands/doctor-config-audit-scrub.js");` |
| `commands/doctor-config-flow.ts` | 13.7 KiB | flows/doctor-health.ts:63 `const { loadAndMaybeMigrateDoctorConfig } = await import("../commands/doctor-config-flow.js");` |
| `commands/doctor-config-preflight.ts` | 7.0 KiB | cli/program/config-guard.ts:174 `(await import("../../commands/doctor-config-preflight.js")).runDoctorConfigPreflight({`<br>commands/doctor/shared/config-flow-steps.ts:5 `import type { DoctorConfigPreflightResult } from "../../doctor-config-preflight.js";`<br>commands/doctor-config-flow.ts:13 `import { runDoctorConfigPreflight } from "./doctor-config-preflight.js";` |
| `commands/doctor-cron.ts` | 0.1 KiB | flows/doctor-core-checks.ts:607 `await import("../commands/doctor-cron.js");`<br>flows/doctor-health-contributions.ts:509 `await import("../commands/doctor-cron.js");` |
| `commands/doctor-device-pairing.ts` | 17.0 KiB | flows/doctor-health-contributions.ts:875 `const { noteDevicePairingHealth } = await import("../commands/doctor-device-pairing.js");` |
| `commands/doctor-disk-space.ts` | 4.0 KiB | flows/doctor-health-contributions.ts:453 `const { noteDiskSpace } = await import("../commands/doctor-disk-space.js");` |
| `commands/doctor-format.ts` | 4.2 KiB | commands/doctor-gateway-daemon-flow.ts:40 `import { buildGatewayRuntimeHints, formatGatewayRuntimeSummary } from "./doctor-format.js";` |
| `commands/doctor-gateway-auth-token.ts` | 1.8 KiB | commands/doctor-gateway-services.ts:39 `import { resolveGatewayAuthTokenForService } from "./doctor-gateway-auth-token.js";` |
| `commands/doctor-gateway-daemon-flow.ts` | 15.2 KiB | flows/doctor-health-contributions.ts:883 `const { maybeRepairGatewayDaemon } = await import("../commands/doctor-gateway-daemon-flow.js");` |
| `commands/doctor-gateway-health.ts` | 6.5 KiB | flows/doctor-health-contributions.ts:3 `import type { probeGatewayMemoryStatus } from "../commands/doctor-gateway-health.js";`<br>flows/doctor-health-contributions.ts:3 `import type { probeGatewayMemoryStatus } from "../commands/doctor-gateway-health.js";` |
| `commands/doctor-gateway-services.ts` | 24.0 KiB | flows/doctor-health-contributions.ts:528 `await import("../commands/doctor-gateway-services.js");` |
| `commands/doctor-heartbeat-main-session-repair.ts` | 10.3 KiB | commands/doctor-state-integrity.ts:38 `import { repairHeartbeatPoisonedMainSession } from "./doctor-heartbeat-main-session-repair.js";` |
| `commands/doctor-heartbeat-session-target.ts` | 5.4 KiB | commands/doctor-state-integrity.ts:39 `import { describeHeartbeatSessionTargetIssues } from "./doctor-heartbeat-session-target.js";` |
| `commands/doctor-heartbeat-template-repair.ts` | 7.4 KiB | flows/doctor-health-contributions.ts:803 `await import("../commands/doctor-heartbeat-template-repair.js");` |
| `commands/doctor-install-policy.ts` | 3.2 KiB | flows/doctor-health-contributions.ts:559 `const { noteInstallPolicyHealth } = await import("../commands/doctor-install-policy.js");` |
| `commands/doctor-install.ts` | 1.5 KiB | flows/doctor-health.ts:54 `const { noteSourceInstallIssues } = await import("../commands/doctor-install.js");` |
| `commands/doctor-legacy-config.ts` | 0.2 KiB | commands/doctor-config-flow.ts:14 `import { normalizeCompatibilityConfigValues } from "./doctor-legacy-config.js";` |
| `commands/doctor-lint.ts` | 5.1 KiB | cli/program/register.maintenance.ts:59 `const { runDoctorLintCli } = await import("../../commands/doctor-lint.js");` |
| `commands/doctor-memory-search.ts` | 24.0 KiB | flows/doctor-health-contributions.ts:859 `await import("../commands/doctor-memory-search.js");` |
| `commands/doctor-platform-notes.ts` | 11.3 KiB | flows/doctor-core-checks.ts:660 `await import("../commands/doctor-platform-notes.js");`<br>flows/doctor-health-contributions.ts:533 `} = await import("../commands/doctor-platform-notes.js");`<br>flows/doctor-health.ts:57 `const { noteStartupOptimizationHints } = await import("../commands/doctor-platform-notes.js");` |
| `commands/doctor-plugin-manifests.ts` | 6.5 KiB | flows/doctor-health-contributions.ts:392 `await import("../commands/doctor-plugin-manifests.js");` |
| `commands/doctor-plugin-registry.ts` | 15.9 KiB | flows/doctor-health-contributions.ts:402 `const { maybeRepairPluginRegistryState } = await import("../commands/doctor-plugin-registry.js");` |
| `commands/doctor-post-upgrade.ts` | 7.3 KiB | commands/doctor.ts:3 `import { runPostUpgradeProbes } from "./doctor-post-upgrade.js";` |
| `commands/doctor-repair-mode.ts` | 1.7 KiB | commands/doctor-gateway-services.ts:41 `import { isDoctorUpdateRepairMode } from "./doctor-repair-mode.js";` |
| `commands/doctor-sandbox.ts` | 14.0 KiB | flows/doctor-health-contributions.ts:520 `await import("../commands/doctor-sandbox.js");` |
| `commands/doctor-security.ts` | 16.3 KiB | flows/doctor-core-checks.ts:61 `const { collectSecurityWarnings } = await import("../commands/doctor-security.js");`<br>flows/doctor-health-contributions.ts:560 `const { noteSecurityWarnings } = await import("../commands/doctor-security.js");` |
| `commands/doctor-session-locks.ts` | 3.4 KiB | flows/doctor-health-contributions.ts:480 `const { noteSessionLockHealth } = await import("../commands/doctor-session-locks.js");` |
| `commands/doctor-session-snapshots.ts` | 20.7 KiB | flows/doctor-health-contributions.ts:494 `const { noteSessionSnapshotHealth } = await import("../commands/doctor-session-snapshots.js");` |
| `commands/doctor-session-state-providers.ts` | 20.0 KiB | commands/doctor-state-integrity.ts:40 `import { runPluginSessionStateDoctorRepairs } from "./doctor-session-state-providers.js";` |
| `commands/doctor-session-transcripts.ts` | 11.2 KiB | flows/doctor-health-contributions.ts:489 `const { noteSessionTranscriptHealth } = await import("../commands/doctor-session-transcripts.js");` |
| `commands/doctor-skills-core.ts` | 1.1 KiB | flows/doctor-core-checks.runtime.ts:33 `import { collectUnavailableAgentSkills } from "../commands/doctor-skills-core.js";`<br>flows/doctor-core-checks.ts:16 `import { disableUnavailableSkillsInConfig } from "../commands/doctor-skills-core.js";` |
| `commands/doctor-skills.ts` | 4.9 KiB | flows/doctor-health-contributions.ts:789 `const { maybeRepairSkillReadiness } = await import("../commands/doctor-skills.js");` |
| `commands/doctor-state-integrity.ts` | 36.1 KiB | flows/doctor-core-checks.ts:68 `const { collectWorkspaceBackupTip } = await import("../commands/doctor-state-integrity.js");`<br>flows/doctor-health-contributions.ts:65 `await import("../commands/doctor-state-integrity.js");` |
| `commands/doctor-state-migrations.ts` | 0.6 KiB | commands/doctor-config-preflight.ts:18 `type DoctorStateMigrationsModule = typeof import("./doctor-state-migrations.js");`<br>commands/doctor-config-preflight.ts:18 `type DoctorStateMigrationsModule = typeof import("./doctor-state-migrations.js");`<br>commands/doctor.e2e-harness.ts:13 `import type { LegacyStateDetection } from "./doctor-state-migrations.js";` |
| `commands/doctor-ui.ts` | 7.6 KiB | flows/doctor-health.ts:53 `const { maybeRepairUiProtocolFreshness } = await import("../commands/doctor-ui.js");` |
| `commands/doctor-update.ts` | 3.5 KiB | flows/doctor-health.ts:40 `const { maybeOfferUpdateBeforeDoctor } = await import("../commands/doctor-update.js");` |
| `commands/doctor-whatsapp-responsiveness.ts` | 5.9 KiB | flows/doctor-health-contributions.ts:849 `await import("../commands/doctor-whatsapp-responsiveness.js");` |
| `commands/doctor-workspace-status.ts` | 6.1 KiB | flows/doctor-health-contributions.ts:784 `const { noteWorkspaceStatus } = await import("../commands/doctor-workspace-status.js");` |
| `commands/doctor-workspace.ts` | 11.1 KiB | commands/doctor-memory-search.ts:47 `import { maybeRepairWorkspaceMemoryHealth, noteWorkspaceMemoryHealth } from "./doctor-workspace.js";`<br>commands/doctor-workspace-status.ts:14 `import { detectLegacyWorkspaceDirs, formatLegacyWorkspaceWarning } from "./doctor-workspace.js";`<br>flows/doctor-core-checks.ts:39 `const loadDoctorWorkspaceModule = async () => await import("../commands/doctor-workspace.js");` |
| `commands/doctor.ts` | 1.1 KiB | cli/program/register.maintenance.ts:84 `const { doctorCommand } = await import("../../commands/doctor.js");`<br>cli/update-cli/update-command.ts:17 `import { doctorCommand } from "../../commands/doctor.js";`<br>commands/doctor.e2e-harness.ts:539 `const { doctorCommand } = await import("./doctor.js");` |
| `commands/doctor/channel-capabilities.ts` | 2.7 KiB | commands/doctor/shared/allow-from-mode.ts:2 `import { getDoctorChannelCapabilities } from "../channel-capabilities.js";`<br>commands/doctor/shared/allowfrom-fallback-migration.ts:7 `import { getDoctorChannelCapabilities } from "../channel-capabilities.js";`<br>commands/doctor/shared/empty-allowlist-policy.ts:3 `import { getDoctorChannelCapabilities } from "../channel-capabilities.js";` |
| `commands/doctor/cron/index.ts` | 12.5 KiB | commands/doctor-config-preflight.ts:19 `type DoctorCronModule = typeof import("./doctor/cron/index.js");`<br>commands/doctor-config-preflight.ts:19 `type DoctorCronModule = typeof import("./doctor/cron/index.js");`<br>commands/doctor-cron.ts:2 `export * from "./doctor/cron/index.js";` |
| `commands/doctor/cron/legacy-delivery.ts` | 5.1 KiB | commands/doctor/cron/store-migration.ts:15 `import { normalizeLegacyDeliveryInput } from "./legacy-delivery.js";` |
| `commands/doctor/cron/legacy-notify.ts` | 3.8 KiB | commands/doctor/cron/index.ts:21 `import { migrateLegacyNotifyFallback } from "./legacy-notify.js";` |
| `commands/doctor/cron/store-migration.ts` | 20.1 KiB | commands/doctor/cron/index.ts:37 `import { normalizeStoredCronJobs } from "./store-migration.js";` |
| `commands/doctor/cron/warnings.ts` | 7.0 KiB | commands/doctor/cron/index.ts:38 `import { noteCronModelOverrides } from "./warnings.js";` |
| `commands/doctor/emit-notes.ts` | 1.0 KiB | commands/doctor-config-flow.ts:16 `import { emitDoctorNotes, sanitizeDoctorNote } from "./doctor/emit-notes.js";` |
| `commands/doctor/finalize-config-flow.ts` | 1.3 KiB | commands/doctor-config-flow.ts:17 `import { finalizeDoctorConfigFlow } from "./doctor/finalize-config-flow.js";` |
| `commands/doctor/legacy-config-repair.ts` | 1.9 KiB | cli/update-cli/update-command.ts:2460 `await import("../../commands/doctor/legacy-config-repair.js");` |
| `commands/doctor/repair-sequencing.ts` | 9.1 KiB | commands/doctor-config-flow.ts:284 `const { runDoctorRepairSequence } = await import("./doctor/repair-sequencing.js");` |
| `commands/doctor/shared/active-tool-schema-warnings.ts` | 7.8 KiB | commands/doctor/repair-sequencing.ts:15 `import { collectActiveToolSchemaProjectionWarnings } from "./shared/active-tool-schema-warnings.js";`<br>commands/doctor/shared/preview-warnings.ts:787 `await import("./active-tool-schema-warnings.js");` |
| `commands/doctor/shared/allow-from-mode.ts` | 0.5 KiB | commands/doctor/shared/allowlist-policy-repair.ts:9 `import { resolveAllowFromMode, type AllowFromMode } from "./allow-from-mode.js";`<br>commands/doctor/shared/open-policy-allowfrom.ts:5 `import { resolveAllowFromMode, type AllowFromMode } from "./allow-from-mode.js";` |
| `commands/doctor/shared/allow-from-mode.types.ts` | 0.2 KiB | commands/doctor/channel-capabilities.ts:7 `import type { AllowFromMode } from "./shared/allow-from-mode.types.js";`<br>commands/doctor/shared/allow-from-mode.ts:3 `import type { AllowFromMode } from "./allow-from-mode.types.js";`<br>commands/doctor/shared/allow-from-mode.ts:3 `import type { AllowFromMode } from "./allow-from-mode.types.js";` |
| `commands/doctor/shared/allowfrom-fallback-migration.ts` | 6.9 KiB | commands/doctor/repair-sequencing.ts:16 `import { maybeRepairGroupAllowFromFallback } from "./shared/allowfrom-fallback-migration.js";` |
| `commands/doctor/shared/allowlist-policy-repair.ts` | 4.4 KiB | commands/doctor/repair-sequencing.ts:17 `import { maybeRepairAllowlistPolicyAllowFrom } from "./shared/allowlist-policy-repair.js";` |
| `commands/doctor/shared/allowlist.ts` | 0.4 KiB | commands/doctor/shared/allowlist-policy-repair.ts:10 `import { hasAllowFromEntries } from "./allowlist.js";`<br>commands/doctor/shared/empty-allowlist-policy.ts:5 `import { hasAllowFromEntries } from "./allowlist.js";` |
| `commands/doctor/shared/bundled-plugin-load-paths.ts` | 6.0 KiB | commands/doctor/repair-sequencing.ts:18 `import { maybeRepairBundledPluginLoadPaths } from "./shared/bundled-plugin-load-paths.js";`<br>commands/doctor/shared/preview-warnings.ts:878 `await import("./bundled-plugin-load-paths.js");` |
| `commands/doctor/shared/channel-doctor.ts` | 13.9 KiB | cli/plugins-install-command.ts:6 `import { collectChannelDoctorStaleConfigMutations } from "../commands/doctor/shared/channel-doctor.js";`<br>commands/doctor/shared/empty-allowlist-policy.ts:6 `import { shouldSkipChannelDoctorDefaultEmptyGroupAllowlistWarning } from "./channel-doctor.js";`<br>commands/doctor/shared/preview-warnings.ts:20 `type ChannelDoctorModule = typeof import("./channel-doctor.js");` |
| `commands/doctor/shared/channel-legacy-config-migrate.ts` | 3.1 KiB | commands/doctor/shared/legacy-config-compat.ts:2 `import { applyChannelDoctorCompatibilityMigrations } from "./channel-legacy-config-migrate.js";`<br>commands/doctor/shared/legacy-config-core-migrate.ts:6 `import { applyChannelDoctorCompatibilityMigrations } from "./channel-legacy-config-migrate.js";` |
| `commands/doctor/shared/channel-plugin-blockers.ts` | 4.9 KiB | commands/doctor/shared/preview-warnings.ts:792 `? await import("./channel-plugin-blockers.js")` |
| `commands/doctor/shared/codex-native-assets.ts` | 7.0 KiB | commands/doctor/shared/preview-warnings.ts:873 `const { collectCodexNativeAssetInfoNotes } = await import("./codex-native-assets.js");` |
| `commands/doctor/shared/codex-route-warnings.ts` | 97.6 KiB | commands/doctor/repair-sequencing.ts:23 `import { maybeRepairCodexRoutes } from "./shared/codex-route-warnings.js";`<br>commands/doctor/shared/preview-warnings.ts:847 `const { collectCodexRouteWarnings } = await import("./codex-route-warnings.js");`<br>flows/doctor-core-checks.ts:22 `import { collectDisabledCodexPluginRouteIssues } from "../commands/doctor/shared/codex-route-warnings.js";` |
| `commands/doctor/shared/config-mutation-state.ts` | 1.4 KiB | commands/doctor/shared/config-flow-steps.ts:6 `import type { DoctorConfigMutationState } from "./config-mutation-state.js";`<br>commands/doctor/shared/hooks-token-reuse-repair.ts:10 `import type { DoctorConfigMutationResult } from "./config-mutation-state.js";`<br>commands/doctor-config-flow.ts:22 `import { applyDoctorConfigMutation } from "./doctor/shared/config-mutation-state.js";` |
| `commands/doctor/shared/context-engine-host-compat.ts` | 14.7 KiB | commands/doctor/repair-sequencing.ts:28 `import { maybeRepairContextEngineHostCompatibility } from "./shared/context-engine-host-compat.js";`<br>commands/doctor/shared/preview-warnings.ts:851 `await import("./context-engine-host-compat.js");` |
| `commands/doctor/shared/empty-allowlist-policy.ts` | 4.6 KiB | commands/doctor/shared/empty-allowlist-scan.ts:5 `import { collectEmptyAllowlistPolicyWarningsForAccount } from "./empty-allowlist-policy.js";` |
| `commands/doctor/shared/empty-allowlist-scan.ts` | 3.5 KiB | commands/doctor/repair-sequencing.ts:29 `import { scanEmptyAllowlistPolicyWarnings } from "./shared/empty-allowlist-scan.js";`<br>commands/doctor/shared/preview-warnings.ts:892 `const { scanEmptyAllowlistPolicyWarnings } = await import("./empty-allowlist-scan.js");` |
| `commands/doctor/shared/exec-safe-bins.ts` | 9.9 KiB | commands/doctor/repair-sequencing.ts:30 `import { maybeRepairExecSafeBinProfiles } from "./shared/exec-safe-bins.js";`<br>commands/doctor/shared/preview-warnings.ts:937 `} = await import("./exec-safe-bins.js");` |
| `commands/doctor/shared/hooks-token-reuse-repair.ts` | 2.9 KiB | commands/doctor-config-flow.ts:273 `await import("./doctor/shared/hooks-token-reuse-repair.js");` |
| `commands/doctor/shared/invalid-plugin-config.ts` | 2.3 KiB | commands/doctor/repair-sequencing.ts:31 `import { maybeRepairInvalidPluginConfig } from "./shared/invalid-plugin-config.js";` |
| `commands/doctor/shared/legacy-config-compat.ts` | 1.0 KiB | commands/doctor/shared/legacy-config-migrate.ts:4 `import { applyLegacyDoctorMigrations } from "./legacy-config-compat.js";` |
| `commands/doctor/shared/legacy-config-compatibility-base.ts` | 2.0 KiB | commands/doctor/shared/legacy-config-core-migrate.ts:7 `import { normalizeBaseCompatibilityConfigValues } from "./legacy-config-compatibility-base.js";` |
| `commands/doctor/shared/legacy-config-core-migrate.ts` | 3.0 KiB | commands/doctor-legacy-config.ts:2 `export { normalizeCompatibilityConfigValues } from "./doctor/shared/legacy-config-core-migrate.js";` |
| `commands/doctor/shared/legacy-config-migrate.ts` | 0.9 KiB | commands/doctor/legacy-config-repair.ts:6 `import { migrateLegacyConfig } from "./shared/legacy-config-migrate.js";`<br>commands/doctor/shared/config-flow-steps.ts:7 `import { migrateLegacyConfig } from "./legacy-config-migrate.js";` |
| `commands/doctor/shared/legacy-talk-config-normalizer.ts` | 3.5 KiB | commands/doctor/shared/legacy-config-core-normalizers.ts:20 `export { normalizeLegacyTalkConfig } from "./legacy-talk-config-normalizer.js";` |
| `commands/doctor/shared/legacy-tools-by-sender.ts` | 4.8 KiB | commands/doctor/repair-sequencing.ts:32 `import { maybeRepairLegacyToolsBySenderKeys } from "./shared/legacy-tools-by-sender.js";`<br>commands/doctor/shared/preview-warnings.ts:919 `await import("./legacy-tools-by-sender.js");` |
| `commands/doctor/shared/legacy-web-fetch-migrate.ts` | 4.1 KiB | commands/doctor/shared/legacy-config-compatibility-base.ts:15 `import { migrateLegacyWebFetchConfig } from "./legacy-web-fetch-migrate.js";` |
| `commands/doctor/shared/legacy-web-search-migrate.ts` | 7.7 KiB | commands/doctor/shared/legacy-config-compatibility-base.ts:16 `import { migrateLegacyWebSearchConfig } from "./legacy-web-search-migrate.js";` |
| `commands/doctor/shared/missing-configured-plugin-install.ts` | 51.2 KiB | cli/update-cli/post-core-plugin-convergence.ts:2 `import { repairMissingConfiguredPluginInstalls } from "../../commands/doctor/shared/missing-configured-plugin-install.js";`<br>commands/doctor/repair-sequencing.ts:33 `import { repairMissingConfiguredPluginInstalls } from "./shared/missing-configured-plugin-install.js";`<br>commands/doctor/shared/release-configured-plugin-installs.ts:15 `import { repairMissingPluginInstallsForIds } from "./missing-configured-plugin-install.js";` |
| `commands/doctor/shared/object.ts` | 0.3 KiB | commands/doctor/shared/allowfrom-fallback-migration.ts:8 `import { asObjectRecord } from "./object.js";`<br>commands/doctor/shared/allowlist-policy-repair.ts:11 `import { asObjectRecord } from "./object.js";`<br>commands/doctor/shared/bundled-plugin-load-paths.ts:14 `import { asObjectRecord } from "./object.js";` |
| `commands/doctor/shared/open-policy-allowfrom.ts` | 2.4 KiB | commands/doctor/repair-sequencing.ts:34 `import { maybeRepairOpenPolicyAllowFrom } from "./shared/open-policy-allowfrom.js";`<br>commands/doctor/shared/preview-warnings.ts:816 `await import("./open-policy-allowfrom.js");` |
| `commands/doctor/shared/plugin-dependency-cleanup.ts` | 13.9 KiB | commands/doctor/repair-sequencing.ts:35 `import { cleanupLegacyPluginDependencyState } from "./shared/plugin-dependency-cleanup.js";` |
| `commands/doctor/shared/plugin-runtime-symlinks.ts` | 6.7 KiB | commands/doctor/shared/plugin-dependency-cleanup.ts:7 `import { removeStalePluginRuntimeSymlinks } from "./plugin-runtime-symlinks.js";`<br>flows/doctor-health.ts:56 `await import("../commands/doctor/shared/plugin-runtime-symlinks.js");` |
| `commands/doctor/shared/plugin-tool-allowlist-warnings.ts` | 23.1 KiB | commands/doctor-config-flow.ts:218 `await import("./doctor/shared/plugin-tool-allowlist-warnings.js");` |
| `commands/doctor/shared/preview-warnings.ts` | 35.2 KiB | commands/doctor-config-flow.ts:300 `const { collectDoctorPreviewNotes } = await import("./doctor/shared/preview-warnings.js");` |
| `commands/doctor/shared/release-configured-plugin-installs.ts` | 13.6 KiB | flows/doctor-health-contributions.ts:420 `await import("../commands/doctor/shared/release-configured-plugin-installs.js");` |
| `commands/doctor/shared/stale-oauth-profile-shadows.ts` | 10.8 KiB | commands/doctor/repair-sequencing.ts:36 `import { repairStaleOAuthProfileShadows } from "./shared/stale-oauth-profile-shadows.js";`<br>commands/doctor/shared/preview-warnings.ts:955 `await import("./stale-oauth-profile-shadows.js");` |
| `commands/doctor/shared/stale-plugin-config.ts` | 16.8 KiB | cli/plugins-cli.runtime.ts:340 `} = await import("../commands/doctor/shared/stale-plugin-config.js");`<br>commands/doctor/repair-sequencing.ts:37 `import { maybeRepairStalePluginConfig } from "./shared/stale-plugin-config.js";`<br>commands/doctor/shared/preview-warnings.ts:833 `} = await import("./stale-plugin-config.js");` |
| `commands/doctor/shared/stale-subagent-allowlist.ts` | 6.1 KiB | commands/doctor/repair-sequencing.ts:38 `import { maybeRepairStaleSubagentAllowlists } from "./shared/stale-subagent-allowlist.js";`<br>commands/doctor/shared/preview-warnings.ts:862 `await import("./stale-subagent-allowlist.js");` |
| `commands/doctor/shared/update-phase.ts` | 4.1 KiB | cli/update-cli/post-core-plugin-convergence.ts:3 `import { UPDATE_POST_CORE_CONVERGENCE_ENV } from "../../commands/doctor/shared/update-phase.js";`<br>commands/doctor/repair-sequencing.ts:39 `import { isUpdatePackageSwapInProgress } from "./shared/update-phase.js";`<br>commands/doctor/shared/release-configured-plugin-installs.ts:17 `import { shouldDeferConfiguredPluginInstallRepair } from "./update-phase.js";` |
| `commands/doctor/types.ts` | 0.3 KiB | commands/doctor/shared/allowlist.ts:3 `import type { DoctorAllowFromList } from "../types.js";`<br>commands/doctor/shared/empty-allowlist-policy.ts:4 `import type { DoctorAccountRecord, DoctorAllowFromList } from "../types.js";`<br>commands/doctor/shared/empty-allowlist-scan.ts:4 `import type { DoctorAccountRecord, DoctorAllowFromList } from "../types.js";` |
| `commands/export-trajectory.ts` | 5.7 KiB | cli/program/register.status-health-sessions.ts:343 `const { exportTrajectoryCommand } = await import("../../commands/export-trajectory.js");` |
| `commands/flows.ts` | 8.5 KiB | cli/program/register.status-health-sessions.ts:32 `const loadFlowsCommands = createModuleLoader(() => import("../../commands/flows.js"));` |
| `commands/gateway-health-auth-diagnostic.ts` | 1.7 KiB | commands/gateway-readiness.ts:6 `import { gatewayProbeResultSawGateway } from "./gateway-health-auth-diagnostic.js";` |
| `commands/gateway-readiness.ts` | 8.1 KiB | commands/dashboard.ts:7 `import { ensureGatewayReadyForOperation } from "./gateway-readiness.js";` |
| `commands/gateway-status.ts` | 4.9 KiB | cli/gateway-cli/register.ts:30 `() => import("../../commands/gateway-status.js"),` |
| `commands/gateway-status/discovery.ts` | 3.3 KiB | commands/gateway-status/output.ts:5 `import { serializeGatewayDiscoveryBeacon } from "./discovery.js";`<br>commands/gateway-status/probe-run.ts:13 `import { pickAutoSshTargetFromDiscovery } from "./discovery.js";`<br>commands/gateway-status.ts:8 `import { inferSshTargetFromRemoteUrl, resolveSshTarget } from "./gateway-status/discovery.js";` |
| `commands/gateway-status/probe-run.ts` | 5.3 KiB | commands/gateway-status/output.ts:14 `import type { GatewayStatusProbedTarget } from "./probe-run.js";`<br>commands/gateway-status.ts:21 `import { runGatewayStatusProbePass } from "./gateway-status/probe-run.js";` |
| `commands/message-format.ts` | 12.9 KiB | commands/message.ts:134 `const { formatMessageCliText } = await import("./message-format.js");` |
| `commands/message.ts` | 4.8 KiB | cli/program/message/helpers.ts:9 `import { messageCommand } from "../../../commands/message.js";` |
| `commands/model-picker.runtime.ts` | 0.8 KiB | flows/model-picker.ts:104 `return import("../commands/model-picker.runtime.js");` |
| `commands/models/aliases.ts` | 3.9 KiB | cli/models-cli.ts:20 `const loadModelsAliasesCommands = createModuleLoader(() => import("../commands/models/aliases.js"));` |
| `commands/models/auth-list.ts` | 5.3 KiB | cli/models-cli.ts:322 `const { modelsAuthListCommand } = await import("../commands/models/auth-list.js");` |
| `commands/models/auth-order.ts` | 5.3 KiB | cli/models-cli.ts:29 `() => import("../commands/models/auth-order.js"),` |
| `commands/models/auth.ts` | 34.1 KiB | cli/capability-cli.ts:2176 `const { modelsAuthLoginCommand } = await import("../commands/models/auth.js");`<br>cli/models-cli.ts:27 `const loadModelsAuthCommands = createModuleLoader(() => import("../commands/models/auth.js"));` |
| `commands/models/fallbacks.ts` | 1.3 KiB | cli/models-cli.ts:22 `() => import("../commands/models/fallbacks.js"),` |
| `commands/models/image-fallbacks.ts` | 1.4 KiB | cli/models-cli.ts:25 `() => import("../commands/models/image-fallbacks.js"),` |
| `commands/models/list.auth-index.ts` | 8.1 KiB | commands/models/list.list-command.ts:9 `import { createModelListAuthIndex } from "./list.auth-index.js";`<br>commands/models/list.rows.ts:17 `import type { ModelListAuthIndex } from "./list.auth-index.js";` |
| `commands/models/list.auth-overview.ts` | 8.3 KiB | commands/models/list.status-command.ts:70 `import { resolveProviderAuthOverview } from "./list.auth-overview.js";` |
| `commands/models/list.configured.ts` | 4.1 KiB | commands/models/list.list-command.ts:10 `import { resolveConfiguredEntries } from "./list.configured.js";` |
| `commands/models/list.errors.ts` | 0.8 KiB | commands/models/list.list-command.ts:11 `import { formatErrorWithStack } from "./list.errors.js";` |
| `commands/models/list.format.ts` | 1.4 KiB | commands/models/list.auth-overview.ts:23 `import { maskApiKey } from "./list.format.js";`<br>commands/models/list.status-command.ts:71 `import { isRich } from "./list.format.js";`<br>commands/models/list.table.ts:5 `import { formatTag, isRich, pad, truncate } from "./list.format.js";` |
| `commands/models/list.list-command.ts` | 8.6 KiB | cli/models-cli.ts:62 `const { modelsListCommand } = await import("../commands/models/list.list-command.js");`<br>cli/program/routed-command-definitions.ts:26 `type ModelsListCommandModule = typeof import("../../commands/models/list.list-command.js");`<br>cli/program/routed-command-definitions.ts:26 `type ModelsListCommandModule = typeof import("../../commands/models/list.list-command.js");` |
| `commands/models/list.manifest-catalog.ts` | 5.1 KiB | commands/configure.gateway-auth.ts:18 `import { loadStaticManifestCatalogRowsForList } from "./models/list.manifest-catalog.js";`<br>commands/models/list.source-plan.ts:26 `type ManifestCatalogModule = typeof import("./list.manifest-catalog.js");`<br>commands/models/list.source-plan.ts:26 `type ManifestCatalogModule = typeof import("./list.manifest-catalog.js");` |
| `commands/models/list.model-row.ts` | 2.6 KiB | commands/models/list.registry.ts:15 `import { toModelRow as toModelRowBase } from "./list.model-row.js";`<br>commands/models/list.rows.ts:18 `import type { ListRowModel } from "./list.model-row.js";`<br>commands/models/list.rows.ts:18 `import type { ListRowModel } from "./list.model-row.js";` |
| `commands/models/list.probe.ts` | 21.0 KiB | commands/models/list.status-command.ts:72 `import type { AuthProbeSummary } from "./list.probe.js";`<br>commands/models/list.status-command.ts:72 `import type { AuthProbeSummary } from "./list.probe.js";`<br>commands/models/list.status-command.ts:72 `import type { AuthProbeSummary } from "./list.probe.js";` |
| `commands/models/list.provider-catalog.ts` | 14.0 KiB | commands/models/list.rows.ts:27 `type ProviderCatalogModule = typeof import("./list.provider-catalog.js");`<br>commands/models/list.rows.ts:27 `type ProviderCatalogModule = typeof import("./list.provider-catalog.js");`<br>commands/models/list.source-plan.ts:27 `type ProviderCatalogModule = typeof import("./list.provider-catalog.js");` |
| `commands/models/list.provider-index-catalog.ts` | 1.4 KiB | commands/models/list.source-plan.ts:25 `type ProviderIndexCatalogModule = typeof import("./list.provider-index-catalog.js");`<br>commands/models/list.source-plan.ts:25 `type ProviderIndexCatalogModule = typeof import("./list.provider-index-catalog.js");` |
| `commands/models/list.registry-load.ts` | 2.3 KiB | commands/models/list.list-command.ts:20 `type RegistryLoadModule = typeof import("./list.registry-load.js");`<br>commands/models/list.list-command.ts:20 `type RegistryLoadModule = typeof import("./list.registry-load.js");` |
| `commands/models/list.registry.ts` | 4.6 KiB | commands/models/list.registry-load.ts:7 `import { loadModelRegistry } from "./list.registry.js";` |
| `commands/models/list.row-sources.ts` | 6.0 KiB | commands/models/list.list-command.ts:21 `type RowSourcesModule = typeof import("./list.row-sources.js");`<br>commands/models/list.list-command.ts:21 `type RowSourcesModule = typeof import("./list.row-sources.js");` |
| `commands/models/list.source-plan.ts` | 6.9 KiB | commands/models/list.list-command.ts:22 `type SourcePlanModule = typeof import("./list.source-plan.js");`<br>commands/models/list.list-command.ts:22 `type SourcePlanModule = typeof import("./list.source-plan.js");`<br>commands/models/list.row-sources.ts:14 `import type { ModelListSourcePlan } from "./list.source-plan.js";` |
| `commands/models/list.status-command.ts` | 45.5 KiB | cli/capability-cli.ts:914 `const { modelsStatusCommand } = await import("../commands/models/list.status-command.js");`<br>cli/models-cli.ts:18 `() => import("../commands/models/list.status-command.js"),`<br>cli/program/routed-command-definitions.ts:27 `type ModelsStatusCommandModule = typeof import("../../commands/models/list.status-command.js");` |
| `commands/models/list.table.ts` | 3.0 KiB | commands/models/list.list-command.ts:12 `import { printModelTable } from "./list.table.js";` |
| `commands/models/list.types.ts` | 1.0 KiB | commands/models/list.auth-overview.ts:24 `import type { ProviderAuthOverview } from "./list.types.js";`<br>commands/models/list.configured.ts:13 `import type { ConfiguredEntry } from "./list.types.js";`<br>commands/models/list.list-command.ts:13 `import type { ModelRow } from "./list.types.js";` |
| `commands/models/load-config.ts` | 1.8 KiB | commands/models/aliases.ts:5 `import { loadModelsConfig } from "./load-config.js";`<br>commands/models/auth-list.ts:16 `import { loadModelsConfig } from "./load-config.js";`<br>commands/models/auth-order.ts:15 `import { loadModelsConfig } from "./load-config.js";` |
| `commands/models/scan.ts` | 13.9 KiB | cli/models-cli.ts:288 `const { modelsScanCommand } = await import("../commands/models/scan.js");` |
| `commands/models/set-image.ts` | 0.8 KiB | cli/models-cli.ts:135 `const { modelsSetImageCommand } = await import("../commands/models/set-image.js");` |
| `commands/models/set.ts` | 1.5 KiB | cli/models-cli.ts:122 `const { modelsSetCommand } = await import("../commands/models/set.js");` |
| `commands/node-daemon-install-helpers.ts` | 2.8 KiB | cli/node-cli/daemon.ts:4 `import { buildNodeInstallPlan } from "../../commands/node-daemon-install-helpers.js";` |
| `commands/node-daemon-runtime.ts` | 0.7 KiB | commands/node-daemon-install-helpers.ts:12 `import type { NodeDaemonRuntime } from "./node-daemon-runtime.js";` |
| `commands/non-interactive-prompter.ts` | 1.3 KiB | commands/onboard-non-interactive/local/auth-choice.plugin-providers.ts:31 `import { createNonInteractiveLoggingPrompter } from "../../non-interactive-prompter.js";`<br>commands/onboard-non-interactive.ts:14 `import { createNonInteractiveLoggingPrompter } from "./non-interactive-prompter.js";` |
| `commands/oauth-env.ts` | 0.1 KiB | commands/models/auth.ts:69 `import { isRemoteEnvironment } from "../oauth-env.js";` |
| `commands/oauth-tls-preflight.ts` | 0.1 KiB | flows/doctor-core-checks.ts:581 `} = await import("../commands/oauth-tls-preflight.js");`<br>flows/doctor-health-contributions.ts:571 `const { noteOpenAIOAuthTlsPrerequisites } = await import("../commands/oauth-tls-preflight.js");` |
| `commands/onboard-core-auth-flags.ts` | 0.5 KiB | cli/program/register.onboard.ts:7 `import { CORE_ONBOARD_AUTH_FLAGS } from "../../commands/onboard-core-auth-flags.js";`<br>commands/onboard-non-interactive/local/auth-choice-inference.ts:10 `import { CORE_ONBOARD_AUTH_FLAGS } from "../../onboard-core-auth-flags.js";` |
| `commands/onboard-interactive.ts` | 1.4 KiB | commands/onboard.ts:20 `import { runInteractiveSetup } from "./onboard-interactive.js";` |
| `commands/onboard-non-interactive.ts` | 4.0 KiB | commands/onboard.ts:21 `import { runNonInteractiveSetup } from "./onboard-non-interactive.js";` |
| `commands/onboard-non-interactive/api-keys.ts` | 5.4 KiB | commands/onboard-non-interactive/local/auth-choice.ts:29 `import { resolveNonInteractiveApiKey } from "../api-keys.js";` |
| `commands/onboard-non-interactive/config-write.ts` | 2.6 KiB | commands/onboard-non-interactive/local.ts:24 `import { commitNonInteractiveOnboardConfig } from "./config-write.js";`<br>commands/onboard-non-interactive/remote.ts:15 `import { commitNonInteractiveOnboardConfig } from "./config-write.js";` |
| `commands/onboard-non-interactive/local.ts` | 14.3 KiB | commands/onboard-non-interactive.ts:15 `import { runNonInteractiveLocalSetup } from "./onboard-non-interactive/local.js";` |
| `commands/onboard-non-interactive/local/auth-choice-inference.ts` | 2.4 KiB | commands/onboard-non-interactive/local.ts:174 `: (await import("./local/auth-choice-inference.js")).inferAuthChoiceFromFlags(opts, {` |
| `commands/onboard-non-interactive/local/auth-choice.plugin-providers.runtime.ts` | 0.7 KiB | commands/onboard-non-interactive/local/auth-choice.plugin-providers.ts:37 `return import("./auth-choice.plugin-providers.runtime.js");` |
| `commands/onboard-non-interactive/local/auth-choice.plugin-providers.ts` | 8.3 KiB | commands/onboard-non-interactive/local/auth-choice.ts:30 `import { applyNonInteractivePluginProviderChoice } from "./auth-choice.plugin-providers.js";` |
| `commands/onboard-non-interactive/local/auth-choice.ts` | 10.6 KiB | commands/onboard-non-interactive/local.ts:196 `const { applyNonInteractiveAuthChoice } = await import("./local/auth-choice.js");` |
| `commands/onboard-non-interactive/local/daemon-install.ts` | 3.7 KiB | commands/onboard-non-interactive/local.ts:247 `const { installGatewayDaemonNonInteractive } = await import("./local/daemon-install.js");` |
| `commands/onboard-non-interactive/local/gateway-config.ts` | 6.8 KiB | commands/onboard-non-interactive/local.ts:25 `import { applyNonInteractiveGatewayConfig } from "./local/gateway-config.js";` |
| `commands/onboard-non-interactive/local/skills-config.ts` | 1.2 KiB | commands/onboard-non-interactive/local.ts:31 `import { applyNonInteractiveSkillsConfig } from "./local/skills-config.js";` |
| `commands/onboard-non-interactive/local/workspace.ts` | 0.8 KiB | commands/onboard-non-interactive/local.ts:32 `import { resolveNonInteractiveWorkspaceDir } from "./local/workspace.js";` |
| `commands/onboard-non-interactive/remote.ts` | 2.5 KiB | commands/onboard-non-interactive.ts:16 `import { runNonInteractiveRemoteSetup } from "./onboard-non-interactive/remote.js";` |
| `commands/onboard.ts` | 4.7 KiB | cli/program/register.onboard.ts:201 `const { setupWizardCommand } = await import("../../commands/onboard.js");`<br>cli/program/register.setup.ts:56 `const { setupWizardCommand } = await import("../../commands/onboard.js");`<br>cli/run-main.ts:680 `const { setupWizardCommand } = await import("../commands/onboard.js");` |
| `commands/reset.ts` | 5.5 KiB | cli/program/register.maintenance.ts:135 `const { resetCommand } = await import("../../commands/reset.js");` |
| `commands/sandbox-explain.ts` | 11.5 KiB | cli/sandbox-cli.ts:5 `import { sandboxExplainCommand } from "../commands/sandbox-explain.js";` |
| `commands/sandbox-formatters.ts` | 0.7 KiB | commands/sandbox-display.ts:9 `import { formatImageMatch, formatSimpleStatus, formatStatus } from "./sandbox-formatters.js";` |
| `commands/sandbox.ts` | 6.0 KiB | cli/sandbox-cli.ts:6 `import { sandboxListCommand, sandboxRecreateCommand } from "../commands/sandbox.js";` |
| `commands/session-store-targets.ts` | 1.1 KiB | commands/sessions-cleanup.ts:26 `import { resolveSessionStoreTargetsOrExit } from "./session-store-targets.js";`<br>commands/sessions-tail.ts:25 `import { resolveSessionStoreTargetsOrExit } from "./session-store-targets.js";`<br>commands/sessions.ts:32 `import { resolveSessionStoreTargetsOrExit } from "./session-store-targets.js";` |
| `commands/sessions-cleanup.ts` | 9.1 KiB | cli/program/register.status-health-sessions.ts:273 `const { sessionsCleanupCommand } = await import("../../commands/sessions-cleanup.js");` |
| `commands/sessions-display-model.ts` | 5.2 KiB | commands/sessions-cleanup.ts:27 `import { resolveSessionDisplayModel } from "./sessions-display-model.js";` |
| `commands/sessions-tail.ts` | 17.2 KiB | cli/program/register.status-health-sessions.ts:309 `const { sessionsTailCommand } = await import("../../commands/sessions-tail.js");` |
| `commands/sessions.ts` | 18.5 KiB | cli/program/register.status-health-sessions.ts:62 `const { sessionsCommand } = await import("../../commands/sessions.js");`<br>cli/program/routed-command-definitions.ts:121 `const { sessionsCommand } = await import("../../commands/sessions.js");` |
| `commands/setup.ts` | 7.9 KiB | cli/program/register.setup.ts:73 `const { setupCommand } = await import("../../commands/setup.js");` |
| `commands/status-all/channels-table.ts` | 2.2 KiB | commands/status-all/report-sections.ts:5 `import { buildStatusChannelsTableRows, statusChannelsTableColumns } from "./channels-table.js";` |
| `commands/status-json.ts` | 0.8 KiB | cli/program/routed-command-definitions.ts:95 `const { statusJsonCommand } = await import("../../commands/status-json.js");` |
| `commands/tasks-json.ts` | 3.8 KiB | cli/program/routed-command-definitions.ts:28 `type TasksJsonCommandModule = typeof import("../../commands/tasks-json.js");`<br>cli/program/routed-command-definitions.ts:28 `type TasksJsonCommandModule = typeof import("../../commands/tasks-json.js");` |
| `commands/tasks.ts` | 22.5 KiB | cli/program/register.status-health-sessions.ts:31 `const loadTasksCommands = createModuleLoader(() => import("../../commands/tasks.js"));` |
| `commands/uninstall.ts` | 7.0 KiB | cli/program/register.maintenance.ts:163 `const { uninstallCommand } = await import("../../commands/uninstall.js");` |
| `wizard/clack-prompter.ts` | 5.6 KiB | commands/agents.commands.add.ts:30 `import { createClackPrompter } from "../wizard/clack-prompter.js";`<br>commands/agents.commands.delete.ts:26 `import { createClackPrompter } from "../wizard/clack-prompter.js";`<br>commands/channel-setup/channel-plugin-resolution.ts:13 `import { createClackPrompter } from "../../wizard/clack-prompter.js";` |

### 2.3 🟢 孤立

| file | size | evidence |
|---|---:|---|
| `cli/command-execution-startup.ts` | 2.7 KiB | no static importers found under `src` |
| `cli/completion-fish.ts` | 1.3 KiB | no static importers found under `src` |
| `cli/config-set-dryrun.ts` | 0.8 KiB | no static importers found under `src` |
| `cli/cron-cli/register.cron-add.ts` | 17.3 KiB | no static importers found under `src` |
| `cli/daemon-cli-compat.ts` | 4.7 KiB | no static importers found under `src` |
| `cli/daemon-cli/lifecycle-core.ts` | 20.1 KiB | no static importers found under `src` |
| `cli/daemon-cli/runners.ts` | 0.3 KiB | no static importers found under `src` |
| `cli/daemon-cli/test-helpers/lifecycle-core-harness.ts` | 2.2 KiB | no static importers found under `src` |
| `cli/node-cli/daemon.ts` | 8.9 KiB | no static importers found under `src` |
| `cli/nodes-screen.ts` | 1.6 KiB | no static importers found under `src` |
| `cli/plugin-install-config-policy.ts` | 8.7 KiB | no static importers found under `src` |
| `cli/plugins-install-records.ts` | 1.3 KiB | no static importers found under `src` |
| `cli/plugins-update-selection.ts` | 2.7 KiB | no static importers found under `src` |
| `cli/program/message/register.emoji-sticker.ts` | 2.2 KiB | no static importers found under `src` |
| `cli/program/message/register.permissions-search.ts` | 1.4 KiB | no static importers found under `src` |
| `cli/program/register-command-groups.ts` | 3.5 KiB | no static importers found under `src` |
| `cli/program/route-args.ts` | 10.5 KiB | no static importers found under `src` |
| `cli/program/routed-command-definitions.ts` | 6.9 KiB | no static importers found under `src` |
| `cli/requirements-test-fixtures.ts` | 0.5 KiB | no static importers found under `src` |
| `cli/respawn-policy.ts` | 2.0 KiB | no static importers found under `src` |
| `cli/run-main-policy.ts` | 14.0 KiB | no static importers found under `src` |
| `cli/update-cli/plugin-payload-validation.ts` | 6.4 KiB | no static importers found under `src` |
| `cli/update-cli/post-core-plugin-convergence.ts` | 9.7 KiB | no static importers found under `src` |
| `commands/agents.bind.test-support.ts` | 2.5 KiB | no static importers found under `src` |
| `commands/agents.providers.ts` | 9.0 KiB | no static importers found under `src` |
| `commands/backup.test-support.ts` | 1.6 KiB | no static importers found under `src` |
| `commands/channels.mock-harness.ts` | 1.7 KiB | no static importers found under `src` |
| `commands/cleanup-command.test-support.ts` | 2.1 KiB | no static importers found under `src` |
| `commands/config-validation.ts` | 2.6 KiB | no static importers found under `src` |
| `commands/doctor-config-flow.test-utils.ts` | 4.4 KiB | no static importers found under `src` |
| `commands/doctor-post-upgrade.types.ts` | 0.8 KiB | no static importers found under `src` |
| `commands/doctor-service-repair-policy.ts` | 1.5 KiB | no static importers found under `src` |
| `commands/doctor.e2e-harness.ts` | 20.6 KiB | no static importers found under `src` |
| `commands/doctor/cron/dreaming-payload-migration.ts` | 2.9 KiB | no static importers found under `src` |
| `commands/doctor/cron/legacy-run-log-migration.ts` | 3.4 KiB | no static importers found under `src` |
| `commands/doctor/cron/legacy-store-migration.ts` | 10.0 KiB | no static importers found under `src` |
| `commands/doctor/cron/payload-migration.ts` | 6.6 KiB | no static importers found under `src` |
| `commands/doctor/cron/repair-plan.ts` | 5.9 KiB | no static importers found under `src` |
| `commands/doctor/shared/config-flow-steps.ts` | 3.9 KiB | no static importers found under `src` |
| `commands/doctor/shared/configured-runtime-plugin-installs.ts` | 2.7 KiB | no static importers found under `src` |
| `commands/doctor/shared/default-account-warnings.ts` | 5.7 KiB | no static importers found under `src` |
| `commands/doctor/shared/deprecation-compat.ts` | 15.9 KiB | no static importers found under `src` |
| `commands/doctor/shared/legacy-config-core-normalizers.ts` | 44.7 KiB | no static importers found under `src` |
| `commands/doctor/shared/legacy-oauth-sidecar.ts` | 12.6 KiB | no static importers found under `src` |
| `commands/doctor/shared/plugin-registry-migration.ts` | 11.4 KiB | no static importers found under `src` |
| `commands/gateway-install-token.persist.runtime.ts` | 0.2 KiB | no static importers found under `src` |
| `commands/gateway-status/output.ts` | 12.1 KiB | no static importers found under `src` |
| `commands/models/fallbacks-shared.ts` | 5.5 KiB | no static importers found under `src` |
| `commands/models/list.rows.ts` | 18.8 KiB | no static importers found under `src` |
| `commands/models/load-config.runtime.ts` | 0.3 KiB | no static importers found under `src` |
| `commands/onboard-custom-config.ts` | 24.3 KiB | no static importers found under `src` |
| `commands/onboard-non-interactive/local/output.ts` | 7.0 KiB | no static importers found under `src` |
| `commands/runtime-plugin-install.ts` | 6.5 KiB | no static importers found under `src` |
| `commands/sandbox-display.ts` | 4.7 KiB | no static importers found under `src` |
| `commands/sessions-table.ts` | 4.9 KiB | no static importers found under `src` |
| `commands/status-all/channels-token-summary.ts` | 9.8 KiB | no static importers found under `src` |
| `commands/status-all/report-sections.ts` | 5.7 KiB | no static importers found under `src` |
| `commands/status-all/report-tables.ts` | 2.8 KiB | no static importers found under `src` |
| `commands/status-overview-values.ts` | 3.3 KiB | no static importers found under `src` |
| `commands/status.command-sections.ts` | 19.3 KiB | no static importers found under `src` |
| `commands/status.scan.bootstrap-shared.ts` | 5.1 KiB | no static importers found under `src` |
| `commands/status.test-support.ts` | 8.4 KiB | no static importers found under `src` |
| `commands/tasks-audit-system.ts` | 3.6 KiB | no static importers found under `src` |
| `tui/tui-last-session.ts` | 4.6 KiB | no static importers found under `src` |
| `tui/tui-submit.ts` | 4.3 KiB | no static importers found under `src` |
| `wizard/setup.security-note.ts` | 1.4 KiB | no static importers found under `src` |

## 3. 最小 entry.ts 重写伪代码

```ts
import process from "node:process";
import { startGatewayServer } from "./gateway/server.js";

const port = Number.parseInt(readArgValue("--port") ?? process.env.OPENCLAW_GATEWAY_PORT ?? "18789", 10);
const token = readArgValue("--token") ?? process.env.OPENCLAW_GATEWAY_TOKEN;

await startGatewayServer(port, {
  auth: token ? { mode: "token", token } : undefined,
  deferStartupSidecars: process.env.OPENCLAW_SKIP_CHANNELS === "1" || process.env.OPENCLAW_SKIP_PROVIDERS === "1",
});
```

Notes:

- `--allow-unconfigured` is currently enforced only by `src/cli/gateway-cli/run.ts:259`-`287`; `GatewayServerOptions` in `src/gateway/server.impl.ts:474`-`532` does not include `allowUnconfigured`.
- For source runtime, `electron/gateway/config-sync.ts:672`-`681` writes a minimal `gateway.mode=local` config, so the minimal entry likely does not need to preserve CLI preflight behavior.
- For npm/bundled runtime parity, either keep a tiny local guard or add a narrow gateway option intentionally. This is needs runtime verification.

## 4. 共享依赖表

| color | shared module | gateway evidence | action |
|---|---|---|---|
| 🔴 | `cli/deps.ts` | `gateway/openai-http.ts:22`; `gateway/openresponses-http.ts:15`; `gateway/server-methods/send.ts:20`; `gateway/server.impl.ts:12` | Extract to non-CLI runtime deps module or retain minimal file. |
| 🔴 | `cli/deps.types.ts` | `gateway/boot.ts:13`; `gateway/local-request-context.ts:4`; `gateway/server/hooks.ts:9`; `gateway/server-methods/types.ts:16` | Move shared type to gateway/runtime boundary. |
| 🔴 | `cli/outbound-send-deps.ts` | `gateway/server-node-events.runtime.ts:8` re-exports `createOutboundSendDeps` | Move send deps to runtime/gateway shared. |
| 🔴 | `commands/agent.ts` | `gateway/boot.ts:14`; `gateway/openai-http.ts:23`; `gateway/server-methods/agent.ts:53` | Major shared runtime; extract before deleting commands. |
| 🔴 | `commands/agents.config.ts` | `gateway/assistant-identity.ts:5`; `gateway/server-methods/agents.ts:40` | Retain or move agent config helpers. |
| 🔴 | `commands/health.ts` / `commands/health.types.ts` | `gateway/server/health-state.ts:4`; `gateway/server-methods/health.ts:5`-`6` | Move health summary helpers under gateway/health or retain. |
| 🔴 | `commands/status.ts` | `gateway/server-methods/health.ts:6` imports `getStatusSummary` | Extract status summary runtime away from CLI command wrapper. |
| 🔴 | `commands/onboard-types.ts` | `gateway/server.impl.ts:515`; `gateway/server-methods/shared-types.ts:143` | Move type to wizard/shared if wizard RPC survives. |
| 🔴 | `wizard/session.ts` | `gateway/server-methods/wizard.ts:13`; `gateway/server-wizard-sessions.ts:3` | Wizard RPC currently gateway-owned; delete only if RPC removed. |
| 🔴 | `wizard/prompts.ts` | `gateway/server.impl.ts:517`; `gateway/server-methods/shared-types.ts:145` | Retain type or remove wizardRunner public option. |
| 🔴 | `wizard/setup.ts` | `gateway/server.impl.ts:538` dynamic import default wizard runner | Remove only with wizard RPC/runner removal. |

Gateway descriptors proving CLI-looking RPCs are currently gateway methods:

- `src/gateway/methods/core-descriptors.ts:68`-`71` registers `wizard.*`.
- `src/gateway/methods/core-descriptors.ts:89` registers `commands.list`.
- `src/gateway/server-methods.ts:79`-`82` lazy-loads `server-methods/commands.js`; `src/gateway/server-methods.ts:215`-`218` lazy-loads `server-methods/wizard.js`.
- `src/gateway/server-methods.ts:292`-`295` registers `commands.list`; `src/gateway/server-methods.ts:383`-`386` registers `wizard.start/next/cancel/status`.

## 5. 体积预估

| bucket | files | size |
|---|---:|---:|
| all `src/**/*.ts` | 4980 | 35.24 MiB |
| `src/cli/**/*.ts` | 254 | 1.84 MiB |
| `src/commands/**/*.ts` | 382 | 2.72 MiB |
| `src/tui/**/*.ts` | 35 | 0.28 MiB |
| `src/wizard/**/*.ts` | 19 | 0.30 MiB |
| `src/gateway/**/*.ts` | 337 | 3.22 MiB |
| current `entry.ts` full reachable graph | 3546 | 27.65 MiB |
| conservative gateway reachable graph | 2967 | 22.95 MiB |
| 🔴 required inside target dirs | 200 | 1.46 MiB |
| 🟡+🟢 removable candidates inside target dirs | 490 | 3.68 MiB |

P4-B can remove about 490 files / 3.68 MiB from the four target directories after the minimal entry rewrite, assuming package/tests/docs/build inputs are updated. Another 200 files / 1.46 MiB remain until shared gateway dependencies are extracted or the corresponding gateway RPCs are intentionally removed.

## 6. P4-B 删除建议（精确文件清单）

### Safe after minimal entry rewrite: 🟡 CLI-only + 🟢 isolated

- 🟡 `cli/acp-cli.ts`
- 🟡 `cli/argv-invocation.ts`
- 🟡 `cli/banner-config-lite.ts`
- 🟡 `cli/banner.ts`
- 🟡 `cli/capability-cli.ts`
- 🟡 `cli/channel-auth.ts`
- 🟡 `cli/channel-options.ts`
- 🟡 `cli/channels-cli.ts`
- 🟡 `cli/clawbot-cli.ts`
- 🟡 `cli/cli-utils.ts`
- 🟡 `cli/command-bootstrap.ts`
- 🟡 `cli/command-catalog.ts`
- 🟢 `cli/command-execution-startup.ts`
- 🟡 `cli/command-options.ts`
- 🟡 `cli/command-path-matches.ts`
- 🟡 `cli/command-path-policy.ts`
- 🟡 `cli/command-registration-policy.ts`
- 🟡 `cli/command-startup-policy.ts`
- 🟡 `cli/completion-cli.ts`
- 🟢 `cli/completion-fish.ts`
- 🟡 `cli/completion-runtime.ts`
- 🟡 `cli/config-cli.ts`
- 🟡 `cli/config-recovery-hints.ts`
- 🟢 `cli/config-set-dryrun.ts`
- 🟡 `cli/config-set-input.ts`
- 🟡 `cli/config-set-parser.ts`
- 🟡 `cli/container-target.ts`
- 🟡 `cli/cron-cli.ts`
- 🟢 `cli/cron-cli/register.cron-add.ts`
- 🟡 `cli/cron-cli/register.cron-edit.ts`
- 🟡 `cli/cron-cli/register.cron-simple.ts`
- 🟡 `cli/cron-cli/register.ts`
- 🟡 `cli/cron-cli/schedule-options.ts`
- 🟡 `cli/cron-cli/shared.ts`
- 🟡 `cli/cron-cli/thread-id-shared.ts`
- 🟢 `cli/daemon-cli-compat.ts`
- 🟡 `cli/daemon-cli.ts`
- 🟡 `cli/daemon-cli/gateway-token-drift.ts`
- 🟡 `cli/daemon-cli/install.runtime.ts`
- 🟡 `cli/daemon-cli/install.ts`
- 🟡 `cli/daemon-cli/launchd-recovery.ts`
- 🟢 `cli/daemon-cli/lifecycle-core.ts`
- 🟡 `cli/daemon-cli/lifecycle.runtime.ts`
- 🟡 `cli/daemon-cli/lifecycle.ts`
- 🟡 `cli/daemon-cli/register-service-commands.ts`
- 🟡 `cli/daemon-cli/register.ts`
- 🟡 `cli/daemon-cli/response.ts`
- 🟡 `cli/daemon-cli/restart-health.ts`
- 🟢 `cli/daemon-cli/runners.ts`
- 🟡 `cli/daemon-cli/shared.ts`
- 🟡 `cli/daemon-cli/start-repair.ts`
- 🟡 `cli/daemon-cli/status.gather.ts`
- 🟡 `cli/daemon-cli/status.print.ts`
- 🟡 `cli/daemon-cli/status.runtime.ts`
- 🟡 `cli/daemon-cli/status.ts`
- 🟢 `cli/daemon-cli/test-helpers/lifecycle-core-harness.ts`
- 🟡 `cli/daemon-cli/types.ts`
- 🟡 `cli/devices-cli.runtime.ts`
- 🟡 `cli/devices-cli.ts`
- 🟡 `cli/directory-cli.ts`
- 🟡 `cli/dns-cli.ts`
- 🟡 `cli/docs-cli.ts`
- 🟡 `cli/dotenv.ts`
- 🟡 `cli/exec-approvals-cli.ts`
- 🟡 `cli/exec-policy-cli.ts`
- 🟡 `cli/failure-output.ts`
- 🟡 `cli/gateway-cli.ts`
- 🟡 `cli/gateway-cli/call.ts`
- 🟡 `cli/gateway-cli/dev.ts`
- 🟡 `cli/gateway-cli/discover.ts`
- 🟡 `cli/gateway-cli/lifecycle.runtime.ts`
- 🟡 `cli/gateway-cli/qa-parent-watchdog.ts`
- 🟡 `cli/gateway-cli/register.ts`
- 🟡 `cli/gateway-cli/run-command.ts`
- 🟡 `cli/gateway-cli/run-loop.ts`
- 🟡 `cli/gateway-cli/run.ts`
- 🟡 `cli/gateway-cli/shared.ts`
- 🟡 `cli/gateway-dispatch-dotenv.ts`
- 🟡 `cli/gateway-rpc.runtime.ts`
- 🟡 `cli/gateway-rpc.ts`
- 🟡 `cli/gateway-rpc.types.ts`
- 🟡 `cli/gateway-run-argv.ts`
- 🟡 `cli/gateway-secret-options.ts`
- 🟡 `cli/help-format.ts`
- 🟡 `cli/hooks-cli.ts`
- 🟡 `cli/install-spec.ts`
- 🟡 `cli/json-output-mode.ts`
- 🟡 `cli/log-level-option.ts`
- 🟡 `cli/logs-cli.runtime.ts`
- 🟡 `cli/logs-cli.ts`
- 🟡 `cli/mcp-cli.ts`
- 🟡 `cli/models-cli.runtime.ts`
- 🟡 `cli/models-cli.ts`
- 🟡 `cli/native-hook-relay-cli.ts`
- 🟡 `cli/node-cli.ts`
- 🟢 `cli/node-cli/daemon.ts`
- 🟡 `cli/node-cli/register.ts`
- 🟡 `cli/nodes-camera.ts`
- 🟡 `cli/nodes-cli.ts`
- 🟡 `cli/nodes-cli/cli-utils.ts`
- 🟡 `cli/nodes-cli/format.ts`
- 🟡 `cli/nodes-cli/pairing-render.ts`
- 🟡 `cli/nodes-cli/register.camera.ts`
- 🟡 `cli/nodes-cli/register.invoke.ts`
- 🟡 `cli/nodes-cli/register.location.ts`
- 🟡 `cli/nodes-cli/register.notify.ts`
- 🟡 `cli/nodes-cli/register.pairing.ts`
- 🟡 `cli/nodes-cli/register.push.ts`
- 🟡 `cli/nodes-cli/register.screen.ts`
- 🟡 `cli/nodes-cli/register.status.ts`
- 🟡 `cli/nodes-cli/register.ts`
- 🟡 `cli/nodes-cli/rpc.runtime.ts`
- 🟡 `cli/nodes-cli/rpc.ts`
- 🟡 `cli/nodes-cli/types.ts`
- 🟡 `cli/nodes-media-utils.ts`
- 🟢 `cli/nodes-screen.ts`
- 🟡 `cli/pairing-cli.ts`
- 🟢 `cli/plugin-install-config-policy.ts`
- 🟡 `cli/plugin-registry-loader.ts`
- 🟡 `cli/plugin-registry.ts`
- 🟡 `cli/plugins-authoring-command.ts`
- 🟡 `cli/plugins-cli.runtime.ts`
- 🟡 `cli/plugins-cli.ts`
- 🟡 `cli/plugins-command-helpers.ts`
- 🟡 `cli/plugins-config.ts`
- 🟡 `cli/plugins-inspect-command.ts`
- 🟡 `cli/plugins-install-command.ts`
- 🟢 `cli/plugins-install-records.ts`
- 🟡 `cli/plugins-list-command.ts`
- 🟡 `cli/plugins-list-format.ts`
- 🟡 `cli/plugins-location-bridges.ts`
- 🟡 `cli/plugins-search-command.ts`
- 🟡 `cli/plugins-uninstall-command.ts`
- 🟡 `cli/plugins-uninstall-selection.ts`
- 🟡 `cli/plugins-update-command.ts`
- 🟡 `cli/plugins-update-outcomes.ts`
- 🟢 `cli/plugins-update-selection.ts`
- 🟡 `cli/ports.ts`
- 🟡 `cli/profile.ts`
- 🟡 `cli/program.ts`
- 🟡 `cli/program/action-reparse.ts`
- 🟡 `cli/program/build-program.ts`
- 🟡 `cli/program/command-registry-core.ts`
- 🟡 `cli/program/command-registry.ts`
- 🟡 `cli/program/command-tree.ts`
- 🟡 `cli/program/config-guard.ts`
- 🟡 `cli/program/context.ts`
- 🟡 `cli/program/error-output.ts`
- 🟡 `cli/program/help.ts`
- 🟡 `cli/program/helpers.ts`
- 🟡 `cli/program/json-mode.ts`
- 🟡 `cli/program/message/helpers.ts`
- 🟡 `cli/program/message/register.broadcast.ts`
- 🟡 `cli/program/message/register.discord-admin.ts`
- 🟢 `cli/program/message/register.emoji-sticker.ts`
- 🟢 `cli/program/message/register.permissions-search.ts`
- 🟡 `cli/program/message/register.pins.ts`
- 🟡 `cli/program/message/register.poll.ts`
- 🟡 `cli/program/message/register.reactions.ts`
- 🟡 `cli/program/message/register.read-edit-delete.ts`
- 🟡 `cli/program/message/register.send.ts`
- 🟡 `cli/program/message/register.thread.ts`
- 🟡 `cli/program/parent-default-help.ts`
- 🟡 `cli/program/preaction.ts`
- 🟡 `cli/program/program-context.ts`
- 🟢 `cli/program/register-command-groups.ts`
- 🟡 `cli/program/register-lazy-command.ts`
- 🟡 `cli/program/register.agent-turn.ts`
- 🟡 `cli/program/register.agent.ts`
- 🟡 `cli/program/register.backup.ts`
- 🟡 `cli/program/register.configure.ts`
- 🟡 `cli/program/register.crestodian.ts`
- 🟡 `cli/program/register.maintenance.ts`
- 🟡 `cli/program/register.message.ts`
- 🟡 `cli/program/register.migrate.ts`
- 🟡 `cli/program/register.onboard.ts`
- 🟡 `cli/program/register.setup.ts`
- 🟡 `cli/program/register.status-health-sessions.ts`
- 🟡 `cli/program/register.subclis-core.ts`
- 🟡 `cli/program/register.subclis.ts`
- 🟡 `cli/program/register.transcripts.ts`
- 🟡 `cli/program/root-help.ts`
- 🟢 `cli/program/route-args.ts`
- 🟡 `cli/program/route-specs.ts`
- 🟢 `cli/program/routed-command-definitions.ts`
- 🟡 `cli/program/routes.ts`
- 🟡 `cli/proxy-cli.runtime.ts`
- 🟡 `cli/proxy-cli.ts`
- 🟡 `cli/qr-cli.ts`
- 🟢 `cli/requirements-test-fixtures.ts`
- 🟢 `cli/respawn-policy.ts`
- 🟡 `cli/root-help-live-config.ts`
- 🟡 `cli/root-help-metadata.ts`
- 🟡 `cli/root-option-forward.ts`
- 🟡 `cli/root-option-scan.ts`
- 🟡 `cli/root-option-value.ts`
- 🟡 `cli/route.ts`
- 🟢 `cli/run-main-policy.ts`
- 🟡 `cli/run-main.ts`
- 🟡 `cli/sandbox-cli.ts`
- 🟡 `cli/secrets-cli.ts`
- 🟡 `cli/security-cli.ts`
- 🟡 `cli/setup-onboard-configure-help-fast-path.ts`
- 🟡 `cli/shared/parse-port.ts`
- 🟡 `cli/skills-cli.format.ts`
- 🟡 `cli/skills-cli.ts`
- 🟡 `cli/startup-metadata.ts`
- 🟡 `cli/system-cli.ts`
- 🟡 `cli/tagline.ts`
- 🟡 `cli/tui-cli.ts`
- 🟡 `cli/update-cli.ts`
- 🟢 `cli/update-cli/plugin-payload-validation.ts`
- 🟢 `cli/update-cli/post-core-plugin-convergence.ts`
- 🟡 `cli/update-cli/progress.ts`
- 🟡 `cli/update-cli/restart-helper.ts`
- 🟡 `cli/update-cli/shared.ts`
- 🟡 `cli/update-cli/status.ts`
- 🟡 `cli/update-cli/suppress-deprecations.ts`
- 🟡 `cli/update-cli/update-command.ts`
- 🟡 `cli/update-cli/wizard.ts`
- 🟡 `cli/wait.ts`
- 🟡 `cli/webhooks-cli.ts`
- 🟡 `cli/windows-argv.ts`
- 🟡 `commands/agent-via-gateway.ts`
- 🟡 `commands/agent/session.ts`
- 🟢 `commands/agents.bind.test-support.ts`
- 🟡 `commands/agents.binding-format.ts`
- 🟡 `commands/agents.bindings.ts`
- 🟡 `commands/agents.command-shared.ts`
- 🟡 `commands/agents.commands.add.ts`
- 🟡 `commands/agents.commands.bind.ts`
- 🟡 `commands/agents.commands.delete.ts`
- 🟡 `commands/agents.commands.identity.ts`
- 🟡 `commands/agents.commands.list.ts`
- 🟢 `commands/agents.providers.ts`
- 🟡 `commands/auth-token.ts`
- 🟡 `commands/backup-shared.ts`
- 🟢 `commands/backup.test-support.ts`
- 🟡 `commands/channel-setup/channel-plugin-resolution.ts`
- 🟡 `commands/channel-setup/discovery.ts`
- 🟡 `commands/channel-setup/plugin-install.ts`
- 🟡 `commands/channel-setup/registry.ts`
- 🟡 `commands/channel-setup/trusted-catalog.ts`
- 🟡 `commands/channel-setup/types.ts`
- 🟡 `commands/channel-test-registry.ts`
- 🟢 `commands/channels.mock-harness.ts`
- 🟡 `commands/channels.ts`
- 🟡 `commands/channels/add-mutators.ts`
- 🟡 `commands/channels/add.ts`
- 🟡 `commands/channels/capabilities.ts`
- 🟡 `commands/channels/list.ts`
- 🟡 `commands/channels/logs.ts`
- 🟡 `commands/channels/remove.ts`
- 🟡 `commands/channels/resolve.ts`
- 🟡 `commands/channels/runtime-label.ts`
- 🟡 `commands/channels/shared.ts`
- 🟡 `commands/channels/status-config-format.ts`
- 🟡 `commands/channels/status.ts`
- 🟡 `commands/chutes-oauth.ts`
- 🟢 `commands/cleanup-command.test-support.ts`
- 🟡 `commands/cleanup-plan.ts`
- 🟡 `commands/commitments.ts`
- 🟢 `commands/config-validation.ts`
- 🟡 `commands/configure.channels.ts`
- 🟡 `commands/configure.commands.ts`
- 🟡 `commands/configure.daemon.ts`
- 🟡 `commands/configure.gateway-auth.ts`
- 🟡 `commands/configure.gateway.ts`
- 🟡 `commands/configure.shared.ts`
- 🟡 `commands/configure.ts`
- 🟡 `commands/configure.wizard.ts`
- 🟡 `commands/daemon-install-auth-profiles-source.runtime.ts`
- 🟡 `commands/daemon-install-auth-profiles-store.runtime.ts`
- 🟡 `commands/daemon-install-helpers.ts`
- 🟡 `commands/daemon-install-plan.shared.ts`
- 🟡 `commands/daemon-install-runtime-warning.ts`
- 🟡 `commands/dashboard.ts`
- 🟡 `commands/docs.ts`
- 🟡 `commands/doctor-auth-flat-profiles.ts`
- 🟡 `commands/doctor-auth-legacy-oauth.ts`
- 🟡 `commands/doctor-auth-oauth-sidecar.ts`
- 🟡 `commands/doctor-auth-profile-config.ts`
- 🟡 `commands/doctor-auth.ts`
- 🟡 `commands/doctor-bootstrap-size.ts`
- 🟡 `commands/doctor-browser.ts`
- 🟡 `commands/doctor-claude-cli.ts`
- 🟡 `commands/doctor-command-owner.ts`
- 🟡 `commands/doctor-config-analysis.ts`
- 🟡 `commands/doctor-config-audit-scrub.ts`
- 🟢 `commands/doctor-config-flow.test-utils.ts`
- 🟡 `commands/doctor-config-flow.ts`
- 🟡 `commands/doctor-config-preflight.ts`
- 🟡 `commands/doctor-cron.ts`
- 🟡 `commands/doctor-device-pairing.ts`
- 🟡 `commands/doctor-disk-space.ts`
- 🟡 `commands/doctor-format.ts`
- 🟡 `commands/doctor-gateway-auth-token.ts`
- 🟡 `commands/doctor-gateway-daemon-flow.ts`
- 🟡 `commands/doctor-gateway-health.ts`
- 🟡 `commands/doctor-gateway-services.ts`
- 🟡 `commands/doctor-heartbeat-main-session-repair.ts`
- 🟡 `commands/doctor-heartbeat-session-target.ts`
- 🟡 `commands/doctor-heartbeat-template-repair.ts`
- 🟡 `commands/doctor-install-policy.ts`
- 🟡 `commands/doctor-install.ts`
- 🟡 `commands/doctor-legacy-config.ts`
- 🟡 `commands/doctor-lint.ts`
- 🟡 `commands/doctor-memory-search.ts`
- 🟡 `commands/doctor-platform-notes.ts`
- 🟡 `commands/doctor-plugin-manifests.ts`
- 🟡 `commands/doctor-plugin-registry.ts`
- 🟡 `commands/doctor-post-upgrade.ts`
- 🟢 `commands/doctor-post-upgrade.types.ts`
- 🟡 `commands/doctor-repair-mode.ts`
- 🟡 `commands/doctor-sandbox.ts`
- 🟡 `commands/doctor-security.ts`
- 🟢 `commands/doctor-service-repair-policy.ts`
- 🟡 `commands/doctor-session-locks.ts`
- 🟡 `commands/doctor-session-snapshots.ts`
- 🟡 `commands/doctor-session-state-providers.ts`
- 🟡 `commands/doctor-session-transcripts.ts`
- 🟡 `commands/doctor-skills-core.ts`
- 🟡 `commands/doctor-skills.ts`
- 🟡 `commands/doctor-state-integrity.ts`
- 🟡 `commands/doctor-state-migrations.ts`
- 🟡 `commands/doctor-ui.ts`
- 🟡 `commands/doctor-update.ts`
- 🟡 `commands/doctor-whatsapp-responsiveness.ts`
- 🟡 `commands/doctor-workspace-status.ts`
- 🟡 `commands/doctor-workspace.ts`
- 🟢 `commands/doctor.e2e-harness.ts`
- 🟡 `commands/doctor.ts`
- 🟡 `commands/doctor/channel-capabilities.ts`
- 🟢 `commands/doctor/cron/dreaming-payload-migration.ts`
- 🟡 `commands/doctor/cron/index.ts`
- 🟡 `commands/doctor/cron/legacy-delivery.ts`
- 🟡 `commands/doctor/cron/legacy-notify.ts`
- 🟢 `commands/doctor/cron/legacy-run-log-migration.ts`
- 🟢 `commands/doctor/cron/legacy-store-migration.ts`
- 🟢 `commands/doctor/cron/payload-migration.ts`
- 🟢 `commands/doctor/cron/repair-plan.ts`
- 🟡 `commands/doctor/cron/store-migration.ts`
- 🟡 `commands/doctor/cron/warnings.ts`
- 🟡 `commands/doctor/emit-notes.ts`
- 🟡 `commands/doctor/finalize-config-flow.ts`
- 🟡 `commands/doctor/legacy-config-repair.ts`
- 🟡 `commands/doctor/repair-sequencing.ts`
- 🟡 `commands/doctor/shared/active-tool-schema-warnings.ts`
- 🟡 `commands/doctor/shared/allow-from-mode.ts`
- 🟡 `commands/doctor/shared/allow-from-mode.types.ts`
- 🟡 `commands/doctor/shared/allowfrom-fallback-migration.ts`
- 🟡 `commands/doctor/shared/allowlist-policy-repair.ts`
- 🟡 `commands/doctor/shared/allowlist.ts`
- 🟡 `commands/doctor/shared/bundled-plugin-load-paths.ts`
- 🟡 `commands/doctor/shared/channel-doctor.ts`
- 🟡 `commands/doctor/shared/channel-legacy-config-migrate.ts`
- 🟡 `commands/doctor/shared/channel-plugin-blockers.ts`
- 🟡 `commands/doctor/shared/codex-native-assets.ts`
- 🟡 `commands/doctor/shared/codex-route-warnings.ts`
- 🟢 `commands/doctor/shared/config-flow-steps.ts`
- 🟡 `commands/doctor/shared/config-mutation-state.ts`
- 🟢 `commands/doctor/shared/configured-runtime-plugin-installs.ts`
- 🟡 `commands/doctor/shared/context-engine-host-compat.ts`
- 🟢 `commands/doctor/shared/default-account-warnings.ts`
- 🟢 `commands/doctor/shared/deprecation-compat.ts`
- 🟡 `commands/doctor/shared/empty-allowlist-policy.ts`
- 🟡 `commands/doctor/shared/empty-allowlist-scan.ts`
- 🟡 `commands/doctor/shared/exec-safe-bins.ts`
- 🟡 `commands/doctor/shared/hooks-token-reuse-repair.ts`
- 🟡 `commands/doctor/shared/invalid-plugin-config.ts`
- 🟡 `commands/doctor/shared/legacy-config-compat.ts`
- 🟡 `commands/doctor/shared/legacy-config-compatibility-base.ts`
- 🟡 `commands/doctor/shared/legacy-config-core-migrate.ts`
- 🟢 `commands/doctor/shared/legacy-config-core-normalizers.ts`
- 🟡 `commands/doctor/shared/legacy-config-migrate.ts`
- 🟢 `commands/doctor/shared/legacy-oauth-sidecar.ts`
- 🟡 `commands/doctor/shared/legacy-talk-config-normalizer.ts`
- 🟡 `commands/doctor/shared/legacy-tools-by-sender.ts`
- 🟡 `commands/doctor/shared/legacy-web-fetch-migrate.ts`
- 🟡 `commands/doctor/shared/legacy-web-search-migrate.ts`
- 🟡 `commands/doctor/shared/missing-configured-plugin-install.ts`
- 🟡 `commands/doctor/shared/object.ts`
- 🟡 `commands/doctor/shared/open-policy-allowfrom.ts`
- 🟡 `commands/doctor/shared/plugin-dependency-cleanup.ts`
- 🟢 `commands/doctor/shared/plugin-registry-migration.ts`
- 🟡 `commands/doctor/shared/plugin-runtime-symlinks.ts`
- 🟡 `commands/doctor/shared/plugin-tool-allowlist-warnings.ts`
- 🟡 `commands/doctor/shared/preview-warnings.ts`
- 🟡 `commands/doctor/shared/release-configured-plugin-installs.ts`
- 🟡 `commands/doctor/shared/stale-oauth-profile-shadows.ts`
- 🟡 `commands/doctor/shared/stale-plugin-config.ts`
- 🟡 `commands/doctor/shared/stale-subagent-allowlist.ts`
- 🟡 `commands/doctor/shared/update-phase.ts`
- 🟡 `commands/doctor/types.ts`
- 🟡 `commands/export-trajectory.ts`
- 🟡 `commands/flows.ts`
- 🟡 `commands/gateway-health-auth-diagnostic.ts`
- 🟢 `commands/gateway-install-token.persist.runtime.ts`
- 🟡 `commands/gateway-readiness.ts`
- 🟡 `commands/gateway-status.ts`
- 🟡 `commands/gateway-status/discovery.ts`
- 🟢 `commands/gateway-status/output.ts`
- 🟡 `commands/gateway-status/probe-run.ts`
- 🟡 `commands/message-format.ts`
- 🟡 `commands/message.ts`
- 🟡 `commands/model-picker.runtime.ts`
- 🟡 `commands/models/aliases.ts`
- 🟡 `commands/models/auth-list.ts`
- 🟡 `commands/models/auth-order.ts`
- 🟡 `commands/models/auth.ts`
- 🟢 `commands/models/fallbacks-shared.ts`
- 🟡 `commands/models/fallbacks.ts`
- 🟡 `commands/models/image-fallbacks.ts`
- 🟡 `commands/models/list.auth-index.ts`
- 🟡 `commands/models/list.auth-overview.ts`
- 🟡 `commands/models/list.configured.ts`
- 🟡 `commands/models/list.errors.ts`
- 🟡 `commands/models/list.format.ts`
- 🟡 `commands/models/list.list-command.ts`
- 🟡 `commands/models/list.manifest-catalog.ts`
- 🟡 `commands/models/list.model-row.ts`
- 🟡 `commands/models/list.probe.ts`
- 🟡 `commands/models/list.provider-catalog.ts`
- 🟡 `commands/models/list.provider-index-catalog.ts`
- 🟡 `commands/models/list.registry-load.ts`
- 🟡 `commands/models/list.registry.ts`
- 🟡 `commands/models/list.row-sources.ts`
- 🟢 `commands/models/list.rows.ts`
- 🟡 `commands/models/list.source-plan.ts`
- 🟡 `commands/models/list.status-command.ts`
- 🟡 `commands/models/list.table.ts`
- 🟡 `commands/models/list.types.ts`
- 🟢 `commands/models/load-config.runtime.ts`
- 🟡 `commands/models/load-config.ts`
- 🟡 `commands/models/scan.ts`
- 🟡 `commands/models/set-image.ts`
- 🟡 `commands/models/set.ts`
- 🟡 `commands/node-daemon-install-helpers.ts`
- 🟡 `commands/node-daemon-runtime.ts`
- 🟡 `commands/non-interactive-prompter.ts`
- 🟡 `commands/oauth-env.ts`
- 🟡 `commands/oauth-tls-preflight.ts`
- 🟡 `commands/onboard-core-auth-flags.ts`
- 🟢 `commands/onboard-custom-config.ts`
- 🟡 `commands/onboard-interactive.ts`
- 🟡 `commands/onboard-non-interactive.ts`
- 🟡 `commands/onboard-non-interactive/api-keys.ts`
- 🟡 `commands/onboard-non-interactive/config-write.ts`
- 🟡 `commands/onboard-non-interactive/local.ts`
- 🟡 `commands/onboard-non-interactive/local/auth-choice-inference.ts`
- 🟡 `commands/onboard-non-interactive/local/auth-choice.plugin-providers.runtime.ts`
- 🟡 `commands/onboard-non-interactive/local/auth-choice.plugin-providers.ts`
- 🟡 `commands/onboard-non-interactive/local/auth-choice.ts`
- 🟡 `commands/onboard-non-interactive/local/daemon-install.ts`
- 🟡 `commands/onboard-non-interactive/local/gateway-config.ts`
- 🟢 `commands/onboard-non-interactive/local/output.ts`
- 🟡 `commands/onboard-non-interactive/local/skills-config.ts`
- 🟡 `commands/onboard-non-interactive/local/workspace.ts`
- 🟡 `commands/onboard-non-interactive/remote.ts`
- 🟡 `commands/onboard.ts`
- 🟡 `commands/reset.ts`
- 🟢 `commands/runtime-plugin-install.ts`
- 🟢 `commands/sandbox-display.ts`
- 🟡 `commands/sandbox-explain.ts`
- 🟡 `commands/sandbox-formatters.ts`
- 🟡 `commands/sandbox.ts`
- 🟡 `commands/session-store-targets.ts`
- 🟡 `commands/sessions-cleanup.ts`
- 🟡 `commands/sessions-display-model.ts`
- 🟢 `commands/sessions-table.ts`
- 🟡 `commands/sessions-tail.ts`
- 🟡 `commands/sessions.ts`
- 🟡 `commands/setup.ts`
- 🟡 `commands/status-all/channels-table.ts`
- 🟢 `commands/status-all/channels-token-summary.ts`
- 🟢 `commands/status-all/report-sections.ts`
- 🟢 `commands/status-all/report-tables.ts`
- 🟡 `commands/status-json.ts`
- 🟢 `commands/status-overview-values.ts`
- 🟢 `commands/status.command-sections.ts`
- 🟢 `commands/status.scan.bootstrap-shared.ts`
- 🟢 `commands/status.test-support.ts`
- 🟢 `commands/tasks-audit-system.ts`
- 🟡 `commands/tasks-json.ts`
- 🟡 `commands/tasks.ts`
- 🟡 `commands/uninstall.ts`
- 🟢 `tui/tui-last-session.ts`
- 🟢 `tui/tui-submit.ts`
- 🟡 `wizard/clack-prompter.ts`
- 🟢 `wizard/setup.security-note.ts`

### Do not delete before extraction: 🔴 required

- 🔴 `cli/argv.ts`
- 🔴 `cli/cli-name.ts`
- 🔴 `cli/command-config-resolution.runtime.ts`
- 🔴 `cli/command-config-resolution.ts`
- 🔴 `cli/command-format.ts`
- 🔴 `cli/command-secret-gateway.ts`
- 🔴 `cli/command-secret-targets.ts`
- 🔴 `cli/daemon-cli/probe.ts`
- 🔴 `cli/deps.ts`
- 🔴 `cli/deps.types.ts`
- 🔴 `cli/error-format.ts`
- 🔴 `cli/message-secret-scope.ts`
- 🔴 `cli/npm-resolution.ts`
- 🔴 `cli/outbound-send-deps.ts`
- 🔴 `cli/outbound-send-mapping.ts`
- 🔴 `cli/parse-bytes.ts`
- 🔴 `cli/parse-duration.ts`
- 🔴 `cli/parse-timeout.ts`
- 🔴 `cli/plugin-install-plan.ts`
- 🔴 `cli/plugins-install-persist.ts`
- 🔴 `cli/plugins-install-record-commit.ts`
- 🔴 `cli/plugins-registry-refresh.ts`
- 🔴 `cli/profile-utils.ts`
- 🔴 `cli/program/command-descriptor-utils.ts`
- 🔴 `cli/program/command-group-descriptors.ts`
- 🔴 `cli/program/core-command-descriptors.ts`
- 🔴 `cli/program/private-qa-cli.ts`
- 🔴 `cli/program/subcli-descriptors.ts`
- 🔴 `cli/progress.ts`
- 🔴 `cli/prompt.ts`
- 🔴 `cli/send-runtime/channel-outbound-send.ts`
- 🔴 `commands/agent.ts`
- 🔴 `commands/agents.config.ts`
- 🔴 `commands/auth-choice-legacy.ts`
- 🔴 `commands/auth-choice-options.static.ts`
- 🔴 `commands/auth-choice-options.ts`
- 🔴 `commands/auth-choice-prompt.ts`
- 🔴 `commands/auth-choice.apply-helpers.ts`
- 🔴 `commands/auth-choice.apply.api-providers.ts`
- 🔴 `commands/auth-choice.apply.ts`
- 🔴 `commands/auth-choice.apply.types.ts`
- 🔴 `commands/auth-choice.model-check.ts`
- 🔴 `commands/auth-choice.preferred-provider.ts`
- 🔴 `commands/auth-choice.ts`
- 🔴 `commands/backup-verify.ts`
- 🔴 `commands/backup.ts`
- 🔴 `commands/channel-account-context.ts`
- 🔴 `commands/cleanup-utils.ts`
- 🔴 `commands/codex-runtime-plugin-install.ts`
- 🔴 `commands/copilot-runtime-plugin-install.ts`
- 🔴 `commands/daemon-runtime.ts`
- 🔴 `commands/doctor-completion.ts`
- 🔴 `commands/doctor-prompter.ts`
- 🔴 `commands/doctor.types.ts`
- 🔴 `commands/doctor/shared/legacy-config-issues.ts`
- 🔴 `commands/doctor/shared/legacy-config-migrations.audio.ts`
- 🔴 `commands/doctor/shared/legacy-config-migrations.channels.ts`
- 🔴 `commands/doctor/shared/legacy-config-migrations.queue.ts`
- 🔴 `commands/doctor/shared/legacy-config-migrations.runtime.agents.ts`
- 🔴 `commands/doctor/shared/legacy-config-migrations.runtime.diagnostics.ts`
- 🔴 `commands/doctor/shared/legacy-config-migrations.runtime.gateway.ts`
- 🔴 `commands/doctor/shared/legacy-config-migrations.runtime.mcp.ts`
- 🔴 `commands/doctor/shared/legacy-config-migrations.runtime.models.ts`
- 🔴 `commands/doctor/shared/legacy-config-migrations.runtime.providers.ts`
- 🔴 `commands/doctor/shared/legacy-config-migrations.runtime.session.ts`
- 🔴 `commands/doctor/shared/legacy-config-migrations.runtime.ts`
- 🔴 `commands/doctor/shared/legacy-config-migrations.runtime.tts.ts`
- 🔴 `commands/doctor/shared/legacy-config-migrations.ts`
- 🔴 `commands/doctor/shared/legacy-config-migrations.web-search.ts`
- 🔴 `commands/doctor/shared/legacy-config-record-shared.ts`
- 🔴 `commands/doctor/shared/legacy-config-rules.ts`
- 🔴 `commands/doctor/shared/legacy-models-add-metadata.ts`
- 🔴 `commands/doctor/shared/legacy-runtime-model-providers.ts`
- 🔴 `commands/doctor/shared/legacy-x-search-migrate.ts`
- 🔴 `commands/gateway-install-token.ts`
- 🔴 `commands/gateway-presence.ts`
- 🔴 `commands/gateway-status/helpers.ts`
- 🔴 `commands/health-format.ts`
- 🔴 `commands/health.ts`
- 🔴 `commands/health.types.ts`
- 🔴 `commands/migrate.ts`
- 🔴 `commands/migrate/apply.ts`
- 🔴 `commands/migrate/context.ts`
- 🔴 `commands/migrate/output.ts`
- 🔴 `commands/migrate/providers.ts`
- 🔴 `commands/migrate/selection.ts`
- 🔴 `commands/migrate/skill-selection-prompt.ts`
- 🔴 `commands/migrate/types.ts`
- 🔴 `commands/model-picker.ts`
- 🔴 `commands/models/alias-name.ts`
- 🔴 `commands/models/list.local-url.ts`
- 🔴 `commands/models/provider-aliases.ts`
- 🔴 `commands/models/shared.ts`
- 🔴 `commands/onboard-channels.ts`
- 🔴 `commands/onboard-config.ts`
- 🔴 `commands/onboard-custom.ts`
- 🔴 `commands/onboard-helpers.ts`
- 🔴 `commands/onboard-hooks.ts`
- 🔴 `commands/onboard-remote.ts`
- 🔴 `commands/onboard-search.ts`
- 🔴 `commands/onboard-skills.ts`
- 🔴 `commands/onboard-types.ts`
- 🔴 `commands/onboarding-plugin-install.ts`
- 🔴 `commands/random-token.ts`
- 🔴 `commands/session-state-migration.ts`
- 🔴 `commands/status-all.ts`
- 🔴 `commands/status-all/channel-issues.ts`
- 🔴 `commands/status-all/channels.ts`
- 🔴 `commands/status-all/diagnosis.ts`
- 🔴 `commands/status-all/format.ts`
- 🔴 `commands/status-all/gateway.ts`
- 🔴 `commands/status-all/report-data.ts`
- 🔴 `commands/status-all/report-lines.ts`
- 🔴 `commands/status-all/text-report.ts`
- 🔴 `commands/status-json-command.ts`
- 🔴 `commands/status-json-payload.ts`
- 🔴 `commands/status-json-runtime.ts`
- 🔴 `commands/status-overview-rows.ts`
- 🔴 `commands/status-overview-surface.ts`
- 🔴 `commands/status-runtime-shared.ts`
- 🔴 `commands/status-update-restart.ts`
- 🔴 `commands/status.agent-local.ts`
- 🔴 `commands/status.command-report-data.ts`
- 🔴 `commands/status.command-report.ts`
- 🔴 `commands/status.command.text-runtime.ts`
- 🔴 `commands/status.command.ts`
- 🔴 `commands/status.daemon.ts`
- 🔴 `commands/status.format.ts`
- 🔴 `commands/status.gateway-connection.ts`
- 🔴 `commands/status.gateway-probe.ts`
- 🔴 `commands/status.link-channel.ts`
- 🔴 `commands/status.node-mode.ts`
- 🔴 `commands/status.scan-execute.ts`
- 🔴 `commands/status.scan-memory.ts`
- 🔴 `commands/status.scan-overview.ts`
- 🔴 `commands/status.scan-result.ts`
- 🔴 `commands/status.scan.config-shared.ts`
- 🔴 `commands/status.scan.deps.runtime.ts`
- 🔴 `commands/status.scan.fast-json.ts`
- 🔴 `commands/status.scan.runtime.ts`
- 🔴 `commands/status.scan.shared.ts`
- 🔴 `commands/status.scan.ts`
- 🔴 `commands/status.service-summary.ts`
- 🔴 `commands/status.summary.runtime.ts`
- 🔴 `commands/status.summary.ts`
- 🔴 `commands/status.ts`
- 🔴 `commands/status.types.ts`
- 🔴 `commands/status.update.ts`
- 🔴 `commands/systemd-linger.ts`
- 🔴 `commands/text-format.ts`
- 🔴 `tui/commands.ts`
- 🔴 `tui/components/assistant-message.ts`
- 🔴 `tui/components/btw-inline-message.ts`
- 🔴 `tui/components/chat-log.ts`
- 🔴 `tui/components/custom-editor.ts`
- 🔴 `tui/components/filterable-select-list.ts`
- 🔴 `tui/components/fuzzy-filter.ts`
- 🔴 `tui/components/hyperlink-markdown.ts`
- 🔴 `tui/components/markdown-message.ts`
- 🔴 `tui/components/searchable-select-list.ts`
- 🔴 `tui/components/selectors.ts`
- 🔴 `tui/components/tool-execution.ts`
- 🔴 `tui/components/user-message.ts`
- 🔴 `tui/embedded-backend.ts`
- 🔴 `tui/gateway-chat.ts`
- 🔴 `tui/local-run-shutdown.ts`
- 🔴 `tui/osc8-hyperlinks.ts`
- 🔴 `tui/setup-launch-env.ts`
- 🔴 `tui/theme/theme.ts`
- 🔴 `tui/tui-backend.ts`
- 🔴 `tui/tui-command-handlers.ts`
- 🔴 `tui/tui-event-handlers.ts`
- 🔴 `tui/tui-formatters.ts`
- 🔴 `tui/tui-launch.ts`
- 🔴 `tui/tui-local-shell.ts`
- 🔴 `tui/tui-overlays.ts`
- 🔴 `tui/tui-session-actions.ts`
- 🔴 `tui/tui-session-list-policy.ts`
- 🔴 `tui/tui-status-summary.ts`
- 🔴 `tui/tui-stream-assembler.ts`
- 🔴 `tui/tui-types.ts`
- 🔴 `tui/tui-waiting.ts`
- 🔴 `tui/tui.ts`
- 🔴 `wizard/i18n/index.ts`
- 🔴 `wizard/i18n/locales/en.ts`
- 🔴 `wizard/i18n/locales/zh-CN.ts`
- 🔴 `wizard/i18n/locales/zh-TW.ts`
- 🔴 `wizard/i18n/types.ts`
- 🔴 `wizard/prompts.ts`
- 🔴 `wizard/session.ts`
- 🔴 `wizard/setup.completion.ts`
- 🔴 `wizard/setup.finalize.ts`
- 🔴 `wizard/setup.gateway-config.ts`
- 🔴 `wizard/setup.migration-import.ts`
- 🔴 `wizard/setup.official-plugins.ts`
- 🔴 `wizard/setup.plugin-config.ts`
- 🔴 `wizard/setup.post-install-migration.ts`
- 🔴 `wizard/setup.secret-input.ts`
- 🔴 `wizard/setup.ts`
- 🔴 `wizard/setup.types.ts`

## 7. 风险与未解决问题

- Static import graph includes literal dynamic imports, but cannot prove runtime method reachability. `commands.list` and `wizard.*` are advertised gateway methods today; removing them is a protocol/product decision.
- `GatewayServerOptions.wizardRunner` references `commands/onboard-types.ts` and `wizard/prompts.ts` from an exported type surface; removing those needs API/type cleanup.
- `src/gateway/server.impl.ts:130` calls `ensureOpenClawCliOnPath()`, so minimal entry still depends on CLI executable path behavior indirectly. Needs runtime verification after pruning.
- `--allow-unconfigured` currently exists only in CLI preflight. P4-B must decide whether ClawX source runtime relies on pre-created `gateway.mode=local` or needs a tiny equivalent guard/override.
- Tests, docs, generated help metadata, package exports, build inputs, and snapshots were not included in the runtime source import graph. Run package/type/build validation before deleting.
