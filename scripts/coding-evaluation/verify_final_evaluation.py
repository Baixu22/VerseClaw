"""Independently verify the TF-0782 coding maturity aggregate."""

from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import subprocess
from pathlib import Path
from typing import Any, Callable

import final_evaluation as base


SCHEMA = "CodingMaturityEvaluation/v1"
TASK = "TF-0782"


def resolve(root: Path, relative: str) -> Path:
    candidate = (root / relative).resolve()
    candidate.relative_to(root.resolve())
    return candidate


def imported_verify_package() -> Callable[..., dict[str, Any]]:
    path = Path(__file__).with_name("verify-package-evaluation.py")
    spec = importlib.util.spec_from_file_location("verify_package_evaluation", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("package verifier cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.verify


def verify_source_identity(repo: Path, candidate: dict[str, Any], issues: list[str]) -> None:
    try:
        identity = base.source_identity(repo)
    except (OSError, RuntimeError) as error:
        issues.append(f"repository identity is unreadable: {error}")
        return
    if candidate.get("commit") != identity.get("commit"):
        issues.append("candidate commit differs from repository HEAD")
    if candidate.get("tree") != identity.get("tree"):
        issues.append("candidate tree differs from repository HEAD tree")
    if identity.get("clean") is not True:
        issues.append("repository worktree is not clean")


def verifier_provenance(report: dict[str, Any], actor: str | None, issues: list[str]) -> dict[str, Any]:
    actor = actor.strip() if isinstance(actor, str) else None
    if not isinstance(actor, str) or not actor.strip():
        issues.append("independent verifier actor is required")
    executor = report.get("fullGates", {}).get("executor", {}) if isinstance(report.get("fullGates"), dict) else {}
    executor_actor = executor.get("actor") if isinstance(executor, dict) else None
    if actor and isinstance(executor_actor, str) and actor == executor_actor.strip():
        issues.append("independent verifier actor matches executor")
    return {"driven_by": "agent", "actor": actor, "realHumanEvidence": False}


def verify_gate_logs(root: Path, report: dict[str, Any], issues: list[str]) -> None:
    for gate in report.get("gates") if isinstance(report.get("gates"), list) else []:
        logs = gate.get("logs") if isinstance(gate.get("logs"), dict) else {}
        for channel in ("stdout", "stderr"):
            relative = logs.get(channel)
            expected = logs.get(f"{channel}Sha256")
            if not isinstance(relative, str):
                if gate.get("status") == "pass":
                    issues.append(f"gate {gate.get('id')}: missing {channel} log")
                continue
            try:
                path = resolve(root, relative)
                if not path.is_file():
                    issues.append(f"gate {gate.get('id')}: {channel} log missing")
                elif base.sha256_file(path) != expected:
                    issues.append(f"gate {gate.get('id')}: {channel} log digest mismatch")
            except (OSError, ValueError) as error:
                issues.append(f"gate {gate.get('id')}: {channel} log unreadable: {error}")


def gate_matches(summary: dict[str, Any], report_path: Path, candidate: dict[str, Any], issues: list[str], label: str) -> dict[str, Any]:
    recomputed = base.gate_report(report_path, candidate["commit"], candidate["tree"])
    keys = ("sha256", "role", "actor", "executorActor", "verifierActor", "result", "engineeringAcceptedByAgent", "gateCount", "passedGateCount", "failures", "candidate", "reportDigest")
    for key in keys:
        if summary.get(key) != recomputed.get(key):
            issues.append(f"{label}: report projection mismatch for {key}")
    issues.extend(f"{label}: {issue}" for issue in recomputed["issues"])
    verify_gate_logs(report_path.parent, base.load_json(report_path), issues)
    return recomputed


def verify_package(root: Path, summary: dict[str, Any], candidate: dict[str, Any], issues: list[str]) -> None:
    report_relative = summary.get("path")
    verification_relative = summary.get("verificationPath")
    if not isinstance(report_relative, str) or not isinstance(verification_relative, str):
        issues.append("package evidence paths are missing")
        return
    report_path = resolve(root, report_relative)
    verification_path = resolve(root, verification_relative)
    if not report_path.is_file() or not verification_path.is_file():
        issues.append("package report or verification is missing")
        return
    recomputed = base.package_report_summary(report_path, verification_path, candidate["commit"], candidate["tree"])
    for key in ("reportSha256", "verificationSha256", "candidate", "reportDigest", "verifierOk", "checks", "cleanup", "claims"):
        if summary.get(key) != recomputed.get(key):
            issues.append(f"package projection mismatch for {key}")
    issues.extend(f"package: {issue}" for issue in recomputed["issues"])
    report = base.load_json(report_path)
    digest_path = report_path.parent / "report.sha256"
    if not digest_path.is_file():
        issues.append("package report.sha256 is missing")
        return
    expected_digest = digest_path.read_text(encoding="ascii").strip()
    checked = imported_verify_package()(report, report_path.parent, candidate["commit"], expected_digest, False)
    if checked.get("ok") is not True:
        issues.append("package verifier rejected the copied evidence")
        issues.extend(f"package verifier: {item}" for item in checked.get("issues", []))


def expected_findings(rows: list[dict[str, Any]]) -> dict[str, Any]:
    by_role = {row["role"]: row for row in rows}
    return {
        f"A{i}": {
            "node": base.FINDINGS[f"A{i}"],
            "state": by_role[f"A{i}"]["state"],
            "evidence": by_role[f"A{i}"]["acceptancePath"],
            "candidate": by_role[f"A{i}"]["candidate"],
        }
        for i in range(1, 11)
    }


def verify_structural(report: dict[str, Any], root: Path, repo: Path, candidate_commit: str, expected_digest: str) -> list[str]:
    issues: list[str] = []
    if base.report_digest(report) != expected_digest:
        issues.append("canonical report digest mismatch")
    if report.get("schema") != SCHEMA or report.get("taskId") != TASK:
        issues.append("report schema or task id mismatch")
    if report.get("driven_by") != "agent" or report.get("realHumanEvidence") is not False:
        issues.append("agent evidence declaration mismatch")
    candidate = report.get("candidate") if isinstance(report.get("candidate"), dict) else {}
    if candidate.get("commit") != candidate_commit:
        issues.append("final candidate commit mismatch")
    if not base.HEX40.fullmatch(str(candidate.get("tree") or "")):
        issues.append("final candidate tree is invalid")
    if candidate.get("clean") is not True:
        issues.append("final candidate was not clean")
    verify_source_identity(repo, candidate, issues)
    rows, input_issues = base.check_inputs(repo, candidate_commit)
    issues.extend(input_issues)
    if report.get("leaves") != rows:
        issues.append("leaf evidence projection differs from disk")
    findings = report.get("findings") if isinstance(report.get("findings"), dict) else {}
    if findings.get("baseline") != 10 or findings.get("resolved") != 10 or findings.get("unresolved") != []:
        issues.append("finding counters are inconsistent")
    if findings.get("items") != expected_findings(rows):
        issues.append("A1-A10 evidence projection differs from disk")
    gates = report.get("fullGates") if isinstance(report.get("fullGates"), dict) else {}
    executor_summary = gates.get("executor") if isinstance(gates.get("executor"), dict) else {}
    verifier_summary = gates.get("verifier") if isinstance(gates.get("verifier"), dict) else {}
    executor = gate_matches(executor_summary, resolve(root, "full-gates/executor-report.json"), candidate, issues, "executor")
    verifier = gate_matches(verifier_summary, resolve(root, "full-gates/verifier-report.json"), candidate, issues, "verifier")
    independent = bool(executor.get("actor") and verifier.get("actor") and executor.get("actor") != verifier.get("actor"))
    same_candidate = (
        executor.get("candidate", {}).get("commit") == candidate_commit
        and verifier.get("candidate", {}).get("commit") == candidate_commit
    )
    if not independent:
        issues.append("executor and verifier actors are not independent")
    if not same_candidate:
        issues.append("full gate reports do not share the candidate")
    if verifier.get("engineeringAcceptedByAgent") is not True:
        issues.append("verifier did not issue engineeringAcceptedByAgent")
    package = report.get("package") if isinstance(report.get("package"), dict) else {}
    verify_package(root, package, candidate, issues)
    if package.get("candidate", {}).get("commit") != candidate_commit:
        issues.append("package evidence does not share the candidate")
    conclusions = report.get("conclusions") if isinstance(report.get("conclusions"), dict) else {}
    expected = {
        "functionalReadiness": "ready",
        "qualityReadiness": "pass",
        "performance": "measured-no-net-benefit-proven",
        "operationalReadiness": "pass",
        "distributionReadiness": "win-unpacked-ready-installer-not-run",
        "releaseApproved": False,
        "ga": False,
        "liveReady": False,
        "defaultOn": False,
    }
    for key, value in expected.items():
        if conclusions.get(key) != value:
            issues.append(f"conclusion {key} expected {value!r}, got {conclusions.get(key)!r}")
    safety = report.get("safety") if isinstance(report.get("safety"), dict) else {}
    if safety.get("p0") != 0 or safety.get("p1") != 0 or safety.get("requiredEvidenceMissing") != 0 or safety.get("fullGateFailures") != 0:
        issues.append("safety counters are nonzero")
    if safety.get("productLockChanged") is not False or safety.get("defaultsChanged") is not False or safety.get("releaseAuthorized") is not False:
        issues.append("product lock, default or release authorization changed")
    if report.get("decision") != "accepted":
        issues.append("final decision is not accepted")
    checks = base.verify_sums(root)
    if not checks["ok"]:
        issues.extend(checks["issues"])
    return issues

def verify(report: dict[str, Any], root: Path, repo: Path, candidate_commit: str, expected_digest: str, *, actor: str | None = None) -> dict[str, Any]:
    issues = verify_structural(report, root, repo, candidate_commit, expected_digest)
    acceptance_path = root / "acceptance.json"
    if acceptance_path.is_file():
        expected_acceptance = base.build_acceptance(report)
        if base.load_json(acceptance_path) != expected_acceptance:
            issues.append("acceptance projection differs from report")
    else:
        issues.append("acceptance.json is missing")
    digest_path = root / "report.sha256"
    if not digest_path.is_file() or digest_path.read_text(encoding="ascii").strip() != expected_digest:
        issues.append("report.sha256 does not match the expected digest")
    provenance = verifier_provenance(report, actor, issues)
    return {
        "ok": not issues,
        "issues": issues,
        "acceptanceEligible": not issues,
        "candidate": report.get("candidate"),
        "reportDigest": expected_digest,
        **provenance,
    }


def run_negative_checks(report: dict[str, Any], root: Path, repo: Path, candidate_commit: str, digest: str) -> list[dict[str, Any]]:
    def mutate(name: str, mutate_doc: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
        altered = copy.deepcopy(report)
        mutate_doc(altered)
        altered_digest = base.report_digest(altered)
        checked = verify_structural(altered, root, repo, candidate_commit, altered_digest)
        return {"case": name, "rejected": bool(checked), "issues": checked[:8]}

    def same_actor(document: dict[str, Any]) -> None:
        verifier = document["fullGates"]["verifier"]
        verifier["actor"] = document["fullGates"]["executor"]["actor"]

    def drop_leaf(document: dict[str, Any]) -> None:
        document["leaves"].pop()

    def unresolved_finding(document: dict[str, Any]) -> None:
        document["findings"]["items"]["A1"]["state"] = "needs-fix"

    def wrong_candidate(document: dict[str, Any]) -> None:
        document["candidate"]["commit"] = "0" * 40

    def rejected_verifier(document: dict[str, Any]) -> None:
        document["fullGates"]["verifier"]["engineeringAcceptedByAgent"] = False

    def package_candidate(document: dict[str, Any]) -> None:
        document["package"]["candidate"]["commit"] = "0" * 40

    def release_approved(document: dict[str, Any]) -> None:
        document["conclusions"]["releaseApproved"] = True

    def product_lock(document: dict[str, Any]) -> None:
        document["safety"]["productLockChanged"] = True

    def forged_scope(document: dict[str, Any]) -> None:
        document["package"]["checks"]["sourceDetached"] = False

    cases = [
        mutate("delete-leaf", drop_leaf),
        mutate("unresolve-finding", unresolved_finding),
        mutate("wrong-candidate", wrong_candidate),
        mutate("same-executor-and-verifier", same_actor),
        mutate("reject-verifier", rejected_verifier),
        mutate("package-candidate-tamper", package_candidate),
        mutate("release-approved", release_approved),
        mutate("product-lock-changed", product_lock),
        mutate("forged-scope", forged_scope),
    ]
    digest_issues = verify_structural(report, root, repo, candidate_commit, "0" * 64)
    cases.append({"case": "report-digest-mismatch", "rejected": bool(digest_issues), "issues": digest_issues[:8]})
    return cases


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("--repo", type=Path, default=base.ROOT)
    parser.add_argument("--candidate")
    parser.add_argument("--expected-report-digest")
    parser.add_argument("--negative-checks", action="store_true")
    parser.add_argument("--actor", required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    report_path = args.report.resolve()
    root = report_path.parent
    repo = args.repo.resolve()
    report = base.load_json(report_path)
    candidate = args.candidate or (report.get("candidate") or {}).get("commit")
    if not isinstance(candidate, str) or not base.HEX40.fullmatch(candidate):
        parser.error("--candidate is required when the report has no valid candidate")
    expected_digest = args.expected_report_digest
    if not expected_digest:
        digest_path = root / "report.sha256"
        if not digest_path.is_file():
            parser.error("--expected-report-digest is required when report.sha256 is absent")
        expected_digest = digest_path.read_text(encoding="ascii").strip()
    checked = verify(report, root, repo, candidate, expected_digest, actor=args.actor)
    if args.negative_checks:
        checked["negativeChecks"] = run_negative_checks(report, root, repo, candidate, expected_digest)
        if not all(item["rejected"] for item in checked["negativeChecks"]):
            checked["ok"] = False
            checked["acceptanceEligible"] = False
            checked["issues"].append("one or more negative checks were accepted")
    output = args.output.resolve() if args.output else root / "verification-final.json"
    output.write_text(json.dumps(checked, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(checked, ensure_ascii=False, indent=2))
    return 0 if checked["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
