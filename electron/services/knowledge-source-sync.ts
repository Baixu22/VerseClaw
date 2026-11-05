import { createHash } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, matchesGlob, relative, resolve } from 'node:path';
import { readJsonAtomic, writeJsonAtomic } from '../utils/atomic-write';

export type KnowledgeSourceSnapshot = { digest: string; updatedAt: string; bytes: number };
export type KnowledgeSourceTransition = {
  sourceId: string;
  path: string;
  relativePath: string;
  kind: 'created' | 'updated' | 'withdrawn';
  previousDigest?: string;
  digest?: string;
  body: string;
  updatedAt: string;
  captureKey: string;
};
type SyncState = { version: 1; root: string; sequence?: number; files: Record<string, KnowledgeSourceSnapshot> };

function hash(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }
function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`));
}

/** Event notifications are hints; the durable cursor advances only after capture. */
export function createKnowledgeSourceSync(input: {
  id: string;
  root: string;
  patterns: string[];
  cursorPath: string;
  capture: (transition: KnowledgeSourceTransition) => Promise<void>;
  onError: (error: unknown) => void;
  debounceMs?: number;
  scanIntervalMs?: number;
  maxFiles?: number;
  maxBytesPerFile?: number;
}) {
  let stopped = false;
  let watcher: FSWatcher | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let serial = Promise.resolve();
  let generation = 0;
  let state: SyncState | undefined;
  const root = resolve(input.root);
  const maxFiles = input.maxFiles ?? 1000;
  const maxBytes = input.maxBytesPerFile ?? 2 * 1024 * 1024;

  async function load(): Promise<SyncState> {
    if (state) return state;
    const stored = await readJsonAtomic<SyncState>(input.cursorPath, { fallback: { version: 1, root, files: {} } });
    if (stored.data.version !== 1 || stored.data.root !== root || !stored.data.files || Array.isArray(stored.data.files)) {
      throw new Error('Source cursor does not match the configured root');
    }
    for (const [path, file] of Object.entries(stored.data.files)) {
      if (!inside(root, resolve(root, path)) || !file || typeof file.digest !== 'string') throw new Error('Invalid source cursor');
    }
    state = stored.data;
    return state;
  }

  async function reconcile() {
    if (stopped) return;
    const owner = await load();
    const rootInfo = await lstat(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Watched root must be a real directory');
    const canonicalRoot = await realpath(root);
    const current = new Map<string, { snapshot: KnowledgeSourceSnapshot; body: string }>();
    let complete = true;
    let seen = 0;
    let totalBytes = 0;
    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (stopped) return;
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.openclaw-wiki') continue;
        if (++seen > maxFiles) { complete = false; return; }
        const path = join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) { await walk(path); continue; }
        if (!entry.isFile()) continue;
        const name = relative(root, path).replaceAll('\\', '/');
        if (!input.patterns.some(pattern => matchesGlob(process.platform === 'win32' ? name.toLowerCase() : name, process.platform === 'win32' ? pattern.toLowerCase() : pattern))) continue;
        const info = await lstat(path);
        if (info.isSymbolicLink() || info.size > maxBytes || info.size === 0) continue;
        const canonical = await realpath(path);
        if (!inside(canonicalRoot, canonical)) throw new Error('Source path escapes watched root');
        totalBytes += info.size;
        if (totalBytes > 16 * 1024 * 1024) { complete = false; return; }
        const handle = await open(path, 'r');
        try {
          const before = await handle.stat();
          if (!before.isFile() || before.size > maxBytes || before.dev !== info.dev || before.ino !== info.ino) { complete = false; continue; }
          const bytes = await handle.readFile();
          const after = await handle.stat();
          if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.length !== after.size) { complete = false; continue; }
          if (bytes.includes(0)) continue;
          current.set(name, { snapshot: { digest: hash(bytes), updatedAt: after.mtime.toISOString(), bytes: bytes.length }, body: bytes.toString('utf8') });
        } finally { await handle.close(); }
      }
    }
    await walk(root);
    if (stopped) return;
    const next = { ...owner.files };
    let sequence = owner.sequence ?? 0;
    const transitions = [...current.keys(), ...(complete ? Object.keys(owner.files).filter(name => !current.has(name)) : [])];
    for (const name of transitions) {
      if (stopped) return;
      const found = current.get(name), previous = owner.files[name];
      if (found?.snapshot.digest === previous?.digest) continue;
      const kind = !found ? 'withdrawn' : previous ? 'updated' : 'created';
      const sourceId = `watched:${input.id}:${hash(name)}`;
      await input.capture({
        sourceId, path: join(root, name), relativePath: name, kind,
        previousDigest: previous?.digest, digest: found?.snapshot.digest,
        body: found?.body ?? `Source withdrawn: ${name}. Review the accepted knowledge that cites this source before retaining its claims.`,
        updatedAt: found?.snapshot.updatedAt ?? new Date().toISOString(),
        // The durable sequence distinguishes A→B→A→B and delete/recreate cycles;
        // a failed capture/write retries the same key from the old cursor.
        captureKey: `${sourceId}:${sequence + 1}:${previous?.digest ?? 'absent'}:${found?.snapshot.digest ?? 'withdrawn'}`,
      });
      if (stopped) return;
      if (found) next[name] = found.snapshot; else delete next[name];
      // Save after each successful capture: interrupted batches retry only uncommitted transitions.
      const updated: SyncState = { version: 1, root, sequence: sequence + 1, files: { ...next } };
      await writeJsonAtomic(input.cursorPath, updated);
      state = updated;
      sequence++;
    }
  }

  function scan(): Promise<void> {
    const requestedGeneration = generation;
    const job = serial.then(async () => { if (requestedGeneration === generation && !stopped) await reconcile(); });
    serial = job.catch(input.onError);
    return job;
  }
  function schedule() {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; void scan().catch(() => undefined); }, input.debounceMs ?? 150);
    timer.unref();
  }
  async function start() {
    if (stopped) throw new Error('Stopped source synchronizer cannot restart');
    if (watcher) return;
    watcher = watch(root, { recursive: true }, schedule);
    watcher.on('error', input.onError);
    watcher.unref();
    interval = setInterval(schedule, input.scanIntervalMs ?? 60_000);
    interval.unref();
    await scan();
  }
  function stop() {
    stopped = true; generation++;
    if (timer) clearTimeout(timer);
    if (interval) clearInterval(interval);
    watcher?.close(); watcher = undefined;
  }
  return { start, scan, stop, settled: () => serial };
}
