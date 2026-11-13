"""Unit tests for the independent joint evidence verifier."""
from pathlib import Path
import copy
import importlib.util
import unittest

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("joint_evidence", HERE / "verify-joint.py")
joint = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(joint)


class JointEvidenceTests(unittest.TestCase):
    def test_report_digest_is_canonical(self):
        self.assertEqual(joint.report_digest({"b": 2, "a": 1}), joint.report_digest({"a": 1, "b": 2}))

    def test_required_case_set_is_complete(self):
        self.assertEqual(set(joint.CASES), {
            "same-file-competition", "cross-file-dependency", "rename-delete", "stale-basis",
            "dirty-preservation", "combined-candidate", "cancellation-recovery",
            "selected-final-full", "planted-wrong-combination",
        })
        self.assertEqual(len(set(joint.CASES)), 9)

    def test_artifact_escape_is_rejected(self):
        with self.assertRaises(ValueError):
            joint.resolve(Path.cwd(), "../outside")

    def test_schema_and_agent_are_exact(self):
        self.assertEqual(joint.SCHEMA, "CodingJointEvaluation/v1")
        self.assertEqual(joint.ACTOR, "codex-coding-joint-evaluator")
        self.assertFalse("real-human" in joint.ACTOR)

    def test_mutation_copy_is_not_aliased(self):
        original = {"cases": {"stale-basis": {"passed": True}}}
        altered = copy.deepcopy(original)
        altered["cases"]["stale-basis"]["passed"] = False
        self.assertTrue(original["cases"]["stale-basis"]["passed"])


if __name__ == "__main__":
    unittest.main()
