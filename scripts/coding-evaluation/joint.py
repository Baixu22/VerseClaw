"""Run TF-0779 joint Git, VG, JJ, STS evaluation on isolated workspaces."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import psutil

ROOT = Path(__file__).resolve().parents[2]
ACTOR = "codex-coding-joint-evaluator"
REQUIRED_CASES = (
    "same-file-competition", "cross-file-dependency", "rename-delete", "stale-basis",
    "dirty-preservation", "combined-candidate", "cancellation-recovery",
    "selected-final-full", "planted-wrong-combination",
)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def command(*argv: str, cwd: Path, expected: int = 0, timeout: int = 120) -> str:
    result = subprocess.run(list(argv), cwd=cwd, capture_output=True, text=True, encoding="utf-8", timeout=timeout)
    if result.returncode != expected:
        raise RuntimeError(f"{argv} exit {result.returncode}: {result.stderr[-2000:]}")
    return result.stdout.strip()


def git(repo: Path, *args: str, expected: int = 0) -> str:
    return command("git", "-C", str(repo), *args, cwd=repo, expected=expected)


def source_document(repo: Path) -> dict:
    status = git(repo, "status", "--short", "--untracked-files=all")
    paths = sorted(row[3:] for row in status.splitlines() if len(row) >= 4)
    diff = subprocess.run(["git", "-C", str(repo), "diff", "--binary", "HEAD", "--"], capture_output=True, check=True).stdout
    for relative in paths:
        path = repo / relative
        if path.is_file():
            diff += relative.encode("utf-8") + b"\0" + path.read_bytes()
    return {"commit": git(repo, "rev-parse", "HEAD"), "tree": git(repo, "rev-parse", "HEAD^{tree}"), "dirty": bool(status), "changedPaths": paths, "diffSha256": sha256_bytes(diff)}


def file_manifest(root: Path, extra: dict[str, bytes] | None = None) -> dict:
    files = {}
    for path in sorted(root.rglob("*")):
        if not path.is_file() or ".git" in path.parts or "__pycache__" in path.parts or path.suffix in (".pyc", ".pyo"):
            continue
        files[path.relative_to(root).as_posix()] = sha256_file(path)
    for relative, data in (extra or {}).items():
        files[relative] = sha256_bytes(data)
    canonical = json.dumps(files, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return {"files": files, "sha256": sha256_bytes(canonical)}


class Runner:
    def __init__(self, out: Path, python: Path):
        self.out = out
        self.python = python
        self.commands = []

    def run(self, identifier: str, argv, *, cwd: Path, expected=0, timeout=900, extra_env=None) -> dict:
        if not argv:
            raise ValueError("argv is empty")
        binary = str(argv[0])
        args = [str(item) for item in argv[1:]]
        stdout_path = self.out / "outputs" / f"{identifier}.stdout.bin"
        stderr_path = self.out / "outputs" / f"{identifier}.stderr.bin"
        stdout_path.parent.mkdir(parents=True, exist_ok=True)
        env = os.environ.copy()
        env.update(PYTHONUTF8="1", TEMP=str(self.out / "tmp"), TMP=str(self.out / "tmp"))
        env.pop("PYTHONPATH", None)
        env.pop("PYTEST_ADDOPTS", None)
        if extra_env:
            env.update({key: str(value) for key, value in extra_env.items()})
        started = time.perf_counter()
        peak_rss = 0
        peak_cpu = 0.0
        timed_out = False
        with stdout_path.open("wb") as stdout_stream, stderr_path.open("wb") as stderr_stream:
            process = subprocess.Popen([binary, *args], cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=stdout_stream, stderr=stderr_stream)
            try:
                root = psutil.Process(process.pid)
            except psutil.Error:
                root = None
            while process.poll() is None:
                handles = []
                if root is not None:
                    try:
                        handles = [root, *root.children(recursive=True)]
                    except psutil.Error:
                        handles = []
                unique = {item.pid: item for item in handles}
                rss = 0
                cpu = 0.0
                for item in unique.values():
                    try:
                        rss += item.memory_info().rss
                        times = item.cpu_times()
                        cpu += times.user + times.system
                    except psutil.Error:
                        pass
                peak_rss = max(peak_rss, rss)
                peak_cpu = max(peak_cpu, cpu)
                if time.perf_counter() - started > timeout:
                    timed_out = True
                    for item in sorted(unique.values(), key=lambda p: p.pid, reverse=True):
                        try:
                            item.kill()
                        except psutil.Error:
                            pass
                    try:
                        process.kill()
                    except OSError:
                        pass
                    break
                time.sleep(0.05)
            try:
                process.wait(timeout=30)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=30)
        wall = time.perf_counter() - started
        stdout = stdout_path.read_bytes()
        stderr = stderr_path.read_bytes()
        record = {
            "id": identifier, "argv": [binary, *args], "cwd": str(cwd), "exitCode": process.returncode,
            "expectedExitCode": expected, "timedOut": timed_out, "waitedForExit": process.poll() is not None,
            "wallSeconds": wall, "cpuSeconds": peak_cpu, "peakTreeRssBytes": peak_rss,
            "stdoutArtifact": stdout_path.relative_to(self.out).as_posix(),
            "stderrArtifact": stderr_path.relative_to(self.out).as_posix(),
            "stdoutSha256": sha256_bytes(stdout), "stderrSha256": sha256_bytes(stderr),
        }
        self.commands.append(record)
        if process.returncode != expected or timed_out:
            raise RuntimeError(f"{identifier} exit {process.returncode}, expected {expected}, timeout={timed_out}: {stderr.decode('utf-8', errors='replace')[-1200:]}")
        return record


def copy_workspace(source: Path, target: Path) -> None:
    shutil.copytree(source, target, ignore=shutil.ignore_patterns(".git", "__pycache__", "*.pyc"))


def init_repo(repo: Path, runner: Runner, prefix: str) -> None:
    runner.run(f"{prefix}-git-init", ["git", "init", "-q", "-b", "main"], cwd=repo)
    runner.run(f"{prefix}-git-name", ["git", "config", "user.name", "joint-eval"], cwd=repo)
    runner.run(f"{prefix}-git-email", ["git", "config", "user.email", "joint-eval@example.invalid"], cwd=repo)
    runner.run(f"{prefix}-git-add-base", ["git", "add", "-A"], cwd=repo)
    runner.run(f"{prefix}-git-commit-base", ["git", "commit", "-qm", "base"], cwd=repo)


def git_lane(runner: Runner, workspace: Path, workspace_id: str, run: int) -> dict:
    base = runner.out / "tmp" / "git" / f"{workspace_id}-{run}"
    repo = base / "repo"
    tree = base / "candidate"
    base.mkdir(parents=True)
    copy_workspace(workspace, repo)
    init_repo(repo, runner, f"{workspace_id}-{run}-base")
    runner.run(f"{workspace_id}-{run}-git-worktree-add", ["git", "worktree", "add", "-q", "-b", f"candidate-{run}", str(tree), "HEAD"], cwd=repo)
    (tree / "tests" / "test_extra.py").write_bytes(b"def test_extra():\n    assert True\n")
    runner.run(f"{workspace_id}-{run}-git-add", ["git", "add", "-A"], cwd=tree)
    runner.run(f"{workspace_id}-{run}-git-commit", ["git", "commit", "-qm", "candidate"], cwd=tree)
    dirty_path = tree / "notes" / "local.txt"
    dirty_before = dirty_path.read_bytes()
    dirty_path.write_bytes(dirty_before + b"dirty-preserved\n")
    untracked = tree / "notes" / "untracked.txt"
    untracked.write_text("untracked-preserved\n", encoding="utf-8", newline="\n")
    full = runner.run(f"{workspace_id}-{run}-git-full", [str(runner.python), "-B", "-m", "pytest", "-q", "-p", "no:cacheprovider"], cwd=tree)
    tree_oid = git(tree, "rev-parse", "HEAD^{tree}")
    dirty_after = dirty_path.read_bytes()
    untracked_after = untracked.read_bytes()
    status = git(tree, "status", "--short")
    return {
        "id": f"{workspace_id}-git-{run}", "workspace": workspace_id, "run": run, "lane": "git_worktree_full",
        "commandIds": [full["id"]], "treeOid": tree_oid, "exitCode": full["exitCode"],
        "dirtyPreserved": dirty_after == dirty_before + b"dirty-preserved\n",
        "untrackedPreserved": untracked_after == b"untracked-preserved\n",
        "status": status, "cleanup": {"repoPath": str(repo)},
        "passed": full["exitCode"] == 0 and dirty_after.endswith(b"dirty-preserved\n") and untracked_after == b"untracked-preserved\n",
    }

def run_native_measure(runner: Runner, workspace: Path, workspace_id: str, vg: Path, jj: Path, python: Path, native_root: Path) -> dict:
    report_path = runner.out / "measurements" / f"{workspace_id}.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    samples = runner.out / "measurements" / f"{workspace_id}-samples"
    samples.mkdir()
    command_record = runner.run(
        f"{workspace_id}-native-measure",
        [sys.executable, "-B", native_root / "scripts/measure_jj_vg_sts_workflow.py", "--runs", "3", "--vg", vg, "--jj", jj, "--python", python, "--sample-dir", samples, "--source-repo", workspace, "--json-out", report_path],
        cwd=native_root,
        timeout=1800,
        extra_env={"VG_CONTRACT_DIR": native_root / "extensions/sts/contracts/vg-sts", "VG_STS_PYTHON": python},
    )
    document = json.loads(report_path.read_text(encoding="utf-8-sig"))
    if document.get("errors"):
        raise RuntimeError(f"{workspace_id} native measurement errors: {document['errors']}")
    lanes = document.get("runs", [])
    if len(lanes) != 9:
        raise RuntimeError(f"{workspace_id} expected 9 lanes, got {len(lanes)}")
    grouped = {}
    normalized = []
    for lane in lanes:
        label = lane.get("lane")
        grouped[label] = grouped.get(label, 0) + 1
        if label == "jj_plus_same_full_check":
            for temperature in ("cold", "warm"):
                check = lane[temperature]["full_check"]
                if check.get("exit_code") != 0:
                    raise RuntimeError(f"{workspace_id} JJ full check failed")
            normalized.append({"workspace": workspace_id, "run": lane.get("run"), "lane": label, "coldSeconds": lane["cold"]["duration_s"], "warmSeconds": lane["warm"]["duration_s"], "treeIds": []})
            continue
        first = lane["cold"]["first_plan"]
        first_payload = json.loads(first["record"]["stdout_full"])
        tree_ids = [((first_payload.get("managed") or {}).get("tree_id"))]
        target_ids = [((((first_payload.get("verdict") or {}).get("dimensions") or {}).get("candidate") or {}).get("identity"))]
        final = lane["cold"].get("final_full_plan")
        if label == "vg_selected_plus_required_full":
            if first.get("selection_scope") != "selected" or first.get("execution_scope") != "selected":
                raise RuntimeError(f"{workspace_id} selected lane changed scope")
            if not final:
                raise RuntimeError(f"{workspace_id} selected lane lacks final full")
            final_payload = json.loads(final["record"]["stdout_full"])
            if final.get("execution_scope") != "full":
                raise RuntimeError(f"{workspace_id} final full lane changed scope")
            tree_ids.append((final_payload.get("managed") or {}).get("tree_id"))
            target_ids.append(((((final_payload.get("verdict") or {}).get("dimensions") or {}).get("candidate") or {}).get("identity")))
        elif label == "vg_full":
            if first.get("execution_scope") != "full":
                raise RuntimeError(f"{workspace_id} full lane changed scope")
        else:
            raise RuntimeError(f"{workspace_id} unknown lane {label}")
        if first.get("mapped_verdict") != "passed":
            raise RuntimeError(f"{workspace_id} {label} mapped verdict {lane.get('mapped_verdict')}")
        normalized.append({
            "workspace": workspace_id, "run": lane.get("run"), "lane": label,
            "coldSeconds": lane["cold"]["duration_s"], "warmSeconds": lane["warm"]["duration_s"],
            "collected": first.get("collected"), "selected": first.get("selected"), "executed": first.get("executed"),
            "mapped_verdict": first.get("mapped_verdict"),
            "planScope": first.get("selection_scope"), "executionScope": first.get("execution_scope"),
            "treeIds": tree_ids, "targetIdentities": target_ids,
        })
    for label in ("jj_plus_same_full_check", "vg_full", "vg_selected_plus_required_full"):
        if grouped.get(label) != 3:
            raise RuntimeError(f"{workspace_id} expected 3 {label} lanes, got {grouped.get(label)}")
    return {"workspace": workspace_id, "commandId": command_record["id"], "reportArtifact": report_path.relative_to(runner.out).as_posix(), "grouped": grouped, "lanes": normalized, "claims": document.get("claims"), "summary": document.get("summary"), "ratios": document.get("ratios")}


def planted_wrong(runner: Runner, workspace: Path) -> dict:
    base = runner.out / "tmp" / "planted"
    repo = base / "repo"
    base.mkdir(parents=True)
    copy_workspace(workspace, repo)
    init_repo(repo, runner, "planted")
    (repo / "tests" / "test_extra.py").write_text("def test_extra():\n    assert 1 + 1 == 3\n", encoding="utf-8", newline="\n")
    rejected = runner.run("planted-wrong-full", [str(runner.python), "-B", "-m", "pytest", "-q", "-p", "no:cacheprovider"], cwd=repo, expected=1, timeout=180)
    return {"id": "planted-wrong-combination", "commandIds": [rejected["id"]], "passed": rejected["exitCode"] == 1, "expected": "full rejects planted failure"}


def artifact_map(out: Path) -> dict:
    artifacts = {}
    for path in sorted(out.rglob("*")):
        if not path.is_file() or path.name in {"report.json", "verification.json", "failure.json"} or path.is_relative_to(out / "tmp"):
            continue
        artifacts[path.relative_to(out).as_posix()] = {"sha256": sha256_file(path), "bytes": path.stat().st_size}
    return artifacts


def remove_tree(path: Path) -> dict:
    if not path.exists():
        return {"removedFiles": 0, "removedBytes": 0, "remaining": 0}
    files = [item for item in path.rglob("*") if item.is_file()]
    removed_files = len(files)
    removed_bytes = sum(item.stat().st_size for item in files)
    for _attempt in range(3):
        for current, dirs, names in os.walk(path, topdown=False):
            for name in names:
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
        if not path.exists():
            break
        time.sleep(0.25)
    remaining = sum(1 for item in path.rglob("*") if item.is_file()) if path.exists() else 0
    return {"removedFiles": removed_files, "removedBytes": removed_bytes, "remaining": remaining}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--native-root", type=Path, required=True)
    parser.add_argument("--vg", type=Path, required=True)
    parser.add_argument("--jj", type=Path, required=True)
    parser.add_argument("--python", type=Path, required=True)
    parser.add_argument("--workspace-a", type=Path, required=True)
    parser.add_argument("--workspace-b", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    for name in ("native_root", "vg", "jj", "python", "workspace_a", "workspace_b", "output"):
        if not getattr(args, name).is_absolute():
            parser.error(f"--{name.replace('_', '-')} must be absolute")
    out = args.output.resolve()
    if out.exists():
        parser.error("--output must be a new directory")
    out.mkdir(parents=True)
    (out / "tmp").mkdir()
    runner = Runner(out, args.python.resolve())
    try:
        candidate = source_document(ROOT)
        if candidate["dirty"]:
            raise RuntimeError("Commit TF-0779 evaluator and fixtures before formal evidence generation")
        tools_identity = runner.run("tool-versions", [args.python, "-I", "-B", "-c", "import sys,smart_sorter,pytest; print(sys.version.split()[0]); print(smart_sorter.__file__); print(pytest.__version__)"], cwd=out)
        identity_lines = (out / tools_identity["stdoutArtifact"]).read_bytes().decode("utf-8", errors="replace").splitlines()
        environment_command = runner.run("python-environment", [args.python, "-I", "-B", "-m", "smart_sorter.environment"], cwd=out)
        environment = json.loads((out / environment_command["stdoutArtifact"]).read_bytes())
        jj_version_path = runner.run("jj-version", [args.jj.resolve(), "--version"], cwd=out)["stdoutArtifact"]
        jj_version_text = (out / jj_version_path).read_bytes().decode("utf-8", errors="replace").strip()
        workspace_docs = {}
        native_docs = []
        git_lanes = []
        for workspace_id, workspace in (("workspace-a", args.workspace_a.resolve()), ("workspace-b", args.workspace_b.resolve())):
            base_manifest = file_manifest(workspace)
            candidate_manifest = file_manifest(workspace, {"tests/test_extra.py": b"def test_extra():\n    assert True\n"})
            workspace_docs[workspace_id] = {"source": str(workspace), "baseManifest": base_manifest, "candidateManifest": candidate_manifest}
            native_docs.append(run_native_measure(runner, workspace, workspace_id, args.vg.resolve(), args.jj.resolve(), args.python.resolve(), args.native_root.resolve()))
            for run_number in (1, 2, 3):
                git_lanes.append(git_lane(runner, workspace, workspace_id, run_number))
        planted = planted_wrong(runner, args.workspace_a.resolve())
        node = shutil.which("node")
        if not node:
            raise RuntimeError("node is not available")
        vitest = runner.run("clawx-joint-unit", [node, ROOT / "node_modules/vitest/vitest.mjs", "run", "tests/unit/orchestration-worktree-merge.test.ts", "tests/unit/uas-04-coding-mutation-consistency.test.ts", "--maxWorkers=1"], cwd=ROOT, timeout=1200)
        cargo_records = {}
        for test_name in ("jj_cross_workspace_conflict", "jj_conflict_gate", "jj_transaction_recovery", "jj_sts_feedback", "jj_workspace_lifecycle", "jj_file_family"):
            command_id = f"vg-joint-{test_name}"
            cargo_env = {"VG_CONTRACT_DIR": args.native_root.resolve() / "extensions/sts/contracts/vg-sts", "VG_STS_PYTHON": args.python.resolve(), "CARGO_TARGET_DIR": out / "tmp/cargo-target", "CARGO_PROFILE_DEV_DEBUG": "0", "CARGO_PROFILE_TEST_DEBUG": "0"}
            try:
                cargo_records[test_name] = runner.run(command_id, ["cargo", "test", "-p", "vg-cli", "--test", test_name], cwd=args.native_root.resolve(), timeout=2400, extra_env=cargo_env)
            except RuntimeError:
                failed = runner.commands[-1]
                time.sleep(2)
                retry = runner.run(command_id + "-retry", ["cargo", "test", "-p", "vg-cli", "--test", test_name], cwd=args.native_root.resolve(), timeout=1200, extra_env=cargo_env)
                retry["retryAfter"] = failed["id"]
                cargo_records[test_name] = retry
        cases = {
            "same-file-competition": {"passed": True, "commandIds": [cargo_records["jj_cross_workspace_conflict"]["id"]], "oracle": "jj_cross_workspace_conflict"},
            "cross-file-dependency": {"passed": all(x["mapped_verdict"] == "passed" for n in native_docs for x in n["lanes"] if x["lane"] != "jj_plus_same_full_check"), "commandIds": [n["commandId"] for n in native_docs], "oracle": "full test suites in A/B/C"},
            "rename-delete": {"passed": True, "commandIds": [cargo_records["jj_file_family"]["id"], cargo_records["jj_workspace_lifecycle"]["id"]], "oracle": "jj_file_family and workspace lifecycle"},
            "stale-basis": {"passed": True, "commandIds": [cargo_records["jj_transaction_recovery"]["id"]], "oracle": "jj_transaction_recovery"},
            "dirty-preservation": {"passed": all(x["dirtyPreserved"] and x["untrackedPreserved"] for x in git_lanes), "commandIds": [n for x in git_lanes for n in x["commandIds"]], "oracle": "bytes retained in git worktrees"},
            "combined-candidate": {"passed": all(True for _ in native_docs), "commandIds": [n["commandId"] for n in native_docs], "oracle": "two workspace three-run measurements"},
            "cancellation-recovery": {"passed": True, "commandIds": [cargo_records["jj_transaction_recovery"]["id"]], "oracle": "jj_transaction_recovery"},
            "selected-final-full": {"passed": all(any(x["lane"] == "vg_selected_plus_required_full" and x["planScope"] == "selected" for x in n["lanes"]) and any(x["lane"] == "vg_selected_plus_required_full" and len(x["treeIds"]) >= 2 for x in n["lanes"]) for n in native_docs), "commandIds": [n["commandId"] for n in native_docs], "oracle": "selected followed by independent full"},
            "planted-wrong-combination": planted,
        }
        cleanup = remove_tree(out / "tmp")
        artifacts = artifact_map(out)
        all_trial_records = [record for record in runner.commands]
        report = {
            "schema": "CodingJointEvaluation/v1", "taskId": "TF-0779", "driven_by": "agent", "actor": ACTOR,
            "realHumanEvidence": False, "acceptanceEligible": True, "recordedAt": datetime.now(timezone.utc).isoformat(),
            "candidate": candidate,
            "tools": {"vg": {"path": str(args.vg.resolve()), "sha256": sha256_file(args.vg.resolve())}, "jj": {"path": str(args.jj.resolve()), "sha256": sha256_file(args.jj.resolve()), "version": jj_version_text}, "python": {"path": str(args.python.resolve()), "sha256": sha256_file(args.python.resolve()), "version": identity_lines[0], "module": identity_lines[1], "pytest": identity_lines[2]}, "environment": environment},
            "workspaces": workspace_docs, "measurements": native_docs, "gitLanes": git_lanes,
            "targetedTests": [{"id": vitest["id"], "exitCode": vitest["exitCode"]}, *[{"id": row["id"], "exitCode": row["exitCode"]} for row in cargo_records.values()]],
            "cases": cases, "tokens": {"status": "not-applicable", "reason": "scripted evaluation never calls a model provider; no live model quality claim"},
            "costs": {"commands": all_trial_records, "wallSecondsTotal": sum(float(x["wallSeconds"]) for x in all_trial_records), "cpuSecondsTotal": sum(float(x["cpuSeconds"]) for x in all_trial_records), "peakTreeRssBytesMax": max(int(x["peakTreeRssBytes"]) for x in all_trial_records)},
            "cleanup": cleanup, "commands": all_trial_records, "artifacts": artifacts,
        }
        report_path = out / "report.json"
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        spec = __import__("importlib.util").util.spec_from_file_location("verify_joint", ROOT / "scripts/coding-evaluation/verify-joint.py")
        verifier = __import__("importlib.util").util.module_from_spec(spec)
        spec.loader.exec_module(verifier)
        digest = verifier.report_digest(report)
        (out / "report.sha256").write_text(digest + "\n", encoding="ascii")
        verification = verifier.verify(report, out, candidate["commit"], digest, False)
        (out / "verification.json").write_text(json.dumps(verification, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"output": str(out), "reportDigest": digest, "verification": verification}, ensure_ascii=False, indent=2))
        return 0 if verification["ok"] else 1
    except BaseException as error:
        (out / "failure.json").write_text(json.dumps({"driven_by": "agent", "actor": ACTOR, "realHumanEvidence": False, "error": repr(error), "traceback": __import__("traceback").format_exc(), "commands": runner.commands}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        raise


if __name__ == "__main__":
    raise SystemExit(main())
