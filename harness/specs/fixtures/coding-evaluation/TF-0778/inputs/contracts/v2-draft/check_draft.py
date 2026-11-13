#!/usr/bin/env python
"""2.0 草案的检查器：**结构**用现有 schema 引擎，**语义**按本草案提出的规则实现。

这不是生产路径的一部分，也不权威——它存在是为了让"2.0 草案到底要求什么"变成**可执行、
可对拍**的东西，而不是一段散文。VG 接收时应当用**自己的**实现复核同一批样例。

```bash
python contracts/vg-sts/v2-draft/check_draft.py            # 全部样例
python contracts/vg-sts/v2-draft/check_draft.py --json out.json
```

退出码：0 全部符合预期 / 1 有不符合项 / 2 用法或输入错误。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

DRAFT = Path(__file__).resolve().parent
REPO = DRAFT.parent.parent.parent
sys.path.insert(0, str(REPO / "src"))


def _force_utf8_output() -> None:
    """stdout/stderr 一律 UTF-8：本脚本要打印中文，而 Windows 默认控制台是 GBK
    ⇒ 不兜住就会 `UnicodeEncodeError`，让"检查器自己崩"看起来像"样例有问题"。
    与 `smart_sorter.plan_request._force_utf8_output` 同口径。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
        except (AttributeError, OSError, ValueError):
            pass


_force_utf8_output()

from smart_sorter import contracts  # noqa: E402

# 样例文件名里的"应被拒"目录；valid 目录必须全过。
VALID_DIR = DRAFT / "samples" / "valid"
INVALID_DIR = DRAFT / "samples" / "invalid"

# 文件名 -> 该样例**期望的语义拒因 id**（结构性拒因不必列在这里）。
SEMANTIC_EXPECTATIONS = {
    "refusal_full_available_without_content.json": "R6-full-only-when-content-confirmed",
    "plan_order_not_permutation_of_selected.json": "R10-order-is-permutation-of-selected",
    "result_execution_end_unconfirmed_but_valid.json": "R9-invalid-or-unconfirmed-cannot-be-valid",
    # 2026-10-02 按 VG 复现新增：前两条是**语义**判据，结构层本来就该放行。
    "request_bare_short_content_value.json": "R2-label-is-not-identity",
    "request_manifest_only_source_entry.json": "R3-manifest-covers-config-and-data",
}

# 草案语义规则。每条都给出"为什么要它"——VG 复核时对着理由看，比对着措辞猜有用。
SEMANTIC_RULES = {
    "R1-protocol-is-2.0": "本草案只讨论 2.0；其它版本按各自契约校验，不在这里静默兼容。",
    "R2-label-is-not-identity": "candidate@<7 位> 只作展示：content_identity.value 必须是完整身份，不能拿 label 当比较依据。",
    "R3-manifest-covers-config-and-data": "内容清单必须真的覆盖会读到的输入（含 config/data）；只有 source/test 的清单不算数。",
    "R4-digest-carries-algorithm": "每个摘要都带算法前缀，否则两版之间不可比。",
    "R5-exclusion-policy-is-versioned": "排除规则必须有版本化 id，且必须显式声明换行/软链/子模块/不可读文件的行为。",
    "R6-full-only-when-content-confirmed": "只有 content_confirmed=true 且确实收集到全集时才允许保守全量；内容没确认就不能声称可全量。",
    "R7-unconfirmed-must-be-listed": "拒绝时要把『没确认到哪些观察』逐项列出来，不能只给一句笼统失败。",
    "R8-plan-carries-its-own-identity": "计划自带完整内容身份与政策身份；执行结果自带执行身份与前后观察（不能只靠 request 才能核对）。",
    "R9-invalid-or-unconfirmed-cannot-be-valid": "观测为 unconfirmed/mismatch，或执行身份与计划不一致时，不得声称 validity=valid。",
    "R10-order-is-permutation-of-selected": "执行顺序必须是选集的排列；full 时选集必须等于收集全集（与 1.1 同精神，只是换到新字段上重申）。",
    "R11-cross-document-binding": "request/plan/result 必须同指一次候选：request_id/plan_id/protocol_version/target_identity 以及**完整内容身份**（kind + value + manifest_digest 三项）都要一致——这才是 2.0 想解决的『同一个短标签下换了磁盘』。",
    "R12-environment-identity-must-match-plan": "内容一致 ≠ 环境一致：同一份内容在不同解释器/依赖/平台上行为可以不同。plan 记了 expected_environment_identity 就比，没记不判（**不判 ≠ 已核对通过**）。",
}

# ---- 可达性守卫（2026-10-03，按 VG 0029 §二 ㈡ 的判据）----------------------
#
# VG 那边栽过一次：他们在**中间态**读到 `test_plan.schema.json` 还没声明
# `expected_environment_identity`，而根 schema 全是 `additionalProperties:false`
# ⇒ "带这个字段的 plan 会在结构层被拒 ⇒ R12 永远不触发"。
# 他们因此把『可达性』改成了**机械守卫**，并把判据讲清楚了：
#
#   检查器从文档上读的**顶层**字段，必须在**对应那份** schema 的 properties 里声明得下。
#   **必须逐文档映射，不能取并集**——并集会让"这条字段在别的文档里有"变成通行证，
#   而实际是"在**这份**文档里根本进不来" ⇒ 规则不可达。
#
# 下面是"哪条规则从哪种文档上读哪些顶层字段"的人工登记。
# 它的作用不是自动推导（那要解析代码路径），而是把**契约**显式摆出来，
# 让"改 schema 忘了改这里"或反之都能被机械比对出来。
RULE_DOCUMENT_FIELDS: dict[str, dict[str, tuple[str, ...]]] = {
    "R1-protocol-is-2.0": {"*": ("protocol_version",)},
    "R2-label-is-not-identity": {"request": ("identities",)},
    "R3-manifest-covers-config-and-data": {"request": ("content_manifest",)},
    "R4-digest-carries-algorithm": {"request": ("content_manifest",)},
    "R5-exclusion-policy-is-versioned": {"request": ("content_manifest",)},
    "R6-full-only-when-content-confirmed": {
        "refusal": ("content_confirmed", "conservative_full_available", "attempted_collection")},
    "R7-unconfirmed-must-be-listed": {"refusal": ("content_confirmed", "unconfirmed")},
    "R8-plan-carries-its-own-identity": {
        "plan": ("content_identity", "policy_identity"),
        "result": ("content_identity", "execution_identity", "observations")},
    "R9-invalid-or-unconfirmed-cannot-be-valid": {
        "result": ("observations", "validity"),
        # 第二半（执行身份 vs 计划）读 plan 侧那个**可选**期望字段
        "plan": ("expected_execution_identity",)},
    "R10-order-is-permutation-of-selected": {
        "plan": ("selected", "order", "collected", "selection_scope")},
    "R11-cross-document-binding": {
        # request 侧实际读的是 request_id / protocol_version / identities
        #（**没有** target_identity——那是 plan/result 的展示字段，request 用 target）。
        "request": ("request_id", "protocol_version", "identities"),
        "plan": ("request_id", "plan_id", "protocol_version", "target_identity", "content_identity"),
        "result": ("request_id", "plan_id", "protocol_version", "target_identity", "content_identity")},
    "R12-environment-identity-must-match-plan": {
        "plan": ("expected_environment_identity",),
        "result": ("environment_identity",)},
}

_SCHEMA_FILES = {
    "request": "candidate_request.schema.json",
    "plan": "test_plan.schema.json",
    "result": "execution_result.schema.json",
    "refusal": "plan_refusal.schema.json",
}


def schema_reachability_problems() -> list[str]:
    """检查器读的**顶层**字段，是否在**对应那份** schema 的 properties 里声明得下。

    规则读不到字段 ⇒ 那条规则**不可达**：加了反例、写了规则表、登记了 count，
    但真实文档根本进不来 ⇒ 全部空转。VG 0029 §二 ㈡ 给的判据，**逐文档映射、不取并集**。
    """
    problems: list[str] = []
    schemas: dict[str, set[str]] = {}
    for rule_id, per_doc in RULE_DOCUMENT_FIELDS.items():
        for doc, fields in per_doc.items():
            if doc == "*":
                docs = list(_SCHEMA_FILES)
            else:
                docs = [doc]
            for d in docs:
                if d not in schemas:
                    path = DRAFT / "schema" / _SCHEMA_FILES[d]
                    if not path.is_file():
                        schemas[d] = set()
                        problems.append(f"{rule_id}: 找不到 {d} 的 schema（{path.name}）")
                        continue
                    schemas[d] = set(_load(path).get("properties") or {})
                for field in fields:
                    if field not in schemas[d]:
                        problems.append(
                            f"{rule_id}: 从 {d} 读的顶层字段 {field!r} 未在 "
                            f"{_SCHEMA_FILES[d]} 的 properties 里声明 ⇒ 该判据在 {d} 上**不可达**"
                        )
    return problems


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _kind_of(name: str) -> str:
    """按文件名判断文档种类（与 v1 样例目录同一约定）。"""
    if name.startswith("request"):
        return "request"
    if name.startswith("plan"):
        return "plan"
    if name.startswith("result"):
        return "result"
    if name.startswith("refusal"):
        return "refusal"
    raise ValueError(f"无法从文件名判断种类：{name}")


def structural_errors(doc: object, kind: str) -> list[str]:
    """结构校验：**复用 v1 的 schema 引擎**，只把根指向草案目录。"""
    return contracts.validate_schema(doc, kind, root=DRAFT)


def semantic_errors(doc: dict, kind: str) -> list[str]:
    """草案语义规则。只覆盖"当前样例要考的那些"，不是完整实现。"""
    errs: list[str] = []
    if doc.get("protocol_version") != "2.0":
        errs.append("R1-protocol-is-2.0: protocol_version 必须为 '2.0'")

    if kind == "request":
        content = (doc.get("identities") or {}).get("content_identity") or {}
        label = content.get("label") or ""
        value = content.get("value") or ""
        # R2（2026-10-02 按 VG 复现加强）：原先只在"value 恰好等于 label 尾巴"时判。
        # 那样**任何没有 label 的文档都能用 7 位裸值蒙过去**——而 7 位短标签就是
        # 我们要淘汰的形态。所以改成：**7 位（或更短）纯 hex 一律不算完整身份**，
        # 与 label 是否同形无关。
        if re.fullmatch(r"[0-9a-f]{7,8}", value.strip().lower()) and len(value.strip()) <= 8:
            errs.append(
                "R2-label-is-not-identity: content_identity.value 是 "
                f"{value!r}（{len(value)} 位短 hex）——短标签只能作展示，不能当身份"
            )
        elif label and label.startswith("candidate@") and value == label.split("@", 1)[1]:
            errs.append(
                "R2-label-is-not-identity: content_identity.value 退回了展示标签的尾巴"
                "（它只能作展示，不能当身份）"
            )
        manifest = doc.get("content_manifest") or {}
        entries = manifest.get("entries") or []
        roles = {e.get("role") for e in entries}
        # 只要求"声明的输入覆盖了会被读到的类别"：至少 source/test 之外要能出现 config 或 data。
        # **不看条目数**（2026-10-02 按 VG 复现修）：原判据带 `len(entries) > 1`，于是"清单只留
        # 一条 source"能整份放过去——而那正是"盖不住配置与数据变化"最该被抓的情形。
        if not roles & {"config", "data"}:
            errs.append(
                "R3-manifest-covers-config-and-data: 清单里既没有 config 也没有 data——"
                f"只列了 {sorted(r for r in roles if r)}，盖不住配置与数据的变化"
            )
        for entry in entries:
            digest = str(entry.get("digest") or "")
            if ":" not in digest:
                errs.append(
                    f"R4-digest-carries-algorithm: {entry.get('path')} 的摘要不带算法前缀"
                )
                break
        if not manifest.get("exclusion_policy_id"):
            errs.append("R5-exclusion-policy-is-versioned: 缺 exclusion_policy_id")
        # R5 的另一半（2026-10-02 按 VG 复现修）：三个"怎么对待边界情况"的行为**是必填**，
        # 缺了就不算"明确声明了行为"，而"不声明"与"按空处理"只差一步。
        for field in ("symlinks", "submodules", "unreadable_files"):
            if field not in manifest:
                errs.append(
                    f"R5-exclusion-policy-is-versioned: content_manifest 缺 {field}——"
                    "边界行为必须**显式**声明，不声明就等于没有规则"
                )

    if kind == "refusal":
        confirmed = doc.get("content_confirmed")
        full = doc.get("conservative_full_available")
        collected = (doc.get("attempted_collection") or {}).get("succeeded")
        if full and not (confirmed and collected):
            errs.append(
                "R6-full-only-when-content-confirmed: 内容未确认（或没收集到全集）却声称可保守全量"
            )
        if not confirmed and not (doc.get("unconfirmed") or []):
            errs.append("R7-unconfirmed-must-be-listed: 内容未确认，但没列出没确认到哪一项")

    if kind == "plan":
        selected = list(doc.get("selected") or [])
        order = list(doc.get("order") or [])
        collected = list(doc.get("collected") or [])
        scope = doc.get("selection_scope")
        if sorted(order) != sorted(selected):
            errs.append(
                "R10-order-is-permutation-of-selected: order 不是 selected 的排列"
                f"（order={len(order)} 项、selected={len(selected)} 项）"
            )
        if scope == "full" and sorted(selected) != sorted(collected):
            errs.append("R10-order-is-permutation-of-selected: scope=full 时 selected 必须等于 collected 全集")

    if kind == "result":
        obs = doc.get("observations") or {}
        after = obs.get("after_execution")
        before = obs.get("before_execution")
        if doc.get("validity") == "valid" and (after in ("unconfirmed", "mismatch")
                                               or before in ("unconfirmed", "mismatch")):
            errs.append(
                "R9-invalid-or-unconfirmed-cannot-be-valid: "
                f"观察为 before={before}/after={after} 却声称 valid"
            )

    return errs


def binding_errors(request: dict, plan: dict, result: dict | None = None) -> list[str]:
    """跨文档绑定（R11）：三方是否**同指一次候选**。

    2.0 的关键点在这里：除了 1.1 已经核的 `request_id`/`plan_id`/`target_identity`，
    还要核对**完整内容身份**——否则"同一个 7 位短标签下换了磁盘"在绑定层面依然看不出来。
    """
    errs: list[str] = []
    pairs = [("request", request), ("plan", plan)]
    if result is not None:
        pairs.append(("result", result))

    request_id = request.get("request_id")
    for label, doc in pairs:
        if doc.get("request_id") != request_id:
            errs.append(f"R11-cross-document-binding: {label}.request_id 与 request 不一致")
        if doc.get("protocol_version") != request.get("protocol_version"):
            errs.append(f"R11-cross-document-binding: {label}.protocol_version 与 request 不一致")

    if result is not None and result.get("plan_id") != plan.get("plan_id"):
        errs.append("R11-cross-document-binding: result.plan_id 与 plan 不一致")

    plan_target = plan.get("target_identity")
    plan_content = plan.get("content_identity") or {}

    # request 侧：展示标签不得与计划的标签冲突；**完整身份三项**（kind/value/manifest_digest）
    # 都必须与计划一致（2026-10-02 按 VG 复现修：原先只比 `value`，于是"同 value、�� kind"
    # 或"同 value、异 manifest_digest"整份放过——而那正是 2.0 要堵的漂移）。
    req_content = (request.get("identities") or {}).get("content_identity") or {}
    if req_content.get("label") and req_content["label"] != plan_target:
        errs.append(
            f"R11-cross-document-binding: request 的展示标签 {req_content['label']!r} ≠ "
            f"plan.target_identity {plan_target!r}"
        )
    plan_content_full = plan.get("content_identity") or {}
    for field, label in (("kind", "kind"), ("value", "完整身份"), ("manifest_digest", "清单摘要")):
        want = plan_content_full.get(field)
        got = req_content.get(field)
        if want is not None and got is not None and got != want:
            errs.append(
                f"R11-cross-document-binding: request.content_identity.{label} 与 plan 不一致"
                f"（{got!r} vs {want!r}）"
            )

    # result 侧：展示标签、**完整身份三项**、以及**执行身份**都要与计划一致。
    if result is not None:
        if result.get("target_identity") != plan_target:
            errs.append(
                f"R11-cross-document-binding: result.target_identity {result.get('target_identity')!r} ≠ "
                f"plan.target_identity {plan_target!r}"
            )
        res_content = result.get("content_identity") or {}
        for field, label in (("kind", "kind"), ("value", "完整身份"), ("manifest_digest", "清单摘要")):
            want = plan_content_full.get(field)
            got = res_content.get(field)
            if want is not None and got is not None and got != want:
                errs.append(
                    f"R11-cross-document-binding: result.content_identity.{label} 与 plan 不一致"
                    f"（{got!r} vs {want!r}）"
                )
        # R9 的可判形式（2026-10-02 按 VG 指正补）：计划侧**记下期望的 execution_identity**，
        # 执行结果必须与它一致。原先 R9 的标题里有"执行身份与计划不一致"这半句，却**没有**判据——
        # 现在 plan 可选地记 `expected_execution_identity`；记了就是可判的，没记就不判。
        want_exec = plan.get("expected_execution_identity")
        got_exec = (result.get("execution_identity") or {})
        if want_exec:
            for field in ("execution_id", "interpreter"):
                if field in want_exec and field in got_exec and got_exec[field] != want_exec[field]:
                    errs.append(
                        "R9-invalid-or-unconfirmed-cannot-be-valid: 执行身份与计划不一致"
                        f"（{field}={got_exec[field]!r} vs 计划期望 {want_exec[field]!r}）"
                    )

        # R12（2026-10-02 新增，见 README §2）：**环境身份**也必须与计划一致。
        # 内容一致 ≠ 环境一致——同一份代码在不同解释器/依赖下行为可以不同，而 1.1 把两者
        # 挤在一起、接���方分不出"跑的是不是它以为的那个环境"。plan 记了
        # `expected_environment_identity` 就比；没记不判（不判 ≠ 已核对通过）。
        want_env = plan.get("expected_environment_identity")
        got_env = (result.get("environment_identity") or {})
        if want_env:
            for field in ("python", "platform"):
                if field in want_env and field in got_env and got_env[field] != want_env[field]:
                    errs.append(
                        "R12-environment-identity-must-match-plan: 执行环境与计划不一致"
                        f"（{field}={got_env[field]!r} vs 计划期望 {want_env[field]!r}）"
                    )
    return errs


def check_pairs() -> list[dict]:
    """跨文档配对夹具（`samples/pairs/`）。

    **两份文档都要过**：逐份**结构+语义**校验，再加跨文档绑定。
    2026-10-03 按 VG 0028 补上"逐份"这一半：原先这里**只调 `binding_errors()`**，
    于是 `pairs/valid/matched/request.json` 缺 `symlinks`/`submodules`/`unreadable_files`
    （违反草案自己的 R5）却**照样显示"通过"**——它只证明了"绑定那一段能过"，
    **"这组合法"那半句没人验**。
    ⇒ `pairs/valid/*` 的含义必须是「这组**每一份都合法**、**而且**能绑定」；
    `pairs/invalid/*` 的含义是「这组因**指名的那一条**被拒」——
    所以 invalid 组允许最小文档（它本来就是要违规的），但必须**逐份记清**它各自为什么被拒。
    """
    out: list[dict] = []
    pairs_root = DRAFT / "samples" / "pairs"
    for group in ("valid", "invalid"):
        base = pairs_root / group
        if not base.is_dir():
            continue
        for case_dir in sorted(p for p in base.iterdir() if p.is_dir()):
            # 配对夹具按约定必须有 request + plan；缺文件如实记成不符合项，
            # 而不是让检查器自己崩掉（"仪器崩了"看起来太像"样例有问题"）。
            missing = [n for n in ("request.json", "plan.json") if not (case_dir / n).is_file()]
            if missing:
                out.append({
                    "group": group, "case": case_dir.name, "ok": False,
                    "expected": "binding-ok" if group == "valid" else "binding-rejected",
                    "errors": [f"配对夹具缺文件：{missing}"],
                })
                continue
            docs: dict[str, dict] = {}
            for fname, kind in (("request.json", "request"), ("plan.json", "plan"),
                                ("result.json", "result")):
                path = case_dir / fname
                if path.is_file():
                    docs[fname.removesuffix(".json")] = _load(path)
            per_doc = {
                name: structural_errors(doc, kind) + semantic_errors(doc, kind)
                for name, (kind, doc) in (
                    (name, ({"request": "request", "plan": "plan", "result": "result"}[name], doc))
                    for name, doc in docs.items()
                )
            }
            bind = binding_errors(docs["request"], docs["plan"], docs.get("result"))
            if group == "valid":
                # valid 组：**逐份必须无错**，否则这组根本不是"合法样例"的示范。
                errs = [e for errs_ in per_doc.values() for e in errs_] + bind
                ok = not errs
            else:
                # invalid 组：逐份错误**不参与判定**（它就是要违规的），只要求绑定层拒它。
                errs = bind
                ok = bool(errs)
            out.append({
                "group": group, "case": case_dir.name, "ok": ok,
                "expected": "binding-ok" if group == "valid" else "binding-rejected",
                "errors": errs,
                "per_document_errors": {k: v for k, v in per_doc.items() if v},
            })
    return out


def check_all() -> dict:
    report: dict = {"schema": "smart-test-sorter/contract-v2-draft-check/v1",
                    "draft": str(DRAFT.relative_to(REPO)), "valid": [], "invalid": [],
                    "pairs": [], "rules": SEMANTIC_RULES, "ok": True}

    # 可达性守卫先行：规则读不到字段 ⇒ 那条判据在真实文档上永远不触发。
    # 放在最前面，是为了让"不可达"这件事不会被"样例全过"盖过去。
    unreachable = schema_reachability_problems()
    report["reachability_problems"] = unreachable
    report["ok"] &= not unreachable

    for path in sorted(VALID_DIR.glob("*.json")):
        name = path.name
        kind = _kind_of(name)
        doc = _load(path)
        errs = structural_errors(doc, kind) + semantic_errors(doc, kind)
        ok = not errs
        report["valid"].append({"file": name, "kind": kind, "ok": ok, "errors": errs})
        report["ok"] &= ok

    for path in sorted(INVALID_DIR.glob("*.json")):
        name = path.name
        kind = _kind_of(name)
        doc = _load(path)
        structural = structural_errors(doc, kind)
        semantic = semantic_errors(doc, kind)
        expected = SEMANTIC_EXPECTATIONS.get(name)
        if expected:
            # 期望**语义**拒因：结构校验放行是对的（这一条 schema 表达不了），
            # 但语义规则必须命中它——否则"我们写的规则"没落在任何可执行的地方。
            ok = any(expected in e for e in semantic) and not structural
            errors = semantic
        else:
            ok = bool(structural)
            errors = structural
        report["invalid"].append({
            "file": name, "kind": kind, "ok": ok,
            "expected": expected or "structural",
            "errors": errors,
        })
        report["ok"] &= ok

    # 跨文档配对：valid 必须绑定通过、invalid 必须被拒。
    report["pairs"] = check_pairs()
    for item in report["pairs"]:
        report["ok"] &= item["ok"]

    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="check_draft", description=__doc__)
    parser.add_argument("--json", default=None, help="把结果写到该文件")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args(argv)

    report = check_all()
    print(f"2.0 草案检查（{report['draft']}）")
    print(f"  正样例 {len(report['valid'])} 条：" +
          ("全部通过" if all(v["ok"] for v in report["valid"]) else "**有不符合项**"))
    for item in report["valid"]:
        if not item["ok"] or args.verbose:
            print(f"    {'ok  ' if item['ok'] else 'FAIL'} {item['file']}")
            for err in item["errors"]:
                print(f"         {err}")
    print(f"  反样例 {len(report['invalid'])} 条：" +
          ("全部被拒" if all(v["ok"] for v in report["invalid"]) else "**有漏放**"))
    for item in report["invalid"]:
        if not item["ok"] or args.verbose:
            print(f"    {'ok  ' if item['ok'] else 'FAIL'} {item['file']}（期望 {item['expected']}）")
            for err in item["errors"]:
                print(f"         {err}")
    print(f"  配对夹具 {len(report['pairs'])} 组：" +
          ("全部符合预期" if all(p["ok"] for p in report["pairs"]) else "**有不符合项**"))
    for item in report["pairs"]:
        if not item["ok"] or args.verbose:
            print(f"    {'ok  ' if item['ok'] else 'FAIL'} {item['group']}/{item['case']}"
                  f"（期望 {item['expected']}）")
            for err in item["errors"]:
                print(f"         {err}")
    print(f"  语义规则 {len(report['rules'])} 条（见草案 README）")
    unreachable = report.get("reachability_problems") or []
    print(f"  可达性守卫（读到的字段必须在**对应** schema 里声明得下，判据来自 VG 0029 §二 ㈡）：" +
          ("全部可达" if not unreachable else f"**{len(unreachable)} 处不可达**"))
    for problem in unreachable:
        print(f"    UNREACHABLE {problem}")

    if args.json:
        Path(args.json).write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("=> " + ("全部符合预期，退出码 0" if report["ok"] else "有问题，退出码 1"))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
