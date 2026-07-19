"""P1.2 acceptance — compiler idempotency + atomic replace (spec §12 编译器幂等性)."""
import hashlib
import json
import os

import pytest
from conftest import SPEC_AUTH, SPEC_MEM

from vtoken import VTParseError, compile_file


def _sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def test_compile_is_idempotent_sha256(write_vt, tmp_path):
    vt = write_vt("auth.vt", SPEC_AUTH)
    out1, _ = compile_file(vt, str(tmp_path / "a.vtg"))
    out2, _ = compile_file(vt, str(tmp_path / "b.vtg"))
    assert _sha(out1) == _sha(out2)
    # recompiling in place also yields identical bytes
    out3, _ = compile_file(vt)
    out4, _ = compile_file(vt)
    assert out3 == out4 and _sha(out3) == _sha(out1)


def test_atomic_write_leaves_no_temp_file(write_vt):
    vt = write_vt("auth.vt", SPEC_AUTH)
    out, _ = compile_file(vt)
    assert os.path.exists(out)
    assert not os.path.exists(out + ".new")


def test_vtg_payload_shape_and_no_timestamps(write_vt):
    vt = write_vt("auth.vt", SPEC_AUTH)
    out, _ = compile_file(vt)
    with open(out, encoding="utf-8") as f:
        payload = json.load(f)
    assert payload["mode"] == "doc" and payload["doc_id"] == "system/auth"
    assert len(payload["nodes"]) == 8 and len(payload["edges"]) == 3
    # D2: no wall-clock, no filesystem paths anywhere in the payload
    assert set(payload.keys()) == {"vtg", "vt_version", "mode", "doc_id", "lang", "schema", "nodes", "edges"}
    for n in payload["nodes"]:
        # v0.4 (D31): slot/priority 新增字段；缺省值 None/5 保持 .vtg 字节幂等
        assert set(n.keys()) == {"id", "line", "parts", "slot", "priority"}
        assert n["slot"] is None and n["priority"] == 5  # parser 路径未设值 → 默认
    for e in payload["edges"]:
        assert set(e.keys()) == {"src", "rel", "dst", "line"}


def test_compile_error_writes_nothing(write_vt, tmp_path):
    vt = write_vt("bad.vt", "%vt 0.3.1\n%mode doc\n%id t/x\nRULE a.r x\nRULE a.r y\n")
    out = str(tmp_path / "bad.vtg")
    with pytest.raises(VTParseError) as ei:
        compile_file(vt, out)
    assert not os.path.exists(out) and not os.path.exists(out + ".new")
    report = ei.value.report()
    assert report["status"] == "error"
    assert report["errors"][0]["type"] == "duplicate_id"


def test_mem_file_is_not_compilable(write_vt):
    vt = write_vt("session.vt", SPEC_MEM)
    with pytest.raises(VTParseError) as ei:
        compile_file(vt)
    assert ei.value.issues[0].type == "mem_not_compilable"


def test_check_dangling_refs_warning_vs_strict(write_vt):
    from vtoken import check_file
    vt = write_vt("auth.vt", SPEC_AUTH)
    report = check_file(vt)
    assert report["status"] == "ok"
    dangling = {w["id"] for w in report["warnings"]}
    assert dangling == {"middleware.jwt_verify", "db.user_table", "api.endpoint.login"}
    strict = check_file(vt, strict=True)
    assert strict["status"] == "error"
    assert all(e["type"] == "dangling_ref" for e in strict["errors"])
