"""Task C — Markdown → SIR adapter (v0.4 Context Assembly Engine).

直接输出 SIR 节点，跳过 .vt 中间格式（D31 决策）。

映射规则（详见 §1.2 / Task C）：
- ``# H1`` → DEF 节点，id = slugify(heading)
- ``## H2`` → DEF 节点，id = parent_h1_slug.child_slug
- ``### H3`` → DESC facet 追加到父节点
- ``- bullet`` → EX facet（前 max_facets 条，超出截断）
- ``**bold**`` 开头的 bullet → RULE facet 追加到父节点
- ``[text](anchor)`` → REF 边（untyped，~~ 边）

slot 推断（按文件名）：
- 文件名含 rule/constraint/spec → slot="system"
- 文件名含 tool/mcp/skill → slot="tools"
- 其他 → slot="knowledge"

priority 推断（D31 + Task I 规则）：
- DEF → 4
- RULE → 2
- 默认 → 5
"""
from __future__ import annotations

import os
import re

from ..graph import SIRGraph
from ..model import VTEdge, VTNode


# ---------------------------------------------------------------------------
# 正则
# ---------------------------------------------------------------------------

_H1_RE = re.compile(r"^#\s+(.+?)\s*$")
_H2_RE = re.compile(r"^##\s+(.+?)\s*$")
_H3_RE = re.compile(r"^###\s+(.+?)\s*$")
_BULLET_RE = re.compile(r"^[-*]\s+(.+?)\s*$")
_BOLD_BULLET_RE = re.compile(r"^[-*]\s+\*\*(.+?)\*\*\s*(.*)$")
_LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
_FOOTER_RE = re.compile(r"^(>|\s*$)")  # 引用块或空行不算节点内容


# ---------------------------------------------------------------------------
# 工具函数
# ---------------------------------------------------------------------------

def slugify(text: str) -> str:
    """把标题转为合法的 .vt ID 片段。

    规则：小写化；非字母数字下划线连字符替换为下划线；合并连续下划线；去首尾下划线。
    """
    s = text.lower().strip()
    s = re.sub(r"[^\w\-]+", "_", s)
    s = re.sub(r"_+", "_", s)
    s = s.strip("_")
    return s or "untitled"


def _infer_slot(filename: str | None) -> str:
    """按文件名推断 slot 归属。"""
    if not filename:
        return "knowledge"
    base = os.path.basename(filename).lower()
    if any(kw in base for kw in ("rule", "constraint", "spec")):
        return "system"
    if any(kw in base for kw in ("tool", "mcp", "skill")):
        return "tools"
    return "knowledge"


def _infer_priority(node_type: str | None, content: str | None = None) -> int:
    """按节点类型推断 priority（数值越小越优先）。

    v0.4 Task I — 委托给 assembler.infer_priority()，md 文档无 tag 概念，
    所以只传 node_type。
    v0.4.3 (D35): 传 content 给 infer_priority 做语义细分（让含"必须"/"禁止"的
    RULE 升级到 priority=2，普通 RULE 降到 priority=3，避免同 priority 退化）。
    """
    from ..assembler import infer_priority
    return infer_priority(node_type=node_type, tags=None, content=content)


# ---------------------------------------------------------------------------
# 主 ingest 函数
# ---------------------------------------------------------------------------

def ingest_markdown(md_text: str, source_path: str | None = None,
                    max_facets: int = 2) -> SIRGraph:
    """把 Markdown 文本转为 SIRGraph。

    参数：
        md_text     : Markdown 文本
        source_path : 源文件路径（用于 slot 推断 + source_files 记录）
        max_facets  : 每个节点的 EX facet 上限（默认 2）

    返回：
        SIRGraph（mode="doc"）
    """
    slot = _infer_slot(source_path)
    source_file = source_path or "<markdown>"
    graph = SIRGraph("doc")

    current_h1_id: str | None = None
    current_h2_id: str | None = None
    ex_facet_counts: dict[str, int] = {}

    def add_facet(node_id: str, facet_type: str, content: str) -> None:
        if node_id not in graph.nodes:
            return
        node = graph.nodes[node_id]
        node.parts.append((facet_type, content))
        # v0.4.3 (D35): 后续 facet 也更新节点 priority（取 min，让强安全词 RULE
        # 把 DEF 节点的 priority 从 4 降到 2，使 _line_priority 排序生效）
        facet_priority = _infer_priority(facet_type, content=content)
        if facet_priority < node.priority:
            node.priority = facet_priority

    def add_node(node_id: str, node_type: str, content: str, line: int) -> None:
        priority = _infer_priority(node_type, content=content)  # v0.4.3: 传 content 做语义细分
        if node_id in graph.nodes:
            add_facet(node_id, node_type, content)
            return
        node = VTNode(
            id=node_id,
            parts=[(node_type, content)],
            line=line,
            source_file=source_file,
            slot=slot,
            priority=priority,
            source_files=[source_file],
        )
        graph.add_node(node)
        ex_facet_counts[node_id] = 0

    def maybe_add_ex_facet(node_id: str, content: str) -> None:
        if ex_facet_counts.get(node_id, 0) >= max_facets:
            return
        add_facet(node_id, "EX", content)
        ex_facet_counts[node_id] = ex_facet_counts.get(node_id, 0) + 1

    for line_num, raw_line in enumerate(md_text.splitlines(), 1):
        line = raw_line.rstrip()

        if _FOOTER_RE.match(line):
            continue

        # H1
        m = _H1_RE.match(line)
        if m:
            heading = m.group(1)
            node_id = slugify(heading)
            current_h1_id = node_id
            current_h2_id = None
            add_node(node_id, "DEF", heading, line_num)
            continue

        # H2
        m = _H2_RE.match(line)
        if m:
            heading = m.group(1)
            child_slug = slugify(heading)
            if current_h1_id:
                node_id = f"{current_h1_id}.{child_slug}"
            else:
                node_id = child_slug
            current_h2_id = node_id
            add_node(node_id, "DEF", heading, line_num)
            continue

        # H3
        m = _H3_RE.match(line)
        if m:
            heading = m.group(1)
            parent_id = current_h2_id or current_h1_id
            if parent_id:
                add_facet(parent_id, "DESC", heading)
            continue

        # bullet
        m = _BULLET_RE.match(line)
        if m:
            content = m.group(1)
            parent_id = current_h2_id or current_h1_id
            if not parent_id:
                continue

            # bold bullet → RULE facet
            bold_m = _BOLD_BULLET_RE.match(line)
            if bold_m:
                rule_text = bold_m.group(1)
                rest = bold_m.group(2).strip()
                rule_content = rule_text if not rest else f"{rule_text} {rest}"
                add_facet(parent_id, "RULE", rule_content)
                continue

            # link → REF 边（untyped）
            link_m = _LINK_RE.search(content)
            if link_m:
                link_text = link_m.group(1)
                dst_id = slugify(link_text)
                if dst_id and dst_id != parent_id:
                    graph.add_edge(VTEdge(src=parent_id, dst=dst_id, rel=None))
                maybe_add_ex_facet(parent_id, content)
                continue

            # 普通 bullet → EX facet
            maybe_add_ex_facet(parent_id, content)
            continue

        # 段落正文 → META facet
        if line.strip() and (current_h2_id or current_h1_id):
            parent_id = current_h2_id or current_h1_id
            add_facet(parent_id, "META", line.strip())

    return graph


def ingest_markdown_file(path: str, max_facets: int = 2) -> SIRGraph:
    """从 .md 文件 ingest。"""
    with open(path, "r", encoding="utf-8") as f:
        md_text = f.read()
    return ingest_markdown(md_text, source_path=path, max_facets=max_facets)
