"""Verse Token v0.4.3 — Phase 1 implementation.

HIR: parse_vt / parse_vt_file          (.vt text -> ParsedVT)
SIR: compile_file / load_vtg / SIRGraph (doc) + MemStore (mem)
TIR: resolve_tir / UnifiedStore.resolve
"""
from .compiler import build_vtg_payload, check_file, compile_file, serialize_vtg
from .errors import VTError, VTIssue, VTParseError, VTResolveError, VTStoreError
from .graph import SIRGraph, merge_doc_graphs, resolve_tir
from .memstore import MemStore
from .model import Header, MemItem, ParsedVT, VTEdge, VTNode
from .parser import parse_vt, parse_vt_file
from .renderer import render_doc_to_markdown, render_file, render_mem_to_markdown
from .store import UnifiedStore, load_doc_graphs, load_vtg

__version__ = "0.4.3"

__all__ = [
    "parse_vt", "parse_vt_file", "compile_file", "check_file",
    "build_vtg_payload", "serialize_vtg",
    "SIRGraph", "resolve_tir", "merge_doc_graphs",
    "MemStore", "UnifiedStore", "load_vtg", "load_doc_graphs",
    "VTNode", "VTEdge", "Header", "MemItem", "ParsedVT",
    "VTError", "VTIssue", "VTParseError", "VTResolveError", "VTStoreError",
    "render_doc_to_markdown", "render_mem_to_markdown", "render_file",
    "__version__",
]