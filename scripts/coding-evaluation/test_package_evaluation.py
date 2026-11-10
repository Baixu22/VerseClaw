"""Counterexamples for the independent TF-0781 package verifier."""
from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("package_evidence", HERE / "verify-package-evaluation.py")
package = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(package)

AGG_SPEC = importlib.util.spec_from_file_location("package_aggregator", HERE / "package-evaluation.py")
aggregator = importlib.util.module_from_spec(AGG_SPEC)
AGG_SPEC.loader.exec_module(aggregator)

CANDIDATE = "1" * 40
TREE = "2" * 40


def write_digest(root: Path, artifacts: dict, relative: str, data: bytes) -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    artifacts[relative] = {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}


def command_row(identifier: str, artifact_root: str = "outputs") -> dict:
    stdout = f"{identifier}:ok\n"
    stderr = ""
    stdout_relative = f"{artifact_root}/{identifier}.stdout.bin"
    stderr_relative = f"{artifact_root}/{identifier}.stderr.bin"
    return {
        "id": identifier, "executable": "fixture", "argv": ["fixture"], "cwd": "D:/tmp",
        "exitCode": 0, "expectedExitCode": 0, "waitedForExit": True,
        "stdout": stdout, "stderr": stderr,
        "stdoutSha256": hashlib.sha256(stdout.encode()).hexdigest(),
        "stderrSha256": hashlib.sha256(stderr.encode()).hexdigest(),
        "stdoutArtifact": stdout_relative, "stderrArtifact": stderr_relative, "wallMs": 1,
    }


def make_report(root: Path) -> dict:
    artifacts: dict = {}
    top_commands = [command_row(identifier) for identifier in sorted(package.REQUIRED_COMMANDS)]
    for row in top_commands:
        write_digest(root, artifacts, row["stdoutArtifact"], row["stdout"].encode())
        write_digest(root, artifacts, row["stderrArtifact"], row["stderr"].encode())
    write_digest(root, artifacts, "evidence/source.json", b'{"clean":true}\n')
    write_digest(root, artifacts, "evidence/package.json", b'{"packaged":true}\n')
    write_digest(root, artifacts, "inputs/versegit-manifest.json", b'{"schema":"versegit"}\n')
    write_digest(root, artifacts, "inputs/verseshell-manifest.json", b'{"schema":"verseshell"}\n')
    profiles = []
    for profile_id in package.PROFILES:
        profile_commands = [command_row(identifier, f"profiles/{profile_id}") for identifier in (
            "vg-capabilities", "vg-workspace-import", "vg-change-new", "vg-change-snapshot", "sts-contract-1.1", "sts-contract-2.0",
        )]
        for row in profile_commands:
            write_digest(root, artifacts, row["stdoutArtifact"], row["stdout"].encode())
            write_digest(root, artifacts, row["stderrArtifact"], row["stderr"].encode())
        profiles.append({
            "profileId": profile_id, "status": "pass", "driven_by": "agent",
            "realHumanEvidence": False,
            "roots": {"userData": f"D:/tmp/{profile_id}/user", "home": f"D:/tmp/{profile_id}/home",
                      "state": f"D:/tmp/{profile_id}/state", "workspace": f"D:/tmp/{profile_id}/workspace"},
            "app": {"isPackaged": True}, "sourceDetached": True,
            "packageExecutableSha256": "a" * 64,
            "coding": {"worktreeBackend": "git-worktree", "verifiedCheckout": True, "terminalStatus": "ok",
                       "verificationObserved": True, "scratchRemoved": True, "mathSha256": "b" * 64, "providerAnomalies": []},
            "vg": {
                "capabilities": {"schema": "versegit.capabilities/v1", "safety": {"default_enable": False, "managed_opt_in": True}},
                "workspaceImport": {"schema": "versegit.vg-json/v1", "colocated": True},
                "change": {"change_id": "c", "operation_id": "d" * 128},
                "snapshot": {"operation_id": "e" * 128},
                "sts11": {"ok": True, "protocol": "1.1", "invalidRejected": 10, "invalidTotal": 10},
                "sts20": {"ok": True, "protocol": "2.0", "invalidRejected": 54, "invalidTotal": 54},
                "bundledPythonPresent": False, "standaloneJjPresent": False,
            },
            "commands": profile_commands,
        })
    checks = {
        "threeIndependentProfiles": True, "packagedApplication": True, "sourceDetached": True,
        "codingWorktree": True, "verificationObserved": True, "undoRestored": True,
        "vgJjPassed": True, "stsContractsPassed": True, "defaultsOff": True,
        "installerNotRun": True, "targetedCommandsPassed": True, "processSurvivors": 0,
    }
    package_doc = {
        "root": "D:/tmp/package", "installer": {"status": "not-run"},
        "executable": {"path": "D:/tmp/package/Verse Claw.exe", "sha256": "a" * 64, "bytes": 1},
        "vg": {"path": "D:/tmp/package/resources/bin/vg.exe", "sha256": "b" * 64, "bytes": 1},
        "ae": {"path": "D:/tmp/package/resources/bin/ae.exe", "sha256": "c" * 64, "bytes": 1},
        "node": {"path": "D:/tmp/package/resources/bin/node.exe", "sha256": "d" * 64, "bytes": 1},
        "source": {"versegitCommit": "1" * 40, "verseshellCommit": "2" * 40, "nodeVersion": "v24.16.0"},
        "manifests": {
            "versegit": {"path": "D:/tmp/package/resources/resources/versegit/manifest.json", "sha256": "e" * 64, "bytes": 1, "artifact": "inputs/versegit-manifest.json"},
            "verseshell": {"path": "D:/tmp/package/resources/resources/verseshell/manifest.json", "sha256": "f" * 64, "bytes": 1, "artifact": "inputs/verseshell-manifest.json"},
        },
    }
    return {
        "schema": package.SCHEMA, "taskId": package.TASK, "driven_by": "agent", "actor": package.ACTOR,
        "realHumanEvidence": False, "acceptanceEligible": True,
        "candidate": {"commit": CANDIDATE, "tree": TREE, "dirty": False},
        "package": package_doc, "profiles": profiles, "checks": checks,
        "commands": top_commands, "artifacts": artifacts,
        "cleanup": {"ownedProcesses": 0, "survivors": []},
        "claims": {"realHuman": False, "ga": False, "releaseAuthorized": False, "defaultChanged": False, "productLockChanged": False},
    }


class PackageEvidenceTests(unittest.TestCase):
    def test_report_digest_is_canonical(self) -> None:
        self.assertEqual(package.report_digest({"b": 2, "a": 1}), package.report_digest({"a": 1, "b": 2}))

    def test_schema_constants_are_exact(self) -> None:
        self.assertEqual(package.SCHEMA, "CodingWindowsPackageEvaluation/v1")
        self.assertEqual(package.ACTOR, "codex-coding-package-evaluator")
        self.assertEqual(package.PROFILES, ("profile-a", "profile-b", "profile-c"))
        self.assertNotIn("human", package.ACTOR)

    def test_artifact_escape_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory(dir="D:/tmp") as directory:
            with self.assertRaises(ValueError):
                package.resolve(Path(directory), "../outside.json")

    def test_coherent_fixture_verifies(self) -> None:
        with tempfile.TemporaryDirectory(dir="D:/tmp") as directory:
            root = Path(directory)
            report = make_report(root)
            result = package.verify(report, root, CANDIDATE, package.report_digest(report))
            self.assertTrue(result["ok"], result["issues"])

    def test_profile_and_artifact_mutations_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory(dir="D:/tmp") as directory:
            root = Path(directory)
            report = make_report(root)
            altered = copy.deepcopy(report); altered["profiles"].pop()
            self.assertFalse(package.verify(altered, root, CANDIDATE, package.report_digest(altered))["ok"])
            altered = copy.deepcopy(report); altered["profiles"][1]["profileId"] = altered["profiles"][0]["profileId"]
            self.assertFalse(package.verify(altered, root, CANDIDATE, package.report_digest(altered))["ok"])
            altered = copy.deepcopy(report); next(iter(altered["artifacts"].values()))["sha256"] = "0" * 64
            self.assertFalse(package.verify(altered, root, CANDIDATE, package.report_digest(altered))["ok"])

    def test_false_worker_and_retained_undo_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory(dir="D:/tmp") as directory:
            root = Path(directory)
            report = make_report(root)
            altered = copy.deepcopy(report); altered["profiles"][0]["coding"]["terminalStatus"] = "timeout"
            self.assertFalse(package.verify(altered, root, CANDIDATE, package.report_digest(altered))["ok"])
            altered = copy.deepcopy(report); altered["profiles"][0]["coding"]["scratchRemoved"] = False
            self.assertFalse(package.verify(altered, root, CANDIDATE, package.report_digest(altered))["ok"])

    def test_missing_sts_and_source_overlap_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory(dir="D:/tmp") as directory:
            root = Path(directory)
            report = make_report(root)
            altered = copy.deepcopy(report); altered["profiles"][0]["vg"]["sts20"] = {"ok": False, "protocol": "2.0", "invalidRejected": 1, "invalidTotal": 2}
            self.assertFalse(package.verify(altered, root, CANDIDATE, package.report_digest(altered))["ok"])
            altered = copy.deepcopy(report); altered["profiles"][0]["sourceDetached"] = False
            self.assertFalse(package.verify(altered, root, CANDIDATE, package.report_digest(altered))["ok"])

    def test_negative_check_matrix_rejects_all_mutations(self) -> None:
        with tempfile.TemporaryDirectory(dir="D:/tmp") as directory:
            root = Path(directory)
            report = make_report(root)
            checks = package.negative_checks(report, root, CANDIDATE, package.report_digest(report), False)
            self.assertGreaterEqual(len(checks), 7)
            self.assertTrue(all(row["rejected"] for row in checks), checks)

    def test_artifact_backed_commands_verify(self) -> None:
        with tempfile.TemporaryDirectory(dir="D:/tmp") as directory:
            root = Path(directory)
            report = make_report(root)
            for row in report["commands"]:
                row.pop("stdout")
                row.pop("stderr")
            result = package.verify(report, root, CANDIDATE, package.report_digest(report))
            self.assertTrue(result["ok"], result["issues"])

    def test_artifact_map_keeps_nested_reports(self) -> None:
        with tempfile.TemporaryDirectory(dir="D:/tmp") as directory:
            root = Path(directory)
            (root / "report.json").write_text("top-level\n", encoding="utf-8")
            (root / "package-cli").mkdir()
            (root / "package-cli/report.json").write_text("nested\n", encoding="utf-8")
            artifacts = aggregator.artifact_map(root)
            self.assertNotIn("report.json", artifacts)
            self.assertIn("package-cli/report.json", artifacts)

    def test_retained_supplemental_evidence_verifies(self) -> None:
        fixture = HERE.parents[1] / "harness/specs/fixtures/coding-evaluation/TF-0781"
        report = json.loads((fixture / "report.json").read_text(encoding="utf-8"))
        digest = (fixture / "report.sha256").read_text(encoding="ascii").strip()
        result = package.verify(report, fixture, report["candidate"]["commit"], digest, supplemental=True)
        self.assertTrue(result["ok"], result["issues"])
        self.assertEqual(result["supplemental"]["sourcePackageParityRows"], 6)
        self.assertEqual(result["supplemental"]["packageCliProbes"], 12)

    def test_package_document_serializes_paths(self) -> None:
        with tempfile.TemporaryDirectory(dir="D:/tmp") as directory:
            root = Path(directory)
            package_root = root / "package"
            resources = package_root / "resources"
            payloads = {
                "Verse Claw.exe": b"executable",
                "resources/bin/vg.exe": b"vg",
                "resources/bin/ae.exe": b"ae",
                "resources/bin/node.exe": b"node",
                "resources/bin/uv.exe": b"uv",
                "resources/bin/agent-browser.exe": b"browser",
                "resources/app.asar": b"app",
                "resources/main-runtime.asar": b"runtime",
                "resources/app.asar.unpacked/package.json": b'{"version":"1.2.3"}\n',
            }
            for relative, data in payloads.items():
                path = package_root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
            versegit = {
                "source": {"commit": "a" * 40},
                "artifact": {"sha256": hashlib.sha256(payloads["resources/bin/vg.exe"]).hexdigest()},
            }
            verseshell = {
                "provenance": {"commit": "b" * 40},
                "artifacts": {"win32-x64": {"sha256": hashlib.sha256(payloads["resources/bin/ae.exe"]).hexdigest()}},
            }
            node_runtime = {
                "version": "v-test",
                "sha256": hashlib.sha256(payloads["resources/bin/node.exe"]).hexdigest(),
            }
            for relative, document in {
                "resources/resources/versegit/manifest.json": versegit,
                "resources/resources/verseshell/manifest.json": verseshell,
                "resources/bin/node-runtime.json": node_runtime,
            }.items():
                path = package_root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(document) + "\n", encoding="utf-8")
            output = root / "output"
            result = aggregator.package_document(package_root, output)
            json.dumps(result)
            package_runtime = json.loads((output / "inputs/package-runtime.json").read_text(encoding="utf-8"))
            self.assertEqual(package_runtime["path"], str(resources / "app.asar"))
            self.assertEqual(result["executable"]["version"], "1.2.3")


if __name__ == "__main__":
    unittest.main()
