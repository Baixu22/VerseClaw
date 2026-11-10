"""Independently verify TF-0781 Windows package evidence."""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
from pathlib import Path
from typing import Any

SCHEMA = "CodingWindowsPackageEvaluation/v1"
TASK = "TF-0781"
ACTOR = "codex-coding-package-evaluator"
PROFILES = ("profile-a", "profile-b", "profile-c")
REQUIRED_COMMANDS = {
    "package-build",
    "package-directory",
    "playwright-package-profiles",
    "vite-package-alias-tests",
    "verseshell-package-verify",
    "versegit-package-verify",
    "package-cli-probe",
    "package-evidence-tests",
    "harness-validate",
    "comms-replay",
    "comms-compare",
    "repository-artifacts",
}
HEX40 = re.compile(r"^[0-9a-f]{40}$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")
HEX128 = re.compile(r"^[0-9a-f]{128}$")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def report_digest(report: dict[str, Any]) -> str:
    data = json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return sha256_bytes(data)


def resolve(root: Path, relative: str) -> Path:
    base = root.resolve()
    path = (base / relative).resolve()
    if not path.is_relative_to(base):
        raise ValueError(f"artifact escapes evidence root: {relative}")
    return path


def check_artifact(report: dict[str, Any], root: Path, relative: str, issues: list[str]) -> None:
    try:
        path = resolve(root, relative)
        metadata = report.get("artifacts", {}).get(relative)
        if not isinstance(metadata, dict):
            issues.append(f"artifact not registered: {relative}")
            return
        data = path.read_bytes()
        if sha256_bytes(data) != metadata.get("sha256"):
            issues.append(f"artifact digest mismatch: {relative}")
        if len(data) != metadata.get("bytes"):
            issues.append(f"artifact size mismatch: {relative}")
    except (OSError, TypeError, ValueError) as error:
        issues.append(f"artifact unreadable: {relative}: {error}")


def validate_command_rows(rows: list[Any], prefix: str, issues: list[str],
                          artifacts: dict[str, Any] | None = None,
                          root: Path | None = None) -> dict[str, dict[str, Any]]:
    found: dict[str, dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            issues.append(f"{prefix} command is not an object")
            continue
        identifier = row.get("id")
        if not isinstance(identifier, str) or not identifier:
            issues.append(f"{prefix} command without id")
            continue
        if identifier in found:
            issues.append(f"duplicate {prefix} command id: {identifier}")
        found[identifier] = row
        if row.get("exitCode") != 0 or row.get("expectedExitCode") != 0:
            issues.append(f"{prefix} command failed: {identifier}")
        if row.get("waitedForExit") is not True:
            issues.append(f"{prefix} command did not wait: {identifier}")
        for channel in ("stdout", "stderr"):
            value = row.get(channel)
            digest = row.get(f"{channel}Sha256")
            if isinstance(value, str):
                if sha256_bytes(value.encode("utf-8")) != digest:
                    issues.append(f"{prefix} command {channel} digest mismatch: {identifier}")
                continue
            artifact = row.get(f"{channel}Artifact")
            metadata = artifacts.get(artifact) if isinstance(artifacts, dict) and isinstance(artifact, str) else None
            if root is None or not isinstance(artifact, str) or not isinstance(metadata, dict):
                issues.append(f"{prefix} command missing {channel}: {identifier}")
                continue
            try:
                data = resolve(root, artifact).read_bytes()
            except (OSError, TypeError, ValueError) as error:
                issues.append(f"{prefix} command {channel} artifact unreadable: {identifier}: {error}")
                continue
            if sha256_bytes(data) != digest:
                issues.append(f"{prefix} command {channel} digest mismatch: {identifier}")
            if len(data) != metadata.get("bytes"):
                issues.append(f"{prefix} command {channel} size mismatch: {identifier}")
    return found


def verify_supplemental(report: dict[str, Any], root: Path, issues: list[str]) -> dict[str, Any]:
    initial_issue_count = len(issues)
    base = root / "supplemental"
    negative_path = base / "negative-checks.json"
    parity_path = base / "source-package-parity.json"
    package_cli_path = base / "package-cli-report.json"
    for path in (negative_path, parity_path, package_cli_path):
        if not path.is_file():
            issues.append(f"supplemental artifact missing: {path.relative_to(root).as_posix()}")
    if issues and any(issue.startswith("supplemental artifact missing:") for issue in issues):
        return {"ok": False}

    negative = json.loads(negative_path.read_text(encoding="utf-8"))
    parity = json.loads(parity_path.read_text(encoding="utf-8"))
    package_cli = json.loads(package_cli_path.read_text(encoding="utf-8"))
    candidate = report.get("candidate", {}).get("commit")
    digest = report_digest(report)

    def check(condition: object, message: str) -> None:
        if not condition:
            issues.append(message)

    for name, document in (("negative-checks", negative), ("source-package-parity", parity)):
        check(document.get("taskId") == TASK, f"{name} task id mismatch")
        check(document.get("driven_by") == "agent" and document.get("realHumanEvidence") is False,
              f"{name} provenance mismatch")
        check(document.get("candidate") == candidate, f"{name} candidate mismatch")
        check(document.get("reportDigest") == digest, f"{name} report digest mismatch")

    check(negative.get("actor") == ACTOR, "negative-check actor mismatch")
    check(negative.get("status") == "pass", "negative-check status mismatch")
    cases = negative.get("cases") if isinstance(negative.get("cases"), list) else []
    by_id = {row.get("id"): row for row in cases if isinstance(row, dict)}
    required = {
        "missing-binary": {"exitCode": 1, "code": "artifact_missing"},
        "wrong-hash": {"exitCode": 1, "code": "artifact_mismatch"},
        "missing-interpreter": {"exitCode": 3, "status": "dependency_unavailable", "spawned": False},
    }
    for identifier, expected in required.items():
        row = by_id.get(identifier, {})
        check(row.get("rejected") is True and row.get("waitedForExit") is True,
              f"supplemental negative case not rejected: {identifier}")
        for field, value in expected.items():
            check(row.get(field) == value, f"supplemental negative mismatch: {identifier}/{field}")
        for channel in ("stdout", "stderr"):
            metadata = row.get(channel) if isinstance(row.get(channel), dict) else {}
            relative = metadata.get("path")
            try:
                path = resolve(root, relative)
                data = path.read_bytes()
                check(sha256_bytes(data) == metadata.get("sha256"), f"supplemental digest mismatch: {identifier}/{channel}")
                check(len(data) == metadata.get("bytes"), f"supplemental size mismatch: {identifier}/{channel}")
            except (OSError, TypeError, ValueError) as error:
                issues.append(f"supplemental artifact unreadable: {identifier}/{channel}: {error}")
    check(negative.get("processSurvivorsAfterChecks") == 0, "supplemental process survivor count nonzero")
    boundaries = negative.get("capabilityBoundaries") if isinstance(negative.get("capabilityBoundaries"), dict) else {}
    check(boundaries.get("defaultEnableAllProfiles") == [False, False, False], "supplemental VG default changed")
    check(boundaries.get("managedOptInAllProfiles") == [True, True, True], "supplemental managed opt-in missing")
    check(boundaries.get("bundledPythonPresentAllProfiles") == [False, False, False], "supplemental bundled Python claimed")
    check(boundaries.get("standaloneJjPresentAllProfiles") == [False, False, False], "supplemental standalone JJ claimed")
    check(boundaries.get("managedModeMustBeExplicit") is True, "supplemental managed mode is not explicit")
    cli_summary = negative.get("packageCli") if isinstance(negative.get("packageCli"), dict) else {}
    check(cli_summary.get("status") == "pass", "package CLI supplemental status mismatch")
    check(cli_summary.get("probeCount") == 12, "package CLI probe count mismatch")
    check(cli_summary.get("stateUnchanged") is True, "package CLI changed isolated state")
    check(cli_summary.get("timedOutProbes") == 0 and cli_summary.get("failedExpectationProbes") == 0,
          "package CLI probe failure")
    cli_meta = cli_summary.get("report") if isinstance(cli_summary.get("report"), dict) else {}
    try:
        cli_bytes = resolve(root, cli_meta.get("path")).read_bytes()
        check(sha256_bytes(cli_bytes) == cli_meta.get("sha256"), "package CLI report digest mismatch")
        check(len(cli_bytes) == cli_meta.get("bytes"), "package CLI report size mismatch")
    except (OSError, TypeError, ValueError) as error:
        issues.append(f"package CLI report unreadable: {error}")
    check(package_cli.get("actor") == "packaged-cli-probe" and package_cli.get("status") == "pass",
          "package CLI report provenance/status mismatch")
    check(len(package_cli.get("probes", [])) == 12, "package CLI raw report count mismatch")
    check(package_cli.get("stateBefore") == package_cli.get("stateAfter"), "package CLI raw state changed")
    check(not any(row.get("timedOut") for row in package_cli.get("probes", [])), "package CLI raw probe timed out")

    check(parity.get("actor") == ACTOR and parity.get("allMatch") is True, "source/package parity mismatch")
    rows = parity.get("rows") if isinstance(parity.get("rows"), list) else []
    check(len(rows) == 6, "source/package parity row count mismatch")
    check(all(row.get("match") is True for row in rows), "source/package digest mismatch")
    return {
        "ok": len(issues) == initial_issue_count,
        "negativeCases": [row.get("id") for row in cases],
        "sourcePackageParityRows": len(rows),
        "packageCliProbes": len(package_cli.get("probes", [])),
    }


def verify(report: dict[str, Any], root: Path, candidate: str, expected_digest: str,
           allow_development: bool = False, supplemental: bool = False) -> dict[str, Any]:
    issues: list[str] = []

    def check(condition: object, message: str) -> None:
        if not condition:
            issues.append(message)

    check(report.get("schema") == SCHEMA, "schema mismatch")
    check(report.get("taskId") == TASK, "task id mismatch")
    check(report.get("driven_by") == "agent", "driven_by mismatch")
    check(report.get("actor") == ACTOR, "actor mismatch")
    check(report.get("realHumanEvidence") is False, "realHumanEvidence must be false")
    check(report.get("acceptanceEligible") is True, "report is not acceptance eligible")
    check(isinstance(expected_digest, str) and bool(HEX64.fullmatch(expected_digest)), "expected digest malformed")
    check(report_digest(report) == expected_digest, "canonical report digest mismatch")
    candidate_doc = report.get("candidate") if isinstance(report.get("candidate"), dict) else {}
    check(candidate_doc.get("commit") == candidate and isinstance(candidate, str) and bool(HEX40.fullmatch(candidate)), "candidate mismatch")
    check(isinstance(candidate_doc.get("tree"), str) and bool(HEX40.fullmatch(candidate_doc.get("tree", ""))), "candidate tree missing")
    check(candidate_doc.get("dirty") is False, "candidate worktree was dirty")

    artifacts = report.get("artifacts")
    check(isinstance(artifacts, dict) and bool(artifacts), "artifact map missing")
    if isinstance(artifacts, dict):
        check("evidence/source.json" in artifacts and "evidence/package.json" in artifacts, "required package/source artifacts missing")
        for relative in artifacts:
            if isinstance(relative, str):
                check_artifact(report, root, relative, issues)

    top_commands = validate_command_rows(report.get("commands", []), "top", issues, artifacts, root)
    check(REQUIRED_COMMANDS.issubset(top_commands), "required top-level command set incomplete")

    package = report.get("package") if isinstance(report.get("package"), dict) else {}
    check(package.get("installer", {}).get("status") == "not-run", "installer must remain not-run")
    for name in ("executable", "vg", "ae", "node"):
        doc = package.get(name) if isinstance(package.get(name), dict) else {}
        check(isinstance(doc.get("path"), str) and doc.get("path"), f"package {name} path missing")
        check(isinstance(doc.get("sha256"), str) and bool(HEX64.fullmatch(doc.get("sha256", ""))), f"package {name} digest missing")
        check(isinstance(doc.get("bytes"), int) and doc.get("bytes") > 0, f"package {name} size missing")
    manifests = package.get("manifests") if isinstance(package.get("manifests"), dict) else {}
    for name in ("versegit", "verseshell"):
        doc = manifests.get(name) if isinstance(manifests.get(name), dict) else {}
        check(isinstance(doc.get("sha256"), str) and bool(HEX64.fullmatch(doc.get("sha256", ""))), f"{name} manifest digest missing")
        check(isinstance(doc.get("artifact"), str) and doc.get("artifact") in artifacts, f"{name} manifest artifact missing")
    source_identity = package.get("source") if isinstance(package.get("source"), dict) else {}
    check(isinstance(source_identity.get("versegitCommit"), str) and bool(HEX40.fullmatch(source_identity.get("versegitCommit", ""))), "packaged VG source commit missing")
    check(isinstance(source_identity.get("verseshellCommit"), str) and bool(HEX40.fullmatch(source_identity.get("verseshellCommit", ""))), "packaged VerseShell source commit missing")
    check(isinstance(source_identity.get("nodeVersion"), str) and source_identity.get("nodeVersion") != "", "packaged Node version missing")

    rows = report.get("profiles")
    check(isinstance(rows, list) and len(rows) == 3, "profile count mismatch")
    seen_profiles: set[str] = set()
    seen_roots: set[str] = set()
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            issues.append("profile row is not an object")
            continue
        profile_id = row.get("profileId")
        seen_profiles.add(str(profile_id))
        check(profile_id in PROFILES, f"unexpected profile: {profile_id}")
        check(row.get("status") == "pass", f"profile failed: {profile_id}")
        check(row.get("driven_by") == "agent" and row.get("realHumanEvidence") is False, f"profile provenance mismatch: {profile_id}")
        roots = row.get("roots") if isinstance(row.get("roots"), dict) else {}
        root_values = [str(roots.get(name)) for name in ("userData", "home", "state", "workspace")]
        check(all(value and value != "None" for value in root_values), f"profile roots missing: {profile_id}")
        check(not seen_roots.intersection(root_values), f"profile roots reused: {profile_id}")
        seen_roots.update(root_values)
        app = row.get("app") if isinstance(row.get("app"), dict) else {}
        check(app.get("isPackaged") is True, f"profile did not use packaged app: {profile_id}")
        check(row.get("sourceDetached") is True, f"profile retained source dependency: {profile_id}")
        check(row.get("packageExecutableSha256") == package.get("executable", {}).get("sha256"), f"profile package binding mismatch: {profile_id}")

        coding = row.get("coding") if isinstance(row.get("coding"), dict) else {}
        check(coding.get("worktreeBackend") == "git-worktree" and coding.get("verifiedCheckout") is True, f"worktree isolation missing: {profile_id}")
        check(coding.get("terminalStatus") == "ok", f"worker terminal mismatch: {profile_id}")
        check(coding.get("verificationObserved") is True, f"verification output missing: {profile_id}")
        check(coding.get("scratchRemoved") is True, f"undo retained user file: {profile_id}")
        check(isinstance(coding.get("mathSha256"), str) and bool(HEX64.fullmatch(coding.get("mathSha256", ""))), f"final file digest missing: {profile_id}")
        check(coding.get("providerAnomalies") == [], f"provider anomalies present: {profile_id}")

        vg = row.get("vg") if isinstance(row.get("vg"), dict) else {}
        capabilities = vg.get("capabilities") if isinstance(vg.get("capabilities"), dict) else {}
        check(capabilities.get("schema") == "versegit.capabilities/v1", f"VG capability schema mismatch: {profile_id}")
        check(capabilities.get("safety", {}).get("default_enable") is False, f"VG enabled by default: {profile_id}")
        check(capabilities.get("safety", {}).get("managed_opt_in") is True, f"managed VG opt-in missing: {profile_id}")
        imported = vg.get("workspaceImport") if isinstance(vg.get("workspaceImport"), dict) else {}
        change = vg.get("change") if isinstance(vg.get("change"), dict) else {}
        snapshot = vg.get("snapshot") if isinstance(vg.get("snapshot"), dict) else {}
        check(imported.get("schema") == "versegit.vg-json/v1" and imported.get("colocated") is True, f"JJ workspace import failed: {profile_id}")
        check(isinstance(change.get("change_id"), str) and isinstance(change.get("operation_id"), str), f"VG change record missing: {profile_id}")
        check(isinstance(snapshot.get("operation_id"), str) and snapshot.get("operation_id") != change.get("operation_id"), f"VG snapshot operation missing: {profile_id}")
        for version, expected in (("1.1", True), ("2.0", True)):
            contract = vg.get(f"sts{version.replace('.', '')}") if isinstance(vg.get(f"sts{version.replace('.', '')}"), dict) else {}
            check(contract.get("ok") is expected and contract.get("protocol") == version, f"STS {version} contract failed: {profile_id}")
            check(contract.get("invalidRejected") == contract.get("invalidTotal"), f"STS {version} invalid acceptance: {profile_id}")
        check(vg.get("bundledPythonPresent") is False, f"unexpected bundled Python: {profile_id}")
        check(vg.get("standaloneJjPresent") is False, f"unexpected standalone JJ: {profile_id}")

        profile_commands = validate_command_rows(row.get("commands", []), str(profile_id), issues, artifacts, root)
        for identifier in ("vg-capabilities", "vg-workspace-import", "vg-change-new", "vg-change-snapshot", "sts-contract-1.1", "sts-contract-2.0"):
            check(identifier in profile_commands, f"missing profile command {identifier}: {profile_id}")

    check(seen_profiles == set(PROFILES), "profile identity set mismatch")
    checks = report.get("checks") if isinstance(report.get("checks"), dict) else {}
    true_checks = (
        "threeIndependentProfiles", "packagedApplication", "sourceDetached", "codingWorktree",
        "verificationObserved", "undoRestored", "vgJjPassed", "stsContractsPassed",
        "defaultsOff", "installerNotRun", "targetedCommandsPassed",
    )
    check(all(checks.get(name) is True for name in true_checks), "package summary checks mismatch")
    check(checks.get("processSurvivors") == 0, "package process survivor count nonzero")
    check(report.get("cleanup", {}).get("ownedProcesses") == 0 and report.get("cleanup", {}).get("survivors") == [], "package cleanup failed")
    claims = report.get("claims") if isinstance(report.get("claims"), dict) else {}
    check(claims.get("releaseAuthorized") is False and claims.get("realHuman") is False and claims.get("ga") is False, "non-GA claims mismatch")
    supplemental_result = verify_supplemental(report, root, issues) if supplemental else None
    result = {
        "ok": not issues,
        "issues": issues,
        "acceptanceEligible": not issues and not allow_development,
        "reportDigest": report_digest(report),
    }
    if supplemental_result is not None:
        result["supplemental"] = supplemental_result
    return result


def negative_checks(report: dict[str, Any], root: Path, candidate: str,
                    expected_digest: str, allow_development: bool) -> list[dict[str, Any]]:
    def first_profile(doc: dict[str, Any]) -> dict[str, Any]:
        return doc["profiles"][0]

    mutations = {
        "delete-profile": lambda doc: doc["profiles"].pop(),
        "duplicate-profile": lambda doc: doc["profiles"][1].update(profileId=doc["profiles"][0]["profileId"]),
        "wrong-candidate": lambda doc: doc["candidate"].update(commit="0" * 40),
        "artifact-digest-tamper": lambda doc: next(iter(doc["artifacts"].values())).update(sha256="0" * 64),
        "failed-worker": lambda doc: first_profile(doc)["coding"].update(terminalStatus="timeout"),
        "undo-retained": lambda doc: first_profile(doc)["coding"].update(scratchRemoved=False),
        "missing-sts": lambda doc: first_profile(doc)["vg"].update(sts20={"ok": False, "protocol": "2.0", "invalidRejected": 1, "invalidTotal": 2}),
        "source-overlap": lambda doc: first_profile(doc).update(sourceDetached=False),
        "cleanup-survivor": lambda doc: doc["checks"].update(processSurvivors=1),
        "retained-digest-mismatch": lambda doc: None,
    }
    results = []
    for name, mutate in mutations.items():
        altered = copy.deepcopy(report)
        mutate(altered)
        expected = "0" * 64 if name == "retained-digest-mismatch" else report_digest(altered)
        checked = verify(altered, root, candidate, expected, allow_development)
        results.append({"case": name, "rejected": not checked["ok"], "issues": checked["issues"]})
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--expected-report-digest", required=True)
    parser.add_argument("--allow-development", action="store_true")
    parser.add_argument("--negative-checks", action="store_true")
    parser.add_argument("--supplemental", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = json.loads(args.report.read_text(encoding="utf-8-sig"))
    result = verify(report, args.report.parent, args.candidate, args.expected_report_digest,
                    args.allow_development, args.supplemental)
    if args.negative_checks:
        checks = negative_checks(report, args.report.parent, args.candidate, args.expected_report_digest, args.allow_development)
        result["negativeChecks"] = checks
        if not all(row["rejected"] for row in checks):
            result["ok"] = False
            result["issues"].append("negative evidence was accepted")
    if args.output:
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
