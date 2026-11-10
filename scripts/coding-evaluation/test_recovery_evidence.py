"""Counterexamples for the independent TF-0780 recovery evidence verifier."""
from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("recovery_evidence", HERE / "verify-recovery.py")
recovery = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(recovery)

CANDIDATE = "1" * 40
TREE = "2" * 40
BASE = "3" * 40
CANDIDATE_COMMIT = "4" * 40
ACTOR = recovery.ACTOR


def write_digest(root: Path, artifacts: dict, relative: str, data: bytes) -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    artifacts[relative] = {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}


def ledger(phase: str, *, terminal: bool = False, status: str = "doing") -> dict:
    return {
        "schema": "CodingRecoveryTaskLedgerProjection/v1",
        "rootId": "tlroot_recovery",
        "eventCount": 4,
        "eventsPath": ".state/task-ledgers/workspaces/recovery/events.jsonl",
        "phase": phase,
        "status": status,
        "terminal": terminal,
        "completionAuthorized": False,
        "ownerEpoch": "epoch-recovery",
        "latestEventId": "event-4",
    }


def durable(dead: bool = True, exit_code: int | None = None) -> dict:
    return {
        "files": {
            "intent": {"ownerEpoch": "epoch-recovery", "nonce": "nonce"},
            "started": {"helperPid": 1, "childPid": 1},
            **({"exit": {"exitCode": exit_code}} if exit_code is not None else {}),
        },
        "oldEpochAttempt": {"state": "lost", "reason": "owner-epoch-mismatch"},
        "expectedEpochAttempt": (
            {"state": "lost", "reason": "started-helper-dead"}
            if dead else {"state": "terminal", "reason": "exit-observed"}
        ),
    }


def make_report(root: Path) -> dict:
    artifacts = {}
    for identifier in recovery.REQUIRED_COMMANDS:
        stdout = f"{identifier}-stdout\n".encode()
        stderr = f"{identifier}-stderr\n".encode()
        write_digest(root, artifacts, f"outputs/{identifier}.stdout.bin", stdout)
        write_digest(root, artifacts, f"outputs/{identifier}.stderr.bin", stderr)
    commands = [
        {
            "id": identifier,
            "argv": ["fixture"],
            "cwd": str(root),
            "exitCode": 0,
            "expectedExitCode": 0,
            "waitedForExit": True,
            "wallSeconds": 0.01,
            "stdoutArtifact": f"outputs/{identifier}.stdout.bin",
            "stderrArtifact": f"outputs/{identifier}.stderr.bin",
            "stdoutSha256": hashlib.sha256(f"{identifier}-stdout\n".encode()).hexdigest(),
            "stderrSha256": hashlib.sha256(f"{identifier}-stderr\n".encode()).hexdigest(),
        }
        for identifier in sorted(recovery.REQUIRED_COMMANDS)
    ]

    baseline_rows = []
    for window in ("prepared", "effect-written", "committed"):
        baseline_rows.append({
            "window": window,
            "killed": {"signal": "SIGKILL", "message": {"stage": window}},
            "restarted": {"code": 0, "message": {
                "beforeRecovery": {"bytes": "before\n" if window == "prepared" else "after\n"},
                "first": {"restored": ["a.txt"], "errors": []},
                "second": {"restored": [], "errors": []},
                "bytes": "before\n",
            }},
            "pass": True,
        })
    baseline = {
        "schema": "CodingJournalKillWindows/v1", "driven_by": "agent",
        "realHumanEvidence": False, "rows": baseline_rows, "pass": True,
    }

    receipt = {
        "path": ".openclaw/recovery/vg-receipt.json",
        "sha256": "a" * 64,
        "materialized": True,
        "candidate": {"parents": [BASE, CANDIDATE_COMMIT]},
    }
    rows = []
    for window in recovery.WINDOWS:
        for repeat in recovery.REPEATS:
            expected_effect = "before\n" if window == "intent" else "after\n"
            expected_state = "prepared" if window in ("intent", "effect") else "committed"
            receipts = window in ("materialized", "validated", "cleanup")
            before = {
                "bytes": expected_effect,
                "treeSha256": hashlib.sha256(expected_effect.encode()).hexdigest(),
                "states": [expected_state],
                "ref": ".openclaw/journal/kill-window#batch=kill-batch&entries=1",
                "git": " M a.txt\n",
                "gitHead": CANDIDATE_COMMIT,
                "base": BASE,
                "jj": {"code": 0, "stdout": "working copy summary\n", "operation": {"code": 0, "stdout": "op-recovery\n"}},
                "ledger": ledger(window),
                "durableProcess": durable(),
                "vgReceipt": copy.deepcopy(receipt) if receipts else None,
                "stsScope": "full" if receipts else None,
                "tempRemoved": window != "cleanup",
            }
            rows.append({
                "window": window,
                "repeat": repeat,
                "workspace": str(root / "workspaces" / f"{window}-{repeat}"),
                "jjInit": {"code": 0, "stdout": "", "stderr": ""},
                "killed": {"signal": "SIGKILL", "message": {"stage": window}},
                "restarted": {"code": 0, "message": {
                    "beforeRecovery": before,
                    "first": {"restored": ["a.txt"], "errors": []},
                    "second": {"restored": [], "errors": []},
                    "oldEpochRejected": True,
                    "durableProcess": copy.deepcopy(before["durableProcess"]),
                    "finalLedger": ledger("recovered", terminal=True, status="review"),
                    "bytes": "before\n",
                    "tempRemoved": True,
                }},
                "pass": True,
            })

    controlled = {
        "bytes": "after\n",
        "treeSha256": hashlib.sha256(b"after\n").hexdigest(),
        "states": ["committed"],
        "ref": ".openclaw/journal/kill-window#batch=kill-batch&entries=1",
        "git": "",
        "gitHead": CANDIDATE_COMMIT,
        "base": BASE,
        "jj": {"code": 0, "stdout": "clean\n", "operation": {"code": 0, "stdout": "op-control\n"}},
        "ledger": ledger("returned"),
        "durableProcess": durable(dead=False, exit_code=0),
        "vgReceipt": copy.deepcopy(receipt),
        "stsScope": "selected",
        "tempRemoved": True,
    }
    recovery_doc = {
        "schema": "CodingRecoveryWindows/v2", "driven_by": "agent", "actor": ACTOR,
        "realHumanEvidence": False, "windows": list(recovery.WINDOWS),
        "repeats": recovery.MIN_REPEATS,
        "control": {
            "jjInit": {"code": 0, "stdout": "", "stderr": ""},
            "run": {"code": 0, "signal": None, "message": {"stage": "returned"}},
            "inspect": {"code": 0, "message": {"beforeRecovery": controlled}},
            "pass": True,
        },
        "rows": rows,
        "pass": True,
    }
    write_digest(root, artifacts, "baseline/journal-kill-results.json",
                 (json.dumps(baseline, sort_keys=True) + "\n").encode())
    write_digest(root, artifacts, "recovery/recovery-windows.json",
                 (json.dumps(recovery_doc, sort_keys=True) + "\n").encode())

    return {
        "schema": recovery.SCHEMA,
        "taskId": recovery.TASK,
        "driven_by": "agent",
        "actor": ACTOR,
        "realHumanEvidence": False,
        "acceptanceEligible": True,
        "candidate": {"commit": CANDIDATE, "tree": TREE, "dirty": False},
        "tools": {
            name: {"path": str(root / "inputs" / name), "sha256": "a" * 64}
            for name in ("vg", "jj", "python", "contracts")
        },
        "baselineJournal": baseline,
        "recoveryWindows": recovery_doc,
        "checks": {
            "fiveWindows": True,
            "minimumThreeRepeats": True,
            "allPassed": True,
            "targetedCommandsPassed": True,
            "controlPassed": True,
            "oldEpochAdoption": 0,
            "duplicateUndo": 0,
            "lostUserBytes": 0,
            "falseCompletion": 0,
            "processSurvivors": 0,
        },
        "costs": {"wallSecondsTotal": 1.0},
        "cleanup": {"ownedProcesses": 0, "survivors": []},
        "commands": commands,
        "artifacts": artifacts,
    }


class RecoveryEvidenceTests(unittest.TestCase):
    def test_report_digest_is_canonical(self) -> None:
        self.assertEqual(recovery.report_digest({"b": 2, "a": 1}), recovery.report_digest({"a": 1, "b": 2}))

    def test_schema_constants_are_exact(self) -> None:
        self.assertEqual(recovery.SCHEMA, "CodingRecoveryEvaluation/v1")
        self.assertEqual(recovery.ACTOR, "codex-coding-recovery-evaluator")
        self.assertEqual(recovery.WINDOWS, ("intent", "effect", "materialized", "validated", "cleanup"))
        self.assertEqual(recovery.REPEATS, (1, 2, 3))
        self.assertNotIn("human", recovery.ACTOR)

    def test_artifact_escape_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory(dir="D:/tmp") as directory:
            with self.assertRaises(ValueError):
                recovery.resolve(Path(directory), "../outside.json")

    def test_coherent_fixture_verifies(self) -> None:
        with tempfile.TemporaryDirectory(dir="D:/tmp") as directory:
            root = Path(directory)
            report = make_report(root)
            result = recovery.verify(report, root, CANDIDATE, recovery.report_digest(report))
            self.assertTrue(result["ok"], result["issues"])

    def test_deleted_window_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory(dir="D:/tmp") as directory:
            root = Path(directory)
            report = make_report(root)
            altered = copy.deepcopy(report)
            altered["recoveryWindows"]["rows"].pop(0)
            self.assertFalse(recovery.verify(altered, root, CANDIDATE, recovery.report_digest(altered))["ok"])

    def test_artifact_digest_tamper_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory(dir="D:/tmp") as directory:
            root = Path(directory)
            report = make_report(root)
            altered = copy.deepcopy(report)
            next(iter(altered["artifacts"].values()))["sha256"] = "0" * 64
            self.assertFalse(recovery.verify(altered, root, CANDIDATE, recovery.report_digest(altered))["ok"])

    def test_fake_epoch_and_duplicate_undo_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory(dir="D:/tmp") as directory:
            root = Path(directory)
            report = make_report(root)
            altered = copy.deepcopy(report)
            altered["recoveryWindows"]["rows"][0]["restarted"]["message"]["oldEpochRejected"] = False
            self.assertFalse(recovery.verify(altered, root, CANDIDATE, recovery.report_digest(altered))["ok"])
            altered = copy.deepcopy(report)
            altered["recoveryWindows"]["rows"][0]["restarted"]["message"]["second"]["restored"].append("a.txt")
            self.assertFalse(recovery.verify(altered, root, CANDIDATE, recovery.report_digest(altered))["ok"])

    def test_missing_receipt_and_wrong_binding_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory(dir="D:/tmp") as directory:
            root = Path(directory)
            report = make_report(root)
            altered = copy.deepcopy(report)
            materialized = next(row for row in altered["recoveryWindows"]["rows"] if row["window"] == "materialized")
            materialized["restarted"]["message"]["beforeRecovery"]["vgReceipt"] = None
            self.assertFalse(recovery.verify(altered, root, CANDIDATE, recovery.report_digest(altered))["ok"])
            altered = copy.deepcopy(report)
            materialized = next(row for row in altered["recoveryWindows"]["rows"] if row["window"] == "materialized")
            materialized["restarted"]["message"]["beforeRecovery"]["vgReceipt"]["candidate"]["parents"][1] = "0" * 40
            self.assertFalse(recovery.verify(altered, root, CANDIDATE, recovery.report_digest(altered))["ok"])

    def test_false_completion_and_failed_control_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory(dir="D:/tmp") as directory:
            root = Path(directory)
            report = make_report(root)
            altered = copy.deepcopy(report)
            altered["recoveryWindows"]["rows"][0]["restarted"]["message"]["finalLedger"]["completionAuthorized"] = True
            self.assertFalse(recovery.verify(altered, root, CANDIDATE, recovery.report_digest(altered))["ok"])
            altered = copy.deepcopy(report)
            altered["recoveryWindows"]["control"]["pass"] = False
            self.assertFalse(recovery.verify(altered, root, CANDIDATE, recovery.report_digest(altered))["ok"])

    def test_negative_check_matrix_rejects_all_mutations(self) -> None:
        with tempfile.TemporaryDirectory(dir="D:/tmp") as directory:
            root = Path(directory)
            report = make_report(root)
            checks = recovery.negative_checks(report, root, CANDIDATE, recovery.report_digest(report), False)
            self.assertGreaterEqual(len(checks), 7)
            self.assertTrue(all(row["rejected"] for row in checks), checks)


if __name__ == "__main__":
    unittest.main()