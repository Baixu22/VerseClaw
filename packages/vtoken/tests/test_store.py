"""T5.1 doc hot-reload 测试 (spec §5.5).

验收 (HANDOFF §3 T5.1):
- 改 .vt → compile → 不重建 store，下次 resolve 看到新内容
- 含并发读切换测试
"""
from __future__ import annotations

import os
import threading
import time

import pytest

from vtoken import MemStore, UnifiedStore
from vtoken.compiler import compile_file
from vtoken.store import GraphHolder


# ---------------------------------------------------------------------------
# helpers — write a minimal doc .vt to a path
# ---------------------------------------------------------------------------

def _write_vt(path: str, content: str = "") -> None:
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def _make_minimal_doc(overview_content: str = "JWT 认证模块",
                      extra_node: str | None = None) -> str:
    lines = [
        "%vt 0.3.1",
        "%mode doc",
        "%id system/auth",
        "",
        f"DEF auth.overview    {overview_content}",
    ]
    if extra_node:
        lines.append(extra_node)
    return "\n".join(lines) + "\n"


# bump mtime reliably: os.utime with explicit ns timestamp (must differ from current)
def _bump_mtime(path: str, delta_ns: int = 10_000_000) -> None:
    st = os.stat(path)
    # Force a different mtime — set ns far enough from current.
    # Windows st_mtime_ns resolution is ~100ns ticks; delta=10ms is safe.
    new_ns = st.st_mtime_ns + delta_ns
    os.utime(path, ns=(st.st_atime_ns, new_ns))


# ---------------------------------------------------------------------------
# T5.1 unit tests
# ---------------------------------------------------------------------------

class TestHotReloadVt:
    """Reload from .vt source (recompile on change)."""

    def test_vt_source_initial_load(self, tmp_path):
        vt = tmp_path / "auth.vt"
        _write_vt(str(vt), _make_minimal_doc("version A content"))
        store = UnifiedStore.open(doc_sources=[str(vt)])
        tir = store.resolve("auth.overview", depth=0)
        assert "version A content" in tir

    def test_vt_source_reload_on_mtime_change(self, tmp_path):
        vt = tmp_path / "auth.vt"
        _write_vt(str(vt), _make_minimal_doc("version A content"))
        store = UnifiedStore.open(doc_sources=[str(vt)])
        assert "version A" in store.resolve("auth.overview", depth=0)

        # Mutate .vt and bump mtime
        _write_vt(str(vt), _make_minimal_doc("version B content"))
        _bump_mtime(str(vt))

        tir_b = store.resolve("auth.overview", depth=0)
        assert "version B" in tir_b
        assert "version A" not in tir_b

    def test_vt_source_new_node_visible_after_reload(self, tmp_path):
        vt = tmp_path / "auth.vt"
        _write_vt(str(vt), _make_minimal_doc("overview A"))
        store = UnifiedStore.open(doc_sources=[str(vt)])
        # RULE auth.sec_1 not yet present → resolving it raises
        with pytest.raises(Exception):
            store.resolve("auth.sec_1", depth=0)

        # Add RULE auth.sec_1 + link it to overview via REF (so BFS depth=2 finds it)
        new_doc = _make_minimal_doc("overview A",
                                    extra_node="RULE auth.sec_1  token 24h\n"
                                               "REF auth.overview --DEPENDS--> auth.sec_1")
        _write_vt(str(vt), new_doc)
        _bump_mtime(str(vt))

        # Now depth=2 from overview should reach auth.sec_1
        tir = store.resolve("auth.overview", depth=2)
        assert "auth.sec_1" in tir
        assert "token 24h" in tir

    def test_vt_source_no_change_no_reload(self, tmp_path):
        vt = tmp_path / "auth.vt"
        _write_vt(str(vt), _make_minimal_doc("stable content"))
        store = UnifiedStore.open(doc_sources=[str(vt)])
        tir_1 = store.resolve("auth.overview", depth=0)

        # Same mtime → no reload → identical reference
        tir_2 = store.resolve("auth.overview", depth=0)
        assert tir_1 == tir_2


class TestHotReloadVtg:
    """Reload from .vtg source (just reload, no recompile)."""

    def test_vtg_source_initial_load(self, tmp_path):
        vt = tmp_path / "auth.vt"
        _write_vt(str(vt), _make_minimal_doc("vtg version A"))
        compile_file(str(vt))  # produces auth.vtg
        vtg = tmp_path / "auth.vtg"
        assert vtg.exists()

        store = UnifiedStore.open(doc_sources=[str(vtg)])
        assert "vtg version A" in store.resolve("auth.overview", depth=0)

    def test_vtg_source_reload_on_mtime_change(self, tmp_path):
        vt = tmp_path / "auth.vt"
        _write_vt(str(vt), _make_minimal_doc("vtg version A"))
        compile_file(str(vt))
        vtg = tmp_path / "auth.vtg"

        store = UnifiedStore.open(doc_sources=[str(vtg)])
        assert "vtg version A" in store.resolve("auth.overview", depth=0)

        # Rewrite .vt → recompile → .vtg overwritten → bump .vtg mtime
        _write_vt(str(vt), _make_minimal_doc("vtg version B"))
        compile_file(str(vt))
        _bump_mtime(str(vtg))

        assert "vtg version B" in store.resolve("auth.overview", depth=0)
        assert "vtg version A" not in store.resolve("auth.overview", depth=0)


class TestHotReloadFileMissing:
    """T5.1 容错：源文件不存在时保留 stale graph 不报错。"""

    def test_source_missing_at_startup(self, tmp_path):
        vt = tmp_path / "auth.vt"
        # Write then open (so initial load succeeds)
        _write_vt(str(vt), _make_minimal_doc("initial A"))
        store = UnifiedStore.open(doc_sources=[str(vt)])
        assert "initial A" in store.resolve("auth.overview", depth=0)

        # Delete source → next resolve should still return stale graph
        os.remove(str(vt))
        tir = store.resolve("auth.overview", depth=0)
        assert "initial A" in tir  # stale graph kept

    def test_source_missing_then_recreated(self, tmp_path):
        vt = tmp_path / "auth.vt"
        _write_vt(str(vt), _make_minimal_doc("round 1"))
        store = UnifiedStore.open(doc_sources=[str(vt)])

        os.remove(str(vt))
        # missing → stale graph
        assert "round 1" in store.resolve("auth.overview", depth=0)

        # recreate with new content + bump mtime
        _write_vt(str(vt), _make_minimal_doc("round 2"))
        _bump_mtime(str(vt))
        assert "round 2" in store.resolve("auth.overview", depth=0)


class TestHotReloadMultiSource:
    """Multiple doc sources: only changed ones recompile; merged graph rebuilt."""

    def test_two_sources_reload_one(self, tmp_path):
        a_vt = tmp_path / "a.vt"
        b_vt = tmp_path / "b.vt"
        # a.vt: %id system/a, nodes a.overview / a.rule
        a_content = (
            "%vt 0.3.1\n%mode doc\n%id system/a\n\n"
            "DEF a.overview  A content\n"
            "RULE a.rule  first rule\n"
        )
        # b.vt: %id system/b, node b.overview
        b_content = (
            "%vt 0.3.1\n%mode doc\n%id system/b\n\n"
            "DEF b.overview  B content\n"
        )
        _write_vt(str(a_vt), a_content)
        _write_vt(str(b_vt), b_content)
        store = UnifiedStore.open(doc_sources=[str(a_vt), str(b_vt)])

        assert "A content" in store.resolve("a.overview", depth=0)
        assert "B content" in store.resolve("b.overview", depth=0)

        # Mutate only a.vt
        new_a = (
            "%vt 0.3.1\n%mode doc\n%id system/a\n\n"
            "DEF a.overview  A UPDATED\n"
            "RULE a.rule  first rule\n"
        )
        _write_vt(str(a_vt), new_a)
        _bump_mtime(str(a_vt))

        assert "A UPDATED" in store.resolve("a.overview", depth=0)
        # b.vt untouched → still resolves
        assert "B content" in store.resolve("b.overview", depth=0)


class TestHotReloadConcurrent:
    """T5.1 并发读切换：多线程持续 resolve 期间改 .vt 不抛异常。"""

    def test_concurrent_resolve_during_reload(self, tmp_path):
        vt = tmp_path / "auth.vt"
        _write_vt(str(vt), _make_minimal_doc("concurrent v1"))
        store = UnifiedStore.open(doc_sources=[str(vt)])

        stop = threading.Event()
        errors: list = []
        seen_versions: set = set()
        seen_lock = threading.Lock()

        def reader():
            while not stop.is_set():
                try:
                    tir = store.resolve("auth.overview", depth=0)
                    if "concurrent v" in tir:
                        # extract version label
                        with seen_lock:
                            seen_versions.add(tir)
                except Exception as e:
                    errors.append(("reader", repr(e)))
                time.sleep(0.001)

        threads = [threading.Thread(target=reader) for _ in range(4)]
        for t in threads:
            t.start()

        # Mutate .vt several times while readers run
        for i in range(2, 6):
            time.sleep(0.01)
            _write_vt(str(vt), _make_minimal_doc(f"concurrent v{i}"))
            _bump_mtime(str(vt))

        stop.set()
        for t in threads:
            t.join(timeout=5)

        assert errors == [], f"readers saw errors: {errors}"
        # at least the initial and one later version were observed
        assert any("concurrent v1" in t for t in seen_versions)
        assert any("concurrent v5" in t for t in seen_versions)


class TestGraphHolderUnit:
    """Direct unit tests on GraphHolder.refresh()."""

    def test_holder_refresh_returns_false_when_unchanged(self, tmp_path):
        vt = tmp_path / "auth.vt"
        _write_vt(str(vt), _make_minimal_doc("no change"))
        holder = UnifiedStore._build_holder(str(vt))
        assert holder.refresh() is False

    def test_holder_refresh_returns_true_when_changed(self, tmp_path):
        vt = tmp_path / "auth.vt"
        _write_vt(str(vt), _make_minimal_doc("before"))
        holder = UnifiedStore._build_holder(str(vt))
        _write_vt(str(vt), _make_minimal_doc("after"))
        _bump_mtime(str(vt))
        assert holder.refresh() is True

    def test_holder_refresh_returns_false_when_missing(self, tmp_path):
        vt = tmp_path / "auth.vt"
        _write_vt(str(vt), _make_minimal_doc("exists"))
        holder = UnifiedStore._build_holder(str(vt))
        os.remove(str(vt))
        assert holder.refresh() is False  # stale graph kept


class TestBackwardCompat:
    """Legacy vtg_paths API still works without hot-reload."""

    def test_legacy_vtg_paths_no_reload(self, tmp_path):
        vt = tmp_path / "auth.vt"
        _write_vt(str(vt), _make_minimal_doc("legacy v1"))
        compile_file(str(vt))
        vtg = tmp_path / "auth.vtg"

        store = UnifiedStore.open(vtg_paths=[str(vtg)])
        assert "legacy v1" in store.resolve("auth.overview", depth=0)

        # Rewrite & recompile — legacy path does NOT hot reload
        _write_vt(str(vt), _make_minimal_doc("legacy v2"))
        compile_file(str(vt))
        _bump_mtime(str(vtg))

        # Should still see v1 (no holders)
        assert "legacy v1" in store.resolve("auth.overview", depth=0)
        assert "legacy v2" not in store.resolve("auth.overview", depth=0)

    def test_unsupported_extension_raises(self, tmp_path):
        bad = tmp_path / "doc.txt"
        _write_vt(str(bad), "garbage")
        with pytest.raises(Exception):
            UnifiedStore.open(doc_sources=[str(bad)])
