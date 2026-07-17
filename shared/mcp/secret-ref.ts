/**
 * MCP env secret references and renderer-safe redaction helpers.
 * Plaintext env values are Main-only; Renderer receives masked placeholders.
 */

export const MCP_ENV_MASK = '••••';

export type McpSecretRef = {
  kind: 'secret-ref';
  secretId: string;
};

export type McpEnvEntry = string | McpSecretRef;
export type McpEnvMap = Record<string, McpEnvEntry>;

export function isMcpSecretRef(value: unknown): value is McpSecretRef {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.kind === 'secret-ref'
    && typeof record.secretId === 'string'
    && record.secretId.trim().length > 0;
}

export function mcpEnvSecretId(serverId: string, key: string): string {
  return `mcp-env:${serverId}:${key}`;
}

export function isMaskedEnvValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed === MCP_ENV_MASK) return true;
  if (trimmed === '[REDACTED]') return true;
  if (/^\*{2,}$/.test(trimmed)) return true;
  if (/^(\u2022){2,}$/.test(trimmed)) return true;
  if (/^(\u25CF){2,}$/.test(trimmed)) return true;
  if (/^x{4,}$/i.test(trimmed)) return true;
  return false;
}

/** Redact env map for Renderer / list responses. Keys preserved, values masked. */
export function redactMcpEnvMap(
  env: McpEnvMap | Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!env || typeof env !== 'object') return undefined;
  const keys = Object.keys(env);
  if (keys.length === 0) return undefined;
  const redacted: Record<string, string> = {};
  for (const key of keys) {
    redacted[key] = MCP_ENV_MASK;
  }
  return redacted;
}

export function envMapHasPlaintext(env: McpEnvMap | undefined): boolean {
  if (!env) return false;
  return Object.values(env).some(
    (value) => typeof value === 'string' && value.length > 0 && !isMaskedEnvValue(value),
  );
}
