/** Explicit E2E fault injection. Disabled unless the host and probe both opt in. */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

type ProbeConfig = {
  id: string;
  point: string;
  action: "pause" | "throw";
  toolName?: string;
  messageIncludes?: string;
};
let sequence = 0;
function readProbe(): { file: string; config: ProbeConfig } | undefined {
  if (process.env.VERSE_CLAW_E2E !== "1" || !process.env.OPENCLAW_RECOVERY_EVAL_CONFIG) return;
  const file = process.env.OPENCLAW_RECOVERY_EVAL_CONFIG;
  if (!existsSync(file)) return;
  const config = JSON.parse(readFileSync(file, "utf8")) as ProbeConfig;
  if (!config.id || !config.point || !["pause", "throw"].includes(config.action)) return;
  return { file, config };
}

export function recoveryEvalProbe(point: string, facts: Record<string, unknown>): void {
  const probe = readProbe();
  if (!probe || probe.config.point !== point) return;
  if (probe.config.toolName && facts.toolName !== probe.config.toolName) return;
  if (
    probe.config.messageIncludes &&
    !String(facts.messageText ?? "").includes(probe.config.messageIncludes)
  )
    return;
  const dir = dirname(probe.file);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `hit-${probe.config.id}-${process.pid}-${++sequence}.json`);
  writeFileSync(
    file,
    JSON.stringify({
      schema: "RecoveryFaultBoundary/v1",
      id: probe.config.id,
      point,
      action: probe.config.action,
      pid: process.pid,
      observedAt: Date.now(),
      facts,
      driven_by: "agent",
      actor: "recovery-eval-probe",
      realHumanEvidence: false,
    }),
    { encoding: "utf8", flush: true },
  );
  if (probe.config.action === "throw")
    throw new Error("EIO: injected session-store failure before commit acknowledgement");
  // A separate test process reads the durable boundary and terminates this PID.
  // Deleting/changing the opt-in file releases it without changing runtime state.
  while (readProbe()?.config.id === probe.config.id) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
}

export function recordRecoveryEvalDecision(facts: Record<string, unknown>): void {
  const probe = readProbe();
  if (!probe) return;
  writeFileSync(
    join(dirname(probe.file), `decision-${process.pid}-${++sequence}.json`),
    JSON.stringify({
      ...facts,
      pid: process.pid,
      observedAt: Date.now(),
      driven_by: "agent",
      actor: "main-session-recovery",
      realHumanEvidence: false,
    }),
    { encoding: "utf8", flush: true },
  );
}
