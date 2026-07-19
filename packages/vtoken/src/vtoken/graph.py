"""P1.3 / P1.4 — SIR graph, resolve primitive and TIR generation (spec §4).

resolve() guarantees (spec §4.2 + rulings D9–D12, D17):
- pure in-memory graph traversal, zero disk IO;
- bidirectional BFS (out-edges then in-edges, declaration order) — D9/D11;
- type_filter applies to OUTPUT only (root exempt), never prunes traversal — D10;
- dangling edge targets are silently skipped — D12;
- deterministic: same graph state + same args -> same string.
"""
from __future__ import annotations

from .errors import VTResolveError, VTStoreError
from .model import VTEdge, VTNode


class SIRGraph:
    def __init__(self, mode: str):
        self.mode = mode
        self.nodes: dict[str, VTNode] = {}
        self.out: dict[str, list[VTEdge]] = {}
        self.inn: dict[str, list[VTEdge]] = {}
        self.version = 0

    def add_node(self, node: VTNode, replace: bool = False) -> None:
        if node.id in self.nodes and not replace:
            raise VTStoreError(f"duplicate node id '{node.id}'")
        self.nodes[node.id] = node
        self.version += 1

    def add_edge(self, edge: VTEdge) -> None:
        self.out.setdefault(edge.src, []).append(edge)
        self.inn.setdefault(edge.dst, []).append(edge)
        self.version += 1

    def remove_node(self, node_id: str) -> bool:
        if node_id not in self.nodes:
            return False
        del self.nodes[node_id]
        for e in self.out.pop(node_id, []):
            lst = self.inn.get(e.dst)
            if lst and e in lst:
                lst.remove(e)
        for e in self.inn.pop(node_id, []):
            lst = self.out.get(e.src)
            if lst and e in lst:
                lst.remove(e)
        self.version += 1
        return True

    # ------------------------------------------------------------------ v0.4 merge

    def merge(self, other: "SIRGraph") -> "SIRGraph":
        """v0.4 (Task A) — 把 other 合并进 self，返回 self（in-place）。

        与 ``merge_doc_graphs`` 的区别：
        - ``merge_doc_graphs`` 严格模式，ID 冲突报错（D16，用于多 .vtg 文件合并）；
        - ``merge`` 用于 ingest 跨源合并，ID 冲突按 priority 覆盖（低 priority 数值
          = 高优先级，胜出）。

        节点合并规则：
        - ID 不冲突 → 直接 add_node
        - ID 冲突 → 比较 priority（数值越小越优先）；同 priority 时 self 保留
          （先到先得）。被覆盖节点的 source_files 列表合并到胜出节点。
        - 节点的 parts 在 ingest 层面是后写覆盖前写（同 ID 时由胜出方提供 parts）。

        边合并规则：
        - 同 src-rel-dst 三元组去重（rel=None 视为 untyped，仅 src-dst 唯一即可去重）
        - 不冲突的边直接 add_edge

        source_files 追加：
        - 节点首次 ingest 时 source_files=[source_file]（如有）
        - 合并时双方 source_files 列表合并去重
        """
        for node_id, other_node in other.nodes.items():
            existing = self.nodes.get(node_id)
            if existing is None:
                # 新节点 — 直接加入；复制以避免与源图共享可变对象
                self.add_node(VTNode(
                    id=other_node.id,
                    parts=list(other_node.parts),
                    line=other_node.line,
                    created_at=other_node.created_at,
                    source_file=other_node.source_file,
                    slot=other_node.slot,
                    priority=other_node.priority,
                    source_files=list(other_node.source_files),
                ))
            else:
                # ID 冲突 — 按 priority 覆盖（数值小者胜）
                if other_node.priority < existing.priority:
                    # other 胜出 — 替换 parts/line/slot/priority，保留 source_files 合并
                    existing.parts = list(other_node.parts)
                    existing.line = other_node.line
                    existing.slot = other_node.slot
                    existing.priority = other_node.priority
                # source_files 合并（无论谁胜出都累积）
                # existing 节点的 source_file（单值字段）也纳入列表
                if existing.source_file and existing.source_file not in existing.source_files:
                    existing.source_files.append(existing.source_file)
                for sf in other_node.source_files:
                    if sf and sf not in existing.source_files:
                        existing.source_files.append(sf)
                if other_node.source_file and other_node.source_file not in existing.source_files:
                    existing.source_files.append(other_node.source_file)
                self.version += 1

        # 边合并 — 同 src-rel-dst 去重
        existing_edge_keys = set()
        for src, edges in self.out.items():
            for e in edges:
                existing_edge_keys.add((e.src, e.rel, e.dst))
        for src, edges in other.out.items():
            for e in edges:
                key = (e.src, e.rel, e.dst)
                if key in existing_edge_keys:
                    continue
                existing_edge_keys.add(key)
                self.add_edge(VTEdge(src=e.src, dst=e.dst, rel=e.rel, line=e.line))
        return self


def graph_from_doc_payload(payload: dict, source_file: str | None = None) -> SIRGraph:
    """Build a doc-mode SIRGraph from a .vtg JSON payload (see compiler.build_vtg_payload).

    v0.4 (D31): reads optional ``slot`` / ``priority`` fields; absent → None / 5
    (preserves backward compatibility with v0.3 .vtg files).
    """
    g = SIRGraph("doc")
    for n in payload.get("nodes", []):
        node = VTNode(
            id=n["id"],
            parts=[tuple(p) for p in n["parts"]],
            line=n.get("line", 0),
            source_file=source_file,
            slot=n.get("slot"),            # 缺省 None（旧 .vtg 兼容）
            priority=n.get("priority", 5),  # 缺省 5（旧 .vtg 兼容）
        )
        g.add_node(node)
    for e in payload.get("edges", []):
        g.add_edge(VTEdge(src=e["src"], dst=e["dst"], rel=e.get("rel"), line=e.get("line", 0)))
    return g


def merge_doc_graphs(graphs: list) -> SIRGraph:
    """Merge several doc graphs into one; global id collision is an error (D16)."""
    merged = SIRGraph("doc")
    origin: dict[str, str] = {}
    for g in graphs:
        for node in g.nodes.values():
            if node.id in merged.nodes:
                raise VTStoreError(
                    f"duplicate node id '{node.id}' across files: "
                    f"{origin[node.id]!r} and {node.source_file!r}")
            merged.add_node(node)
            origin[node.id] = node.source_file or "<unknown>"
        for edges in g.out.values():
            for e in edges:
                merged.add_edge(e)
    return merged


def _display_id(node_id: str) -> str:
    # D17: the TIR prefix absorbs the '#' that mem ids already carry
    return node_id[1:] if node_id.startswith("#") else node_id


def resolve_tir(graphs: list, root_id: str, depth: int = 2,
                type_filter=None, include_untyped: bool = True,
                include_edges: bool = False, max_nodes: int | None = None,
                max_facets: int | None = None) -> str:
    """BFS from ``root_id`` across one or more graphs, return the TIR string.

    ``graphs`` order is part of the deterministic contract (doc graph first,
    then mem graph, in UnifiedStore).

    ``max_nodes`` (T0.4): if set, caps the number of distinct node ids in the
    output. The root always survives. BFS stops expanding the moment the cap
    is reached (current-layer truncation in declaration order), preserving
    determinism: same args + same graph state -> same string.

    ``max_facets`` (T2 / D27): if set, caps the number of facets (parts) emitted
    PER NODE in the TIR output. Selection rule (deterministic):
      1) type_filter is applied first (root exempt per D10), narrowing parts to
         the types the caller asked for;
      2) if the filtered list exceeds max_facets, the DEF facet (if any) always
         survives and remaining slots are filled in declaration order;
      3) if no DEF facet is present, the first ``max_facets`` parts are kept.
    Setting ``max_facets=1`` with type_filter=["RULE"] keeps only the RULE facet
    per node — useful for token-budgeted retrieval.
    """
    def find_node(nid: str):
        for g in graphs:
            node = g.nodes.get(nid)
            if node is not None:
                return node
        return None

    def neighbors(nid: str):
        result = []
        for g in graphs:
            for e in g.out.get(nid, []):
                result.append((e, e.dst))
        for g in graphs:
            for e in g.inn.get(nid, []):
                result.append((e, e.src))
        return result

    if find_node(root_id) is None:
        raise VTResolveError(f"node '{root_id}' not found")

    if max_nodes is not None and max_nodes < 1:
        raise ValueError("max_nodes must be >= 1 when set")
    if max_facets is not None and max_facets < 1:
        raise ValueError("max_facets must be >= 1 when set")

    def select_parts(node, is_root: bool, tf) -> list:
        """Pick the parts to emit for one node, honoring max_facets + type_filter.

        v0.4.1 (D32): RULE facet 也必保留（不只 DEF）。理由：RULE 是高优先级内容，
        必须出现在 prompt 里才能让 LLM 看到约束信息。
        截断时优先级：DEF → RULE → 其他（按 declaration order）。
        """
        parts = list(node.parts)
        # D10: type_filter applies to output only, root exempt
        if tf is not None and not is_root:
            parts = [p for p in parts if p[0] in tf]
        if max_facets is None or len(parts) <= max_facets:
            return parts
        # v0.4.1: keep DEF (if any) + RULE (if any) + first others in declaration order.
        def_idx = next((i for i, p in enumerate(parts) if p[0] == "DEF"), None)
        rule_idx = next((i for i, p in enumerate(parts) if p[0] == "RULE"), None)
        keep_idx = {i for i in [def_idx, rule_idx] if i is not None}
        if not keep_idx:
            return parts[:max_facets]
        kept = [parts[i] for i in sorted(keep_idx)]
        others = [p for i, p in enumerate(parts) if i not in keep_idx]
        remaining = max(0, max_facets - len(kept))
        return kept + others[:remaining]

    tf = set(type_filter) if type_filter else None
    order = [root_id]
    seen = {root_id}
    frontier = [root_id]
    visited_edges: list[VTEdge] = []
    seen_edge_ids: set[int] = set()
    capped = False

    for _ in range(max(0, depth)):
        if capped:
            break
        nxt: list[str] = []
        for nid in frontier:
            if capped:
                break
            for e, other in neighbors(nid):
                if e.rel is None and not include_untyped:
                    continue
                if find_node(other) is None:
                    continue  # dangling target/source — skip silently (D12)
                if id(e) not in seen_edge_ids:
                    seen_edge_ids.add(id(e))
                    visited_edges.append(e)
                if other in seen:
                    continue
                if max_nodes is not None and len(seen) >= max_nodes:
                    capped = True
                    break
                seen.add(other)
                order.append(other)
                nxt.append(other)
        frontier = nxt

    lines: list[str] = []
    for i, nid in enumerate(order):
        node = find_node(nid)
        disp = _display_id(nid)
        is_root = (i == 0)
        for (t, c) in select_parts(node, is_root, tf):
            if t:
                lines.append(f"[#{disp}:{t}] {c}")
            else:
                lines.append(f"[#{disp}] {c}")

    if include_edges:  # D21: opt-in, off by spec default
        for e in visited_edges:
            if e.src in seen and e.dst in seen:
                rel = f"--{e.rel}-->" if e.rel else "~~"
                lines.append(f"[#{_display_id(e.src)}] {rel} [#{_display_id(e.dst)}]")

    return "\n".join(lines)
