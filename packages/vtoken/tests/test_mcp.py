"""T5.4 MCP server 测试 — JSON-RPC 2.0 over stdio, vt.* tools."""
from __future__ import annotations

import io
import json
import os
import sys

import pytest

from vtoken import mcp_server


def _call(method: str, params: dict | None = None, req_id: int = 1) -> dict:
    """Single in-process JSON-RPC call. Captures stdout."""
    req = {"jsonrpc": "2.0", "id": req_id, "method": method}
    if params is not None:
        req["params"] = params
    return req


def _run_session(requests: list[dict], env_overrides: dict | None = None) -> list[dict]:
    """Run a sequence of JSON-RPC requests against a fresh MCP server.

    Uses real stdin/stdout redirection. Returns the parsed responses.
    """
    # Configure environment
    old_env = dict(os.environ)
    if env_overrides:
        for k, v in env_overrides.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
    # Always use a fresh tmp session dir to avoid lockfile conflicts
    import tempfile
    tmp = tempfile.mkdtemp(prefix="vt_mcp_test_")
    os.environ["VT_MCP_SESSION_DIR"] = tmp
    os.environ["VT_MCP_SESSION"] = "test"
    os.environ.pop("VT_MCP_DOC_SOURCES", None)

    # Prepare stdin with all requests as newline-delimited JSON
    stdin_data = "\n".join(json.dumps(r) for r in requests) + "\n"
    old_stdin, old_stdout = sys.stdin, sys.stdout
    sys.stdin = io.StringIO(stdin_data)
    sys.stdout = io.StringIO()
    try:
        rc = mcp_server.run_stdio()
    finally:
        out = sys.stdout.getvalue()
        sys.stdin, sys.stdout = old_stdin, old_stdout
        # restore env
        os.environ.clear()
        os.environ.update(old_env)
    responses = []
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            responses.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    return responses


class TestMcpProtocol:
    def test_initialize_returns_protocol_version(self):
        responses = _run_session([_call("initialize")])
        assert len(responses) == 1
        r = responses[0]
        assert r["jsonrpc"] == "2.0"
        assert r["id"] == 1
        assert "result" in r
        assert "protocolVersion" in r["result"]
        assert "capabilities" in r["result"]
        assert "tools" in r["result"]["capabilities"]
        assert "serverInfo" in r["result"]

    def test_tools_list_returns_vt_tools(self):
        responses = _run_session([_call("tools/list")])
        assert len(responses) == 1
        tools = responses[0]["result"]["tools"]
        names = {t["name"] for t in tools}
        assert "vt_write" in names
        assert "vt_resolve" in names
        assert "vt_stats" in names
        assert "vt_toc" in names
        assert "vt_search" in names

    def test_unknown_method_returns_error(self):
        responses = _run_session([_call("nonexistent_method")])
        assert len(responses) == 1
        r = responses[0]
        assert "error" in r
        assert r["error"]["code"] == -32601

    def test_malformed_json_returns_parse_error(self):
        # Run with bad JSON on stdin — should respond with parse error and continue
        import tempfile
        os.environ["VT_MCP_SESSION_DIR"] = tempfile.mkdtemp(prefix="vt_mcp_bad_")
        os.environ["VT_MCP_SESSION"] = "bad"
        os.environ.pop("VT_MCP_DOC_SOURCES", None)
        old_stdin, old_stdout = sys.stdin, sys.stdout
        sys.stdin = io.StringIO("{not valid json\n")
        sys.stdout = io.StringIO()
        try:
            mcp_server.run_stdio()
        finally:
            out = sys.stdout.getvalue()
            sys.stdin, sys.stdout = old_stdin, old_stdout
        # parse error response is sent
        assert "-32700" in out or "parse error" in out.lower()


class TestMcpVtTools:
    """vt_write → vt_resolve round-trip via MCP."""

    def test_write_returns_node_id(self):
        responses = _run_session([
            _call("tools/call", {"name": "vt_write",
                  "arguments": {"content": "hello world", "tag": "note"}}),
        ])
        assert len(responses) == 1
        r = responses[0]
        assert "result" in r
        content_text = r["result"]["content"][0]["text"]
        payload = json.loads(content_text)
        assert payload["id"].startswith("#")

    def test_write_then_resolve(self):
        # write a node, then resolve it
        responses = _run_session([
            _call("tools/call", {"name": "vt_write",
                  "arguments": {"content": "MCP test fact"}}),
            _call("tools/call", {"name": "vt_resolve",
                  "arguments": {"node_id": "#001", "depth": 0}}),
        ])
        assert len(responses) == 2
        # first: write returns #001 (D14: zero-padded 3-digit id)
        write_payload = json.loads(responses[0]["result"]["content"][0]["text"])
        assert write_payload["id"] == "#001"
        # second: resolve returns TIR containing the content
        resolve_payload = json.loads(responses[1]["result"]["content"][0]["text"])
        assert "MCP test fact" in resolve_payload["tir"]

    def test_resolve_unknown_node_returns_error(self):
        responses = _run_session([
            _call("tools/call", {"name": "vt_resolve",
                  "arguments": {"node_id": "does.not.exist"}}),
        ])
        assert len(responses) == 1
        r = responses[0]
        # tool error → returned as error in result (MCP "isError": true) or as JSON-RPC error
        # our implementation uses _ToolError → JSON-RPC error
        assert "error" in r
        assert "resolve failed" in r["error"]["message"]

    def test_stats_returns_counts(self):
        responses = _run_session([
            _call("tools/call", {"name": "vt_write",
                  "arguments": {"content": "x", "tag": "note"}}),
            _call("tools/call", {"name": "vt_stats"}),
        ])
        stats = json.loads(responses[1]["result"]["content"][0]["text"])
        assert stats["mem_nodes"] >= 1
        assert "parts_by_type" in stats

    def test_unknown_tool_returns_method_error(self):
        responses = _run_session([
            _call("tools/call", {"name": "vt_nonexistent"}),
        ])
        assert "error" in responses[0]
        assert responses[0]["error"]["code"] == -32601


class TestMcpToolSchemas:
    def test_vt_write_schema_requires_content(self):
        for tool in mcp_server.TOOLS:
            if tool["name"] == "vt_write":
                assert "content" in tool["inputSchema"]["required"]
                return
        pytest.fail("vt_write tool not found")

    def test_vt_resolve_schema_requires_node_id(self):
        for tool in mcp_server.TOOLS:
            if tool["name"] == "vt_resolve":
                assert "node_id" in tool["inputSchema"]["required"]
                return
        pytest.fail("vt_resolve tool not found")
