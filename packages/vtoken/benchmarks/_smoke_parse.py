"""Smoke check: every scenario's .vt full / .vt+ns text must parse cleanly."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "src"))

from p21_write_efficiency import _scenarios
from vtoken import parse_vt

issues = 0
for sc in _scenarios():
    for fn_name, fn in [("vt_full", sc and None)]:  # placeholder, real calls below
        pass

for sc in _scenarios():
    for label, fn in [("vt_full", __import__("p21_write_efficiency").to_vt_full),
                      ("vt_ns",   __import__("p21_write_efficiency").to_vt_ns)]:
        text = fn(sc)
        try:
            parsed = parse_vt(text, filename=f"<{sc.name}:{label}>")
            print(f"OK  {sc.name:14s} {label:8s}  nodes={len(parsed.nodes)} edges={len(parsed.edges)}")
        except Exception as e:
            print(f"ERR {sc.name:14s} {label:8s}  {e}")
            issues += 1

sys.exit(1 if issues else 0)
