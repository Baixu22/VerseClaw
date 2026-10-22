import {
  VG_RUNTIME_BINDING_SCHEMA,
  type VerseGitBindingAttachResponse,
  type VerseGitBindingEndResponse,
  type VerseGitBindingResponse,
  type VerseGitRuntimeBindingPort,
} from '../../../shared/versegit-runtime-contract.ts';

type RuntimeEnv = Record<string, string | undefined>;

async function post<T>(baseUrl: string, token: string, path: string, body: unknown, timeoutMs = 10_000): Promise<T> {
  const response = await fetch(`${baseUrl.replace(/\/+$/u, '')}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const parsed = await response.json() as { ok?: boolean; data?: unknown; error?: { code?: string; message?: string } };
  if (!response.ok || parsed.ok !== true) {
    const error = parsed.error ?? {};
    throw Object.assign(new Error(error.message || `VerseGit binding bridge ${path} failed`), { code: error.code ?? 'BRIDGE_FAILED', status: response.status });
  }
  return parsed as T;
}

export function createVerseGitRuntimeBindingPortFromEnv(env: RuntimeEnv = process.env): VerseGitRuntimeBindingPort | null {
  const baseUrl = env.CLAWX_VERSGIT_RUNTIME_BINDING_URL?.trim();
  const token = env.CLAWX_VERSGIT_BINDING_TOKEN?.trim();
  const ownerId = env.CLAWX_VERSGIT_OWNER_ID?.trim();
  const epoch = Number(env.CLAWX_VERSGIT_EPOCH ?? 0);
  if (env.CLAWX_VERSGIT_BINDING_ENABLED !== '1' || !baseUrl || !token || !ownerId || !Number.isInteger(epoch) || epoch < 1) return null;
  return {
    async bind(request) {
      const response = await post<VerseGitBindingResponse>(baseUrl, token, '/bind', { schema: VG_RUNTIME_BINDING_SCHEMA, ownerId, epoch, ...request });
      if (!response.ok) throw new Error(response.error.message);
      return response.data;
    },
    async attach(request) {
      const response = await post<VerseGitBindingAttachResponse>(baseUrl, token, '/attach', { schema: VG_RUNTIME_BINDING_SCHEMA, ownerId, epoch, ...request });
      if (!response.ok) throw new Error(response.error.message);
      return response.data;
    },
    async end(request) {
      const response = await post<VerseGitBindingEndResponse>(baseUrl, token, '/end', { schema: VG_RUNTIME_BINDING_SCHEMA, ownerId, epoch, ...request });
      if (!response.ok) throw new Error(response.error.message);
      return response.data;
    },
  };
}
