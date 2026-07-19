"""Core data model shared by HIR (parse results) and SIR (in-memory graph).

Deviation from spec §4.1 (recorded in DECISIONS.md):
- A node holds ``parts: list[(type, content)]`` instead of a single ``content``,
  because annotation types (DESC/EX/META/SRC) may repeat an existing id (D1).
- Adjacency lives on the graph (out/in dicts), not on the node; ``created_at``
  is None for doc nodes so that compilation stays byte-idempotent (D2).
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class VTNode:
    id: str
    # list of (type_symbol | None, content); parts[0] is the defining line
    parts: list = field(default_factory=list)
    line: int = 0                     # first defining line in the source .vt (doc mode)
    created_at: int | None = None     # unix ms; mem mode only (doc: None, keeps compile idempotent)
    source_file: str | None = None    # injected at load time, never serialized into .vtg
    # v0.4 — Context Assembly Engine fields (D31, optional, defaults keep .vtg compat)
    slot: str | None = None           # "system" | "tools" | "knowledge" | "working" | None
    priority: int = 5                 # 1=highest, 10=lowest; merge() prefers lower number
    source_files: list = field(default_factory=list)  # 多源 ingest 追加列表（merge 时累积）

    @property
    def type(self) -> str | None:
        return self.parts[0][0] if self.parts else None

    @property
    def content(self) -> str:
        return self.parts[0][1] if self.parts else ""


@dataclass
class VTEdge:
    src: str
    dst: str
    rel: str | None = None            # None == untyped relation (``~~`` / all mem edges)
    line: int = 0


@dataclass
class Header:
    vt_version: str = ""
    mode: str = ""
    doc_id: str | None = None         # %id  (required for doc)
    session: str | None = None        # %session (required for mem)
    lang: str = "en"
    schema: str = "core"
    ns: str | None = None             # %ns — v0.3.2 proposal (D19), opt-in namespace elision


@dataclass
class MemItem:
    tag: str | None
    content: str
    line: int


@dataclass
class ParsedVT:
    header: Header
    nodes: list = field(default_factory=list)      # doc mode, file order
    edges: list = field(default_factory=list)      # doc mode, file order
    mem_items: list = field(default_factory=list)  # mem mode, file order
    filename: str = "<memory>"
