"""Task H + I + J — v0.4 Context Assembly Engine 补充测试。

覆盖：
- Task H：AssembleResult.format_explain_report() 人类可读报告
- Task I：assembler.infer_priority() 自动推断规则
- Task J：ingest/memory_adapter.py 记忆系统输出 → SIR
"""
import json
import os

import pytest

from vtoken.assembler import (
    AssembleResult,
    ContextAssembler,
    DEFAULT_SLOTS,
    infer_priority,
    simple_token_counter,
)
from vtoken.graph import SIRGraph
from vtoken.ingest import ingest_memory, ingest_memory_from_json
from vtoken.model import VTNode


# ---------------------------------------------------------------------------
# Task I — infer_priority
# ---------------------------------------------------------------------------

class TestInferPriority:
    def test_blocker_tag_always_wins(self):
        assert infer_priority(node_type="EX", tags=["blocker"]) == 1
        assert infer_priority(node_type="DEF", tags=["task", "blocker"]) == 1

    def test_note_tag_lowest(self):
        assert infer_priority(node_type="DEF", tags=["note"]) == 8

    def test_blocker_overrides_note(self):
        # 同时出现 blocker + note，blocker 优先
        assert infer_priority(node_type="EX", tags=["note", "blocker"]) == 1

    def test_rule_type(self):
        # v0.4.3 (D35): 普通 RULE 降到 3，含强安全词的 RULE 才是 2
        assert infer_priority(node_type="RULE") == 3
        assert infer_priority(node_type="RULE", tags=[]) == 3
        # v0.4.3: 含强安全词的 RULE 升到 2
        assert infer_priority(node_type="RULE", content="JWT 必须使用 RS256") == 2
        assert infer_priority(node_type="RULE", content="禁止明文存储密码") == 2

    def test_def_type(self):
        assert infer_priority(node_type="DEF") == 4

    def test_desc_ex_types(self):
        assert infer_priority(node_type="DESC") == 6
        assert infer_priority(node_type="EX") == 6

    def test_default_priority(self):
        assert infer_priority(node_type="OPEN") == 5
        assert infer_priority(node_type=None) == 5
        assert infer_priority() == 5

    def test_tag_case_insensitive(self):
        assert infer_priority(node_type="EX", tags=["BLOCKER"]) == 1
        assert infer_priority(node_type="DEF", tags=["Note"]) == 8

    def test_other_tags_use_node_type(self):
        # pref/fact/session 等 tag 不命中特殊规则，回退到 node_type 判定
        # v0.4.3 (D35): 普通 RULE 现在是 3（含强安全词的才是 2）
        assert infer_priority(node_type="RULE", tags=["pref"]) == 3
        assert infer_priority(node_type="DEF", tags=["fact"]) == 4
        assert infer_priority(node_type="EX", tags=["session"]) == 6

    def test_priority_ordering(self):
        # 验证整体优先级排序（数值越小越优先）
        # v0.4.3 (D35): 普通 RULE 现在是 3（含强安全词的才是 2）
        priorities = [
            infer_priority(node_type="EX", tags=["blocker"]),                # 1
            infer_priority(node_type="RULE", content="JWT 必须使用 RS256"),    # 2 (强安全词)
            infer_priority(node_type="RULE"),                                  # 3 (普通 RULE)
            infer_priority(node_type="DEF"),                                   # 4
            infer_priority(node_type="OPEN"),                                  # 5
            infer_priority(node_type="DESC"),                                  # 6
            infer_priority(node_type="DEF", tags=["note"]),                    # 8
            infer_priority(node_type="DEF", tags=["note"], content="待确认"),   # 9 (待定词)
        ]
        assert priorities == sorted(priorities)


# ---------------------------------------------------------------------------
# Task H — AssembleResult.format_explain_report
# ---------------------------------------------------------------------------

class TestFormatExplainReport:
    def _make_result(self, **kwargs):
        defaults = dict(
            prompt="test prompt",
            tokens_used=8432,
            tokens_budget=32000,
            slot_breakdown={
                "system": {"tokens": 1203, "nodes": 15},
                "tools": {"tokens": 2841, "nodes": 28},
                "knowledge": {"tokens": 3109, "nodes": 31},
                "working": {"tokens": 1279, "nodes": 18},
            },
            nodes_included=list(range(92)),
            nodes_evicted=list(range(8)),
            dedup_count=12,
        )
        defaults.update(kwargs)
        return AssembleResult(**defaults)

    def test_report_has_title(self):
        r = self._make_result()
        report = r.format_explain_report()
        assert "Context Assembly Report" in report

    def test_report_includes_budget_line(self):
        r = self._make_result(tokens_used=8432, tokens_budget=32000)
        report = r.format_explain_report()
        assert "Budget:" in report
        assert "8,432" in report
        assert "32,000" in report
        assert "26.4%" in report  # 8432/32000 = 26.35%

    def test_report_includes_all_slots(self):
        r = self._make_result()
        report = r.format_explain_report()
        for slot in ("system", "tools", "knowledge", "working"):
            assert slot in report
        # 验证 token 数和节点数都出现
        assert "1,203" in report
        assert "28" in report  # tools 节点数

    def test_report_includes_dedup_and_evict_counts(self):
        r = self._make_result(dedup_count=12)
        report = r.format_explain_report()
        assert "Deduped:" in report
        assert "12" in report
        assert "Evicted:" in report
        # 8 evicted nodes
        assert "8 nodes" in report

    def test_report_includes_included_count(self):
        r = self._make_result()
        report = r.format_explain_report()
        assert "Included:" in report
        assert "92 nodes" in report

    def test_empty_result_report(self):
        # 空 AssembleResult 不应抛异常
        r = AssembleResult(
            prompt="", tokens_used=0, tokens_budget=1000,
            slot_breakdown={"system": {"tokens": 0, "nodes": 0}},
            nodes_included=[], nodes_evicted=[], dedup_count=0,
        )
        report = r.format_explain_report()
        assert "0 / 1,000 tokens (0.0%)" in report
        assert "Deduped:  0 nodes" in report
        assert "Evicted:  0 nodes" in report

    def test_zero_budget_no_division_error(self):
        # budget=0 不应抛 ZeroDivisionError
        r = AssembleResult(
            prompt="x", tokens_used=0, tokens_budget=0,
            slot_breakdown={}, nodes_included=[], nodes_evicted=[], dedup_count=0,
        )
        report = r.format_explain_report()
        assert "0 / 0 tokens (0.0%)" in report

    def test_report_handles_non_dict_slot_breakdown_gracefully(self):
        # slot_breakdown 中 value 不是 dict 也不应崩
        r = AssembleResult(
            prompt="x", tokens_used=1, tokens_budget=10,
            slot_breakdown={"system": None, "tools": "broken"},
            nodes_included=[], nodes_evicted=[], dedup_count=0,
        )
        report = r.format_explain_report()
        # 仍应正常输出标题
        assert "Context Assembly Report" in report
        assert "system" in report
        assert "tools" in report


# ---------------------------------------------------------------------------
# Task J — memory_adapter
# ---------------------------------------------------------------------------

class TestIngestMemory:
    def test_basic_single_entry(self):
        g = ingest_memory([
            {"id": "mem_001", "content": "用户偏好 RS256", "tags": ["pref"]},
        ])
        assert g.mode == "mem"
        assert "mem_001" in g.nodes
        node = g.nodes["mem_001"]
        assert node.slot == "knowledge"
        # pref tag 不命中特殊规则，node_type=EX → priority=6
        assert node.priority == 6
        assert node.parts[0][0] == "EX"
        assert node.source_files == ["<memory>"]

    def test_blocker_entry_gets_priority_1(self):
        g = ingest_memory([
            {"id": "mem_blocker", "content": "待确认 JWT_SECRET_KEY", "tags": ["blocker"]},
        ])
        node = g.nodes["mem_blocker"]
        assert node.priority == 1
        # v0.4.2 P5: blocker 升级到 system slot 强制前置（lost-in-middle 防护）
        assert node.slot == "system"

    def test_note_entry_gets_priority_8(self):
        g = ingest_memory([
            {"id": "mem_note", "content": "第 7 轮对话", "tags": ["note"]},
        ])
        node = g.nodes["mem_note"]
        assert node.priority == 8
        # note 不在 slot 推断规则里，默认 working
        assert node.slot == "working"

    def test_task_plan_go_to_working(self):
        g = ingest_memory([
            {"id": "m1", "content": "实现登录", "tags": ["task"]},
            {"id": "m2", "content": "Q3 路线图", "tags": ["plan"]},
        ])
        assert g.nodes["m1"].slot == "working"
        assert g.nodes["m2"].slot == "working"

    def test_pref_fact_go_to_knowledge(self):
        g = ingest_memory([
            {"id": "m1", "content": "用户偏好简洁回复", "tags": ["pref"]},
            {"id": "m2", "content": "JWT 默认 HS256", "tags": ["fact"]},
        ])
        assert g.nodes["m1"].slot == "knowledge"
        assert g.nodes["m2"].slot == "knowledge"

    def test_content_with_def_prefix(self):
        g = ingest_memory([
            {"id": "m_def", "content": "DEF: 这是定义", "tags": []},
        ])
        node = g.nodes["m_def"]
        # DEF 类型 → priority=4
        assert node.priority == 4
        assert node.parts[0][0] == "DEF"

    def test_content_with_rule_prefix(self):
        g = ingest_memory([
            {"id": "m_rule", "content": "RULE: token 有效期 24h", "tags": []},
        ])
        node = g.nodes["m_rule"]
        # v0.4.3 (D35): 普通 RULE 现在是 3（不含强安全词）
        assert node.priority == 3
        assert node.parts[0][0] == "RULE"

    def test_created_at_passed_through(self):
        g = ingest_memory([
            {"id": "m1", "content": "x", "tags": [], "created_at": 1718000000},
        ])
        assert g.nodes["m1"].created_at == 1718000000

    def test_missing_id_or_content_skipped(self):
        g = ingest_memory([
            {"id": "m1", "content": "valid"},
            {"id": "", "content": "empty id"},
            {"id": "m3"},  # no content
            "not a dict",
            None,
        ])
        assert "m1" in g.nodes
        assert len(g.nodes) == 1

    def test_tags_can_be_string(self):
        # tags 字段可以是单字符串（不是 list）
        g = ingest_memory([
            {"id": "m1", "content": "blocker content", "tags": "blocker"},
        ])
        assert g.nodes["m1"].priority == 1

    def test_empty_entries_returns_empty_graph(self):
        g = ingest_memory([])
        assert isinstance(g, SIRGraph)
        assert len(g.nodes) == 0

    def test_replace_existing_id(self):
        # 同 id 二次 ingest 应该覆盖（replace=True）
        g = ingest_memory([
            {"id": "m1", "content": "first", "tags": []},
            {"id": "m1", "content": "second", "tags": ["blocker"]},
        ])
        # 由于 dict 顺序 + replace=True，后写覆盖前写
        assert g.nodes["m1"].parts[0][1] == "second"
        assert g.nodes["m1"].priority == 1

    def test_multiple_entries_batch(self):
        g = ingest_memory([
            {"id": "m1", "content": "a", "tags": ["pref"]},
            {"id": "m2", "content": "b", "tags": ["blocker"]},
            {"id": "m3", "content": "c", "tags": ["fact"]},
            {"id": "m4", "content": "d", "tags": ["note"]},
        ])
        assert len(g.nodes) == 4
        # 验证 slot 分配（v0.4.2 P5: blocker 升级到 system slot 强制前置）
        assert g.nodes["m1"].slot == "knowledge"
        assert g.nodes["m2"].slot == "system"
        assert g.nodes["m3"].slot == "knowledge"
        assert g.nodes["m4"].slot == "working"


# ---------------------------------------------------------------------------
# Task J — ingest_memory_from_json
# ---------------------------------------------------------------------------

class TestIngestMemoryFromJson:
    def test_top_level_list(self, tmp_path):
        path = tmp_path / "mem.json"
        path.write_text(json.dumps([
            {"id": "m1", "content": "x", "tags": ["blocker"]},
            {"id": "m2", "content": "y", "tags": ["pref"]},
        ]), encoding="utf-8")
        g = ingest_memory_from_json(str(path))
        assert len(g.nodes) == 2
        assert g.nodes["m1"].priority == 1

    def test_memories_wrapper(self, tmp_path):
        path = tmp_path / "mem.json"
        path.write_text(json.dumps({"memories": [
            {"id": "m1", "content": "x", "tags": ["fact"]},
        ]}), encoding="utf-8")
        g = ingest_memory_from_json(str(path))
        assert "m1" in g.nodes
        assert g.nodes["m1"].slot == "knowledge"

    def test_entries_wrapper(self, tmp_path):
        path = tmp_path / "mem.json"
        path.write_text(json.dumps({"entries": [
            {"id": "m1", "content": "x"},
        ]}), encoding="utf-8")
        g = ingest_memory_from_json(str(path))
        assert len(g.nodes) == 1

    def test_empty_list(self, tmp_path):
        path = tmp_path / "mem.json"
        path.write_text("[]", encoding="utf-8")
        g = ingest_memory_from_json(str(path))
        assert len(g.nodes) == 0


# ---------------------------------------------------------------------------
# End-to-end: ingest_memory → assemble
# ---------------------------------------------------------------------------

class TestMemoryAssembleEndToEnd:
    def test_memory_nodes_assemble_into_prompt(self):
        """ingest_memory 产生的节点能被 ContextAssembler 正确处理。"""
        from vtoken.ingest import ingest_memory
        g = ingest_memory([
            {"id": "mem_001", "content": "DEF: 用户偏好 RS256", "tags": ["pref"]},
            {"id": "mem_002", "content": "待确认 JWT_SECRET_KEY", "tags": ["blocker"]},
            {"id": "mem_003", "content": "第 7 轮对话", "tags": ["note"]},
        ])
        # mem 节点 id 前缀 "mem." 命中 working slot
        # 构造 mock store
        class _Mem:
            graph = g
            _lock = __import__("threading").RLock()
        class _Store:
            doc = None
            mem = _Mem()
            def search(self, q, top_k=10):
                return [{"id": nid, "score": 1.0} for nid in g.nodes]
            def toc(self):
                return ""

        store = _Store()
        asm = ContextAssembler(simple_token_counter)
        result = asm.assemble("JWT 实现", 5000, DEFAULT_SLOTS, store)
        # working slot 应包含 mem 节点
        assert result.slot_breakdown["working"]["nodes"] >= 1
        # nodes_included 至少包含一个 mem 节点
        assert any(nid.startswith("mem_") for nid in result.nodes_included)
