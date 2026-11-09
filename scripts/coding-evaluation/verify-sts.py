"""Independently verify CodingStsSelection/v1 evidence from disk."""
from __future__ import annotations

import argparse
import copy
import gzip
import hashlib
import json
import math
from pathlib import Path

SCHEMA = "CodingStsSelection/v1"
TASK = "TF-0778"
ACTOR = "codex-coding-sts-evaluator"
PROTOCOLS = ("1.1", "2.0")
PROJECT_IDS = ("httpx", "packaging")
REQUIRED_NEGATIVES = {
    "missed-failure": "miss-detected",
    "zero-selection": "refusal",
    "collection-failure": "refusal",
    "nodeid-drift": "refusal",
    "dynamic-parameterization": "variants-preserved",
    "conftest-plugin-change": "full-fallback",
    "flaky": "indeterminate",
    "timeout": "incomparable",
    "environment-drift": "refusal",
}
MIN_REPEATS = 5


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def report_digest(report: dict) -> str:
    data = json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return sha256_bytes(data)


def _resolve(root: Path, relative: str) -> Path:
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError(f"artifact escapes evidence root: {relative}")
    return path


def _artifact(report: dict, root: Path, relative: str, issues: list[str]) -> Path | None:
    try:
        path = _resolve(root, relative)
        metadata = report.get("artifacts", {}).get(relative)
        if not isinstance(metadata, dict):
            issues.append(f"artifact not registered: {relative}")
            return None
        data = path.read_bytes()
        if sha256_bytes(data) != metadata.get("sha256"):
            issues.append(f"artifact digest mismatch: {relative}")
        if len(data) != metadata.get("bytes"):
            issues.append(f"artifact size mismatch: {relative}")
        return path
    except (OSError, ValueError, TypeError) as error:
        issues.append(f"artifact unreadable: {relative}: {error}")
        return None


def _command_map(report: dict, root: Path, issues: list[str]) -> dict[str, dict]:
    result = {}
    for command in report.get("commands", []):
        identifier = command.get("id")
        if not isinstance(identifier, str) or not identifier:
            issues.append("command without id")
            continue
        if identifier in result:
            issues.append(f"duplicate command id: {identifier}")
        result[identifier] = command
        for channel in ("stdout", "stderr"):
            artifact = command.get(f"{channel}Artifact")
            if not isinstance(artifact, str):
                issues.append(f"command {identifier} lacks {channel} artifact")
                continue
            path = _artifact(report, root, artifact, issues)
            if path is not None and sha256_file(path) != command.get(f"{channel}Sha256"):
                issues.append(f"command {identifier} {channel} digest mismatch")
        if command.get("exitCode") != command.get("expectedExitCode"):
            issues.append(f"command {identifier} exit mismatch")
        if command.get("waitedForExit") is not True:
            issues.append(f"command {identifier} was not awaited")
    return result


def _mean(values: list[float]) -> float:
    if not values:
        raise ValueError("mean of empty values")
    return sum(values) / len(values)


def _aggregate_trials(trials: list[dict]) -> dict:
    result = {}
    for arm in ("selected", "full"):
        for temperature in ("cold", "warm"):
            rows = [row for row in trials if row.get("arm") == arm and row.get("temperature") == temperature]
            result[f"{arm}_{temperature}"] = {
                "samples": len(rows),
                "wallSecondsMean": _mean([row["wallSeconds"] for row in rows]),
                "peakTreeRssBytesMean": _mean([row["peakTreeRssBytes"] for row in rows]),
                "executedMean": _mean([row["counts"]["executed"] for row in rows]),
            }
    result["samples"] = len(trials)
    result["wallSecondsTotal"] = sum(row["wallSeconds"] for row in trials)
    result["peakTreeRssBytesMax"] = max(row["peakTreeRssBytes"] for row in trials)
    return result


def verify(report: dict, root: Path, candidate: str, expected_digest: str, allow_development: bool = False) -> dict:
    issues: list[str] = []
    def check(condition: bool, message: str) -> None:
        if not condition:
            issues.append(message)

    check(report.get("schema") == SCHEMA, "schema mismatch")
    check(report.get("taskId") == TASK, "task id mismatch")
    check(report.get("driven_by") == "agent", "driven_by must be agent")
    check(report.get("actor") == ACTOR, "actor mismatch")
    check(report.get("realHumanEvidence") is False, "realHumanEvidence must be false")
    check(report.get("acceptanceEligible") is True and not allow_development, "development evidence is not acceptance eligible")
    check(report.get("selectionDefault") == "off", "selection default changed")
    check(report.get("supportDomains", {}).get("pytest", {}).get("status") == "supported", "pytest domain missing")
    for domain in ("vitest", "cargo"):
        entry = report.get("supportDomains", {}).get(domain, {})
        check(entry.get("status") == "not-applicable", f"{domain} must be not-applicable")
        check(bool(entry.get("reason")), f"{domain} not-applicable reason missing")

    digest = report_digest(report)
    check(digest == expected_digest, "canonical report digest mismatch")
    candidate_doc = report.get("candidate", {})
    check(candidate_doc.get("commit") == candidate, "candidate commit mismatch")
    check(candidate_doc.get("dirty") is False, "candidate worktree was dirty")
    check(isinstance(candidate_doc.get("tree"), str) and len(candidate_doc["tree"]) == 40, "candidate tree missing")

    artifact_root = root.resolve()
    for relative, metadata in report.get("artifacts", {}).items():
        check(isinstance(metadata, dict), f"artifact metadata malformed: {relative}")
        _artifact(report, artifact_root, relative, issues)

    commands = _command_map(report, artifact_root, issues)
    source = report.get("source", {})
    native = source.get("native", {})
    check(native.get("dirty") is False, "native source was dirty")
    check(isinstance(native.get("commit"), str) and len(native["commit"]) == 40, "native commit missing")
    check(isinstance(native.get("tree"), str) and len(native["tree"]) == 40, "native tree missing")
    check(native.get("vgSha256") == report.get("artifacts", {}).get(native.get("vgArtifact"), {}).get("sha256"), "VG binary digest mismatch")
    check(native.get("wheelSha256") == next((meta.get("sha256") for path, meta in report.get("artifacts", {}).items() if path.endswith(".whl")), None), "wheel digest mismatch")
    check(bool(native.get("contracts", {}).get("v1ManifestSha256")), "1.1 contract digest missing")
    check(bool(native.get("contracts", {}).get("v2ManifestSha256")), "2.0 contract digest missing")

    unit = report.get("stsUnit", {})
    check(unit.get("returnCode") == 0, "STS unit suite failed")
    check(unit.get("passed", 0) >= 500, "STS unit passed count is too small")
    check(unit.get("skipped", 0) >= 1, "STS unit skip count missing")
    check(unit.get("manifestMatched") is True and unit.get("historicalAuditPassed") is True, "STS audit gates missing")

    package = report.get("cleanInstall", {})
    check(package.get("ok") is True, "clean install report not ok")
    check(package.get("installedRequired") is True, "clean install did not require installed module")
    check("lib\\site-packages" in package.get("module", "").lower() or "/site-packages/" in package.get("module", "").lower(), "module not loaded from clean site-packages")
    for version in PROTOCOLS:
        row = package.get("protocols", {}).get(version, {})
        check(row.get("consumeOk") and row.get("hostPlanOk") and row.get("hostSelectionOk"), f"protocol {version} host loop incomplete")
        check(row.get("completeness") == "complete" and row.get("validity") == "valid", f"protocol {version} result invalid")
        check(row.get("stabilityRepeats", 0) >= 2, f"protocol {version} stability repeats missing")
        if version == "2.0":
            check(row.get("hostBinding", row.get("binding")) == "confirmed", "2.0 binding not confirmed")
            check(row.get("negativeControls", 0) >= 4, "2.0 negative controls missing")

    negatives = report.get("negativeCases", {})
    for identifier, kind in REQUIRED_NEGATIVES.items():
        row = negatives.get(identifier, {})
        check(row.get("passed") is True, f"negative case not handled: {identifier}")
        check(row.get("kind") == kind, f"negative case kind mismatch: {identifier}")
        check(row.get("commandIds") and all(item in commands for item in row["commandIds"]), f"negative command binding missing: {identifier}")
        check(row.get("evidence") and all(item in report.get("artifacts", {}) for item in row["evidence"]), f"negative artifact binding missing: {identifier}")
    control = report.get("controls", {}).get("covered", {})
    check(control.get("passed") is True and control.get("missedFailures") == 0, "covered positive control failed")
    check(report.get("selectionInvariant", {}).get("selectedUpgradesToFull") == 0, "selected upgraded to full")
    check(report.get("selectionInvariant", {}).get("zeroSelectionPublishedAsPass") is False, "zero selection published as pass")
    check(report.get("selectionInvariant", {}).get("skipCountedAsPass") is False, "skip counted as pass")

    benchmark = report.get("benchmarks", {})
    check(benchmark.get("minColdWarmRepeats") == MIN_REPEATS, "benchmark repeat declaration mismatch")
    projects = benchmark.get("projects", {})
    check(set(projects) == set(PROJECT_IDS), "benchmark project set mismatch")
    identities = set()
    for project_id in PROJECT_IDS:
        project = projects.get(project_id, {})
        source_doc = project.get("source", {})
        check(source_doc.get("verifiedPin") is True, f"{project_id} source pin not verified")
        check(source_doc.get("dirty") is True, f"{project_id} benchmark candidate is not dirty")
        check(source_doc.get("changedPaths") == [source_doc.get("expectedPath")], f"{project_id} changed path drift")
        check(isinstance(source_doc.get("diffSha256"), str) and len(source_doc["diffSha256"]) == 64, f"{project_id} diff digest missing")
        interpreter = project.get("interpreter", {})
        check(Path(interpreter.get("path", "")).is_absolute(), f"{project_id} interpreter is not absolute")
        check(interpreter.get("moduleInsideVenv") is True, f"{project_id} loaded STS outside venv")
        env = project.get("environment", {})
        check(env.get("setupWallSeconds", 0) > 0, f"{project_id} dependency setup cost missing")
        check(env.get("setupLog") in report.get("artifacts", {}), f"{project_id} setup log not retained")
        trials = project.get("trials", [])
        check(len(trials) == MIN_REPEATS * 2 * 2, f"{project_id} trial count mismatch")
        for arm in ("selected", "full"):
            for temperature in ("cold", "warm"):
                rows = [row for row in trials if row.get("arm") == arm and row.get("temperature") == temperature]
                check(len(rows) >= MIN_REPEATS, f"{project_id}/{arm}/{temperature} sample count too small")
        for row in trials:
            identities.add(row.get("candidateIdentity"))
            check(row.get("exitCode") == 0, f"{project_id} trial failed: {row.get('id')}")
            check(row.get("wallSeconds", 0) > 0 and row.get("peakTreeRssBytes", 0) > 0, f"{project_id} trial cost missing: {row.get('id')}")
            check(row.get("cleanup", {}).get("ownedProcesses") == 0, f"{project_id} trial process survived: {row.get('id')}")
            check(row.get("cleanup", {}).get("temporaryReports") == 0, f"{project_id} trial report cleanup failed: {row.get('id')}")
            counts = row.get("counts", {})
            check(all(isinstance(counts.get(key), int) and counts.get(key) >= 0 for key in ("collected", "selected", "executed", "passed", "failed", "skipped", "notExecuted", "missed")), f"{project_id} count fields missing: {row.get('id')}")
            check(counts.get("missed") == 0, f"{project_id} missed failure: {row.get('id')}")
            if row.get("arm") == "selected":
                check(row.get("selectionScope") == "selected", f"{project_id} selected arm changed scope: {row.get('id')}")
                check(counts.get("executed") <= counts.get("collected"), f"{project_id} selected exceeded full universe: {row.get('id')}")
            else:
                check(row.get("selectionScope") == "full", f"{project_id} full arm changed scope: {row.get('id')}")
                check(counts.get("selected") == counts.get("collected"), f"{project_id} full arm did not cover collection: {row.get('id')}")
                check(counts.get("executed") == counts.get("collected") - counts.get("notExecuted"), f"{project_id} full count mismatch: {row.get('id')}")
            artifact = row.get("reportArtifact")
            check(artifact in report.get("artifacts", {}), f"{project_id} trial report not retained: {row.get('id')}")
            try:
                artifact_path = _resolve(root, artifact)
                raw = gzip.decompress(artifact_path.read_bytes()) if artifact.endswith(".gz") else artifact_path.read_bytes()
                trial_doc = json.loads(raw)
                run_doc = trial_doc["runs"]["full"] if row.get("arm") == "full" else trial_doc["runs"]["selected"]
                outcomes = run_doc.get("outcomes", {})
                raw_counts = {"collected": len(trial_doc.get("collected", [])), "selected": len(trial_doc.get("selected", [])), "executed": len(run_doc.get("executed", [])), "passed": 0, "failed": 0}
                for outcome_doc in outcomes.values():
                    outcome = outcome_doc.get("outcome") if isinstance(outcome_doc, dict) else outcome_doc
                    if outcome == "passed": raw_counts["passed"] += 1
                    elif outcome in ("failed", "error"): raw_counts["failed"] += 1
                for key, value in raw_counts.items():
                    check(counts.get(key) == value, f"{project_id} raw trial count mismatch: {row.get('id')}/{key}")
                check(trial_doc.get("target_identity") == row.get("candidateIdentity"), f"{project_id} raw target identity mismatch: {row.get('id')}")
                check(trial_doc.get("selection_scope") == row.get("selectionScope"), f"{project_id} raw scope mismatch: {row.get('id')}")
                check(run_doc.get("completeness") == "complete" and run_doc.get("validity") == "valid" and run_doc.get("raw_exit_code") == 0, f"{project_id} raw trial incomplete: {row.get('id')}")
            except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
                issues.append(f"{project_id} raw trial unreadable: {row.get('id')}: {error}")
        aggregate = project.get("aggregate", {})
        try:
            expected = _aggregate_trials(trials)
            for key, value in expected.items():
                if isinstance(value, dict):
                    for subkey, subvalue in value.items():
                        if isinstance(subvalue, float):
                            check(math.isclose(aggregate.get(key, {}).get(subkey, float("nan")), subvalue, rel_tol=1e-9, abs_tol=1e-9), f"{project_id} aggregate mismatch: {key}.{subkey}")
                        else:
                            check(aggregate.get(key, {}).get(subkey) == subvalue, f"{project_id} aggregate mismatch: {key}.{subkey}")
                elif isinstance(value, float):
                    check(math.isclose(aggregate.get(key, float("nan")), value, rel_tol=1e-9, abs_tol=1e-9), f"{project_id} aggregate mismatch: {key}")
                else:
                    check(aggregate.get(key) == value, f"{project_id} aggregate mismatch: {key}")
        except (KeyError, TypeError, ValueError) as error:
            issues.append(f"{project_id} aggregate unreadable: {error}")
        project_total = aggregate.get("wallSecondsTotal", 0) + env.get("setupWallSeconds", 0)
        check(math.isclose(project.get("totalCost", {}).get("wallSecondsWithSetup", float("nan")), project_total, rel_tol=1e-9, abs_tol=1e-9), f"{project_id} total cost mismatch")
    check(len(identities) == 2, "selected/full trials did not share exactly the two project candidate identities")

    summary = report.get("summary", {})
    check(summary.get("sampleCount") == MIN_REPEATS * 2 * 2 * len(PROJECT_IDS), "summary sample count mismatch")
    check(summary.get("missedFailureRate") == 0, "summary missed failure rate is not zero")
    check(summary.get("falsePositiveRate") == 0, "summary false positive rate is not zero")
    check(summary.get("claim") in ("no-benefit", "benefit-observed", "improvement-unproven"), "summary claim invalid")
    check(summary.get("authoritativeFullVerification") is True, "final full verification missing")

    return {
        "ok": not issues,
        "issues": issues,
        "acceptanceEligible": not issues and not allow_development,
        "reportDigest": digest,
    }


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
        checks = []
        cases = {
            "delete-negative-case": lambda doc: doc["negativeCases"].pop("timeout"),
            "wrong-candidate": lambda doc: doc.update(candidate={**doc["candidate"], "commit": "0" * 40}),
            "artifact-digest-tamper": lambda doc: next(iter(doc["artifacts"].values())).update(sha256="0" * 64),
            "flaky-as-pass": lambda doc: doc["negativeCases"]["flaky"].update(passed=False),
            "selected-upgraded": lambda doc: doc["selectionInvariant"].update(selectedUpgradesToFull=1),
            "missing-benchmark-arm": lambda doc: doc["benchmarks"]["projects"]["httpx"]["trials"].pop(),
            "self-consistent-forgery": lambda doc: doc["summary"].update(missedFailureRate=0.5),
        }
        for name, mutate in cases.items():
            altered = copy.deepcopy(report)
            mutate(altered)
            expected = args.expected_report_digest if name == "self-consistent-forgery" else report_digest(altered)
            checked = verify(altered, args.report.parent, args.candidate, expected, args.allow_development)
            checks.append({"case": name, "rejected": not checked["ok"], "issues": checked["issues"]})
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
