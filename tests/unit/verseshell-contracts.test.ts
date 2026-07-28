import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OBSERVATION_MAX_TOKENS,
  DEFAULT_OPERATION_TIMEOUT_MS,
  VERSESHELL_MCP_PROTOCOL_VERSION,
  VERSESHELL_OBSERVATION_SCHEMA,
  VerseShellContractError,
  decodeObservation,
  decodeOperationRequest,
  decodeProtocolHandshake,
  decodeRuntimeHandshakeObservation,
  normalizeMcpInitializeResult,
  validateOperationArgs,
  type JsonSchema,
  type Observation,
} from '@shared/verseshell';

function validObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    schema: VERSESHELL_OBSERVATION_SCHEMA,
    id: 'request-1',
    op: 'file.view',
    ok: true,
    data: { path: 'src/main.rs', content_hash: 'sha256:abc', lines: ['one'] },
    diagnostics: [
      {
        tool: 'cargo',
        severity: 'warning',
        message: 'unused import',
        path: 'src/main.rs',
        line: 2,
        column: 4,
        code: 'unused_imports',
        suggested_fix: 'remove it',
      },
    ],
    meta: {
      elapsed_ms: 4,
      profile: 'file',
      token_estimate: 20,
      effects: ['fs.read'],
      capabilities_used: ['file.read'],
    },
    suggested_next: [{ op: 'repo.search', args: { query: 'unused' } }],
    ...overrides,
  };
}

function expectContractCode(callback: () => unknown, code: string): void {
  try {
    callback();
    throw new Error('expected contract error');
  } catch (error) {
    expect(error).toBeInstanceOf(VerseShellContractError);
    expect((error as VerseShellContractError).code).toBe(code);
  }
}

describe('VerseShell wire decoding', () => {
  it('decodes valid success and failure observations without inventing another envelope', () => {
    expect(
      decodeObservation(JSON.stringify(validObservation()), {
        expected_id: 'request-1',
        expected_op: 'file.view',
      }),
    ).toEqual(validObservation());

    const failure = validObservation({
      ok: false,
      data: { attempted_path: 'missing.ts' },
      error: {
        code: 'E_NOT_FOUND',
        message: 'file not found',
        recoverable: true,
        hint: 'check the path',
        fix: {
          action: 'search',
          tool: 'repo.search',
          args: { query: 'missing' },
          reason: 'locate the file',
        },
      },
    });
    expect(decodeObservation(failure)).toEqual(failure);
  });

  it('rejects malformed observations rather than passing them through as text', () => {
    expectContractCode(() => decodeObservation('{not json'), 'invalid_json');
    expectContractCode(
      () => decodeObservation({ ...validObservation(), ok: true, error: { code: 'E', message: 'bad', recoverable: true } }),
      'invalid_shape',
    );
    expectContractCode(
      () => decodeObservation({ ...validObservation(), diagnostics: [{ tool: 'x', severity: 'error', message: 3 }] }),
      'invalid_shape',
    );
    expectContractCode(
      () => decodeObservation({ ...validObservation(), unexpected: 'raw fallback' }),
      'invalid_shape',
    );
  });

  it('enforces observation schema, operation, request id, and byte limits', () => {
    expectContractCode(
      () => decodeObservation({ ...validObservation(), schema: 'verseshell.observation/v2' }),
      'schema_mismatch',
    );
    expectContractCode(
      () => decodeObservation(validObservation(), { expected_id: 'different' }),
      'request_id_mismatch',
    );
    expectContractCode(
      () => decodeObservation(validObservation(), { expected_op: 'repo.search' }),
      'operation_mismatch',
    );
    expectContractCode(
      () => decodeObservation(JSON.stringify(validObservation()), { max_bytes: 10 }),
      'max_bytes_exceeded',
    );
  });

  it('decodes requests with the Rust defaults and validates expected identity', () => {
    expect(decodeOperationRequest({ id: 'r1', op: 'file.view' })).toEqual({
      id: 'r1',
      agent: 'default',
      op: 'file.view',
      args: {},
      timeout_ms: DEFAULT_OPERATION_TIMEOUT_MS,
      budget: { max_tokens: DEFAULT_OBSERVATION_MAX_TOKENS },
    });
    expectContractCode(
      () => decodeOperationRequest({ id: 'r1', op: 'file.view' }, { expected_id: 'r2' }),
      'request_id_mismatch',
    );
  });

  it('validates nested operation args, required keys, enums, scalars, and additional properties', () => {
    const schema: JsonSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['targets', 'mode', 'enabled'],
      properties: {
        targets: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['path', 'ranges'],
            properties: {
              path: { type: 'string' },
              ranges: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['start', 'end'],
                  properties: {
                    start: { type: 'integer', minimum: 1 },
                    end: { type: 'number', minimum: 1 },
                  },
                },
              },
            },
          },
        },
        mode: { type: 'string', enum: ['read', 'write'] },
        enabled: { type: 'boolean' },
      },
    };
    const valid = {
      targets: [{ path: 'src/a.ts', ranges: [{ start: 1, end: 2.5 }] }],
      mode: 'read',
      enabled: true,
    };
    expect(() => validateOperationArgs(schema, valid)).not.toThrow();
    expect(() =>
      decodeOperationRequest(
        { id: 'deep', op: 'custom', args: valid },
        { input_schema: schema },
      ),
    ).not.toThrow();

    for (const invalid of [
      { ...valid, mode: 'delete' },
      { ...valid, enabled: 'yes' },
      { ...valid, extra: true },
      { ...valid, targets: [] },
      { ...valid, targets: [{ path: 'a', ranges: [{ start: 0, end: 2 }] }] },
      { ...valid, targets: [{ path: 'a', ranges: [{ start: 1, end: 2, extra: 3 }] }] },
      { targets: valid.targets, mode: 'read' },
    ]) {
      expectContractCode(() => validateOperationArgs(schema, invalid), 'argument_schema_mismatch');
    }
  });

  it('decodes internal runtime readiness only from a typed handshake observation', () => {
    const runtimeHandshake = validObservation({
      op: 'runtime.handshake',
      data: {
        crate_version: '1.0.0',
        runtime_version: '1.0.0',
        server_protocol: 'verseshell.jsonl/v1',
        observation_schema: VERSESHELL_OBSERVATION_SCHEMA,
        operation_catalog_schema: 'verseshell.operation-catalog/v1',
        workspace: { id: 'ws_sha256_fixture', canonical: true },
        capabilities: { mode: 'allow_list', granted: ['file.read', 'shell.exec'] },
        policy_mode: 'agent_strict',
        policy_profile: {
          id: 'agent-minimal',
          digest: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        },
        artifact_defaults: { ttl_seconds: 86_400, max_total_bytes: 536_870_912 },
        max_concurrency: 4,
        operation_catalog: { digest: 'sha256:catalog', count: 4 },
        features: ['typed_operations', 'result_artifacts', 'bound_approvals', 'legacy_cmd'],
      },
    });
    expect(
      decodeRuntimeHandshakeObservation(runtimeHandshake, {
        expected_runtime_version: '1.0.0',
        expected_server_protocol: 'verseshell.jsonl/v1',
        expected_workspace_id: 'ws_sha256_fixture',
        expected_catalog_digest: 'sha256:catalog',
      }),
    ).toMatchObject({ runtime_version: '1.0.0', server_protocol: 'verseshell.jsonl/v1', operation_catalog: { count: 4 } });
    expectContractCode(
      () => decodeRuntimeHandshakeObservation({ ...runtimeHandshake, op: 'file.view' }),
      'operation_mismatch',
    );
    expectContractCode(
      () =>
        decodeRuntimeHandshakeObservation(runtimeHandshake, {
          expected_server_protocol: 'verseshell.jsonl/v2',
        }),
      'version_mismatch',
    );
  });

  it('normalizes MCP compatibility camelCase once and rejects identity drift', () => {
    const upstream = {
      protocolVersion: VERSESHELL_MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'ae-mcp', version: '1.0.0' },
    };
    expect(decodeProtocolHandshake(normalizeMcpInitializeResult(upstream))).toEqual({
      protocol_version: VERSESHELL_MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      server_info: { name: 'ae-mcp', version: '1.0.0' },
    });
    expectContractCode(
      () => decodeProtocolHandshake({ ...normalizeMcpInitializeResult(upstream) as object, protocol_version: '2099-01-01' }),
      'version_mismatch',
    );
    expectContractCode(
      () => decodeProtocolHandshake(normalizeMcpInitializeResult({ ...upstream, serverInfo: { name: 'other', version: '1.0.0' } })),
      'version_mismatch',
    );
  });
});
