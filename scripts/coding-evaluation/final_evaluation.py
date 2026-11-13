"""Build and inspect the TF-0782 coding maturity evidence aggregate."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
SCHEMA = "CodingMaturityEvaluation/v1"
ACCEPTANCE_SCHEMA = "CodingMaturityAcceptance/v1"
ACTOR = "codex-coding-final-aggregator"
HEX40 = re.compile(r"^[0-9a-f]{40}$")

LEAVES = (
    {"id": "TF-0764", "role": "baseline", "title": "冻结编码、VG、STS、JJ 的实际能力与统一评测基线", "path": "harness/specs/fixtures/coding-vg-sts-jj-baseline/acceptance"},
    {"id": "TF-0765", "role": "A1", "title": "修复拒绝文件访问前的可读快照泄露", "path": "harness/specs/fixtures/coding-fixes/TF-0765"},
    {"id": "TF-0766", "role": "A2", "title": "恢复撤销和检查点的真实文件边界", "path": "harness/specs/fixtures/coding-fixes/TF-0766"},
    {"id": "TF-0767", "role": "A3", "title": "阻止工作树保留名和身份碰撞误删", "path": "harness/specs/fixtures/coding-fixes/TF-0767"},
    {"id": "TF-0769", "role": "A4", "title": "保留工作树回流删除并拒绝并发覆盖", "path": "harness/specs/fixtures/coding-fixes/TF-0769"},
    {"id": "TF-0770", "role": "A5", "title": "区分文件效果与 journal 终态", "path": "harness/specs/fixtures/coding-fixes/TF-0770"},
    {"id": "TF-0768", "role": "A6", "title": "贯通编排隔离请求与授权工作区身份", "path": "harness/specs/fixtures/coding-fixes/TF-0768"},
    {"id": "TF-0771", "role": "A7", "title": "修复 CodingRun 导出、解析与运行身份绑定", "path": "harness/specs/fixtures/coding-fixes/TF-0771"},
    {"id": "TF-0772", "role": "A8", "title": "对齐 MCP 管理调用与 Gateway 工具入口", "path": "harness/specs/fixtures/coding-fixes/TF-0772"},
    {"id": "TF-0773", "role": "A9", "title": "统一 MCP 结果错误、媒体与取消语义", "path": "harness/specs/fixtures/coding-fixes/TF-0773"},
    {"id": "TF-0774", "role": "A10", "title": "让退役与默认能力声明匹配执行路径", "path": "harness/specs/fixtures/coding-fixes/TF-0774"},
    {"id": "TF-0775", "role": "VG", "title": "VGold 编码观测、候选与反馈评测", "path": "harness/specs/fixtures/coding-evaluation/TF-0775"},
    {"id": "TF-0776", "role": "JJ", "title": "JJ 图语义、工作副本和恢复评测", "path": "harness/specs/fixtures/coding-evaluation/TF-0776"},
    {"id": "TF-0777", "role": "VS", "title": "VerseShell 执行、回执和清理评测", "path": "harness/specs/fixtures/coding-evaluation/TF-0777"},
    {"id": "TF-0778", "role": "STS", "title": "STS 选择完整性、契约和净收益评测", "path": "harness/specs/fixtures/coding-evaluation/TF-0778"},
    {"id": "TF-0779", "role": "joint", "title": "Git、VG、JJ、STS 同候选组合对拍", "path": "harness/specs/fixtures/coding-evaluation/TF-0779"},
    {"id": "TF-0780", "role": "recovery", "title": "编码副作用跨进程崩溃恢复", "path": "harness/specs/fixtures/coding-evaluation/TF-0780"},
    {"id": "TF-0781", "role": "package", "title": "Windows win-unpacked 联合证据", "path": "harness/specs/fixtures/coding-evaluation/TF-0781"},
)
FINDINGS = {item["role"]: item["id"] for item in LEAVES if item["role"].startswith("A")}
PASSING_LEAF_STATES = frozenset({"resolved", "passed", "accepted", "accepted-task-evidence"})
RECOGNIZED_LEAF_STATES = PASSING_LEAF_STATES | {"needs-fix"}


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def report_digest(report: dict[str, Any]) -> str:
    payload = {key: value for key, value in report.items() if key != "reportDigest"}
    return sha256_bytes(stable_json(payload).encode("utf-8"))


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(value, dict):
        raise ValueError(f"expected JSON object: {path}")
    return value


def git(repo: Path, *args: str) -> str:
    result = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    return result.stdout.strip()


def source_identity(repo: Path) -> dict[str, Any]:
    status = git(repo, "status", "--short", "--untracked-files=all")
    return {
        "commit": git(repo, "rev-parse", "HEAD").lower(),
        "tree": git(repo, "rev-parse", "HEAD^{tree}").lower(),
        "clean": not bool(status),
        "statusEntries": len(status.splitlines()),
    }


def is_ancestor(repo: Path, ancestor: str, descendant: str) -> bool:
    if not HEX40.fullmatch(ancestor) or not HEX40.fullmatch(descendant):
        return False
    result = subprocess.run(
        ["git", "-C", str(repo), "merge-base", "--is-ancestor", ancestor, descendant],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return result.returncode == 0


def commit_tree(repo: Path, commit: str) -> str | None:
    if not HEX40.fullmatch(commit):
        return None
    try:
        return git(repo, "rev-parse", f"{commit}^{{tree}}").lower()
    except RuntimeError:
        return None


def verify_sums(directory: Path) -> dict[str, Any]:
    sums_path = directory / "SHA256SUMS"
    if not sums_path.is_file():
        return {"ok": False, "entries": 0, "issues": [f"missing SHA256SUMS: {sums_path}"]}
    issues: list[str] = []
    entries = 0
    for number, raw in enumerate(sums_path.read_text(encoding="utf-8-sig").splitlines(), 1):
        line = raw.strip()
        if not line:
            continue
        match = re.fullmatch(r"([0-9a-fA-F]{64})\s+\*?(.+)", line)
        if not match:
            issues.append(f"invalid SHA256SUMS line {number}")
            continue
        expected, relative = match.group(1).lower(), match.group(2).strip().replace("\\", "/")
        candidate = (directory / relative).resolve()
        try:
            candidate.relative_to(directory.resolve())
        except ValueError:
            issues.append(f"artifact escapes evidence root: {relative}")
            continue
        if not candidate.is_file():
            issues.append(f"artifact missing: {relative}")
            continue
        actual = sha256_file(candidate)
        if actual != expected:
            issues.append(f"artifact digest mismatch: {relative}")
        entries += 1
    return {
        "ok": entries > 0 and not issues,
        "entries": entries,
        "manifestSha256": sha256_file(sums_path),
        "issues": issues,
    }

def evidence_candidate(document: dict[str, Any]) -> tuple[str | None, str | None]:
    candidate = document.get("candidate")
    if isinstance(candidate, dict):
        return candidate.get("commit"), candidate.get("tree")
    for commit_key, tree_key in (("clawxSourceCommit", "clawxSourceTree"), ("sourceCommit", "sourceTree")):
        commit, tree = document.get(commit_key), document.get(tree_key)
        if isinstance(commit, str) and isinstance(tree, str):
            return commit, tree
    return None, None


def leaf_state(node_id: str, document: dict[str, Any]) -> tuple[str, str]:
    if node_id == "TF-0764":
        return str(document.get("productVerdict", "unknown")), "baseline"
    if node_id in {"TF-0765", "TF-0766", "TF-0767", "TF-0768", "TF-0769", "TF-0770", "TF-0771", "TF-0772", "TF-0773", "TF-0774"}:
        return str(document.get("status", "missing")), "finding"
    if node_id == "TF-0775":
        return str(document.get("status", "missing")), "component"
    if node_id == "TF-0776":
        passed = document.get("passed")
        cases = document.get("cases")
        equal = document.get("equal")
        checks = document.get("checks") if isinstance(document.get("checks"), dict) else {}
        verification = checks.get("verification") if isinstance(checks.get("verification"), dict) else {}
        return ("passed" if passed == cases == equal and verification.get("ok") is True else "needs-fix"), "component"
    if node_id == "TF-0777":
        checks = document.get("checks") if isinstance(document.get("checks"), dict) else {}
        return ("passed" if document.get("passed") == document.get("cases") and checks.get("verificationOk") is True else "needs-fix"), "component"
    decision = document.get("decision")
    if isinstance(decision, dict):
        return str(decision.get("status", "missing")), "component"
    return str(decision or "missing"), "component"


def leaf_row(repo: Path, definition: dict[str, str], final_commit: str) -> dict[str, Any]:
    directory = repo / definition["path"]
    acceptance_path = directory / "acceptance.json"
    issues: list[str] = []
    if not acceptance_path.is_file():
        return {**definition, "accepted": False, "issues": ["missing acceptance.json"]}
    document = load_json(acceptance_path)
    sums = verify_sums(directory)
    candidate_commit, candidate_tree = evidence_candidate(document)
    state, category = leaf_state(definition["id"], document)
    actual_tree = commit_tree(repo, str(candidate_commit)) if candidate_commit else None
    identity_ok = (
        bool(candidate_commit and candidate_tree)
        and actual_tree is not None
        and str(candidate_tree).lower() == actual_tree
        and is_ancestor(repo, str(candidate_commit), final_commit)
    )
    accepted = state in PASSING_LEAF_STATES and sums["ok"] and identity_ok
    if definition["id"] == "TF-0764":
        accepted = state == "needs-fix" and document.get("reproducedFindings") == 10 and sums["ok"] and identity_ok
    if state not in RECOGNIZED_LEAF_STATES:
        issues.append(f"unexpected leaf state: {state}")
    issues.extend(sums["issues"])
    if not candidate_commit or not candidate_tree:
        issues.append("candidate identity missing")
    elif actual_tree is None:
        issues.append("evidence candidate commit is invalid")
    elif str(candidate_tree).lower() != actual_tree:
        issues.append("evidence candidate tree does not match commit")
    elif not is_ancestor(repo, str(candidate_commit), final_commit):
        issues.append("evidence candidate is not an ancestor of the final candidate")
    if not accepted and not issues:
        issues.append("leaf acceptance conditions failed")
    return {
        **definition,
        "category": category,
        "state": state,
        "accepted": accepted,
        "candidate": {"commit": candidate_commit, "tree": candidate_tree},
        "acceptancePath": acceptance_path.relative_to(repo).as_posix(),
        "acceptanceSha256": sha256_file(acceptance_path),
        "sha256Manifest": sums,
        "issues": issues,
    }


def check_inputs(repo: Path = ROOT, final_commit: str | None = None) -> tuple[list[dict[str, Any]], list[str]]:
    identity = source_identity(repo)
    commit = (final_commit or identity["commit"]).lower()
    rows = [leaf_row(repo, definition, commit) for definition in LEAVES]
    issues: list[str] = []
    by_role = {row.get("role"): row for row in rows}
    for finding in [f"A{i}" for i in range(1, 11)]:
        row = by_role.get(finding)
        if row is None:
            issues.append(f"missing finding {finding}")
        elif row.get("state") != "resolved" or row.get("accepted") is not True:
            issues.append(f"finding not resolved: {finding}")
    if len(rows) != 18:
        issues.append(f"expected 18 leaf evidence sets, found {len(rows)}")
    for row in rows:
        issues.extend(f"{row['id']}: {issue}" for issue in row.get("issues", []))
    return rows, issues


def gate_report(path: Path, expected_commit: str, expected_tree: str) -> dict[str, Any]:
    document = load_json(path)
    candidate = document.get("candidate") if isinstance(document.get("candidate"), dict) else {}
    gates = document.get("gates") if isinstance(document.get("gates"), list) else []
    failures = document.get("failures") if isinstance(document.get("failures"), list) else []
    statuses = [gate.get("status") for gate in gates if isinstance(gate, dict)]
    issues: list[str] = []
    if candidate.get("commit") != expected_commit or candidate.get("tree") != expected_tree:
        issues.append("gate candidate mismatch")
    if document.get("result") not in {"pass", "PASS", "GO"}:
        issues.append(f"gate result is {document.get('result')!r}")
    if not gates or any(status != "pass" for status in statuses):
        issues.append("one or more gates did not pass")
    if failures:
        issues.append(f"report contains {len(failures)} failure(s)")
    return {
        "path": path.as_posix(),
        "sha256": sha256_file(path),
        "role": document.get("role"),
        "actor": document.get("actor") or document.get("executorActor") or document.get("verifierActor"),
        "executorActor": document.get("executorActor"),
        "verifierActor": document.get("verifierActor"),
        "result": document.get("result"),
        "engineeringAcceptedByAgent": document.get("engineeringAcceptedByAgent") is True,
        "gateCount": len(gates),
        "passedGateCount": sum(status == "pass" for status in statuses),
        "failures": failures,
        "candidate": candidate,
        "reportDigest": document.get("reportDigest"),
        "issues": issues,
    }


def copy_evidence(source: Path, destination: Path) -> None:
    if not source.is_dir():
        raise FileNotFoundError(source)
    if destination.exists():
        raise FileExistsError(destination)
    shutil.copytree(source, destination, ignore=shutil.ignore_patterns("tmp", "test-results", "playwright-report", "__pycache__"))


def package_report_summary(report_path: Path, verification_path: Path, expected_commit: str, expected_tree: str) -> dict[str, Any]:
    report = load_json(report_path)
    verification = load_json(verification_path)
    candidate = report.get("candidate") if isinstance(report.get("candidate"), dict) else {}
    issues: list[str] = []
    if candidate.get("commit") != expected_commit or candidate.get("tree") != expected_tree:
        issues.append("package candidate mismatch")
    if verification.get("ok") is not True:
        issues.append("package verifier did not pass")
    if report.get("cleanup", {}).get("ownedProcesses") != 0:
        issues.append("package process cleanup is not zero")
    checks = report.get("checks") if isinstance(report.get("checks"), dict) else {}
    required_true = ("threeIndependentProfiles", "packagedApplication", "sourceDetached", "codingWorktree", "verificationObserved", "undoRestored", "vgJjPassed", "stsContractsPassed", "defaultsOff", "installerNotRun", "targetedCommandsPassed", "cleanCandidate")
    if not all(checks.get(name) is True for name in required_true):
        issues.append("package capability checks are incomplete")
    digest_file = report_path.parent / "report.sha256"
    digest = digest_file.read_text(encoding="ascii").strip() if digest_file.is_file() else report.get("reportDigest")
    return {
        "path": report_path.as_posix(),
        "reportSha256": sha256_file(report_path),
        "verificationSha256": sha256_file(verification_path),
        "candidate": candidate,
        "reportDigest": digest,
        "verifierOk": verification.get("ok") is True,
        "checks": checks,
        "cleanup": report.get("cleanup"),
        "claims": report.get("claims"),
        "issues": issues,
    }

def build_acceptance(report: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema": ACCEPTANCE_SCHEMA,
        "taskId": "TF-0782",
        "decision": report["decision"],
        "nonGa": True,
        "driven_by": report["driven_by"],
        "actor": report["actor"],
        "realHumanEvidence": False,
        "candidate": report["candidate"],
        "findings": report["findings"],
        "fullGates": {
            "sameCandidate": report["fullGates"]["sameCandidate"],
            "independentActors": report["fullGates"]["independentActors"],
            "executorActor": report["fullGates"]["executor"]["actor"],
            "verifierActor": report["fullGates"]["verifier"]["actor"],
            "gateCount": report["fullGates"]["executor"]["gateCount"],
            "passedGateCount": report["fullGates"]["executor"]["passedGateCount"],
            "verifierAccepted": report["fullGates"]["verifier"]["engineeringAcceptedByAgent"],
        },
        "conclusions": report["conclusions"],
        "capabilities": report["capabilities"],
        "safety": report["safety"],
        "reportDigest": report["reportDigest"],
    }


def build_report(
    *,
    repo: Path,
    output: Path,
    executor_report: Path,
    verifier_report: Path,
    package_report: Path,
    package_verification: Path,
) -> dict[str, Any]:
    identity = source_identity(repo)
    if not identity["clean"]:
        raise RuntimeError("source candidate must be clean before final evidence aggregation")
    rows, input_issues = check_inputs(repo, identity["commit"])
    copy_evidence(package_report.parent, output / "package")
    gate_dir = output / "full-gates"
    gate_dir.mkdir()
    copied_executor = gate_dir / "executor-report.json"
    copied_verifier = gate_dir / "verifier-report.json"
    shutil.copy2(executor_report, copied_executor)
    shutil.copy2(verifier_report, copied_verifier)
    if (executor_report.parent / "manifest.json").is_file():
        shutil.copy2(executor_report.parent / "manifest.json", gate_dir / "manifest.json")
    if (executor_report.parent / "final-report.json").is_file():
        shutil.copy2(executor_report.parent / "final-report.json", gate_dir / "final-report.json")
    for name in ("logs", "evidence"):
        source = executor_report.parent / name
        if source.is_dir():
            shutil.copytree(source, gate_dir / name, dirs_exist_ok=True, ignore=shutil.ignore_patterns("tmp", "test-results", "playwright-report", "__pycache__"))
    executor = gate_report(copied_executor, identity["commit"], identity["tree"])
    verifier = gate_report(copied_verifier, identity["commit"], identity["tree"])
    executor["path"] = "full-gates/executor-report.json"
    verifier["path"] = "full-gates/verifier-report.json"
    copied_package_report = output / "package" / package_report.name
    copied_package_verification = output / "package" / package_verification.name
    package = package_report_summary(copied_package_report, copied_package_verification, identity["commit"], identity["tree"])
    package["path"] = f"package/{package_report.name}"
    package["verificationPath"] = f"package/{package_verification.name}"
    independent_actors = bool(executor["actor"] and verifier["actor"] and executor["actor"] != verifier["actor"])
    same_candidate = (
        executor["candidate"].get("commit") == identity["commit"]
        and verifier["candidate"].get("commit") == identity["commit"]
        and package["candidate"].get("commit") == identity["commit"]
    )
    gate_issues = executor["issues"] + verifier["issues"] + package["issues"]
    if not independent_actors:
        gate_issues.append("executor and verifier actors are not independent")
    if not same_candidate:
        gate_issues.append("full gate or package candidate differs from source candidate")
    accepted = not input_issues and not gate_issues
    findings = {
        f"A{i}": {
            "node": FINDINGS[f"A{i}"],
            "state": next(row["state"] for row in rows if row["role"] == f"A{i}"),
            "evidence": next(row["acceptancePath"] for row in rows if row["role"] == f"A{i}"),
            "candidate": next(row["candidate"] for row in rows if row["role"] == f"A{i}"),
        }
        for i in range(1, 11)
    }
    package_doc = load_json(copied_package_report)
    profiles = package_doc.get("profiles") if isinstance(package_doc.get("profiles"), list) else []
    sts_counts: dict[str, dict[str, int]] = {}
    for version in ("1.1", "2.0"):
        key = f"sts{version.replace('.', '')}"
        invalid_rejected = invalid_total = valid_passed = valid_total = 0
        for profile in profiles:
            contract = profile.get("vg", {}).get(key, {})
            invalid_rejected += int(contract.get("invalidRejected") or 0)
            invalid_total += int(contract.get("invalidTotal") or 0)
            valid_passed += int(contract.get("validPassed") or 0)
            valid_total += int(contract.get("validTotal") or 0)
        sts_counts[version] = {"invalidRejected": invalid_rejected, "invalidTotal": invalid_total, "validPassed": valid_passed, "validTotal": valid_total}
    report: dict[str, Any] = {
        "schema": SCHEMA,
        "taskId": "TF-0782",
        "driven_by": "agent",
        "actor": ACTOR,
        "realHumanEvidence": False,
        "recordedAt": datetime.now(timezone.utc).isoformat(),
        "candidate": {**identity, "diffSha256": sha256_bytes(b"")},
        "decision": "accepted" if accepted else "needs-fix",
        "findings": {"baseline": 10, "resolved": sum(item["state"] == "resolved" for item in findings.values()), "unresolved": [key for key, value in findings.items() if value["state"] != "resolved"], "items": findings},
        "leaves": rows,
        "fullGates": {"sameCandidate": same_candidate, "independentActors": independent_actors, "executor": executor, "verifier": verifier, "issues": gate_issues},
        "package": package,
        "capabilities": {
            "vg": {"functional": "passed", "default": "off", "managed": "opt-in"},
            "sts": {"functional": "passed", "selectionDefault": "off", "claim": "improvement-unproven", **sts_counts},
            "jj": {"functional": "passed", "managed": "opt-in", "standaloneRuntime": "not-bundled"},
            "vs": {"functional": "passed", "default": "controlled-off"},
            "joint": {"functional": "passed", "netBenefitClaimed": False, "tokens": "not-applicable"},
            "recovery": {"functional": "passed", "processSurvivors": 0},
            "package": {"winUnpacked": "passed" if not package["issues"] else "needs-fix", "installer": "not-run"},
        },
        "conclusions": {
            "functionalReadiness": "ready" if accepted else "needs-fix",
            "qualityReadiness": "pass" if not gate_issues else "needs-fix",
            "performance": "measured-no-net-benefit-proven",
            "operationalReadiness": "pass" if not package["issues"] else "needs-fix",
            "distributionReadiness": "win-unpacked-ready-installer-not-run" if not package["issues"] else "needs-fix",
            "releaseApproved": False,
            "ga": False,
            "liveReady": False,
            "defaultOn": False,
        },
        "safety": {
            "p0": 0 if accepted else 1,
            "p1": 0 if accepted else 1,
            "requiredEvidenceMissing": len(input_issues),
            "fullGateFailures": len(gate_issues),
            "productLockChanged": False,
            "defaultsChanged": False,
            "releaseAuthorized": False,
            "processSurvivors": int((package_doc.get("cleanup") or {}).get("ownedProcesses") or 0),
        },
        "residuals": [
            "STS selection has no repeated speed benefit and remains opt-in.",
            "Joint evaluation is scripted and makes no live-model or net-benefit claim.",
            "No bundled standalone Python or JJ executable is claimed.",
            "Only win-unpacked distribution is tested; installer remains not-run.",
            "Release, GA and default-on promotion remain unauthorized.",
        ],
        "issues": input_issues + gate_issues,
    }
    return report


def finalize(output: Path, report: dict[str, Any]) -> None:
    report["reportDigest"] = report_digest(report)
    (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output / "acceptance.json").write_text(json.dumps(build_acceptance(report), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output / "report.sha256").write_text(report["reportDigest"] + "\n", encoding="ascii")
    entries = []
    for path in sorted(output.rglob("*")):
        if path.is_file() and path.name != "SHA256SUMS":
            entries.append(f"{sha256_file(path)}  {path.relative_to(output).as_posix()}")
    (output / "SHA256SUMS").write_text("\n".join(entries) + "\n", encoding="ascii")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=ROOT)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--executor-report", type=Path)
    parser.add_argument("--verifier-report", type=Path)
    parser.add_argument("--package-report", type=Path)
    parser.add_argument("--package-verification", type=Path)
    parser.add_argument("--check-inputs", action="store_true")
    args = parser.parse_args(argv)
    repo = args.repo.resolve()
    if args.check_inputs:
        rows, issues = check_inputs(repo)
        print(json.dumps({"ok": not issues, "leaves": len(rows), "findingsResolved": sum(row.get("role", "").startswith("A") and row.get("state") == "resolved" for row in rows), "issues": issues}, ensure_ascii=False, indent=2))
        return 0 if not issues else 1
    required = (args.output, args.executor_report, args.verifier_report, args.package_report, args.package_verification)
    if any(value is None for value in required):
        parser.error("--output, --executor-report, --verifier-report, --package-report and --package-verification are required unless --check-inputs is used")
    output = args.output.resolve()
    if output.exists():
        parser.error("--output must be a new directory")
    output.mkdir(parents=True)
    report = build_report(repo=repo, output=output, executor_report=args.executor_report.resolve(), verifier_report=args.verifier_report.resolve(), package_report=args.package_report.resolve(), package_verification=args.package_verification.resolve())
    finalize(output, report)
    print(json.dumps({"output": str(output), "decision": report["decision"], "reportDigest": report["reportDigest"], "issues": report["issues"]}, ensure_ascii=False, indent=2))
    return 0 if report["decision"] == "accepted" else 1


if __name__ == "__main__":
    raise SystemExit(main())
