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


def validate_command_rows(rows: list[Any], prefix: str, issues: list[str]) -> dict[str, dict[str, Any]]:
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
            if not isinstance(value, str):
                issues.append(f"{prefix} command missing {channel}: {identifier}")
            elif sha256_bytes(value.encode("utf-8")) != row.get(f"{channel}Sha256"):
                issues.append(f"{prefix} command {channel} digest mismatch: {identifier}")
    return found


def verify(report: dict[str, Any], root: Path, candidate: str, expected_digest: str,
           allow_development: bool = False) -> dict[str, Any]:
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

    top_commands = validate_command_rows(report.get("commands", []), "top", issues)
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

        profile_commands = validate_command_rows(row.get("commands", []), str(profile_id), issues)
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
    return {
        "ok": not issues,
        "issues": issues,
        "acceptanceEligible": not issues and not allow_development,
        "reportDigest": report_digest(report),
    }


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
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = json.loads(args.report.read_text(encoding="utf-8-sig"))
    result = verify(report, args.report.parent, args.candidate, args.expected_report_digest, args.allow_development)
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
