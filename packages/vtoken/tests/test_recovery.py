"""P1.6 acceptance — crash recovery (spec §12 崩溃恢复正确性).

Reopening the files without a clean shutdown IS crash semantics here, because
durability comes from per-write fsync, not from close(). One test additionally
kills a real subprocess via os._exit (no cleanup, no atexit) to prove it.
"""
import json
import subprocess
import sys
from pathlib import Path

from vtoken import MemStore

SRC = str(Path(__file__).resolve().parent.parent / "src")


def test_recover_100_writes_without_checkpoint(tmp_path):
    s = MemStore(str(tmp_path), "r1", durability="fsync", checkpoint_every=0)
    ids = [s.write(f"fact {i}", tag="note") for i in range(100)]
    s.close()  # closes the handle only; every record was already fsynced

    r = MemStore(str(tmp_path), "r1", durability="fsync", checkpoint_every=0)
    assert r.recovered == {"snapshot_nodes": 0, "replayed_ops": 100,
                           "skipped_partial_tail": False}
    for i, nid in enumerate(ids):
        assert r.resolve(nid, depth=0) == f"[#{nid[1:]}:note] fact {i}"
    # D14: sequence continues after the highest id ever assigned
    assert r.write("post-crash") == "#101"
    r.close()


def test_recover_snapshot_plus_wal_tail(tmp_path):
    s = MemStore(str(tmp_path), "r2", durability="fsync", checkpoint_every=0)
    for i in range(10):
        s.write(f"pre {i}")
    s.checkpoint()
    for i in range(5):
        s.write(f"post {i}")
    s.close()

    r = MemStore(str(tmp_path), "r2", durability="fsync", checkpoint_every=0)
    assert r.recovered["snapshot_nodes"] == 10
    assert r.recovered["replayed_ops"] == 5
    assert len(r.graph.nodes) == 15
    assert r.resolve("#013", depth=0) == "[#013] post 2"
    r.close()


def test_recover_replays_delete(tmp_path):
    s = MemStore(str(tmp_path), "r3", durability="fsync", checkpoint_every=0)
    s.write("a")
    s.write("b")
    s.write("c")
    s.delete("#002")
    s.close()

    r = MemStore(str(tmp_path), "r3", durability="fsync", checkpoint_every=0)
    assert sorted(r.graph.nodes) == ["#001", "#003"]
    assert r.write("d") == "#004"  # deleted id not reused
    r.close()


def test_recover_edges_across_checkpoint_overlap(tmp_path):
    """Crash window where WAL records overlap the snapshot: idempotent replay
    must preserve edges between replayed nodes."""
    s = MemStore(str(tmp_path), "r4", durability="fsync", checkpoint_every=0)
    a = s.write("root")
    s.write("child", edges=[a])
    s.checkpoint()
    s.close()
    # simulate the crash window: re-append the (already snapshotted) records
    with open(s.wal_path, "a", encoding="utf-8") as f:
        f.write(json.dumps({"op": "write", "id": "#001", "type": None,
                            "content": "root", "edges": [], "ts": 1}) + "\n")
        f.write(json.dumps({"op": "write", "id": "#002", "type": None,
                            "content": "child", "edges": ["#001"], "ts": 2}) + "\n")

    r = MemStore(str(tmp_path), "r4", durability="fsync", checkpoint_every=0)
    assert len(r.graph.nodes) == 2
    assert "[#002] child" in r.resolve("#001", depth=1)  # in-edge rebuilt
    r.close()


def test_partial_tail_line_is_skipped(tmp_path):
    s = MemStore(str(tmp_path), "r5", durability="fsync", checkpoint_every=0)
    for i in range(3):
        s.write(f"n{i}")
    s.close()
    with open(s.wal_path, "a", encoding="utf-8") as f:
        f.write('{"op":"wri')  # torn write: crash mid-append

    r = MemStore(str(tmp_path), "r5", durability="fsync", checkpoint_every=0)
    assert r.recovered["skipped_partial_tail"] is True
    assert len(r.graph.nodes) == 3
    r.close()


def test_real_process_crash_via_os_exit(tmp_path):
    """spec §12: kill the writer without any cleanup, then recover."""
    script = (
        "import sys, os\n"
        f"sys.path.insert(0, {SRC!r})\n"
        "from vtoken import MemStore\n"
        f"s = MemStore({str(tmp_path)!r}, 'crash', durability='fsync', checkpoint_every=0)\n"
        "for i in range(30):\n"
        "    s.write(f'crash fact {i}', tag='t')\n"
        "os._exit(1)\n"  # hard exit: no close(), no atexit, no flush
    )
    proc = subprocess.run([sys.executable, "-c", script], capture_output=True, timeout=60)
    assert proc.returncode == 1

    r = MemStore(str(tmp_path), "crash", durability="fsync", checkpoint_every=0)
    assert len(r.graph.nodes) == 30
    assert r.resolve("#030", depth=0) == "[#030:t] crash fact 29"
    assert r.write("survivor") == "#031"
    r.close()
