"""Aggregate TF-0780 recovery-window evidence on the current candidate."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import psutil

ROOT = Path(__file__).resolve().parents[2]
ACTOR = "codex-coding-recovery-evaluator"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_tree(path: Path) -> str:
    if path.is_file():
        return sha256_file(path)
    if not path.is_dir():
        raise FileNotFoundError(path)
    digest = hashlib.sha256()
    for entry in sorted(candidate for candidate in path.rglob("*") if candidate.is_file()):
        relative = entry.relative_to(path).as_posix().encode("utf-8")
        data = sha256_file(entry).encode("ascii")
        digest.update(len(relative).to_bytes(4, "big"))
        digest.update(relative)
        digest.update(len(entry.read_bytes()).to_bytes(8, "big"))
        digest.update(data)
    return digest.hexdigest()


def git(repo: Path, *args: str) -> str:
    result = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, encoding="utf-8")
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def source_document(repo: Path) -> dict:
    status = git(repo, "status", "--short", "--untracked-files=all")
    diff = subprocess.run(["git", "-C", str(repo), "diff", "--binary", "HEAD", "--"], capture_output=True, check=True).stdout
    return {"commit": git(repo, "rev-parse", "HEAD"), "tree": git(repo, "rev-parse", "HEAD^{tree}"), "dirty": bool(status), "diffSha256": sha256_bytes(diff)}


def run(out: Path, commands: list[dict], identifier: str, argv, *, cwd: Path, timeout=1800, env_extra=None) -> dict:
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "-", identifier)
    stdout_path = out / "outputs" / f"{safe}.stdout.bin"
    stderr_path = out / "outputs" / f"{safe}.stderr.bin"
    stdout_path.parent.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env.update(PYTHONUTF8="1", TEMP="D:/tmp", TMP="D:/tmp")
    env.pop("PYTHONPATH", None)
    env.pop("PYTEST_ADDOPTS", None)
    if env_extra:
        env.update({key: str(value) for key, value in env_extra.items()})
    started = time.perf_counter()
    result = subprocess.run([str(item) for item in argv], cwd=cwd, env=env, capture_output=True, timeout=timeout)
    wall = time.perf_counter() - started
    stdout_path.write_bytes(result.stdout)
    stderr_path.write_bytes(result.stderr)
    record = {"id": identifier, "argv": [str(item) for item in argv], "cwd": str(cwd), "exitCode": result.returncode,
              "expectedExitCode": 0, "wallSeconds": wall,
              "waitedForExit": True,
              "stdoutArtifact": stdout_path.relative_to(out).as_posix(), "stderrArtifact": stderr_path.relative_to(out).as_posix(),
              "stdoutSha256": sha256_bytes(result.stdout), "stderrSha256": sha256_bytes(result.stderr)}
    commands.append(record)
    if result.returncode:
        raise RuntimeError(f"{identifier} exit {result.returncode}: {result.stderr.decode('utf-8', errors='replace')[-2000:]}")
    return record


def artifact_map(out: Path) -> dict:
    artifacts = {}
    for path in sorted(out.rglob("*")):
        if not path.is_file() or path.name in {"report.json", "verification.json", "failure.json"} or path.is_relative_to(out / "tmp"):
            continue
        artifacts[path.relative_to(out).as_posix()] = {"sha256": sha256_file(path), "bytes": path.stat().st_size}
    return artifacts


def protected_pids() -> set[int]:
    protected: set[int] = {os.getpid()}
    try:
        current = psutil.Process(os.getpid())
        while current is not None:
            protected.add(current.pid)
            current = current.parent()
    except psutil.Error:
        pass
    return protected


def survivors(out: Path) -> list[dict]:
    root = out.resolve()
    protected = protected_pids()
    result = []
    for process in psutil.process_iter(["pid", "name", "cmdline"]):
        if process.pid in protected:
            continue
        try:
            line = " ".join(process.info.get("cmdline") or [])
            owned = str(root) in line
            if not owned:
                try:
                    owned = Path(process.cwd()).resolve().is_relative_to(root)
                except (psutil.Error, OSError):
                    owned = False
            if owned:
                result.append({"pid": process.pid, "name": process.info.get("name"), "cmdline": line})
        except psutil.Error:
            continue
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vg", type=Path, required=True)
    parser.add_argument("--jj", type=Path, required=True)
    parser.add_argument("--python", type=Path, required=True)
    parser.add_argument("--contracts", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    for name in ("vg", "jj", "python", "contracts", "output"):
        if not getattr(args, name).is_absolute():
            parser.error(f"--{name.replace('_', '-')} must be absolute")
    for name in ("vg", "jj", "python", "contracts"):
        path = getattr(args, name)
        if not path.exists():
            parser.error(f"--{name} does not exist: {path}")
    out = args.output.resolve()
    if out.exists():
        parser.error("--output must be a new directory")
    out.mkdir(parents=True)
    commands: list[dict] = []
    try:
        candidate = source_document(ROOT)
        if candidate["dirty"]:
            raise RuntimeError("Commit the TF-0780 evaluator before formal evidence generation")
        node = shutil.which("node")
        if not node:
            raise RuntimeError("node is not available")
        baseline_dir = out / "baseline"
        recovery_dir = out / "recovery"
        run(out, commands, "journal-kill-baseline", [node, "--import", ROOT / "openclaw_runtime/node_modules/tsx/dist/loader.mjs", ROOT / "scripts/coding-baseline/probes/journal-kill.mts"], cwd=ROOT, timeout=900, env_extra={"CODING_BASELINE_OUTPUT": baseline_dir, "TEMP": "D:/tmp", "TMP": "D:/tmp"})
        run(out, commands, "recovery-windows", [node, "--import", ROOT / "openclaw_runtime/node_modules/tsx/dist/loader.mjs", ROOT / "scripts/coding-evaluation/recovery-windows.mts", "--output", recovery_dir], cwd=ROOT, timeout=1200, env_extra={"TF0780_VG": args.vg.resolve(), "TF0780_JJ": args.jj.resolve(), "TF0780_PYTHON": args.python.resolve(), "TF0780_CONTRACTS": args.contracts.resolve(), "TEMP": "D:/tmp", "TMP": "D:/tmp"})
        run(out, commands, "recovery-evidence-tests", [sys.executable, "-X", "utf8", "-B", ROOT / "scripts/coding-evaluation/test_recovery_evidence.py"], cwd=ROOT, timeout=300)
        run(out, commands, "clawx-recovery-units", ["cmd.exe", "/d", "/s", "/c", "corepack pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run src/agents/apply-patch-consistency.test.ts src/agents/tools/write-journal.test.ts src/agents/apply-patch-effect-receipt.test.ts src/agents/subagent-registry.test.ts --maxWorkers=1"], cwd=ROOT, timeout=1200)
        run(out, commands, "comms-replay", ["cmd.exe", "/d", "/s", "/c", "corepack pnpm run comms:replay"], cwd=ROOT, timeout=900)
        run(out, commands, "comms-compare", ["cmd.exe", "/d", "/s", "/c", "corepack pnpm run comms:compare"], cwd=ROOT, timeout=900)
        run(out, commands, "harness-validate", [node, ROOT / "harness/src/cli.mjs", "validate", "--spec", ROOT / "harness/specs/tasks/coding-cross-process-recovery-evaluation.md"], cwd=ROOT, timeout=600)
        journal = json.loads((baseline_dir / "journal-kill-results.json").read_text(encoding="utf-8"))
        recovery = json.loads((recovery_dir / "recovery-windows.json").read_text(encoding="utf-8"))
        recovery_rows = recovery.get("rows", [])
        control = recovery.get("control", {})
        survivors_found = survivors(out)
        artifacts = artifact_map(out)
        python_version = subprocess.run([str(args.python.resolve()), "--version"], capture_output=True, text=True, timeout=30).stdout.strip()
        node_version = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=30).stdout.strip()
        report = {
            "schema": "CodingRecoveryEvaluation/v1", "taskId": "TF-0780", "driven_by": "agent", "actor": ACTOR,
            "realHumanEvidence": False, "acceptanceEligible": True, "recordedAt": datetime.now(timezone.utc).isoformat(),
            "candidate": candidate,
            "tools": {
                "vg": {"path": str(args.vg.resolve()), "sha256": sha256_file(args.vg.resolve())},
                "jj": {"path": str(args.jj.resolve()), "sha256": sha256_file(args.jj.resolve())},
                "python": {"path": str(args.python.resolve()), "sha256": sha256_file(args.python.resolve()), "version": python_version},
                "node": {"path": str(Path(node).resolve()), "sha256": sha256_file(Path(node).resolve()), "version": node_version},
                "contracts": {"path": str(args.contracts.resolve()), "sha256": sha256_tree(args.contracts.resolve())},
            },
            "baselineJournal": journal, "recoveryWindows": recovery,
            "checks": {"fiveWindows": len({row.get("window") for row in recovery_rows}) == 5,
                       "minimumThreeRepeats": all(sum(1 for row in recovery_rows if row.get("window") == window) >= 3 for window in ("intent", "effect", "materialized", "validated", "cleanup")),
                       "allPassed": journal.get("pass") is True and recovery.get("pass") is True,
                       "targetedCommandsPassed": all(row["exitCode"] == 0 for row in commands),
                       "controlPassed": control.get("pass") is True,
                       "journalKillBaseline": journal.get("pass") is True and len(journal.get("rows", [])) == 3,
                       "oldEpochAdoption": sum(1 for row in recovery_rows if not row.get("restarted", {}).get("message", {}).get("oldEpochRejected")),
                       "duplicateUndo": sum(len(row.get("restarted", {}).get("message", {}).get("second", {}).get("restored", [])) for row in recovery_rows),
                       "lostUserBytes": sum(1 for row in recovery_rows if row.get("restarted", {}).get("message", {}).get("bytes") != "before\n"),
                       "falseCompletion": sum(1 for row in recovery_rows if row.get("restarted", {}).get("message", {}).get("finalLedger", {}).get("completionAuthorized") is not False),
                       "taskLedgerOwner": sum(1 for row in recovery_rows if row.get("restarted", {}).get("message", {}).get("beforeRecovery", {}).get("ledger", {}).get("schema") != "CodingRecoveryTaskLedgerProjection/v1"),
                       "processReconciliation": sum(1 for row in recovery_rows if row.get("restarted", {}).get("message", {}).get("beforeRecovery", {}).get("durableProcess", {}).get("expectedEpochAttempt", {}).get("reason") != "started-helper-dead"),
                       "jjOperations": sum(1 for row in recovery_rows if row.get("restarted", {}).get("message", {}).get("beforeRecovery", {}).get("jj", {}).get("operation", {}).get("code") != 0),
                       "processSurvivors": len(survivors_found)},
            "costs": {"wallSecondsTotal": sum(float(row["wallSeconds"]) for row in commands)},
            "cleanup": {"ownedProcesses": len(survivors_found), "survivors": survivors_found},
            "commands": commands, "artifacts": artifacts,
        }
        report_path = out / "report.json"
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        spec = __import__("importlib.util").util.spec_from_file_location("verify_recovery", ROOT / "scripts/coding-evaluation/verify-recovery.py")
        verifier = __import__("importlib.util").util.module_from_spec(spec)
        spec.loader.exec_module(verifier)
        digest = verifier.report_digest(report)
        (out / "report.sha256").write_text(digest + "\n", encoding="ascii")
        verification = verifier.verify(report, out, candidate["commit"], digest, False)
        (out / "verification.json").write_text(json.dumps(verification, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"output": str(out), "reportDigest": digest, "verification": verification}, ensure_ascii=False, indent=2))
        return 0 if verification["ok"] else 1
    except BaseException as error:
        (out / "failure.json").write_text(json.dumps({"driven_by": "agent", "actor": ACTOR, "realHumanEvidence": False, "error": repr(error), "traceback": __import__("traceback").format_exc(), "commands": commands}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        raise


if __name__ == "__main__":
    raise SystemExit(main())
