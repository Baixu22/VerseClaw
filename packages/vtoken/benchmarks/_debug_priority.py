"""调试节点 priority 与 slot 字段."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from p4_assembly_quality import _build_multi_source, _build_large_scenario
from p21_write_efficiency import _scenarios
from vtoken import UnifiedStore
from vtoken.ingest import ingest_memory
from vtoken.ingest.md_adapter import ingest_markdown

scenarios = _scenarios()
msc = _build_multi_source(scenarios[0])

print(f'== Scenario: {msc.name} ==')
print(f'task_hint: {msc.task_hint}')
print(f'ground_truth_ids: {msc.ground_truth_ids}')
print(f'high_priority_ids: {msc.high_priority_ids}')
print()

store = UnifiedStore.open(doc_sources=[])
md_graph = ingest_markdown(msc.md_text, source_path=f"{msc.name}.md")
if store.doc is None:
    store.doc = md_graph
else:
    store.doc.merge(md_graph)
mem_graph = ingest_memory(msc.memory_entries)
store.doc.merge(mem_graph)

print("== ingest_markdown 后的所有节点 ==")
for nid, node in store.doc.nodes.items():
    print(f"  {nid:<40s}  slot={node.slot!r:<10s}  priority={node.priority}  parts_types={[p[0] for p in node.parts]}")

store.close()

