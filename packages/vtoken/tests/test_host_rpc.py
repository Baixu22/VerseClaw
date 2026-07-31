"""RPC contract tests for vtoken.host_rpc (in-process dispatch)."""

from __future__ import annotations

import json
import threading
from io import StringIO

import pytest

from vtoken import host_rpc
from vtoken.host_rpc import dispatch, handle_request, reset_for_tests


@pytest.fixture(autouse=True)
def _reset_store():
    reset_for_tests()
    yield
    reset_for_tests()


def test_ping_before_open():
    result = dispatch("vt.ping", {})
    assert result["ok"] is True
    assert result["opened"] is False
    assert "version" in result


def _pack_request(candidate_id: str, text: str) -> dict:
    return {
        "schema": "VtokenPackRequest/v1",
        "task_hint": "auth",
        "allowance_tokens": 600,
        "estimate_method": "chars_div_4",
        "render_mode": "compact",
        "candidates": [
            {
                "candidate_id": candidate_id,
                "kind": "markdown",
                "source_path": "AGENTS.md",
                "text": text,
            }
        ],
    }


def test_stateless_pack_has_honest_estimate_and_no_store_side_effect(
    tmp_path, monkeypatch
):
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    monkeypatch.setenv("OPENCLAW_STATE_DIR", str(state_dir))

    packed = dispatch(
        "vt.pack",
        _pack_request("workspace-a", "# Auth\n\n- rotate refresh tokens\n"),
    )

    assert packed["schema"] == "VtokenPackResult/v1"
    assert packed["estimate_method"] == "chars_div_4"
    assert packed["estimated_tokens"] <= packed["allowance_tokens"] == 600
    assert "tokens_used" not in packed
    assert packed["candidate_count"] == 1
    assert dispatch("vt.ping", {})["opened"] is False
    assert list(state_dir.iterdir()) == []


def test_stateless_pack_rejects_duplicate_candidate_ids():
    params = _pack_request("duplicate", "# A\n\n- first\n")
    params["candidates"].append(
        {
            "candidate_id": "duplicate",
            "kind": "markdown",
            "source_path": "B.md",
            "text": "# B\n\n- second\n",
        }
    )
    with pytest.raises(ValueError, match="duplicate candidate_id"):
        dispatch("vt.pack", params)


def test_stateless_pack_requests_do_not_share_graphs():
    first = dispatch(
        "vt.pack", _pack_request("workspace-a", "# Auth\n\n- alpha-only\n")
    )
    second = dispatch(
        "vt.pack", _pack_request("workspace-b", "# Auth\n\n- beta-only\n")
    )

    assert "alpha-only" in first["prompt"]
    assert "beta-only" not in first["prompt"]
    assert "beta-only" in second["prompt"]
    assert "alpha-only" not in second["prompt"]


def test_line_server_runs_stateless_pack_requests_concurrently():
    barrier = threading.Barrier(2)

    def concurrent_handler(request):
        barrier.wait(timeout=2)
        return {"jsonrpc": "2.0", "id": request["id"], "result": {"ok": True}}

    requests = "".join(
        json.dumps(
            {"jsonrpc": "2.0", "id": request_id, "method": "vt.pack", "params": {}}
        )
        + "\n"
        for request_id in (1, 2)
    )
    output = StringIO()
    host_rpc.serve(
        StringIO(requests), output, handler=concurrent_handler, pack_workers=2
    )

    responses = [json.loads(line) for line in output.getvalue().splitlines()]
    assert {response["id"] for response in responses} == {1, 2}


def test_open_ingest_assemble_stats_close_flow():
    opened = dispatch("vt.open", {})
    assert opened["ok"] is True
    assert opened["stats"]["doc_nodes"] == 0

    ingested = dispatch(
        "vt.ingest_markdown",
        {
            "text": "# Auth\n\n## JWT\n\n- access token <= 15 min\n- refresh rotation required\n",
            "source_path": "auth.md",
        },
    )
    assert ingested["ok"] is True
    assert ingested["nodes_added"] >= 1

    tools = dispatch(
        "vt.ingest_tools",
        {
            "schemas": [
                {
                    "name": "lookup_user",
                    "description": "Look up a user by id",
                    "inputSchema": {
                        "type": "object",
                        "properties": {"id": {"type": "string"}},
                    },
                }
            ],
            "server_name": "demo",
        },
    )
    assert tools["ok"] is True

    assembled = dispatch(
        "vt.assemble",
        {"task_hint": "JWT auth token", "budget_tokens": 600, "render_mode": "compact"},
    )
    assert assembled["ok"] is True
    result = assembled["result"]
    assert isinstance(result["prompt"], str)
    assert result["tokens_used"] <= result["tokens_budget"]
    assert result["tokens_budget"] == 600
    assert "nodes_included" in result
    assert "nodes_evicted" in result

    stats = dispatch("vt.stats", {})
    assert stats["ok"] is True
    assert stats["stats"]["doc_nodes"] >= 1

    closed = dispatch("vt.close", {})
    assert closed["ok"] is True

    with pytest.raises(Exception):
        dispatch("vt.stats", {})


def test_assemble_requires_open():
    with pytest.raises(Exception):
        dispatch("vt.assemble", {"task_hint": "x", "budget_tokens": 100})


def test_unknown_method_jsonrpc():
    resp = handle_request(
        {"jsonrpc": "2.0", "id": 1, "method": "vt.nope", "params": {}}
    )
    assert resp["id"] == 1
    assert resp["error"]["code"] == -32601


def test_invalid_params_jsonrpc():
    dispatch("vt.open", {})
    resp = handle_request(
        {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "vt.assemble",
            "params": {"budget_tokens": "nope"},
        }
    )
    assert resp["error"]["code"] == -32602


def test_render_modes():
    dispatch("vt.open", {})
    dispatch(
        "vt.ingest_markdown",
        {
            "text": "# Title\n\nSome knowledge about security rules.\n",
            "source_path": "k.md",
        },
    )
    for mode in ("compact", "dense", "verbose"):
        out = dispatch(
            "vt.assemble",
            {"task_hint": "security", "budget_tokens": 300, "render_mode": mode},
        )
        assert out["ok"] is True
        assert out["result"]["tokens_used"] <= 300


def test_line_protocol_roundtrip_handle_request():
    req = {"jsonrpc": "2.0", "id": 7, "method": "vt.ping", "params": {}}
    resp = handle_request(req)
    assert resp["jsonrpc"] == "2.0"
    assert resp["id"] == 7
    assert resp["result"]["ok"] is True
    # Ensure response is JSON serializable (stdio path)
    json.dumps(resp)
