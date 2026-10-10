---
lifecycleStatus: archived
id: fix-sandbox-windows-wsl-docker-paths
title: Translate sandbox bind sources for Windows clients talking to a Linux Docker daemon
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Make Docker sandboxing work on Windows hosts whose Docker daemon runs in WSL2 (or another Linux daemon reached over DOCKER_HOST) by translating Windows bind sources into the WSL2 mount namespace before container creation.
touchedAreas:
  - harness/specs/tasks/fix-sandbox-windows-wsl-docker-paths.md
  - openclaw_runtime/src/agents/sandbox/wsl-path.ts
  - openclaw_runtime/src/agents/sandbox/wsl-path.test.ts
  - openclaw_runtime/src/agents/sandbox/workspace-mounts.ts
  - openclaw_runtime/src/agents/sandbox/workspace-mounts.test.ts
  - openclaw_runtime/src/agents/sandbox/docker.ts
  - openclaw_runtime/src/agents/sandbox/browser.ts
  - openclaw_runtime/src/agents/sandbox/validate-sandbox-security.ts
expectedUserBehavior:
  - On Windows with DOCKER_HOST pointing at a Linux daemon (WSL2/remote), sandbox workspace, agent workspace, skill, and custom binds are created with translated Linux paths instead of failing with `invalid volume specification 'C:\...:/workspace:z'`.
  - On Windows with the local named-pipe daemon, and on macOS/Linux, bind sources are emitted exactly as before.
  - Sandbox security validation and config hashing continue to use the original host paths, so blocking and hash decisions are unchanged.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - docs-sync
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/fix-sandbox-windows-wsl-docker-paths.md
  - pnpm harness validate --spec harness/specs/tasks/fix-sandbox-windows-wsl-docker-paths.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-support.config.ts src/agents/sandbox/wsl-path.test.ts src/agents/sandbox/workspace-mounts.test.ts
  - pnpm --dir openclaw_runtime tsgo:core
acceptance:
  - A Windows drive path (`C:\Users\...\workspace`) is translated to `/mnt/c/Users/.../workspace` only when the client platform is win32 and DOCKER_HOST targets a non-named-pipe daemon.
  - A `\\wsl$\<distro>\...` share path is translated to its POSIX form by stripping the share prefix.
  - Workspace, agent workspace, read-only skill, and configured custom binds all flow through the translator when it applies, and are unchanged otherwise.
  - Security validation and the sandbox config hash still operate on original host paths.
docs:
  required: true
  note: Document that Docker sandboxing now supports Windows hosts talking to a WSL2/remote Linux daemon, and that bind sources are translated to the WSL2 mount namespace automatically.
---
