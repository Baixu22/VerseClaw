"""P1.1 — .vt file parser (HIR layer, spec §3).

Collects ALL issues before raising (better for agent self-repair loops) and
reports them in the spec §8.1 machine-parseable JSON shape via VTParseError.
"""
from __future__ import annotations

import os
import re

from .errors import VTIssue, VTParseError
from .model import Header, MemItem, ParsedVT, VTEdge, VTNode
from .schema import ANNOTATION_TYPES, CORE, Schema, load_schema

ID_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_.\-]*$")
REL_RE = re.compile(r"^--([A-Z][A-Z0-9_-]*)-->$")
TAG_RE = re.compile(r"^#([A-Za-z0-9_\-]+)$")
DIRECTIVE_RE = re.compile(r"^%([a-z]+)(?:\s+(.*\S))?\s*$")
VERSION_RE = re.compile(r"^\d+\.\d+(\.\d+)?$")

KNOWN_DIRECTIVES = {"vt", "mode", "id", "session", "lang", "schema", "ns"}


def parse_vt_file(path: str) -> ParsedVT:
    with open(path, encoding="utf-8-sig") as f:
        text = f.read()
    return parse_vt(text, filename=path,
                    schema_dir=os.path.dirname(os.path.abspath(path)))


def parse_vt(text: str, filename: str = "<memory>", schema_dir: str | None = None) -> ParsedVT:
    issues: list[VTIssue] = []
    lines = text.splitlines()
    header = Header()
    seen_directives: set[str] = set()
    body_lines: list[tuple[int, str]] = []

    if not lines or not lines[0].startswith("%vt"):
        issues.append(VTIssue(1, "missing_version", "first line must be '%vt <version>'"))

    in_header = True
    for lineno, raw in enumerate(lines, 1):
        line = raw.rstrip()
        stripped = line.strip()
        if in_header:
            if not stripped or stripped.startswith("//"):
                continue
            if stripped.startswith("%"):
                _parse_directive(stripped, lineno, header, seen_directives, issues)
                continue
            in_header = False
            body_lines.append((lineno, line))
        else:
            if stripped.startswith("%"):
                issues.append(VTIssue(lineno, "directive_after_body",
                                      f"directive {stripped.split()[0]} must appear before the first content line"))
                continue
            body_lines.append((lineno, line))

    if "mode" not in seen_directives:
        issues.append(VTIssue(1, "missing_mode", "missing required directive %mode"))
    mode = header.mode if header.mode in ("doc", "mem") else None
    if mode == "doc" and not header.doc_id:
        issues.append(VTIssue(1, "missing_id_directive", "%mode doc requires %id"))
    if mode == "mem" and not header.session:
        issues.append(VTIssue(1, "missing_session_directive", "%mode mem requires %session"))

    parsed = ParsedVT(header=header, filename=filename)
    if mode == "doc":
        schema = CORE
        if header.schema != "core":
            try:
                schema = load_schema(header.schema, schema_dir)
            except VTParseError as e:
                detail = "; ".join(f"{i.type}: {i.message}" for i in e.issues)
                issues.append(VTIssue(1, "schema_error",
                                      f"failed to load schema '{header.schema}': {detail}"))
        _parse_doc_body(body_lines, parsed, schema, issues)
    elif mode == "mem":
        _parse_mem_body(body_lines, parsed, issues)

    if issues:
        raise VTParseError(filename, issues)
    return parsed


def _parse_directive(stripped: str, lineno: int, header: Header,
                     seen: set[str], issues: list[VTIssue]) -> None:
    m = DIRECTIVE_RE.match(stripped)
    if not m:
        issues.append(VTIssue(lineno, "invalid_directive", f"malformed directive: {stripped!r}"))
        return
    key, val = m.group(1), (m.group(2) or "")
    if key not in KNOWN_DIRECTIVES:
        issues.append(VTIssue(lineno, "unknown_directive",
                              f"unknown directive %{key}", symbol=f"%{key}"))
        return
    if key in seen:
        issues.append(VTIssue(lineno, "duplicate_directive",
                              f"%{key} declared twice", symbol=f"%{key}"))
        return
    seen.add(key)
    if key == "vt":
        if lineno != 1:
            issues.append(VTIssue(lineno, "misplaced_version", "'%vt' must be the first line"))
        if not VERSION_RE.match(val):
            issues.append(VTIssue(lineno, "invalid_version", f"bad version {val!r}"))
        header.vt_version = val
    elif key == "mode":
        if val not in ("doc", "mem"):
            issues.append(VTIssue(lineno, "invalid_mode",
                                  f"%mode must be 'doc' or 'mem', got {val!r}"))
        header.mode = val
    elif key == "id":
        header.doc_id = val
    elif key == "session":
        header.session = val
    elif key == "lang":
        header.lang = val or "en"
    elif key == "schema":
        header.schema = val or "core"
    elif key == "ns":
        # D19 / v0.3.2 proposal: opt-in namespace elision
        if not val or "." in val or not ID_RE.match(val):
            issues.append(VTIssue(lineno, "invalid_ns",
                                  f"%ns must be a single dot-free identifier, got {val!r}"))
        else:
            header.ns = val


def _qualify(node_id: str, ns: str | None) -> str:
    """%ns elision: bare (dot-free) ids get the namespace prefix; qualified ids pass through."""
    if ns and "." not in node_id:
        return f"{ns}.{node_id}"
    return node_id


def _parse_doc_body(body_lines, parsed: ParsedVT, schema: Schema, issues: list[VTIssue]) -> None:
    nodes_by_id: dict[str, VTNode] = {}
    ns = parsed.header.ns

    for lineno, raw in body_lines:
        stripped = raw.strip()
        if not stripped or stripped.startswith("//"):
            continue
        fields = stripped.split(None, 2)
        kw = fields[0]

        if kw == "REF":
            toks = stripped.split()
            if len(toks) != 4:
                issues.append(VTIssue(lineno, "invalid_ref",
                                      "REF must be 'REF <src> --REL--> <dst>' or 'REF <src> ~~ <dst>'"))
                continue
            _, src, relspec, dst = toks
            rel: str | None = None
            if relspec != "~~":
                m = REL_RE.match(relspec)
                if not m:
                    issues.append(VTIssue(lineno, "invalid_relation",
                                          f"bad relation syntax {relspec!r}", symbol=relspec))
                    continue
                rel = m.group(1)
                if not schema.is_relation(rel):
                    issues.append(VTIssue(lineno, "unknown_relation",
                                          f"relation '{rel}' is not defined in schema '{schema.name}'",
                                          symbol=relspec))
                    continue
            ok = True
            for role, v in (("source", src), ("target", dst)):
                if not ID_RE.match(v):
                    issues.append(VTIssue(lineno, "invalid_id",
                                          f"invalid {role} id {v!r}", id=v))
                    ok = False
            if not ok:
                continue
            parsed.edges.append(VTEdge(src=_qualify(src, ns), dst=_qualify(dst, ns),
                                       rel=rel, line=lineno))
            continue

        if not schema.is_node_type(kw):
            issues.append(VTIssue(lineno, "unknown_type",
                                  f"unknown type symbol '{kw}'", symbol=kw))
            continue
        if len(fields) < 2:
            issues.append(VTIssue(lineno, "missing_id", f"{kw} line requires a node id"))
            continue
        node_id = fields[1]
        if not ID_RE.match(node_id):
            issues.append(VTIssue(lineno, "invalid_id",
                                  f"invalid node id {node_id!r}", id=node_id))
            continue
        node_id = _qualify(node_id, ns)
        if len(fields) < 3 or not fields[2].strip():
            issues.append(VTIssue(lineno, "missing_content",
                                  f"{kw} {node_id} has no content", id=node_id))
            continue
        content = fields[2].strip()

        existing = nodes_by_id.get(node_id)
        if existing is None:
            node = VTNode(id=node_id, parts=[(kw, content)], line=lineno)
            nodes_by_id[node_id] = node
            parsed.nodes.append(node)
        elif kw in ANNOTATION_TYPES:
            # D1: annotation types append a facet to the existing node
            existing.parts.append((kw, content))
        else:
            issues.append(VTIssue(
                lineno, "duplicate_id",
                f"node id '{node_id}' already defined at line {existing.line} "
                f"(only annotation types {sorted(ANNOTATION_TYPES)} may repeat an id)",
                id=node_id))


def _parse_mem_body(body_lines, parsed: ParsedVT, issues: list[VTIssue]) -> None:
    for lineno, raw in body_lines:
        stripped = raw.strip()
        if not stripped or stripped.startswith("//"):
            continue
        if stripped.startswith("- "):
            content = stripped[2:].strip()
            if not content:
                issues.append(VTIssue(lineno, "missing_content", "empty mem item"))
                continue
            parsed.mem_items.append(MemItem(None, content, lineno))
        elif stripped.startswith("#"):
            fields = stripped.split(None, 1)
            m = TAG_RE.match(fields[0])
            if not m:
                issues.append(VTIssue(lineno, "invalid_mem_line",
                                      f"bad tag {fields[0]!r}", symbol=fields[0]))
                continue
            if len(fields) < 2 or not fields[1].strip():
                issues.append(VTIssue(lineno, "missing_content",
                                      f"tag {fields[0]} has no content"))
                continue
            parsed.mem_items.append(MemItem(m.group(1), fields[1].strip(), lineno))
        else:
            issues.append(VTIssue(lineno, "invalid_mem_line",
                                  f"mem lines must start with '- ' or '#tag ': {stripped!r}"))
