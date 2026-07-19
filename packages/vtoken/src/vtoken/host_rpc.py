"""Host-facing JSON-RPC 2.0 over stdio for the Verse Token foundation bridge.

Protocol: one JSON object per line on stdin; one JSON response per line on stdout.
Process holds a single long-lived UnifiedStore (P0). Methods are serial.

This is intentionally lighter than mcp_server.py — no MCP handshake.
"""
from __future__ import annotations

import json
import sys
import traceback
from typing import Any

from . import __version__
from .errors import VTError, VTStoreError
from .graph import SIRGraph
from .ingest import ingest_markdown, ingest_memory, ingest_tool_schemas
from .store import UnifiedStore

# JSON-RPC application error (business / store state)
_APP_ERROR = -32000
_INVALID_REQUEST = -32600
_METHOD_NOT_FOUND = -32601
_INVALID_PARAMS = -32602
_INTERNAL_ERROR = -32603

_store: UnifiedStore | None = None
_opened = False


def _ok(id_: Any, result: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": id_, "result": result}


def _err(id_: Any, code: int, message: str, data: Any = None) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        error["data"] = data
    return {"jsonrpc": "2.0", "id": id_, "error": error}


def _require_store() -> UnifiedStore:
    if _store is None or not _opened:
        raise VTStoreError("store not open; call vt.open first")
    return _store


def _merge_graph(store: UnifiedStore, graph: SIRGraph) -> int:
    before = len(store.doc.nodes) if store.doc is not None else 0
    if store.doc is None:
        store.doc = graph
    else:
        store.doc.merge(graph)
    after = len(store.doc.nodes) if store.doc is not None else 0
    return after - before


def _serialize_assemble(result: Any) -> dict[str, Any]:
    return {
        "prompt": result.prompt,
        "tokens_used": int(result.tokens_used),
        "tokens_budget": int(result.tokens_budget),
        "slot_breakdown": result.slot_breakdown,
        "nodes_included": list(result.nodes_included),
        "nodes_evicted": list(result.nodes_evicted),
        "dedup_count": int(result.dedup_count),
    }


def dispatch(method: str, params: dict[str, Any] | None) -> Any:
    """Dispatch one RPC method. Raises VTError / ValueError / TypeError on failure."""
    global _store, _opened
    p = params if isinstance(params, dict) else {}

    if method == "vt.ping":
        return {
            "ok": True,
            "version": __version__,
            "opened": bool(_opened and _store is not None),
        }

    if method == "vt.open":
        # Close previous store cleanly if re-opening.
        if _store is not None:
            try:
                _store.close()
            except Exception:  # noqa: BLE001 — best-effort close
                pass
            _store = None
            _opened = False

        doc_sources = p.get("doc_sources") or p.get("docSources") or []
        if doc_sources is not None and not isinstance(doc_sources, list):
            raise ValueError("doc_sources must be a list of paths")
        session_dir = p.get("session_dir") or p.get("sessionDir")
        session = p.get("session")
        if session_dir is not None and not isinstance(session_dir, str):
            raise ValueError("session_dir must be a string")
        if session is not None and not isinstance(session, str):
            raise ValueError("session must be a string")

        sources = [str(s) for s in (doc_sources or []) if s]
        _store = UnifiedStore.open(
            doc_sources=sources or None,
            session_dir=session_dir if session_dir else None,
            session=session if session else None,
        )
        # Ensure a doc graph exists so pure-memory ingest paths work without
        # requiring .vt/.vtg doc_sources at open time.
        if _store.doc is None:
            _store.doc = SIRGraph("doc")
        _opened = True
        return {
            "ok": True,
            "doc_sources": sources,
            "session": session if session_dir and session else None,
            "stats": _store.stats(),
        }

    if method == "vt.ingest_path":
        store = _require_store()
        path = p.get("path")
        if not path or not isinstance(path, str):
            raise ValueError("path is required")
        source_type = p.get("source_type") or p.get("sourceType") or "auto"
        added = store.ingest(path, source_type=str(source_type))
        return {"ok": True, "nodes_added": int(added), "stats": store.stats()}

    if method == "vt.ingest_markdown":
        store = _require_store()
        text = p.get("text") or p.get("markdown") or p.get("md_text")
        if text is None or not isinstance(text, str):
            raise ValueError("text is required")
        source_path = p.get("source_path") or p.get("sourcePath") or "inline.md"
        graph = ingest_markdown(text, source_path=str(source_path))
        added = _merge_graph(store, graph)
        return {"ok": True, "nodes_added": int(added), "stats": store.stats()}

    if method == "vt.ingest_tools":
        store = _require_store()
        schemas = p.get("schemas") or p.get("tools")
        if not isinstance(schemas, list):
            raise ValueError("schemas must be a list of tool schema dicts")
        server_name = p.get("server_name") or p.get("serverName") or "default"
        graph = ingest_tool_schemas(schemas, server_name=str(server_name))
        added = _merge_graph(store, graph)
        return {"ok": True, "nodes_added": int(added), "stats": store.stats()}

    if method == "vt.ingest_memory":
        store = _require_store()
        entries = p.get("entries")
        if not isinstance(entries, list):
            raise ValueError("entries must be a list of {id, content, tags?} dicts")
        graph = ingest_memory(entries)
        added = _merge_graph(store, graph)
        return {"ok": True, "nodes_added": int(added), "stats": store.stats()}

    if method == "vt.assemble":
        store = _require_store()
        task_hint = p.get("task_hint") or p.get("taskHint") or ""
        if not isinstance(task_hint, str):
            raise ValueError("task_hint must be a string")
        budget = p.get("budget_tokens") if "budget_tokens" in p else p.get("budgetTokens", 32000)
        try:
            budget_tokens = int(budget)
        except (TypeError, ValueError) as exc:
            raise ValueError("budget_tokens must be an integer") from exc
        render_mode = p.get("render_mode") or p.get("renderMode") or "compact"
        if render_mode not in ("compact", "dense", "verbose"):
            raise ValueError("render_mode must be compact|dense|verbose")
        slots = p.get("slots")
        result = store.assemble(
            task_hint,
            budget_tokens,
            slots=slots if isinstance(slots, dict) else None,
            render_mode=str(render_mode),
        )
        return {"ok": True, "result": _serialize_assemble(result)}

    if method == "vt.stats":
        store = _require_store()
        return {"ok": True, "stats": store.stats()}

    if method == "vt.close":
        if _store is not None:
            try:
                _store.close()
            except Exception:  # noqa: BLE001
                pass
        _store = None
        _opened = False
        return {"ok": True}

    raise KeyError(method)


def handle_request(req: Any) -> dict[str, Any]:
    """Handle one JSON-RPC request object; always returns a response dict."""
    if not isinstance(req, dict):
        return _err(None, _INVALID_REQUEST, "request must be a JSON object")

    req_id = req.get("id")
    method = req.get("method")
    params = req.get("params")

    if not isinstance(method, str) or not method:
        return _err(req_id, _INVALID_REQUEST, "method is required")

    try:
        result = dispatch(method, params if isinstance(params, dict) else {})
        return _ok(req_id, result)
    except KeyError:
        return _err(req_id, _METHOD_NOT_FOUND, f"unknown method: {method}")
    except (ValueError, TypeError) as exc:
        return _err(req_id, _INVALID_PARAMS, str(exc))
    except VTError as exc:
        return _err(req_id, _APP_ERROR, str(exc), data={"type": type(exc).__name__})
    except Exception as exc:  # noqa: BLE001 — surface worker failures to host
        return _err(
            req_id,
            _INTERNAL_ERROR,
            str(exc) or type(exc).__name__,
            data={"traceback": traceback.format_exc()},
        )


def reset_for_tests() -> None:
    """Test helper: drop in-process store state."""
    global _store, _opened
    if _store is not None:
        try:
            _store.close()
        except Exception:  # noqa: BLE001
            pass
    _store = None
    _opened = False


def main() -> int:
    # Line-buffered stdout for timely host reads.
    try:
        sys.stdout.reconfigure(line_buffering=True)  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        pass

    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as exc:
            resp = _err(None, _INVALID_REQUEST, f"invalid JSON: {exc}")
        else:
            resp = handle_request(req)
        sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
