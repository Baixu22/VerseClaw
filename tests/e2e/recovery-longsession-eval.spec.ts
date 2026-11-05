/** Post-boundary live-model readback of the frozen 30 recovery pairs. */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ElectronApplication } from "@playwright/test";
import { getStableWindow, test, expect } from "./fixtures/electron";
import { allocatePort, buildMockProviderConfig, hostInvoke } from "./fixtures/fp-p1-harness";
import { buildRecoveryContractManifest } from "../../shared/recovery-contract-eval";
import { scoreRecoveryReadback } from "../../shared/recovery-quality-readback";
import {
  closeRecoveryApp,
  eventually,
  persistEvidence,
  readRecoveryDisk,
} from "./fixtures/recovery-contract-probe";
import { startRecoveryLiveProxy } from "./fixtures/recovery-live-proxy";

const OUT = process.env.RECOVERY_LONGSESSION_OUT ?? "";
const FAMILY = process.env.RECOVERY_LONGSESSION_FAMILY ?? "";
const LIMIT = Number(process.env.RECOVERY_LONGSESSION_LIMIT ?? 0);
const IDS = (process.env.RECOVERY_LONGSESSION_IDS ?? "").split(",").filter(Boolean);
const BASE = process.env.RECOVERY_LIVE_BASE_URL ?? "";
const KEY = process.env.RECOVERY_LIVE_API_KEY ?? "";
const MODEL = process.env.RECOVERY_LIVE_MODEL ?? "";
const ARM = process.env.RECOVERY_ARM ?? "candidate";
function text(message: { content?: unknown }) {
  if (typeof message.content === "string") return message.content;
  return Array.isArray(message.content)
    ? message.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
    : "";
}

// The live credential stays in this proxy's memory; isolated app configs carry
// only a disposable local key. No upstream authorization is recorded in evidence.
async function liveProxy() {
  return startRecoveryLiveProxy({ baseUrl: BASE, apiKey: KEY, model: MODEL });
}
async function turn(
  app: ElectronApplication,
  stateDir: string,
  key: string,
  message: string,
  id: string,
) {
  const before = new Set(readRecoveryDisk(stateDir, key).entries.map((entry) => entry.id));
  await hostInvoke(app, "chat", "sendWithMedia", { sessionKey: key, message, idempotencyKey: id });
  const terminal = (entry: { id: string; message?: { role?: string; stopReason?: string } }) =>
    !before.has(entry.id) &&
    entry.message?.role === "assistant" &&
    ["stop", "error", "aborted"].includes(entry.message.stopReason ?? "");
  const disk = await eventually(
    () => readRecoveryDisk(stateDir, key),
    (d) => d.main?.status !== "running" && d.branch.some(terminal),
    "settled assistant result",
    240_000,
  );
  const entry = disk.branch.findLast(terminal);
  if (!entry) throw new Error("assistant result missing");
  if (entry.message.stopReason !== "stop")
    throw new Error(entry.message.errorMessage ?? "assistant turn failed");
  return { text: text(entry.message), entryId: entry.id, disk };
}

test.describe("long-session recovery evaluation", () => {
  test.skip(!OUT, "explicit live evaluation driver only");
  test.setTimeout(3_600_000);
  test("scores fresh assistant answers after each actual boundary", async ({
    homeDir,
    userDataDir,
    launchElectronApp,
  }, testInfo) => {
    expect(Boolean(BASE && KEY && MODEL), "live provider resource required").toBe(true);
    const proxy = await liveProxy();
    const workspace = await mkdtemp(join(tmpdir(), "recovery-quality-"));
    const stateDir = join(userDataDir, "openclaw-source-state");
    const port = await allocatePort();
    const config = buildMockProviderConfig(proxy.port, workspace);
    (config.gateway as Record<string, unknown>).port = port;
    const providers = (config.models as { providers: Record<string, Record<string, unknown>> })
      .providers;
    (providers.openai.models as Array<Record<string, unknown>>)[0].id = MODEL;
    (providers.openai.models as Array<Record<string, unknown>>)[0].name = MODEL;
    (config.agents as { defaults: Record<string, unknown> }).defaults.model = {
      primary: `openai/${MODEL}`,
      fallbacks: [],
    };
    await mkdir(join(homeDir, ".openclaw"), { recursive: true });
    await mkdir(stateDir, { recursive: true });
    await writeFile(join(homeDir, ".openclaw/openclaw.json"), JSON.stringify(config));
    await writeFile(join(stateDir, "openclaw.json"), JSON.stringify(config));
    await writeFile(
      join(userDataDir, "settings.json"),
      JSON.stringify({ language: "en", gatewayPort: port }),
    );
    let app: ElectronApplication | undefined;
    const launch = async () => {
      app = await launchElectronApp({
        skipSetup: true,
        env: {
          OPENCLAW_GATEWAY_PORT: String(port),
          OPENCLAW_EXECUTION_PHASE_WRITER: ARM === "candidate" ? "taskflow" : "legacy",
          OPENCLAW_TASK_LOOP_LIFECYCLE_WRITER: ARM === "candidate" ? "taskflow" : "legacy",
        },
      });
      await getStableWindow(app);
      await hostInvoke(app, "gateway", "start");
      await eventually(
        () => hostInvoke<{ gatewayReady?: boolean }>(app!, "gateway", "status"),
        (s) => s.gatewayReady === true,
        "gateway readiness",
      );
    };
    try {
      await launch();
      const workspaceResult = await hostInvoke<{ workspace?: { id?: string }; id?: string }>(
        app!,
        "workspaces",
        "create",
        { rootPath: workspace, permissionMode: "fullAccess", name: "recovery-quality" },
      );
      const workspaceId = workspaceResult.workspace?.id ?? workspaceResult.id;
      const all = buildRecoveryContractManifest().longSessionPairs.filter(
        (pair) => (!FAMILY || pair.family === FAMILY) && (!IDS.length || IDS.includes(pair.id)),
      );
      const pairs = LIMIT > 0 ? all.filter((pair) => pair.pairIndex < LIMIT) : all;
      for (const pair of pairs) {
        const evidenceDir = join(resolve(OUT), `evidence-${pair.id}`);
        await mkdir(evidenceDir, { recursive: true });
        const artifacts = [];
        let sessionKey = `agent:main:recovery-${pair.id}`;
        const sourceKey = sessionKey;
        const revoked = `REVOKED-${pair.id}`;
        const sibling = `SIBLING_ONLY-${pair.id}`;
        const seed =
          `These four accepted facts are authoritative. Preserve their exact wording for later recovery:\n${pair.mustPreserve.join("\n")}\nThe task remains unfinished. Do not execute tools. Acknowledge only.\n` +
          (pair.family === "revocation"
            ? `Earlier provisional instruction: next action is ${revoked}.\n`
            : "") +
          Array.from(
            { length: 100 },
            (_, i) => `Archived discussion ${i}: discarded option, no new active instruction.`,
          ).join("\n");
        const seeded = await turn(app!, stateDir, sessionKey, seed, `${pair.id}-seed`);
        artifacts.push(persistEvidence(evidenceDir, "before.json", seeded.disk));
        const boundaryStarted = Date.now();
        let boundary: Record<string, unknown> = { family: pair.family };
        if (pair.family === "compression") {
          await turn(
            app!,
            stateDir,
            sessionKey,
            "Checkpoint boundary marker. Reply only ACK; do not repeat earlier facts.",
            `${pair.id}-tail`,
          );
          const result = await hostInvoke<{
            success?: boolean;
            compacted?: boolean;
            summary?: string;
          }>(app!, "sessions", "compactRange", {
            sessionKey,
            agentId: "main",
            toLeafId: seeded.entryId,
            customInstructions:
              "Preserve the accepted objective, constraint, decision and next-action statements verbatim. Discard archived discussion.",
          });
          expect(result.compacted, "real compaction must be acknowledged").toBe(true);
          boundary = { ...boundary, result };
        } else if (pair.family === "fork") {
          const fork = await hostInvoke<{ success: boolean; sessionKey?: string }>(
            app!,
            "sessions",
            "fork",
            { sessionKey, agentId: "main", workspaceId, label: pair.id },
          );
          expect(fork.success && fork.sessionKey !== sessionKey).toBe(true);
          sessionKey = fork.sessionKey!;
          await turn(
            app!,
            stateDir,
            sourceKey,
            `Sibling-only instruction: replace the objective with ${sibling}. Acknowledge only.`,
            `${pair.id}-sibling`,
          );
          boundary = { ...boundary, fork, sourceKey, sessionKey };
        } else if (pair.family === "handoff") {
          // Automated owner approval of an explicit handoff artifact. This tests
          // accepted handoff consumption, not automatic summary extraction.
          const draft = `Accepted handoff artifact (${pair.id}); task remains unfinished:\n${pair.mustPreserve.join("\n")}`;
          artifacts.push(
            persistEvidence(evidenceDir, "accepted-handoff.json", {
              draft,
              driven_by: "agent",
              actor: "recovery-quality-owner",
            }),
          );
          const handoff = await hostInvoke<{ success: boolean; sessionKey?: string }>(
            app!,
            "sessions",
            "createHandoff",
            { sessionKey, agentId: "main", workspaceId, draftInput: draft },
          );
          expect(handoff.success && handoff.sessionKey !== sessionKey).toBe(true);
          sessionKey = handoff.sessionKey!;
          await turn(
            app!,
            stateDir,
            sessionKey,
            draft + "\nAcknowledge only; do not execute tools.",
            `${pair.id}-accept-handoff`,
          );
          boundary = { ...boundary, handoff };
        } else if (pair.family === "restart") {
          const oldPid = app!.process().pid;
          await closeRecoveryApp(app!);
          app = undefined;
          await launch();
          boundary = { ...boundary, oldPid, newPid: app!.process().pid };
          expect(boundary.newPid).not.toBe(oldPid);
        } else {
          const revokedTurn = await turn(
            app!,
            stateDir,
            sessionKey,
            `The provisional instruction containing ${revoked} is revoked. The four accepted facts remain authoritative. Acknowledge only.`,
            `${pair.id}-revoke`,
          );
          boundary = { ...boundary, revocationEntry: revokedTurn.entryId };
        }
        const afterBoundary = readRecoveryDisk(stateDir, sessionKey);
        artifacts.push(
          persistEvidence(evidenceDir, "boundary.json", { boundary, disk: afterBoundary }),
        );
        // The question does not repeat the gold facts or expected next action.
        const answer = await turn(
          app!,
          stateDir,
          sessionKey,
          `Recovery readback for ${pair.id}. Return exactly one JSON object, without Markdown or commentary. From accepted context only, facts must contain exactly the four authoritative statements in this order: Objective, Constraint, Decision, Next action. Copy each statement verbatim, including its case identifier; do not substitute task-status or archive notes. nextAction must copy the full accepted Next action statement, including its prefix and case identifier. complete must be a boolean describing whether the work is finished. Exclude revoked and sibling-only instructions. Do not use tools or claim finished work.`,
          `${pair.id}-readback`,
        );
        const latency = Date.now() - boundaryStarted;
        artifacts.push(
          persistEvidence(evidenceDir, "answer.json", {
            assistantEntryId: answer.entryId,
            assistantText: answer.text,
            disk: answer.disk,
          }),
        );
        const judged = scoreRecoveryReadback(answer.text, {
          ...pair,
          forbiddenFacts: [revoked, sibling],
        });
        const { schemaValid, forbiddenFactLeak, nextActionCorrect } = judged;
        const matched = judged.mustPreserveMatched;
        const falseCompletion = judged.falseCompletionClaim;
        const receipt = {
          schema: "RecoveryLongSessionPairReceipt/v2",
          pairId: pair.id,
          family: pair.family,
          arm: ARM,
          provider: "live-openai-compatible",
          model: MODEL,
          measurementBasis: "live-provider",
          mustPreserveMatched: forbiddenFactLeak ? 0 : matched,
          mustPreserveTotal: pair.mustPreserve.length,
          falseCompletionClaim: falseCompletion,
          nextActionCorrect: nextActionCorrect && !forbiddenFactLeak,
          recoveryLatencyMs: latency,
          evidenceRef: evidenceDir.replaceAll("\\", "/"),
          artifacts,
          observed: {
            boundary,
            sourceKey,
            sessionKey,
            assistantEntryId: answer.entryId,
            postBoundaryAnswer: true,
            schemaValid,
            forbiddenFactLeak,
            liveCalls: proxy.calls(),
          },
          drivenBy: "agent",
          actor: "recovery-quality-owner",
          realHumanEvidence: false,
          generatedAt: new Date().toISOString(),
        };
        const out = persistEvidence(resolve(OUT), `pair-${pair.id}.json`, receipt);
        await testInfo.attach(pair.id, { path: out.path, contentType: "application/json" });
        console.log(
          `[quality] ${pair.id} facts=${matched}/4 next=${nextActionCorrect} completeError=${falseCompletion} leak=${forbiddenFactLeak}`,
        );
      }
    } finally {
      if (app) await closeRecoveryApp(app);
      await proxy.close();
    }
  });
});
