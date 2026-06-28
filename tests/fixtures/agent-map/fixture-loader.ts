import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentMapRequest,
  AgentMapSourceFile,
} from "../../../openclaw_runtime/src/runtime-core";
import { buildAgentMapRequestFixture } from "../../../openclaw_runtime/src/runtime-core";

export const AGENT_MAP_FIXTURE_ROOT = join(
  process.cwd(),
  "tests",
  "fixtures",
  "agent-map",
  "tsx-electron-workspace",
);

export const AGENT_MAP_FIXTURE_FILES = [
  "src/renderer/Composer.tsx",
  "src/renderer/SettingsPanel.tsx",
  "src/renderer/useDraftMessage.ts",
  "src/shared/host-api.ts",
  "src/main/ipc.ts",
];

export const AGENT_MAP_CLAWX_LIKE_FIXTURE_ROOT = join(
  process.cwd(),
  "tests",
  "fixtures",
  "agent-map",
  "clawx-like-workspace",
);

export const AGENT_MAP_CLAWX_LIKE_FIXTURE_FILES = [
  "src/pages/Chat/Composer.tsx",
  "src/lib/host-api.ts",
  "electron/main/ipc-handlers.ts",
  "openclaw_runtime/src/runtime-core/chat-dispatch.ts",
  "shared/types/chat.ts",
];

export function readAgentMapFixtureFiles(): AgentMapSourceFile[] {
  return AGENT_MAP_FIXTURE_FILES.map((file) => ({
    file,
    content: readFileSync(join(AGENT_MAP_FIXTURE_ROOT, file), "utf8"),
  }));
}

export function readClawxLikeAgentMapFixtureFiles(): AgentMapSourceFile[] {
  return AGENT_MAP_CLAWX_LIKE_FIXTURE_FILES.map((file) => ({
    file,
    content: readFileSync(join(AGENT_MAP_CLAWX_LIKE_FIXTURE_ROOT, file), "utf8"),
  }));
}

export function buildAgentMapFixtureRequest(
  overrides: Partial<AgentMapRequest> = {},
): AgentMapRequest {
  return buildAgentMapRequestFixture({
    activeFiles: ["src/renderer/Composer.tsx"],
    candidateFiles: AGENT_MAP_FIXTURE_FILES,
    mentionedFiles: [],
    mentionedSymbols: [],
    promptPresentFiles: ["src/renderer/Composer.tsx"],
    tokenBudget: 900,
    refreshPolicy: "force",
    ...overrides,
  });
}

export function buildClawxLikeAgentMapFixtureRequest(
  overrides: Partial<AgentMapRequest> = {},
): AgentMapRequest {
  return buildAgentMapRequestFixture({
    activeFiles: ["src/pages/Chat/Composer.tsx"],
    candidateFiles: AGENT_MAP_CLAWX_LIKE_FIXTURE_FILES,
    mentionedFiles: [],
    mentionedSymbols: ["dispatchRuntimeMessage"],
    promptPresentFiles: ["src/pages/Chat/Composer.tsx"],
    tokenBudget: 1000,
    refreshPolicy: "force",
    ...overrides,
  });
}
