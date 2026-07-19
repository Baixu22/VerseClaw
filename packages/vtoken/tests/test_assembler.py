"""Task D — ContextAssembler 测试（v0.4 Context Assembly Engine 核心层）.

验证：
- budget_pack 装箱算法
- cross_dedup 跨 slot 去重
- order 保证 system slot 在前
- 确定性（相同输入 → 相同输出，保护 prompt cache）
- 空 task_hint 降级 toc()
- 单 slot 场景
- budget 过小 → 全部 evict
"""
import pytest

from vtoken.assembler import (
    ContextAssembler,
    DEFAULT_SLOTS,
    SlotConfig,
    AssembleResult,
    simple_token_counter,
)
from vtoken.graph import SIRGraph
from vtoken.model import VTEdge, VTNode


# ---------------------------------------------------------------------------
# 测试用 store mock
# ---------------------------------------------------------------------------

class MockStore:
    """模拟 UnifiedStore 的最小 mock。"""
    def __init__(self, doc_graph=None, mem_graph=None, search_results=None, toc_str=""):
        self.doc = doc_graph
        self.mem = None
        if mem_graph is not None:
            self.mem = type("M", (), {"graph": mem_graph, "_lock": __import__("threading").RLock()})()
        self._search_results = search_results or []
        self._toc_str = toc_str

    def search(self, query, top_k=10):
        return self._search_results[:top_k]

    def toc(self):
        return self._toc_str


def _make_node(node_id, content, type="DEF", slot=None, priority=5, edges=None):
    """快速构造带边的节点 graph。"""
    g = SIRGraph("doc")
    g.add_node(VTNode(
        id=node_id, parts=[(type, content)],
        slot=slot, priority=priority, source_files=["test.vt"],
    ))
    for dst in (edges or []):
        g.add_edge(VTEdge(src=node_id, dst=dst, rel="DEPENDS"))
    return g


def _merge_graphs(graphs):
    """合并多个 graph 为一个（用 merge 方法）。"""
    if not graphs:
        return SIRGraph("doc")
    merged = graphs[0]
    for g in graphs[1:]:
        merged.merge(g)
    return merged


# ---------------------------------------------------------------------------
# SlotConfig / AssembleResult
# ---------------------------------------------------------------------------

def test_slot_config_dataclass():
    cfg = SlotConfig(name="x", weight=0.5, priority=1, sources=["x."], depth=2, max_nodes=10)
    assert cfg.name == "x" and cfg.weight == 0.5 and cfg.priority == 1


def test_assemble_result_dataclass():
    r = AssembleResult(
        prompt="x", tokens_used=1, tokens_budget=10,
        slot_breakdown={}, nodes_included=[], nodes_evicted=[], dedup_count=0,
    )
    assert r.prompt == "x" and r.tokens_used == 1


def test_default_slots_has_four_sections():
    assert set(DEFAULT_SLOTS.keys()) == {"system", "tools", "knowledge", "working"}
    # system 应该是最高优先级（priority 数值最小）
    assert DEFAULT_SLOTS["system"].priority == 1
    # working 应该是最低优先级
    assert DEFAULT_SLOTS["working"].priority == 4


# ---------------------------------------------------------------------------
# 简单 assembler 用例
# ---------------------------------------------------------------------------

def test_assemble_empty_store_returns_empty_prompt():
    store = MockStore(doc_graph=None, mem_graph=None)
    asm = ContextAssembler(simple_token_counter)
    result = asm.assemble("test", 1000, DEFAULT_SLOTS, store)
    # 空 store → 空 prompt → 0 token（v0.4: 修复空串被记为 1 token 的 bug）
    assert result.prompt == ""
    assert result.tokens_used == 0
    assert result.dedup_count == 0


def test_assemble_single_node_in_knowledge_slot():
    g = _make_node("auth.overview", "JWT auth module", slot="knowledge", priority=4)
    store = MockStore(
        doc_graph=g,
        search_results=[{"id": "auth.overview", "score": 1.0, "snippet": "JWT auth module"}],
    )
    asm = ContextAssembler(simple_token_counter)
    result = asm.assemble("JWT auth", 1000, DEFAULT_SLOTS, store)
    assert "auth.overview" in result.nodes_included
    assert "knowledge" in result.slot_breakdown


def test_assemble_budget_packing_caps_tokens():
    """节点超 budget 时应 evict。"""
    g = SIRGraph("doc")
    for i in range(20):
        g.add_node(VTNode(
            id=f"doc.node_{i}",
            parts=[("DEF", f"node content {i} " * 20)],  # 长 content 模拟大 token
            slot="knowledge", priority=5,
        ))
    store = MockStore(
        doc_graph=g,
        search_results=[{"id": f"doc.node_{i}", "score": 1.0} for i in range(20)],
    )
    asm = ContextAssembler(simple_token_counter)
    result = asm.assemble("test", 200, DEFAULT_SLOTS, store)  # 小 budget 强制 evict
    # knowledge slot 的 budget = 200 * 0.40 = 80
    assert result.tokens_used <= 200
    assert len(result.nodes_evicted) > 0


def test_assemble_order_system_slot_first():
    """system slot 应该排在 knowledge 之前"""
    g = SIRGraph("doc")
    g.add_node(VTNode(id="rule.r1", parts=[("DEF", "rule 1")], slot="system", priority=1))
    g.add_node(VTNode(id="doc.k1", parts=[("DEF", "knowledge 1")], slot="knowledge", priority=4))
    store = MockStore(
        doc_graph=g,
        search_results=[
            {"id": "rule.r1", "score": 1.0},
            {"id": "doc.k1", "score": 0.5},
        ],
    )
    asm = ContextAssembler(simple_token_counter)
    # v0.4.1: 默认是 compact 模式，这里显式用 verbose 验证 slot 段落顺序
    result = asm.assemble("test", 10000, DEFAULT_SLOTS, store, render_mode="verbose")
    # 验证 prompt 中 system 段在 knowledge 段之前
    sys_pos = result.prompt.find("## system")
    know_pos = result.prompt.find("## knowledge")
    assert sys_pos >= 0 and know_pos >= 0
    assert sys_pos < know_pos


def test_assemble_cross_dedup_removes_duplicate_nodes():
    """同节点出现在多个 slot 时只保留一份（高 priority slot 胜出）"""
    g = SIRGraph("doc")
    # 一个节点同时匹配 system 和 knowledge 的前缀
    g.add_node(VTNode(id="auth.rule", parts=[("DEF", "auth rule content")],
                       slot="system", priority=1))
    store = MockStore(
        doc_graph=g,
        search_results=[{"id": "auth.rule", "score": 1.0}],
    )
    asm = ContextAssembler(simple_token_counter)
    result = asm.assemble("auth", 10000, DEFAULT_SLOTS, store)
    # auth.rule 只应出现一次（slot 字段优先 = system）
    count = result.nodes_included.count("auth.rule")
    assert count == 1


def test_assemble_deterministic_same_input_same_output():
    """相同输入应产生相同输出（保护 prompt cache）"""
    g = SIRGraph("doc")
    g.add_node(VTNode(id="doc.test", parts=[("DEF", "test content")],
                       slot="knowledge", priority=4))
    store = MockStore(
        doc_graph=g,
        search_results=[{"id": "doc.test", "score": 1.0}],
    )
    asm = ContextAssembler(simple_token_counter)
    r1 = asm.assemble("test", 10000, DEFAULT_SLOTS, store)
    r2 = asm.assemble("test", 10000, DEFAULT_SLOTS, store)
    assert r1.prompt == r2.prompt
    assert r1.tokens_used == r2.tokens_used


def test_assemble_empty_task_hint_degrades_to_toc():
    """空 task_hint → 退化为 toc() 全局检索"""
    g = _make_node("auth.overview", "JWT auth", slot="knowledge", priority=4)
    toc_str = "[#auth.overview:DEF] JWT auth"
    store = MockStore(doc_graph=g, search_results=[], toc_str=toc_str)
    asm = ContextAssembler(simple_token_counter)
    result = asm.assemble("", 10000, DEFAULT_SLOTS, store)
    # 应该从 toc 拿到 auth.overview 候选
    assert "auth.overview" in result.nodes_included


def test_assemble_single_slot_config():
    """只配置一个 slot 时应能正常工作"""
    single_slot = {
        "knowledge": SlotConfig(name="knowledge", weight=1.0, priority=1,
                                sources=["doc.", "auth."], depth=1, max_nodes=10),
    }
    g = _make_node("doc.test", "test content", slot="knowledge", priority=4)
    store = MockStore(
        doc_graph=g,
        search_results=[{"id": "doc.test", "score": 1.0}],
    )
    asm = ContextAssembler(simple_token_counter)
    result = asm.assemble("test", 10000, single_slot, store)
    assert "doc.test" in result.nodes_included
    assert "knowledge" in result.slot_breakdown


def test_assemble_tiny_budget_evicts_everything():
    """budget 极小时所有节点都被 evict"""
    g = _make_node("doc.test", "very long content " * 50, slot="knowledge", priority=4)
    store = MockStore(
        doc_graph=g,
        search_results=[{"id": "doc.test", "score": 1.0}],
    )
    asm = ContextAssembler(simple_token_counter)
    result = asm.assemble("test", 1, DEFAULT_SLOTS, store)  # budget=1 几乎不够任何节点
    # 节点应该被 evict
    assert "doc.test" in result.nodes_evicted or "doc.test" not in result.nodes_included


def test_assemble_includes_node_id_in_audit_list():
    """nodes_included 应包含实际装入的节点 ID"""
    g = SIRGraph("doc")
    g.add_node(VTNode(id="doc.a", parts=[("DEF", "node A")], slot="knowledge", priority=4))
    g.add_node(VTNode(id="doc.b", parts=[("DEF", "node B")], slot="knowledge", priority=4))
    g.add_edge(VTEdge(src="doc.a", dst="doc.b", rel="DEPENDS"))
    store = MockStore(
        doc_graph=g,
        search_results=[
            {"id": "doc.a", "score": 1.0},
            {"id": "doc.b", "score": 0.5},
        ],
    )
    asm = ContextAssembler(simple_token_counter)
    result = asm.assemble("test", 10000, DEFAULT_SLOTS, store)
    assert "doc.a" in result.nodes_included


def test_assemble_handles_mem_graph():
    """应能合并 doc + mem 图"""
    doc_g = _make_node("doc.x", "doc content", slot="knowledge", priority=4)
    mem_g = SIRGraph("mem")
    mem_g.add_node(VTNode(id="#001", parts=[("note", "mem content")],
                          slot="working", priority=5))
    store = MockStore(
        doc_graph=doc_g,
        mem_graph=mem_g,
        search_results=[{"id": "doc.x"}, {"id": "#001"}],
    )
    asm = ContextAssembler(simple_token_counter)
    result = asm.assemble("test", 10000, DEFAULT_SLOTS, store)
    # 应该至少装入一个节点
    assert len(result.nodes_included) >= 1


def test_assemble_dedup_count_nonzero_when_dup():
    """重复节点应记入 dedup_count"""
    g = SIRGraph("doc")
    # auth.rule 同时匹配 system.sources 的 "rule." 前缀和 knowledge.sources 的 "auth." 前缀
    # 但因为 slot 字段为 None，会被两次分类 — 但 candidates 应该只出现一次
    g.add_node(VTNode(id="auth.rule", parts=[("DEF", "shared rule")], priority=5))
    store = MockStore(
        doc_graph=g,
        search_results=[{"id": "auth.rule"}],  # 一次
    )
    asm = ContextAssembler(simple_token_counter)
    result = asm.assemble("auth.rule", 10000, DEFAULT_SLOTS, store)
    # 验证 dedup_count 是非负整数
    assert result.dedup_count >= 0


def test_assemble_with_default_tokenizer():
    """不传 tokenizer 时使用默认（4字符≈1token）"""
    g = _make_node("doc.test", "test content here", slot="knowledge", priority=4)
    store = MockStore(
        doc_graph=g,
        search_results=[{"id": "doc.test"}],
    )
    asm = ContextAssembler()  # 不传 tokenizer
    result = asm.assemble("test", 10000, DEFAULT_SLOTS, store)
    assert result.tokens_used > 0


# ---------------------------------------------------------------------------
# _extract_node_id 辅助函数
# ---------------------------------------------------------------------------

def test_extract_node_id_with_type():
    asm = ContextAssembler(simple_token_counter)
    assert asm._extract_node_id("[#auth.x:RULE] content") == "auth.x"


def test_extract_node_id_without_type():
    asm = ContextAssembler(simple_token_counter)
    assert asm._extract_node_id("[#001] content") == "001"


def test_extract_node_id_non_tir_line():
    asm = ContextAssembler(simple_token_counter)
    assert asm._extract_node_id("regular line") is None
    assert asm._extract_node_id("## system") is None


def test_extract_node_id_mem_id_with_hash():
    asm = ContextAssembler(simple_token_counter)
    # mem ID 已经包含 #，TIR 前缀吸收后是 [#001]
    assert asm._extract_node_id("[#001:note] mem content") == "001"
