// Public library facade for consumers embedding OpenClaw reply runtime APIs.
import type { getReplyFromConfig as getReplyFromConfigRuntime } from "./auto-reply/reply.runtime.js";
import { applyTemplate } from "./auto-reply/templating.js";
import { createDefaultDeps } from "./gateway/cli-runtime/deps.js";
import { loadConfig } from "./config/config.js";
import { resolveStorePath } from "./config/sessions/paths.js";
import { deriveSessionKey, resolveSessionKey } from "./config/sessions/session-key.js";
import { loadSessionStore, saveSessionStore } from "./config/sessions/store.js";
import type { ensureBinary as ensureBinaryRuntime } from "./infra/binaries.js";
import {
  describePortOwner,
  ensurePortAvailable,
  handlePortError,
  PortInUseError,
} from "./infra/ports.js";
import type { monitorWebChannel as monitorWebChannelRuntime } from "./plugins/runtime/runtime-web-channel-plugin.js";
import type {
  runCommandWithTimeout as runCommandWithTimeoutRuntime,
  runExec as runExecRuntime,
} from "./process/exec.js";
import { normalizeE164 } from "./utils.js";

type GetReplyFromConfig = typeof getReplyFromConfigRuntime;
type PromptYesNo = (message: string, defaultValue?: boolean) => Promise<boolean>;
type EnsureBinary = typeof ensureBinaryRuntime;
type RunExec = typeof runExecRuntime;
type RunCommandWithTimeout = typeof runCommandWithTimeoutRuntime;
type MonitorWebChannel = typeof monitorWebChannelRuntime;

const waitForever = () => new Promise<never>(() => {});

// promptYesNo is CLI-only. In headless gateway runtime, throw.
const promptYesNo: PromptYesNo = async () => {
  throw new Error("promptYesNo is not available in headless gateway runtime");
};

let replyRuntimePromise: Promise<typeof import("./auto-reply/reply.runtime.js")> | null = null;
let binariesRuntimePromise: Promise<typeof import("./infra/binaries.js")> | null = null;
let execRuntimePromise: Promise<typeof import("./process/exec.js")> | null = null;
let webChannelRuntimePromise: Promise<
  typeof import("./plugins/runtime/runtime-web-channel-plugin.js")
> | null = null;

function loadReplyRuntime() {
  replyRuntimePromise ??= import("./auto-reply/reply.runtime.js");
  return replyRuntimePromise;
}

function loadBinariesRuntime() {
  binariesRuntimePromise ??= import("./infra/binaries.js");
  return binariesRuntimePromise;
}

function loadExecRuntime() {
  execRuntimePromise ??= import("./process/exec.js");
  return execRuntimePromise;
}

function loadWebChannelRuntime() {
  webChannelRuntimePromise ??= import("./plugins/runtime/runtime-web-channel-plugin.js");
  return webChannelRuntimePromise;
}

export const getReplyFromConfig: GetReplyFromConfig = async (...args) =>
  (await loadReplyRuntime()).getReplyFromConfig(...args);
export const ensureBinary: EnsureBinary = async (...args) =>
  (await loadBinariesRuntime()).ensureBinary(...args);
export const runExec: RunExec = async (...args) => (await loadExecRuntime()).runExec(...args);
export const runCommandWithTimeout: RunCommandWithTimeout = async (...args) =>
  (await loadExecRuntime()).runCommandWithTimeout(...args);
export const monitorWebChannel: MonitorWebChannel = async (...args) =>
  (await loadWebChannelRuntime()).monitorWebChannel(...args);

export {
  applyTemplate,
  createDefaultDeps,
  deriveSessionKey,
  describePortOwner,
  ensurePortAvailable,
  handlePortError,
  loadConfig,
  loadSessionStore,
  normalizeE164,
  PortInUseError,
  promptYesNo,
  resolveSessionKey,
  resolveStorePath,
  saveSessionStore,
  waitForever,
};
