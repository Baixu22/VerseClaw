"""Task D — ContextAssembler (v0.4 Context Assembly Engine 核心创新层).

把多源 SIR 图内容组装为 token 预算可控的最终 prompt。这是 VT 的核心价值层。

执行顺序（assemble() 内部）：
1. ``search(task_hint)`` → 候选节点集（粗筛，v0.4.1 增强召回）
2. ``resolve(candidates, depth)`` → 子图（精筛）
3. ``cross_dedup()`` → 跨 slot 去重
4. ``budget_pack()`` → 按 priority + slot_weight 装箱到 budget 内
5. ``order()`` → 高 priority 节点置前（v0.4.1 改进：节点 priority 二次排序）
6. ``render()`` → 最终 prompt 文本（v0.4.1 高密度格式）

D27 继承：DEF facet 永远保留。
D31 新增：slot + priority 字段决定组装顺序。
D32 (v0.4.1) — 信息密度优化：
    - prompt 格式从 `## slot_name` + `[#id:TYPE] content` 改为紧凑格式
      `@slot content`（slot 缩成单字符前缀，去掉 ID 与 TYPE 冗余）
    - search top_k 从 30 提高到 100，并加入 BFS 1-hop 扩展（让大 budget 能装满）
    - 同 slot 内按节点 priority 二次排序（让 RULE 真正排到 DEF 之前）
    - 提供 render_mode 参数：compact（默认）/ verbose（保留旧格式，调试用）
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from .graph import SIRGraph, resolve_tir
from .model import VTNode


# ---------------------------------------------------------------------------
# 数据类
# ---------------------------------------------------------------------------

@dataclass
class SlotConfig:
    """单个 slot 的配置。"""
    name: str          # "system" | "tools" | "knowledge" | "working"
    weight: float      # 占总预算比例上限，如 0.15
    priority: int      # slot 间优先级，高优先级 slot 先装箱（数值小先装）
    sources: list      # 哪些 SIR 图 ID 前缀属于这个 slot
    depth: int         # 该 slot 的 BFS depth
    max_nodes: int     # 该 slot 的节点预算


@dataclass
class AssembleResult:
    """assemble() 的返回结果。"""
    prompt: str              # 最终拼装文本
    tokens_used: int         # 实际消耗 token 数
    tokens_budget: int       # 预算上限
    slot_breakdown: dict     # 每个 slot 实际用了多少 token + 节点数
    nodes_included: list     # 包含的节点 ID 列表（可审计）
    nodes_evicted: list      # 被裁剪的节点 ID 列表（可审计）
    dedup_count: int         # 去重掉的重复节点数

    def format_explain_report(self) -> str:
        """Task H — 人类可读的 assembly 报告（用于 ``vt assemble --explain``）。

        格式（ASCII，避免 box-drawing 字符在不同终端错位）::

            ── Context Assembly Report ──────────────
            Budget:   8,432 / 32,000 tokens (26.4%)
            Slots:
              system      1,203 tok   15 nodes
              tools       2,841 tok   28 nodes
              knowledge   3,109 tok   31 nodes
              working     1,279 tok   18 nodes
            Deduped:  12 nodes (跨 slot 重复)
            Evicted:   8 nodes (超出预算)
            Included: 92 nodes
            ────────────────────────────────────────
        """
        pct = (100.0 * self.tokens_used / self.tokens_budget) if self.tokens_budget else 0.0
        lines: list[str] = []
        lines.append("── Context Assembly Report ──────────────")
        lines.append(f"Budget:   {self.tokens_used:,} / {self.tokens_budget:,} tokens ({pct:.1f}%)")
        lines.append("Slots:")
        # 按 slot_breakdown 的插入顺序输出（dict 保持 Python 3.7+ 顺序）
        for slot_name, info in self.slot_breakdown.items():
            tok = int(info.get("tokens", 0)) if isinstance(info, dict) else 0
            nodes = int(info.get("nodes", 0)) if isinstance(info, dict) else 0
            lines.append(f"  {slot_name:<10s}  {tok:>6,} tok  {nodes:>3} nodes")
        lines.append(f"Deduped:  {self.dedup_count} nodes (跨 slot 重复)")
        lines.append(f"Evicted:  {len(self.nodes_evicted)} nodes (超出预算)")
        lines.append(f"Included: {len(self.nodes_included)} nodes")
        lines.append("────────────────────────────────────────")
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# 默认 slot 配置
# ---------------------------------------------------------------------------

DEFAULT_SLOTS: dict[str, SlotConfig] = {
    "system": SlotConfig(
        name="system", weight=0.15, priority=1,
        sources=["system.", "rule.", "constraint.", "spec."],
        depth=1, max_nodes=20,
    ),
    "tools": SlotConfig(
        name="tools", weight=0.20, priority=2,
        sources=["tool.", "mcp.", "skill."],
        depth=2, max_nodes=30,
    ),
    "knowledge": SlotConfig(
        name="knowledge", weight=0.40, priority=3,
        sources=["doc.", "arch.", "spec.", "auth.", "middleware.", "db.", "api."],
        depth=2, max_nodes=50,
    ),
    "working": SlotConfig(
        name="working", weight=0.25, priority=4,
        sources=["task.", "mem.", "session.", "#"],
        depth=1, max_nodes=40,
    ),
}


# v0.4.2 (D33) — compact 渲染的 TYPE 单字符编码表
# 目的：把每行 `DEF|content` 节省为 `D|content`，累积降低 meta overhead。
_TYPE_CODE: dict[str, str] = {
    "DEF": "D",
    "RULE": "R",
    "DESC": "E",  # E for dEscribe，避免与 DEF 冲突
    "EX": "X",
    "VAR": "V",
    "META": "M",
    "OPEN": "O",
    "SCHEMA": "S",
}


# ---------------------------------------------------------------------------
# ContextAssembler
# ---------------------------------------------------------------------------

class ContextAssembler:
    """把多源 SIR 图内容组装为 token 预算可控的最终 prompt。

    这是 VT 的核心价值层。
    """

    def __init__(self, tokenizer: Callable[[str], int] | None = None):
        """``tokenizer`` 默认用字符数（粗略估算），实际使用应传入 cl100k_base 等。"""
        if tokenizer is None:
            # 默认 token 计数器：4 字符 ≈ 1 token（粗略）；
            # 空串/空白串返回 0（避免空 prompt 报告为 1 token）
            self._tokenizer = lambda s: simple_token_counter(s)
        else:
            self._tokenizer = tokenizer

    def assemble(
        self,
        task_hint: str,
        budget_tokens: int,
        slots: dict[str, SlotConfig] | None,
        store,
        render_mode: str = "compact",
    ) -> AssembleResult:
        """主入口。

        v0.4.2 信息密度优化（D33）：
        - ``"compact"`` (默认) — TYPE 单字符编码（DEF→D/RULE→R/DESC→E/EX→X/VAR→V/META→M）
          + slot marker 内联到首 facet 行（`@S D|content` 代替 `@S\\nD|content`），
          相比 v0.4.1 再降 ~30% meta overhead
        - ``"dense"`` — 极简格式：无 TYPE 前缀、无 slot marker，纯内容按行输出
          （working context 密度最大化，但 LLM 失去结构线索，适合 budget 极紧场景）
        - ``"verbose"`` — 保留 v0.4 旧格式（## slot + [#id:TYPE] content），调试用
        """
        if slots is None:
            slots = DEFAULT_SLOTS

        # 收集所有图（doc + mem）
        graphs = self._collect_graphs(store)
        all_nodes: dict[str, VTNode] = {}
        for g in graphs:
            all_nodes.update(g.nodes)

        # 1. search 粗筛 — 拿候选节点 ID 集（v0.4.1: top_k=100 + BFS 1-hop 扩展）
        candidates = self._search_candidates(task_hint, store, graphs)

        # 2. 按 slot 分类候选节点
        slot_nodes = self._classify_by_slot(candidates, slots, graphs)

        # 3. 每个 slot 用 resolve(depth) 取子图（精筛 + facet 选取）
        slot_resolved: dict[str, list[str]] = {}
        for slot_name, slot_cfg in slots.items():
            nodes_in_slot = slot_nodes.get(slot_name, [])
            # 取前 max_nodes 个作为 BFS 起点
            seeds = nodes_in_slot[:slot_cfg.max_nodes]
            resolved_lines: list[str] = []
            seen_in_slot: set[str] = set()
            for seed_id in seeds:
                if seed_id in seen_in_slot:
                    continue
                try:
                    tir = resolve_tir(graphs, seed_id, depth=slot_cfg.depth,
                                      include_untyped=True, include_edges=False,
                                      max_nodes=slot_cfg.max_nodes, max_facets=3)
                    for line in tir.splitlines():
                        if line.strip():
                            resolved_lines.append(line)
                            # 提取节点 ID 用于去重
                            nid = self._extract_node_id(line)
                            if nid:
                                seen_in_slot.add(nid)
                except Exception:
                    # 节点不存在或 resolve 失败 — 跳过
                    continue
            slot_resolved[slot_name] = resolved_lines

        # 4. cross_dedup — 跨 slot 去重（双层去重）
        # v0.4.1: (node_id, facet_type, content) 三元组去重 — 同节点的不同 facet 都保留
        # v0.4.2 (P5/D34): 增加 content-based 跨源去重 —
        #   同 (facet_type, content) 但不同 node_id 的 facet 也合并（跨源同语义重复）。
        #   场景：memory 复述了 md 的 DEF 内容、tool schema description 复述了 md 的 DEF。
        #   这种跨源重复在多源 ingest 时常见，A/B/C 完全无去重能力，VT 独有价值。
        seen_facets: set[tuple] = set()           # 三元组去重（同节点同 facet）
        seen_content: dict[tuple, str] = {}       # (facet_type, content) → first_node_id（跨源去重）
        dedup_count = 0
        slot_dedup_lines: dict[str, list[str]] = {}
        for slot_name in sorted(slots.keys(), key=lambda s: slots[s].priority):
            lines_out = []
            for line in slot_resolved.get(slot_name, []):
                nid = self._extract_node_id(line)
                facet_key = self._facet_key(line, nid)
                # 三元组去重（同节点同 facet，跳过）
                if facet_key and facet_key in seen_facets:
                    dedup_count += 1
                    continue
                if facet_key:
                    seen_facets.add(facet_key)
                # v0.4.2 跨源 content 去重（同 type+content 不同 node_id，跳过）
                content_key = self._content_key(line, nid)
                if content_key and content_key in seen_content:
                    dedup_count += 1
                    continue
                if content_key:
                    seen_content[content_key] = nid or ""
                lines_out.append(line)
            slot_dedup_lines[slot_name] = lines_out

        # 5. v0.4.1 — 同 slot 内按节点 priority 二次排序（让 RULE 排到 DEF 之前）
        slot_sorted_lines: dict[str, list[str]] = {}
        for slot_name in slots:
            lines = slot_dedup_lines.get(slot_name, [])
            # 给每行打 priority score：从节点查 priority，找不到用 5（默认）
            def _line_priority(line: str) -> int:
                nid = self._extract_node_id(line)
                if not nid:
                    return 5
                node = all_nodes.get(nid)
                if node is None:
                    return 5
                return node.priority
            # 稳定排序：保留同 priority 内的原始顺序（resolve 输出顺序）
            indexed = list(enumerate(lines))
            indexed.sort(key=lambda x: (_line_priority(x[1]), x[0]))
            slot_sorted_lines[slot_name] = [line for _, line in indexed]

        # 6. budget_pack — 按 slot weight 装箱
        slot_budget: dict[str, int] = {}
        for slot_name, slot_cfg in slots.items():
            slot_budget[slot_name] = int(budget_tokens * slot_cfg.weight)
        used_tokens = 0
        slot_used: dict[str, dict] = {}
        slot_lines_final: dict[str, list[str]] = {}
        nodes_included: list[str] = []
        nodes_evicted: list[str] = []

        for slot_name in sorted(slots.keys(), key=lambda s: slots[s].priority):
            slot_cfg = slots[slot_name]
            slot_lines = slot_sorted_lines.get(slot_name, [])
            budget = slot_budget[slot_name]
            used = 0
            kept: list[str] = []
            for line in slot_lines:
                tok = self._tokenizer(line)
                if used + tok > budget:
                    # evict
                    nid = self._extract_node_id(line)
                    if nid and nid not in nodes_included:
                        nodes_evicted.append(nid)
                    continue
                used += tok
                kept.append(line)
                nid = self._extract_node_id(line)
                if nid:
                    nodes_included.append(nid)
            slot_used[slot_name] = {"tokens": used, "nodes": len(kept)}
            slot_lines_final[slot_name] = kept
            used_tokens += used

        # 7. order + render — slot priority 决定段落顺序
        # v0.4.2 (D33) — 三种 render_mode：
        #   - compact (默认): TYPE 单字符编码 + slot marker 内联到首 facet 行
        #   - dense:          无 TYPE 前缀、无 slot marker，纯内容按行输出
        #   - verbose:        v0.4 旧格式（## slot + [#id:TYPE] content）
        final_lines: list[str] = []
        for slot_name in sorted(slots.keys(), key=lambda s: slots[s].priority):
            lines = slot_lines_final.get(slot_name, [])
            if not lines:
                continue
            if render_mode == "verbose":
                # v0.4 旧格式：## slot + [#id:TYPE] content
                final_lines.append(f"## {slot_name}")
                final_lines.extend(lines)
                final_lines.append("")
            elif render_mode == "dense":
                # v0.4.2 极简格式：纯内容，无 TYPE、无 slot marker
                for line in lines:
                    content = self._dense_line(line)
                    if content:
                        final_lines.append(content)
            else:
                # v0.4.2 compact 格式：单字符 TYPE + slot marker 内联到首 facet 行
                # 例：`@S D|content1`  + `R|content2` 代替 `@S\nD|content1\nR|content2`
                slot_marker = f"@{slot_name[0].upper()}"  # @S / @T / @K / @W
                first = True
                for line in lines:
                    compact = self._compact_line(line)
                    if not compact:
                        continue
                    if first:
                        # 内联 slot marker 到首个 facet 行：`@S D|content`
                        final_lines.append(f"{slot_marker} {compact}")
                        first = False
                    else:
                        final_lines.append(compact)

        prompt = "\n".join(final_lines).rstrip()
        if prompt:
            prompt = prompt + "\n"
        actual_tokens = self._tokenizer(prompt)

        return AssembleResult(
            prompt=prompt,
            tokens_used=actual_tokens,
            tokens_budget=budget_tokens,
            slot_breakdown=slot_used,
            nodes_included=list(dict.fromkeys(nodes_included)),  # 去重保序
            nodes_evicted=list(dict.fromkeys(nodes_evicted)),
            dedup_count=dedup_count,
        )

    def _compact_line(self, line: str) -> str:
        """v0.4.2 (D33) — 把 TIR 行 `[#id:TYPE] content` 压缩为 `<T>|content`。

        TYPE 单字符编码表（节省每行 ~2-4 token）：
            DEF → D      RULE → R    DESC → E    EX → X
            VAR → V      META → M    OPEN → O    SCHEMA → S
            其他 → 原首字母

        节点 ID 已去除（ID 是审计信息，不是 LLM 需要的内容）。
        若需要 ID 用于追溯，使用 ``render_mode="verbose"`` 或查看 AssembleResult.nodes_included。
        """
        s = line.strip()
        if not s.startswith("[#"):
            return s  # 非标准 TIR 行原样返回
        end = s.find("]", 2)
        if end < 0:
            return s
        inner = s[2:end]
        content = s[end + 1:].strip()
        # inner 可能是 "id:TYPE" 或 "id" 或 "id:TYPE:more"
        parts = inner.split(":", 2)
        if len(parts) >= 2:
            ntype = parts[1]
            code = _TYPE_CODE.get(ntype, ntype[:1].upper() if ntype else "")
            return f"{code}|{content}" if content else code
        return content  # 无 type，直接返回 content

    def _dense_line(self, line: str) -> str:
        """v0.4.2 (D33) — 极简模式：去除所有元信息（TYPE/ID），只输出 content。

        适合 working context 极度紧张的场景（budget < 500）。
        损失：LLM 无法区分 DEF/RULE/DESC，但内容本身仍是 task-aware 排序后的最优序列。
        """
        s = line.strip()
        if not s.startswith("[#"):
            return s
        end = s.find("]", 2)
        if end < 0:
            return s
        return s[end + 1:].strip()

    # ------------------------------------------------------------------ 内部辅助

    def _collect_graphs(self, store) -> list:
        """收集 doc + mem 图列表（不调用 _maybe_reload，避免副作用）。"""
        graphs = []
        if getattr(store, "doc", None) is not None:
            graphs.append(store.doc)
        if getattr(store, "mem", None) is not None:
            graphs.append(store.mem.graph)
        return graphs

    def _search_candidates(self, task_hint: str, store, graphs: list) -> list[str]:
        """用 store.search() 粗筛候选节点 ID。

        v0.4.1 优化：
        - top_k 从 30 提高到 100（让大 budget 能装满）
        - 加入 BFS 1-hop 扩展：对每个 search 命中节点，把它的一跳邻居也加入候选
          （解决 TF-IDF 字面匹配在大场景下召回偏低的问题）
        - 空 task_hint 仍退化为 toc() 全局检索

        v0.4.3 (D35 P2 优化): 100 budget 召回不足的修复
        - task_hint 多 token 拆分查询：按空白拆分 task_hint，每个子查询跑一次 search，
          结果 union（让弱字面匹配也能命中，比如 task_hint="JWT 认证 安全规则" 拆成
          3 个子查询分别跑，比单次跑 "JWT 认证 安全规则" 召回更广）
        - BFS 2-hop 扩展：对 top-5 命中节点做 2-hop 扩展（邻居的邻居也加入），
          让大场景下"靠近任务相关节点但本身字面不匹配"的节点也能被召回
        """
        if not task_hint or not task_hint.strip():
            # 空 task_hint — 退化为 toc() 全局检索
            results = []
            if hasattr(store, "toc"):
                toc_str = store.toc()
                for line in toc_str.splitlines():
                    nid = self._extract_node_id(line)
                    if nid:
                        results.append(nid)
            return results
        if not graphs:
            return []

        # v0.4.3 (D35) — task_hint 多 token 拆分查询 + 原始查询 union
        seed_ids: list[str] = []
        seen_ids: set[str] = set()
        # 原始 task_hint 整体查一次
        try:
            results = store.search(task_hint, top_k=100)
            for r in results:
                if "id" in r and r["id"] not in seen_ids:
                    seen_ids.add(r["id"])
                    seed_ids.append(r["id"])
        except Exception:
            pass
        # 按 blank 拆分 task_hint，每个子查询单独跑（弱字面匹配补召回）
        # 拆分后只取 top_k=30（子查询更宽泛，避免结果太多稀释排序）
        sub_tokens = [t for t in task_hint.split() if len(t) >= 2]
        for sub_q in sub_tokens:
            try:
                sub_results = store.search(sub_q, top_k=30)
                for r in sub_results:
                    if "id" in r and r["id"] not in seen_ids:
                        seen_ids.add(r["id"])
                        seed_ids.append(r["id"])
            except Exception:
                continue

        # v0.4.1 — BFS 1-hop 扩展（所有 seed）
        expanded: list[str] = list(seed_ids)
        seen: set[str] = set(seed_ids)
        for g in graphs:
            for seed_id in seed_ids:
                # 出边邻居
                for e in g.out.get(seed_id, []):
                    if e.dst not in seen:
                        seen.add(e.dst)
                        expanded.append(e.dst)
                # 入边邻居
                for e in g.inn.get(seed_id, []):
                    if e.src not in seen:
                        seen.add(e.src)
                        expanded.append(e.src)

        # v0.4.3 (D35) — BFS 2-hop 扩展（仅对 top-5 seed，避免大场景过度扩展）
        # 让"靠近任务相关节点但本身字面不匹配"的节点也能被召回（解决 100 budget 召回不足）
        top_5_seeds = seed_ids[:5]
        second_hop: list[str] = []
        for g in graphs:
            for seed_id in top_5_seeds:
                # 1-hop 邻居
                one_hop: list[str] = []
                for e in g.out.get(seed_id, []):
                    if e.dst not in seen:
                        one_hop.append(e.dst)
                for e in g.inn.get(seed_id, []):
                    if e.src not in seen:
                        one_hop.append(e.src)
                # 对每个 1-hop 邻居再扩一跳
                for hop1 in one_hop:
                    if hop1 in seen:
                        continue
                    seen.add(hop1)
                    second_hop.append(hop1)
                    for e in g.out.get(hop1, []):
                        if e.dst not in seen:
                            seen.add(e.dst)
                            second_hop.append(e.dst)
                    for e in g.inn.get(hop1, []):
                        if e.src not in seen:
                            seen.add(e.src)
                            second_hop.append(e.src)
        expanded.extend(second_hop)
        return expanded

    def _classify_by_slot(self, candidate_ids: list[str],
                          slots: dict[str, SlotConfig],
                          graphs: list) -> dict[str, list[str]]:
        """按 slot 的 source 前缀分类候选节点。"""
        slot_nodes: dict[str, list[str]] = {name: [] for name in slots}
        # 同时按节点 slot 字段（如已设置）分类
        all_nodes: dict[str, VTNode] = {}
        for g in graphs:
            all_nodes.update(g.nodes)

        for cid in candidate_ids:
            node = all_nodes.get(cid)
            assigned = False
            # 优先用节点自身的 slot 字段
            if node and node.slot and node.slot in slots:
                slot_nodes[node.slot].append(cid)
                assigned = True
                continue
            # 否则按 ID 前缀匹配
            if not assigned:
                for slot_name, cfg in slots.items():
                    for prefix in cfg.sources:
                        if cid.startswith(prefix):
                            slot_nodes[slot_name].append(cid)
                            assigned = True
                            break
                    if assigned:
                        break
            # 兜底：未分类的节点放入 knowledge
            if not assigned and "knowledge" in slots:
                slot_nodes["knowledge"].append(cid)

        return slot_nodes

    def _extract_node_id(self, line: str) -> str | None:
        """从 TIR 行 `[#id:TYPE] content` 或 `[#id] content` 提取 id。"""
        s = line.strip()
        if not s.startswith("[#"):
            return None
        end = s.find("]", 2)
        if end < 0:
            return None
        inner = s[2:end]
        # 去掉 :TYPE 部分
        if ":" in inner:
            return inner.split(":", 1)[0]
        return inner

    def _facet_key(self, line: str, nid: str | None) -> tuple | None:
        """v0.4.1 — 提取 (node_id, facet_type, content) 三元组用于跨 slot 去重.

        同一节点的不同 facet（如 DEF + RULE + META）不应被去重；
        只有完全相同的 facet（同节点同类型同内容）跨 slot 出现才去重。
        """
        s = line.strip()
        if not s.startswith("[#"):
            return None
        end = s.find("]", 2)
        if end < 0:
            return None
        inner = s[2:end]
        content = s[end + 1:].strip()
        # inner 可能是 "id:TYPE" 或 "id"
        if ":" in inner:
            _, ftype = inner.split(":", 1)
        else:
            ftype = ""
        return (nid, ftype, content)

    def _content_key(self, line: str, nid: str | None) -> tuple | None:
        """v0.4.2 (D34) — 提取 (content,) 一元组用于跨源同语义去重.

        设计决策：只看 content，不看 facet_type。
        理由：对 LLM 来说，相同内容就是冗余，不管它是来自 DEF/RULE/EX/META。
        场景：memory 复述 md 的 DEF 内容时，memory 节点 type 是 EX，
        md 节点 type 是 DEF — 如果按 (ftype, content) 去重则无法合并跨源重复。
        真正跨源同语义重复（同 content 不同 node_id 不同 type）才是 VT 独有价值。

        与 _facet_key 的分工：
        - _facet_key: (node_id, ftype, content) 三元组 — 同节点同 facet 跨 slot 去重
        - _content_key: (content,) 一元组 — 跨源同内容去重（不看 node_id/type）
        """
        s = line.strip()
        if not s.startswith("[#"):
            return None
        end = s.find("]", 2)
        if end < 0:
            return None
        content = s[end + 1:].strip()
        if not content:
            return None
        return (content,)


# ---------------------------------------------------------------------------
# 简易 tokenizer（用于测试和默认场景）
# ---------------------------------------------------------------------------

def simple_token_counter(text: str) -> int:
    """简易 token 计数：4 字符 ≈ 1 token。"""
    if not text:
        return 0
    return max(1, len(text) // 4)


# ---------------------------------------------------------------------------
# Task I — priority 自动推断规则（可覆盖）
# ---------------------------------------------------------------------------

# 规则表（数值越小越优先）：
#   tag="blocker"            → 1   （最高，永远优先装箱）
#   RULE 类型                → 2
#   DEF 类型                 → 4
#   mem 节点（#tag，无 blocker）→ 5
#   DESC / EX 类型           → 6
#   tag="note"              → 8   （最低优先级）
#   其他 / 默认             → 5

def infer_priority(node_type: str | None = None, tags: list[str] | None = None,
                   content: str | None = None) -> int:
    """按节点类型 + tag + content 语义推断 priority 数值（越小越优先）。

    v0.4.3 (D35 P1 优化): 在 v0.4.2 的 type+tag 二维基础上新增 content 语义维度，
    解决"同 type+tag 的节点退化成 declaration order"导致 hp_top25 卡在 0.7 的问题。

    参数：
        node_type : VTNode.parts 中的类型字符串（DEF/RULE/DESC/EX/VAR/OPEN/...）
        tags     : 节点的 tag 列表（如 ["blocker"] / ["pref"]）；空或 None 视为无 tag
        content  : 节点内容（用于语义关键词细分，可选）

    返回：
        priority 整数（1-10）

    覆盖优先级（高到低）：
        1. tag="blocker" + content 含安全词 → 1   （任务阻塞 + 安全，最高优先）
        1. tag="blocker" 普通              → 1   （任务阻塞项，永远最优先）
        2. tag="security"                   → 2   （明确 security tag）
        3. RULE + content 含强安全词         → 2   （含"必须"/"禁止"/"验证"/"权限"等强约束）
        4. RULE 普通                        → 3   （普通业务规则）
        5. node_type=DEF                    → 4
        6. node_type=DESC/EX                → 6
        7. tag="note" + content 含待定词     → 9   （待确认/待定，最低）
        8. tag="note" 普通                  → 8
        9. 其他                              → 5

    强安全关键词（让 RULE 升级到 2）：
        必须 / 禁止 / 验证 / 权限 / 安全 / 禁止 / 严禁 / 永远 / 立即 / 关键 / 核心
        must / forbidden / verify / permission / security / critical / required

    待定关键词（让 note 降到 9）：
        待确认 / 待定 / 待评估 / 暂定 / 可能 / 建议 / TODO / TBD
    """
    # tag 优先级（最高覆盖）
    if tags:
        tag_lower = [t.lower() for t in tags]
        if "blocker" in tag_lower:
            return 1
        if "security" in tag_lower:
            return 2
        if "note" in tag_lower:
            # v0.4.3: note 内含待定词再降一级
            if content and _has_pending_keyword(content):
                return 9
            return 8

    # RULE 按 content 语义细分
    if node_type == "RULE":
        if content and _has_strong_security_keyword(content):
            return 2  # 强安全规则
        return 3      # 普通业务规则

    if node_type == "DEF":
        return 4
    if node_type in ("DESC", "EX"):
        return 6
    return 5


# v0.4.3 (D35) — 强安全关键词 + 待定关键词
_STRONG_SECURITY_KEYWORDS = (
    # 中文
    "必须", "禁止", "严禁", "验证", "权限", "安全", "永远", "立即",
    "关键", "核心", "强制", "不得", "不可",
    # 英文
    "must", "forbidden", "verify", "permission", "security",
    "critical", "required", "mandatory", "never",
)

_PENDING_KEYWORDS = (
    # 中文
    "待确认", "待定", "待评估", "暂定", "可能", "建议",
    "TODO", "TBD", "待讨论", "未定",
)


def _has_strong_security_keyword(content: str) -> bool:
    """v0.4.3 (D35) — 检测 content 是否含强安全约束关键词."""
    if not content:
        return False
    content_lower = content.lower()
    for kw in _STRONG_SECURITY_KEYWORDS:
        if kw in content or kw in content_lower:
            return True
    return False


def _has_pending_keyword(content: str) -> bool:
    """v0.4.3 (D35) — 检测 content 是否含待定/未决关键词."""
    if not content:
        return False
    for kw in _PENDING_KEYWORDS:
        if kw in content:
            return True
    return False
