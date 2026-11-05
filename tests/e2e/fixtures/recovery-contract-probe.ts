import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ElectronApplication } from '@playwright/test';
import { hostInvoke } from './fp-p1-harness';
import { closeElectronApp } from './electron';

export const MAIN_RECOVERY_KEY = 'agent:main:main';
export type SessionRow = { sessionId: string; sessionFile?: string; status?: string; abortedLastRun?: boolean; label?: string; spawnedBy?: string };

function query(file: string, sql: string): Array<Record<string, unknown>> {
  if (!existsSync(file)) return [];
  const db = new DatabaseSync(file, { readOnly: true });
  try { return db.prepare(sql).all() as Array<Record<string, unknown>>; }
  finally { db.close(); }
}
export function readRecoveryDisk(stateDir: string, sessionKey = MAIN_RECOVERY_KEY) {
  const agentDb = join(stateDir, 'agents/main/agent/openclaw-agent.sqlite');
  const stateDb = join(stateDir, 'state/openclaw.sqlite');
  const sessions = Object.fromEntries(query(agentDb, "SELECT key,value_json FROM cache_entries WHERE scope='session_entries'")
    .map((row) => [String(row.key), JSON.parse(String(row.value_json)) as SessionRow]));
  const main = sessions[sessionKey] as SessionRow | undefined;
  const sessionFile = main?.sessionFile
    ? isAbsolute(main.sessionFile) ? main.sessionFile : join(stateDir, 'agents/main/sessions', main.sessionFile)
    : main?.sessionId ? join(stateDir, 'agents/main/sessions', `${main.sessionId}.jsonl`) : undefined;
  const raw = sessionFile && existsSync(sessionFile) ? readFileSync(sessionFile, 'utf8') : '';
  const entries = raw.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const byId = new Map(entries.filter((entry) => entry.type !== 'session').map((entry) => [entry.id, entry]));
  const branch = [];
  let leaf = entries.findLast((entry) => entry.type !== 'session');
  const seen = new Set<string>();
  while (leaf && !seen.has(leaf.id)) { seen.add(leaf.id); branch.unshift(leaf); leaf = byId.get(leaf.parentId); }
  const flows = query(stateDb, "SELECT flow_id,controller_id,status,execution_phase,revision,state_json FROM flow_runs WHERE controller_id='tool-execution'");
  const children = query(stateDb, 'SELECT * FROM subagent_runs');
  return { main, sessions, sessionFile, entries, branch, flows, children,
    transcriptSha256: createHash('sha256').update(raw).digest('hex') };
}
export function effectLines(path: string): string[] {
  return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean) : [];
}
export function writeProbe(configPath: string, config: Record<string, unknown>) {
  writeFileSync(configPath, JSON.stringify(config), { encoding: 'utf8', flush: true });
}
export function readProbeFiles(dir: string, prefix: string) {
  return readdirSync(dir).filter((file) => file.startsWith(prefix) && file.endsWith('.json'))
    .map((file) => ({ file, ...JSON.parse(readFileSync(join(dir, file), 'utf8')) } as {
      file: string; pid: number; point?: string; action: string; id: string;
      observedAt: number; facts?: Record<string, unknown>;
    }));
}
export async function eventually<T>(read: () => T | Promise<T>, accept: (value: T) => boolean, label: string, timeout = 120_000): Promise<T> {
  const deadline = Date.now() + timeout;
  let value: T | undefined;
  let error: unknown;
  while (Date.now() < deadline) {
    try { value = await read(); if (accept(value)) return value; } catch (e) { error = e; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} timed out: ${error ?? JSON.stringify(value)?.slice(0, 1000)}`);
}
export function persistEvidence(dir: string, name: string, value: unknown) {
  mkdirSync(dir, { recursive: true });
  const text = JSON.stringify(value, null, 2) + '\n';
  const path = join(dir, name);
  writeFileSync(path, text, { encoding: 'utf8', flush: true });
  return { path, sha256: createHash('sha256').update(text).digest('hex'), bytes: Buffer.byteLength(text) };
}

/** Close the live child before closing Playwright's owning app connection. */
export async function closeRecoveryApp(app: ElectronApplication): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => { await hostInvoke(app, 'gateway', 'stop'); await app.close(); })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('recovery app cleanup timed out')), 15_000); }),
    ]);
  } catch {
    // The fixture's bounded cleanup below owns the native process tree.
  } finally {
    if (timer) clearTimeout(timer);
    await closeElectronApp(app, 1_000);
  }
}
