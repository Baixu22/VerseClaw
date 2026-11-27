from pathlib import Path
import ast
import hashlib
import json

root = Path(__file__).parent
source = root / 'run-serial-development-r3.py'
tree = ast.parse(source.read_text(encoding='utf-8'))
gate = ast.Module(body=[node for node in tree.body if
    isinstance(node, ast.FunctionDef) and node.name == 'require_all_passed'
    or isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'COUNT_FIELDS' for target in node.targets)], type_ignores=[])
namespace = {}
exec(compile(gate, str(source), 'exec'), namespace)
check = namespace['require_all_passed']
complete = dict(success=True, numTotalTests=2, numPassedTests=2, numFailedTests=0, numPendingTests=0, numTodoTests=0)
check(complete)
controls = {
    'todo': dict(numPassedTests=1, numTodoTests=1),
    'todo-with-inconsistent-passed-count': dict(numTodoTests=1),
    'skipped': dict(numPassedTests=1, numPendingTests=1),
    'failed': dict(numPassedTests=1, numFailedTests=1),
    'passed-count-mismatch': dict(numPassedTests=1),
    'missing-todo-count': dict(numTodoTests=None),
    'empty-result': dict(numTotalTests=0, numPassedTests=0),
    'unsuccessful-run': dict(success=False),
    'non-integer-count': dict(numPassedTests=2.0),
}
for name, changes in controls.items():
    try:
        check({**complete, **changes})
    except ValueError:
        continue
    raise AssertionError('Gate accepted ' + name)

report = dict(driven_by='agent', actor='codex/tf0950-relay', status='passed',
    runnerSha256=hashlib.sha256(source.read_bytes()).hexdigest(),
    acceptedControls=['complete-result'], rejectedControls=list(controls))
destination = root / 'development-gate-hardening.json'
assert not destination.exists(), 'Preserve the earlier result'
destination.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report))
