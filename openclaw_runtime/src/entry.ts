#!/usr/bin/env node
import process from "node:process";
import { startGatewayServer } from "./gateway/server.js";

function readOption(args: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function readPort(args: string[]): number {
  const raw = readOption(args, "--port") ?? process.env.OPENCLAW_GATEWAY_PORT ?? "18789";
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 18789;
}

function readBooleanFlag(args: string[], name: string, envName: string): boolean {
  const raw = readOption(args, name) ?? process.env[envName];
  if (raw !== undefined) {
    return /^(1|true|yes|on)$/i.test(raw.trim());
  }
  return args.includes(name);
}

const args = process.argv.slice(2);
const port = readPort(args);
const token = readOption(args, "--token") ?? process.env.OPENCLAW_GATEWAY_TOKEN ?? "";
const bind = readOption(args, "--bind") ?? process.env.OPENCLAW_GATEWAY_BIND ?? "loopback";
const deferStartupSidecars = readBooleanFlag(
  args,
  "--defer-startup-sidecars",
  "OPENCLAW_DEFER_STARTUP_SIDECARS",
);

if (token) {
  process.env.OPENCLAW_GATEWAY_TOKEN = token;
}

await startGatewayServer(port, {
  bind: bind as NonNullable<Parameters<typeof startGatewayServer>[1]>["bind"],
  auth: token ? { token } : undefined,
  deferStartupSidecars,
});
