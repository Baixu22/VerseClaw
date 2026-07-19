"""Schema system (spec §7): built-in ``core`` plus ``.vtschema`` extension files."""
from __future__ import annotations

import os
import re
from dataclasses import dataclass

from .errors import VTIssue, VTParseError

# spec §3.2 — node type symbols. REF is structural (edge introducer), not a node type.
NODE_TYPES_CORE = {
    "DEF": "definition",
    "DESC": "description",
    "RULE": "constraint",
    "EX": "example",
    "OPEN": "open question",
    "VAR": "variable / parameter",
    "SRC": "external source",
    "META": "metadata",
}

# D1: annotation types may repeat an already-defined id (appended as extra parts).
ANNOTATION_TYPES = {"DESC", "EX", "META", "SRC"}

# spec §3.2 — built-in relation types
RELATIONS_CORE = {
    "DEPENDS": "dependency",
    "BLOCKS": "blocking",
    "IMPLEMENTS": "implementation",
    "EXTENDS": "extension",
    "CONFLICTS": "conflict",
    "ENFORCED-BY": "enforced by",
    "SEE": "reference without hard dependency",
}

# symbols that custom schemas may never claim
RESERVED_SYMBOLS = {"REF", "//"}

REL_DECL_RE = re.compile(r"^--([A-Z][A-Z0-9_-]*)-->$")
TYPE_SYMBOL_RE = re.compile(r"^[A-Z][A-Z0-9_]*$")


@dataclass
class Schema:
    name: str
    types: dict
    relations: dict

    def is_node_type(self, t: str) -> bool:
        return t in self.types

    def is_relation(self, r: str) -> bool:
        return r in self.relations


CORE = Schema("core", dict(NODE_TYPES_CORE), dict(RELATIONS_CORE))


def load_schema(name: str, search_dir: str | None) -> Schema:
    """Resolve a schema by name. ``core`` is built in; anything else loads
    ``<name>.vtschema`` from ``search_dir`` (D18: same directory as the .vt file)."""
    if name == "core":
        return CORE
    path = os.path.join(search_dir or ".", name + ".vtschema")
    if not os.path.exists(path):
        raise VTParseError(path, [VTIssue(0, "schema_not_found",
                                          f"schema '{name}' not found (expected {path})")])
    schema = parse_vtschema(path)
    if schema.name != name:
        raise VTParseError(path, [VTIssue(1, "schema_name_mismatch",
                                          f"file declares schema '{schema.name}' but '%schema {name}' was requested")])
    return schema


def parse_vtschema(path: str) -> Schema:
    issues: list[VTIssue] = []
    types = dict(NODE_TYPES_CORE)
    relations = dict(RELATIONS_CORE)
    name: str | None = None

    with open(path, encoding="utf-8-sig") as f:
        lines = f.read().splitlines()

    for lineno, raw in enumerate(lines, 1):
        line = raw.strip()
        if not line or line.startswith("//"):
            continue
        if line.startswith("%schema"):
            m = re.match(r"^%schema\s+(\S+)\s+extends\s+(\S+)$", line)
            if not m:
                issues.append(VTIssue(lineno, "invalid_schema_header",
                                      "expected '%schema <name> extends core'"))
                continue
            name = m.group(1)
            if m.group(2) != "core":
                issues.append(VTIssue(lineno, "unsupported_parent",
                                      "only 'extends core' is supported in Phase 1"))
            continue
        fields = line.split(None, 2)
        if fields[0] == "type" and len(fields) >= 2:
            t = fields[1]
            if t in NODE_TYPES_CORE or t in RESERVED_SYMBOLS:
                issues.append(VTIssue(lineno, "redefined_symbol",
                                      f"type '{t}' is already defined by the parent schema (spec §7.2)",
                                      symbol=t))
                continue
            if not TYPE_SYMBOL_RE.match(t):
                issues.append(VTIssue(lineno, "invalid_type_symbol",
                                      f"type symbol '{t}' must be UPPERCASE [A-Z][A-Z0-9_]*", symbol=t))
                continue
            types[t] = fields[2] if len(fields) > 2 else ""
        elif fields[0] == "relation" and len(fields) >= 2:
            m = REL_DECL_RE.match(fields[1])
            if not m:
                issues.append(VTIssue(lineno, "invalid_relation_symbol",
                                      f"'{fields[1]}' must look like --NAME-->", symbol=fields[1]))
                continue
            r = m.group(1)
            if r in RELATIONS_CORE:
                issues.append(VTIssue(lineno, "redefined_symbol",
                                      f"relation '{r}' is already defined by the parent schema (spec §7.2)",
                                      symbol=r))
                continue
            relations[r] = fields[2] if len(fields) > 2 else ""
        else:
            issues.append(VTIssue(lineno, "invalid_schema_line",
                                  f"unrecognized schema line: {line!r}"))

    if name is None:
        issues.append(VTIssue(1, "missing_schema_header",
                              "first declaration must be '%schema <name> extends core'"))
    if issues:
        raise VTParseError(path, issues)
    return Schema(name, types, relations)
