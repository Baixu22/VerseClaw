import { describe, expect, it } from "vitest";
import { createResolvedChatKnowledgeRef } from "../../context-engine/chat-knowledge-intent.js";
import { buildEmbeddedRunBaseParams } from "./agent-runner-run-params.js";
import type { FollowupRun } from "./queue.js";

describe("buildEmbeddedRunBaseParams", () => {
  it("forwards admitted Chat knowledge references into the embedded runner", () => {
    const knowledgeRef = createResolvedChatKnowledgeRef({
      owner: "memory-wiki",
      subjectKind: "wiki-page",
      subjectId: "sources/decision.md",
      revision: "sha256:revision",
      title: "Decision",
      lookup: "sources/decision.md",
      content: "Use the reviewed decision.",
      trust: "advisory",
      sensitivity: "workspace",
    });
    const run = {
      agentId: "main", agentDir: "/tmp/agent", sessionKey: "main",
      sessionFile: "/tmp/session.jsonl", workspaceDir: "/tmp", config: {},
      chatKnowledgeRefs: [knowledgeRef],
    } as FollowupRun["run"];
    const params = buildEmbeddedRunBaseParams({
      run,
      provider: "mock",
      model: "mock-coder",
      runId: "run-knowledge-forwarding",
      authProfile: {},
    });
    expect(params.chatKnowledgeRefs).toEqual([knowledgeRef]);
  });
});
