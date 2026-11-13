from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

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

    @staticmethod
    def normal_final_commit() -> str | None:
        merge_head = base.ROOT / ".git/MERGE_HEAD"
        return merge_head.read_text(encoding="ascii").strip() if merge_head.is_file() else None

    def test_all_leaf_inputs_are_complete(self) -> None:
        rows, issues = base.check_inputs(base.ROOT, self.normal_final_commit())
        self.assertEqual(18, len(rows))
        self.assertEqual(10, sum(row["role"].startswith("A") and row["state"] == "resolved" for row in rows))
        self.assertEqual([], issues)

    def test_component_needs_fix_is_rejected(self) -> None:
        definition = next(item for item in base.LEAVES if item["id"] == "TF-0776")
        acceptance = base.load_json(base.ROOT / definition["path"] / "acceptance.json")
        acceptance["passed"] = 0
        with mock.patch.object(base, "load_json", return_value=acceptance), mock.patch.object(
            base, "verify_sums", return_value={"ok": True, "issues": []}
        ):
            row = base.leaf_row(base.ROOT, definition, self.normal_final_commit() or "HEAD")
        self.assertEqual("needs-fix", row["state"])
        self.assertFalse(row["accepted"])
        self.assertIn("leaf acceptance conditions failed", row["issues"])

    def test_leaf_candidate_tree_must_match_commit(self) -> None:
        for node_id in ("TF-0764", "TF-0776"):
            with self.subTest(node_id=node_id):
                definition = next(item for item in base.LEAVES if item["id"] == node_id)
                acceptance = base.load_json(base.ROOT / definition["path"] / "acceptance.json")
                if isinstance(acceptance.get("candidate"), dict):
                    acceptance["candidate"]["tree"] = "0" * 40
                else:
                    acceptance["clawxSourceTree"] = "0" * 40
                with mock.patch.object(base, "load_json", return_value=acceptance), mock.patch.object(
                    base, "verify_sums", return_value={"ok": True, "issues": []}
                ):
                    row = base.leaf_row(base.ROOT, definition, self.normal_final_commit() or "HEAD")
                self.assertFalse(row["accepted"])
                self.assertIn("evidence candidate tree does not match commit", row["issues"])

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

    def structural_report(self, *, tree: str, clean: bool = True) -> tuple[dict[str, object], str]:
        commit = base.git(base.ROOT, "rev-parse", "HEAD").lower()
        report: dict[str, object] = {
            "schema": verifier.SCHEMA,
            "taskId": verifier.TASK,
            "driven_by": "agent",
            "realHumanEvidence": False,
            "candidate": {"commit": commit, "tree": tree, "clean": clean},
            "leaves": [],
            "findings": {"baseline": 10, "resolved": 10, "unresolved": [], "items": {}},
            "fullGates": {"executor": {}, "verifier": {}},
            "package": {"candidate": {"commit": commit}, "checks": {"sourceDetached": True}},
            "conclusions": {
                "functionalReadiness": "ready",
                "qualityReadiness": "pass",
                "performance": "measured-no-net-benefit-proven",
                "operationalReadiness": "pass",
                "distributionReadiness": "win-unpacked-ready-installer-not-run",
                "releaseApproved": False,
                "ga": False,
                "liveReady": False,
                "defaultOn": False,
            },
            "safety": {"p0": 0, "p1": 0, "requiredEvidenceMissing": 0, "fullGateFailures": 0, "productLockChanged": False, "defaultsChanged": False, "releaseAuthorized": False},
            "decision": "accepted",
        }
        return report, base.report_digest(report)

    def structural_issues(self, report: dict[str, object], digest: str, identity: dict[str, object]) -> list[str]:
        candidate = report["candidate"]
        assert isinstance(candidate, dict)
        commit = candidate["commit"]
        gate_rows = [
            {"role": "executor", "actor": "executor-agent", "candidate": {"commit": commit}, "engineeringAcceptedByAgent": False},
            {"role": "verifier", "actor": "gate-verifier-agent", "candidate": {"commit": commit}, "engineeringAcceptedByAgent": True},
        ]
        with mock.patch.object(base, "source_identity", return_value=identity), mock.patch.object(
            base, "check_inputs", return_value=([], [])
        ), mock.patch.object(base, "verify_sums", return_value={"ok": True, "issues": []}), mock.patch.object(
            verifier, "expected_findings", return_value={}
        ), mock.patch.object(verifier, "gate_matches", side_effect=gate_rows), mock.patch.object(verifier, "verify_package"):
            return verifier.verify_structural(report, Path("D:/tmp"), base.ROOT, commit, digest)

    def test_final_source_identity_reads_actual_repository(self) -> None:
        actual_commit = base.git(base.ROOT, "rev-parse", "HEAD").lower()
        actual_tree = base.git(base.ROOT, "rev-parse", "HEAD^{tree}").lower()
        report, digest = self.structural_report(tree="0" * 40)
        issues = self.structural_issues(report, digest, {"commit": actual_commit, "tree": actual_tree, "clean": True})
        self.assertIn("candidate tree differs from repository HEAD tree", issues)

        report, digest = self.structural_report(tree=actual_tree)
        issues = self.structural_issues(report, digest, {"commit": actual_commit, "tree": actual_tree, "clean": False})
        self.assertIn("repository worktree is not clean", issues)

    def test_independent_verifier_metadata_uses_requested_actor(self) -> None:
        with tempfile.TemporaryDirectory(dir="D:/tmp") as temporary:
            root = Path(temporary)
            (root / "acceptance.json").write_text("{}\n", encoding="utf-8")
            digest = "1" * 64
            (root / "report.sha256").write_text(digest + "\n", encoding="ascii")
            report = {"candidate": {"commit": "2" * 40}, "fullGates": {"executor": {"actor": "executor-agent"}}}
            with mock.patch.object(verifier, "verify_structural", return_value=[]), mock.patch.object(base, "build_acceptance", return_value={}):
                checked = verifier.verify(report, root, base.ROOT, "2" * 40, digest, actor="g4-independent-verifier")
            self.assertTrue(checked["ok"])
            self.assertEqual("agent", checked["driven_by"])
            self.assertEqual("g4-independent-verifier", checked["actor"])
            self.assertFalse(checked["realHumanEvidence"])

            with mock.patch.object(verifier, "verify_structural", return_value=[]), mock.patch.object(base, "build_acceptance", return_value={}):
                alternative = verifier.verify(report, root, base.ROOT, "2" * 40, digest, actor="alternate-independent-verifier")
            self.assertTrue(alternative["ok"])
            self.assertEqual("alternate-independent-verifier", alternative["actor"])

            with mock.patch.object(verifier, "verify_structural", return_value=[]), mock.patch.object(base, "build_acceptance", return_value={}):
                rejected = verifier.verify(report, root, base.ROOT, "2" * 40, digest, actor="executor-agent")
            self.assertFalse(rejected["ok"])
            self.assertIn("independent verifier actor matches executor", rejected["issues"])

            with mock.patch.object(verifier, "verify_structural", return_value=[]), mock.patch.object(base, "build_acceptance", return_value={}):
                padded = verifier.verify(report, root, base.ROOT, "2" * 40, digest, actor=" executor-agent ")
            self.assertFalse(padded["ok"])
            self.assertIn("independent verifier actor matches executor", padded["issues"])

            with mock.patch.object(verifier, "verify_structural", return_value=[]), mock.patch.object(base, "build_acceptance", return_value={}):
                missing = verifier.verify(report, root, base.ROOT, "2" * 40, digest)
            self.assertFalse(missing["ok"])
            self.assertIn("independent verifier actor is required", missing["issues"])

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
