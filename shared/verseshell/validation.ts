import { VerseShellContractError } from './errors.js';
import {
  DEFAULT_MAX_HANDSHAKE_BYTES,
  DEFAULT_MAX_OBSERVATION_BYTES,
  DEFAULT_MAX_REQUEST_BYTES,
  DEFAULT_OBSERVATION_MAX_TOKENS,
  DEFAULT_OPERATION_TIMEOUT_MS,
  VERSESHELL_CRATE_VERSION,
  VERSESHELL_MCP_PROTOCOL_VERSION,
  VERSESHELL_OBSERVATION_SCHEMA,
  VERSESHELL_OPERATION_CATALOG_SCHEMA,
  VERSESHELL_SERVER_NAME,
  VERSESHELL_SERVER_PROTOCOL,
  type Diagnostic,
  type JsonObject,
  type JsonSchema,
  type JsonValue,
  type Observation,
  type ObservationMeta,
  type OperationCatalogEntry,
  type OperationError,
  type OperationRequest,
  type ProtocolHandshake,
  type ProtocolManifest,
  type RuntimeHandshakeData,
  type SuggestedAction,
  type SuggestedFix,
} from './types.js';

export interface DecodeOperationRequestOptions {
  max_bytes?: number;
  expected_id?: string;
  expected_op?: string;
  input_schema?: JsonSchema;
}

export interface DecodeObservationOptions {
  max_bytes?: number;
  expected_id?: string;
  expected_op?: string;
  expected_schema?: string;
}

export interface DecodeHandshakeOptions {
  max_bytes?: number;
  expected_protocol_version?: string;
  expected_server_version?: string;
}

export interface DecodeRuntimeHandshakeOptions {
  max_bytes?: number;
  expected_runtime_version?: string;
  expected_server_protocol?: string;
  expected_workspace_id?: string;
  expected_catalog_digest?: string;
}

const textEncoder = new TextEncoder();

type UnknownRecord = Record<string, unknown>;

function fail(
  code: ConstructorParameters<typeof VerseShellContractError>[0],
  path: string,
  message: string,
  expected?: unknown,
  actual?: unknown,
): never {
  throw new VerseShellContractError(code, `${path}: ${message}`, {
    path,
    expected,
    actual,
  });
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown, path: string): UnknownRecord {
  if (!isRecord(value)) fail('invalid_shape', path, 'expected an object', 'object', value);
  return value;
}

function exactKeys(value: UnknownRecord, allowed: readonly string[], path: string): void {
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(value).find((key) => !allowedSet.has(key));
  if (unexpected) fail('invalid_shape', `${path}.${unexpected}`, 'unexpected field');
}

function string(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    fail('invalid_shape', path, allowEmpty ? 'expected a string' : 'expected a non-empty string', 'string', value);
  }
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail('invalid_shape', path, 'expected a boolean', 'boolean', value);
  return value;
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    fail('invalid_shape', path, `expected a safe integer >= ${minimum}`, `integer >= ${minimum}`, value);
  }
  return value as number;
}

function optionalString(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : string(value, path, true);
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) fail('invalid_shape', path, 'expected an array', 'array', value);
  return value.map((entry, index) => string(entry, `${path}[${index}]`, true));
}

function assertJsonValue(value: unknown, path: string): asserts value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('invalid_shape', path, 'JSON numbers must be finite');
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonValue(entry, `${path}[${index}]`));
    return;
  }
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) fail('invalid_shape', `${path}.${key}`, 'undefined is not JSON');
      assertJsonValue(entry, `${path}.${key}`);
    }
    return;
  }
  fail('invalid_shape', path, 'expected a JSON value');
}

function parseBounded(input: string | unknown, maxBytes: number, label: string): unknown {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    fail('invalid_shape', `${label}.max_bytes`, 'expected a positive safe integer');
  }
  if (typeof input === 'string') {
    const size = textEncoder.encode(input).byteLength;
    if (size > maxBytes) {
      fail('max_bytes_exceeded', label, `payload is ${size} bytes; limit is ${maxBytes}`, maxBytes, size);
    }
    try {
      return JSON.parse(input) as unknown;
    } catch (cause) {
      throw new VerseShellContractError('invalid_json', `${label}: malformed JSON`, {
        path: label,
        cause,
      });
    }
  }

  assertJsonValue(input, label);
  let serialized: string;
  try {
    serialized = JSON.stringify(input);
  } catch (cause) {
    throw new VerseShellContractError('invalid_shape', `${label}: value is not serializable JSON`, {
      path: label,
      cause,
    });
  }
  const size = textEncoder.encode(serialized).byteLength;
  if (size > maxBytes) {
    fail('max_bytes_exceeded', label, `payload is ${size} bytes; limit is ${maxBytes}`, maxBytes, size);
  }
  return input;
}

function decodeJsonObject(value: unknown, path: string): JsonObject {
  const object = record(value, path);
  assertJsonValue(object, path);
  return object as JsonObject;
}

function decodeJsonSchema(value: unknown, path: string): JsonSchema {
  const schema = record(value, path);
  exactKeys(
    schema,
    [
      'type',
      'properties',
      'required',
      'additionalProperties',
      'items',
      'enum',
      'description',
      'default',
      'minItems',
      'minimum',
    ],
    path,
  );
  const type = schema.type === undefined ? undefined : string(schema.type, `${path}.type`);
  if (
    type !== undefined &&
    !['object', 'array', 'string', 'integer', 'number', 'boolean', 'null'].includes(type)
  ) {
    fail('invalid_shape', `${path}.type`, 'unsupported JSON Schema type', undefined, type);
  }

  let properties: Record<string, JsonSchema> | undefined;
  if (schema.properties !== undefined) {
    const rawProperties = record(schema.properties, `${path}.properties`);
    properties = Object.fromEntries(
      Object.entries(rawProperties).map(([key, entry]) => [
        key,
        decodeJsonSchema(entry, `${path}.properties.${key}`),
      ]),
    );
  }

  const required = schema.required === undefined ? undefined : stringArray(schema.required, `${path}.required`);
  if (required && new Set(required).size !== required.length) {
    fail('invalid_shape', `${path}.required`, 'required names must be unique');
  }
  for (const name of required ?? []) {
    if (!properties || !(name in properties)) {
      fail('invalid_shape', `${path}.required`, `required property ${JSON.stringify(name)} is not declared`);
    }
  }

  let additionalProperties: boolean | JsonSchema | undefined;
  if (typeof schema.additionalProperties === 'boolean') {
    additionalProperties = schema.additionalProperties;
  } else if (schema.additionalProperties !== undefined) {
    additionalProperties = decodeJsonSchema(schema.additionalProperties, `${path}.additionalProperties`);
  }

  const items = schema.items === undefined ? undefined : decodeJsonSchema(schema.items, `${path}.items`);
  let enumValues: JsonValue[] | undefined;
  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0) {
      fail('invalid_shape', `${path}.enum`, 'expected a non-empty array');
    }
    schema.enum.forEach((entry, index) => assertJsonValue(entry, `${path}.enum[${index}]`));
    enumValues = schema.enum as JsonValue[];
  }

  const result: JsonSchema = {};
  if (type !== undefined) result.type = type as JsonSchema['type'];
  if (properties !== undefined) result.properties = properties;
  if (required !== undefined) result.required = required;
  if (additionalProperties !== undefined) result.additionalProperties = additionalProperties;
  if (items !== undefined) result.items = items;
  if (enumValues !== undefined) result.enum = enumValues;
  if (schema.description !== undefined) result.description = string(schema.description, `${path}.description`, true);
  if (schema.default !== undefined) {
    assertJsonValue(schema.default, `${path}.default`);
    result.default = schema.default;
  }
  if (schema.minItems !== undefined) result.minItems = integer(schema.minItems, `${path}.minItems`);
  if (schema.minimum !== undefined) {
    if (typeof schema.minimum !== 'number' || !Number.isFinite(schema.minimum)) {
      fail('invalid_shape', `${path}.minimum`, 'expected a finite number');
    }
    result.minimum = schema.minimum;
  }
  return result;
}

export function validateOperationArgs(schemaInput: JsonSchema, argsInput: unknown): asserts argsInput is JsonValue {
  const schema = decodeJsonSchema(schemaInput, '$schema');
  assertJsonValue(argsInput, '$args');
  validateSchemaValue(schema, argsInput, '$args');
}

function validateSchemaValue(schema: JsonSchema, value: JsonValue, path: string): void {
  if (schema.enum && !schema.enum.some((candidate) => JSON.stringify(candidate) === JSON.stringify(value))) {
    fail('argument_schema_mismatch', path, 'value is not in enum', schema.enum, value);
  }

  switch (schema.type) {
    case 'object': {
      if (!isRecord(value)) fail('argument_schema_mismatch', path, 'expected an object', 'object', value);
      const properties = schema.properties ?? {};
      for (const required of schema.required ?? []) {
        if (!Object.prototype.hasOwnProperty.call(value, required)) {
          fail('argument_schema_mismatch', `${path}.${required}`, 'required property is missing');
        }
      }
      for (const [key, entry] of Object.entries(value)) {
        const childSchema = properties[key];
        if (childSchema) {
          validateSchemaValue(childSchema, entry as JsonValue, `${path}.${key}`);
        } else if (schema.additionalProperties === false) {
          fail('argument_schema_mismatch', `${path}.${key}`, 'additional property is not allowed');
        } else if (isRecord(schema.additionalProperties)) {
          validateSchemaValue(schema.additionalProperties as JsonSchema, entry as JsonValue, `${path}.${key}`);
        }
      }
      break;
    }
    case 'array':
      if (!Array.isArray(value)) fail('argument_schema_mismatch', path, 'expected an array', 'array', value);
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        fail('argument_schema_mismatch', path, `expected at least ${schema.minItems} items`);
      }
      if (schema.items) {
        value.forEach((entry, index) => validateSchemaValue(schema.items!, entry, `${path}[${index}]`));
      }
      break;
    case 'string':
      if (typeof value !== 'string') fail('argument_schema_mismatch', path, 'expected a string', 'string', value);
      break;
    case 'integer':
      if (!Number.isSafeInteger(value)) fail('argument_schema_mismatch', path, 'expected an integer', 'integer', value);
      if (schema.minimum !== undefined && (value as number) < schema.minimum) {
        fail('argument_schema_mismatch', path, `expected a number >= ${schema.minimum}`);
      }
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        fail('argument_schema_mismatch', path, 'expected a finite number', 'number', value);
      }
      if (schema.minimum !== undefined && value < schema.minimum) {
        fail('argument_schema_mismatch', path, `expected a number >= ${schema.minimum}`);
      }
      break;
    case 'boolean':
      if (typeof value !== 'boolean') fail('argument_schema_mismatch', path, 'expected a boolean', 'boolean', value);
      break;
    case 'null':
      if (value !== null) fail('argument_schema_mismatch', path, 'expected null', null, value);
      break;
    case undefined:
      break;
  }
}

function decodeSuggestedFix(value: unknown, path: string): SuggestedFix {
  const object = record(value, path);
  exactKeys(object, ['action', 'tool', 'args', 'reason'], path);
  const result: SuggestedFix = {
    action: string(object.action, `${path}.action`),
    reason: string(object.reason, `${path}.reason`, true),
  };
  if (object.tool !== undefined) result.tool = string(object.tool, `${path}.tool`);
  if (object.args !== undefined) {
    assertJsonValue(object.args, `${path}.args`);
    result.args = object.args;
  }
  return result;
}

function decodeOperationError(value: unknown, path: string): OperationError {
  const object = record(value, path);
  exactKeys(object, ['code', 'message', 'recoverable', 'hint', 'fix'], path);
  const result: OperationError = {
    code: string(object.code, `${path}.code`),
    message: string(object.message, `${path}.message`, true),
    recoverable: boolean(object.recoverable, `${path}.recoverable`),
  };
  if (object.hint !== undefined) result.hint = string(object.hint, `${path}.hint`, true);
  if (object.fix !== undefined) result.fix = decodeSuggestedFix(object.fix, `${path}.fix`);
  return result;
}

function decodeDiagnostic(value: unknown, path: string): Diagnostic {
  const object = record(value, path);
  exactKeys(
    object,
    [
      'tool',
      'severity',
      'message',
      'path',
      'line',
      'column',
      'code',
      'expected',
      'found',
      'suggested_fix',
    ],
    path,
  );
  const result: Diagnostic = {
    tool: string(object.tool, `${path}.tool`),
    severity: string(object.severity, `${path}.severity`),
    message: string(object.message, `${path}.message`, true),
  };
  result.path = optionalString(object.path, `${path}.path`);
  result.code = optionalString(object.code, `${path}.code`);
  result.expected = optionalString(object.expected, `${path}.expected`);
  result.found = optionalString(object.found, `${path}.found`);
  result.suggested_fix = optionalString(object.suggested_fix, `${path}.suggested_fix`);
  if (object.line !== undefined) result.line = integer(object.line, `${path}.line`);
  if (object.column !== undefined) result.column = integer(object.column, `${path}.column`);
  return Object.fromEntries(Object.entries(result).filter(([, entry]) => entry !== undefined)) as unknown as Diagnostic;
}

function decodeSuggestedAction(value: unknown, path: string): SuggestedAction {
  const object = record(value, path);
  exactKeys(object, ['op', 'args'], path);
  assertJsonValue(object.args, `${path}.args`);
  return { op: string(object.op, `${path}.op`), args: object.args };
}

function decodeObservationMeta(value: unknown, path: string): ObservationMeta {
  const object = record(value, path);
  exactKeys(object, ['elapsed_ms', 'profile', 'token_estimate', 'effects', 'capabilities_used'], path);
  const result: ObservationMeta = {
    elapsed_ms: integer(object.elapsed_ms, `${path}.elapsed_ms`),
    profile: string(object.profile, `${path}.profile`, true),
    token_estimate: integer(object.token_estimate, `${path}.token_estimate`),
  };
  if (object.effects !== undefined) result.effects = stringArray(object.effects, `${path}.effects`);
  if (object.capabilities_used !== undefined) {
    result.capabilities_used = stringArray(object.capabilities_used, `${path}.capabilities_used`);
  }
  return result;
}

export function decodeOperationRequest(
  input: string | unknown,
  options: DecodeOperationRequestOptions = {},
): OperationRequest {
  const value = parseBounded(input, options.max_bytes ?? DEFAULT_MAX_REQUEST_BYTES, '$request');
  const object = record(value, '$request');
  exactKeys(object, ['id', 'agent', 'op', 'args', 'timeout_ms', 'budget'], '$request');

  const id = string(object.id, '$request.id');
  const op = string(object.op, '$request.op');
  const args = object.args === undefined ? {} : decodeJsonObject(object.args, '$request.args');
  const budgetObject = object.budget === undefined ? {} : record(object.budget, '$request.budget');
  exactKeys(budgetObject, ['max_tokens'], '$request.budget');
  const result: OperationRequest = {
    id,
    agent: object.agent === undefined ? 'default' : string(object.agent, '$request.agent'),
    op,
    args,
    timeout_ms:
      object.timeout_ms === undefined
        ? DEFAULT_OPERATION_TIMEOUT_MS
        : integer(object.timeout_ms, '$request.timeout_ms', 1),
    budget: {
      max_tokens:
        budgetObject.max_tokens === undefined
          ? DEFAULT_OBSERVATION_MAX_TOKENS
          : integer(budgetObject.max_tokens, '$request.budget.max_tokens', 1),
    },
  };
  if (options.expected_id !== undefined && id !== options.expected_id) {
    fail('request_id_mismatch', '$request.id', 'request id mismatch', options.expected_id, id);
  }
  if (options.expected_op !== undefined && op !== options.expected_op) {
    fail('operation_mismatch', '$request.op', 'operation mismatch', options.expected_op, op);
  }
  if (options.input_schema) validateOperationArgs(options.input_schema, args);
  return result;
}

export function decodeObservation(
  input: string | unknown,
  options: DecodeObservationOptions = {},
): Observation {
  const value = parseBounded(input, options.max_bytes ?? DEFAULT_MAX_OBSERVATION_BYTES, '$observation');
  const object = record(value, '$observation');
  exactKeys(
    object,
    ['schema', 'id', 'op', 'ok', 'data', 'error', 'diagnostics', 'meta', 'suggested_next'],
    '$observation',
  );
  const schema = string(object.schema, '$observation.schema');
  const expectedSchema = options.expected_schema ?? VERSESHELL_OBSERVATION_SCHEMA;
  if (schema !== expectedSchema) {
    fail('schema_mismatch', '$observation.schema', 'observation schema mismatch', expectedSchema, schema);
  }
  const id = string(object.id, '$observation.id');
  const op = string(object.op, '$observation.op');
  const ok = boolean(object.ok, '$observation.ok');
  if (options.expected_id !== undefined && id !== options.expected_id) {
    fail('request_id_mismatch', '$observation.id', 'request id mismatch', options.expected_id, id);
  }
  if (options.expected_op !== undefined && op !== options.expected_op) {
    fail('operation_mismatch', '$observation.op', 'operation mismatch', options.expected_op, op);
  }
  if (ok && object.error !== undefined) {
    fail('invalid_shape', '$observation.error', 'successful observations must not include error');
  }
  if (!ok && object.error === undefined) {
    fail('invalid_shape', '$observation.error', 'failed observations must include error');
  }

  const result: Observation = {
    schema: VERSESHELL_OBSERVATION_SCHEMA,
    id,
    op,
    ok,
    meta: decodeObservationMeta(object.meta, '$observation.meta'),
  };
  if (object.data !== undefined) {
    assertJsonValue(object.data, '$observation.data');
    result.data = object.data;
  }
  if (object.error !== undefined) result.error = decodeOperationError(object.error, '$observation.error');
  if (object.diagnostics !== undefined) {
    if (!Array.isArray(object.diagnostics)) fail('invalid_shape', '$observation.diagnostics', 'expected an array');
    result.diagnostics = object.diagnostics.map((entry, index) =>
      decodeDiagnostic(entry, `$observation.diagnostics[${index}]`),
    );
  }
  if (object.suggested_next !== undefined) {
    if (!Array.isArray(object.suggested_next)) fail('invalid_shape', '$observation.suggested_next', 'expected an array');
    result.suggested_next = object.suggested_next.map((entry, index) =>
      decodeSuggestedAction(entry, `$observation.suggested_next[${index}]`),
    );
  }
  return result;
}

export function decodeOperationCatalogEntry(input: unknown, path = '$operation'): OperationCatalogEntry {
  const object = record(input, path);
  exactKeys(
    object,
    ['name', 'mcp_name', 'description', 'effect', 'capability', 'input_schema', 'example'],
    path,
  );
  const result: OperationCatalogEntry = {
    name: string(object.name, `${path}.name`),
    mcp_name: string(object.mcp_name, `${path}.mcp_name`),
    description: string(object.description, `${path}.description`, true),
    effect: string(object.effect, `${path}.effect`),
    capability: string(object.capability, `${path}.capability`),
    input_schema: decodeJsonSchema(object.input_schema, `${path}.input_schema`),
  };
  if (object.example !== undefined) result.example = decodeJsonObject(object.example, `${path}.example`);
  return result;
}

/** Decode MCP initialize compatibility metadata, not `ae --serve` readiness. */
export function decodeProtocolHandshake(
  input: string | unknown,
  options: DecodeHandshakeOptions = {},
): ProtocolHandshake {
  const value = parseBounded(input, options.max_bytes ?? DEFAULT_MAX_HANDSHAKE_BYTES, '$handshake');
  const object = record(value, '$handshake');
  exactKeys(object, ['protocol_version', 'capabilities', 'server_info'], '$handshake');
  const protocolVersion = string(object.protocol_version, '$handshake.protocol_version');
  const expectedProtocol = options.expected_protocol_version ?? VERSESHELL_MCP_PROTOCOL_VERSION;
  if (protocolVersion !== expectedProtocol) {
    fail('version_mismatch', '$handshake.protocol_version', 'protocol version mismatch', expectedProtocol, protocolVersion);
  }
  const capabilities = record(object.capabilities, '$handshake.capabilities');
  exactKeys(capabilities, ['tools'], '$handshake.capabilities');
  const tools = decodeJsonObject(capabilities.tools, '$handshake.capabilities.tools');
  const serverInfo = record(object.server_info, '$handshake.server_info');
  exactKeys(serverInfo, ['name', 'version'], '$handshake.server_info');
  const serverName = string(serverInfo.name, '$handshake.server_info.name');
  const serverVersion = string(serverInfo.version, '$handshake.server_info.version');
  if (serverName !== VERSESHELL_SERVER_NAME) {
    fail('version_mismatch', '$handshake.server_info.name', 'server name mismatch', VERSESHELL_SERVER_NAME, serverName);
  }
  const expectedServerVersion = options.expected_server_version ?? VERSESHELL_CRATE_VERSION;
  if (serverVersion !== expectedServerVersion) {
    fail('version_mismatch', '$handshake.server_info.version', 'server version mismatch', expectedServerVersion, serverVersion);
  }
  return {
    protocol_version: VERSESHELL_MCP_PROTOCOL_VERSION,
    capabilities: { tools },
    server_info: { name: VERSESHELL_SERVER_NAME, version: VERSESHELL_CRATE_VERSION },
  };
}

export function decodeRuntimeHandshakeObservation(
  input: string | unknown,
  options: DecodeRuntimeHandshakeOptions = {},
): RuntimeHandshakeData {
  const observation = decodeObservation(input, {
    max_bytes: options.max_bytes ?? DEFAULT_MAX_HANDSHAKE_BYTES,
    expected_op: 'runtime.handshake',
  });
  if (!observation.ok) {
    fail('invalid_shape', '$observation.ok', 'runtime handshake observation must be successful');
  }
  const data = record(observation.data, '$observation.data');
  exactKeys(
    data,
    [
      'crate_version',
      'runtime_version',
      'server_protocol',
      'observation_schema',
      'operation_catalog_schema',
      'workspace',
      'capabilities',
      'policy_mode',
      'policy_profile',
      'artifact_defaults',
      'max_concurrency',
      'operation_catalog',
      'features',
    ],
    '$observation.data',
  );
  const runtimeVersion = string(data.runtime_version, '$observation.data.runtime_version');
  const serverProtocol = string(data.server_protocol, '$observation.data.server_protocol');
  const observationSchema = string(data.observation_schema, '$observation.data.observation_schema');
  const workspace = record(data.workspace, '$observation.data.workspace');
  exactKeys(workspace, ['id', 'canonical'], '$observation.data.workspace');
  const workspaceId = string(workspace.id, '$observation.data.workspace.id');
  if (workspace.canonical !== true) {
    fail('invalid_shape', '$observation.data.workspace.canonical', 'expected literal true');
  }
  const capabilities = record(data.capabilities, '$observation.data.capabilities');
  exactKeys(capabilities, ['mode', 'granted'], '$observation.data.capabilities');
  const policyProfile = record(data.policy_profile, '$observation.data.policy_profile');
  exactKeys(policyProfile, ['id', 'digest'], '$observation.data.policy_profile');
  const artifactDefaults = record(data.artifact_defaults, '$observation.data.artifact_defaults');
  exactKeys(artifactDefaults, ['ttl_seconds', 'max_total_bytes'], '$observation.data.artifact_defaults');
  const catalog = record(data.operation_catalog, '$observation.data.operation_catalog');
  exactKeys(catalog, ['digest', 'count'], '$observation.data.operation_catalog');
  const catalogDigest = string(catalog.digest, '$observation.data.operation_catalog.digest');
  if (serverProtocol !== VERSESHELL_SERVER_PROTOCOL) {
    fail(
      'version_mismatch',
      '$observation.data.server_protocol',
      'runtime server protocol mismatch',
      VERSESHELL_SERVER_PROTOCOL,
      serverProtocol,
    );
  }
  if (observationSchema !== VERSESHELL_OBSERVATION_SCHEMA) {
    fail(
      'schema_mismatch',
      '$observation.data.observation_schema',
      'runtime observation schema mismatch',
      VERSESHELL_OBSERVATION_SCHEMA,
      observationSchema,
    );
  }
  if (data.operation_catalog_schema !== VERSESHELL_OPERATION_CATALOG_SCHEMA) {
    fail(
      'schema_mismatch',
      '$observation.data.operation_catalog_schema',
      'runtime operation catalog schema mismatch',
      VERSESHELL_OPERATION_CATALOG_SCHEMA,
      data.operation_catalog_schema,
    );
  }
  for (const [path, expected, actual] of [
    ['$observation.data.runtime_version', options.expected_runtime_version, runtimeVersion],
    ['$observation.data.server_protocol', options.expected_server_protocol, serverProtocol],
    ['$observation.data.workspace.id', options.expected_workspace_id, workspaceId],
    ['$observation.data.operation_catalog.digest', options.expected_catalog_digest, catalogDigest],
  ] as const) {
    if (expected !== undefined && actual !== expected) {
      fail('version_mismatch', path, 'runtime handshake value mismatch', expected, actual);
    }
  }
  return {
    crate_version: string(data.crate_version, '$observation.data.crate_version'),
    runtime_version: runtimeVersion,
    server_protocol: VERSESHELL_SERVER_PROTOCOL,
    observation_schema: VERSESHELL_OBSERVATION_SCHEMA,
    operation_catalog_schema: VERSESHELL_OPERATION_CATALOG_SCHEMA,
    workspace: { id: workspaceId, canonical: true },
    capabilities: {
      mode: string(capabilities.mode, '$observation.data.capabilities.mode'),
      granted: stringArray(capabilities.granted, '$observation.data.capabilities.granted'),
    },
    policy_mode: string(data.policy_mode, '$observation.data.policy_mode'),
    policy_profile: {
      id: string(policyProfile.id, '$observation.data.policy_profile.id'),
      digest: string(policyProfile.digest, '$observation.data.policy_profile.digest'),
    },
    artifact_defaults: {
      ttl_seconds: integer(artifactDefaults.ttl_seconds, '$observation.data.artifact_defaults.ttl_seconds', 1),
      max_total_bytes: integer(artifactDefaults.max_total_bytes, '$observation.data.artifact_defaults.max_total_bytes', 1),
    },
    max_concurrency: integer(data.max_concurrency, '$observation.data.max_concurrency', 1),
    operation_catalog: {
      digest: catalogDigest,
      count: integer(catalog.count, '$observation.data.operation_catalog.count'),
    },
    features: stringArray(data.features, '$observation.data.features'),
  };
}

/** Normalize the upstream MCP camelCase initialize result at the transport boundary only. */
export function normalizeMcpInitializeResult(input: unknown): unknown {
  if (!isRecord(input)) return input;
  return {
    protocol_version: input.protocolVersion,
    capabilities: input.capabilities,
    server_info: isRecord(input.serverInfo)
      ? { name: input.serverInfo.name, version: input.serverInfo.version }
      : input.serverInfo,
  };
}

export function decodeProtocolManifest(input: string | unknown): ProtocolManifest {
  const value = parseBounded(input, DEFAULT_MAX_OBSERVATION_BYTES, '$protocol_manifest');
  const object = record(value, '$protocol_manifest');
  exactKeys(
    object,
    ['protocol_version', 'observation_schema', 'server_name', 'server_version', 'operations'],
    '$protocol_manifest',
  );
  const protocolVersion = string(object.protocol_version, '$protocol_manifest.protocol_version');
  const observationSchema = string(object.observation_schema, '$protocol_manifest.observation_schema');
  const serverName = string(object.server_name, '$protocol_manifest.server_name');
  const serverVersion = string(object.server_version, '$protocol_manifest.server_version');
  if (protocolVersion !== VERSESHELL_MCP_PROTOCOL_VERSION) {
    fail('version_mismatch', '$protocol_manifest.protocol_version', 'protocol version mismatch');
  }
  if (observationSchema !== VERSESHELL_OBSERVATION_SCHEMA) {
    fail('schema_mismatch', '$protocol_manifest.observation_schema', 'observation schema mismatch');
  }
  if (serverName !== VERSESHELL_SERVER_NAME || serverVersion !== VERSESHELL_CRATE_VERSION) {
    fail('version_mismatch', '$protocol_manifest.server_version', 'server identity mismatch');
  }
  if (!Array.isArray(object.operations)) fail('invalid_shape', '$protocol_manifest.operations', 'expected an array');
  return {
    protocol_version: VERSESHELL_MCP_PROTOCOL_VERSION,
    observation_schema: VERSESHELL_OBSERVATION_SCHEMA,
    server_name: VERSESHELL_SERVER_NAME,
    server_version: VERSESHELL_CRATE_VERSION,
    operations: object.operations.map((entry, index) =>
      decodeOperationCatalogEntry(entry, `$protocol_manifest.operations[${index}]`),
    ),
  };
}
