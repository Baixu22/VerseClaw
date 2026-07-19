"""UnifiedStore — the runtime facade over one merged doc graph + one mem session.

Cross-store rules (ruling D13): mem nodes may reference doc node ids; resolve
traverses both graphs; the doc graph itself stays read-only.

T5.1 doc hot-reload (spec §5.5): doc sources (.vt or .vtg) are tracked by
`st_mtime_ns`; on each resolve/toc/stats the store polls mtimes and, if any
source changed, recompiles/reloads and atomically swaps the merged doc graph
reference (the old graph is GC'd once in-flight readers release it). File
absence is tolerated (stale graph kept, no error) per HANDOFF T5.1 spec.
"""
from __future__ import annotations

import json
import os
import threading
from collections import Counter
from dataclasses import dataclass

from .errors import VTStoreError
from .graph import SIRGraph, graph_from_doc_payload, merge_doc_graphs, resolve_tir
from .memstore import MemStore


def load_vtg(path: str) -> SIRGraph:
    """Load one doc-mode .vtg into a SIRGraph. Pure load — resolve() afterwards
    never touches disk (spec §4.2)."""
    with open(path, "rb") as f:
        payload = json.loads(f.read().decode("utf-8"))
    if payload.get("mode") != "doc":
        raise VTStoreError(f"{path} is not a doc-mode .vtg (use MemStore for mem snapshots)")
    return graph_from_doc_payload(payload, source_file=path)


def load_doc_graphs(paths) -> SIRGraph:
    """Load and merge several .vtg files; cross-file id collisions raise (D16)."""
    return merge_doc_graphs([load_vtg(p) for p in paths])


def _compile_and_load(vt_path: str, out_path: str | None = None) -> "tuple[SIRGraph, str]":
    """Compile one .vt → load the resulting .vtg → return (SIRGraph, out_path).
    Late import of compiler avoids circular import (compiler imports model
    which is fine; store imports compiler lazily)."""
    from .compiler import compile_file  # noqa: WPS433
    actual_out, _parsed = compile_file(vt_path, out_path=out_path)
    return load_vtg(actual_out), actual_out


@dataclass
class GraphHolder:
    """T5.1: holds one doc source's live graph + mtime for hot-reload detection.

    `is_compiled=True` means source is .vt (recompile on change);
    `False` means .vtg (just reload).
    """
    source_path: str
    source_mtime_ns: int
    graph: SIRGraph
    is_compiled: bool

    def refresh(self) -> bool:
        """Check source mtime; if changed, rebuild graph in place. Return True if changed.

        File-not-found (HANDOFF T5.1 容错): keep stale graph, return False.
        """
        try:
            stat = os.stat(self.source_path)
        except FileNotFoundError:
            return False
        if stat.st_mtime_ns == self.source_mtime_ns:
            return False
        # mtime changed — reload
        if self.is_compiled:
            new_graph, _ = _compile_and_load(self.source_path)
        else:
            new_graph = load_vtg(self.source_path)
        self.graph = new_graph
        self.source_mtime_ns = stat.st_mtime_ns
        return True


class UnifiedStore:
    def __init__(self, doc_graph: SIRGraph | None = None,
                 mem_store: MemStore | None = None,
                 doc_sources: "list[str] | None" = None):
        """Construct a unified store.

        Backward-compat modes:
        - doc_graph: pre-loaded SIRGraph, no hot-reload (legacy).
        - doc_sources: list of .vt or .vtg paths; mtime-polled for hot reload (T5.1).
        """
        # Dedicated RLock for doc hot-reload (separate from mem._lock to avoid
        # cross-contention; resolve still nests both when mem present).
        self._doc_lock = threading.RLock()
        self.mem = mem_store
        self._doc_holders: list[GraphHolder] = []
        if doc_sources:
            for src_path in doc_sources:
                self._doc_holders.append(self._build_holder(src_path))
            self.doc = self._merge_holders()
        else:
            self.doc = doc_graph

    @staticmethod
    def _build_holder(source_path: str) -> GraphHolder:
        ext = os.path.splitext(source_path)[1].lower()
        if ext == ".vtg":
            graph = load_vtg(source_path)
            is_compiled = False
        elif ext == ".vt":
            graph, _ = _compile_and_load(source_path)
            is_compiled = True
        else:
            raise VTStoreError(
                f"unsupported doc source extension: {ext!r} (expected .vt or .vtg): {source_path}"
            )
        try:
            mtime = os.stat(source_path).st_mtime_ns
        except FileNotFoundError:
            mtime = 0  # source missing at startup; refresh() will tolerate later too
        return GraphHolder(source_path=source_path, source_mtime_ns=mtime,
                           graph=graph, is_compiled=is_compiled)

    def _merge_holders(self) -> SIRGraph:
        if not self._doc_holders:
            return None  # type: ignore[return-value]
        if len(self._doc_holders) == 1:
            return self._doc_holders[0].graph
        return merge_doc_graphs([h.graph for h in self._doc_holders])

    def _maybe_reload(self) -> bool:
        """Poll doc sources' mtimes; if any changed, rebuild merged doc graph and
        atomically swap self.doc. Returns True if a reload occurred.

        Cheap no-op when no holders configured. Thread-safe via self._doc_lock
        (reentrant — safe to call from inside resolve() which holds mem._lock).
        """
        if not self._doc_holders:
            return False
        with self._doc_lock:
            any_changed = False
            for holder in self._doc_holders:
                if holder.refresh():
                    any_changed = True
            if any_changed:
                # Atomic reference swap — in-flight readers still holding the
                # old self.doc reference keep using it (GC'd when they release).
                self.doc = self._merge_holders()
            return any_changed

    @classmethod
    def open(cls, vtg_paths=(), session_dir: str | None = None,
             session: str | None = None, doc_sources=None, **mem_kwargs) -> "UnifiedStore":
        """Open a unified store.

        Args:
            vtg_paths: legacy — load .vtg files once, no hot-reload.
            doc_sources: T5.1 — list of .vt or .vtg paths; mtime-polled for hot reload.
            session_dir / session / mem_kwargs: passed to MemStore if both present.
        """
        if doc_sources:
            store = cls(doc_sources=doc_sources, mem_store=None)
        else:
            doc = load_doc_graphs(vtg_paths) if vtg_paths else None
            store = cls(doc_graph=doc, mem_store=None)
        if session_dir and session:
            store.mem = MemStore(session_dir, session, **mem_kwargs)
        return store

    # ------------------------------------------------------------------ queries

    def _graphs(self) -> list:
        graphs = []
        if self.doc is not None:
            graphs.append(self.doc)
        if self.mem is not None:
            graphs.append(self.mem.graph)
        if not graphs:
            raise VTStoreError("UnifiedStore has no graphs loaded")
        return graphs

    def resolve(self, node_id: str, depth: int = 2, type_filter=None,
                include_untyped: bool = True, include_edges: bool = False,
                max_nodes: int | None = None, max_facets: int | None = None) -> str:
        # T5.1: poll mtimes; reload if changed (cheap if no holders).
        # Done BEFORE taking mem._lock so reload never blocks on mem writes.
        self._maybe_reload()
        graphs = self._graphs()
        if self.mem is not None:
            with self.mem._lock:
                return resolve_tir(graphs, node_id, depth=depth, type_filter=type_filter,
                                   include_untyped=include_untyped, include_edges=include_edges,
                                   max_nodes=max_nodes, max_facets=max_facets)
        return resolve_tir(graphs, node_id, depth=depth, type_filter=type_filter,
                           include_untyped=include_untyped, include_edges=include_edges,
                           max_nodes=max_nodes, max_facets=max_facets)

    def toc(self) -> str:
        """D20 cold-start entry point: TIR of every DEF facet in the doc graph."""
        self._maybe_reload()
        if self.doc is None:
            return ""
        lines = []
        for n in self.doc.nodes.values():
            for t, c in n.parts:
                if t == "DEF":
                    lines.append(f"[#{n.id}:DEF] {c}")
        return "\n".join(lines)

    def search(self, query: str, top_k: int = 10) -> list:
        """T5.5 — offline TF-IDF search over doc + mem graphs (D30).

        Hot-reload aware: rebuilds index when doc graph changes (T5.1) or mem
        graph version bumps (write/delete).
        """
        self._maybe_reload()
        from .search import SearchIndex
        # Combine doc + mem graphs; rebuild index if either changed
        graphs = []
        if self.doc is not None:
            graphs.append(self.doc)
        if self.mem is not None:
            graphs.append(self.mem.graph)
        if not graphs:
            return []

        # Cache key: (doc_version, mem_version)
        doc_v = self.doc.version if self.doc is not None else 0
        mem_v = self.mem.graph.version if self.mem is not None else 0
        cache_key = (doc_v, mem_v)
        if (getattr(self, "_search_index", None) is None
                or getattr(self, "_search_cache_key", None) != cache_key):
            idx = SearchIndex()
            idx.build(graphs)
            self._search_index = idx  # type: ignore[attr-defined]
            self._search_cache_key = cache_key  # type: ignore[attr-defined]
        return self._search_index.query(query, top_k=top_k)  # type: ignore[attr-defined]

    # ------------------------------------------------------------------ v0.4 assemble

    def assemble(self, task_hint: str, budget_tokens: int = 32000,
                 slots: "dict | None" = None,
                 render_mode: str = "compact") -> "object":
        """v0.4 Task F — ContextAssembler 包装入口。

        把 store 中 doc + mem 图内容组装为 token 预算可控的最终 prompt。
        这是 VT 在新定位下的核心对外 API。

        参数：
            task_hint     : 当前任务描述，用于 BFS 起点选择
            budget_tokens : 总 token 预算（默认 32000）
            slots         : 自定义 SlotConfig 字典；None 用 DEFAULT_SLOTS
            render_mode   : v0.4.2 "compact"（默认，单字符 TYPE 编码 + slot 内联）
                            / "dense"（极简，纯内容，working context 密度最大）
                            / "verbose"（调试，旧格式 ## slot + [#id:TYPE]）

        返回：
            AssembleResult（prompt / tokens_used / slot_breakdown /
            nodes_included / nodes_evicted / dedup_count）
        """
        from .assembler import ContextAssembler, DEFAULT_SLOTS
        self._maybe_reload()
        asm = ContextAssembler()
        return asm.assemble(task_hint, budget_tokens,
                            slots if slots is not None else DEFAULT_SLOTS,
                            self, render_mode=render_mode)

    def ingest(self, source: str, source_type: str = "auto") -> int:
        """v0.4 — 把任意格式源 ingest 进当前 doc 图。

        参数：
            source      : 源路径（.md / .json）
            source_type : "md" | "json" | "auto"（按扩展名推断）

        返回：
            新增节点数
        """
        from .ingest import ingest_markdown_file, ingest_tool_schemas_from_json
        if source_type == "auto":
            ext = os.path.splitext(source)[1].lower()
            if ext == ".md":
                source_type = "md"
            elif ext == ".json":
                source_type = "json"
            else:
                raise VTStoreError(f"cannot infer source_type from {ext!r}")

        if source_type == "md":
            new_graph = ingest_markdown_file(source)
        elif source_type == "json":
            new_graph = ingest_tool_schemas_from_json(source)
        else:
            raise VTStoreError(f"unsupported source_type: {source_type!r}")

        before = len(self.doc.nodes) if self.doc else 0
        if self.doc is None:
            self.doc = new_graph
        else:
            self.doc.merge(new_graph)
        after = len(self.doc.nodes)
        return after - before

    def stats(self) -> dict:
        self._maybe_reload()
        type_counts: Counter = Counter()
        doc_nodes = doc_edges = mem_nodes = 0
        if self.doc is not None:
            doc_nodes = len(self.doc.nodes)
            doc_edges = sum(len(v) for v in self.doc.out.values())
            for n in self.doc.nodes.values():
                for t, _ in n.parts:
                    type_counts[t or "(untyped)"] += 1
        if self.mem is not None:
            mem_nodes = len(self.mem.graph.nodes)
            for n in self.mem.graph.nodes.values():
                for t, _ in n.parts:
                    type_counts[t or "(untyped)"] += 1
        return {"doc_nodes": doc_nodes, "doc_edges": doc_edges,
                "mem_nodes": mem_nodes, "parts_by_type": dict(type_counts)}

    # ------------------------------------------------------------------ mem passthrough

    def write(self, content: str, type: str | None = None, edges=None, tag: str | None = None) -> str:
        if self.mem is None:
            raise VTStoreError("no mem session attached (open with session_dir + session)")
        return self.mem.write(content, type=type, edges=edges, tag=tag)

    def delete(self, node_id: str) -> bool:
        if self.mem is None:
            raise VTStoreError("no mem session attached")
        return self.mem.delete(node_id)

    def close(self) -> None:
        if self.mem is not None:
            self.mem.close()
