"""T5.2 doc → Markdown renderer (spec §3.4, HANDOFF §3 T5.2).

验收：示例文档渲染含全部节点与边、注释丢弃（parser 已丢弃 // 注释，故此处
只需处理 ParsedVT 的 nodes / edges）。

设计（朴素 MD，与 D19 一致；用作"供人审查"输出）：
- 顶部 H1 = %id（doc 模式），含 lang/schema 元信息
- 节点按文件声明序输出：每节点一个 H2，DEF/RULE/VAR/OPEN 共用
- 注解 facet（DESC/EX/META/SRC）作为 H3 子标题
- 边统一收集到文末"关系"段，按声明序输出 `src --REL--> dst`（无类型边用 `~~`）
- mem 模式：渲染为简单列表（`- #tag content` 或 `- content`）
"""
from __future__ import annotations

from .model import ParsedVT
from .parser import parse_vt_file


def render_doc_to_markdown(parsed: ParsedVT) -> str:
    """Render a parsed doc-mode .vt to a Markdown string.

    Args:
        parsed: ParsedVT from parser (header.mode == "doc").

    Returns:
        Markdown text (UTF-8 string). Comments are already dropped by parser.
    """
    if parsed.header.mode != "doc":
        raise ValueError(f"render_doc_to_markdown expects doc mode, got {parsed.header.mode!r}")

    h = parsed.header
    out: list[str] = []

    # ---- header / metadata
    title = h.doc_id or parsed.filename
    out.append(f"# {title}")
    out.append("")
    meta_bits = []
    if h.vt_version:
        meta_bits.append(f"vt `{h.vt_version}`")
    if h.schema:
        meta_bits.append(f"schema `{h.schema}`")
    if h.lang:
        meta_bits.append(f"lang `{h.lang}`")
    if h.ns:
        meta_bits.append(f"ns `{h.ns}`")
    if meta_bits:
        out.append("> " + " · ".join(meta_bits))
        out.append("")

    # ---- nodes (file order, facets grouped under defining id)
    # Each node's parts[0] is the defining line (DEF/RULE/VAR/OPEN).
    # Subsequent parts are annotations of the same id (D1).
    for node in parsed.nodes:
        if not node.parts:
            continue
        # group by id: a node here already is one VTNode per id (parser groups facets)
        def_type, def_content = node.parts[0]
        type_label = def_type or "DEF"
        out.append(f"## {node.id} [{type_label}]")
        out.append("")
        out.append(def_content)
        out.append("")
        # annotation facets
        for sym, content in node.parts[1:]:
            if sym in ("DESC", "EX", "META", "SRC"):
                out.append(f"### {sym}")
                out.append("")
                out.append(content)
                out.append("")
            else:
                # extra defining-type facet (rare; duplicate_id path normally rejects)
                out.append(f"### {sym}")
                out.append("")
                out.append(content)
                out.append("")

    # ---- edges
    if parsed.edges:
        out.append("---")
        out.append("")
        out.append("## 关系 (Edges)")
        out.append("")
        for e in parsed.edges:
            rel = e.rel if e.rel else "~~"
            out.append(f"- `{e.src}` --{rel}--> `{e.dst}`")
        out.append("")

    return "\n".join(out).rstrip() + "\n"


def render_mem_to_markdown(parsed: ParsedVT) -> str:
    """Render a parsed mem-mode .vt to a simple Markdown list.

    Mem syntax (D6) carries no node ids or edges; we just emit one bullet per
    mem item, preserving the tag if present.
    """
    if parsed.header.mode != "mem":
        raise ValueError(f"render_mem_to_markdown expects mem mode, got {parsed.header.mode!r}")

    h = parsed.header
    out: list[str] = []
    out.append(f"# session: {h.session or '(none)'}")
    out.append("")
    for item in parsed.mem_items:
        if item.tag:
            out.append(f"- #{item.tag} {item.content}")
        else:
            out.append(f"- {item.content}")
    out.append("")
    return "\n".join(out)


def render_file(vt_path: str) -> str:
    """Parse + render a .vt file (doc or mem) to Markdown."""
    parsed = parse_vt_file(vt_path)
    if parsed.header.mode == "doc":
        return render_doc_to_markdown(parsed)
    if parsed.header.mode == "mem":
        return render_mem_to_markdown(parsed)
    raise ValueError(f"unknown mode: {parsed.header.mode!r}")
