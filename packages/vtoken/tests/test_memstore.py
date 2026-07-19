"""P1.5 acceptance — vt.write() semantics + WAL + cross-store edges (spec §12 %mode mem 写入正确性)."""
import json
import os
import time

import pytest

from conftest import NET, SPEC_MEM

from vtoken import MemStore, UnifiedStore, VTStoreError, compile_file, load_vtg


def test_write_returns_sequential_ids_and_is_immediately_resolvable(tmp_path):
    s = MemStore(str(tmp_path), "s1", durability="flush")
    a = s.write("first note")
    b = s.write("second note", tag="blocker")
    assert (a, b) == ("#001", "#002")
    assert s.resolve(a, depth=0) == "[#001] first note"
    assert s.resolve(b, depth=0) == "[#002:blocker] second note"
    s.close()


def test_wal_record_shape_matches_spec(tmp_path):
    s = MemStore(str(tmp_path), "s1", durability="fsync")
    s.write("note", tag="blocker", edges=[])
    with open(s.wal_path, encoding="utf-8") as f:
        rec = json.loads(f.read().splitlines()[0])
    assert rec == {"op": "write", "id": "#001", "type": "blocker",
                   "content": "note", "edges": [], "ts": rec["ts"]}
    assert isinstance(rec["ts"], int)
    s.close()


def test_type_and_tag_are_one_concept(tmp_path):
    s = MemStore(str(tmp_path), "s1", durability="flush")
    a = s.write("x", type="rule")
    b = s.write("y", tag="pref")
    assert s.graph.nodes[a].type == "rule"
    assert s.graph.nodes[b].type == "pref"
    s.close()


def test_1000_writes_no_id_conflict(tmp_path):
    s = MemStore(str(tmp_path), "bulk", durability="flush", checkpoint_every=0)
    ids = [s.write(f"node {i}") for i in range(1000)]
    assert len(set(ids)) == 1000
    assert ids[0] == "#001" and ids[999] == "#1000"
    assert s.write("one more") == "#1001"
    s.close()


def test_mem_edges_and_delete(tmp_path):
    s = MemStore(str(tmp_path), "s1", durability="flush")
    a = s.write("root fact")
    b = s.write("depends on root", edges=[a])
    tir = s.resolve(a, depth=1)
    assert "[#002] depends on root" in tir
    assert s.delete(b) is True
    assert s.delete(b) is False
    assert "[#002]" not in s.resolve(a, depth=1)
    # deleted ids are never reused
    assert s.write("after delete") == "#003"
    s.close()


def test_cross_store_edges_mem_to_doc(write_vt, tmp_path):
    vt = write_vt("net.vt", NET)
    out, _ = compile_file(vt)
    store = UnifiedStore.open(vtg_paths=[out], session_dir=str(tmp_path / "sess"),
                              session="s1", durability="flush")
    nid = store.write("user confirmed rule two applies", edges=["a.two"])
    # mem -> doc traversal
    tir = store.resolve(nid, depth=1)
    assert "[#a.two:RULE] rule two" in tir
    # doc -> mem reverse traversal (via mem in-edge index)
    tir2 = store.resolve("a.two", depth=1)
    assert "[#001] user confirmed rule two applies" in tir2
    store.close()


def test_auto_checkpoint_truncates_wal(tmp_path):
    s = MemStore(str(tmp_path), "cp", durability="flush", checkpoint_every=10)
    for i in range(10):
        s.write(f"n{i}")
    assert os.path.exists(s.vtg_path)
    with open(s.wal_path, encoding="utf-8") as f:
        lines = [ln for ln in f.read().splitlines() if ln.strip()]
    assert len(lines) == 1
    assert json.loads(lines[0])["op"] == "checkpoint"
    assert json.loads(lines[0])["up_to_id"] == "#010"
    s.write("post checkpoint")
    with open(s.wal_path, encoding="utf-8") as f:
        lines = [ln for ln in f.read().splitlines() if ln.strip()]
    assert len(lines) == 2 and json.loads(lines[1])["op"] == "write"
    s.close()


def test_import_export_mem_vt(write_vt, tmp_path):
    vt = write_vt("session.vt", SPEC_MEM)
    s = MemStore(str(tmp_path), "imp", durability="flush")
    ids = s.import_vt(vt)
    assert len(ids) == 6
    assert s.resolve("#004", depth=0).startswith("[#004:blocker] 需确认 JWT_SECRET_KEY")
    exported = s.export_vt()
    assert "%mode mem" in exported and "#blocker 需确认" in exported
    s.close()


def test_toc_and_stats(write_vt, tmp_path):
    vt = write_vt("net.vt", NET)
    out, _ = compile_file(vt)
    store = UnifiedStore(doc_graph=load_vtg(out))
    toc = store.toc()
    assert toc.splitlines()[0] == "[#a.one:DEF] node one"
    assert "RULE" not in toc  # toc is DEF-only
    st = store.stats()
    assert st["doc_nodes"] == 5 and st["doc_edges"] == 5
    assert st["parts_by_type"]["DEF"] == 4 and st["parts_by_type"]["RULE"] == 1


# ---------------------------------------------------------------------------
# T5.5 — search() now implemented as offline TF-IDF (replaces T0.1 placeholder)
# ---------------------------------------------------------------------------

def test_search_mem_returns_matching_nodes(tmp_path):
    s = MemStore(str(tmp_path), "s1", durability="flush")
    s.write("auth token expires after 24 hours", tag="note")
    s.write("database connection pool size", tag="note")
    s.write("rate limiting rules for API", tag="rule")
    results = s.search("auth token")
    assert isinstance(results, list)
    assert len(results) >= 1
    # top result must mention auth token
    assert "auth" in results[0]["snippet"].lower() or "token" in results[0]["snippet"].lower()
    # all results have expected fields
    for r in results:
        assert "id" in r and "score" in r and "snippet" in r
        assert r["id"].startswith("#")
    s.close()


def test_search_mem_rebuilds_after_write(tmp_path):
    s = MemStore(str(tmp_path), "s1", durability="flush")
    # initial: empty graph, search returns nothing
    assert s.search("anything") == []
    s.write("first fact about cookies", tag="note")
    # index rebuilds lazily on next query
    results = s.search("cookies")
    assert len(results) >= 1
    assert "cookies" in results[0]["snippet"]
    s.close()


def test_search_unified_doc_and_mem(tmp_path):
    from vtoken import load_doc_graphs
    from vtoken.compiler import compile_file
    # write a .vt doc + compile
    vt = tmp_path / "auth.vt"
    vt.write_text(
        "%vt 0.3.1\n%mode doc\n%id system/auth\n\n"
        "DEF auth.overview  JWT token signing and verification\n"
        "RULE auth.ttl      token lifetime must not exceed 24 hours\n",
        encoding="utf-8",
    )
    compile_file(str(vt))
    vtg = tmp_path / "auth.vtg"

    store = UnifiedStore.open(vtg_paths=[str(vtg)],
                              session_dir=str(tmp_path / "mem"),
                              session="s1", durability="flush")
    # search doc only
    results = store.search("token ttl")
    assert len(results) >= 1
    ids = {r["id"] for r in results}
    assert "auth.overview" in ids or "auth.ttl" in ids
    # write to mem session and search across both
    store.write("session note about token rotation", tag="note")
    results2 = store.search("token rotation")
    ids2 = {r["id"] for r in results2}
    assert any(i.startswith("#") for i in ids2), "mem node should appear in results"
    store.close()


# ---------------------------------------------------------------------------
# T0.2 — per-session mutex via <session>.lock
# ---------------------------------------------------------------------------

def test_session_lock_blocks_second_open_same_process(tmp_path):
    s = MemStore(str(tmp_path), "x", durability="flush")
    try:
        with pytest.raises(VTStoreError) as exc:
            MemStore(str(tmp_path), "x", durability="flush")
        assert "locked by pid" in str(exc.value)
        assert str(os.getpid()) in str(exc.value)
    finally:
        s.close()


def test_session_lock_released_on_close(tmp_path):
    s = MemStore(str(tmp_path), "rel", durability="flush")
    assert os.path.exists(s.lock_path)
    s.close()
    assert not os.path.exists(s.lock_path)
    # Re-open should succeed cleanly
    s2 = MemStore(str(tmp_path), "rel", durability="flush")
    s2.close()


def test_stale_lock_with_dead_pid_is_taken_over(tmp_path):
    """A lockfile pointing at a non-existent pid must be silently reclaimed."""
    lock_path = os.path.join(str(tmp_path), "stale.lock")
    with open(lock_path, "w", encoding="ascii") as f:
        f.write("99999999\n")  # 8-digit pid almost certainly does not exist
    s = MemStore(str(tmp_path), "stale", durability="flush")
    try:
        # Took over: lockfile now holds OUR pid
        with open(lock_path, encoding="ascii") as f:
            assert int(f.read().strip()) == os.getpid()
        s.write("ok after takeover")
        assert s.resolve("#001", depth=0) == "[#001] ok after takeover"
    finally:
        s.close()
    assert not os.path.exists(lock_path)


def test_lockfile_holds_our_pid(tmp_path):
    s = MemStore(str(tmp_path), "p", durability="flush")
    try:
        with open(s.lock_path, encoding="ascii") as f:
            assert int(f.read().strip()) == os.getpid()
    finally:
        s.close()


# ---------------------------------------------------------------------------
# T0.3 — background time-triggered checkpoint (spec §5.1 "every 60s")
# ---------------------------------------------------------------------------

def test_background_checkpointer_triggers_checkpoint(tmp_path):
    s = MemStore(str(tmp_path), "bg", durability="flush", checkpoint_every=0)
    thread = None
    try:
        s.start_background_checkpointer(interval_s=0.2)
        s.write("n1")
        time.sleep(0.6)  # allow at least one tick
        assert os.path.exists(s.vtg_path)
        with open(s.wal_path, encoding="utf-8") as f:
            lines = [ln for ln in f.read().splitlines() if ln.strip()]
        # WAL tail should be just the checkpoint marker
        assert len(lines) == 1
        assert json.loads(lines[0])["op"] == "checkpoint"
        thread = s._checkpointer_thread
        assert thread is not None and thread.is_alive()
    finally:
        s.close()
    # close() must stop the thread
    if thread is not None:
        assert thread.is_alive() is False


def test_background_checkpointer_idempotent(tmp_path):
    s = MemStore(str(tmp_path), "bg2", durability="flush", checkpoint_every=0)
    try:
        s.start_background_checkpointer(interval_s=0.2)
        first = s._checkpointer_thread
        s.start_background_checkpointer(interval_s=0.2)  # second call: no-op
        assert s._checkpointer_thread is first
    finally:
        s.close()


def test_background_checkpointer_rejects_nonpositive_interval(tmp_path):
    s = MemStore(str(tmp_path), "bg3", durability="flush")
    try:
        with pytest.raises(ValueError):
            s.start_background_checkpointer(interval_s=0)
    finally:
        s.close()
