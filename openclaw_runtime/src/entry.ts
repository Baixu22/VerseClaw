#!/usr/bin/env node
import process from "node:process";
import { parseArgs } from "node:util";
import { flushRuntimeCompileCache } from "./infra/runtime-compile-cache.js";
import { VERSION } from "./version.js";

const help = `Usage: openclaw <command> [options]

Verse Claw source runtime commands:
  gateway [run]   Start Gateway (--port, --token, --bind,
                 --allow-unconfigured, --defer-startup-sidecars)
  doctor         Inspect provider auth migrations (--json, --fix)
  --version, -V  Print the bundled runtime version
  --help, -h     Show this help

Other upstream CLI commands are not included in this source runtime.
`;

const args = process.argv.slice(2);
// Dispatch queries before importing Gateway: importing its module can initialize
// user state even when startGatewayServer is never called.
if (args.length === 1 && ["--version", "-V"].includes(args[0])) {
  console.log(VERSION);
} else if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log(help);
} else if (args[0] === "doctor") {
  const { runSourceDoctor } = await import("./infra/source-doctor.js");
  process.exit(await runSourceDoctor(args.slice(1)));
} else if (args[0] === "goal-wake-helper-run") {
  // Internal Phase 4 detached helper entry. The payload (raw argv/env/cwd) is
  // read from stdin and never persisted in the runDir file protocol.
  const { runGoalWakeHelperEntry } = await import("./agents/goal-wake-helper-entry.js");
  process.exitCode = await runGoalWakeHelperEntry();
} else if (args[0] === "gateway") {
  try {
    const { values } = parseArgs({
      args: args.slice(args[1] === "run" ? 2 : 1),
      options: {
        port: { type: "string" },
        token: { type: "string" },
        bind: { type: "string" },
        tailscale: { type: "string" },
        "allow-unconfigured": { type: "boolean" },
        "defer-startup-sidecars": { type: "boolean" },
      },
    });
    // Desktop build/smoke callers explicitly disable Tailscale. This pruned
    // entry never implemented enabling it; do not silently accept that request.
    if (values.tailscale && values.tailscale !== "off") {
      throw new Error("Unsupported Tailscale mode in the source runtime");
    }
    const port = Number(values.port ?? process.env.OPENCLAW_GATEWAY_PORT ?? "18789");
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Invalid Gateway port (expected 1-65535)");
    }
    const token = values.token ?? process.env.OPENCLAW_GATEWAY_TOKEN ?? "";
    const bind = values.bind ?? process.env.OPENCLAW_GATEWAY_BIND ?? "loopback";
    if (!["loopback", "lan", "tailnet", "auto", "custom"].includes(bind)) {
      throw new Error("Invalid Gateway bind mode");
    }
    const deferStartupSidecars =
      values["defer-startup-sidecars"] ??
      /^(1|true|yes|on)$/i.test(process.env.OPENCLAW_DEFER_STARTUP_SIDECARS ?? "");
    if (token) {
      process.env.OPENCLAW_GATEWAY_TOKEN = token;
    }
    const { startGatewayServer } = await import("./gateway/server.js");
    await startGatewayServer(port, {
      bind: bind as NonNullable<Parameters<typeof startGatewayServer>[1]>["bind"],
      auth: token ? { token } : undefined,
      deferStartupSidecars,
    });
    // Persist startup bytecode for restart; the attempt barrel flushes code loaded later.
    flushRuntimeCompileCache();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
} else {
  console.error("Unsupported command in the Verse Claw source runtime. Run openclaw --help.");
  process.exitCode = 1;
}
