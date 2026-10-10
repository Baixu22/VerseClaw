---
id: workspace-external-write-provenance-boundary
title: Workspace external-write provenance boundary for coding tools
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add one bounded source-dependent check to runtime coding write, edit, and apply_patch calls when their resolved target is outside the current workspace, while preserving existing workspace guards, journal recovery, and ordinary in-workspace coding.
touchedAreas:
  - harness/specs/tasks/workspace-external-write-provenance-boundary.md
  - shared/security/content-provenance.ts
  - openclaw_runtime/src/agents/agent-tools.ts
  - openclaw_runtime/src/agents/agent-tools.read.ts
  - openclaw_runtime/src/agents/apply-patch-paths.ts
  - openclaw_runtime/src/agents/workspace-external-write-provenance-policy.ts
  - openclaw_runtime/src/agents/workspace-external-write-provenance-policy.test.ts
  - openclaw_runtime/src/agents/agent-tools.workspace-boundary.test.ts
  - openclaw_runtime/src/agents/apply-patch-consistency.test.ts
  - openclaw_runtime/src/agents/sessions/tools/write.test.ts
  - openclaw_runtime/src/agents/sessions/tools/edit.test.ts
  - tests/unit/external-content-provenance.test.ts
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
requiredTests:
  - openclaw_runtime/src/agents/workspace-external-write-provenance-policy.test.ts
  - openclaw_runtime/src/agents/agent-tools.workspace-boundary.test.ts
  - openclaw_runtime/src/agents/apply-patch-consistency.test.ts
  - openclaw_runtime/src/agents/sessions/tools/write.test.ts
  - openclaw_runtime/src/agents/sessions/tools/edit.test.ts
  - tests/unit/external-content-provenance.test.ts
acceptance:
  - The existing ContentProvenance contract remains the only source/trust enum definition.
  - The centralized external-write sink classification records this task's policy as a `narrow` enforcement point; broader external-write coverage is still not claimed and this task enforces only runtime coding targets outside the workspace.
  - The source-dependent decision applies only to runtime coding write, edit, and apply_patch targets that resolve outside the active workspace.
  - In-workspace writes remain usable for trusted, operator, untrusted, derived-untrusted, missing, and invalid provenance, subject to existing workspace guards and journal behavior.
  - Untrusted or derived-untrusted provenance cannot write to an external target before the filesystem operation starts.
  - Missing or invalid provenance is an explicit unknown state and fails closed for an external target, without blocking ordinary in-workspace writes.
  - Trusted system and direct operator provenance retain the existing external-target behavior, including existing workspaceOnly, path, journal, and operator-controlled full-access boundaries.
  - The policy receives only normalized provenance status and target scope; file content, patch text, and model-authored payload fields are not policy inputs or denial diagnostics.
  - Existing path normalization, symlink resolution, workspace root guards, write journal, stale-write, precondition, rollback, and partial-recovery semantics remain authoritative.
  - Malformed or pathless apply_patch input keeps its existing validation behavior; valid mutation targets must still be classified before mutation and malformed input cannot become an authorization bypass.
  - Ordinary read-only tools, web reading/search, managed browser use, command-exec defaults, explicit fullAccess command behavior, message sinks, and credential-use behavior remain unchanged.
  - No blanket human approval, new protocol, database, config field, dependency, prompt rewrite, regex injection classifier, or dynamic taint engine is introduced.
  - This task does not implement the complete VerseShell TF-0068 external-write UI or unlock its TF-0067 dependency.
expectedUserBehavior:
  - Normal coding reads and in-workspace writes continue to work regardless of provenance state.
  - External or unknown content cannot silently redirect a coding write, edit, or patch outside the active workspace.
  - Direct operator or trusted system requests retain the existing explicitly controlled external-write path.
docs:
  required: false
  note: This is a narrow runtime authorization refinement with no new renderer or settings flow.
---

# Implementation contract

The existing coding tools already normalize paths and enforce workspace and
journal boundaries. This task adds one pure policy decision after the existing
target scope is known and before `write`, `edit`, or `apply_patch` performs a
filesystem mutation. The policy is monotonic: external or unknown provenance
can narrow an external target, but cannot widen any existing path or approval
boundary.

The policy must reuse existing path extraction and resolution. For a patch with
multiple targets, every target must be in the active workspace for an external
or unknown source. Valid patch targets are classified before mutation; an
unrecognized envelope is handed to the existing strict parser so its current
validation error remains authoritative. Trusted and operator sources keep the
current path/journal behavior. This is a single sink slice, not a complete
external-write policy or a dynamic taint engine.
