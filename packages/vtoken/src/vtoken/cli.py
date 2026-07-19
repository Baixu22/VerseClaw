"""``vt`` CLI — compile / check / resolve / stats / render / convert / mcp
(spec §8; resolve/stats/render/convert/mcp are Phase-3 items pulled forward
as thin wrappers for manual verification).

Error reports are ALWAYS machine-parseable JSON on stdout with a non-zero
exit code (spec §8.1), regardless of --json.
"""
from __future__ import annotations

import argparse
import json
import sys

from .compiler import check_file, compile_file
from .errors import VTError, VTParseError, VTResolveError, VTStoreError
from .graph import resolve_tir
from .renderer import render_file
from .store import UnifiedStore, load_doc_graphs


def _utf8_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:
            pass


def _print_json(obj: dict) -> None:
    print(json.dumps(obj, ensure_ascii=False, indent=2))


def cmd_compile(args) -> int:
    rc = 0
    for path in args.files:
        try:
            out, parsed = compile_file(path, args.out if len(args.files) == 1 else None)
        except VTParseError as e:
            _print_json(e.report())
            rc = 1
            continue
        if args.json:
            _print_json({"status": "ok", "file": path, "out": out,
                         "nodes": len(parsed.nodes), "edges": len(parsed.edges)})
        else:
            print(f"compiled {path} -> {out} ({len(parsed.nodes)} nodes, {len(parsed.edges)} edges)")
    return rc


def cmd_check(args) -> int:
    rc = 0
    for path in args.files:
        report = check_file(path, strict=args.strict)
        if report["status"] != "ok":
            rc = 1
        if args.json or report["status"] != "ok":
            _print_json(report)
        else:
            warn = report.get("warnings", [])
            suffix = f" ({len(warn)} warning(s))" if warn else ""
            print(f"ok {path}{suffix}")
            for w in warn:
                print(f"  warning line {w['line']}: {w['type']}: {w['message']}")
    return rc


def cmd_resolve(args) -> int:
    try:
        graph = load_doc_graphs(args.graph)
        tir = resolve_tir([graph], args.node, depth=args.depth,
                          type_filter=args.filter or None,
                          include_untyped=not args.no_untyped,
                          include_edges=args.edges,
                          max_nodes=args.max_nodes,
                          max_facets=args.max_facets)
    except (VTResolveError, VTStoreError) as e:
        _print_json({"status": "error", "errors": [{"type": type(e).__name__, "message": str(e)}]})
        return 1
    print(tir)
    return 0


def cmd_stats(args) -> int:
    try:
        graph = load_doc_graphs(args.graph)
    except (VTStoreError, VTError) as e:
        _print_json({"status": "error", "errors": [{"type": type(e).__name__, "message": str(e)}]})
        return 1
    store = UnifiedStore(doc_graph=graph)
    _print_json(store.stats())
    toc = store.toc()
    if toc:
        print("\n-- DEF index (toc) --")
        print(toc)
    return 0


def cmd_render(args) -> int:
    """T5.2: render .vt -> Markdown (doc or mem)."""
    try:
        md = render_file(args.file)
    except (VTParseError, VTError) as e:
        errors = e.report().get("errors", [{"type": type(e).__name__, "message": str(e)}]) \
            if hasattr(e, "report") else [{"type": type(e).__name__, "message": str(e)}]
        _print_json({"status": "error", "file": args.file, "errors": errors})
        return 1
    except OSError as e:
        _print_json({"status": "error", "file": args.file,
                     "errors": [{"type": type(e).__name__, "message": str(e)}]})
        return 1
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(md)
        print(f"rendered {args.file} -> {args.out} ({len(md)} bytes)")
    else:
        print(md, end="")
    return 0


def cmd_convert(args) -> int:
    """T5.3: convert --from-md (Markdown -> .vt). Lossy reverse of vt render.

    Quality statement (per HANDOFF T5.3 / P3.3): uses regex pattern matching
    on Markdown structure (H1/H2/H3/bullet edges). Not lossless — original
    .vt byte order is NOT preserved, comments already stripped by render.
    Round-trip .vt -> render -> convert -> .vt is structurally equivalent
    but not byte-identical.
    """
    from .md_to_vt import md_to_vt_string
    try:
        with open(args.file, "r", encoding="utf-8") as f:
            md_text = f.read()
    except OSError as e:
        _print_json({"status": "error", "file": args.file,
                     "errors": [{"type": "IOError", "message": str(e)}]})
        return 1
    try:
        vt_text = md_to_vt_string(md_text, mode=args.mode)
    except (VTParseError, VTError) as e:
        _print_json({"status": "error", "file": args.file,
                     "errors": [{"type": type(e).__name__, "message": str(e)}]})
        return 1
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(vt_text)
        print(f"converted {args.file} -> {args.out} ({len(vt_text)} bytes)")
    else:
        print(vt_text, end="")
    return 0


def cmd_mcp(args) -> int:
    """T5.4: MCP server (stdio JSON-RPC)."""
    from .mcp_server import run_stdio
    return run_stdio()


def cmd_search(args) -> int:
    """T5.5: vt search — TF-IDF over doc + mem graphs."""
    try:
        if args.session_dir and args.session:
            store = UnifiedStore.open(vtg_paths=args.graph or (),
                                      doc_sources=args.doc_sources,
                                      session_dir=args.session_dir,
                                      session=args.session,
                                      durability=args.durability)
        else:
            store = UnifiedStore.open(vtg_paths=args.graph or (),
                                      doc_sources=args.doc_sources)
        results = store.search(args.query, top_k=args.top_k)
    except (VTStoreError, VTError) as e:
        _print_json({"status": "error", "errors": [{"type": type(e).__name__, "message": str(e)}]})
        return 1
    _print_json({"results": results, "query": args.query})
    if store.mem is not None:
        store.close()
    return 0


def cmd_assemble(args) -> int:
    """v0.4: vt assemble — Context Assembly Engine 主入口。

    把 doc + mem 图内容组装为 token 预算可控的最终 prompt 片段。
    """
    try:
        # 构造 store：优先用 doc_sources（支持热加载），否则用 vtg_paths
        if args.doc_sources:
            store = UnifiedStore.open(doc_sources=args.doc_sources)
        else:
            store = UnifiedStore.open(vtg_paths=args.graph or ())
        # 额外 ingest 命令行指定的源
        if args.ingest:
            for src in args.ingest:
                store.ingest(src)
        result = store.assemble(task_hint=args.task_hint,
                                budget_tokens=args.budget)
    except (VTStoreError, VTError) as e:
        _print_json({"status": "error",
                     "errors": [{"type": type(e).__name__, "message": str(e)}]})
        return 1
    if args.explain:
        # 可读报告模式（Task H — 委托给 AssembleResult.format_explain_report）
        print(result.format_explain_report())
        if args.show_prompt:
            print("\n--- PROMPT ---")
            print(result.prompt, end="")
    else:
        _print_json({
            "prompt": result.prompt,
            "tokens_used": result.tokens_used,
            "tokens_budget": result.tokens_budget,
            "slot_breakdown": result.slot_breakdown,
            "nodes_included": result.nodes_included,
            "nodes_evicted": result.nodes_evicted,
            "dedup_count": result.dedup_count,
        })
    if store.mem is not None:
        store.close()
    return 0


def cmd_ingest(args) -> int:
    """v0.4: vt ingest — 把任意格式源 ingest 进 doc 图（不持久化，仅本次会话）。"""
    try:
        store = UnifiedStore.open(doc_sources=args.existing or None)
        total_added = 0
        for src in args.sources:
            added = store.ingest(src, source_type=args.source_type)
            total_added += added
            print(f"ingested {src}: +{added} nodes")
        print(f"total: +{total_added} nodes")
        if store.mem is not None:
            store.close()
    except (VTStoreError, VTError) as e:
        _print_json({"status": "error",
                     "errors": [{"type": type(e).__name__, "message": str(e)}]})
        return 1
    return 0


def main(argv=None) -> int:
    _utf8_stdio()
    parser = argparse.ArgumentParser(prog="vt", description="Verse Token toolchain (v0.3.1)")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("compile", help="compile doc-mode .vt files to .vtg")
    p.add_argument("files", nargs="+")
    p.add_argument("-o", "--out", help="output path (single input only)")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=cmd_compile)

    p = sub.add_parser("check", help="validate .vt files without compiling")
    p.add_argument("files", nargs="+")
    p.add_argument("--strict", action="store_true", help="dangling refs become errors")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=cmd_check)

    p = sub.add_parser("resolve", help="resolve a node to TIR from compiled .vtg graph(s)")
    p.add_argument("node")
    p.add_argument("--graph", action="append", required=True, help="a .vtg file (repeatable)")
    p.add_argument("--depth", type=int, default=2)
    p.add_argument("--filter", action="append", help="type filter (repeatable, e.g. --filter RULE)")
    p.add_argument("--no-untyped", action="store_true", help="skip untyped (~~) edges")
    p.add_argument("--edges", action="store_true", help="append relation lines to the TIR")
    p.add_argument("--max-nodes", type=int, default=None,
                   help="cap distinct node ids in the TIR (root always retained)")
    p.add_argument("--max-facets", type=int, default=None,
                   help="cap facets (parts) emitted per node; DEF facet always retained")
    p.set_defaults(func=cmd_resolve)

    p = sub.add_parser("stats", help="graph statistics + DEF index")
    p.add_argument("--graph", action="append", required=True)
    p.set_defaults(func=cmd_stats)

    p = sub.add_parser("render", help="T5.2: render .vt to Markdown (doc or mem)")
    p.add_argument("file", help="a .vt file")
    p.add_argument("-o", "--out", help="write to file instead of stdout")
    p.set_defaults(func=cmd_render)

    p = sub.add_parser("convert", help="T5.3: convert Markdown -> .vt")
    p.add_argument("file", help="a Markdown file")
    p.add_argument("--from-md", dest="from_md", action="store_true",
                   help="(flag kept for spec compat; convert always reads Markdown)")
    p.add_argument("--mode", choices=["doc", "mem"], default="doc",
                   help="target .vt mode (default: doc)")
    p.add_argument("-o", "--out", help="write to file instead of stdout")
    p.set_defaults(func=cmd_convert)

    p = sub.add_parser("mcp", help="T5.4: run MCP server over stdio (JSON-RPC)")
    p.set_defaults(func=cmd_mcp)

    p = sub.add_parser("search", help="T5.5: TF-IDF search over doc + mem graphs")
    p.add_argument("query", help="search query string")
    p.add_argument("--graph", action="append", help="a .vtg file (repeatable)")
    p.add_argument("--doc-source", action="append", dest="doc_sources",
                   help="a .vt or .vtg source (repeatable; enables hot reload)")
    p.add_argument("--top-k", type=int, default=10)
    p.add_argument("--session-dir", default=None, help="mem session directory")
    p.add_argument("--session", default=None, help="mem session name")
    p.add_argument("--durability", choices=["fsync", "flush"], default="fsync")
    p.set_defaults(func=cmd_search)

    # v0.4 — Context Assembly Engine main entry
    p = sub.add_parser("assemble",
                       help="v0.4: assemble a token-budgeted prompt from doc + mem graphs")
    p.add_argument("task_hint", help="current task description for BFS starting points")
    p.add_argument("--budget", type=int, default=32000, help="total token budget (default: 32000)")
    p.add_argument("--graph", action="append", help="a .vtg file (repeatable)")
    p.add_argument("--doc-source", action="append", dest="doc_sources",
                   help="a .vt or .vtg source (repeatable; enables hot reload)")
    p.add_argument("--ingest", action="append",
                   help="extra source to ingest (.md / .json, repeatable)")
    p.add_argument("--explain", action="store_true",
                   help="print a human-readable assembly report instead of JSON")
    p.add_argument("--show-prompt", action="store_true",
                   help="with --explain, also print the assembled prompt text")
    p.set_defaults(func=cmd_assemble)

    p = sub.add_parser("ingest",
                       help="v0.4: ingest heterogeneous sources (.md / .json) into a doc graph")
    p.add_argument("sources", nargs="+", help="source file paths to ingest")
    p.add_argument("--existing", action="append",
                   help="existing .vt / .vtg source to load first (repeatable)")
    p.add_argument("--source-type", choices=["auto", "md", "json"], default="auto",
                   help="force source type (default: auto-detect by extension)")
    p.set_defaults(func=cmd_ingest)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
