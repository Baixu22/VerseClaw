import { createHash } from 'node:crypto';
import { readJsonAtomic, writeJsonAtomic } from '../utils/atomic-write';
import { proxyAwareFetch } from '../utils/proxy-fetch';
import type { KnowledgeGithubConnectorConfig, KnowledgeConnectorReceipt } from '../../shared/host-api/contract';

type SourceVersion = { sha: string; digest: string };
type Cursor = { version: 1; identity: string; sequence?: number; files: Record<string, SourceVersion> };
export type GithubSourceChange = {
  sourceId: string; path: string; url: string; body: string;
  kind: 'created' | 'updated' | 'withdrawn' | 'access-lost';
  revision?: string; digest?: string; previousDigest?: string; observedAt: string; captureKey: string;
};
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

export function validateGithubConnector(input: KnowledgeGithubConnectorConfig): void {
  if (!input || input.kind !== 'github-public-directory' || !/^[a-zA-Z0-9_-]{1,80}$/.test(input.id)
    || !/^[a-zA-Z0-9_.-]{1,100}$/.test(input.owner) || !/^[a-zA-Z0-9_.-]{1,100}$/.test(input.repo)
    || typeof input.ref !== 'string' || !input.ref.trim() || input.ref.length > 200
    || typeof input.path !== 'string' || input.path.length > 400 || input.path.startsWith('/') || input.path.includes('\\')
    || input.path.split('/').some(part => part === '..' || part === '.')
    || typeof input.enabled !== 'boolean' || !Number.isInteger(input.intervalSeconds) || input.intervalSeconds < 60 || input.intervalSeconds > 86400) {
    throw Error('Invalid public GitHub directory connector configuration');
  }
}

/** A bounded public GitHub directory (or one file), never an arbitrary URL fetcher.
 * No credentials or redirect targets are accepted. Content is addressed by Git blob
 * SHA; only reviewed Inbox candidates can later change accepted knowledge. */
export function createKnowledgeGithubConnector(input: {
  config: KnowledgeGithubConnectorConfig; cursorPath: string; receiptPath: string;
  capture: (change: GithubSourceChange) => Promise<void>;
  onError: (error: unknown) => void;
}) {
  validateGithubConnector(input.config);
  const config = input.config;
  const identity = JSON.stringify([config.owner.toLowerCase(), config.repo.toLowerCase(), config.ref, config.path]);
  const base = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`;
  let cursor: Cursor | undefined, stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let serial = Promise.resolve();
  const controller = new AbortController();
  let retryAfter = 0, failures = 0;

  async function request(suffix: string): Promise<unknown> {
    const response = await proxyAwareFetch(`${base}${suffix}`, { method: 'GET', redirect: 'error',
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) });
    if (!response.ok) {
      if (response.status === 403 || response.status === 429) {
        const seconds = Number(response.headers.get('retry-after')) || 60;
        const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
        retryAfter = Math.max(Date.now() + seconds * 1000, Number.isFinite(reset) ? reset : 0);
      }
      await response.body?.cancel();
      throw Object.assign(Error(`GitHub source HTTP ${response.status}`), { status: response.status });
    }
    const reader = response.body?.getReader();
    if (!reader) throw Error('GitHub source returned no body');
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) {
        const row = await reader.read(); if (row.done) break;
        bytes += row.value.byteLength;
        if (bytes > 1024 * 1024) { await reader.cancel(); throw Error('GitHub response exceeds 1 MiB'); }
        chunks.push(row.value);
      }
    } finally { reader.releaseLock(); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }

  async function reconcile(): Promise<KnowledgeConnectorReceipt> {
    const observedAt = new Date().toISOString();
    const previousReceipt = (await readJsonAtomic<KnowledgeConnectorReceipt | null>(input.receiptPath, { fallback: null })).data;
    const receipt: KnowledgeConnectorReceipt = { connectorId: config.id, observedAt, status: 'ok',
      created: 0, updated: 0, withdrawn: 0, unchanged: 0, driven_by: 'agent', actor: 'knowledge-github-connector',
      ...(previousReceipt?.lastSuccessAt ? { lastSuccessAt: previousReceipt.lastSuccessAt } : {}) };
    try {
      if (stopped) throw Error('Connector stopped');
      if (Date.now() < retryAfter) throw Error('GitHub retry backoff is active');
      if (!cursor) cursor = (await readJsonAtomic<Cursor>(input.cursorPath, { fallback: { version: 1, identity, files: {} } })).data;
      if (cursor.version !== 1 || cursor.identity !== identity || !cursor.files || Array.isArray(cursor.files)) throw Error('Connector cursor identity mismatch');
      const sources = new Map<string, SourceVersion & { body: string }>();
      let accessLost = false;
      let checkingAccess = true;
      try {
        const repository = await request('') as { private?: boolean };
        if (repository.private !== false) accessLost = true;
        if (!accessLost) {
          const listing = await request(`/contents/${config.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(config.ref)}`);
          checkingAccess = false;
          const rows = (Array.isArray(listing) ? listing : [listing]) as Array<{ type?: string; path?: string; sha?: string; size?: number }>;
          if (rows.length >= 1000 || rows.length > 100) throw Error('Directory snapshot exceeds the 100-entry connector budget');
          let totalBytes = 0;
          for (const row of rows) {
            if (row.type !== 'file' || !row.path || !/\.(md|markdown|txt)$/i.test(row.path)) continue;
            const inScope = row.path === config.path || (row.path.startsWith(config.path ? `${config.path}/` : '') && !row.path.slice(config.path ? config.path.length + 1 : 0).includes('/'));
            if (!inScope || row.path.split('/').some(part => part === '..' || part === '.') || !row.sha || !/^[a-f0-9]{40}$/.test(row.sha)) throw Error('Invalid GitHub source identity');
            if (sources.has(row.path)) throw Error('Duplicate GitHub source identity');
            if (!Number.isSafeInteger(row.size) || row.size! > 256 * 1024 || row.size! <= 0) throw Error('GitHub source is empty or exceeds the 256 KiB file budget');
            totalBytes += row.size!;
            if (totalBytes > 4 * 1024 * 1024) throw Error('GitHub source snapshot exceeds 4 MiB');
            const previous = cursor.files[row.path];
            if (previous?.sha === row.sha) { sources.set(row.path, { ...previous, body: '' }); continue; }
            const blob = await request(`/git/blobs/${row.sha}`) as { sha?: string; encoding?: string; content?: string };
            if (blob.sha !== row.sha || blob.encoding !== 'base64' || typeof blob.content !== 'string') throw Error('Invalid GitHub blob');
            const bytes = Buffer.from(blob.content, 'base64');
            const gitSha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
            if (bytes.length !== row.size || gitSha !== row.sha || bytes.includes(0)) throw Error('GitHub blob integrity or text validation failed');
            const body = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
            if (!body.trim()) throw Error('GitHub source has no content');
            sources.set(row.path, { sha: row.sha, digest: hash(bytes), body });
          }
        }
      } catch (error) {
        // A public source becoming private/deleted returns 404. Rate limiting and
        // transient failures never masquerade as authoritative deletion.
        if (checkingAccess && (error as { status?: number }).status === 404) accessLost = true; else throw error;
      }
      for (const path of [...sources.keys(), ...Object.keys(cursor.files).filter(path => !sources.has(path))].sort()) {
        if (stopped) throw Error('Connector stopped');
        const next = sources.get(path), previous = cursor.files[path];
        if (next?.sha === previous?.sha) { receipt.unchanged++; continue; }
        const kind = next ? previous ? 'updated' : 'created' : accessLost ? 'access-lost' : 'withdrawn';
        const sourceId = `github:${config.owner.toLowerCase()}/${config.repo.toLowerCase()}:${config.ref}:${path}`;
        await input.capture({ sourceId, path, kind, body: next?.body ?? `Source ${kind}: ${path}. Review knowledge citing this source.`,
          url: `https://github.com/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/blob/${encodeURIComponent(config.ref)}/${path.split('/').map(encodeURIComponent).join('/')}`,
          revision: next?.sha, digest: next?.digest, previousDigest: previous?.digest, observedAt,
          captureKey: `${sourceId}:${(cursor.sequence ?? 0) + 1}:${previous?.sha ?? 'absent'}:${next?.sha ?? kind}` });
        const updated: Cursor = { ...cursor, sequence: (cursor.sequence ?? 0) + 1, files: { ...cursor.files } };
        if (next) { updated.files[path] = { sha: next.sha, digest: next.digest }; receipt[kind as 'created' | 'updated']++; }
        else { delete updated.files[path]; receipt.withdrawn++; }
        // Do not advance the in-memory cursor before durable commit succeeds.
        await writeJsonAtomic(input.cursorPath, updated);
        cursor = updated;
      }
      if (!stopped) await writeJsonAtomic(input.cursorPath, cursor);
      receipt.status = accessLost ? 'access-lost' : 'ok'; receipt.lastSuccessAt = observedAt; failures = 0;
    } catch (error) {
      receipt.status = 'error'; receipt.error = error instanceof Error ? error.message : 'Connector sync failed';
      retryAfter = Math.max(retryAfter, Date.now() + Math.min(3600, 60 * 2 ** Math.min(failures++, 6)) * 1000);
      receipt.retryAt = new Date(retryAfter).toISOString();
    }
    await writeJsonAtomic(input.receiptPath, receipt);
    return receipt;
  }
  function sync(): Promise<KnowledgeConnectorReceipt> {
    const job = serial.then(reconcile);
    serial = job.then(() => undefined, input.onError);
    return job;
  }
  async function start() {
    if (timer || stopped || !config.enabled) return;
    timer = setInterval(() => { void sync().catch(input.onError); }, config.intervalSeconds * 1000); timer.unref();
    await sync();
  }
  function stop() { stopped = true; if (timer) clearInterval(timer); controller.abort(); }
  return { start, sync, stop, settled: () => serial };
}
