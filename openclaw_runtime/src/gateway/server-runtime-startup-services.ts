// Gateway startup-time runtime services.
// Starts mode-dependent background monitors with inert handles for disabled paths.
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { ChannelHealthMonitor } from "./channel-health-monitor.js";
import { startChannelHealthMonitor } from "./channel-health-monitor.js";
import {
  createNoopHeartbeatRunner,
  type GatewayRuntimeServiceLogger,
} from "./server-runtime-service-shared.js";

// Runtime startup services start only the background services needed by the
// current gateway mode. Channel health is configurable; heartbeat/model pricing
// currently use inert handles here and are wired by other startup paths.
export type GatewayChannelManager = Parameters<
  typeof startChannelHealthMonitor
>[0]["channelManager"];

/** Starts channel health monitoring when gateway config enables it. */
export function startGatewayChannelHealthMonitor(params: {
  cfg: OpenClawConfig;
  channelManager: GatewayChannelManager;
}): ChannelHealthMonitor | null {
  const healthCheckMinutes = params.cfg.gateway?.channelHealthCheckMinutes;
  if (healthCheckMinutes === 0) {
    return null;
  }
  const staleEventThresholdMinutes = params.cfg.gateway?.channelStaleEventThresholdMinutes;
  const maxRestartsPerHour = params.cfg.gateway?.channelMaxRestartsPerHour;
  return startChannelHealthMonitor({
    channelManager: params.channelManager,
    checkIntervalMs: (healthCheckMinutes ?? 5) * 60_000,
    ...(staleEventThresholdMinutes != null && {
      staleEventThresholdMs: staleEventThresholdMinutes * 60_000,
    }),
    ...(maxRestartsPerHour != null && { maxRestartsPerHour }),
  });
}

/** Starts background runtime services and returns their stop/update handles. */
export function startGatewayRuntimeServices(params: {
  minimalTestGateway: boolean;
  cfgAtStart: OpenClawConfig;
  channelManager: GatewayChannelManager;
  log: GatewayRuntimeServiceLogger;
}): {
  heartbeatRunner: ReturnType<typeof createNoopHeartbeatRunner>;
  channelHealthMonitor: ChannelHealthMonitor | null;
  stopModelPricingRefresh: () => void;
} {
  const channelHealthMonitor = startGatewayChannelHealthMonitor({
    cfg: params.cfgAtStart,
    channelManager: params.channelManager,
  });

  return {
    heartbeatRunner: createNoopHeartbeatRunner(),
    channelHealthMonitor,
    stopModelPricingRefresh: () => {},
  };
}

/** Reconciles persisted workflow lifecycles through their original controllers. */
export async function recoverGatewayWorkflowLifecycles(log: {
  info: (message: string) => void;
  warn: (message: string) => void;
}): Promise<void> {
  for (const [domain, label] of [
    ["clawgraph", "ClawGraph"],
    ["mission", "Mission"],
    ["task-loop", "Task Loop"],
  ] as const) {
    try {
      const { hasWorkflowLifecycleRecoveryWork } =
        await import("../tasks/workflow-lifecycle-owner.js");
      // The durable owner selects work before controller import; the controller
      // retains its live-run, pending-effect and CAS reconciliation checks.
      if (!hasWorkflowLifecycleRecoveryWork(domain)) continue;
      const recovered =
        domain === "clawgraph"
          ? (await import("../agents/clawgraph/runtime.js")).settleOrphanedClawGraphLifecycles()
          : domain === "mission"
            ? (
                await import("../agents/mission-control/controller.js")
              ).recoverInterruptedMissionLifecycles()
            : (
                await import("../agents/task-loop-controller.js")
              ).settleOrphanedTaskLoopLifecycles();
      if (recovered.length > 0) {
        log.info(
          domain === "mission"
            ? `gateway: recovered ${recovered.length} interrupted mission tick(s)`
            : `gateway: settled ${recovered.length} orphaned ${label} lifecycle(s) as lost`,
        );
      }
    } catch (err) {
      log.warn(`gateway: ${label} lifecycle restart recovery failed: ${String(err)}`);
    }
  }
}
