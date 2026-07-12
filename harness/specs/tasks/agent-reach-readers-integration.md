---
id: agent-reach-readers-integration
title: Agent Reach readers verbatim migration and Agent Browser adaptation
scenario: gateway-backend-communication
scenarios:
  - plugin-lifecycle-management
taskType: runtime-bridge
intent: Preserve the Agent Reach TypeScript shadow verbatim, then adapt it in place as a default-enabled read-only OpenClaw plugin with safe Agent Browser fallback.
touchedAreas:
  - harness/specs/tasks/agent-reach-readers-integration.md
  - harness/src/profiles.mjs
  - harness/specs/rules/reach-readers-upstream-integrity.md
  - harness/specs/rules/reach-readers-readonly-network-boundary.md
  - harness/specs/rules/reach-readers-credential-hygiene.md
  - openclaw_runtime/extensions/reach-readers/**
  - openclaw_runtime/src/plugin-sdk/**
  - openclaw_runtime/src/plugins/runtime/index.ts
  - openclaw_runtime/src/plugins/runtime/types.ts
  - openclaw_runtime/src/agents/tools/agent-browser-tool.ts
  - openclaw_runtime/src/agents/openclaw-tools.ts
  - openclaw_runtime/scripts/lib/plugin-sdk-entrypoints.json
  - openclaw_runtime/scripts/build-plugin-sdk-source-dts.mjs
  - openclaw_runtime/scripts/build-plugin-sdk-source-dts.test.mjs
  - openclaw_runtime/scripts/prepare-extension-package-boundary-artifacts.mjs
  - openclaw_runtime/package.json
  - openclaw_runtime/pnpm-lock.yaml
  - openclaw_runtime/pnpm-workspace.yaml
  - scripts/bundle-openclaw-plugins.mjs
  - tests/unit/reach-readers-*.test.ts
  - tests/unit/agent-browser-*.test.ts
  - tests/e2e/agent-reach-readers.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - .github/labeler.yml
expectedUserBehavior:
  - Nine stable read-only tools register by their original names and are available without manual plugin enablement.
  - Direct API or CLI readers remain first choice and Agent Browser is used only as the configured fallback.
  - Browser profile login state can be reused without exposing cookies, tokens, or complete request headers to logs, tool results, snapshots, or model context.
  - Twitter and Xiaohongshu return a structured browser login handoff instead of relying on brittle DOM scraping.
  - YouTube transcription reuses configured OpenClaw media-understanding providers while retaining the imported download, chunk, and fallback flow.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - reach-readers-upstream-integrity
  - reach-readers-readonly-network-boundary
  - reach-readers-credential-hygiene
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - capability-owner-resolution
  - active-config-guards
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/agent-reach-readers-integration.md
  - pnpm harness validate --spec harness/specs/tasks/agent-reach-readers-integration.md
  - pnpm harness run --spec harness/specs/tasks/agent-reach-readers-integration.md
  - node openclaw_runtime/scripts/run-vitest.mjs extensions/reach-readers
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run build:runtime
  - pnpm run bundle:openclaw-plugins
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/agent-reach-readers.spec.ts
acceptance:
  - The 22 imported files remain recoverable byte-for-byte from commit 07a658faa and UPSTREAM.md contains their verified SHA-256 manifest.
  - No duplicate or rewritten production implementation of the nine readers exists outside openclaw_runtime/extensions/reach-readers.
  - Adaptation patches preserve imported comments, function order, backend order, cleaners, probe classifications, and errors unless UPSTREAM.md records a tested runtime-contract difference.
  - Plugin config is read-only and never creates or writes ~/.agent-reach/config.json.
  - User-controlled URLs reject private network targets and redirect bypasses; fixed platform requests allow only declared official domains.
  - HTTP responses and command output are bounded, timed out, and cancellable.
  - Browser fallback preserves original backend diagnostics when unavailable and cleans up temporary headless sessions while retaining visible login sessions.
  - No cookie, token, SecretInput value, or complete authenticated request header appears in logs, tool results, snapshots, or model-visible content.
  - The plugin manifest declares all nine tools, startup activation, default enablement, and read-only behavior.
  - Package, runtime, harness, comms, smoke, and Electron E2E gates pass.
docs:
  required: true
---

# Agent Reach Readers Integration

## Import Contract

The source of record is `C:\Users\27933\Desktop\Agent-Reach-main\ts-shadow`.
The first import commit contains exactly the 22 non-generated files and excludes
`node_modules`. `UPSTREAM.md` is the permanent path and hash ledger. Production
adaptation happens only on those imported files plus narrowly required plugin,
SDK, test, packaging, skill, and documentation surfaces.

## Runtime Contract

The plugin is read-only, enabled by default, and registers:

- `web_read`
- `rss_read`
- `v2ex_read`
- `xueqiu_read`
- `bilibili_read`
- `youtube_read`
- `github_read`
- `twitter_read`
- `xiaohongshu_read`

Backend order is imported API/CLI behavior, then Agent Browser, then a
structured failure that retains the original diagnostics. The Browser bridge
uses the public Gateway contract and never accesses Electron, renderer state,
browser profile files, or cookie files directly.

## Configuration Contract

- `browserFallback`: `auto | handoff | off`, default `auto`
- `browserProfile`: default `default`
- `backends`: ordered overrides for Bilibili, Twitter, and Xiaohongshu
- `credentials.xueqiuCookie`: optional SecretInput
- `credentials.twitterAuthToken`: optional SecretInput
- `credentials.twitterCt0`: optional SecretInput

Configuration resolution order is plugin config, resolved SecretInput, then
environment variables. The plugin does not create or mutate Agent Reach config
files.

## Browser Handoff Contract

Twitter and Xiaohongshu authentication gaps return
`status: "browser_login_required"` with `profile`, `sessionId`, `loginUrl`, and
`retryTool`. The bundled Agent Reach skill uses that same session/profile with
`agent_browser`, lets the user complete login, and retries the original tool.
Visible handoff sessions remain open; temporary headless read sessions close
after use. Every invocation observes the tool cancellation signal.

## Adaptation Ledger Contract

Each behavior-changing commit updates `UPSTREAM.md` with any rename, move, or
intentional difference and is reviewed with `git diff --word-diff`. Imported
comments, backend order, cleaners, probe states, and error text are retained
unless a failing test demonstrates conflict with the supported OpenClaw
runtime contract.
