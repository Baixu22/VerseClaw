"""T5.3 Markdown -> .vt converter (reverse of renderer.py).

Quality statement (HANDOFF §3 T5.3, spec P3.3):
- Uses regex pattern matching on Markdown structure (H1/H2/H3/bullet edges).
- NOT lossless — original .vt byte order is NOT preserved; comments already
  stripped by `vt render` cannot be recovered.
- Round-trip .vt -> render -> convert -> .vt is structurally equivalent
  (same nodes, edges, facets) but not byte-identical.
- Designed to consume output of `vtoken.renderer.render_doc_to_markdown`;
  arbitrary hand-written Markdown may not convert cleanly.

Supported Markdown shapes:
- H1 `# <doc_id>` (doc) or `# session: <name>` (mem)
- Optional `> vt '...' · schema '...' · lang '...' · ns '...'` meta line
- H2 `## <id> [TYPE]` — node definition; subsequent paragraph is the content
- H3 `### <TYPE>` — annotation facet for the most recent node
- Section `## 关系 (Edges)` (or any `## ...Edges...`) followed by bullets
  `- `<src>` --<REL>--> `<dst>`` (or `~~` for untyped)
- mem mode: bullet list `- [#tag ]? content` after H1
"""
from __future__ import annotations

import re

from .errors import VTParseError, VTIssue


_H1_RE = re.compile(r"^# (.+?)\s*$")
_H2_RE = re.compile(r"^## (\S+)(?:\s+\[([A-Z_]+)\])?\s*$")
_H3_RE = re.compile(r"^### ([A-Z_]+)(?:\s+\[([^\]]+)\])?\s*$")
_META_FIELD_RE = re.compile(r"(vt|schema|lang|ns)\s+[`']([^`']+)[`']")
_BULLET_EDGE_RE = re.compile(r"^-\s+`([^`]+)`\s+--(~~|[A-Z][A-Z0-9_-]*)-->\s+`([^`]+)`\s*$")
_MEM_BULLET_RE = re.compile(r"^-\s+(?:#(\S+)\s+)?(.+?)\s*$")


def md_to_vt_string(md: str, mode: str = "doc") -> str:
    """Convert Markdown text to a .vt source string.

    Args:
        md: Markdown text (typically from `vt render`).
        mode: "doc" or "mem".

    Returns:
        .vt source text ready to be parsed by `parse_vt` / written to disk.
    """
    if mode not in ("doc", "mem"):
        raise ValueError(f"unsupported mode: {mode!r}")
    lines = md.splitlines()

    # Parse top-level metadata
    vt_version = "0.3.1"
    doc_id: str | None = None
    session: str | None = None
    lang = "en"
    schema = "core"
    ns: str | None = None

    i = 0
    n = len(lines)
    # Skip leading blanks, find H1
    while i < n and not lines[i].strip():
        i += 1
    if i >= n:
        raise VTParseError(
            file="<md>",
            issues=[VTIssue(line=1, type="missing_header",
                             message="Markdown has no H1 title line")],
        )
    h1 = _H1_RE.match(lines[i])
    if not h1:
        raise VTParseError(
            file="<md>",
            issues=[VTIssue(line=i + 1, type="missing_header",
                             message=f"expected H1 title, got: {lines[i]!r}")],
        )
    h1_text = h1.group(1).strip()
    if mode == "mem":
        # H1 form: "session: <name>"
        m = re.match(r"^session:\s*(.+)$", h1_text)
        session = m.group(1).strip() if m else h1_text
    else:
        doc_id = h1_text
    i += 1

    # Optional meta line — parse `key 'value'` pairs separated by `·` or `,`
    while i < n and not lines[i].strip():
        i += 1
    if i < n and lines[i].lstrip().startswith(">"):
        meta_line = lines[i].lstrip()[1:]  # strip leading '>'
        for key, val in _META_FIELD_RE.findall(meta_line):
            if key == "vt":
                vt_version = val
            elif key == "schema":
                schema = val
            elif key == "lang":
                lang = val
            elif key == "ns":
                ns = val
        i += 1

    if mode == "mem":
        return _convert_mem_body(lines[i:], vt_version, session or "default",
                                 lang=lang, schema=schema, ns=ns)
    return _convert_doc_body(lines[i:], vt_version, doc_id or "doc",
                             lang=lang, schema=schema, ns=ns)


def _convert_doc_body(lines: list[str], vt_version: str, doc_id: str,
                      *, lang: str, schema: str, ns: str | None) -> str:
    """Convert the body (after H1 + meta) for doc mode."""
    out: list[str] = [
        f"%vt {vt_version}",
        "%mode doc",
        f"%id {doc_id}",
        f"%lang {lang}",
        f"%schema {schema}",
    ]
    if ns:
        out.append(f"%ns {ns}")
    out.append("")

    current_node_id: str | None = None
    current_node_type: str | None = None
    in_edges_section = False
    edges: list[str] = []

    i = 0
    n = len(lines)
    while i < n:
        ln = lines[i]
        stripped = ln.strip()

        # H2 — node definition OR edges section header
        h2 = _H2_RE.match(stripped) if stripped.startswith("## ") else None
        if h2:
            nid = h2.group(1)
            ntype = h2.group(2)
            if "edges" in nid.lower() or (ntype and "edges" in ntype.lower()):
                # entering edges section
                in_edges_section = True
                current_node_id = None
                i += 1
                continue
            # regular node definition
            in_edges_section = False
            current_node_id = nid
            current_node_type = ntype or "DEF"
            # next non-blank line is content
            i += 1
            while i < n and not lines[i].strip():
                i += 1
            if i < n and not lines[i].startswith("#"):
                content = lines[i].strip()
                out.append(f"{current_node_type} {current_node_id}  {content}")
                i += 1
            else:
                out.append(f"{current_node_type} {current_node_id}  ")
            continue

        # H3 — annotation facet of current node
        h3 = _H3_RE.match(stripped) if stripped.startswith("### ") else None
        if h3 and current_node_id:
            ftype = h3.group(1)
            # next non-blank line is content
            i += 1
            while i < n and not lines[i].strip():
                i += 1
            if i < n and not lines[i].startswith("#"):
                content = lines[i].strip()
                out.append(f"{ftype} {current_node_id}  {content}")
                i += 1
            else:
                out.append(f"{ftype} {current_node_id}  ")
            continue

        # bullet edge (only in edges section, but accept anywhere as a fallback)
        e = _BULLET_EDGE_RE.match(stripped) if stripped.startswith("- ") else None
        if e:
            src, rel, dst = e.group(1), e.group(2), e.group(3)
            # Untyped edges use `~~` (no `--` prefix/suffix); typed edges use `--REL-->`
            if rel == "~~":
                edges.append(f"REF {src} ~~ {dst}")
            else:
                edges.append(f"REF {src} --{rel}--> {dst}")
            i += 1
            continue

        # horizontal rule — skip
        if stripped in ("---", "***", "___"):
            i += 1
            continue

        i += 1

    # Emit edges after nodes
    if edges:
        out.append("")
        out.extend(edges)
    out.append("")
    return "\n".join(out)


def _convert_mem_body(lines: list[str], vt_version: str, session: str,
                      *, lang: str, schema: str, ns: str | None) -> str:
    """Convert the body (after H1 + meta) for mem mode."""
    out: list[str] = [
        f"%vt {vt_version}",
        "%mode mem",
        f"%session {session}",
        "",
    ]
    for ln in lines:
        stripped = ln.strip()
        if not stripped:
            continue
        if stripped.startswith("#"):
            continue  # ignore sub-headings in mem
        m = _MEM_BULLET_RE.match(stripped)
        if m:
            tag = m.group(1)
            content = m.group(2)
            if tag:
                out.append(f"#{tag} {content}")
            else:
                out.append(f"- {content}")
        # else: ignore non-bullet lines (e.g., horizontal rules, prose)
    out.append("")
    return "\n".join(out)
