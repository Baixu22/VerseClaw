"""Host-facing JSON-RPC 2.0 over stdio for the Verse Token foundation bridge.

Protocol: one JSON object per line on stdin; one JSON response per line on stdout.
Stateful diagnostics methods share one long-lived UnifiedStore. Production
``vt.pack`` requests own an in-memory graph and may complete out of order.

This is intentionally lighter than mcp_server.py — no MCP handshake.
"""

from __future__ import annotations

import json
import sys
import threading
import traceback
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any, Callable, TextIO

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

_PACK_REQUEST_SCHEMA = "VtokenPackRequest/v1"
_PACK_RESULT_SCHEMA = "VtokenPackResult/v1"
_PACK_ESTIMATE_METHOD = "chars_div_4"
_PACK_WORKERS = 4

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


def _pack_candidate_graph(candidate: dict[str, Any]) -> SIRGraph:
    kind = candidate.get("kind")
    if kind == "markdown":
        text = candidate.get("text")
        source_path = candidate.get("source_path")
        if not isinstance(text, str) or not text.strip():
            raise ValueError("markdown candidate text must be a non-empty string")
        if not isinstance(source_path, str) or not source_path.strip():
            raise ValueError(
                "markdown candidate source_path must be a non-empty string"
            )
        return ingest_markdown(text, source_path=source_path)
    if kind == "tool_schema":
        schema = candidate.get("tool_schema")
        server_name = candidate.get("server_name", "host")
        if not isinstance(schema, dict):
            raise ValueError("tool_schema candidate must carry a tool_schema object")
        if not isinstance(server_name, str) or not server_name.strip():
            raise ValueError(
                "tool_schema candidate server_name must be a non-empty string"
            )
        return ingest_tool_schemas([schema], server_name=server_name)
    if kind == "memory":
        entry = candidate.get("entry")
        if not isinstance(entry, dict):
            raise ValueError("memory candidate must carry an entry object")
        return ingest_memory([entry])
    raise ValueError("candidate kind must be markdown|tool_schema|memory")


def _pack_stateless(params: dict[str, Any]) -> dict[str, Any]:
    if params.get("schema") != _PACK_REQUEST_SCHEMA:
        raise ValueError(f"schema must be {_PACK_REQUEST_SCHEMA}")
    if params.get("estimate_method") != _PACK_ESTIMATE_METHOD:
        raise ValueError(f"estimate_method must be {_PACK_ESTIMATE_METHOD}")

    task_hint = params.get("task_hint", "")
    if not isinstance(task_hint, str):
        raise ValueError("task_hint must be a string")
    render_mode = params.get("render_mode", "compact")
    if render_mode not in ("compact", "dense", "verbose"):
        raise ValueError("render_mode must be compact|dense|verbose")
    try:
        allowance_tokens = int(params.get("allowance_tokens"))
    except (TypeError, ValueError) as exc:
        raise ValueError("allowance_tokens must be an integer") from exc
    if allowance_tokens <= 0:
        raise ValueError("allowance_tokens must be greater than zero")

    candidates = params.get("candidates")
    if not isinstance(candidates, list):
        raise ValueError("candidates must be a list")
    candidate_ids: set[str] = set()
    store = UnifiedStore(doc_graph=SIRGraph("doc"), mem_store=None)
    for candidate in candidates:
        if not isinstance(candidate, dict):
            raise ValueError("each candidate must be an object")
        candidate_id = candidate.get("candidate_id")
        if not isinstance(candidate_id, str) or not candidate_id.strip():
            raise ValueError("candidate_id must be a non-empty string")
        if candidate_id in candidate_ids:
            raise ValueError(f"duplicate candidate_id: {candidate_id}")
        candidate_ids.add(candidate_id)
        _merge_graph(store, _pack_candidate_graph(candidate))

    result = store.assemble(
        task_hint,
        allowance_tokens,
        render_mode=str(render_mode),
    )
    return {
        "schema": _PACK_RESULT_SCHEMA,
        "ok": True,
        "prompt": result.prompt,
        "estimated_tokens": int(result.tokens_used),
        "allowance_tokens": allowance_tokens,
        "estimate_method": _PACK_ESTIMATE_METHOD,
        "slot_breakdown": result.slot_breakdown,
        "nodes_included": list(result.nodes_included),
        "nodes_evicted": list(result.nodes_evicted),
        "dedup_count": int(result.dedup_count),
        "candidate_count": len(candidate_ids),
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

    if method == "vt.pack":
        return _pack_stateless(p)

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
        budget = (
            p.get("budget_tokens")
            if "budget_tokens" in p
            else p.get("budgetTokens", 32000)
        )
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


def serve(
    input_stream: TextIO,
    output_stream: TextIO,
    *,
    handler: Callable[[Any], dict[str, Any]] = handle_request,
    pack_workers: int = _PACK_WORKERS,
) -> None:
    """Serve JSON-RPC lines; stateless pack requests run independently."""
    write_lock = threading.Lock()

    def emit(response: dict[str, Any]) -> None:
        with write_lock:
            output_stream.write(json.dumps(response, ensure_ascii=False) + "\n")
            output_stream.flush()

    def emit_future(future: Future[dict[str, Any]], request_id: Any) -> None:
        try:
            emit(future.result())
        except Exception as exc:  # noqa: BLE001
            emit(_err(request_id, _INTERNAL_ERROR, str(exc) or type(exc).__name__))

    with ThreadPoolExecutor(max_workers=max(1, pack_workers)) as executor:
        for raw in input_stream:
            line = raw.strip()
            if not line:
                continue
            try:
                req = json.loads(line)
            except json.JSONDecodeError as exc:
                emit(_err(None, _INVALID_REQUEST, f"invalid JSON: {exc}"))
                continue
            if isinstance(req, dict) and req.get("method") == "vt.pack":
                future = executor.submit(handler, req)
                future.add_done_callback(
                    lambda done, request_id=req.get("id"): emit_future(done, request_id)
                )
                continue
            emit(handler(req))


def main() -> int:
    # Line-buffered stdout for timely host reads.
    try:
        sys.stdout.reconfigure(line_buffering=True)  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        pass

    serve(sys.stdin, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
