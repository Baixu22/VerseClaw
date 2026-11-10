from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

import final_evaluation as base
import verify_final_evaluation as verifier


class FinalEvaluationTests(unittest.TestCase):
    def test_checksum_manifest_accepts_matching_bytes_and_rejects_tamper(self) -> None:
        with tempfile.TemporaryDirectory(dir="D:/tmp") as temporary:
            root = Path(temporary)
            (root / "artifact.json").write_text('{"ok":true}\n', encoding="utf-8")
            digest = base.sha256_file(root / "artifact.json")
            (root / "SHA256SUMS").write_text(f"{digest}  artifact.json\n", encoding="ascii")
            self.assertTrue(base.verify_sums(root)["ok"])
            (root / "artifact.json").write_text('{"ok":false}\n', encoding="utf-8")
            result = base.verify_sums(root)
            self.assertFalse(result["ok"])
            self.assertIn("artifact digest mismatch: artifact.json", result["issues"])

    def test_checksum_manifest_rejects_path_escape(self) -> None:
        with tempfile.TemporaryDirectory(dir="D:/tmp") as temporary:
            root = Path(temporary)
            (root / "SHA256SUMS").write_text(f"{'0' * 64}  ../escape\n", encoding="ascii")
            result = base.verify_sums(root)
            self.assertFalse(result["ok"])
            self.assertIn("artifact escapes evidence root: ../escape", result["issues"])

    def test_all_leaf_inputs_are_complete(self) -> None:
        rows, issues = base.check_inputs(base.ROOT)
        self.assertEqual(18, len(rows))
        self.assertEqual(10, sum(row["role"].startswith("A") and row["state"] == "resolved" for row in rows))
        self.assertEqual([], issues)

    def test_report_digest_ignores_its_own_field(self) -> None:
        report = {"schema": "test", "decision": "accepted", "reportDigest": "old"}
        first = base.report_digest(report)
        changed = copy.deepcopy(report)
        changed["reportDigest"] = "new"
        self.assertEqual(first, base.report_digest(changed))

    def test_leaf_state_contracts(self) -> None:
        baseline = base.load_json(base.ROOT / "harness/specs/fixtures/coding-vg-sts-jj-baseline/acceptance/acceptance.json")
        finding = base.load_json(base.ROOT / "harness/specs/fixtures/coding-fixes/TF-0765/acceptance.json")
        jj = base.load_json(base.ROOT / "harness/specs/fixtures/coding-evaluation/TF-0776/acceptance.json")
        sts = base.load_json(base.ROOT / "harness/specs/fixtures/coding-evaluation/TF-0778/acceptance.json")
        self.assertEqual(("needs-fix", "baseline"), base.leaf_state("TF-0764", baseline))
        self.assertEqual(("resolved", "finding"), base.leaf_state("TF-0765", finding))
        self.assertEqual(("passed", "component"), base.leaf_state("TF-0776", jj))
        self.assertEqual(("accepted-task-evidence", "component"), base.leaf_state("TF-0778", sts))

    def test_gate_log_digest_mismatch_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory(dir="D:/tmp") as temporary:
            root = Path(temporary)
            (root / "logs").mkdir()
            log = root / "logs" / "gate.stdout.log"
            stderr_log = root / "logs" / "gate.stderr.log"
            log.write_text("pass\n", encoding="utf-8")
            stderr_log.write_text("", encoding="utf-8")
            expected = base.sha256_file(log)
            stderr_expected = base.sha256_file(stderr_log)
            report = {"gates": [{"id": "gate", "status": "pass", "logs": {"stdout": "logs/gate.stdout.log", "stdoutSha256": expected, "stderr": "logs/gate.stderr.log", "stderrSha256": stderr_expected}}]}
            issues: list[str] = []
            verifier.verify_gate_logs(root, report, issues)
            self.assertEqual([], issues)
            log.write_text("tampered\n", encoding="utf-8")
            verifier.verify_gate_logs(root, report, issues)
            self.assertIn("gate gate: stdout log digest mismatch", issues)

    def test_expected_findings_preserves_a1_to_a10_order(self) -> None:
        rows = [
            {"role": f"A{i}", "state": "resolved", "acceptancePath": f"fixtures/{i}", "candidate": {"commit": str(i) * 40, "tree": str(i) * 40}}
            for i in range(1, 11)
        ]
        findings = verifier.expected_findings(rows)
        self.assertEqual([f"A{i}" for i in range(1, 11)], list(findings))
        self.assertEqual("TF-0765", findings["A1"]["node"])
        self.assertEqual("TF-0774", findings["A10"]["node"])


if __name__ == "__main__":
    unittest.main()