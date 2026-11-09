"""Independently verify CodingJointEvaluation/v1 evidence from disk."""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path

SCHEMA = "CodingJointEvaluation/v1"
TASK = "TF-0779"
ACTOR = "codex-coding-joint-evaluator"
WORKSPACES = ("workspace-a", "workspace-b")
CASES = (
    "same-file-competition", "cross-file-dependency", "rename-delete", "stale-basis",
    "dirty-preservation", "combined-candidate", "cancellation-recovery",
    "selected-final-full", "planted-wrong-combination",
)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def report_digest(report: dict) -> str:
    return sha256_bytes(json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8"))


def resolve(root: Path, relative: str) -> Path:
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError(f"artifact escapes evidence root: {relative}")
    return path


def verify_artifact(report: dict, root: Path, relative: str, issues: list[str]) -> bool:
    try:
        path = resolve(root, relative)
        data = path.read_bytes()
        metadata = report.get("artifacts", {}).get(relative)
        if not isinstance(metadata, dict):
            issues.append(f"artifact not registered: {relative}")
            return False
        if sha256_bytes(data) != metadata.get("sha256"):
            issues.append(f"artifact digest mismatch: {relative}")
        if len(data) != metadata.get("bytes"):
            issues.append(f"artifact size mismatch: {relative}")
        return True
    except (OSError, ValueError, TypeError) as error:
        issues.append(f"artifact unreadable: {relative}: {error}")
        return False


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
    check(report_digest(report) == expected_digest, "canonical report digest mismatch")
    check(report.get("candidate", {}).get("commit") == candidate, "candidate commit mismatch")
    check(report.get("candidate", {}).get("dirty") is False, "candidate worktree was dirty")

    for relative in report.get("artifacts", {}):
        verify_artifact(report, root, relative, issues)
    commands = {}
    for command in report.get("commands", []):
        identifier = command.get("id")
        if not isinstance(identifier, str) or not identifier:
            issues.append("command without id")
            continue
        if identifier in commands:
            issues.append(f"duplicate command id: {identifier}")
        commands[identifier] = command
        for channel in ("stdout", "stderr"):
            relative = command.get(f"{channel}Artifact")
            if not isinstance(relative, str):
                issues.append(f"command {identifier} lacks {channel} artifact")
                continue
            verify_artifact(report, root, relative, issues)
            try:
                actual = sha256_bytes(resolve(root, relative).read_bytes())
                check(actual == command.get(f"{channel}Sha256"), f"command {identifier} {channel} digest mismatch")
            except (OSError, ValueError):
                pass
        check(command.get("exitCode") == command.get("expectedExitCode"), f"command {identifier} exit mismatch")
        check(command.get("waitedForExit") is True and command.get("timedOut") is False, f"command {identifier} did not exit cleanly")

    tools = report.get("tools", {})
    for name in ("vg", "jj", "python"):
        check(isinstance(tools.get(name, {}).get("sha256"), str) and len(tools[name]["sha256"]) == 64, f"tool digest missing: {name}")
    check(tools.get("jj", {}).get("version", "").startswith("jj 0.46.0-"), "JJ version is not 0.46.0")
    check(tools.get("environment", {}).get("python") == tools.get("python", {}).get("version"), "Python environment identity mismatch")

    workspaces = report.get("workspaces", {})
    check(set(workspaces) == set(WORKSPACES), "workspace set mismatch")
    for workspace in WORKSPACES:
        row = workspaces.get(workspace, {})
        check(row.get("baseManifest", {}).get("sha256") != row.get("candidateManifest", {}).get("sha256"), f"{workspace} candidate equals base")
        check(bool(row.get("candidateManifest", {}).get("files")), f"{workspace} candidate manifest missing")

    measurements = {row.get("workspace"): row for row in report.get("measurements", [])}
    check(set(measurements) == set(WORKSPACES), "measurement workspace set mismatch")
    for workspace in WORKSPACES:
        row = measurements.get(workspace, {})
        command = commands.get(row.get("commandId"), {})
        check(command.get("exitCode") == 0, f"{workspace} native measurement command failed")
        check(verify_artifact(report, root, row.get("reportArtifact", ""), issues), f"{workspace} native report missing")
        check(row.get("grouped") == {"jj_plus_same_full_check": 3, "vg_full": 3, "vg_selected_plus_required_full": 3}, f"{workspace} lane count mismatch")
        lanes = row.get("lanes", [])
        check(len(lanes) == 9, f"{workspace} normalized lane count mismatch")
        for lane in lanes:
            check(lane.get("coldSeconds", 0) > 0 and lane.get("warmSeconds", 0) > 0, f"{workspace} cost missing")
            if lane.get("lane") in ("vg_full", "vg_selected_plus_required_full"):
                check(bool(lane.get("treeIds")) and all(lane.get("treeIds")), f"{workspace} managed tree identity missing")
                check(lane.get("planScope") == "selected" and lane.get("executionScope") in ("full", "selected"), f"{workspace} selection scope missing")
        for run in (1, 2, 3):
            run_lanes = {lane["lane"]: lane for lane in lanes if lane.get("run") == run}
            full = run_lanes.get("vg_full", {})
            selected = run_lanes.get("vg_selected_plus_required_full", {})
            check(full.get("planScope") == "selected" and full.get("executionScope") == "full", f"{workspace} run {run} full scope mismatch")
            check(selected.get("planScope") == "selected" and selected.get("executionScope") == "selected", f"{workspace} run {run} selected scope mismatch")
            check(len(selected.get("treeIds", [])) >= 2, f"{workspace} run {run} lacks final full tree")
            check(bool(full.get("treeIds")) and full["treeIds"][0] == selected["treeIds"][0], f"{workspace} run {run} B/C tree mismatch")

    git_lanes = report.get("gitLanes", [])
    check(len(git_lanes) == 6, "Git lane count mismatch")
    for workspace in WORKSPACES:
        rows = [row for row in git_lanes if row.get("workspace") == workspace]
        check(len(rows) == 3, f"{workspace} Git run count mismatch")
        check(len({row.get("treeOid") for row in rows}) == 1, f"{workspace} Git tree drift")
        for row in rows:
            check(row.get("passed") is True and row.get("exitCode") == 0, f"{workspace} Git full failed")
            check(row.get("dirtyPreserved") is True and row.get("untrackedPreserved") is True, f"{workspace} dirty state lost")

    targeted = report.get("targetedTests", [])
    check(len(targeted) >= 2, "targeted tests missing")
    for row in targeted:
        command = commands.get(row.get("id"), {})
        check(command.get("exitCode") == 0, f"targeted test failed: {row.get('id')}")

    cases = report.get("cases", {})
    check(set(cases) == set(CASES), "case set mismatch")
    for identifier in CASES:
        row = cases.get(identifier, {})
        check(row.get("passed") is True, f"case failed: {identifier}")
        check(row.get("commandIds") and all(item in commands for item in row["commandIds"]), f"case command binding missing: {identifier}")

    tokens = report.get("tokens", {})
    check(tokens.get("status") == "not-applicable" and bool(tokens.get("reason")), "token scope is not explicit")
    costs = report.get("costs", {})
    command_costs = costs.get("commands", [])
    check(len(command_costs) == len(commands), "cost command set mismatch")
    check(abs(sum(float(row.get("wallSeconds", 0)) for row in command_costs) - float(costs.get("wallSecondsTotal", -1))) < 1e-6, "wall cost total mismatch")
    check(abs(sum(float(row.get("cpuSeconds", 0)) for row in command_costs) - float(costs.get("cpuSecondsTotal", -1))) < 1e-6, "CPU cost total mismatch")
    check(max(int(row.get("peakTreeRssBytes", 0)) for row in command_costs) == int(costs.get("peakTreeRssBytesMax", -1)), "RSS maximum mismatch")
    cleanup = report.get("cleanup", {})
    check(cleanup.get("remaining") == 0, "temporary cleanup incomplete")
    return {"ok": not issues, "issues": issues, "acceptanceEligible": not issues and not allow_development, "reportDigest": report_digest(report)}


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
        mutations = {
            "delete-case": lambda doc: doc["cases"].pop("stale-basis"),
            "wrong-candidate": lambda doc: doc.update(candidate={**doc["candidate"], "commit": "0" * 40}),
            "artifact-digest-tamper": lambda doc: next(iter(doc["artifacts"].values())).update(sha256="0" * 64),
            "selected-upgraded": lambda doc: doc["cases"]["selected-final-full"].update(passed=False),
            "tree-mismatch": lambda doc: doc["measurements"][0]["lanes"][1]["treeIds"].__setitem__(0, "f" * 40),
            "missing-git-lane": lambda doc: doc["gitLanes"].pop(),
            "self-consistent-forgery": lambda doc: doc["cases"]["combined-candidate"].update(passed=False),
        }
        checks = []
        for name, mutate in mutations.items():
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
