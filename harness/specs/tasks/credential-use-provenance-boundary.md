---
lifecycleStatus: archived
id: credential-use-provenance-boundary
title: Credential-use provenance boundary for image provider overrides
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Consume the existing ContentProvenance sidecar at one bounded credential-use surface: explicit cross-provider model overrides in the agent image_generate tool, without changing configured defaults, automatic fallback, or normal model authentication.
touchedAreas:
  - harness/specs/tasks/credential-use-provenance-boundary.md
  - shared/security/content-provenance.ts
  - openclaw_runtime/src/agents/agent-tools.ts
  - openclaw_runtime/src/agents/openclaw-tools.ts
  - openclaw_runtime/src/agents/image-generate-provenance-wiring.test.ts
  - openclaw_runtime/src/agents/tools/image-generate-tool.ts
  - openclaw_runtime/src/agents/tools/provider-credential-use-policy.ts
  - openclaw_runtime/src/agents/tools/provider-credential-use-policy.test.ts
  - openclaw_runtime/src/agents/tools/image-generate-tool.credential-use-provenance.test.ts
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
requiredTests:
  - openclaw_runtime/src/agents/tools/provider-credential-use-policy.test.ts
  - openclaw_runtime/src/agents/tools/image-generate-tool.credential-use-provenance.test.ts
  - openclaw_runtime/src/agents/image-generate-provenance-wiring.test.ts
  - openclaw_runtime/src/agents/tools/message-secret-read-policy.test.ts
  - openclaw_runtime/src/agents/tools/message-tool.provenance.test.ts
  - openclaw_runtime/src/agents/exec-provenance-policy.test.ts
  - openclaw_runtime/src/agents/exec-defaults.test.ts
acceptance:
  - The existing ContentProvenance contract remains the only source/trust enum definition.
  - The centralized credential-use classification records this task's policy as a `narrow` enforcement point; broader credential-use coverage is still not claimed and this task enforces only the bounded image_generate provider-override path.
  - Calls without an explicit model override keep the configured primary provider and automatic fallback behavior unchanged.
  - Same-provider model overrides remain usable for untrusted, derived-untrusted, missing, or invalid provenance.
  - Providers explicitly named by the operator in agents.defaults.imageGenerationModel primary or fallbacks remain usable.
  - When no explicit image-generation model config exists, the resolved default primary provider remains usable.
  - Untrusted, derived-untrusted, missing, or invalid provenance cannot explicitly switch image_generate to a different provider merely because credentials for that provider are discoverable.
  - Trusted system and direct operator provenance retain the existing explicit provider/model override behavior.
  - The source-dependent decision runs before image provider credential resolution or provider execution and never receives or reports credential values; auth-aware availability discovery may already have performed read-only configured-state checks used to preserve the resolved default provider.
  - image_generate list/status actions, provider discovery, availability checks, duplicate guards, remote-media SSRF policy, generated-media delivery, and configured automatic fallback remain unchanged.
  - Existing command-exec defaults, explicit fullAccess behavior, message network-send, and message secret-read behavior remain unchanged.
  - No blanket approval, prompt rewrite, global taint engine, regex injection classifier, config field, dependency, or provider shutdown is introduced.
expectedUserBehavior:
  - Normal image generation continues to use the operator-selected default provider and configured fallbacks.
  - External or unknown content cannot silently select a different provider credential through the image_generate model argument.
  - A direct operator request can still choose an available provider/model explicitly.
docs:
  required: false
  note: This is a narrow runtime policy refinement using existing configuration and provenance metadata; it adds no user-visible setting and does not claim complete credential-use enforcement.
---

# Implementation contract

The image generation tool resolves its default model scope using existing,
read-only auth-aware availability checks, then resolves an explicit `model`
argument before provider request credential lookup and provider execution.
This task inserts one pure, source-dependent provider decision at that boundary.
The decision compares the resolved requested provider with host-owned operator
configuration and the authoritative provenance parser; it never inspects prompt
text or credential values.

For external, derived-external, missing, or invalid provenance, an explicit
model override may stay on the configured provider set but may not switch to a
credential-bearing provider discovered only from runtime availability. Direct
operator and trusted system sources preserve current override behavior. Other
model-backed tools, automatic provider fallback, general model authentication,
MCP, browser credentials, and all non-image credential-use paths remain
explicit residual scope.
