import os
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
STATE = Path(os.environ.get(
    'TF0014_FLAKY_STATE',
    _ROOT.parent / ('.tf0014-flaky-state-' + _ROOT.name),
))


def test_intermittent():
    n = int(STATE.read_text()) if STATE.exists() else 0
    STATE.write_text(str(n + 1))
    assert n % 2 == 0, f'第 {n} 次调用故意失败（模拟不稳定测试）'
