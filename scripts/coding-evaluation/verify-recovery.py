"""Independently verify TF-0780 cross-process recovery evidence."""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
from pathlib import Path

SCHEMA = "CodingRecoveryEvaluation/v1"
TASK = "TF-0780"
ACTOR = "codex-coding-recovery-evaluator"
WINDOWS = ("intent", "effect", "materialized", "validated", "cleanup")
REPEATS = (1, 2, 3)
MIN_REPEATS = len(REPEATS)
REQUIRED_COMMANDS = {
    "journal-kill-baseline",
    "recovery-windows",
    "recovery-evidence-tests",
    "clawx-recovery-units",
    "comms-replay",
    "comms-compare",
    "harness-validate",
}
REQUIRED_ARTIFACTS = {
    "baseline/journal-kill-results.json",
    "recovery/recovery-windows.json",
}
HEX40 = re.compile(r"^[0-9a-f]{40}$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def report_digest(report: dict) -> str:
    encoded = json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return sha256_bytes(encoded)


def resolve(root: Path, relative: str) -> Path:
    base = root.resolve()
    path = (base / relative).resolve()
    if not path.is_relative_to(base):
        raise ValueError(f"artifact escapes evidence root: {relative}")
    return path


def check_artifact(report: dict, root: Path, relative: str, issues: list[str]) -> bool:
    try:
        path = resolve(root, relative)
        metadata = report.get("artifacts", {}).get(relative)
        if not isinstance(metadata, dict):
            issues.append(f"artifact not registered: {relative}")
            return False
        data = path.read_bytes()
        if sha256_bytes(data) != metadata.get("sha256"):
            issues.append(f"artifact digest mismatch: {relative}")
        if len(data) != metadata.get("bytes"):
            issues.append(f"artifact size mismatch: {relative}")
        return True
    except (OSError, ValueError, TypeError) as error:
        issues.append(f"artifact unreadable: {relative}: {error}")
        return False


def _dict(value: object) -> dict:
    return value if isinstance(value, dict) else {}


def _list(value: object) -> list:
    return value if isinstance(value, list) else []


def verify(report: dict, root: Path, candidate: str, expected_digest: str,
           allow_development: bool = False) -> dict:
    issues: list[str] = []

    def check(condition: object, message: str) -> None:
        if not condition:
            issues.append(message)

    check(isinstance(report, dict), "report must be an object")
    if not isinstance(report, dict):
        return {"ok": False, "issues": issues, "acceptanceEligible": False, "reportDigest": None}

    check(report.get("schema") == SCHEMA, "schema mismatch")
    check(report.get("taskId") == TASK, "task id mismatch")
    check(report.get("driven_by") == "agent", "driven_by must be agent")
    check(report.get("actor") == ACTOR, "actor mismatch")
    check(report.get("realHumanEvidence") is False, "realHumanEvidence must be false")
    check(report.get("acceptanceEligible") is True, "report is not acceptance eligible")
    check(isinstance(expected_digest, str) and bool(HEX64.fullmatch(expected_digest)), "expected report digest is malformed")
    check(report_digest(report) == expected_digest, "canonical report digest mismatch")
    check(isinstance(candidate, str) and bool(HEX40.fullmatch(candidate)), "candidate argument is malformed")
    check(_dict(report.get("candidate")).get("commit") == candidate, "candidate commit mismatch")
    check(_dict(report.get("candidate")).get("dirty") is False, "candidate worktree was dirty")
    check(isinstance(_dict(report.get("candidate")).get("tree"), str)
          and bool(HEX40.fullmatch(_dict(report.get("candidate")).get("tree"))), "candidate tree digest missing")

    artifacts = report.get("artifacts")
    check(isinstance(artifacts, dict) and bool(artifacts), "artifact map missing")
    if isinstance(artifacts, dict):
        check(REQUIRED_ARTIFACTS.issubset(artifacts), "required raw artifacts missing")
        for relative in artifacts:
            check(isinstance(relative, str), "artifact path is not a string")
            if isinstance(relative, str):
                check_artifact(report, root, relative, issues)

    commands: dict[str, dict] = {}
    command_rows = _list(report.get("commands"))
    check(bool(command_rows), "commands missing")
    for command in command_rows:
        check(isinstance(command, dict), "command row is not an object")
        if not isinstance(command, dict):
            continue
        identifier = command.get("id")
        check(isinstance(identifier, str) and bool(identifier), "command without id")
        if not isinstance(identifier, str):
            continue
        check(identifier not in commands, f"duplicate command id: {identifier}")
        commands[identifier] = command
        check(command.get("waitedForExit") is True, f"command {identifier} did not wait for exit")
        check(command.get("exitCode") == command.get("expectedExitCode"), f"command {identifier} exit mismatch")
        for channel in ("stdout", "stderr"):
            relative = command.get(f"{channel}Artifact")
            check(isinstance(relative, str), f"command {identifier} lacks {channel} artifact")
            if isinstance(relative, str):
                check_artifact(report, root, relative, issues)
                try:
                    check(sha256_file(resolve(root, relative)) == command.get(f"{channel}Sha256"),
                          f"command {identifier} {channel} digest mismatch")
                except (OSError, ValueError):
                    pass
    check(REQUIRED_COMMANDS.issubset(commands), "required command set incomplete")

    tools = _dict(report.get("tools"))
    for name in ("vg", "jj", "python", "contracts"):
        doc = _dict(tools.get(name))
        digest = doc.get("sha256")
        check(isinstance(digest, str) and bool(HEX64.fullmatch(digest)), f"tool digest missing: {name}")
        check(isinstance(doc.get("path"), str) and bool(doc.get("path")), f"tool path missing: {name}")

    baseline = _dict(report.get("baselineJournal"))
    check(baseline.get("schema") == "CodingJournalKillWindows/v1", "journal-kill schema mismatch")
    check(baseline.get("driven_by") == "agent" and baseline.get("realHumanEvidence") is False,
          "journal-kill provenance mismatch")
    check(baseline.get("pass") is True, "journal-kill baseline failed")
    baseline_rows = _list(baseline.get("rows"))
    check(len(baseline_rows) == 3, "journal-kill baseline window count mismatch")
    check([row.get("window") for row in baseline_rows if isinstance(row, dict)]
          == ["prepared", "effect-written", "committed"], "journal-kill baseline windows mismatch")
    for row in baseline_rows:
        row = _dict(row)
        check(row.get("pass") is True, "journal-kill row failed")
        check(_dict(row.get("killed")).get("signal") == "SIGKILL", "journal-kill real signal missing")
        restarted = _dict(row.get("restarted"))
        message = _dict(restarted.get("message"))
        check(restarted.get("code") == 0, "journal-kill restart failed")
        check(_dict(message.get("first")).get("errors") == []
              and len(_list(_dict(message.get("first")).get("restored"))) == 1, "journal-kill first undo failed")
        check(_dict(message.get("second")).get("errors") == []
              and _dict(message.get("second")).get("restored") == [], "journal-kill duplicate undo replayed")
        check(message.get("bytes") == "before\n", "journal-kill user bytes lost")

    recovery = _dict(report.get("recoveryWindows"))
    check(recovery.get("schema") == "CodingRecoveryWindows/v2", "five-window schema mismatch")
    check(recovery.get("driven_by") == "agent" and recovery.get("realHumanEvidence") is False,
          "five-window provenance mismatch")
    check(recovery.get("actor") == ACTOR, "five-window actor mismatch")
    check(recovery.get("windows") == list(WINDOWS), "five-window declaration mismatch")
    check(recovery.get("repeats") == MIN_REPEATS, "five-window repeat declaration mismatch")
    check(recovery.get("pass") is True, "five-window driver failed")
    rows = _list(recovery.get("rows"))
    check(len(rows) == len(WINDOWS) * MIN_REPEATS, "five-window row count mismatch")

    seen: set[tuple[str, int]] = set()
    workspaces: set[str] = set()
    for row in rows:
        check(isinstance(row, dict), "recovery row is not an object")
        if not isinstance(row, dict):
            continue
        window = row.get("window")
        repeat = row.get("repeat")
        key = (window, repeat)
        check(window in WINDOWS, f"unknown recovery window: {window}")
        check(repeat in REPEATS, f"invalid recovery repeat: {window}/{repeat}")
        check(key not in seen, f"duplicate recovery row: {window}/{repeat}")
        seen.add(key)
        workspace = row.get("workspace")
        check(isinstance(workspace, str) and bool(workspace), f"workspace missing: {window}/{repeat}")
        check(workspace not in workspaces, f"workspace reused: {workspace}")
        if isinstance(workspace, str):
            workspaces.add(workspace)
        check(row.get("pass") is True, f"recovery row failed: {window}/{repeat}")
        check(_dict(row.get("jjInit")).get("code") == 0, f"JJ init failed: {window}/{repeat}")
        killed = _dict(row.get("killed"))
        check(killed.get("signal") == "SIGKILL", f"real kill missing: {window}/{repeat}")
        check(_dict(killed.get("message")).get("stage") == window, f"kill stage mismatch: {window}/{repeat}")
        restarted = _dict(row.get("restarted"))
        check(restarted.get("code") == 0, f"restart failed: {window}/{repeat}")
        message = _dict(restarted.get("message"))
        before = _dict(message.get("beforeRecovery"))
        expected_effect = "before\n" if window == "intent" else "after\n"
        expected_state = "prepared" if window in ("intent", "effect") else "committed"
        receipts_expected = window in ("materialized", "validated", "cleanup")
        check(before.get("bytes") == expected_effect, f"pre-recovery effect mismatch: {window}/{repeat}")
        check(before.get("treeSha256") == sha256_bytes(expected_effect.encode()), f"tree digest mismatch: {window}/{repeat}")
        check(before.get("states") == [expected_state], f"journal state mismatch: {window}/{repeat}")
        check(isinstance(before.get("ref"), str) and bool(before["ref"]), f"journal ref missing: {window}/{repeat}")
        check(isinstance(before.get("git"), str), f"Git readback missing: {window}/{repeat}")
        check(isinstance(before.get("base"), str) and bool(HEX40.fullmatch(before["base"])), f"Git base missing: {window}/{repeat}")
        check(isinstance(before.get("gitHead"), str) and bool(HEX40.fullmatch(before["gitHead"])), f"Git operation missing: {window}/{repeat}")
        jj = _dict(before.get("jj"))
        operation = _dict(jj.get("operation"))
        check(jj.get("code") == 0 and isinstance(jj.get("stdout"), str), f"JJ status missing: {window}/{repeat}")
        check(operation.get("code") == 0 and isinstance(operation.get("stdout"), str)
              and bool(operation["stdout"].strip()), f"JJ operation missing: {window}/{repeat}")

        ledger = _dict(before.get("ledger"))
        durable = _dict(before.get("durableProcess"))
        files = _dict(durable.get("files"))
        intent = _dict(files.get("intent"))
        old_attempt = _dict(durable.get("oldEpochAttempt"))
        expected_attempt = _dict(durable.get("expectedEpochAttempt"))
        check(ledger.get("schema") == "CodingRecoveryTaskLedgerProjection/v1", f"ledger schema mismatch: {window}/{repeat}")
        check(ledger.get("phase") == window, f"ledger phase mismatch: {window}/{repeat}")
        check(ledger.get("terminal") is False and ledger.get("completionAuthorized") is False,
              f"ledger false completion: {window}/{repeat}")
        check(isinstance(ledger.get("eventCount"), int) and ledger["eventCount"] >= 2,
              f"ledger event history missing: {window}/{repeat}")
        check(intent.get("ownerEpoch") == ledger.get("ownerEpoch"), f"owner epoch binding mismatch: {window}/{repeat}")
        check(files.get("started") is not None and files.get("exit") is None, f"durable process files mismatch: {window}/{repeat}")
        check(old_attempt.get("state") == "lost" and old_attempt.get("reason") == "owner-epoch-mismatch",
              f"old epoch accepted: {window}/{repeat}")
        check(expected_attempt.get("state") == "lost" and expected_attempt.get("reason") == "started-helper-dead",
              f"process replay evidence missing: {window}/{repeat}")
        check(message.get("oldEpochRejected") is True, f"old epoch rejection not retained: {window}/{repeat}")

        receipt = before.get("vgReceipt")
        check((receipt is not None) == receipts_expected, f"VG receipt presence mismatch: {window}/{repeat}")
        if receipts_expected:
            receipt = _dict(receipt)
            parents = _dict(receipt.get("candidate")).get("parents")
            check(receipt.get("materialized") is True, f"VG materialization missing: {window}/{repeat}")
            check(isinstance(parents, list) and len(parents) >= 2 and parents[1] == before.get("gitHead"),
                  f"VG candidate binding mismatch: {window}/{repeat}")
            check(before.get("stsScope") in ("selected", "full"), f"STS scope missing: {window}/{repeat}")
        else:
            check(before.get("stsScope") is None, f"unexpected STS scope: {window}/{repeat}")

        first = _dict(message.get("first"))
        second = _dict(message.get("second"))
        check(first.get("errors") == [] and len(_list(first.get("restored"))) == 1,
              f"first recovery failed: {window}/{repeat}")
        check(second.get("errors") == [] and second.get("restored") == [],
              f"second recovery replayed: {window}/{repeat}")
        check(message.get("bytes") == "before\n", f"user bytes lost: {window}/{repeat}")
        check(message.get("tempRemoved") is True, f"cleanup incomplete: {window}/{repeat}")
        final = _dict(message.get("finalLedger"))
        check(final.get("phase") == "recovered" and final.get("status") == "review"
              and final.get("terminal") is True and final.get("completionAuthorized") is False,
              f"final ledger is not recoverable non-completion: {window}/{repeat}")

    check(seen == {(window, repeat) for window in WINDOWS for repeat in REPEATS},
          "five-window coverage is incomplete")

    control = _dict(recovery.get("control"))
    check(control.get("pass") is True, "normal control failed")
    check(_dict(control.get("jjInit")).get("code") == 0, "control JJ init failed")
    control_run = _dict(control.get("run"))
    control_inspect = _dict(control.get("inspect"))
    check(control_run.get("code") == 0 and control_run.get("signal") is None,
          "normal control child failed")
    check(_dict(control_run.get("message")).get("stage") == "returned", "normal control did not return")
    check(control_inspect.get("code") == 0, "normal control inspect failed")
    controlled = _dict(_dict(control_inspect.get("message")).get("beforeRecovery"))
    check(controlled.get("bytes") == "after\n", "normal control effect mismatch")
    check(controlled.get("states") == ["committed"], "normal control journal mismatch")
    control_ledger = _dict(controlled.get("ledger"))
    check(control_ledger.get("phase") == "returned" and control_ledger.get("terminal") is False
          and control_ledger.get("completionAuthorized") is False, "normal control ledger mismatch")
    control_durable = _dict(controlled.get("durableProcess"))
    check(_dict(control_durable.get("oldEpochAttempt")).get("reason") == "owner-epoch-mismatch",
          "normal control epoch fence missing")
    terminal_attempt = _dict(control_durable.get("expectedEpochAttempt"))
    check(terminal_attempt.get("state") == "terminal" and terminal_attempt.get("reason") == "exit-observed",
          "normal control exit reconciliation missing")
    check(_dict(_dict(control_durable.get("files")).get("exit")).get("exitCode") == 0,
          "normal control exit receipt mismatch")
    check(_dict(controlled.get("vgReceipt")).get("materialized") is True, "normal control VG receipt missing")
    check(controlled.get("stsScope") in ("selected", "full"), "normal control STS scope missing")
    check(controlled.get("tempRemoved") is True, "normal control cleanup incomplete")

    checks = _dict(report.get("checks"))
    booleans = ("fiveWindows", "minimumThreeRepeats", "allPassed", "targetedCommandsPassed", "controlPassed")
    check(all(checks.get(name) is True for name in booleans), "coverage summary mismatch")
    counters = ("oldEpochAdoption", "duplicateUndo", "lostUserBytes", "falseCompletion", "processSurvivors")
    check(all(checks.get(name) == 0 for name in counters), "recovery safety counters nonzero")
    cleanup = _dict(report.get("cleanup"))
    check(cleanup.get("ownedProcesses") == 0 and cleanup.get("survivors") == [],
          "owned process survived")
    check(isinstance(_dict(report.get("costs")).get("wallSecondsTotal"), (int, float)),
          "wall time cost missing")

    return {
        "ok": not issues,
        "issues": issues,
        "acceptanceEligible": not issues and not allow_development,
        "reportDigest": report_digest(report),
    }


def negative_checks(report: dict, root: Path, candidate: str,
                    expected_digest: str, allow_development: bool) -> list[dict]:
    def first_materialized(doc: dict) -> dict:
        return next(row for row in doc["recoveryWindows"]["rows"] if row.get("window") == "materialized")

    mutations = {
        "delete-window": lambda doc: doc["recoveryWindows"]["rows"].pop(0),
        "wrong-candidate": lambda doc: doc["candidate"].update(commit="0" * 40),
        "artifact-digest-tamper": lambda doc: next(iter(doc["artifacts"].values())).update(sha256="0" * 64),
        "fake-epoch": lambda doc: doc["recoveryWindows"]["rows"][0]["restarted"]["message"].update(oldEpochRejected=False),
        "missing-receipt": lambda doc: first_materialized(doc)["restarted"]["message"]["beforeRecovery"].update(vgReceipt=None),
        "forged-candidate-binding": lambda doc: first_materialized(doc)["restarted"]["message"]["beforeRecovery"]["vgReceipt"]["candidate"]["parents"].__setitem__(1, "0" * 40),
        "duplicate-undo": lambda doc: doc["recoveryWindows"]["rows"][0]["restarted"]["message"]["second"]["restored"].append("a.txt"),
        "false-completion": lambda doc: doc["recoveryWindows"]["rows"][0]["restarted"]["message"]["finalLedger"].update(completionAuthorized=True),
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
        checked = negative_checks(report, args.report.parent, args.candidate,
                                  args.expected_report_digest, args.allow_development)
        result["negativeChecks"] = checked
        if not all(row["rejected"] for row in checked):
            result["ok"] = False
            result["issues"].append("negative evidence was accepted")
    if args.output:
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
