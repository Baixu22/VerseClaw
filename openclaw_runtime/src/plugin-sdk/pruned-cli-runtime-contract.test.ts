import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import {
  formatHelpExamples,
  inheritOptionFromParent,
  registerCommandGroups,
  resolveCliArgvInvocation,
  runCommandWithRuntime,
  shouldEagerRegisterSubcommands,
} from "./cli-runtime.js";
import { callGatewayFromCli } from "./gateway-runtime.js";

const runtimeRoot = fileURLToPath(new URL("../..", import.meta.url));

describe("retained plugin CLI support contract", () => {
  it("exposes the plugin CLI helpers without restoring a top-level CLI entry", () => {
    expect(typeof callGatewayFromCli).toBe("function");
    expect(typeof formatHelpExamples).toBe("function");
    expect(typeof inheritOptionFromParent).toBe("function");
    expect(typeof registerCommandGroups).toBe("function");
    expect(typeof resolveCliArgvInvocation).toBe("function");
    expect(typeof runCommandWithRuntime).toBe("function");
    expect(typeof shouldEagerRegisterSubcommands).toBe("function");
  });

  it("formats help examples and inherits explicit parent options", () => {
    expect(formatHelpExamples([["openclaw browser status", "Show status"]], true)).toContain(
      "openclaw browser status",
    );

    const program = new Command().option("--url <url>");
    program.setOptionValueWithSource("url", "ws://127.0.0.1:18789", "cli");
    const child = program.command("browser");

    expect(inheritOptionFromParent<string>(child, "url")).toBe("ws://127.0.0.1:18789");
  });

  it("resolves root options before the retained plugin command", () => {
    expect(
      resolveCliArgvInvocation([
        "node",
        "openclaw",
        "--profile",
        "work",
        "browser",
        "status",
      ]),
    ).toMatchObject({
      commandPath: ["browser", "status"],
      primary: "browser",
      hasHelpOrVersion: false,
      isRootHelpInvocation: false,
    });
    expect(shouldEagerRegisterSubcommands({ OPENCLAW_DISABLE_LAZY_SUBCOMMANDS: "1" })).toBe(true);
  });

  it("registers command groups eagerly when requested", () => {
    const program = new Command();
    registerCommandGroups(
      program,
      [
        {
          placeholders: [{ name: "status", description: "Show status" }],
          register: (target) => {
            target.command("status");
          },
        },
      ],
      { eager: true, primary: null, registerPrimaryOnly: false },
    );

    expect(program.commands.map((command) => command.name())).toEqual(["status"]);
  });

  it("reports retained command failures through RuntimeEnv", async () => {
    const runtime = {
      error: vi.fn(),
      exit: vi.fn(),
    };

    await runCommandWithRuntime(runtime, async () => {
      throw new Error("command failed");
    });

    expect(runtime.error).toHaveBeenCalledWith("command failed");
    expect(runtime.exit).toHaveBeenCalledWith(1);
  });

  it("uses the retained transactional config API instead of the removed updateConfig helper", () => {
    const source = fs.readFileSync(
      `${runtimeRoot}/extensions/github-copilot/login.ts`,
      "utf8",
    );

    expect(source).not.toContain("updateConfig");
    expect(source).toContain("transformConfigFile");
  });
});
