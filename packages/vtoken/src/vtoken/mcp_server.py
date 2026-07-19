"""T5.4 — MCP (Model Context Protocol) server exposing vt.write / vt.resolve
/ vt.search as MCP tools, over stdio JSON-RPC 2.0.

0 third-party dependencies — implements the minimal subset of MCP spec needed
to expose vt tools to any MCP-compatible client (Claude Desktop, etc.):

- JSON-RPC 2.0 over newline-delimited stdio
- methods: initialize / tools/list / tools/call / shutdown
- tools: vt_write / vt_resolve / vt_search / vt_stats / vt_toc

Configuration via env vars (optional):
- VT_MCP_SESSION_DIR / VT_MCP_SESSION — where to create the mem session
  (defaults to a tmp dir + "mcp_default")
- VT_MCP_DOC_SOURCES — comma-separated .vt/.vtg paths for hot-reloadable doc
  graph (T5.1); if unset, store has only the mem session.

Run:
    vt mcp                  # stdio JSON-RPC loop
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import traceback

from .errors import VTError, VTResolveError, VTStoreError
from .memstore import MemStore
from .store import UnifiedStore


# ---------------------------------------------------------------------------
# Tool definitions (MCP-shaped)
# ---------------------------------------------------------------------------

TOOLS = [
    {
        "name": "vt_write",
        "description": "Write a new memory node to the active vt session. "
                       "Returns the auto-assigned node id (e.g. '#001').",
        "inputSchema": {
            "type": "object",
            "properties": {
                "content": {"type": "string", "description": "node content text"},
                "type": {"type": "string", "description": "optional type symbol (DEF/RULE/VAR/OPEN/...)"},
                "tag": {"type": "string", "description": "optional tag (alt for type)"},
                "edges": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "optional list of dst node ids to link from this new node",
                },
            },
            "required": ["content"],
        },
    },
    {
        "name": "vt_resolve",
        "description": "Resolve a node id to a TIR (Token-IR) string by BFS over the "
                       "merged doc + mem graph. Returns the TIR text.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "node_id": {"type": "string", "description": "root node id to resolve"},
                "depth": {"type": "integer", "default": 2, "minimum": 0},
                "type_filter": {
                    "type": "array", "items": {"type": "string"},
                    "description": "only emit parts of these types (root exempt)",
                },
                "max_nodes": {"type": "integer", "minimum": 1},
                "max_facets": {"type": "integer", "minimum": 1},
                "include_edges": {"type": "boolean", "default": False},
            },
            "required": ["node_id"],
        },
    },
    {
        "name": "vt_search",
        "description": "Semantic-ish search over doc + mem graph (T5.5: offline TF-IDF). "
                       "Returns top_k matching node ids with scores.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "top_k": {"type": "integer", "default": 10, "minimum": 1},
            },
            "required": ["query"],
        },
    },
    {
        "name": "vt_stats",
        "description": "Return graph statistics (node/edge counts, parts by type).",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "vt_toc",
        "description": "Return the table of contents: TIR of every DEF facet in the doc graph.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "vt_assemble",
        "description": "v0.4 — assemble a token-budgeted prompt from doc + mem graphs. "
                       "Returns the final prompt text + audit info (tokens used, slot breakdown, "
                       "included/evicted nodes, dedup count).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "task_hint": {"type": "string", "description": "current task description for BFS starting points"},
                "budget_tokens": {"type": "integer", "default": 32000, "minimum": 100},
            },
            "required": ["task_hint"],
        },
    },
    {
        "name": "vt_ingest",
        "description": "v0.4 — ingest a heterogeneous source (.md / .json) into the doc graph. "
                       "Auto-detects source type from file extension. Adds nodes + edges to the live graph.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "source": {"type": "string", "description": "path to source file (.md or .json)"},
                "source_type": {"type": "string", "enum": ["auto", "md", "json"], "default": "auto"},
            },
            "required": ["source"],
        },
    },
]


# ---------------------------------------------------------------------------
# Tool dispatch
# ---------------------------------------------------------------------------

class _ToolError(Exception):
    def __init__(self, code: int, message: str, data=None):
        self.code = code
        self.message = message
        self.data = data


def _dispatch_tool(store: UnifiedStore, name: str, args: dict) -> dict:
    if name == "vt_write":
        node_id = store.write(
            content=args["content"],
            type=args.get("type"),
            edges=args.get("edges"),
            tag=args.get("tag"),
        )
        return {"id": node_id}

    if name == "vt_resolve":
        try:
            tir = store.resolve(
                args["node_id"],
                depth=args.get("depth", 2),
                type_filter=args.get("type_filter"),
                max_nodes=args.get("max_nodes"),
                max_facets=args.get("max_facets"),
                include_edges=args.get("include_edges", False),
            )
        except VTResolveError as e:
            raise _ToolError(-32602, f"resolve failed: {e}") from e
        return {"tir": tir}

    if name == "vt_search":
        try:
            results = store.search(args["query"], top_k=args.get("top_k", 10))
        except NotImplementedError as e:
            raise _ToolError(-32601, f"search not available: {e}") from e
        return {"results": results}

    if name == "vt_stats":
        return store.stats()

    if name == "vt_toc":
        return {"toc": store.toc()}

    if name == "vt_assemble":
        result = store.assemble(
            task_hint=args["task_hint"],
            budget_tokens=args.get("budget_tokens", 32000),
        )
        # 序列化 AssembleResult dataclass
        return {
            "prompt": result.prompt,
            "tokens_used": result.tokens_used,
            "tokens_budget": result.tokens_budget,
            "slot_breakdown": result.slot_breakdown,
            "nodes_included": result.nodes_included,
            "nodes_evicted": result.nodes_evicted,
            "dedup_count": result.dedup_count,
        }

    if name == "vt_ingest":
        added = store.ingest(
            source=args["source"],
            source_type=args.get("source_type", "auto"),
        )
        return {"added_nodes": added}

    raise _ToolError(-32601, f"unknown tool: {name}")


# ---------------------------------------------------------------------------
# Store factory
# ---------------------------------------------------------------------------

def _build_store() -> UnifiedStore:
    """Construct a UnifiedStore from env vars (with sensible defaults)."""
    session_dir = os.environ.get("VT_MCP_SESSION_DIR") or tempfile.mkdtemp(prefix="vt_mcp_")
    session = os.environ.get("VT_MCP_SESSION") or "mcp_default"
    doc_sources_env = os.environ.get("VT_MCP_DOC_SOURCES", "").strip()
    doc_sources = [p.strip() for p in doc_sources_env.split(",") if p.strip()] if doc_sources_env else None

    if doc_sources:
        return UnifiedStore.open(doc_sources=doc_sources,
                                 session_dir=session_dir, session=session,
                                 durability="fsync", checkpoint_every=0)
    return UnifiedStore.open(session_dir=session_dir, session=session,
                             durability="fsync", checkpoint_every=0)


# ---------------------------------------------------------------------------
# JSON-RPC 2.0 over stdio
# ---------------------------------------------------------------------------

PROTOCOL_VERSION = "2024-11-05"
SERVER_INFO = {"name": "vt-mcp", "version": "0.3.1"}


def _send(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _make_response(req_id: object, result: object = None, error: dict | None = None) -> dict:
    resp = {"jsonrpc": "2.0", "id": req_id}
    if error is not None:
        resp["error"] = error
    else:
        resp["result"] = result
    return resp


def _handle_request(req: dict, store: UnifiedStore) -> dict | None:
    """Returns a response dict, or None if the request is a notification (no id)."""
    method = req.get("method")
    req_id = req.get("id")
    params = req.get("params") or {}

    # notifications (no id) — we don't act on any, just return None
    is_notification = "id" not in req

    try:
        if method == "initialize":
            result = {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {}},
                "serverInfo": SERVER_INFO,
            }
            return None if is_notification else _make_response(req_id, result)

        if method == "initialized" or method == "notifications/initialized":
            return None  # ack notification, no response

        if method == "tools/list":
            return None if is_notification else _make_response(req_id, {"tools": TOOLS})

        if method == "tools/call":
            name = params.get("name")
            args = params.get("arguments") or {}
            if not name:
                raise _ToolError(-32602, "missing 'name' in tools/call params")
            try:
                result = _dispatch_tool(store, name, args)
            except _ToolError:
                raise
            except (VTStoreError, VTError) as e:
                raise _ToolError(-32603, f"vt tool error: {e}")
            # MCP expects content blocks; we return JSON as a text block
            return None if is_notification else _make_response(req_id, {
                "content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}],
                "isError": False,
            })

        if method == "shutdown":
            return None if is_notification else _make_response(req_id, {})

        if method == "ping":
            return None if is_notification else _make_response(req_id, {})

        # Unknown method
        return None if is_notification else _make_response(req_id, error={
            "code": -32601,
            "message": f"method not found: {method}",
        })

    except _ToolError as e:
        return None if is_notification else _make_response(req_id, error={
            "code": e.code, "message": e.message, "data": e.data,
        })
    except Exception as e:  # noqa: BLE001
        return None if is_notification else _make_response(req_id, error={
            "code": -32603,
            "message": f"internal error: {e}",
            "data": {"traceback": traceback.format_exc()},
        })


def run_stdio() -> int:
    """Main stdio loop. Returns exit code (0 on clean shutdown)."""
    store = _build_store()
    try:
        for raw in sys.stdin:
            line = raw.strip()
            if not line:
                continue
            try:
                req = json.loads(line)
            except json.JSONDecodeError as e:
                _send(_make_response(None, error={
                    "code": -32700, "message": f"parse error: {e}",
                }))
                continue
            resp = _handle_request(req, store)
            if resp is not None:
                _send(resp)
                # shutdown method: break after sending response
                if req.get("method") == "shutdown":
                    break
    except KeyboardInterrupt:
        pass
    finally:
        store.close()
    return 0
