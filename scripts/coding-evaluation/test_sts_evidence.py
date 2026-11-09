"""Unit tests for the independently recomputed STS evaluation."""
from pathlib import Path
import copy
import gzip
import hashlib
import importlib.util
import json
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("sts_evidence", HERE / "verify-sts.py")
sts = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sts)


def write_digest(root: Path, artifacts: dict, relative: str, data: bytes) -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    artifacts[relative] = {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}


def make_report(root: Path) -> dict:
    artifacts = {}
    for name in ("outputs/diagnostic.out", "outputs/diagnostic.err"):
        write_digest(root, artifacts, name, b"diagnostic\n")
    for name in ("inputs/vg.exe", "inputs/sts.whl", "inputs/v1.json", "inputs/v2.json", "environment/setup.log"):
        write_digest(root, artifacts, name, (name + "\n").encode())
    write_digest(root, artifacts, "package/wrong-environment.json", b'{"content_confirmed":false,"conservative_full_available":false}\n')
    command = {
        "id": "diagnostic", "exitCode": 0, "expectedExitCode": 0, "waitedForExit": True,
        "stdoutArtifact": "outputs/diagnostic.out", "stderrArtifact": "outputs/diagnostic.err",
        "stdoutSha256": hashlib.sha256(b"diagnostic\n").hexdigest(),
        "stderrSha256": hashlib.sha256(b"diagnostic\n").hexdigest(),
    }
    negatives = {}
    for identifier, kind in sts.REQUIRED_NEGATIVES.items():
        negatives[identifier] = {"passed": True, "kind": kind, "commandIds": ["diagnostic"], "evidence": ["outputs/diagnostic.out"]}
    protocols = {version: {"consumeOk": True, "hostPlanOk": True, "hostSelectionOk": True, "hostBinding": "unverified" if version == "1.1" else "confirmed", "completeness": "complete", "validity": "valid", "stabilityRepeats": 2, "negativeControls": 0 if version == "1.1" else 4} for version in sts.PROTOCOLS}
    projects = {}
    identities = {"httpx": "worktree@aaaaaaaa+dirty:1", "packaging": "worktree@bbbbbbbb+dirty:1"}
    for project_id in sts.PROJECT_IDS:
        trials = []
        for temperature in ("cold", "warm"):
            for repeat in range(1, 6):
                for arm in ("selected", "full"):
                    identifier = f"{project_id}-{arm}-{temperature}-{repeat}"
                    doc = {
                        "target_identity": identities[project_id], "selection_scope": arm,
                        "collected": ["tests/test_probe.py::test_probe"], "selected": ["tests/test_probe.py::test_probe"],
                        "runs": {
                            "selected": {"executed": ["tests/test_probe.py::test_probe"], "outcomes": {"tests/test_probe.py::test_probe": {"outcome": "passed"}}, "completeness": "complete", "validity": "valid", "raw_exit_code": 0},
                            "full": {"executed": ["tests/test_probe.py::test_probe"], "outcomes": {"tests/test_probe.py::test_probe": {"outcome": "passed"}}, "completeness": "complete", "validity": "valid", "raw_exit_code": 0},
                        },
                    }
                    relative = f"benchmarks/{project_id}/{identifier}.json.gz"
                    write_digest(root, artifacts, relative, gzip.compress(json.dumps(doc).encode(), 9))
                    trials.append({
                        "id": identifier, "arm": arm, "temperature": temperature, "repeat": repeat,
                        "exitCode": 0, "wallSeconds": 1.0, "peakTreeRssBytes": 100,
                        "candidateIdentity": identities[project_id], "selectionScope": arm,
                        "counts": {"collected": 1, "selected": 1, "executed": 1, "passed": 1, "failed": 0, "skipped": 0, "other": 0, "notExecuted": 0, "missed": 0},
                        "cleanup": {"ownedProcesses": 0, "temporaryReports": 0}, "reportArtifact": relative,
                    })
        aggregate = sts._aggregate_trials(trials)
        projects[project_id] = {
            "source": {"verifiedPin": True, "dirty": True, "changedPaths": ["tests/test_probe.py"], "expectedPath": "tests/test_probe.py", "diffSha256": "a" * 64},
            "interpreter": {"path": str(root / "venv" / "Scripts" / "python.exe"), "moduleInsideVenv": True},
            "environment": {"setupWallSeconds": 1.0, "setupLog": "environment/setup.log"},
            "trials": trials, "aggregate": aggregate,
            "totalCost": {"wallSecondsWithSetup": aggregate["wallSecondsTotal"] + 1.0},
        }
    return {
        "schema": sts.SCHEMA, "taskId": sts.TASK, "driven_by": "agent", "actor": sts.ACTOR,
        "realHumanEvidence": False, "acceptanceEligible": True, "selectionDefault": "off",
        "candidate": {"commit": "1" * 40, "tree": "2" * 40, "dirty": False},
        "source": {"native": {"commit": "3" * 40, "tree": "4" * 40, "dirty": False, "vgArtifact": "inputs/vg.exe", "wheelArtifact": "inputs/sts.whl", "vgSha256": artifacts["inputs/vg.exe"]["sha256"], "wheelSha256": artifacts["inputs/sts.whl"]["sha256"], "contracts": {"v1ManifestSha256": artifacts["inputs/v1.json"]["sha256"], "v2ManifestSha256": artifacts["inputs/v2.json"]["sha256"]}}},
        "supportDomains": {"pytest": {"status": "supported"}, "vitest": {"status": "not-applicable", "reason": "native runner"}, "cargo": {"status": "not-applicable", "reason": "native runner"}},
        "stsUnit": {"returnCode": 0, "passed": 503, "skipped": 1, "manifestMatched": True, "historicalAuditPassed": True},
        "cleanInstall": {"ok": True, "installedRequired": True, "module": "venv/Lib/site-packages/smart_sorter/__init__.py", "protocols": protocols},
        "controls": {"covered": {"passed": True, "missedFailures": 0}},
        "negativeCases": negatives,
        "selectionInvariant": {"selectedUpgradesToFull": 0, "zeroSelectionPublishedAsPass": False, "skipCountedAsPass": False},
        "benchmarks": {"minColdWarmRepeats": 5, "projects": projects},
        "summary": {"sampleCount": 40, "missedFailureRate": 0, "falsePositiveRate": 0, "claim": "no-benefit", "authoritativeFullVerification": True},
        "commands": [command], "artifacts": artifacts,
    }


class StsEvidenceTests(unittest.TestCase):
    def test_report_digest_ignores_key_order_and_spacing(self):
        first = {"cases": [], "candidate": "a"}
        second = {"candidate": "a", "cases": []}
        self.assertEqual(sts.report_digest(first), sts.report_digest(second))

    def test_required_negative_matrix_is_exact(self):
        self.assertEqual(set(sts.REQUIRED_NEGATIVES), {
            "missed-failure", "zero-selection", "collection-failure", "nodeid-drift",
            "dynamic-parameterization", "conftest-plugin-change", "flaky", "timeout", "environment-drift",
        })
        self.assertEqual(sts.MIN_REPEATS, 5)

    def test_aggregate_exposes_cold_warm_wall_and_rss(self):
        rows = [{"arm": arm, "temperature": temp, "wallSeconds": 2.0, "peakTreeRssBytes": 10, "counts": {"executed": 1}} for arm in ("selected", "full") for temp in ("cold", "warm")]
        result = sts._aggregate_trials(rows)
        self.assertEqual(result["samples"], 4)
        self.assertEqual(result["selected_cold"]["wallSecondsMean"], 2.0)
        self.assertEqual(result["peakTreeRssBytesMax"], 10)

    def test_artifact_escape_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(ValueError):
                sts._resolve(root, "../outside.json")

    def test_coherent_fixture_verifies(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = make_report(root)
            result = sts.verify(report, root, "1" * 40, sts.report_digest(report))
            self.assertTrue(result["ok"], result["issues"])

    def test_selected_upgrade_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = make_report(root)
            report["selectionInvariant"]["selectedUpgradesToFull"] = 1
            result = sts.verify(report, root, "1" * 40, sts.report_digest(report))
            self.assertFalse(result["ok"])

    def test_missing_negative_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = make_report(root)
            report["negativeCases"].pop("timeout")
            result = sts.verify(report, root, "1" * 40, sts.report_digest(report))
            self.assertFalse(result["ok"])

    def test_raw_trial_tamper_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = make_report(root)
            altered = copy.deepcopy(report)
            trial = altered["benchmarks"]["projects"]["httpx"]["trials"][0]
            doc = {"target_identity": trial["candidateIdentity"], "selection_scope": trial["selectionScope"], "collected": [], "selected": [], "runs": {"selected": {"executed": [], "outcomes": {}, "completeness": "complete", "validity": "valid", "raw_exit_code": 0}, "full": {"executed": [], "outcomes": {}, "completeness": "complete", "validity": "valid", "raw_exit_code": 0}}}
            write_digest(root, altered["artifacts"], trial["reportArtifact"], gzip.compress(json.dumps(doc).encode(), 9))
            result = sts.verify(altered, root, "1" * 40, sts.report_digest(altered))
            self.assertFalse(result["ok"])


if __name__ == "__main__":
    unittest.main()
