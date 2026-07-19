"""v0.4 — Ingest adapters for the Context Assembly Engine.

Each adapter takes a heterogeneous source (Markdown / JSON / MCP tool schema /
memory system output) and produces a SIRGraph, bypassing the .vt HIR layer.

Adapters:
- ``md_adapter``    : Markdown → SIR（H1/H2/H3 + bullet + bold-bullet + anchor-link）
- ``json_adapter``   : JSON/JSONL → SIR（顶层 key → DEF，嵌套 → DEPENDS 边）
- ``tool_adapter``   : MCP tool schema → SIR（tool.name → DEF，schema → VAR）
- ``memory_adapter`` : 记忆系统输出 → SIR（[{id, content, tags}] 格式）

API contract: every adapter exposes a single ``ingest_*`` function returning SIRGraph.
"""
from .md_adapter import ingest_markdown, ingest_markdown_file
from .memory_adapter import ingest_memory, ingest_memory_from_json
from .tool_adapter import (
    ingest_tool_schema,
    ingest_tool_schemas,
    ingest_tool_schemas_from_json,
)

__all__ = [
    "ingest_markdown",
    "ingest_markdown_file",
    "ingest_memory",
    "ingest_memory_from_json",
    "ingest_tool_schema",
    "ingest_tool_schemas",
    "ingest_tool_schemas_from_json",
]
