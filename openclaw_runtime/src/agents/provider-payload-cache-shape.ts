/**
 * Stable provider-payload helpers for prompt-cache diagnostics.
 */
import crypto from "node:crypto";
import { stableStringify } from "./stable-stringify.js";

type JsonRecord = Record<string, unknown>;

export type ProviderPayloadCacheShape = {
  systemHash?: string;
  messagesHash?: string;
  toolsHash?: string;
  prefixShapeHash: string;
  paramsHash: string;
  toolCount: number;
  toolNames: string[];
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function digest(value: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableObjectFromEntries(entries: Array<[string, unknown]>): JsonRecord {
  return Object.fromEntries(entries.toSorted(([left], [right]) => left.localeCompare(right)));
}

function schemaArraySortValue(value: unknown): string {
  return stableStringify(value);
}

function canonicalizeDependentRequired(value: unknown): unknown {
  if (!isRecord(value)) {
    return undefined;
  }
  const entries: Array<[string, unknown]> = [];
  for (const [key, inner] of Object.entries(value)) {
    if (!Array.isArray(inner)) {
      continue;
    }
    entries.push([key, inner.map(canonicalizeSchemaValue).toSorted((a, b) => {
      return schemaArraySortValue(a).localeCompare(schemaArraySortValue(b));
    })]);
  }
  return stableObjectFromEntries(entries);
}

function canonicalizeSchemaValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeSchemaValue);
  }
  if (!isRecord(value)) {
    return value;
  }

  const entries: Array<[string, unknown]> = [];
  for (const [key, raw] of Object.entries(value)) {
    if (key === "required") {
      if (!Array.isArray(raw)) {
        continue;
      }
      const required = raw.map(canonicalizeSchemaValue).toSorted((a, b) => {
        return schemaArraySortValue(a).localeCompare(schemaArraySortValue(b));
      });
      entries.push([key, required]);
      continue;
    }

    if (key === "dependentRequired") {
      const dependentRequired = canonicalizeDependentRequired(raw);
      if (dependentRequired !== undefined) {
        entries.push([key, dependentRequired]);
      }
      continue;
    }

    entries.push([key, canonicalizeSchemaValue(raw)]);
  }

  const result = stableObjectFromEntries(entries);
  if (result.type === "object" && !isRecord(result.properties)) {
    result.properties = {};
  }
  return stableObjectFromEntries(Object.entries(result));
}

export function canonicalizeProviderToolSchema(schema: unknown): unknown {
  if (schema === undefined || schema === null) {
    return { properties: {}, type: "object" };
  }
  return canonicalizeSchemaValue(schema);
}

function readToolName(tool: JsonRecord): string {
  const functionValue = tool.function;
  if (isRecord(functionValue) && typeof functionValue.name === "string") {
    return functionValue.name;
  }
  return typeof tool.name === "string" ? tool.name : "";
}

function canonicalizeTool(tool: unknown): unknown {
  if (!isRecord(tool)) {
    return tool;
  }
  const functionValue = tool.function;
  if (isRecord(functionValue)) {
    const fn: JsonRecord = {
      ...functionValue,
      name: typeof functionValue.name === "string" ? functionValue.name : "",
      description:
        typeof functionValue.description === "string" ? functionValue.description : "",
      parameters: canonicalizeProviderToolSchema(functionValue.parameters),
    };
    return stableObjectFromEntries([
      ...Object.entries(tool).filter(([key]) => key !== "function" && key !== "type"),
      ["function", stableObjectFromEntries(Object.entries(fn))],
      ["type", typeof tool.type === "string" ? tool.type : "function"],
    ]);
  }

  if (tool.type === "function" || typeof tool.name === "string") {
    const responseTool: JsonRecord = {
      ...tool,
      type: typeof tool.type === "string" ? tool.type : "function",
      name: typeof tool.name === "string" ? tool.name : "",
      description: typeof tool.description === "string" ? tool.description : "",
      parameters: canonicalizeProviderToolSchema(tool.parameters),
    };
    return stableObjectFromEntries(Object.entries(responseTool));
  }

  return canonicalizeSchemaValue(tool);
}

export function canonicalizeProviderTools(tools: unknown): unknown {
  if (!Array.isArray(tools)) {
    return tools;
  }
  return tools.map(canonicalizeTool).toSorted((left, right) => {
    const leftRecord = isRecord(left) ? left : {};
    const rightRecord = isRecord(right) ? right : {};
    const nameCompare = readToolName(leftRecord).localeCompare(readToolName(rightRecord));
    if (nameCompare !== 0) {
      return nameCompare;
    }
    return stableStringify(left).localeCompare(stableStringify(right));
  });
}

export function canonicalizeOpenAIProviderPayload<T extends JsonRecord>(payload: T): T {
  const entries: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(payload)) {
    if (key === "tools") {
      entries.push([key, canonicalizeProviderTools(value)]);
      continue;
    }
    if (key === "signal") {
      continue;
    }
    entries.push([key, value]);
  }
  return stableObjectFromEntries(entries) as T;
}

function extractSystemFromMessages(messages: unknown): unknown {
  if (!Array.isArray(messages)) {
    return undefined;
  }
  return messages.find((message) => isRecord(message) && message.role === "system");
}

function extractSystemFromResponsesInput(input: unknown): unknown {
  if (!Array.isArray(input)) {
    return undefined;
  }
  return input.find((item) => isRecord(item) && item.type === "message" && item.role === "system");
}

function toolNamesFromPayloadTools(tools: unknown): string[] {
  if (!Array.isArray(tools)) {
    return [];
  }
  return tools
    .map((tool) => (isRecord(tool) ? readToolName(tool) : ""))
    .filter((name) => name.length > 0)
    .toSorted();
}

export function summarizeProviderPayloadCacheShape(payload: unknown): ProviderPayloadCacheShape {
  const record = isRecord(payload) ? canonicalizeOpenAIProviderPayload(payload) : {};
  const messages = record.messages ?? record.input;
  const system = record.messages ? extractSystemFromMessages(record.messages) : extractSystemFromResponsesInput(record.input);
  const tools = record.tools;
  const toolNames = toolNamesFromPayloadTools(tools);
  const prefixShape = {
    system: system ?? null,
    tools: tools ?? null,
  };

  return {
    ...(system !== undefined ? { systemHash: digest(system) } : {}),
    ...(messages !== undefined ? { messagesHash: digest(messages) } : {}),
    ...(tools !== undefined ? { toolsHash: digest(tools) } : {}),
    prefixShapeHash: digest(prefixShape),
    paramsHash: digest(record),
    toolCount: toolNames.length,
    toolNames,
  };
}
