"""P1.3/P1.4 acceptance — resolve semantics + TIR format (spec §12 查询原语/TIR 格式)."""
import os

import pytest
from conftest import NET, SPEC_AUTH

from vtoken import SIRGraph, VTResolveError, VTEdge, VTNode, compile_file, load_vtg, resolve_tir


@pytest.fixture
def net_graph(write_vt):
    vt = write_vt("net.vt", NET)
    out, _ = compile_file(vt)
    return load_vtg(out)


def test_depth_0_returns_only_the_node_itself(net_graph):
    tir = resolve_tir([net_graph], "a.one", depth=0)
    assert tir == "[#a.one:DEF] node one\n[#a.one:DESC] extra facet"


def test_depth_1_returns_direct_neighbors_bidirectional(net_graph):
    tir = resolve_tir([net_graph], "a.one", depth=1)
    # deterministic order: root, out-edges (a.two, a.four; ghost skipped), in-edges (a.five)
    assert tir == (
        "[#a.one:DEF] node one\n"
        "[#a.one:DESC] extra facet\n"
        "[#a.two:RULE] rule two\n"
        "[#a.four:DEF] node four\n"
        "[#a.five:DEF] node five"
    )
    # D9: in-edge direction — resolving the TARGET of ENFORCED-BY finds the rule
    tir_rev = resolve_tir([net_graph], "a.three", depth=1)
    assert "[#a.two:RULE] rule two" in tir_rev


def test_depth_2_reaches_second_hop(net_graph):
    tir = resolve_tir([net_graph], "a.one", depth=2)
    assert "[#a.three:DEF] node three" in tir
    # each node appears exactly once
    assert tir.count("[#a.three:") == 1


def test_type_filter_output_only_root_exempt(net_graph):
    tir = resolve_tir([net_graph], "a.one", depth=2, type_filter=["RULE"])
    lines = tir.splitlines()
    assert lines == ["[#a.one:DEF] node one",
                     "[#a.one:DESC] extra facet",
                     "[#a.two:RULE] rule two"]


def test_include_untyped_false_skips_tilde_edges(net_graph):
    tir = resolve_tir([net_graph], "a.one", depth=1, include_untyped=False)
    assert "a.four" not in tir
    assert "a.two" in tir and "a.five" in tir


def test_dangling_target_skipped_silently(net_graph):
    tir = resolve_tir([net_graph], "a.one", depth=3)
    assert "ghost" not in tir


def test_determinism_same_state_same_result(net_graph):
    a = resolve_tir([net_graph], "a.one", depth=2)
    b = resolve_tir([net_graph], "a.one", depth=2)
    assert a == b


def test_unknown_root_raises(net_graph):
    with pytest.raises(VTResolveError):
        resolve_tir([net_graph], "a.nope", depth=1)


def test_resolve_does_no_disk_io(write_vt):
    """Delete the .vtg after loading: resolve must keep working (pure memory)."""
    vt = write_vt("net.vt", NET)
    out, _ = compile_file(vt)
    g = load_vtg(out)
    os.remove(out)
    tir = resolve_tir([g], "a.one", depth=2)
    assert "[#a.two:RULE] rule two" in tir


def test_tir_contains_no_vt_syntax_and_no_comments(write_vt):
    vt = write_vt("auth.vt", SPEC_AUTH)
    out, _ = compile_file(vt)
    g = load_vtg(out)
    tir = resolve_tir([g], "auth.overview", depth=3)
    for line in tir.splitlines():
        # every line is a TIR atom, never raw .vt syntax
        assert line.startswith("[#"), line
        for kw in ("DEF ", "RULE ", "REF ", "DESC ", "-->"):
            assert not line.startswith(kw)
    assert "审查注释" not in tir and "//" not in tir


def test_spec_tir_format_example(write_vt):
    vt = write_vt("auth.vt", SPEC_AUTH)
    out, _ = compile_file(vt)
    g = load_vtg(out)
    tir = resolve_tir([g], "auth.sec_1", depth=0)
    assert tir == "[#auth.sec_1:RULE] token 有效期不得超过 24h"


def test_include_edges_optin(net_graph):
    tir = resolve_tir([net_graph], "a.one", depth=1, include_edges=True)
    assert "[#a.one] --DEPENDS--> [#a.two]" in tir
    assert "[#a.one] ~~ [#a.four]" in tir
    # default stays spec-faithful: no edge lines
    assert "-->" not in resolve_tir([net_graph], "a.one", depth=1)


# ---------------------------------------------------------------------------
# T0.4 — resolve() output budget via max_nodes (root always retained)
# ---------------------------------------------------------------------------

def _star_graph(num_leaves: int = 19) -> SIRGraph:
    """Hub-and-spoke graph: one center + N leaves, all untyped edges."""
    g = SIRGraph("doc")
    g.add_node(VTNode(id="center", parts=[("DEF", "center")]))
    for i in range(1, num_leaves + 1):
        nid = f"n{i:02d}"
        g.add_node(VTNode(id=nid, parts=[("DEF", f"leaf {i}")]))
        g.add_edge(VTEdge(src="center", dst=nid, rel=None))
    return g


def _tir_ids(tir: str) -> list:
    """Extract node ids from TIR lines, stripping ``[#`` and the ``:TYPE`` suffix."""
    ids = []
    for line in tir.splitlines():
        head = line.split("]", 1)[0].lstrip("[#")
        ids.append(head.split(":", 1)[0])
    return ids


def test_max_nodes_caps_output_deterministically():
    g = _star_graph(19)  # 20 nodes total
    tir1 = resolve_tir([g], "center", depth=1, max_nodes=5)
    tir2 = resolve_tir([g], "center", depth=1, max_nodes=5)
    ids = set(_tir_ids(tir1))
    assert len(ids) == 5
    assert "center" in ids
    # Determinism: same args + same state -> identical TIR
    assert tir1 == tir2


def test_max_nodes_root_always_retained():
    g = _star_graph(5)
    tir = resolve_tir([g], "center", depth=1, max_nodes=1)
    lines = tir.splitlines()
    # Only the root survives (its single DEF part)
    assert len(lines) == 1
    assert lines[0] == "[#center:DEF] center"


def test_max_nodes_none_means_no_cap():
    g = _star_graph(19)
    tir = resolve_tir([g], "center", depth=1, max_nodes=None)
    ids = set(_tir_ids(tir))
    assert len(ids) == 20  # all nodes returned


def test_max_nodes_rejects_zero():
    g = _star_graph(1)
    with pytest.raises(ValueError):
        resolve_tir([g], "center", depth=1, max_nodes=0)


def test_max_nodes_takes_first_neighbors_in_declaration_order():
    """When the cap hits mid-layer, declaration order picks who survives."""
    g = _star_graph(19)
    tir = resolve_tir([g], "center", depth=1, max_nodes=5)
    ids = _tir_ids(tir)
    # root first, then the first 4 leaves in declaration order
    assert ids == ["center", "n01", "n02", "n03", "n04"]


# ---------------------------------------------------------------------------
# T2 / D27 — resolve() per-node facet cap via max_facets
# ---------------------------------------------------------------------------

def _facet_graph() -> SIRGraph:
    """One node with several facets: DEF + DESC + EX + META + SRC."""
    g = SIRGraph("doc")
    g.add_node(VTNode(id="hub", parts=[
        ("DEF", "hub definition"),
        ("DESC", "first desc"),
        ("EX", "example payload"),
        ("META", "meta info"),
        ("SRC", "src url"),
    ]))
    return g


def test_max_facets_none_emits_all_parts():
    g = _facet_graph()
    tir = resolve_tir([g], "hub", depth=0, max_facets=None)
    lines = tir.splitlines()
    assert len(lines) == 5  # all facets emitted


def test_max_facets_one_keeps_only_def():
    g = _facet_graph()
    tir = resolve_tir([g], "hub", depth=0, max_facets=1)
    lines = tir.splitlines()
    assert lines == ["[#hub:DEF] hub definition"]


def test_max_facets_keeps_def_plus_first_n_others_in_declaration_order():
    g = _facet_graph()
    tir = resolve_tir([g], "hub", depth=0, max_facets=3)
    lines = tir.splitlines()
    # DEF survives + first 2 others (DESC, EX) in declaration order
    assert lines == [
        "[#hub:DEF] hub definition",
        "[#hub:DESC] first desc",
        "[#hub:EX] example payload",
    ]


def test_max_facets_no_def_falls_back_to_declaration_order():
    """If no DEF facet exists, max_facets takes the first N parts as-is."""
    g = SIRGraph("doc")
    g.add_node(VTNode(id="leaf", parts=[
        ("DESC", "d1"), ("EX", "e1"), ("META", "m1"),
    ]))
    tir = resolve_tir([g], "leaf", depth=0, max_facets=2)
    lines = tir.splitlines()
    assert lines == ["[#leaf:DESC] d1", "[#leaf:EX] e1"]


def test_max_facets_below_one_raises():
    g = _facet_graph()
    with pytest.raises(ValueError):
        resolve_tir([g], "hub", depth=0, max_facets=0)


def test_max_facets_does_not_drop_below_def_when_def_present():
    """Even when max_facets=1 and many parts exist, DEF survives."""
    g = _facet_graph()
    tir = resolve_tir([g], "hub", depth=0, max_facets=1)
    assert "[#hub:DEF]" in tir
    assert "DESC" not in tir and "EX" not in tir


def test_max_facets_applies_per_node_for_each_visited_node():
    """Two nodes, each with 4 facets; max_facets=2 -> 2 lines per node."""
    g = SIRGraph("doc")
    g.add_node(VTNode(id="root", parts=[("DEF", "r"), ("DESC", "d"), ("EX", "e"), ("META", "m")]))
    g.add_node(VTNode(id="child", parts=[("DEF", "c"), ("DESC", "cd"), ("EX", "ce"), ("META", "cm")]))
    g.add_edge(VTEdge(src="root", dst="child", rel=None))
    tir = resolve_tir([g], "root", depth=1, max_facets=2)
    lines = tir.splitlines()
    # root: DEF + DESC ; child: DEF + DESC
    assert lines == [
        "[#root:DEF] r",
        "[#root:DESC] d",
        "[#child:DEF] c",
        "[#child:DESC] cd",
    ]


def test_max_facets_combines_with_max_nodes():
    """max_facets trims per-node parts; max_nodes trims node count; both apply."""
    g = _facet_graph()
    # Add a child so max_nodes=1 actually trims something.
    g.add_node(VTNode(id="child", parts=[("DEF", "c"), ("DESC", "cd")]))
    g.add_edge(VTEdge(src="hub", dst="child", rel=None))
    tir = resolve_tir([g], "hub", depth=1, max_nodes=1, max_facets=2)
    lines = tir.splitlines()
    # only root survives (max_nodes=1), and only DEF+DESC of root (max_facets=2)
    assert lines == ["[#hub:DEF] hub definition", "[#hub:DESC] first desc"]
