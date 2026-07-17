/**
 * Lightweight MCP tool inputSchema validation (shape + arg conformance).
 * Rejects tools whose schemas are unsafe/unusable and blocks invalid call args.
 */

export type ToolSchemaValidation =
  | { ok: true }
  | { ok: false; reason: string };

const PRIMITIVE_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'null', 'object', 'array']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function typeMatches(expected: string, value: unknown): boolean {
  switch (expected) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    case 'object':
      return isRecord(value);
    case 'array':
      return Array.isArray(value);
    default:
      return false;
  }
}

/**
 * Validate that a tool's inputSchema is a usable JSON-Schema-like object.
 * Rejects non-objects, missing type, and dangerous/invalid shapes.
 */
export function isValidMcpToolInputSchema(schema: unknown): ToolSchemaValidation {
  if (schema == null) {
    // Empty schema is treated as "no args object" ? allowed as {}.
    return { ok: true };
  }
  if (!isRecord(schema)) {
    return { ok: false, reason: 'tool inputSchema must be an object' };
  }
  if (schema.type !== undefined) {
    if (typeof schema.type === 'string') {
      if (!PRIMITIVE_TYPES.has(schema.type)) {
        return { ok: false, reason: `unsupported inputSchema.type "${schema.type}"` };
      }
      if (schema.type !== 'object') {
        return { ok: false, reason: 'tool inputSchema.type must be "object" for MCP tool args' };
      }
    } else if (Array.isArray(schema.type)) {
      if (!schema.type.includes('object')) {
        return { ok: false, reason: 'tool inputSchema.type must include "object"' };
      }
    } else {
      return { ok: false, reason: 'tool inputSchema.type must be a string or array' };
    }
  }
  if (schema.properties !== undefined && !isRecord(schema.properties)) {
    return { ok: false, reason: 'tool inputSchema.properties must be an object' };
  }
  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required) || schema.required.some((entry) => typeof entry !== 'string')) {
      return { ok: false, reason: 'tool inputSchema.required must be a string array' };
    }
  }
  // Reject schemas that try to enable free-form functions / $ref bombs without structure.
  if (schema.$ref && typeof schema.$ref === 'string' && !schema.properties) {
    return { ok: false, reason: 'tool inputSchema $ref without properties is not supported' };
  }
  return { ok: true };
}

/**
 * Validate call args against a previously accepted inputSchema.
 * Fails closed on type/required/additionalProperties violations.
 */
export function validateToolArgsAgainstSchema(
  schema: unknown,
  args: Record<string, unknown>,
): ToolSchemaValidation {
  const shape = isValidMcpToolInputSchema(schema);
  if (!shape.ok) return shape;

  if (schema == null) {
    // No schema ? only empty args allowed.
    if (Object.keys(args).length > 0) {
      return { ok: false, reason: 'tool has no inputSchema; args must be empty' };
    }
    return { ok: true };
  }

  if (!isRecord(schema)) {
    return { ok: false, reason: 'tool inputSchema must be an object' };
  }

  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const additionalProperties = schema.additionalProperties;

  for (const key of required) {
    if (!(key in args) || args[key] === undefined) {
      return { ok: false, reason: `missing required argument "${key}"` };
    }
  }

  for (const [key, value] of Object.entries(args)) {
    if (!(key in properties)) {
      if (additionalProperties === false) {
        return { ok: false, reason: `unexpected argument "${key}"` };
      }
      continue;
    }
    const propSchema = properties[key];
    if (!isRecord(propSchema)) continue;
    const expectedType = propSchema.type;
    if (typeof expectedType === 'string') {
      if (!typeMatches(expectedType, value)) {
        return { ok: false, reason: `argument "${key}" must be ${expectedType}` };
      }
    } else if (Array.isArray(expectedType)) {
      const ok = expectedType.some((entry) => typeof entry === 'string' && typeMatches(entry, value));
      if (!ok) {
        return { ok: false, reason: `argument "${key}" has invalid type` };
      }
    }
  }

  return { ok: true };
}

/** Filter a tools list, dropping tools with invalid schemas (fail closed for listing). */
export function filterToolsWithValidSchemas<T extends { name: string; inputSchema?: unknown }>(
  tools: T[],
): { tools: T[]; rejected: Array<{ name: string; reason: string }> } {
  const accepted: T[] = [];
  const rejected: Array<{ name: string; reason: string }> = [];
  for (const tool of tools) {
    const check = isValidMcpToolInputSchema(tool.inputSchema);
    if (check.ok) {
      accepted.push(tool);
    } else {
      rejected.push({ name: tool.name, reason: check.reason });
    }
  }
  return { tools: accepted, rejected };
}
