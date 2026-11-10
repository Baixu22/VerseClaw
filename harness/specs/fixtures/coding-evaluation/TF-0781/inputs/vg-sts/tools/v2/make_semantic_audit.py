# -*- coding: utf-8 -*-
"""生成 2.0 语义盘点（TF-0042）的**数据部分**：逐条规则 + 四份 schema 的字段级差异。

产出是**数据**（JSON），人工判定"已定/待议"写在同目录的 README 里——
这样"盘点"和"我的结论"分开，换人复核时不会把结论当成事实。
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
# 权威树 `contracts/vg-sts/v2/` 与本脚本所在的 `contracts/vg-sts/tools/v2/` **分开放**
# （生成脚本不在交付树里，见 from-vg/0032 B2），所以契约根不能按 `__file__` 推。
DRAFT = Path(os.environ.get("STS_V2_TREE",
                            Path(__file__).resolve().parent.parent.parent / "v2")).resolve()
REPO = DRAFT.parent.parent.parent
sys.path.insert(0, str(REPO / "src"))

SCHEMAS = {
    "request": "candidate_request.schema.json",
    "plan": "test_plan.schema.json",
    "result": "execution_result.schema.json",
    "refusal": "plan_refusal.schema.json",
}


def _load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    # 检查器与本脚本**同在 tools/v2/**（生成脚本不在交付树里）
    spec = importlib.util.spec_from_file_location(
        "_v2checker", Path(__file__).resolve().parent / "check_draft.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    v1 = REPO / "contracts" / "vg-sts" / "v1"
    out: dict = {
        "schema": "smart-test-sorter/contract-v2-semantic-audit/v1",
        "draft_commit": "",   # 由调用方填
        "rules": [],
        "schema_delta": {},
        "reachability": mod.schema_reachability_problems(),
        "registered_rules": list(mod.SEMANTIC_RULES),
        "read_by_rule": {k: {d: list(f) for d, f in v.items()}
                         for k, v in mod.RULE_DOCUMENT_FIELDS.items()},
    }

    # ① 12 条规则：id / 为什么 / 反例（哪条样例证明它）/ 可达性登记
    for rid, why in mod.SEMANTIC_RULES.items():
        n = rid.split("-", 1)[0]
        out["rules"].append({
            "id": rid,
            "why": why,
            "invalid_samples": sorted(
                p.name for p in (DRAFT / "samples" / "invalid").glob("*.json")
                if n in (p.read_text(encoding="utf-8") or "") or True
            ) if n in {rid} else [],
            "read_fields": {d: list(f) for d, f in mod.RULE_DOCUMENT_FIELDS.get(rid, {}).items()},
        })

    # ② 四份 schema 的字段级差异（v2 相对 v1）
    for kind, fname in SCHEMAS.items():
        v2 = _load(DRAFT / "schema" / fname)
        v1p = v1 / "schema" / fname
        v1s = _load(v1p) if v1p.is_file() else {"properties": {}, "required": []}
        v2p, v2r = set(v2.get("properties") or {}), set(v2.get("required") or [])
        v1p_, v1r = set(v1s.get("properties") or {}), set(v1s.get("required") or [])
        out["schema_delta"][kind] = {
            "added": sorted(v2p - v1p_),
            "removed": sorted(v1p_ - v2p),
            "now_required": sorted(v2r - v1r),
            "no_longer_required": sorted(v1r - v2r),
            "extra_top_level_keys": sorted(set(v2) - {"$schema", "$id", "title", "description",
                                                      "type", "properties", "required",
                                                      "additionalProperties", "version_policy"}),
        }

    # 产物写到 **tools/v2/**，**不是**权威树——写进交付树会变成「未登记文件」，
    # 接收方会据此拒收（from-vg/0032 B2）。这条是有测试守的
    # （test_generators_live_outside_the_delivery_tree）。
    dest = Path(__file__).resolve().parent / "semantic-audit.json"
    dest.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"已写出 {dest.name}")
    print(f"  规则 {len(out['rules'])} 条 | 可达性问题 {len(out['reachability'])} 处")
    for kind, d in out["schema_delta"].items():
        print(f"  {kind:8s} 新增 {len(d['added'])} / 删除 {len(d['removed'])} / "
              f"变必填 {len(d['now_required'])} / 不再必填 {len(d['no_longer_required'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
