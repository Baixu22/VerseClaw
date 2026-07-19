"""P1.2 — %mode doc compiler: .vt -> .vtg (spec §8).

Guarantees:
- idempotent: identical .vt content -> byte-identical .vtg (no timestamps,
  no absolute paths in the payload — ruling D2);
- atomic: write ``<out>.new`` then ``os.replace`` (D7: os.rename is not an
  atomic overwrite on Windows);
- on any error: JSON report via VTParseError, no output file touched.
"""
from __future__ import annotations

import json
import os

from .errors import VTIssue, VTParseError
from .model import ParsedVT
from .parser import parse_vt_file

VTG_FORMAT_VERSION = 1


def build_vtg_payload(parsed: ParsedVT) -> dict:
    h = parsed.header
    return {
        "vtg": VTG_FORMAT_VERSION,
        "vt_version": h.vt_version,
        "mode": "doc",
        "doc_id": h.doc_id,
        "lang": h.lang,
        "schema": h.schema,
        "nodes": [
            {
                "id": n.id,
                "line": n.line,
                "parts": [[t, c] for (t, c) in n.parts],
                # v0.4 — D31 可选字段；保持 .vtg 向后兼容（旧 reader 忽略未知字段）
                "slot": n.slot,
                "priority": n.priority,
            }
            for n in parsed.nodes
        ],
        "edges": [
            {"src": e.src, "rel": e.rel, "dst": e.dst, "line": e.line}
            for e in parsed.edges
        ],
    }


def serialize_vtg(payload: dict) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def atomic_write(path: str, data: bytes) -> None:
    tmp = path + ".new"
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def compile_file(vt_path: str, out_path: str | None = None):
    """Compile one doc-mode .vt file. Returns (out_path, ParsedVT)."""
    parsed = parse_vt_file(vt_path)
    if parsed.header.mode == "mem":
        # D6 + spec §10.3: mem files are runtime import/export data, never compiled
        raise VTParseError(vt_path, [VTIssue(
            1, "mem_not_compilable",
            "%mode mem files are not compiled; use MemStore.write()/import_vt() (spec §10.3)")])
    payload = build_vtg_payload(parsed)
    out = out_path or (os.path.splitext(vt_path)[0] + ".vtg")
    atomic_write(out, serialize_vtg(payload))
    return out, parsed


def check_file(vt_path: str, strict: bool = False) -> dict:
    """spec §8.2 — validate without compiling. Dangling refs are warnings,
    or errors under --strict (D12)."""
    try:
        parsed = parse_vt_file(vt_path)
    except VTParseError as e:
        return e.report()

    warnings: list[dict] = []
    if parsed.header.mode == "doc":
        ids = {n.id for n in parsed.nodes}
        for e in parsed.edges:
            for role, v in (("source", e.src), ("target", e.dst)):
                if v not in ids:
                    warnings.append(VTIssue(
                        e.line, "dangling_ref",
                        f"REF {role} '{v}' is not defined in this file", id=v).to_dict())

    if strict and warnings:
        return {"status": "error", "file": vt_path, "errors": warnings}
    return {"status": "ok", "file": vt_path, "warnings": warnings}
