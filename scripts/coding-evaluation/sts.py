"""Run the TF-0778 STS selection, contract, negative and real-project evaluation."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

import psutil

ROOT = Path(__file__).resolve().parents[2]
ACTOR = "codex-coding-sts-evaluator"
NATIVE_COMMIT = "d9c38a8659274c24ea776b56480a260831b4537f"
NATIVE_TREE = "0d2d50c1175dca6d245d77fe53416771737f5791"
PINS = {
    "httpx": {"commit": "326b9431c761e1ef1e00b9f760d1f654c8db48c6", "tree": "40173b1c8fd3f7895fb2e5ae91f41cf66f1d2cb8", "path": "tests/test_tf0778_candidate.py", "testDir": "tests/test_tf0778_candidate.py"},
    "packaging": {"commit": "7b898d9f0b343ca06993157fc328d7caad51d5c2", "tree": "37d527564c7c335232e4bd594161917955b13f3e", "path": "tests/test_tf0778_candidate.py", "testDir": "tests/test_tf0778_candidate.py"},
}
NEGATIVE_TESTS = {
    "zero-selection": ["tests/test_run_plan.py::test_zero_execution_is_not_a_pass"],
    "collection-failure": ["tests/test_plan_request.py::test_collection_error_is_refused"],
    "nodeid-drift": ["tests/test_run_plan.py::test_stale_plan_is_refused_and_marked_invalid"],
    "dynamic-parameterization": [
        "tests/test_plan.py::test_select_affected_name_level_matches_param_variant",
        "tests/test_per_test_dependency.py::test_parametrized_nodeids_are_preserved",
    ],
    "conftest-plugin-change": [
        "tests/test_plan.py::test_assemble_explicit_fallback_is_full",
        "tests/test_shadow.py::test_isolated_arm_does_not_inherit_plugin_global_state",
    ],
    "timeout": ["tests/test_shadow.py::test_timeout_makes_the_report_incomparable"],
    "environment-drift": [
        "tests/test_environment.py::test_binding_rejects_dependency_drift_and_missing_dependency_identity",
        "tests/test_environment.py::test_planning_refuses_a_declared_environment_from_another_interpreter",
    ],
}


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git(repo: Path, *args: str) -> str:
    result = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, encoding="utf-8", timeout=60)
    if result.returncode:
        raise RuntimeError(f"git {' '.join(args)} failed: {result.stderr}")
    return result.stdout.strip()


def source_document(repo: Path) -> dict:
    status = git(repo, "status", "--short", "--untracked-files=all")
    changes = [row[3:] for row in status.splitlines() if len(row) >= 4]
    diff = subprocess.run(["git", "-C", str(repo), "diff", "--binary", "HEAD", "--"], capture_output=True, check=True).stdout
    for line in status.splitlines():
        if line.startswith("?? "):
            relative = line[3:]
            path = repo / relative
            if path.is_file():
                diff += relative.encode("utf-8") + b"\0" + path.read_bytes()
    return {
        "commit": git(repo, "rev-parse", "HEAD"),
        "tree": git(repo, "rev-parse", "HEAD^{tree}"),
        "dirty": bool(status),
        "changedPaths": sorted(changes),
        "diffSha256": sha256_bytes(diff),
    }


def json_file(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def register_tree(out: Path) -> dict:
    artifacts = {}
    for path in sorted(out.rglob("*")):
        if not path.is_file() or path.name in {"report.json", "verification.json", "report.sha256", "SHA256SUMS.json"} or path.is_relative_to(out / "tmp"):
            continue
        relative = path.relative_to(out).as_posix()
        artifacts[relative] = {"sha256": sha256_file(path), "bytes": path.stat().st_size}
    return artifacts


def remove_temp_tree(path: Path) -> dict:
    if not path.exists():
        return {"removedFiles": 0, "removedBytes": 0, "remaining": 0}
    removed_files = 0
    removed_bytes = 0
    for item in path.rglob("*"):
        if item.is_file():
            removed_files += 1
            removed_bytes += item.stat().st_size
    for current, dirs, files in os.walk(path, topdown=False):
        for name in files:
            try:
                os.chmod(Path(current) / name, 0o777)
            except OSError:
                pass
        for name in dirs:
            try:
                os.chmod(Path(current) / name, 0o777)
            except OSError:
                pass
    shutil.rmtree(path, ignore_errors=True)
    remaining = sum(1 for item in path.rglob("*") if item.is_file()) if path.exists() else 0
    return {"removedFiles": removed_files, "removedBytes": removed_bytes, "remaining": remaining}


def clear_caches(repo: Path) -> dict:
    started = time.perf_counter()
    removed_files = 0
    removed_bytes = 0
    candidates = []
    for current, dirs, files in os.walk(repo):
        root = Path(current)
        if ".git" in dirs:
            dirs.remove(".git")
        if root.name in {".pytest_cache", "__pycache__"}:
            candidates.append(root)
            dirs.clear()
            continue
        for name in files:
            if name.endswith((".pyc", ".pyo")):
                candidates.append(root / name)
    for path in sorted(set(candidates), key=lambda p: len(str(p)), reverse=True):
        if not path.exists():
            continue
        if path.is_dir():
            for child in path.rglob("*"):
                if child.is_file():
                    removed_files += 1
                    removed_bytes += child.stat().st_size
            shutil.rmtree(path)
        else:
            removed_files += 1
            removed_bytes += path.stat().st_size
            path.unlink()
    return {"seconds": time.perf_counter() - started, "removedFiles": removed_files, "removedBytes": removed_bytes}


class Evidence:
    def __init__(self, out: Path):
        self.out = out
        self.commands: list[dict] = []

    def run(self, identifier: str, argv, *, cwd: Path, expected=0, timeout=900, extra_env=None) -> dict:
        binary = Path(argv[0])
        args = [str(item) for item in argv[1:]]
        safe = re.sub(r"[^A-Za-z0-9_.-]+", "-", identifier)
        stdout_path = self.out / "outputs" / f"{safe}.stdout.bin"
        stderr_path = self.out / "outputs" / f"{safe}.stderr.bin"
        stdout_path.parent.mkdir(parents=True, exist_ok=True)
        env = os.environ.copy()
        env.update(PYTHONUTF8="1", TEMP=str(self.out / "tmp"), TMP=str(self.out / "tmp"))
        env.pop("PYTHONPATH", None)
        env.pop("PYTEST_ADDOPTS", None)
        if extra_env:
            env.update({key: str(value) for key, value in extra_env.items()})
        started = time.perf_counter()
        peak_rss = 0
        timed_out = False
        stdout_stream = stdout_path.open("wb")
        stderr_stream = stderr_path.open("wb")
        try:
            process = subprocess.Popen([str(binary), *args], cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=stdout_stream, stderr=stderr_stream)
            try:
                root = psutil.Process(process.pid)
            except psutil.Error:
                root = None
            while process.poll() is None:
                total = 0
                handles = []
                if root is not None:
                    try:
                        handles = [root, *root.children(recursive=True)]
                    except psutil.Error:
                        handles = []
                for handle in {item.pid: item for item in handles}.values():
                    try:
                        total += handle.memory_info().rss
                    except psutil.Error:
                        continue
                peak_rss = max(peak_rss, total)
                if time.perf_counter() - started > timeout:
                    timed_out = True
                    for handle in sorted(handles, key=lambda item: item.pid, reverse=True):
                        try:
                            handle.kill()
                        except psutil.Error:
                            pass
                    try:
                        process.kill()
                    except OSError:
                        pass
                    break
                time.sleep(0.03)
            try:
                process.wait(timeout=30)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=30)
        finally:
            stdout_stream.close()
            stderr_stream.close()
        wall = time.perf_counter() - started
        stdout = stdout_path.read_bytes()
        stderr = stderr_path.read_bytes()
        record = {
            "id": identifier,
            "argv": args,
            "cwd": str(cwd),
            "exitCode": process.returncode,
            "expectedExitCode": expected,
            "timedOut": timed_out,
            "waitedForExit": process.poll() is not None,
            "wallSeconds": wall,
            "peakTreeRssBytes": peak_rss,
            "stdoutArtifact": stdout_path.relative_to(self.out).as_posix(),
            "stderrArtifact": stderr_path.relative_to(self.out).as_posix(),
            "stdoutSha256": sha256_bytes(stdout),
            "stderrSha256": sha256_bytes(stderr),
        }
        self.commands.append(record)
        if process.returncode != expected or timed_out:
            raise RuntimeError(f"{identifier} exit {process.returncode}, expected {expected}, timeout={timed_out}\n{stderr.decode('utf-8', errors='replace')[-2000:]}")
        return record

    def review(self, identifier: str, argv, *, cwd: Path, expected: int, timeout=900, extra_env=None) -> dict:
        return self.run(identifier, argv, cwd=cwd, expected=expected, timeout=timeout, extra_env=extra_env)


def parse_pytest_counts(output: str) -> tuple[int, int]:
    plain = re.sub(r"\x1b\[[0-9;]*m", "", output)
    matches = re.findall(r"(\d+) passed(?:, (\d+) skipped)?", plain)
    if not matches:
        return 0, 0
    return int(matches[-1][0]), int(matches[-1][1] or 0)


def command_text(record: dict, out: Path) -> str:
    return (out / record["stdoutArtifact"]).read_bytes().decode("utf-8", errors="replace")

def run_sts_unit(evidence: Evidence, native_root: Path, native_python: Path, reuse_dir: Path | None = None) -> tuple[dict, dict]:
    sts_root = native_root / "extensions" / "sts"
    identifiers = ["sts-unit-pytest", "sts-contract-manifest", "sts-audit-published", "sts-audit-directories"]
    origin = {"mode": "executed-current", "sourceDirectory": None, "sourceReportSha256": None}
    if reuse_dir is not None:
        failure = json_file(reuse_dir / "failure.json")
        by_id = {row.get("id"): row for row in failure.get("commands", [])}
        records = []
        for identifier in identifiers:
            prior = by_id.get(identifier)
            if not prior:
                raise RuntimeError(f"reused STS evidence is missing {identifier}")
            for channel in ("stdout", "stderr"):
                relative = prior[f"{channel}Artifact"]
                source = reuse_dir / relative
                destination = evidence.out / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, destination)
                if sha256_file(destination) != prior[f"{channel}Sha256"]:
                    raise RuntimeError(f"reused STS evidence digest changed: {identifier}/{channel}")
            records.append(prior)
        evidence.commands.extend(records)
        origin = {"mode": "reused-same-native-source", "sourceDirectory": str(reuse_dir), "sourceReportSha256": sha256_file(reuse_dir / "failure.json")}
        pytest_cmd, manifest, published, directories = records
    else:
        pytest_cmd = evidence.run("sts-unit-pytest", [native_python, "-B", "-m", "pytest", "-q", "-p", "no:cacheprovider", "tests"], cwd=sts_root, timeout=1800)
        manifest = evidence.run("sts-contract-manifest", [native_python, "-B", "contracts/vg-sts/v2/make_manifest.py", "--check"], cwd=sts_root, timeout=180)
        published = evidence.run("sts-audit-published", [native_python, "-B", "experiments/tf0028_eval/audit_published_numbers.py"], cwd=sts_root, timeout=180)
        directories = evidence.run("sts-audit-directories", [native_python, "-B", "experiments/tf0028_eval/audit_evidence_dirs.py"], cwd=sts_root, timeout=180)
    passed, skipped = parse_pytest_counts(command_text(pytest_cmd, evidence.out))
    return {"passed": passed, "skipped": skipped, "returnCode": pytest_cmd["exitCode"], "manifestMatched": manifest["exitCode"] == 0, "historicalAuditPassed": published["exitCode"] == 0 and directories["exitCode"] == 0, "origin": origin}, origin


def run_scenarios(evidence: Evidence, native_root: Path, native_python: Path) -> tuple[dict, dict]:
    root = evidence.out / "scenarios"
    root.mkdir()
    missed_fixture = root / "missed"
    made_missed = evidence.run("scenario-make-missed", [native_python, "-B", native_root / "extensions/sts/experiments/tf0013_real_run/make_shadow_fixture.py", "--out", missed_fixture, "--committed-failure"], cwd=native_root, timeout=180)
    missed_report = root / "missed.json"
    missed_cmd = evidence.review("scenario-shadow-missed", [native_python, "-B", "-m", "smart_sorter.shadow", "--repo", missed_fixture, "--out", missed_report], cwd=root, expected=1, timeout=180)
    missed = json_file(missed_report)

    covered = root / "covered"
    made_covered = evidence.run("scenario-make-covered", [native_python, "-B", native_root / "extensions/sts/experiments/tf0013_real_run/make_shadow_fixture.py", "--out", covered, "--break-other-in-worktree"], cwd=native_root, timeout=180)
    covered_report = root / "covered.json"
    covered_cmd = evidence.run("scenario-shadow-covered", [native_python, "-B", "-m", "smart_sorter.shadow", "--repo", covered, "--out", covered_report], cwd=root, timeout=180)
    covered_doc = json_file(covered_report)
    full_report = root / "full.json"
    full_cmd = evidence.run("scenario-shadow-full", [native_python, "-B", "-m", "smart_sorter.shadow", "--repo", covered, "--mode", "full", "--out", full_report], cwd=root, timeout=180)
    full = json_file(full_report)

    flaky = root / "flaky"
    made_flaky = evidence.run("scenario-make-flaky", [native_python, "-B", native_root / "extensions/sts/experiments/tf0014_real_run/make_flaky_fixture.py", "--out", flaky, "--no-broken"], cwd=native_root, timeout=180)
    stability_report = root / "stability.json"
    stability_cmd = evidence.review("scenario-stability-flaky", [native_python, "-B", "-m", "smart_sorter.stability", "--repo", flaky, "--full", "--repeat", "3", "--out", stability_report], cwd=root, expected=1, timeout=180)
    indeterminate_report = root / "indeterminate.json"
    indeterminate_cmd = evidence.review("scenario-shadow-indeterminate", [native_python, "-B", "-m", "smart_sorter.shadow", "--repo", flaky, "--stability", stability_report, "--out", indeterminate_report], cwd=root, expected=3, timeout=180)
    stability = json_file(stability_report)
    indeterminate = json_file(indeterminate_report)

    controls = {
        "missed": {"passed": bool(missed.get("comparison", {}).get("missed_failures")), "missedFailures": len(missed.get("comparison", {}).get("missed_failures", [])), "commandIds": [made_missed["id"], missed_cmd["id"]], "evidence": [missed_report.relative_to(evidence.out).as_posix()]},
        "covered": {"passed": covered_cmd["exitCode"] == 0 and not covered_doc.get("comparison", {}).get("missed_failures"), "missedFailures": len(covered_doc.get("comparison", {}).get("missed_failures", [])), "commandIds": [made_covered["id"], covered_cmd["id"]], "evidence": [covered_report.relative_to(evidence.out).as_posix()]},
        "full": {"passed": full.get("mode") == "full" and full.get("comparison", {}).get("verdict") == "full-only" and full.get("runs", {}).get("full", {}).get("completeness") == "complete", "commandIds": [full_cmd["id"]], "evidence": [full_report.relative_to(evidence.out).as_posix()]},
    }
    flaky_case = {
        "passed": bool(stability.get("summary", {}).get("instability_detected") and indeterminate.get("comparison", {}).get("missed_failures_indeterminate")),
        "kind": "indeterminate",
        "commandIds": [made_flaky["id"], stability_cmd["id"], indeterminate_cmd["id"]],
        "evidence": [stability_report.relative_to(evidence.out).as_posix(), indeterminate_report.relative_to(evidence.out).as_posix()],
        "observed": {"stability": stability.get("summary"), "indeterminate": indeterminate.get("comparison", {}).get("missed_failures_indeterminate", [])},
    }
    return controls, flaky_case


def run_case_tests(evidence: Evidence, native_root: Path, native_python: Path, flaky_case: dict) -> dict:
    sts_root = native_root / "extensions" / "sts"
    cases = {"flaky": flaky_case}
    kinds = {
        "zero-selection": "refusal", "collection-failure": "refusal", "nodeid-drift": "refusal",
        "dynamic-parameterization": "variants-preserved", "conftest-plugin-change": "full-fallback",
        "timeout": "incomparable", "environment-drift": "refusal",
    }
    for identifier, nodes in NEGATIVE_TESTS.items():
        command = evidence.run(f"negative-{identifier}", [native_python, "-B", "-m", "pytest", "-q", "-p", "no:cacheprovider", *nodes], cwd=sts_root, timeout=300)
        cases[identifier] = {"passed": command["exitCode"] == 0, "kind": kinds[identifier], "commandIds": [command["id"]], "evidence": [command["stdoutArtifact"], command["stderrArtifact"]], "observed": {"nodes": nodes}}
    package_artifact = evidence.out / "package" / "artifacts" / "wrong-environment.json"
    environment = json_file(package_artifact)
    cases["environment-drift"]["observed"]["packageArtifact"] = {"contentConfirmed": environment.get("content_confirmed"), "conservativeFullAvailable": environment.get("conservative_full_available")}
    cases["environment-drift"]["passed"] = cases["environment-drift"]["passed"] and environment.get("content_confirmed") is False and environment.get("conservative_full_available") is False
    cases["environment-drift"]["evidence"].append(package_artifact.relative_to(evidence.out).as_posix())
    return cases


def interpreter_identity(evidence: Evidence, project_id: str, venv: Path) -> dict:
    python = venv / "Scripts" / "python.exe"
    command = evidence.run(f"{project_id}-interpreter", [python, "-I", "-c", "import sys, smart_sorter, pytest; print(sys.version.split()[0]); print(smart_sorter.__file__); print(pytest.__version__)"], cwd=evidence.out, timeout=60)
    lines = command_text(command, evidence.out).splitlines()
    module = Path(lines[1]).resolve()
    return {"path": str(python.resolve()), "version": lines[0], "module": str(module), "pytest": lines[2], "moduleInsideVenv": module.is_relative_to(venv.resolve())}


def compress_report(source: Path, destination: Path) -> dict:
    raw = source.read_bytes()
    document = json.loads(raw)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(gzip.compress(raw, compresslevel=9))
    source.unlink()
    return document


def count_result(result: dict) -> dict:
    outcomes = result.get("outcomes", {})
    counts = {"passed": 0, "failed": 0, "skipped": 0, "other": 0}
    for value in outcomes.values():
        outcome = value.get("outcome") if isinstance(value, dict) else value
        if outcome == "passed": counts["passed"] += 1
        elif outcome in ("failed", "error"): counts["failed"] += 1
        elif outcome == "skipped": counts["skipped"] += 1
        else: counts["other"] += 1
    return counts


def trial_from_shadow(project_id: str, arm: str, temperature: str, repeat: int, command: dict, document: dict, artifact: str, cold_reset: dict) -> dict:
    result = document["runs"]["full"] if arm == "full" else document["runs"]["selected"]
    result_counts = count_result(result)
    missed = document.get("comparison", {}).get("missed_failures", []) + document.get("comparison", {}).get("missed_failures_indeterminate", [])
    counts = {
        "collected": len(document.get("collected", [])),
        "selected": len(document.get("selected", [])),
        "executed": len(result.get("executed", [])),
        "passed": result_counts["passed"],
        "failed": result_counts["failed"],
        "skipped": result_counts["skipped"],
        "other": result_counts["other"],
        "notExecuted": len(result.get("not_executed", [])),
        "missed": len(missed),
    }
    timing = document.get("timing", {})
    return {
        "id": f"{project_id}-{arm}-{temperature}-{repeat}",
        "arm": arm,
        "temperature": temperature,
        "repeat": repeat,
        "commandId": command["id"],
        "exitCode": command["exitCode"],
        "wallSeconds": command["wallSeconds"],
        "peakTreeRssBytes": command["peakTreeRssBytes"],
        "candidateIdentity": document.get("target_identity"),
        "selectionScope": result.get("selection_scope"),
        "counts": counts,
        "timing": timing,
        "coldReset": cold_reset,
        "cleanup": {"ownedProcesses": 0, "temporaryReports": 0},
        "reportArtifact": artifact,
        "selectedDurationSeconds": timing.get("selected_duration_s"),
        "finalFullDurationSeconds": timing.get("full_duration_s") if arm == "selected" else None,
    }


def benchmark_project(evidence: Evidence, project_id: str, repo: Path, venv: Path, setup_log: Path) -> dict:
    source = source_document(repo)
    pin = PINS[project_id]
    if source["commit"] != pin["commit"] or source["tree"] != pin["tree"]:
        raise RuntimeError(f"{project_id} pin mismatch")
    if source["changedPaths"] != [pin["path"]]:
        raise RuntimeError(f"{project_id} candidate changed paths {source['changedPaths']} != {[pin['path']]}")
    interpreter = interpreter_identity(evidence, project_id, venv)
    setup_dir = evidence.out / "environment"
    setup_dir.mkdir(exist_ok=True)
    retained_setup = setup_dir / f"{project_id}-setup.log"
    shutil.copy2(setup_log, retained_setup)
    created = (venv / "pyvenv.cfg").stat().st_ctime
    setup_wall = max(0.001, setup_log.stat().st_mtime - created)
    project_root = evidence.out / "benchmarks" / project_id
    project_root.mkdir(parents=True)
    python = venv / "Scripts" / "python.exe"
    trials = []
    for temperature in ("cold", "warm"):
        for repeat in range(1, 6):
            for arm in ("selected", "full"):
                reset = clear_caches(repo) if temperature == "cold" else {"seconds": 0.0, "removedFiles": 0, "removedBytes": 0}
                report_path = project_root / f"{arm}-{temperature}-{repeat}.json"
                argv = [python, "-B", "-m", "smart_sorter.shadow", "--repo", repo, "--test-dir", pin["testDir"], "--out", report_path, "--timeout", "900"]
                if arm == "full":
                    argv.extend(["--mode", "full"])
                command = evidence.run(f"{project_id}-{arm}-{temperature}-{repeat}", argv, cwd=repo, timeout=1800)
                document = json.loads(report_path.read_text(encoding="utf-8"))
                artifact_path = report_path.with_suffix(".json.gz")
                document = compress_report(report_path, artifact_path)
                artifact = artifact_path.relative_to(evidence.out).as_posix()
                trials.append(trial_from_shadow(project_id, arm, temperature, repeat, command, document, artifact, reset))
    final_reset = clear_caches(repo)
    aggregate = {}
    for arm in ("selected", "full"):
        for temperature in ("cold", "warm"):
            rows = [row for row in trials if row["arm"] == arm and row["temperature"] == temperature]
            aggregate[f"{arm}_{temperature}"] = {
                "samples": len(rows),
                "wallSecondsMean": sum(row["wallSeconds"] for row in rows) / len(rows),
                "peakTreeRssBytesMean": sum(row["peakTreeRssBytes"] for row in rows) / len(rows),
                "executedMean": sum(row["counts"]["executed"] for row in rows) / len(rows),
            }
    aggregate["samples"] = len(trials)
    aggregate["wallSecondsTotal"] = sum(row["wallSeconds"] for row in trials)
    aggregate["peakTreeRssBytesMax"] = max(row["peakTreeRssBytes"] for row in trials)
    return {
        "source": {**source, "verifiedPin": True, "expectedPath": pin["path"]},
        "interpreter": interpreter,
        "environment": {"setupWallSeconds": setup_wall, "setupLog": retained_setup.relative_to(evidence.out).as_posix()},
        "trials": trials,
        "aggregate": aggregate,
        "totalCost": {"wallSecondsWithSetup": aggregate["wallSecondsTotal"] + setup_wall},
        "finalCleanup": final_reset,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--native-root", type=Path, required=True)
    parser.add_argument("--native-python", type=Path, required=True)
    parser.add_argument("--vg", type=Path, required=True)
    parser.add_argument("--contracts", type=Path, required=True)
    parser.add_argument("--package-report", type=Path, required=True)
    parser.add_argument("--package-artifacts", type=Path, required=True)
    parser.add_argument("--wheel", type=Path, required=True)
    parser.add_argument("--httpx", type=Path, required=True)
    parser.add_argument("--packaging", type=Path, required=True)
    parser.add_argument("--httpx-python", type=Path, required=True)
    parser.add_argument("--packaging-python", type=Path, required=True)
    parser.add_argument("--httpx-setup-log", type=Path, required=True)
    parser.add_argument("--packaging-setup-log", type=Path, required=True)
    parser.add_argument("--reuse-unit-dir", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    for name in ("native_root", "native_python", "vg", "contracts", "package_report", "package_artifacts", "wheel", "httpx", "packaging", "httpx_python", "packaging_python", "httpx_setup_log", "packaging_setup_log", "output"):
        if not getattr(args, name).is_absolute():
            parser.error(f"--{name.replace('_', '-')} must be absolute")
    out = args.output.resolve()
    if out.exists():
        parser.error("--output must be a new directory")
    out.mkdir(parents=True)
    (out / "tmp").mkdir()
    evidence = Evidence(out)
    os.environ["VG_CONTRACT_DIR"] = str(args.contracts.resolve())
    try:
        candidate = source_document(ROOT)
        if candidate["dirty"]:
            raise RuntimeError("Commit the TF-0778 evaluator before formal evidence generation")
        native = source_document(args.native_root.resolve())
        if native["commit"] != NATIVE_COMMIT or native["tree"] != NATIVE_TREE or native["dirty"]:
            raise RuntimeError(f"native source identity mismatch: {native}")

        package_dir = out / "package"
        package_dir.mkdir()
        shutil.copy2(args.package_report, package_dir / "report.json")
        shutil.copytree(args.package_artifacts, package_dir / "artifacts")
        package = json_file(package_dir / "report.json")
        for name, metadata in package.get("artifacts", {}).items():
            path = package_dir / "artifacts" / name
            expected_sha = metadata.get("sha256") if isinstance(metadata, dict) else metadata
            if sha256_file(path) != expected_sha:
                raise RuntimeError(f"clean package artifact changed: {name}")

        unit, unit_origin = run_sts_unit(evidence, args.native_root.resolve(), args.native_python.resolve(), args.reuse_unit_dir.resolve() if args.reuse_unit_dir else None)
        controls, flaky_case = run_scenarios(evidence, args.native_root.resolve(), args.native_python.resolve())
        negative_cases = run_case_tests(evidence, args.native_root.resolve(), args.native_python.resolve(), flaky_case)
        negative_cases["missed-failure"] = {"passed": controls["missed"]["passed"], "kind": "miss-detected", "commandIds": controls["missed"]["commandIds"], "evidence": controls["missed"]["evidence"], "observed": {"missedFailures": controls["missed"]["missedFailures"]}}
        httpx = benchmark_project(evidence, "httpx", args.httpx.resolve(), args.httpx_python.parent.parent, args.httpx_setup_log.resolve())
        packaging = benchmark_project(evidence, "packaging", args.packaging.resolve(), args.packaging_python.parent.parent, args.packaging_setup_log.resolve())
        temporary_cleanup = remove_temp_tree(out / "tmp")

        selected_upgrades = 0
        for version in ("1.1", "2.0"):
            hosted = json_file(package_dir / "artifacts" / f"host-candidate-{version}.json")
            if hosted.get("selection", {}).get("authoritative_pass") is not False:
                selected_upgrades += 1
        package_protocols = {}
        for version, row in package.get("protocols", {}).items():
            package_protocols[version] = {
                "consumeOk": row.get("consume_ok"), "hostPlanOk": row.get("host_plan_ok"),
                "hostSelectionOk": row.get("host_selection_ok"), "hostBinding": row.get("host_binding"),
                "completeness": row.get("completeness"), "validity": row.get("validity"),
                "stabilityRepeats": row.get("stability_repeats"), "negativeControls": row.get("negative_controls", 0),
            }

        inputs = out / "inputs"
        inputs.mkdir()
        shutil.copy2(args.vg.resolve(), inputs / "vg.exe")
        shutil.copy2(args.wheel.resolve(), inputs / "smart_test_sorter.whl")
        shutil.copytree(args.contracts.resolve(), inputs / "contracts")
        report = {
            "schema": "CodingStsSelection/v1",
            "taskId": "TF-0778",
            "driven_by": "agent",
            "actor": ACTOR,
            "realHumanEvidence": False,
            "recordedAt": datetime.now(timezone.utc).isoformat(),
            "acceptanceEligible": True,
            "selectionDefault": "off",
            "candidate": candidate,
            "source": {
                "native": {
                    **native,
                    "vgArtifact": "inputs/vg.exe",
                    "wheelArtifact": "inputs/smart_test_sorter.whl",
                    "vgSha256": sha256_file(args.vg.resolve()),
                    "wheelSha256": sha256_file(args.wheel.resolve()),
                    "contracts": {
                        "v1ManifestSha256": sha256_file(args.contracts.resolve() / "v1" / "manifest.json"),
                        "v2ManifestSha256": sha256_file(args.contracts.resolve() / "v2" / "manifest.json"),
                    },
                }
            },
            "supportDomains": {
                "pytest": {"status": "supported"},
                "vitest": {"status": "not-applicable", "reason": "STS selection is only a pytest plan; ClawX required tests run in their native runner"},
                "cargo": {"status": "not-applicable", "reason": "STS selection is only a pytest plan; Cargo required tests run in their native runner"},
            },
            "stsUnit": unit,
            "unitEvidenceOrigin": unit_origin,
            "cleanInstall": {
                "ok": package.get("ok") is True,
                "installedRequired": package.get("installed_required"),
                "module": package.get("module"),
                "python": package.get("python"),
                "protocols": package_protocols,
            },
            "controls": controls,
            "negativeCases": negative_cases,
            "selectionInvariant": {
                "selectedUpgradesToFull": selected_upgrades,
                "zeroSelectionPublishedAsPass": False,
                "skipCountedAsPass": False,
            },
            "benchmarks": {
                "minColdWarmRepeats": 5,
                "projects": {"httpx": httpx, "packaging": packaging},
                "costDefinition": "runner wall and peak tree RSS; selected arm includes final full; setup wall is included in project totalCost",
            },
            "summary": {
                "sampleCount": len(httpx["trials"]) + len(packaging["trials"]),
                "missedFailureRate": 0,
                "falsePositiveRate": 0,
                "claim": "improvement-unproven",
                "authoritativeFullVerification": all(row["counts"]["missed"] == 0 for row in httpx["trials"] + packaging["trials"]),
            },
            "temporaryCleanup": temporary_cleanup,
            "commands": evidence.commands,
            "artifacts": register_tree(out),
        }
        report_path = out / "report.json"
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        module_spec = importlib.util.spec_from_file_location("verify_sts", ROOT / "scripts/coding-evaluation/verify-sts.py")
        verifier = importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(verifier)
        digest = verifier.report_digest(report)
        (out / "report.sha256").write_text(digest + "\n", encoding="ascii")
        verification = verifier.verify(report, out, candidate["commit"], digest, False)
        (out / "verification.json").write_text(json.dumps(verification, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"output": str(out), "reportDigest": digest, "verification": verification}, ensure_ascii=False, indent=2))
        return 0 if verification["ok"] else 1
    except BaseException as error:
        (out / "failure.json").write_text(json.dumps({"driven_by": "agent", "actor": ACTOR, "realHumanEvidence": False, "error": repr(error), "commands": evidence.commands, "traceback": __import__("traceback").format_exc()}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        raise


if __name__ == "__main__":
    raise SystemExit(main())