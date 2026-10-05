import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

export type VerseConfStateDatabaseOptions = {
  env?: NodeJS.ProcessEnv;
  path?: string;
};

export type VerseConfStateDatabase = {
  db: DatabaseSync;
  path: string;
};

function defaultStateDirectory(env: NodeJS.ProcessEnv): string {
  const configured = env.VERSECONF_STATE_DIR?.trim() || env.OPENCLAW_STATE_DIR?.trim();
  if (configured) return configured;
  const home = env.OPENCLAW_HOME?.trim() || env.USERPROFILE?.trim() || env.HOME?.trim() || process.cwd();
  return path.join(home, ".openclaw");
}

export function openVerseConfStateDatabase(options: VerseConfStateDatabaseOptions = {}): VerseConfStateDatabase {
  const env = options.env ?? process.env;
  const databasePath = options.path?.trim() || env.VERSECONF_STATE_DB_PATH?.trim() || path.join(defaultStateDirectory(env), "verseconf.sqlite");
  mkdirSync(path.dirname(databasePath), { recursive: true });
  return { db: new DatabaseSync(databasePath), path: databasePath };
}

export function closeVerseConfStateDatabase(database: DatabaseSync): void {
  database.close();
}

export function runVerseConfStateWriteTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = fn();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve the original failure */ }
    throw error;
  }
}
