"""CLI behavior — JSON error reports + exit codes (spec §8)."""
import json
import os

from conftest import NET, SPEC_AUTH, SPEC_MEM

from vtoken.cli import main


def test_compile_success(write_vt, capsys):
    vt = write_vt("auth.vt", SPEC_AUTH)
    rc = main(["compile", vt])
    out = capsys.readouterr().out
    assert rc == 0
    assert "8 nodes, 3 edges" in out
    assert os.path.exists(vt.replace(".vt", ".vtg"))


def test_compile_error_prints_json_and_exits_nonzero(write_vt, capsys):
    vt = write_vt("bad.vt", "%vt 0.3.1\n%mode doc\n%id t/x\nINFO a.x nope\n")
    rc = main(["compile", vt])
    report = json.loads(capsys.readouterr().out)
    assert rc == 1
    assert report["status"] == "error"
    assert report["errors"][0]["type"] == "unknown_type"
    assert report["errors"][0]["symbol"] == "INFO"
    assert report["errors"][0]["line"] == 4


def test_compile_mem_file_fails(write_vt, capsys):
    vt = write_vt("session.vt", SPEC_MEM)
    rc = main(["compile", vt])
    report = json.loads(capsys.readouterr().out)
    assert rc == 1 and report["errors"][0]["type"] == "mem_not_compilable"


def test_check_strict_exit_code(write_vt, capsys):
    vt = write_vt("auth.vt", SPEC_AUTH)
    assert main(["check", vt]) == 0
    capsys.readouterr()
    rc = main(["check", "--strict", vt])
    report = json.loads(capsys.readouterr().out)
    assert rc == 1
    assert all(e["type"] == "dangling_ref" for e in report["errors"])


def test_check_json_output(write_vt, capsys):
    vt = write_vt("net.vt", NET)
    rc = main(["check", "--json", vt])
    report = json.loads(capsys.readouterr().out)
    assert rc == 0 and report["status"] == "ok"
    assert {w["id"] for w in report["warnings"]} == {"a.ghost"}


def test_resolve_cli(write_vt, capsys):
    vt = write_vt("net.vt", NET)
    main(["compile", vt])
    capsys.readouterr()
    vtg = vt.replace(".vt", ".vtg")
    rc = main(["resolve", "a.one", "--graph", vtg, "--depth", "1"])
    out = capsys.readouterr().out.strip()
    assert rc == 0
    assert out.splitlines()[0] == "[#a.one:DEF] node one"
    assert "[#a.five:DEF] node five" in out


def test_resolve_cli_unknown_node(write_vt, capsys):
    vt = write_vt("net.vt", NET)
    main(["compile", vt])
    capsys.readouterr()
    rc = main(["resolve", "a.nope", "--graph", vt.replace(".vt", ".vtg")])
    report = json.loads(capsys.readouterr().out)
    assert rc == 1 and report["status"] == "error"


def test_stats_cli(write_vt, capsys):
    vt = write_vt("net.vt", NET)
    main(["compile", vt])
    capsys.readouterr()
    rc = main(["stats", "--graph", vt.replace(".vt", ".vtg")])
    out = capsys.readouterr().out
    assert rc == 0
    assert '"doc_nodes": 5' in out and "[#a.one:DEF] node one" in out


def test_multi_graph_merge_and_cross_file_resolve(write_vt, capsys):
    extra = (
        "%vt 0.3.1\n%mode doc\n%id test/extra\n"
        "DEF b.hub  hub node\n"
        "REF b.hub --DEPENDS--> a.one\n"
    )
    vt1 = write_vt("net.vt", NET)
    vt2 = write_vt("extra.vt", extra)
    main(["compile", vt1, vt2])
    capsys.readouterr()
    g1, g2 = vt1.replace(".vt", ".vtg"), vt2.replace(".vt", ".vtg")
    rc = main(["resolve", "a.one", "--graph", g1, "--graph", g2, "--depth", "1"])
    out = capsys.readouterr().out
    assert rc == 0 and "[#b.hub:DEF] hub node" in out


def test_multi_graph_id_collision_is_error(write_vt, capsys):
    dup = "%vt 0.3.1\n%mode doc\n%id test/dup\nDEF a.one  clashing definition\n"
    vt1 = write_vt("net.vt", NET)
    vt2 = write_vt("dup.vt", dup)
    main(["compile", vt1, vt2])
    capsys.readouterr()
    rc = main(["resolve", "a.one", "--graph", vt1.replace(".vt", ".vtg"),
               "--graph", vt2.replace(".vt", ".vtg")])
    report = json.loads(capsys.readouterr().out)
    assert rc == 1 and "duplicate node id 'a.one'" in report["errors"][0]["message"]


# --------------------------------------------------------------------------- v0.4 CLI

def test_assemble_cli_basic(write_vt, capsys):
    """vt assemble 输出 AssembleResult JSON。"""
    vt = write_vt("net.vt", NET)
    main(["compile", vt])
    capsys.readouterr()
    vtg = vt.replace(".vt", ".vtg")
    rc = main(["assemble", "test task", "--graph", vtg, "--budget", "2000"])
    out = capsys.readouterr().out
    assert rc == 0
    result = json.loads(out)
    # AssembleResult 关键字段
    assert set(result.keys()) == {"prompt", "tokens_used", "tokens_budget",
                                   "slot_breakdown", "nodes_included",
                                   "nodes_evicted", "dedup_count"}
    assert result["tokens_budget"] == 2000
    assert result["tokens_used"] <= 2000
    assert isinstance(result["prompt"], str)
    assert isinstance(result["dedup_count"], int)


def test_assemble_cli_explain_mode(write_vt, capsys):
    """vt assemble --explain 输出人类可读报告（非 JSON）。"""
    vt = write_vt("net.vt", NET)
    main(["compile", vt])
    capsys.readouterr()
    vtg = vt.replace(".vt", ".vtg")
    rc = main(["assemble", "test task", "--graph", vtg, "--budget", "2000",
               "--explain"])
    out = capsys.readouterr().out
    assert rc == 0
    # 可读报告标志
    assert "Budget:" in out
    assert "Slots:" in out
    assert "Deduped:" in out
    assert "Evicted:" in out


def test_assemble_cli_with_ingest(write_vt, tmp_path, capsys):
    """vt assemble --ingest <md> 同时 ingest 额外 .md 源。"""
    vt = write_vt("net.vt", NET)
    main(["compile", vt])
    capsys.readouterr()
    vtg = vt.replace(".vt", ".vtg")
    md_path = tmp_path / "extra_rules.md"
    md_path.write_text("# Extra rules\n- rule one\n- rule two\n", encoding="utf-8")
    rc = main(["assemble", "test", "--graph", vtg, "--ingest", str(md_path),
               "--budget", "2000"])
    out = capsys.readouterr().out
    assert rc == 0
    result = json.loads(out)
    assert result["tokens_used"] <= 2000


def test_ingest_cli_md(write_vt, tmp_path, capsys):
    """vt ingest 把 .md ingest 进 doc 图并报告 added_nodes。"""
    vt = write_vt("net.vt", NET)
    main(["compile", vt])
    capsys.readouterr()
    vtg = vt.replace(".vt", ".vtg")
    md_path = tmp_path / "more_rules.md"
    md_path.write_text("# H1 heading\n- bullet one\n- bullet two\n", encoding="utf-8")
    rc = main(["ingest", str(md_path), "--existing", vtg, "--source-type", "md"])
    out = capsys.readouterr().out
    assert rc == 0
    # 期望输出包含 added nodes 行
    assert "ingested" in out
    assert "total: +" in out


def test_assemble_cli_empty_graph(capsys):
    """vt assemble 在空 store 上也能跑（返回空 prompt）。"""
    rc = main(["assemble", "no task"])
    out = capsys.readouterr().out
    assert rc == 0
    result = json.loads(out)
    assert result["tokens_used"] == 0
    assert result["prompt"] == ""
    assert result["dedup_count"] == 0
