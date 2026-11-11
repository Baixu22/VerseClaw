import { ContentBlockSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { isRecord } from "@openclaw/normalization-core/record-coerce";

function text(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Preserve SDK content and tool failure semantics at HTTP and stdio boundaries. */
export function toMcpToolResult(
  value: unknown,
  signal?: AbortSignal,
  protocolVersion?: string,
): CallToolResult {
  const result = isRecord(value) ? value : {};
  const details = isRecord(result.details) ? result.details : {};
  const meta = {
    ...(isRecord(details.mcpMeta) ? details.mcpMeta : {}),
    ...(isRecord(result._meta) ? result._meta : {}),
  };
  const raw = Array.isArray(result.content) ? result.content : [value];
  const losses: string[] = [];
  const content = raw.map((block, index) => {
    const parsed = ContentBlockSchema.safeParse(block);
    if (parsed.success) {
      const unsupported =
        (protocolVersion !== undefined &&
          protocolVersion < "2025-03-26" &&
          parsed.data.type === "audio") ||
        (protocolVersion !== undefined &&
          protocolVersion < "2025-06-18" &&
          parsed.data.type === "resource_link");
      if (!unsupported) return parsed.data;
      losses.push(`${index}:${parsed.data.type}:${protocolVersion}`);
      return {
        type: "text" as const,
        text: `[MCP ${parsed.data.type} converted to text for ${protocolVersion}] ${text(parsed.data)}`,
      };
    }
    if (isRecord(block) && typeof block.type === "string" && block.type !== "text") {
      losses.push(`${index}:${block.type}`);
      return {
        type: "text" as const,
        text: `[MCP content converted to text: ${block.type}] ${text(block)}`,
      };
    }
    return { type: "text" as const, text: text(block) };
  });
  const structured = result.structuredContent ?? details.structuredContent;
  const supportsStructured = protocolVersion === undefined || protocolVersion >= "2025-06-18";
  if (isRecord(structured) && !supportsStructured) {
    content.push({ type: "text", text: `structuredContent:\n${text(structured)}` });
    losses.push(`structuredContent:${protocolVersion}`);
  }
  const status = signal?.aborted
    ? "cancelled"
    : result.approvalRequired === true || details.approvalRequired === true
      ? "waiting"
      : typeof meta["openclaw/resultStatus"] === "string"
        ? meta["openclaw/resultStatus"]
        : typeof details.status === "string"
          ? details.status
          : typeof result.status === "string"
            ? result.status
            : undefined;
  const isError =
    result.isError === true ||
    result.success === false ||
    details.status === "error" ||
    (status !== undefined &&
      [
        "error",
        "failed",
        "cancelled",
        "aborted",
        "timeout",
        "waiting",
        "blocked",
        "denied",
        "unavailable",
      ].includes(status));
  if (status) meta["openclaw/resultStatus"] = status;
  if (signal?.aborted && content.length) meta["openclaw/partial"] = true;
  if (losses.length)
    meta["openclaw/contentLoss"] = [
      ...(Array.isArray(meta["openclaw/contentLoss"]) ? meta["openclaw/contentLoss"] : []),
      ...losses,
    ];
  return {
    content,
    ...(isRecord(structured) && supportsStructured ? { structuredContent: structured } : {}),
    ...(Object.keys(meta).length ? { _meta: meta } : {}),
    isError,
  };
}

export function mcpToolError(error: unknown, signal?: AbortSignal): CallToolResult {
  const record = isRecord(error) ? error : {};
  const status = signal?.aborted
    ? signal.reason?.name === "TimeoutError"
      ? "timeout"
      : "cancelled"
    : typeof record.approvalState === "string"
      ? record.approvalState
      : record.name === "TimeoutError" || record.code === -32001 || record.code === "ETIMEDOUT"
        ? "timeout"
        : record.name === "AbortError"
          ? "cancelled"
          : "error";
  return toMcpToolResult({
    content: [{ type: "text", text: error instanceof Error ? error.message : text(error) }],
    isError: true,
    details: { status },
  });
}
