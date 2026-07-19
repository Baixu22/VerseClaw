"""Task A — SIRGraph.merge() 测试（v0.4 Context Assembly Engine）.

验证：
- 同 ID 双源合并：priority 覆盖规则（数值小者胜）
- 边去重：同 src-rel-dst 三元组
- source_files 追加
- 不冲突节点 / 不冲突边直接加入
- in-place 返回 self
"""
import pytest

from vtoken.graph import SIRGraph
from vtoken.model import VTEdge, VTNode


def _make_graph(nodes=None, edges=None, mode="doc"):
    g = SIRGraph(mode)
    for n in nodes or []:
        g.add_node(n)
    for e in edges or []:
        g.add_edge(e)
    return g


# ---------------------------------------------------------------------------
# 节点合并
# ---------------------------------------------------------------------------

def test_merge_disjoint_nodes_both_kept():
    g1 = _make_graph([VTNode(id="a.x", parts=[("DEF", "node X")])])
    g2 = _make_graph([VTNode(id="a.y", parts=[("DEF", "node Y")])])
    g1.merge(g2)
    assert set(g1.nodes.keys()) == {"a.x", "a.y"}


def test_merge_same_id_lower_priority_number_wins():
    # priority 数值越小越优先
    n1 = VTNode(id="a.x", parts=[("DEF", "from g1")], priority=5)
    n2 = VTNode(id="a.x", parts=[("DEF", "from g2")], priority=2)  # g2 优先
    g1 = _make_graph([n1])
    g2 = _make_graph([n2])
    g1.merge(g2)
    assert g1.nodes["a.x"].parts == [("DEF", "from g2")]
    assert g1.nodes["a.x"].priority == 2


def test_merge_same_id_equal_priority_self_kept():
    """同 priority 时 self（先到先得）保留 — parts 不被覆盖"""
    n1 = VTNode(id="a.x", parts=[("DEF", "from g1")], priority=5)
    n2 = VTNode(id="a.x", parts=[("DEF", "from g2")], priority=5)
    g1 = _make_graph([n1])
    g2 = _make_graph([n2])
    g1.merge(g2)
    assert g1.nodes["a.x"].parts == [("DEF", "from g1")]
    assert g1.nodes["a.x"].priority == 5


def test_merge_same_id_higher_priority_number_loses():
    """other priority 数值大于 self → other 输，self 保留"""
    n1 = VTNode(id="a.x", parts=[("DEF", "from g1")], priority=2)
    n2 = VTNode(id="a.x", parts=[("DEF", "from g2")], priority=8)
    g1 = _make_graph([n1])
    g2 = _make_graph([n2])
    g1.merge(g2)
    assert g1.nodes["a.x"].parts == [("DEF", "from g1")]
    assert g1.nodes["a.x"].priority == 2


# ---------------------------------------------------------------------------
# source_files 追加
# ---------------------------------------------------------------------------

def test_merge_source_files_accumulated_on_winner():
    n1 = VTNode(id="a.x", parts=[("DEF", "x")], priority=5, source_files=["g1.vt"])
    n2 = VTNode(id="a.x", parts=[("DEF", "x new")], priority=2, source_files=["g2.vt"])
    g1 = _make_graph([n1])
    g2 = _make_graph([n2])
    g1.merge(g2)
    # other 胜出，但 source_files 双方都合并
    assert set(g1.nodes["a.x"].source_files) == {"g1.vt", "g2.vt"}


def test_merge_source_files_accumulated_when_self_wins():
    n1 = VTNode(id="a.x", parts=[("DEF", "x")], priority=2, source_files=["g1.vt"])
    n2 = VTNode(id="a.x", parts=[("DEF", "x new")], priority=5, source_files=["g2.vt"])
    g1 = _make_graph([n1])
    g2 = _make_graph([n2])
    g1.merge(g2)
    # self 胜出，但 source_files 仍累积
    assert set(g1.nodes["a.x"].source_files) == {"g1.vt", "g2.vt"}


def test_merge_source_file_field_also_appended_to_source_files():
    """source_file（单值字段）也合并到 source_files 列表"""
    n1 = VTNode(id="a.x", parts=[("DEF", "x")], priority=5, source_file="g1.vt")
    n2 = VTNode(id="a.x", parts=[("DEF", "x new")], priority=2, source_file="g2.vt")
    g1 = _make_graph([n1])
    g2 = _make_graph([n2])
    g1.merge(g2)
    assert set(g1.nodes["a.x"].source_files) == {"g1.vt", "g2.vt"}


# ---------------------------------------------------------------------------
# 边合并
# ---------------------------------------------------------------------------

def test_merge_disjoint_edges_both_kept():
    g1 = _make_graph(
        [VTNode(id="a.x", parts=[("DEF", "x")]), VTNode(id="a.y", parts=[("DEF", "y")])],
        [VTEdge(src="a.x", dst="a.y", rel="DEPENDS")],
    )
    g2 = _make_graph(
        [VTNode(id="a.z", parts=[("DEF", "z")])],
        [VTEdge(src="a.x", dst="a.z", rel="DEPENDS")],
    )
    g1.merge(g2)
    out_edges = [e for edges in g1.out.values() for e in edges]
    assert len(out_edges) == 2


def test_merge_duplicate_edge_deduped():
    """同 src-rel-dst 三元组去重"""
    g1 = _make_graph(
        [VTNode(id="a.x", parts=[("DEF", "x")]), VTNode(id="a.y", parts=[("DEF", "y")])],
        [VTEdge(src="a.x", dst="a.y", rel="DEPENDS")],
    )
    g2 = _make_graph(
        [VTNode(id="a.x", parts=[("DEF", "x")]), VTNode(id="a.y", parts=[("DEF", "y")])],
        [VTEdge(src="a.x", dst="a.y", rel="DEPENDS")],  # 完全相同的边
    )
    g1.merge(g2)
    out_edges = [e for edges in g1.out.values() for e in edges]
    assert len(out_edges) == 1


def test_merge_untyped_edge_dedup_uses_src_dst_only():
    """untyped 边（rel=None）按 (src, None, dst) 去重"""
    g1 = _make_graph(
        [VTNode(id="a.x", parts=[("DEF", "x")]), VTNode(id="a.y", parts=[("DEF", "y")])],
        [VTEdge(src="a.x", dst="a.y", rel=None)],
    )
    g2 = _make_graph(
        [VTNode(id="a.x", parts=[("DEF", "x")]), VTNode(id="a.y", parts=[("DEF", "y")])],
        [VTEdge(src="a.x", dst="a.y", rel=None)],
    )
    g1.merge(g2)
    out_edges = [e for edges in g1.out.values() for e in edges]
    assert len(out_edges) == 1


def test_merge_same_src_dst_different_rel_both_kept():
    """同 src-dst 但不同 rel → 视为两条不同边"""
    g1 = _make_graph(
        [VTNode(id="a.x", parts=[("DEF", "x")]), VTNode(id="a.y", parts=[("DEF", "y")])],
        [VTEdge(src="a.x", dst="a.y", rel="DEPENDS")],
    )
    g2 = _make_graph(
        [VTNode(id="a.x", parts=[("DEF", "x")]), VTNode(id="a.y", parts=[("DEF", "y")])],
        [VTEdge(src="a.x", dst="a.y", rel="BLOCKS")],
    )
    g1.merge(g2)
    out_edges = [e for edges in g1.out.values() for e in edges]
    assert len(out_edges) == 2


# ---------------------------------------------------------------------------
# in-place + version 递增
# ---------------------------------------------------------------------------

def test_merge_returns_self_in_place():
    g1 = _make_graph([VTNode(id="a.x", parts=[("DEF", "x")])])
    g2 = _make_graph([VTNode(id="a.y", parts=[("DEF", "y")])])
    result = g1.merge(g2)
    assert result is g1
    assert "a.y" in g1.nodes


def test_merge_increments_version():
    g1 = _make_graph([VTNode(id="a.x", parts=[("DEF", "x")])])
    g2 = _make_graph([VTNode(id="a.y", parts=[("DEF", "y")])])
    v_before = g1.version
    g1.merge(g2)
    assert g1.version > v_before


# ---------------------------------------------------------------------------
# slot / priority 字段透传
# ---------------------------------------------------------------------------

def test_merge_preserves_slot_and_priority_on_new_nodes():
    n = VTNode(id="a.x", parts=[("DEF", "x")], slot="system", priority=2)
    g1 = _make_graph()
    g2 = _make_graph([n])
    g1.merge(g2)
    assert g1.nodes["a.x"].slot == "system"
    assert g1.nodes["a.x"].priority == 2


def test_merge_three_way_priority_winner():
    """三方合并：priority 最低者胜出"""
    n1 = VTNode(id="a.x", parts=[("DEF", "v1")], priority=5)
    n2 = VTNode(id="a.x", parts=[("DEF", "v2")], priority=3)
    n3 = VTNode(id="a.x", parts=[("DEF", "v3")], priority=1)
    g1 = _make_graph([n1])
    g1.merge(_make_graph([n2]))
    g1.merge(_make_graph([n3]))
    assert g1.nodes["a.x"].parts == [("DEF", "v3")]
    assert g1.nodes["a.x"].priority == 1


def test_merge_does_not_mutate_source_graph_nodes():
    """合并后源图的节点不应被污染（深拷贝 parts）"""
    n_src = VTNode(id="a.x", parts=[("DEF", "original")], priority=5)
    g_src = _make_graph([n_src])
    g_dst = _make_graph([VTNode(id="a.x", parts=[("DEF", "winner")], priority=2)])
    g_dst.merge(g_src)
    # 源图节点的 parts 不应被改变
    assert n_src.parts == [("DEF", "original")]
