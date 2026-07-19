"""调试大场景 search 召回情况."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from p4_assembly_quality import _build_large_scenario, strategy_c_vt_assemble
from p21_write_efficiency import _scenarios
from vtoken import UnifiedStore
from vtoken.ingest import ingest_memory
from vtoken.ingest.md_adapter import ingest_markdown

# 大场景
msc = _build_large_scenario(0)
print(f'== 大场景: {msc.name} ==')
print(f'task_hint: {msc.task_hint}')
print(f'ground_truth_ids ({len(msc.ground_truth_ids)}): {msc.ground_truth_ids[:5]}')
print(f'high_priority_ids ({len(msc.high_priority_ids)}): {msc.high_priority_ids[:5]}')
print()

store = UnifiedStore.open(doc_sources=[])
md_graph = ingest_markdown(msc.md_text, source_path=f"{msc.name}.md")
store.doc = md_graph
mem_graph = ingest_memory(msc.memory_entries)
store.doc.merge(mem_graph)

print(f"== 总节点数: {len(store.doc.nodes)} ==")
h2_count = sum(1 for nid in store.doc.nodes if "." in nid)
print(f"H2 节点数: {h2_count}")

# search
results = store.search(msc.task_hint, top_k=100)
print(f"\n== search 结果 (top_k=100): {len(results)} 条 ==")
for r in results[:5]:
    print(f"  {r['id']:<40s}  score={r.get('score', 0):.3f}  snippet={r.get('snippet', '')[:50]}")
print("  ...")

# 跑 assemble 看 nodes_included
r = strategy_c_vt_assemble(msc, budget=32000)
print(f"\n== assemble 结果 ==")
print(f"tokens_used: {r.tokens_used}")
print(f"nodes_included ({len(r.audit_info['nodes_included'])}):")
for i, nid in enumerate(r.audit_info['nodes_included'][:10]):
    marker = '  <-- HP' if nid in msc.high_priority_ids else ''
    print(f"  [{i:2d}] {nid}{marker}")
if len(r.audit_info['nodes_included']) > 10:
    print(f"  ... 共 {len(r.audit_info['nodes_included'])} 个")

store.close()

