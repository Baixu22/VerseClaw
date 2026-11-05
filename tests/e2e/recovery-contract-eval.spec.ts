/** Real Electron/Gateway crash windows with durable boundary probes and disk oracles. */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { freemem, tmpdir } from "node:os";
import type { ElectronApplication } from "@playwright/test";
import { getStableWindow, test, expect } from "./fixtures/electron";
import {
  allocatePort,
  buildMockProviderConfig,
  hostInvoke,
  startScriptedLlm,
} from "./fixtures/fp-p1-harness";
import { buildRecoveryContractManifest } from "../../shared/recovery-contract-eval";
import {
  MAIN_RECOVERY_KEY,
  closeRecoveryApp,
  effectLines,
  eventually,
  observeRecoveryVerdict,
  persistEvidence,
  readProbeFiles,
  readRecoveryDisk,
  writeProbe,
} from "./fixtures/recovery-contract-probe";

const OUTPUT_ROOT = process.env.RECOVERY_OUT ?? "";
const BATCH_FILE = process.env.RECOVERY_MATRIX_FILE ?? "";
const cases: Array<{ windowId: string; index: number; arm: string }> = BATCH_FILE
  ? JSON.parse(readFileSync(BATCH_FILE, "utf8"))
  : [
      {
        windowId: process.env.RECOVERY_WINDOW ?? "",
        index: Number(process.env.RECOVERY_TRIAL_INDEX ?? 0),
        arm: process.env.RECOVERY_ARM ?? "candidate",
      },
    ];
const manifest = buildRecoveryContractManifest();

async function ready(app: ElectronApplication) {
  return eventually(
    () => hostInvoke<{ gatewayReady?: boolean; state?: string }>(app, "gateway", "status"),
    (value) => value.gatewayReady === true,
    "gateway ready",
  );
}
function kill(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("no verified gateway PID");
  if (process.platform === "win32")
    execFileSync("taskkill.exe", ["/F", "/T", "/PID", String(pid)], {
      windowsHide: true,
      stdio: "ignore",
    });
  else process.kill(pid, "SIGKILL");
}
async function send(app: ElectronApplication, message: string, id: string) {
  return hostInvoke(app, "chat", "sendWithMedia", {
    sessionKey: MAIN_RECOVERY_KEY,
    message,
    idempotencyKey: id,
  });
}

test.describe("recovery contract eval windows", () => {
  test.skip(!OUTPUT_ROOT || cases.every((item) => !item.windowId), "explicit matrix driver only");
  test.setTimeout(480_000);
  for (const selected of cases) {
    const WINDOW = selected.windowId,
      INDEX = selected.index,
      ARM = selected.arm;
    const OUT = BATCH_FILE ? join(OUTPUT_ROOT, ARM) : OUTPUT_ROOT;
    const windowContract = manifest.windows.find((item) => item.id === WINDOW);
    test(`${ARM}/${WINDOW}/${INDEX}`, async ({
      homeDir,
      userDataDir,
      launchElectronApp,
    }, testInfo) => {
      if (!windowContract) throw new Error(`unknown window ${WINDOW}`);
      if (
        !["legacy", "candidate"].includes(ARM) ||
        !Number.isInteger(INDEX) ||
        INDEX < 0 ||
        INDEX > 2
      )
        throw new Error("invalid frozen trial identity");
      let setupWaitMs = 0;
      if (BATCH_FILE)
        while (freemem() < 1500 * 1024 * 1024 && setupWaitMs < 300_000) {
          await new Promise((resolveWait) => setTimeout(resolveWait, 15_000));
          setupWaitMs += 15_000;
        }
      const trialDir = join(resolve(OUT), `evidence-${WINDOW}-${INDEX}`);
      await mkdir(trialDir, { recursive: true });
      const probeDir = await mkdtemp(join(tmpdir(), "recovery-probe-"));
      const configPath = join(probeDir, "probe.json");
      const workspace = await mkdtemp(join(tmpdir(), "recovery-workspace-"));
      const effectPath = join(workspace, "effects.jsonl");
      const stateDir = join(userDataDir, "openclaw-source-state");
      const id = `RECOVERY-${WINDOW}-${INDEX}`;
      const js = `require("fs").appendFileSync(${JSON.stringify(effectPath.replaceAll("\\", "/"))},${JSON.stringify(id + "\n")},{flush:true})`;
      await writeFile(join(workspace, "effect.cjs"), js + ";\n");
      const command = "node effect.cjs";
      const llm = await startScriptedLlm((text, results, requestIndex) => {
        if (requestIndex === 0) return { text: "warmup complete" };
        if (text.lastIndexOf("RECOVERY-CHILD") > text.lastIndexOf(id + " start"))
          return { text: "child complete" };
        if (Object.keys(results).length) return { text: `${id} complete` };
        if (WINDOW === "child-created-before-parent-advance-kill") {
          return {
            toolCall: {
              id: "recovery-spawn",
              name: "sessions_spawn",
              args: {
                task: "RECOVERY-CHILD: reply child complete",
                label: id,
                mode: "run",
                cleanup: "keep",
              },
            },
          };
        }
        return { toolCall: { id: "recovery-effect", name: "exec", args: { command } } };
      });
      const config = buildMockProviderConfig(llm.port, workspace);
      const gatewayPort = await allocatePort();
      (config.gateway as Record<string, unknown>).port = gatewayPort;
      // This fixture's explicit workspace consent is inherited by the normal tool policy.
      (config as Record<string, unknown>).tools = {
        profile: "full",
        exec: { security: "full", ask: "off" },
      };
      await mkdir(join(homeDir, ".openclaw"), { recursive: true });
      await mkdir(stateDir, { recursive: true });
      await writeFile(
        join(userDataDir, "settings.json"),
        JSON.stringify({ language: "en", gatewayPort }),
      );
      const serialized = JSON.stringify(config, null, 2) + "\n";
      await writeFile(join(homeDir, ".openclaw/openclaw.json"), serialized);
      await writeFile(join(stateDir, "openclaw.json"), serialized);
      let app: ElectronApplication | undefined;
      const crashes: Array<Record<string, unknown>> = [];
      let receipt: Record<string, unknown> | undefined;
      const evidence: Array<{ path: string; sha256: string; bytes: number }> = [];
      try {
        app = await launchElectronApp({
          skipSetup: true,
          env: {
            OPENCLAW_GATEWAY_PORT: String(gatewayPort),
            OPENCLAW_RECOVERY_EVAL_CONFIG: configPath,
            OPENCLAW_EXECUTION_PHASE_WRITER: ARM === "candidate" ? "taskflow" : "legacy",
            OPENCLAW_TASK_LOOP_LIFECYCLE_WRITER: ARM === "candidate" ? "taskflow" : "legacy",
            OPENCLAW_RECOVERY_AUTHORITY_SHADOW: process.env.RECOVERY_SHADOW === "1" ? "1" : "0",
          },
        });
        await getStableWindow(app);
        await hostInvoke(app, "workspaces", "create", {
          rootPath: workspace,
          permissionMode: "fullAccess",
          name: "recovery-eval",
        });
        await hostInvoke(app, "gateway", "start");
        await ready(app);
        await send(app, "RECOVERY-WARMUP", "warmup-" + id);
        await eventually(
          () => readRecoveryDisk(stateDir),
          (disk) =>
            disk.entries.some(
              (entry) =>
                entry.message?.role === "assistant" &&
                JSON.stringify(entry.message).includes("warmup complete"),
            ),
          "warmup transcript",
        );
        const before = readRecoveryDisk(stateDir);
        evidence.push(persistEvidence(trialDir, "before.json", before));
        const baseRequests = llm.log.length;
        let started = Date.now();
        let outcome: Record<string, unknown> = {};
        if (WINDOW === "store-write-failure") {
          writeProbe(configPath, { id, point: "session-store-before-ack", action: "throw" });
          let error = "";
          try {
            await hostInvoke(app, "gateway", "rpc", {
              method: "sessions.patch",
              params: { key: MAIN_RECOVERY_KEY, label: "must-not-commit-" + id },
              timeoutMs: 15_000,
            });
          } catch (e) {
            error = String(e);
          }
          const hit = await eventually(
            () => readProbeFiles(probeDir, "hit-"),
            (files) => files.some((h) => h.point === "session-store-before-ack"),
            "actual failing store write",
          );
          writeProbe(configPath, { id: "observe-" + id, point: "observe", action: "pause" });
          const failed = readRecoveryDisk(stateDir);
          const unchanged = failed.main?.label === before.main?.label;
          evidence.push(persistEvidence(trialDir, "failed-write.json", { error, hit, failed }));
          // Retry the same logical write through the same public session owner.
          await hostInvoke(app, "gateway", "rpc", {
            method: "sessions.patch",
            params: { key: MAIN_RECOVERY_KEY, label: "must-not-commit-" + id },
            timeoutMs: 15_000,
          });
          const retried = readRecoveryDisk(stateDir);
          evidence.push(persistEvidence(trialDir, "retry.json", retried));
          outcome = {
            duplicateEffects: 0,
            lostTasks: 0,
            terminalCorrect:
              !!error && unchanged && retried.main?.label === "must-not-commit-" + id,
            unknownClassifiable: false,
            rerunOutsideAllowedRegion: !unchanged,
            recoveryLatencyMs: Date.now() - started,
            observed: {
              error,
              unchanged,
              retryApplied: retried.main?.label === "must-not-commit-" + id,
            },
          };
        } else {
          const point =
            WINDOW === "intent-after-persist-kill" || WINDOW === "repeated-restart"
              ? "user-intent-durable"
              : "tool-return-before-receipt";
          const toolName =
            WINDOW === "child-created-before-parent-advance-kill" ? "sessions_spawn" : "exec";
          const count = WINDOW === "repeated-restart" ? 3 : 1;
          writeProbe(configPath, {
            id,
            point,
            action: "pause",
            ...(point === "tool-return-before-receipt" ? { toolName } : {}),
            ...(WINDOW === "intent-after-persist-kill" ? { messageIncludes: id } : {}),
          });
          // The async send can finish only after the paused gateway is released;
          // its transport error is recorded while the test controls the process.
          const pendingSend = send(app, id + " start", id)
            .then(() => "ack")
            .catch((e) => String(e));
          const seen = new Set<number>();
          for (let crash = 0; crash < count; crash++) {
            const crashPoint = crash === 0 ? point : "recovery-before-dispatch";
            const hit = await eventually(
              () =>
                readProbeFiles(probeDir, "hit-").find(
                  (h) => h.point === crashPoint && !seen.has(h.pid),
                ),
              Boolean,
              "durable fault boundary",
            );
            if (!hit) throw new Error("missing boundary");
            seen.add(hit.pid);
            const disk = readRecoveryDisk(stateDir);
            if (point === "user-intent-durable") {
              expect(llm.log.length).toBe(baseRequests);
              if (crash === 0)
                expect(
                  disk.entries.filter(
                    (e) =>
                      e.message?.role === "user" &&
                      JSON.stringify(e.message).includes(id + " start"),
                  ),
                ).toHaveLength(1);
            } else if (WINDOW === "effect-before-receipt-kill") {
              expect(effectLines(effectPath)).toEqual([id]);
              expect(
                disk.entries.some(
                  (e) =>
                    e.message?.role === "toolResult" && e.message.toolCallId === "recovery-effect",
                ),
              ).toBe(false);
            } else {
              expect(
                Object.values(disk.sessions).filter((s) => s.spawnedBy === MAIN_RECOVERY_KEY),
              ).toHaveLength(1);
              expect(
                disk.entries.some(
                  (e) =>
                    e.message?.role === "toolResult" && e.message.toolCallId === "recovery-spawn",
                ),
              ).toBe(false);
            }
            evidence.push(
              persistEvidence(trialDir, `crash-${crash}.json`, {
                hit,
                disk,
                effects: effectLines(effectPath),
                requests: llm.log.length,
              }),
            );
            if (crash === 0) started = Date.now();
            crashes.push({
              pid: hit.pid,
              point: crashPoint,
              sessionId: disk.main?.sessionId,
              at: Date.now(),
            });
            kill(hit.pid);
            // Change the next boot's probe only after termination. Releasing a
            // live paused process first would let it cross the measured boundary.
            if (point === "user-intent-durable") expect(llm.log.length).toBe(baseRequests);
            if (crash === count - 1)
              writeProbe(configPath, { id: "observe-" + id, point: "observe", action: "pause" });
            else
              writeProbe(configPath, {
                id: `${id}-restart-${crash + 1}`,
                point: "recovery-before-dispatch",
                action: "pause",
              });
            // The existing supervisor owns restart. Reuse the same session and intent.
          }
          const observe = () => ({
            disk: readRecoveryDisk(stateDir),
            decisions: readProbeFiles(probeDir, "decision-"),
            effects: effectLines(effectPath),
          });
          const observed = await observeRecoveryVerdict(
            observe,
            (v) =>
              v.disk.main?.status !== "running" ||
              (v.disk.main?.abortedLastRun === true &&
                v.decisions.some((d) => d.action === "reconcile")),
          );
          const final = observed.value;
          const observationTimedOut = observed.timedOut,
            observationError = observed.error;
          const latency = Date.now() - started;
          const realResult = final.disk.entries.some(
            (e) =>
              e.message?.role === "toolResult" &&
              e.message.toolCallId === "recovery-effect" &&
              !e.message.isError,
          );
          const childCount = Object.values(final.disk.sessions).filter(
            (s) => s.spawnedBy === MAIN_RECOVERY_KEY,
          ).length;
          const reconciliation = final.disk.flows.some(
            (flow) =>
              flow.execution_phase === "effect_pending" &&
              JSON.parse(String(flow.state_json)).recovery?.needsReconciliation === true,
          );
          const isChild = WINDOW === "child-created-before-parent-advance-kill";
          const duplicateIntents = Math.max(
            0,
            final.disk.entries.filter(
              (e) =>
                e.message?.role === "user" && JSON.stringify(e.message).includes(id + " start"),
            ).length - 1,
          );
          const uncertain = WINDOW === "effect-before-receipt-kill" || isChild;
          const terminalCorrect =
            !observationTimedOut &&
            (uncertain
              ? (isChild ? childCount === 1 : final.effects.length === 1) &&
                reconciliation &&
                final.decisions.some((d) => d.action === "reconcile")
              : final.effects.length === 1 && realResult);
          evidence.push(
            persistEvidence(trialDir, "after.json", {
              ...final,
              transport: await Promise.race([
                pendingSend,
                new Promise<string>((r) => setTimeout(() => r("pending"), 1000)),
              ]),
            }),
          );
          outcome = {
            duplicateEffects: isChild
              ? Math.max(0, childCount - 1)
              : Math.max(0, final.effects.length - 1),
            lostTasks: isChild ? (childCount === 0 ? 1 : 0) : final.effects.length === 0 ? 1 : 0,
            terminalCorrect,
            // Frozen metric counts outcomes that remain unclassifiable; an explicit
            // no-replay reconciliation tombstone is a classified outcome.
            unknownClassifiable: uncertain && !reconciliation,
            rerunOutsideAllowedRegion:
              duplicateIntents > 0 || (isChild ? childCount > 1 : final.effects.length > 1),
            recoveryLatencyMs: latency,
            observed: {
              crashes,
              childCount,
              realResult,
              reconciliation,
              duplicateIntents,
              effects: final.effects,
              decisions: final.decisions,
              observationTimedOut,
              observationError,
              observationBudgetMs: 150_000,
              latencyBasis: observationTimedOut
                ? "elapsed-to-failed-observer-verdict"
                : "elapsed-to-observed-recovery-verdict",
            },
          };
        }
        receipt = {
          schema: "RecoveryContractWindowTrialReceipt/v1",
          windowId: WINDOW,
          trialIndex: INDEX,
          arm: ARM,
          injectionPoint: windowContract.annotation.injectionPoint,
          injectionMechanism:
            WINDOW === "store-write-failure" ? "transaction-write-failure" : "real-process-kill",
          observedBoundary:
            WINDOW === "store-write-failure"
              ? "session-store-before-ack"
              : WINDOW === "intent-after-persist-kill" || WINDOW === "repeated-restart"
                ? "user-intent-durable"
                : "tool-return-before-receipt",
          ...outcome,
          setupWaitMs,
          diskEvidenceComplete: evidence.length >= 3,
          evidenceRef: trialDir.replaceAll("\\", "/"),
          artifacts: evidence,
          drivenBy: "agent",
          actor: "recovery-contract-matrix",
          realHumanEvidence: false,
          generatedAt: new Date().toISOString(),
        };
        const artifact = persistEvidence(resolve(OUT), `trial-${WINDOW}-${INDEX}.json`, receipt);
        await testInfo.attach("recovery-trial", {
          path: artifact.path,
          contentType: "application/json",
        });
        expect(evidence.length).toBeGreaterThanOrEqual(3);
      } finally {
        writeProbe(configPath, { id: "released", point: "observe", action: "pause" });
        if (app) await closeRecoveryApp(app);
        llm.server.closeAllConnections();
        await new Promise<void>((resolve) => llm.server.close(() => resolve()));
      }
    });
  }
});
