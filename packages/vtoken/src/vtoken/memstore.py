"""P1.5 / P1.6 — %mode mem runtime store: vt.write() + WAL + crash recovery (spec §5).

Rulings applied (see DECISIONS.md):
- D3: durability="fsync" (default, strong §5.2 guarantee) or "flush" (weak §5.4 guarantee)
- D4: recovery = ordered idempotent replay, no "node count only grows" invariant
- D5: delete() API added (WAL already had the op)
- D8: node type = ``type or tag`` (single stored field, matches §5.3 WAL shape)
- D13: edges may target doc-graph ids (cross-store anchoring)
- D14: next_seq persisted in snapshot + bumped by WAL replay; ids never reused
- D15: checkpoint order = snapshot -> replace -> truncate WAL -> append marker
"""
from __future__ import annotations

import errno
import json
import os
import sys
import threading
import time

from .errors import VTStoreError
from .graph import SIRGraph, resolve_tir
from .model import VTEdge, VTNode
from .parser import parse_vt_file


def _now_ms() -> int:
    return int(time.time() * 1000)


# --- process liveness probe ------------------------------------------------
#
# ``os.kill(pid, 0)`` is reliable on POSIX (ESRCH = no such process). On
# Windows it raises ``PermissionError`` for both "process exists, different
# user" AND "process does not exist" (OpenProcess returns NULL with
# ERROR_INVALID_PARAMETER for unknown pids, but Python wraps that case as
# PermissionError) — i.e. it cannot tell dead from alive. We therefore use
# ctypes to call OpenProcess + GetExitCodeProcess directly on win32.

if sys.platform == "win32":
    import ctypes
    from ctypes import wintypes

    _PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    _STILL_ACTIVE = 259
    _ERROR_ACCESS_DENIED = 5
    _kernel32 = ctypes.windll.kernel32

    _OpenProcess = _kernel32.OpenProcess
    _OpenProcess.restype = wintypes.HANDLE
    _OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]

    _GetExitCodeProcess = _kernel32.GetExitCodeProcess
    _GetExitCodeProcess.restype = wintypes.BOOL
    _GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]

    _CloseHandle = _kernel32.CloseHandle
    _CloseHandle.restype = wintypes.BOOL
    _CloseHandle.argtypes = [wintypes.HANDLE]

    _GetLastError = _kernel32.GetLastError

    def _is_pid_alive(pid: int) -> bool:
        if pid <= 0:
            return False
        handle = _OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not handle:
            # ERROR_ACCESS_DENIED (5) on Windows means the process DOES exist
            # but is owned by another principal we cannot query — treat as
            # alive to be safe. Any other error (e.g. ERROR_INVALID_PARAMETER
            # 87 for an unknown pid) means the process is gone.
            return _GetLastError() == _ERROR_ACCESS_DENIED
        try:
            exit_code = wintypes.DWORD()
            if not _GetExitCodeProcess(handle, ctypes.byref(exit_code)):
                return False
            return exit_code.value == _STILL_ACTIVE
        finally:
            _CloseHandle(handle)
else:
    def _is_pid_alive(pid: int) -> bool:
        if pid <= 0:
            return False
        try:
            os.kill(pid, 0)
            return True
        except ProcessLookupError:
            return False
        except OSError as e:
            if e.errno == errno.ESRCH:
                return False
            # EPERM = exists but not queryable — be conservative.
            return True


class MemStore:
    def __init__(self, directory: str, session: str, *,
                 durability: str = "fsync", checkpoint_every: int = 1000):
        if durability not in ("fsync", "flush"):
            raise ValueError("durability must be 'fsync' or 'flush'")
        os.makedirs(directory, exist_ok=True)
        self.session = session
        self.dir = directory
        self.vtg_path = os.path.join(directory, f"{session}.vtg")
        self.wal_path = os.path.join(directory, f"{session}.vtwal")
        self.lock_path = os.path.join(directory, f"{session}.lock")
        self.durability = durability
        self.checkpoint_every = checkpoint_every
        self._lock = threading.RLock()
        self.graph = SIRGraph("mem")
        self._next_seq = 1
        self._ops_since_checkpoint = 0
        self.recovered = {"snapshot_nodes": 0, "replayed_ops": 0, "skipped_partial_tail": False}
        self._checkpointer_thread = None
        self._checkpointer_stop = None
        self._lock_acquired = False
        # T5.5 search index cache (rebuilt when graph.version changes)
        self._search_index = None
        self._search_version = -1
        self._acquire_lock()
        self._recover()
        self._wal = open(self.wal_path, "a", encoding="utf-8")

    # ------------------------------------------------------------------ write path

    def _acquire_lock(self) -> None:
        """T0.2 — per-session mutex via <session>.lock holding the owner pid.

        Strategy: atomic O_CREAT|O_EXCL create. If the file already exists,
        read the recorded pid; if that pid is still alive (or is this process)
        raise VTStoreError; otherwise treat as a stale lock from a crashed
        previous owner, unlink and re-acquire. The second O_EXCL attempt guards
        against the race where another process took over between our check
        and our unlink.
        """
        my_pid = os.getpid()
        try:
            fd = os.open(self.lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            holder = self._read_lock_pid()
            if holder is not None and (holder == my_pid or _is_pid_alive(holder)):
                raise VTStoreError(
                    f"session '{self.session}' is locked by pid {holder}")
            # Stale lock — take over.
            try:
                os.unlink(self.lock_path)
            except FileNotFoundError:
                pass
            try:
                fd = os.open(self.lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            except FileExistsError:
                # Lost the takeover race; another process owns it now.
                raise VTStoreError(
                    f"session '{self.session}' is locked by another process")
        os.write(fd, f"{my_pid}\n".encode("ascii"))
        os.close(fd)
        self._lock_acquired = True

    def _read_lock_pid(self) -> int | None:
        """Best-effort read of the pid stored in the lockfile. Returns None on
        any parse/IO failure (treated as a stale lock by the caller)."""
        try:
            with open(self.lock_path, "r", encoding="ascii") as f:
                raw = f.read().strip()
            return int(raw)
        except (OSError, ValueError):
            return None

    def _release_lock(self) -> None:
        if not self._lock_acquired:
            return
        # Only delete the lockfile if it still points at us; a crash + takeover
        # by another process may have replaced it.
        holder = self._read_lock_pid()
        if holder == os.getpid():
            try:
                os.unlink(self.lock_path)
            except FileNotFoundError:
                pass
        self._lock_acquired = False

    def write(self, content: str, type: str | None = None,
              edges=None, tag: str | None = None) -> str:
        """spec §5.2 — returns the new auto-increment id (e.g. "#007").
        On return the node is resolvable AND the WAL record is persisted."""
        if not isinstance(content, str) or not content.strip():
            raise VTStoreError("content must be a non-empty string")
        ntype = type if type is not None else tag  # D8
        edge_list = list(edges) if edges else []
        for t in edge_list:
            if not isinstance(t, str) or not t:
                raise VTStoreError(f"invalid edge target {t!r}")
        with self._lock:
            nid = f"#{self._next_seq:03d}"
            self._next_seq += 1
            ts = _now_ms()
            self.graph.add_node(VTNode(id=nid, parts=[(ntype, content.strip())], created_at=ts))
            for t in edge_list:
                self.graph.add_edge(VTEdge(src=nid, dst=t, rel=None))  # mem edges are untyped
            self._append({"op": "write", "id": nid, "type": ntype,
                          "content": content.strip(), "edges": edge_list, "ts": ts})
            self._ops_since_checkpoint += 1
            if self.checkpoint_every and self._ops_since_checkpoint >= self.checkpoint_every:
                self.checkpoint()
            return nid

    def delete(self, node_id: str) -> bool:
        """D5 — remove a mem node (edges cleaned both directions). Ids are never reused."""
        with self._lock:
            ok = self.graph.remove_node(node_id)
            if ok:
                self._append({"op": "delete", "id": node_id, "ts": _now_ms()})
                self._ops_since_checkpoint += 1
            return ok

    def resolve(self, node_id: str, depth: int = 2, type_filter=None,
                include_untyped: bool = True, include_edges: bool = False,
                max_nodes: int | None = None, max_facets: int | None = None) -> str:
        with self._lock:
            return resolve_tir([self.graph], node_id, depth=depth, type_filter=type_filter,
                               include_untyped=include_untyped, include_edges=include_edges,
                               max_nodes=max_nodes, max_facets=max_facets)

    def search(self, query: str, top_k: int = 10) -> list:
        """T5.5 — offline TF-IDF search over this session's mem graph (D30).

        Builds/reuses a SearchIndex; rebuilds when graph version changes.
        """
        from .search import SearchIndex
        with self._lock:
            if (self._search_index is None
                    or self._search_version != self.graph.version):
                idx = SearchIndex()
                idx.build([self.graph])
                self._search_index = idx
                self._search_version = self.graph.version
            return self._search_index.query(query, top_k=top_k)

    # ------------------------------------------------------------------ persistence

    def _append(self, rec: dict) -> None:
        self._wal.write(json.dumps(rec, ensure_ascii=False) + "\n")
        self._wal.flush()
        if self.durability == "fsync":
            os.fsync(self._wal.fileno())

    def checkpoint(self) -> None:
        """Serialize the graph to .vtg (atomic replace), truncate the WAL, append marker.
        Every intermediate crash window is safe because replay is idempotent (D15)."""
        with self._lock:
            payload = {
                "vtg": 1, "mode": "mem", "session": self.session,
                "next_seq": self._next_seq,
                "nodes": [self._node_payload(n) for n in self.graph.nodes.values()],
            }
            data = (json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
            tmp = self.vtg_path + ".new"
            with open(tmp, "wb") as f:
                f.write(data)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, self.vtg_path)
            # truncate WAL (Windows requires closing the handle first)
            self._wal.close()
            with open(self.wal_path, "w", encoding="utf-8"):
                pass
            self._wal = open(self.wal_path, "a", encoding="utf-8")
            last_id = f"#{self._next_seq - 1:03d}" if self._next_seq > 1 else None
            self._append({"op": "checkpoint", "snapshot": os.path.basename(self.vtg_path),
                          "up_to_id": last_id, "ts": _now_ms()})
            self._ops_since_checkpoint = 0

    def _node_payload(self, n: VTNode) -> dict:
        t, c = n.parts[0]
        return {"id": n.id, "type": t, "content": c, "ts": n.created_at,
                "edges": [e.dst for e in self.graph.out.get(n.id, [])]}

    # ------------------------------------------------------------------ recovery (P1.6)

    def _recover(self) -> None:
        # Step 1 (spec §5.4): load snapshot if present
        if os.path.exists(self.vtg_path):
            with open(self.vtg_path, encoding="utf-8") as f:
                payload = json.load(f)
            if payload.get("mode") != "mem":
                raise VTStoreError(f"{self.vtg_path} is not a mem-mode snapshot")
            for n in payload.get("nodes", []):
                self.graph.add_node(VTNode(id=n["id"], parts=[(n.get("type"), n["content"])],
                                           created_at=n.get("ts"), source_file=self.vtg_path))
                for t in n.get("edges", []):
                    self.graph.add_edge(VTEdge(src=n["id"], dst=t, rel=None))
            self._next_seq = int(payload.get("next_seq", 1))
            self.recovered["snapshot_nodes"] = len(payload.get("nodes", []))

        # Step 2: replay WAL records after the last checkpoint marker
        if not os.path.exists(self.wal_path):
            return
        with open(self.wal_path, encoding="utf-8") as f:
            raw_lines = f.read().splitlines()
        records = []
        for i, ln in enumerate(raw_lines):
            if not ln.strip():
                continue
            try:
                records.append(json.loads(ln))
            except json.JSONDecodeError:
                if i == len(raw_lines) - 1:
                    # partial tail line = crash mid-append; drop it (§5.4 loss window)
                    self.recovered["skipped_partial_tail"] = True
                    break
                raise VTStoreError(f"corrupt WAL record at {self.wal_path}:{i + 1}")
        last_cp = -1
        for i, r in enumerate(records):
            if r.get("op") == "checkpoint":
                last_cp = i
        for r in records[last_cp + 1:]:
            op = r.get("op")
            if op == "write":
                nid = r["id"]
                # idempotent replay: a record may overlap the snapshot (crash between
                # snapshot replace and WAL truncate). Edge invariant: src's record
                # always appears at-or-after dst's, so removed in-edges are rebuilt.
                if nid in self.graph.nodes:
                    self.graph.remove_node(nid)
                self.graph.add_node(VTNode(id=nid, parts=[(r.get("type"), r.get("content", ""))],
                                           created_at=r.get("ts")))
                for t in r.get("edges") or []:
                    self.graph.add_edge(VTEdge(src=nid, dst=t, rel=None))
                self._bump_seq(nid)
                self.recovered["replayed_ops"] += 1
            elif op == "delete":
                self.graph.remove_node(r["id"])
                self._bump_seq(r["id"])
                self.recovered["replayed_ops"] += 1
            # checkpoint records inside the tail are skipped by construction

    def _bump_seq(self, nid: str) -> None:
        try:
            n = int(nid.lstrip("#"))
        except ValueError:
            return
        if n >= self._next_seq:
            self._next_seq = n + 1

    # ------------------------------------------------------------------ import/export (D6)

    def import_vt(self, vt_path: str) -> list:
        """Load a %mode mem .vt file by replaying its items through write()."""
        parsed = parse_vt_file(vt_path)
        if parsed.header.mode != "mem":
            raise VTStoreError(f"{vt_path} is not a %mode mem file")
        return [self.write(item.content, tag=item.tag) for item in parsed.mem_items]

    def export_vt(self) -> str:
        """Render the current session back to %mode mem .vt text (human review/archive)."""
        with self._lock:
            lines = ["%vt 0.3.1", "%mode mem", f"%session {self.session}", ""]
            for n in self.graph.nodes.values():
                t, c = n.parts[0]
                lines.append(f"#{t} {c}" if t else f"- {c}")
            return "\n".join(lines) + "\n"

    def start_background_checkpointer(self, interval_s: float = 60.0) -> None:
        """T0.3 — spec §5.1: checkpoint every N records OR every ~60s.

        Spawns a daemon thread that wakes every ``interval_s`` seconds and
        calls checkpoint() (already thread-safe via self._lock). Default
        behaviour stays unchanged (no background thread) — callers opt in.
        close() stops the thread. A zero/negative interval is rejected.
        """
        if interval_s <= 0:
            raise ValueError("interval_s must be positive")
        with self._lock:
            if self._checkpointer_thread is not None:
                return  # already running — idempotent
            stop = threading.Event()
            self._checkpointer_stop = stop

            def _loop():
                while not stop.wait(timeout=interval_s):
                    try:
                        self.checkpoint()
                    except Exception:
                        # Background thread must never crash the store; the
                        # next write-side checkpoint will retry.
                        pass

            t = threading.Thread(target=_loop, name=f"vt-checkpoint-{self.session}",
                                 daemon=True)
            self._checkpointer_thread = t
            t.start()

    def close(self) -> None:
        with self._lock:
            if self._checkpointer_stop is not None:
                self._checkpointer_stop.set()
            thread = self._checkpointer_thread
            self._checkpointer_thread = None
            self._checkpointer_stop = None
        if thread is not None and thread is not threading.current_thread():
            thread.join(timeout=5.0)
        with self._lock:
            try:
                self._wal.flush()
                self._wal.close()
            except Exception:
                pass
            self._release_lock()
