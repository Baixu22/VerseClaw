/** Builds persisted Cron browser-automation summaries from agent_browser telemetry. */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentBrowserAutomationEvent } from "../agents/tools/agent-browser-automation-event.js";
import type { BrowserAutomationRunResult, CronJob } from "./types.js";

type BrowserAutomationConfigHint = {
  profile?: string;
  authStateName?: string;
  url?: string;
};

const MARKER_START = "<!-- clawx:browser-automation";
const MARKER_END = "-->";
const MAX_TEXT_ARTIFACT_CHARS = 2_000_000;
const MAX_SCREENSHOT_ARTIFACT_BYTES = 10_000_000;

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseBrowserAutomationConfigHint(job: CronJob): BrowserAutomationConfigHint {
  if (job.payload.kind !== "agentTurn") {
    return {};
  }
  const message = job.payload.message;
  const start = message.indexOf(MARKER_START);
  if (start < 0) {
    return {};
  }
  const jsonStart = message.indexOf("\n", start);
  const end = jsonStart >= 0 ? message.indexOf(MARKER_END, jsonStart) : -1;
  if (jsonStart < 0 || end < 0) {
    return {};
  }
  try {
    const parsed = JSON.parse(message.slice(jsonStart + 1, end).trim()) as Record<string, unknown>;
    const profile = optionalString(parsed.profile);
    return {
      ...(optionalString(parsed.url) ? { url: optionalString(parsed.url) } : {}),
      ...(profile ? { profile } : {}),
      ...(optionalString(parsed.authStateName)
        ? { authStateName: optionalString(parsed.authStateName) }
        : profile
          ? { authStateName: profile }
          : {}),
    };
  } catch {
    return {};
  }
}

function inferLoginState(events: AgentBrowserAutomationEvent[]): BrowserAutomationRunResult["loginState"] {
  const text = events
    .flatMap((event) => [event.title, event.textSample, event.error])
    .filter((entry): entry is string => Boolean(entry))
    .join("\n")
    .toLowerCase();
  if (/\b(log in|login|sign in|signin|登录|登陆)\b/.test(text)) {
    return "login-required";
  }
  if (events.some((event) => event.ok && event.action !== "status")) {
    return "authenticated";
  }
  return "unknown";
}

function latestString(
  events: AgentBrowserAutomationEvent[],
  selector: (event: AgentBrowserAutomationEvent) => string | undefined,
): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const value = selector(events[index]!);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function eventDetail(event: AgentBrowserAutomationEvent): string | undefined {
  const detail = [
    event.finalUrl ? `url=${event.finalUrl}` : undefined,
    event.title ? `title=${event.title}` : undefined,
    event.command?.length ? `command=${event.command.join(" ")}` : undefined,
    event.error ? `error=${event.error}` : undefined,
  ].filter(Boolean);
  return detail.length ? detail.join(" ") : undefined;
}

function collectConsoleErrors(events: AgentBrowserAutomationEvent[]): string[] {
  return events
    .flatMap((event) => [event.stderr, event.error])
    .filter((entry): entry is string => Boolean(entry))
    .flatMap((entry) => entry.split(/\r?\n/u))
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 20);
}

function safePathComponent(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.slice(0, 96) || "unknown";
}

function parseScreenshotDataUrl(dataUrl: string): { mimeType: string; bytes: Buffer } | null {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=]+)$/u.exec(dataUrl.trim());
  if (!match) {
    return null;
  }
  const bytes = Buffer.from(match[2]!, "base64");
  if (bytes.length <= 0 || bytes.length > MAX_SCREENSHOT_ARTIFACT_BYTES) {
    return null;
  }
  return { mimeType: match[1]!, bytes };
}

function commandArtifactKind(
  command: string[] | undefined,
): BrowserAutomationRunResult["evidence"]["artifacts"][number]["kind"] {
  const joined = (command ?? []).join(" ").toLowerCase();
  if (joined.includes("snapshot")) return "snapshot";
  if (joined.includes("console")) return "console";
  if (joined.includes("errors")) return "errors";
  if (joined.includes("network")) return "network";
  if (joined.includes("trace")) return "trace";
  return "other";
}

function artifactExtension(kind: BrowserAutomationRunResult["evidence"]["artifacts"][number]["kind"]) {
  return kind === "screenshot" ? "png" : "json";
}

async function writeJsonOrTextArtifact(params: {
  dir: string;
  fileBase: string;
  kind: BrowserAutomationRunResult["evidence"]["artifacts"][number]["kind"];
  text: string;
  label: string;
}): Promise<BrowserAutomationRunResult["evidence"]["artifacts"][number] | null> {
  const text = params.text.slice(0, MAX_TEXT_ARTIFACT_CHARS);
  let content;
  let extension = "txt";
  let mimeType = "text/plain";
  try {
    content = `${JSON.stringify(JSON.parse(text), null, 2)}\n`;
    extension = artifactExtension(params.kind);
    mimeType = "application/json";
  } catch {
    content = `${text}\n`;
  }
  const artifactPath = path.join(params.dir, `${params.fileBase}.${extension}`);
  await writeFile(artifactPath, content, "utf8");
  return {
    kind: params.kind,
    path: artifactPath,
    label: params.label,
    mimeType,
    bytes: Buffer.byteLength(content, "utf8"),
  };
}

async function persistArtifacts(params: {
  artifactRootDir?: string;
  jobId: string;
  runId: string;
  events: AgentBrowserAutomationEvent[];
}): Promise<BrowserAutomationRunResult["evidence"]["artifacts"]> {
  if (!params.artifactRootDir) {
    return [];
  }
  const artifactDir = path.resolve(
    params.artifactRootDir,
    "cron-browser-artifacts",
    safePathComponent(params.jobId),
    safePathComponent(params.runId),
  );
  const artifacts: BrowserAutomationRunResult["evidence"]["artifacts"] = [];
  try {
    await mkdir(artifactDir, { recursive: true });
    for (const [index, event] of params.events.entries()) {
      const prefix = `${String(index + 1).padStart(2, "0")}-${safePathComponent(event.action)}`;
      if (event.screenshotDataUrl) {
        const screenshot = parseScreenshotDataUrl(event.screenshotDataUrl);
        if (screenshot) {
          const artifactPath = path.join(artifactDir, `${prefix}-screenshot.png`);
          await writeFile(artifactPath, screenshot.bytes);
          artifacts.push({
            kind: "screenshot",
            path: artifactPath,
            label: "agent_browser screenshot",
            mimeType: screenshot.mimeType,
            bytes: screenshot.bytes.length,
          });
        }
      }
      const commandOutput = event.stdout || event.stderr;
      if (event.action === "command" && commandOutput) {
        const kind = commandArtifactKind(event.command);
        const artifact = await writeJsonOrTextArtifact({
          dir: artifactDir,
          fileBase: `${prefix}-${kind}`,
          kind,
          text: commandOutput,
          label: event.command?.length ? `agent_browser ${event.command.join(" ")}` : "agent_browser command",
        });
        if (artifact) {
          artifacts.push(artifact);
        }
      }
    }
  } catch {
    // Artifact persistence is diagnostic-only; Cron run status must reflect the browser task, not disk evidence best-effort.
  }
  return artifacts;
}

export function buildCronBrowserAutomationRunResult(params: {
  job: CronJob;
  runId: string;
  status: "success" | "failed";
  startedAt: number;
  endedAt: number;
  events?: AgentBrowserAutomationEvent[];
  error?: string;
}): BrowserAutomationRunResult | undefined {
  return buildCronBrowserAutomationRunResultFromArtifacts({ ...params, artifacts: undefined });
}

function buildCronBrowserAutomationRunResultFromArtifacts(params: {
  job: CronJob;
  runId: string;
  status: "success" | "failed";
  startedAt: number;
  endedAt: number;
  events?: AgentBrowserAutomationEvent[];
  error?: string;
  artifacts?: BrowserAutomationRunResult["evidence"]["artifacts"];
}): BrowserAutomationRunResult | undefined {
  const events = params.events?.filter((event) => event.tool === "agent_browser") ?? [];
  if (events.length === 0) {
    return undefined;
  }
  const hint = parseBrowserAutomationConfigHint(params.job);
  const failedEvent = events.find((event) => !event.ok);
  const error = params.error ?? failedEvent?.error;
  const status = params.status === "failed" || failedEvent ? "failed" : "success";
  const textSample = latestString(events, (event) => event.textSample);
  const screenshotDataUrl = latestString(events, (event) => event.screenshotDataUrl);
  const profile = latestString(events, (event) => event.profile) ?? hint.profile;
  const authStateName = latestString(events, (event) => event.authStateName) ?? hint.authStateName;
  const finalUrl = latestString(events, (event) => event.finalUrl) ?? hint.url;
  const title = latestString(events, (event) => event.title);
  const consoleErrors = collectConsoleErrors(events);
  return {
    schemaVersion: 1,
    runId: params.runId,
    status,
    startedAt: new Date(params.startedAt).toISOString(),
    endedAt: new Date(params.endedAt).toISOString(),
    ...(profile ? { profile } : {}),
    ...(authStateName ? { authStateName } : {}),
    ...(finalUrl ? { finalUrl } : {}),
    ...(title ? { title } : {}),
    loginState: inferLoginState(events),
    steps: events.map((event, index) => ({
      id: `agent_browser_${index + 1}`,
      label: event.action,
      status: event.ok ? "passed" : "failed",
      ...(eventDetail(event) ? { detail: eventDetail(event) } : {}),
      at: new Date(event.ts).toISOString(),
    })),
    evidence: {
      ...(textSample ? { textSample } : {}),
      artifacts: params.artifacts?.length
        ? params.artifacts
        : screenshotDataUrl
        ? [
            {
              kind: "screenshot",
              label: "agent_browser screenshot data URL captured in tool result",
            },
          ]
        : [],
    },
    ...(consoleErrors.length ? { consoleErrors } : {}),
    ...(error ? { error } : {}),
  };
}

export async function buildCronBrowserAutomationRunResultWithArtifacts(params: {
  job: CronJob;
  runId: string;
  status: "success" | "failed";
  startedAt: number;
  endedAt: number;
  events?: AgentBrowserAutomationEvent[];
  error?: string;
  artifactRootDir?: string;
}): Promise<BrowserAutomationRunResult | undefined> {
  const events = params.events?.filter((event) => event.tool === "agent_browser") ?? [];
  if (events.length === 0) {
    return undefined;
  }
  const artifacts = await persistArtifacts({
    artifactRootDir: params.artifactRootDir,
    jobId: params.job.id,
    runId: params.runId,
    events,
  });
  return buildCronBrowserAutomationRunResultFromArtifacts({
    ...params,
    events,
    artifacts,
  });
}
