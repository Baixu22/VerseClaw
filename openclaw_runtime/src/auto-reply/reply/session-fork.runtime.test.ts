/**
 * #180: `fromLeafId` forks a session up to an in-transcript fork point instead
 * of the transcript tip — and fails closed (returns null ⇒ the RPC errors)
 * when that point cannot be resolved to an assistant turn, instead of silently
 * forking the tip.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CURRENT_SESSION_VERSION } from "../../config/sessions/version.js";
import { forkSessionFromParentRuntime } from "./session-fork.runtime.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "session-fork-runtime-"));
  roots.push(root);
  return root;
}

function transcriptEntry(id: string, parentId: string | null, role: string, content: string) {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: { role, content },
  };
}

function writeParentTranscript(params: { root: string; tail: boolean }): string {
  const file = path.join(params.root, "parent.jsonl");
  const entries = [
    {
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: "parent",
      timestamp: "2026-01-01T00:00:00.000Z",
      cwd: params.root,
    },
    transcriptEntry("u1", null, "user", "first question"),
    transcriptEntry("a1", "u1", "assistant", "first answer"),
    transcriptEntry("u2", "a1", "user", "second question"),
  ];
  if (params.tail) {
    entries.push(transcriptEntry("a2", "u2", "assistant", "second answer"));
  }
  writeFileSync(file, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf-8");
  return file;
}

function readForked(file: string): string {
  return readFileSync(file, "utf-8");
}

describe("#180 fork at an in-transcript point", () => {
  it("keeps the whole history when fromEntryId is omitted", async () => {
    const root = makeRoot();
    const parentSessionFile = writeParentTranscript({ root, tail: true });
    const forked = await forkSessionFromParentRuntime({
      parentEntry: { sessionId: "parent", sessionFile: parentSessionFile },
      agentId: "main",
      sessionsDir: root,
    });

    expect(forked).not.toBeNull();
    const written = readForked(forked!.sessionFile);
    expect(written).toContain("first question");
    expect(written).toContain("second answer");
  });

  it("drops everything after an assistant fork point", async () => {
    const root = makeRoot();
    const parentSessionFile = writeParentTranscript({ root, tail: true });
    const forked = await forkSessionFromParentRuntime({
      parentEntry: { sessionId: "parent", sessionFile: parentSessionFile },
      agentId: "main",
      sessionsDir: root,
      fromEntryId: "a1",
    });

    expect(forked).not.toBeNull();
    const written = readForked(forked!.sessionFile);
    expect(written).toContain("first question");
    expect(written).toContain("first answer");
    expect(written).not.toContain("second question");
    expect(written).not.toContain("second answer");
  });

  it("resolves a user fork point to the nearest earlier assistant turn", async () => {
    const root = makeRoot();
    const parentSessionFile = writeParentTranscript({ root, tail: true });
    const forked = await forkSessionFromParentRuntime({
      parentEntry: { sessionId: "parent", sessionFile: parentSessionFile },
      agentId: "main",
      sessionsDir: root,
      fromEntryId: "u2",
    });

    expect(forked).not.toBeNull();
    const written = readForked(forked!.sessionFile);
    expect(written).toContain("first answer");
    expect(written).not.toContain("second question");
  });

  it("fails closed on an unknown fork point instead of forking the tip", async () => {
    const root = makeRoot();
    const parentSessionFile = writeParentTranscript({ root, tail: true });
    const forked = await forkSessionFromParentRuntime({
      parentEntry: { sessionId: "parent", sessionFile: parentSessionFile },
      agentId: "main",
      sessionsDir: root,
      fromEntryId: "no-such-entry",
    });

    expect(forked).toBeNull();
  });

  it("fails closed when no assistant turn exists at or before the fork point", async () => {
    const root = makeRoot();
    const parentSessionFile = writeParentTranscript({ root, tail: false });
    const forked = await forkSessionFromParentRuntime({
      parentEntry: { sessionId: "parent", sessionFile: parentSessionFile },
      agentId: "main",
      sessionsDir: root,
      fromEntryId: "u1",
    });

    expect(forked).toBeNull();
  });
});