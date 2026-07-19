"""End-to-end demo: spec §10 workflows on the spec's own example documents.

Run:  python examples/demo.py
"""
import os
import shutil
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(encoding="utf-8")
    except Exception:
        pass

from vtoken import MemStore, UnifiedStore, check_file, compile_file

HERE = Path(__file__).resolve().parent
SESS = HERE / ".sessions"


def section(title):
    print(f"\n{'=' * 62}\n{title}\n{'=' * 62}")


def main():
    if SESS.exists():
        shutil.rmtree(SESS)

    # ---------------------------------------------------------------- compile
    section("1. vt compile — 规格书示例文档（含跨文件引用）")
    vtgs = []
    for name in ("auth.vt", "middleware.vt"):
        path = str(HERE / "doc" / name)
        out, parsed = compile_file(path)
        vtgs.append(out)
        print(f"  compiled {name}: {len(parsed.nodes)} nodes, {len(parsed.edges)} edges -> {Path(out).name}")

    report = check_file(str(HERE / "doc" / "auth.vt"))
    print(f"  check auth.vt: {report['status']}, "
          f"{len(report['warnings'])} dangling-ref warning(s) (单文件视角，合图后消失)")

    # ---------------------------------------------------------------- unified store
    section("2. UnifiedStore — 合并 doc 图 + 挂接 mem 会话")
    store = UnifiedStore.open(vtg_paths=vtgs, session_dir=str(SESS),
                              session="task_auth_impl", durability="fsync")
    st = store.stats()
    print(f"  merged doc graph: {st['doc_nodes']} nodes / {st['doc_edges']} edges")

    section("3. toc() — 冷启动入口索引（D20）")
    print(store.toc())

    section("4. vt.resolve('auth.sec_1', depth=2) — 跨文件语义检索")
    print(store.resolve("auth.sec_1", depth=2))

    section("5. resolve(type_filter=['RULE']) — 中间件视角只要约束（含反向 ENFORCED-BY 边）")
    print(store.resolve("middleware.jwt_verify", depth=2, type_filter=["RULE"]))

    # ---------------------------------------------------------------- mem writes
    section("6. vt.write() — 会话记忆锚定知识库节点（mem→doc 跨图边，D13）")
    a = store.write("用户确认使用 RS256，原因是微服务间需要公钥分发", edges=["auth.algo"])
    b = store.write("需确认 JWT_SECRET_KEY 的最小长度要求", tag="blocker",
                    edges=["auth.jwt_secret", a])
    print(f"  wrote {a}, {b} (返回即持久化，fsync)")
    print(f"\n  resolve('{b}', depth=1) — 从记忆节点出发拉出知识库上下文:")
    print("  " + store.resolve(b, depth=1).replace("\n", "\n  "))
    print(f"\n  resolve('auth.jwt_secret', depth=1) — 反向：doc 节点带出会话记忆:")
    print("  " + store.resolve("auth.jwt_secret", depth=1).replace("\n", "\n  "))

    # ---------------------------------------------------------------- latency
    section("7. 延迟实测（规格 §5 目标：write <2ms/fsync <5ms, resolve <10ms）")
    for durability in ("flush", "fsync"):
        s = MemStore(str(SESS), f"bench_{durability}", durability=durability,
                     checkpoint_every=0)
        times = []
        for i in range(300):
            t0 = time.perf_counter()
            s.write(f"benchmark node {i}", tag="bench")
            times.append((time.perf_counter() - t0) * 1000)
        times.sort()
        p50, p99 = statistics.median(times), times[int(len(times) * 0.99) - 1]
        print(f"  write  ({durability:5s}): p50={p50:6.3f}ms  p99={p99:6.3f}ms  (n=300)")
        s.close()

    times = []
    for _ in range(300):
        t0 = time.perf_counter()
        store.resolve("auth.sec_1", depth=2)
        times.append((time.perf_counter() - t0) * 1000)
    times.sort()
    print(f"  resolve(depth=2)  : p50={statistics.median(times):6.3f}ms  "
          f"p99={times[int(len(times) * 0.99) - 1]:6.3f}ms  (n=300)")

    # ---------------------------------------------------------------- recovery
    section("8. 崩溃恢复 — 重开会话（无干净关闭，依赖 WAL）")
    store.close()
    reopened = MemStore(str(SESS), "task_auth_impl", durability="fsync")
    print(f"  recovered: {reopened.recovered}")
    print(f"  resolve('{b}', depth=0) 恢复后可查: {reopened.resolve(b, depth=0)!r}")
    reopened.close()

    print("\ndemo 完成。")


if __name__ == "__main__":
    main()
