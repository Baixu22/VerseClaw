"""P1.1 acceptance — parser correctness (spec §12 解析器正确性)."""
import pytest
from conftest import NET, SPEC_AUTH, SPEC_MEM

from vtoken import VTParseError, parse_vt


def test_spec_flagship_example_parses():
    parsed = parse_vt(SPEC_AUTH, filename="auth.vt")
    assert parsed.header.mode == "doc"
    assert parsed.header.doc_id == "system/auth"
    assert parsed.header.lang == "zh"
    ids = [n.id for n in parsed.nodes]
    assert ids == ["auth.overview", "auth.sec_1", "auth.sec_2", "auth.sec_3",
                   "auth.jwt_secret", "auth.algo", "auth.ex_1", "auth.todo_1"]
    # D1: two DESC lines attach as facets of auth.overview
    overview = parsed.nodes[0]
    assert [t for t, _ in overview.parts] == ["DEF", "DESC", "DESC"]
    assert overview.type == "DEF"
    # VAR content keeps inner spacing verbatim
    var = next(n for n in parsed.nodes if n.id == "auth.jwt_secret")
    assert var.content == "env:JWT_SECRET_KEY  type:string  minlen:32"
    # edges: 2 typed + 1 untyped
    assert [(e.src, e.rel, e.dst) for e in parsed.edges] == [
        ("auth.sec_1", "ENFORCED-BY", "middleware.jwt_verify"),
        ("auth.overview", "DEPENDS", "db.user_table"),
        ("auth.overview", None, "api.endpoint.login"),
    ]


def test_spec_mem_example_parses():
    parsed = parse_vt(SPEC_MEM, filename="session.vt")
    assert parsed.header.mode == "mem"
    assert parsed.header.session == "task_20240718_auth_impl"
    assert len(parsed.mem_items) == 6
    tags = [i.tag for i in parsed.mem_items]
    assert tags == [None, None, None, "blocker", "pref", None]


def _errors_of(text, **kw):
    with pytest.raises(VTParseError) as ei:
        parse_vt(text, **kw)
    return ei.value.report()


def test_duplicate_defining_id_is_error():
    text = "%vt 0.3.1\n%mode doc\n%id t/x\nRULE a.r1 first\nRULE a.r1 second\n"
    report = _errors_of(text)
    assert report["status"] == "error"
    err = report["errors"][0]
    assert err["type"] == "duplicate_id" and err["id"] == "a.r1" and err["line"] == 5


def test_unknown_type_symbol_reports_symbol_field():
    text = "%vt 0.3.1\n%mode doc\n%id t/x\nINFO a.x something\n"
    report = _errors_of(text)
    assert report["errors"][0]["type"] == "unknown_type"
    assert report["errors"][0]["symbol"] == "INFO"


def test_multiple_errors_collected_in_one_report():
    text = ("%vt 0.3.1\n%mode doc\n%id t/x\n"
            "RULE a.r1 first\nRULE a.r1 second\nINFO a.x nope\n")
    report = _errors_of(text)
    assert {e["type"] for e in report["errors"]} == {"duplicate_id", "unknown_type"}


def test_missing_version_missing_mode_missing_id():
    report = _errors_of("DEF a.x hello\n")
    types = {e["type"] for e in report["errors"]}
    assert "missing_version" in types and "missing_mode" in types


def test_doc_requires_id_and_mem_requires_session():
    r1 = _errors_of("%vt 0.3.1\n%mode doc\nDEF a.x hi\n")
    assert any(e["type"] == "missing_id_directive" for e in r1["errors"])
    r2 = _errors_of("%vt 0.3.1\n%mode mem\n- hi\n")
    assert any(e["type"] == "missing_session_directive" for e in r2["errors"])


def test_unknown_directive_and_directive_after_body():
    r = _errors_of("%vt 0.3.1\n%mode doc\n%id t/x\n%future on\nDEF a.x hi\n%lang zh\n")
    types = [e["type"] for e in r["errors"]]
    assert "unknown_directive" in types and "directive_after_body" in types


def test_invalid_mode_and_duplicate_directive():
    r = _errors_of("%vt 0.3.1\n%mode yaml\n%mode doc\n%id t/x\nDEF a.x hi\n")
    types = [e["type"] for e in r["errors"]]
    assert "invalid_mode" in types and "duplicate_directive" in types


def test_ref_syntax_errors():
    base = "%vt 0.3.1\n%mode doc\n%id t/x\nDEF a.x hi\n"
    r = _errors_of(base + "REF a.x --DEPENDS--> b.y extra\n")
    assert r["errors"][0]["type"] == "invalid_ref"
    r = _errors_of(base + "REF a.x -DEPENDS-> b.y\n")
    assert r["errors"][0]["type"] == "invalid_relation"
    r = _errors_of(base + "REF a.x --NOT-A-REL--> b.y\n")
    assert r["errors"][0]["type"] == "unknown_relation"


def test_mem_body_line_forms():
    bad = "%vt 0.3.1\n%mode mem\n%session s1\nplain line without dash\n"
    r = _errors_of(bad)
    assert r["errors"][0]["type"] == "invalid_mem_line"
    bad2 = "%vt 0.3.1\n%mode mem\n%session s1\n#blocker\n"
    r2 = _errors_of(bad2)
    assert r2["errors"][0]["type"] == "missing_content"


def test_ns_elision_prefixes_bare_ids():
    text = ("%vt 0.3.1\n%mode doc\n%id t/x\n%ns auth\n"
            "DEF overview  hello\nRULE sec_1  world\n"
            "REF sec_1 --SEE--> overview\n"
            "REF overview --DEPENDS--> db.user_table\n")
    parsed = parse_vt(text)
    assert [n.id for n in parsed.nodes] == ["auth.overview", "auth.sec_1"]
    assert (parsed.edges[0].src, parsed.edges[0].dst) == ("auth.sec_1", "auth.overview")
    # qualified ids pass through untouched
    assert parsed.edges[1].dst == "db.user_table"


def test_custom_schema_roundtrip(tmp_path):
    (tmp_path / "project_x.vtschema").write_text(
        "%schema project_x extends core\n"
        "type TASK    semantic:trackable task\n"
        "relation --OWNS-->      description:ownership\n",
        encoding="utf-8")
    vt = ("%vt 0.3.1\n%mode doc\n%id t/x\n%schema project_x\n"
          "TASK t.a  do the thing\nDEF t.b  a def\n"
          "REF t.b --OWNS--> t.a\n")
    p = tmp_path / "f.vt"
    p.write_text(vt, encoding="utf-8")
    from vtoken import parse_vt_file
    parsed = parse_vt_file(str(p))
    assert parsed.nodes[0].type == "TASK"
    assert parsed.edges[0].rel == "OWNS"


def test_custom_schema_cannot_redefine_core(tmp_path):
    (tmp_path / "bad.vtschema").write_text(
        "%schema bad extends core\ntype RULE  semantic:mine now\n", encoding="utf-8")
    vt = "%vt 0.3.1\n%mode doc\n%id t/x\n%schema bad\nDEF a.x hi\n"
    p = tmp_path / "f.vt"
    p.write_text(vt, encoding="utf-8")
    from vtoken import parse_vt_file
    with pytest.raises(VTParseError) as ei:
        parse_vt_file(str(p))
    assert any(i.type == "schema_error" and "redefined_symbol" in i.message
               for i in ei.value.issues)


def test_net_fixture_parses():
    parsed = parse_vt(NET)
    assert len(parsed.nodes) == 5 and len(parsed.edges) == 5
