#!/usr/bin/env python
"""为 2.0 草案生成/核对 `manifest.json`（与 v1 同一套 `digests-authoritative` 约定）。

**为什么不手写摘要**：手写必然漂移（v1 就吃过"称 26 条实际 29 条"的亏）。这个脚本按目录现算，
并把"覆盖了哪些文件"写进 `source_note`，让计数与磁盘一致可核。

```bash
python contracts/vg-sts/v2-draft/make_manifest.py           # 现算并写出 manifest.json
python contracts/vg-sts/v2-draft/make_manifest.py --check    # 只核对，不写（退出码 0/1）
```

`manifest.json` 自身不在 `digests` 内（无法自摘要）——与 v1 同一例外。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

DRAFT = Path(__file__).resolve().parent
MANIFEST = DRAFT / "manifest.json"


def _force_utf8_output() -> None:
    """stdout/stderr 一律 UTF-8：本脚本要打印中文，而 Windows 默认控制台是 GBK
    ⇒ 不兜住就会 `UnicodeEncodeError`。与 `check_draft.py` 同口径。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
        except (AttributeError, OSError, ValueError):
            pass


_force_utf8_output()

# 覆盖范围：schema / 样例 / 配对夹具 / README。刻意**不含**本脚本与 manifest 自身。
def _covered_files() -> list[Path]:
    out: list[Path] = []
    readme = DRAFT / "README.md"
    if readme.is_file():
        out.append(readme)
    out.extend(sorted((DRAFT / "schema").rglob("*.json")))
    out.extend(sorted((DRAFT / "samples").rglob("*.json")))
    return out


def _entries() -> dict[str, str]:
    return {
        path.relative_to(DRAFT).as_posix(): "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()
        for path in _covered_files()
    }


def _counts(files: dict[str, str]) -> dict[str, int]:
    counts = {"README": 0, "schema": 0, "valid": 0, "invalid": 0, "pairs": 0}
    for rel in files:
        if rel == "README.md":
            counts["README"] += 1
        elif rel.startswith("schema/"):
            counts["schema"] += 1
        elif rel.startswith("samples/valid/"):
            counts["valid"] += 1
        elif rel.startswith("samples/invalid/"):
            counts["invalid"] += 1
        elif rel.startswith("samples/pairs/"):
            counts["pairs"] += 1
    return counts


def _implemented_rules() -> tuple[str, ...]:
    """从 `check_draft.SEMANTIC_RULES` 取**实际实现**的规则 id（唯一真源）。

    刻意不手抄：手抄过一次，R12 就漏登记了（VG 0023 §三 抓到的）。这里 import 检查器模块
    并读它的字典——它 `import smart_sorter`，若在纯 stdlib 环境跑不动就退回读源码的
    `SEMANTIC_RULES = {` 字面块（宁可粗一点，也不要再次手抄）。
    """
    import importlib.util

    checker = DRAFT / "check_draft.py"
    try:
        spec = importlib.util.spec_from_file_location("_v2_draft_checker", checker)
        if spec and spec.loader:
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            rules = getattr(mod, "SEMANTIC_RULES", None)
            if isinstance(rules, dict) and rules:
                return tuple(rules)
    except Exception:
        pass
    # 退路：从源码里按行取字典键（不求完美，只求与手抄相比更不易漏）。
    keys: list[str] = []
    inside = False
    for line in checker.read_text(encoding="utf-8").splitlines():
        if line.startswith("SEMANTIC_RULES = {"):
            inside = True
            continue
        if inside and line.strip() == "}":
            break
        if inside:
            stripped = line.strip().strip(",")
            if stripped.startswith('"') and stripped.endswith('"'):
                keys.append(stripped.strip('"'))
    if not keys:
        raise RuntimeError("无法从 check_draft.py 读到 SEMANTIC_RULES")
    return tuple(keys)


def build() -> dict:
    files = _entries()
    counts = _counts(files)
    total = len(files)
    return {
        "contract": "vg-sts",
        "protocol_version": "2.0",
        "product": "smart-test-sorter",
        "product_version": "0.1.0",
        "produced_by": "STS:TF-0040",
        "consumer": "VG（待接收：接收步骤见 README §5）",
        "source_commit": None,
        "version_policy": "digests-authoritative",
        "status": "draft",
        "status_note": (
            "**这是草案，不是权威契约**。权威仍是 contracts/vg-sts/v1/ + 其 manifest 的 digests。"
            "本目录未被任何生产路径消费（产品入口仍只产出 1.1 文档），也不随 wheel/sdist 发布。"
            "版本号 2.0 是提议，最终由权威方定稿。"
        ),
        "source_note": (
            f"覆盖范围：以下方 digests 为唯一权威内容口径（{total} 条 = README {counts['README']} + "
            f"schema {counts['schema']} + valid {counts['valid']} + invalid {counts['invalid']} + "
            f"pairs {counts['pairs']}）。manifest 自身与生成脚本不在覆盖内（前者无法自摘要；"
            "后者不是契约内容）。摘要由 make_manifest.py 现算，不手写。"
        ),
        "objects": ["candidate_request", "test_plan", "execution_result", "plan_refusal"],
        "requested_protocol_version": "2.0",
        "compatibility": {
            "supported_protocol_versions_if_adopted": ["2.0"],
            "v1_1_support": (
                "1.1 保留**明确支持范围**：它仍是权威版本，本草案不改变其任何文件或语义。"
                "升级到 2.0 会破坏旧生产者（新增必填字段），因此必须作为新版本接受，"
                "且**旧文档缺的新字段不得默认补成『有效』**——不支持就显式拒绝。"
            ),
            "why_breaking": [
                "request 新增必填 content_manifest 与 identities.content_identity/environment_identity 的结构变化",
                "plan 新增必填 content_identity / policy_identity",
                "result 新增必填 content_identity / execution_identity",
                "refusal 的 refusal_code 封闭枚举 → refusal_kind 六类 + 新增必填 content_confirmed",
            ],
        },
        "semantic_rules": {
            # **从检查器实际实现里取**（2026-10-02 按 VG 0023 §三 改）。
            # 之前这里是**手写**的清单，于是新增 R12 时检查器实现了、清单忘了加
            # ⇒ 读 manifest 的消费者根本不知道有这条规则（VG 钉成了期望值表的一条）。
            # 现在登记与实现**不可能分叉**：加规则只改 check_draft.py 一处。
            "count": len(_implemented_rules()),
            "implemented_by": "check_draft.py（本目录，非权威实现；VG 应自行复核同一批样例）",
            "registered_from": (
                "check_draft.SEMANTIC_RULES —— 本清单由 make_manifest.py 从检查器"
                "**实际实现**生成，不手写"
            ),
            "list": list(_implemented_rules()),
        },
        "digests": {"algorithm": "sha256", **files},
        "replay": {
            "validate_all_samples": "python contracts/vg-sts/v2-draft/check_draft.py",
            "unit_tests": "python -m pytest tests/test_contract_v2_draft.py -q",
            "regenerate_digests": "python contracts/vg-sts/v2-draft/make_manifest.py",
            "check_digests": "python contracts/vg-sts/v2-draft/make_manifest.py --check",
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="make_manifest", description=__doc__)
    parser.add_argument("--check", action="store_true", help="只核对，不写")
    args = parser.parse_args(argv)

    fresh = build()
    if args.check:
        if not MANIFEST.is_file():
            print("manifest.json 不存在；先跑一次不带 --check 的", file=sys.stderr)
            return 1
        on_disk = json.loads(MANIFEST.read_text(encoding="utf-8"))
        if on_disk.get("digests") != fresh["digests"]:
            disk_keys = set((on_disk.get("digests") or {}))
            fresh_keys = set(fresh["digests"])
            print("manifest 摘要与磁盘不一致：", file=sys.stderr)
            for rel in sorted((disk_keys ^ fresh_keys) - {"algorithm"}):
                print(f"  {'磁盘多出' if rel in disk_keys else '磁盘缺少'}：{rel}", file=sys.stderr)
            for rel in sorted(disk_keys & fresh_keys):
                if on_disk["digests"][rel] != fresh["digests"][rel]:
                    print(f"  摘要不同：{rel}", file=sys.stderr)
            return 1
        print(f"manifest 摘要与磁盘一致（{len(fresh['digests']) - 1} 条）")
        return 0

    MANIFEST.write_text(json.dumps(fresh, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"已写出 {MANIFEST.name}：{len(fresh['digests']) - 1} 条摘要")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
