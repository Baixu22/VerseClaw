"""调试 strategy_c 的实际输出."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from p4_assembly_quality import _build_multi_source, _build_large_scenario, strategy_c_vt_assemble
from p21_write_efficiency import _scenarios

scenarios = _scenarios()
msc = _build_multi_source(scenarios[0])
print(f'== Scenario: {msc.name} ==')
print(f'task_hint: {msc.task_hint}')
print(f'ground_truth_ids: {msc.ground_truth_ids}')
print(f'high_priority_ids: {msc.high_priority_ids}')
print()

r = strategy_c_vt_assemble(msc, budget=32000)
nodes = r.audit_info['nodes_included']
print(f'nodes_included ({len(nodes)} 个):')
for i, nid in enumerate(nodes):
    marker = '  <-- HP' if nid in msc.high_priority_ids else ''
    print(f'  [{i:2d}] {nid}{marker}')
print()
print(f'high_priority_positions: {r.high_priority_positions}')
print(f'total nodes: {len(nodes)}')
print(f'top 25% cutoff: {len(nodes) / 4}')
print()
print('--- prompt (compact) 完整内容 ---')
for i, line in enumerate(r.prompt.split(chr(10))):
    print(f'  {i:2d}: {line[:80]}')
print()
print(f'tokens_used: {r.tokens_used}')
print(f'ground_truth_hit: {r.ground_truth_hit}')
print(f'ground_truth_missed: {r.ground_truth_missed}')

