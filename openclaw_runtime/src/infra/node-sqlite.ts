// Loads node:sqlite with OpenClaw warning handling.
import path from "node:path";
import { createRequire } from "node:module";
import { formatErrorMessage } from "./errors.js";
import { installProcessWarningFilter } from "./warning-filter.js";

const require = createRequire(import.meta.url);

type SqliteDiagnosticRecord = {
  path: string;
  createdStack: string | undefined;
  closeStack?: string;
  isOpenAtClose?: boolean;
  closeError?: string;
};

const SQLITE_DIAGNOSTICS_KEY = Symbol.for("openclaw.rc02.sqliteDiagnostics");

/**
 * Cross-module handle registry for node:sqlite DatabaseSync instances.
 *
 * Source and dist bundles load sqlite through this loader, so a handle opened
 * by a dist-inlined openclaw-state-db instance is not visible to the source
 * closeOpenClawStateDatabase() cache. Test teardown uses this registry to
 * close every handle that still points into the temp root being removed.
 */
const openHandlesByPath = new Map<string, Set<{ close: () => void }>>();

function registerOpenHandle(pathname: string, close: () => void): () => void {
  const normalized = path.resolve(pathname);
  let handles = openHandlesByPath.get(normalized);
  if (!handles) {
    handles = new Set();
    openHandlesByPath.set(normalized, handles);
  }
  const record = { close };
  handles.add(record);
  return () => {
    handles.delete(record);
    if (handles.size === 0) {
      openHandlesByPath.delete(normalized);
    }
  };
}

/** Test hygiene: close every tracked handle whose path is inside the given root. */
export function closeTrackedSqliteHandlesUnder(rootPath: string): number {
  const root = path.resolve(rootPath);
  let closed = 0;
  for (const [pathname, handles] of [...openHandlesByPath.entries()]) {
    if (!pathname.startsWith(`${root}${path.sep}`) && pathname !== root) {
      continue;
    }
    for (const handle of [...handles]) {
      try {
        handle.close();
        closed += 1;
      } catch {
        // A handle that already closed itself is already unregistered; a close
        // error on a live handle must not hide the remaining handles.
      }
    }
  }
  return closed;
}

function installSqliteDiagnostics(sqlite: typeof import("node:sqlite")):
  typeof import("node:sqlite") {
  const moduleRecord = sqlite as typeof sqlite & {
    [SQLITE_DIAGNOSTICS_KEY]?: boolean;
  };
  if (moduleRecord[SQLITE_DIAGNOSTICS_KEY]) {
    return sqlite;
  }
  const diagnosticsEnabled = process.env.OPENCLAW_RC02_SQLITE_DIAGNOSTICS === "1";
  const records: SqliteDiagnosticRecord[] = [];
  const OriginalDatabaseSync = sqlite.DatabaseSync;
  class TrackedDatabaseSync extends OriginalDatabaseSync {
    constructor(...args: ConstructorParameters<typeof OriginalDatabaseSync>) {
      super(...args);
      const record: SqliteDiagnosticRecord = {
        path: String(args[0] ?? ""),
        createdStack: diagnosticsEnabled ? new Error().stack : undefined,
      };
      if (diagnosticsEnabled) {
        records.push(record);
      }
      const close = this.close.bind(this);
      const unregister = registerOpenHandle(record.path, close);
      this.close = () => {
        record.closeStack = diagnosticsEnabled ? new Error().stack : undefined;
        unregister();
        try {
          const result = close();
          record.isOpenAtClose = this.isOpen;
          return result;
        } catch (error) {
          record.closeError = String(error);
          throw error;
        }
      };
    }
  }
  Object.defineProperty(moduleRecord, SQLITE_DIAGNOSTICS_KEY, { value: true });
  Object.defineProperty(sqlite, "DatabaseSync", {
    value: TrackedDatabaseSync,
    configurable: false,
    enumerable: true,
    writable: true,
  });
  if (diagnosticsEnabled) {
    process.on("exit", () => {
      for (const record of records) {
        if (record.path.includes("rc02-acceptance-")) {
          console.error("[rc02 sqlite]", JSON.stringify(record));
        }
      }
    });
  }
  return sqlite;
}

// node:sqlite is optional across Node versions, so callers get a clear runtime
// error instead of a low-level module resolution failure.
/** Load node:sqlite after installing the process warning filter. */
export function requireNodeSqlite(): typeof import("node:sqlite") {
  installProcessWarningFilter();
  try {
    return installSqliteDiagnostics(require("node:sqlite") as typeof import("node:sqlite"));
  } catch (err) {
    const message = formatErrorMessage(err);
    throw new Error(
      `SQLite support is unavailable in this Node runtime (missing node:sqlite). ${message}`,
      { cause: err },
    );
  }
}
