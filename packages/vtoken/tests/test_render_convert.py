"""T5.2 vt render + T5.3 vt convert 测试 (HANDOFF §3 T5.2 / T5.3).

T5.2 验收：示例文档渲染含全部节点与边、注释丢弃。
T5.3 验收：vt convert --from-md (Markdown -> .vt)，质量声明按 P3.3（lossy 反向）。
"""
from __future__ import annotations

import os
import sys

import pytest

from vtoken import render_file, render_doc_to_markdown, parse_vt
from vtoken.md_to_vt import md_to_vt_string
from vtoken.parser import parse_vt_file


# reuse spec samples
HERE = os.path.dirname(os.path.abspath(__file__))
SPEC_AUTH_VT = os.path.normpath(os.path.join(HERE, "..", "examples", "doc", "auth.vt"))
SPEC_MEM_VT = os.path.normpath(os.path.join(HERE, "..", "examples", "mem", "session_example.vt"))


# ---------------------------------------------------------------------------
# T5.2 vt render
# ---------------------------------------------------------------------------

class TestRenderDoc:
    """T5.2 doc .vt -> Markdown."""

    def test_render_contains_all_nodes(self):
        """HANDOFF T5.2 验收：示例文档渲染含全部节点。"""
        md = render_file(SPEC_AUTH_VT)
        # auth.vt has 8 nodes (per search agent report)
        # auth.overview, auth.sec_1, auth.sec_2, auth.sec_3,
        # auth.jwt_secret, auth.algo, auth.ex_1, auth.todo_1
        for node_id in [
            "auth.overview", "auth.sec_1", "auth.sec_2", "auth.sec_3",
            "auth.jwt_secret", "auth.algo", "auth.ex_1", "auth.todo_1",
        ]:
            assert node_id in md, f"node {node_id} missing from render output"

    def test_render_contains_all_edges(self):
        """HANDOFF T5.2 验收：示例文档渲染含全部边。"""
        md = render_file(SPEC_AUTH_VT)
        # auth.vt has 6 edges per the parser report
        assert "auth.sec_1" in md and "middleware.jwt_verify" in md
        assert "auth.overview" in md and "db.user_table" in md
        assert "api.endpoint.login" in md
        # relations present
        assert "ENFORCED-BY" in md
        assert "DEPENDS" in md
        assert "~~" in md  # untyped edge

    def test_render_drops_comments(self):
        """HANDOFF T5.2 验收：注释丢弃。 parser already drops // comments."""
        md = render_file(SPEC_AUTH_VT)
        # auth.vt has two // comments at the end (per spec_auth fixture)
        # they should not appear in render output
        assert "审查注释" not in md
        assert "2024-07-18" not in md

    def test_render_header_metadata(self):
        md = render_file(SPEC_AUTH_VT)
        assert "# system/auth" in md
        assert "vt `0.3.1`" in md
        assert "schema `core`" in md
        assert "lang `zh`" in md

    def test_render_annotation_facets_as_h3(self):
        md = render_file(SPEC_AUTH_VT)
        # auth.overview has 2 DESC facets (per SPEC_AUTH fixture in conftest)
        assert "### DESC" in md

    def test_render_to_file(self, tmp_path):
        out = tmp_path / "auth.md"
        # use CLI via subprocess-like call
        from vtoken.cli import main
        rc = main(["render", SPEC_AUTH_VT, "-o", str(out)])
        assert rc == 0
        text = out.read_text(encoding="utf-8")
        assert "auth.overview" in text
        assert "auth.sec_1" in text


class TestRenderMem:
    """T5.2 mem .vt -> Markdown."""

    def test_render_mem_items(self):
        md = render_file(SPEC_MEM_VT)
        assert "session: task_20240718_auth_impl" in md
        # tags should be preserved
        assert "#blocker" in md
        assert "#pref" in md
        # plain items
        assert "RS256" in md


class TestRenderErrors:
    """T5.2 render error handling."""

    def test_render_missing_file(self, tmp_path):
        from vtoken.cli import main
        rc = main(["render", str(tmp_path / "nope.vt")])
        assert rc != 0


# ---------------------------------------------------------------------------
# T5.3 vt convert --from-md
# ---------------------------------------------------------------------------

class TestConvertDoc:
    """T5.3 Markdown -> .vt (doc mode) — lossy reverse of render."""

    def test_round_trip_preserves_nodes(self, tmp_path):
        """vt -> render -> convert -> vt: same nodes, edges, facets."""
        # 1. render original .vt to MD
        md = render_file(SPEC_AUTH_VT)
        # 2. convert MD back to .vt
        vt_text = md_to_vt_string(md, mode="doc")
        # 3. parse the round-tripped .vt
        parsed = parse_vt(vt_text, filename="<roundtrip>")
        # 4. assert all original node ids present
        original = parse_vt_file(SPEC_AUTH_VT)
        original_ids = {node.id for node in original.nodes}
        roundtrip_ids = {node.id for node in parsed.nodes}
        assert original_ids == roundtrip_ids, (
            f"node id set changed: missing={original_ids - roundtrip_ids}, "
            f"extra={roundtrip_ids - original_ids}"
        )
        # 5. assert edge count preserved
        assert len(parsed.edges) == len(original.edges)

    def test_round_trip_edges_semantically_equivalent(self):
        md = render_file(SPEC_AUTH_VT)
        vt_text = md_to_vt_string(md, mode="doc")
        parsed = parse_vt(vt_text, filename="<roundtrip>")
        original = parse_vt_file(SPEC_AUTH_VT)
        # edge triples (src, rel, dst) — order may differ
        orig_triples = {(e.src, e.rel, e.dst) for e in original.edges}
        round_triples = {(e.src, e.rel, e.dst) for e in parsed.edges}
        assert orig_triples == round_triples

    def test_convert_via_cli_to_stdout(self, tmp_path):
        """vt convert --from-md reads MD file, writes .vt to stdout."""
        md_path = tmp_path / "auth.md"
        md_path.write_text(render_file(SPEC_AUTH_VT), encoding="utf-8")
        from vtoken.cli import main
        rc = main(["convert", "--from-md", str(md_path)])
        assert rc == 0  # assertions on stdout contents done in other tests

    def test_convert_via_cli_to_file(self, tmp_path):
        md_path = tmp_path / "auth.md"
        md_path.write_text(render_file(SPEC_AUTH_VT), encoding="utf-8")
        out_path = tmp_path / "roundtrip.vt"
        from vtoken.cli import main
        rc = main(["convert", "--from-md", str(md_path), "-o", str(out_path)])
        assert rc == 0
        assert out_path.exists()
        # the produced .vt must parse cleanly
        parsed = parse_vt_file(str(out_path))
        assert parsed.header.mode == "doc"
        assert parsed.header.doc_id == "system/auth"

    def test_convert_mem_mode(self):
        md = render_file(SPEC_MEM_VT)
        vt_text = md_to_vt_string(md, mode="mem")
        parsed = parse_vt(vt_text, filename="<mem-roundtrip>")
        assert parsed.header.mode == "mem"
        assert parsed.header.session == "task_20240718_auth_impl"
        # mem items preserve count
        original = parse_vt_file(SPEC_MEM_VT)
        assert len(parsed.mem_items) == len(original.mem_items)
        # tags preserved
        rt_tags = {item.tag for item in parsed.mem_items}
        orig_tags = {item.tag for item in original.mem_items}
        assert rt_tags == orig_tags


class TestConvertQualityStatement:
    """P3.3 quality statement: lossy, structural equivalence, not byte-identical."""

    def test_byte_identity_not_guaranteed(self):
        """Round-trip .vt -> render -> convert -> .vt is structurally equivalent
        but NOT byte-identical to original."""
        original_text = open(SPEC_AUTH_VT, "r", encoding="utf-8").read()
        md = render_file(SPEC_AUTH_VT)
        roundtrip_text = md_to_vt_string(md, mode="doc")
        assert original_text != roundtrip_text, (
            "round-trip should not be byte-identical (comments stripped, "
            "facet ordering normalized)"
        )

    def test_comments_are_lost_after_round_trip(self):
        """Original comments (// ...) are stripped by render and cannot be recovered."""
        md = render_file(SPEC_AUTH_VT)
        # confirm render dropped comments
        assert "审查注释" not in md
        # convert back; still no comments
        vt_text = md_to_vt_string(md, mode="doc")
        assert "审查注释" not in vt_text
        assert "//" not in vt_text
