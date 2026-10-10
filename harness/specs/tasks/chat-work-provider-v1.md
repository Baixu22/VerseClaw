---
lifecycleStatus: archived
id: chat-work-provider-v1
title: Chat work provider orchestration v1
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a Main-owned Work Provider orchestration layer for lightweight Office artifacts and explicitly configured Search/Research without changing permission or runtime tool policy.
touchedAreas:
  - shared/types/work-provider.ts
  - shared/types/work-mode.ts
  - shared/host-api/contract.ts
  - electron/services/work-providers-api.ts
  - electron/services/chat-api.ts
  - electron/main/ipc-handlers.ts
  - electron/utils/store.ts
  - src/lib/host-api.ts
  - src/stores/settings.ts
  - src/pages/Chat/**
  - src/components/chat/WorkModeSummaryPanel.tsx
  - shared/i18n/locales/**/chat.json
  - shared/i18n/locales/**/settings.json
  - tests/unit/work-provider.test.ts
  - tests/unit/work-providers-api.test.ts
  - tests/unit/host-api-facade.test.ts
  - tests/e2e/chat-work-mode.spec.ts
  - harness/specs/tasks/chat-work-provider-v1.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/clawx-design-overview.md
expectedUserBehavior:
  - Docs/Data mode shows Office provider capability status in the Chat work mode summary.
  - Work Kits resolve to provider capabilities rather than pretending to grant real runtime tools.
  - DOCX/XLSX/CSV/PPTX/PDF/HTML/Markdown operations run only through Main-owned host APIs.
  - Search remains missingConfig until the user explicitly configures a provider.
  - User-provided HTML or URL extraction returns source, citation, and brief-friendly Markdown without creating a new RAG or knowledge store.
  - Optional heavy providers such as LibreOffice, Pandoc, crawler, OCR, and dataframe runtimes remain disabled/unavailable interfaces unless explicitly configured.
  - Provider status and chat metadata do not change workspace permission mode, approval gates, sandbox policy, or OpenClaw tool allow/deny policy.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm run typecheck
  - tests/unit/work-provider.test.ts
  - tests/unit/work-providers-api.test.ts
  - tests/unit/host-api-facade.test.ts
  - tests/unit/work-mode.test.ts
  - tests/unit/work-mode-summary-panel.test.tsx
  - tests/e2e/chat-work-mode.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - WorkProviderRegistry defines provider kinds, install modes, statuses, capabilities, and Work Kit capability mapping.
  - workProviders.status returns provider, capability, kit capability, and summary status without renderer filesystem or Gateway access.
  - workProviders.run validates capability payloads and workspace paths in Main before reading, writing, fetching, or converting artifacts.
  - workProviders.validateArtifact checks file existence, workspace sandbox, artifact type, preview availability, and basic document details.
  - web.search does not issue network requests when provider config is missing.
  - web.extract can clean a user-provided HTML source into Markdown and citation metadata.
  - Chat send metadata includes provider capability summaries as untrusted hints only.
  - All new user-facing strings are covered in en, zh, ja, and ru locale files.
docs:
  required: true
---

Work Provider v1 keeps Work Mode focused on orchestration and status. Renderer reads state through `hostApi.workProviders`, Main owns execution and sandbox checks, and configured providers remain capability hints rather than runtime policy.

## Five-stage completion plan

This task is complete only when the Work Mode path stays lightweight while all five stages below are represented in code, docs, and validation.

1. **Model boundary**: Work Mode resolves `Mode -> Work Kit -> Provider Capability -> Work Provider`. Work Kits may keep legacy skill hints, but provider capabilities are the primary orchestration contract. Skill, MCP, plugin, built-in library, external service, custom HTTP, and external binary adapters must fit behind the same provider-source model.
2. **Office artifact workflow**: DOCX, XLSX, CSV, PPTX, PDF, Markdown, and HTML are handled through Main-owned provider APIs for read/write/validate/preview-friendly outputs. Renderer surfaces must not access the filesystem directly.
3. **Search and research workflow**: URL/HTML extraction works without search configuration; web search remains `missingConfig` and makes no network request until a user explicitly configures Tavily, Brave, Bing, SearXNG, or a Custom HTTP-compatible provider. Outputs remain source/citation/brief artifacts and do not create a new RAG or knowledge store.
4. **Optional provider interfaces**: LibreOffice, Pandoc, OCR, crawler, dataframe/Python stacks, Skill, MCP, plugin, and external-service connectors are exposed as optional provider/source types or status interfaces, not default bundled requirements.
5. **Frontend workflow surface**: Settings owns provider configuration, Chat owns mode and slash/workflow intent, the Work Mode panel owns lightweight capability status, and the Artifact Panel remains the delivery center for generated files.

## Five-stage validation

- Stage 1 evidence: unit tests cover Work Kit-to-provider capability mapping, provider source summaries, unknown provider/kit filtering, and chat metadata shape.
- Stage 2 evidence: unit/integration tests cover Main-owned `workProviders.run` and `validateArtifact` for workspace-bounded Office artifacts.
- Stage 3 evidence: tests prove missing search config does not call `fetch`, and HTML/URL extraction returns source/citation-friendly Markdown.
- Stage 4 evidence: provider registry exposes optional heavy provider/source statuses without auto-installing dependencies or changing runtime policy.
- Stage 5 evidence: Chat Work Mode E2E shows Docs/Data provider status and payload metadata while preserving host-api-only renderer boundaries.
