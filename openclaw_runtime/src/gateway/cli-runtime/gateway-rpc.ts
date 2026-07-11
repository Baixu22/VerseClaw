import type { Command } from "commander";
import {
  GATEWAY_CLIENT_MODES,
  GATEWAY_CLIENT_NAMES,
  type GatewayClientMode,
  type GatewayClientName,
} from "../../../packages/gateway-protocol/src/client-info.js";
import { callGateway } from "../call.js";
import type { OperatorScope } from "../operator-scopes.js";
import type { DeviceIdentity } from "../../infra/device-identity.js";

export type GatewayRpcOpts = {
  url?: string;
  token?: string;
  timeout?: string;
  expectFinal?: boolean;
  json?: boolean;
};

const DEFAULT_GATEWAY_RPC_TIMEOUT_MS = 30_000;

function resolveTimeoutMs(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_GATEWAY_RPC_TIMEOUT_MS;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("--timeout must be a positive integer.");
  }
  return parsed;
}

export function addGatewayClientOptions(command: Command): Command {
  return command
    .option("--url <url>", "Gateway WebSocket URL (defaults to gateway.remote.url when configured)")
    .option("--token <token>", "Gateway token (if required)")
    .option("--timeout <ms>", "Timeout in ms", String(DEFAULT_GATEWAY_RPC_TIMEOUT_MS))
    .option("--expect-final", "Wait for final response (agent)", false);
}

export async function callGatewayFromCli(
  method: string,
  opts: GatewayRpcOpts,
  params?: unknown,
  extra?: {
    clientName?: GatewayClientName;
    mode?: GatewayClientMode;
    deviceIdentity?: DeviceIdentity | null;
    signal?: AbortSignal;
    expectFinal?: boolean;
    progress?: boolean;
    scopes?: OperatorScope[];
  },
): Promise<unknown> {
  return await callGateway({
    url: opts.url,
    token: opts.token,
    method,
    params,
    deviceIdentity: extra?.deviceIdentity,
    expectFinal: extra?.expectFinal ?? Boolean(opts.expectFinal),
    scopes: extra?.scopes,
    signal: extra?.signal,
    timeoutMs: resolveTimeoutMs(opts.timeout),
    clientName: extra?.clientName ?? GATEWAY_CLIENT_NAMES.CLI,
    mode: extra?.mode ?? GATEWAY_CLIENT_MODES.CLI,
  });
}
