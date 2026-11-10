"""Aggregate TF-0781 Windows package and three-profile evidence."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psutil

ROOT = Path(__file__).resolve().parents[2]
ACTOR = "codex-coding-package-evaluator"
EXPECTED_PROFILES = ("profile-a", "profile-b", "profile-c")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git(repo: Path, *args: str) -> str:
    result = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, encoding="utf-8")
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def source_document(repo: Path) -> dict[str, Any]:
    status = git(repo, "status", "--short", "--untracked-files=all")
    diff = subprocess.run(["git", "-C", str(repo), "diff", "--binary", "HEAD", "--"], capture_output=True, check=True).stdout
    return {
        "commit": git(repo, "rev-parse", "HEAD"),
        "tree": git(repo, "rev-parse", "HEAD^{tree}"),
        "dirty": bool(status),
        "diffSha256": sha256_bytes(diff),
    }


def run(out: Path, commands: list[dict[str, Any]], identifier: str, argv: list[Any], *,
        cwd: Path, env_extra: dict[str, Any] | None = None, timeout: int = 1800) -> dict[str, Any]:
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "-", identifier)
    stdout_path = out / "outputs" / f"{safe}.stdout.bin"
    stderr_path = out / "outputs" / f"{safe}.stderr.bin"
    stdout_path.parent.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env.update(TEMP="D:/tmp", TMP="D:/tmp", PYTHONUTF8="1")
    env.pop("PYTHONPATH", None)
    env.pop("PYTEST_ADDOPTS", None)
    if env_extra:
        env.update({key: str(value) for key, value in env_extra.items()})
    started = time.perf_counter()
    result = subprocess.run([str(item) for item in argv], cwd=cwd, env=env, capture_output=True, timeout=timeout)
    wall = time.perf_counter() - started
    stdout_path.write_bytes(result.stdout)
    stderr_path.write_bytes(result.stderr)
    record = {
        "id": identifier, "argv": [str(item) for item in argv], "cwd": str(cwd),
        "exitCode": result.returncode, "expectedExitCode": 0, "waitedForExit": True,
        "wallSeconds": wall,
        "stdoutArtifact": stdout_path.relative_to(out).as_posix(),
        "stderrArtifact": stderr_path.relative_to(out).as_posix(),
        "stdoutSha256": sha256_bytes(result.stdout), "stderrSha256": sha256_bytes(result.stderr),
    }
    commands.append(record)
    if result.returncode:
        raise RuntimeError(f"{identifier} exit {result.returncode}: {result.stderr.decode('utf-8', errors='replace')[-3000:]}")
    return record


def protected_pids() -> set[int]:
    protected = {os.getpid()}
    try:
        current = psutil.Process(os.getpid())
        while current is not None:
            protected.add(current.pid)
            current = current.parent()
    except psutil.Error:
        pass
    return protected


def survivors(*roots: Path) -> list[dict[str, Any]]:
    absolute = [path.resolve() for path in roots]
    protected = protected_pids()
    found = []
    for process in psutil.process_iter(["pid", "name", "cmdline"]):
        if process.pid in protected:
            continue
        try:
            line = " ".join(process.info.get("cmdline") or [])
            owned = any(str(root) in line for root in absolute)
            if not owned:
                try:
                    cwd = Path(process.cwd()).resolve()
                    owned = any(cwd.is_relative_to(root) for root in absolute)
                except (psutil.Error, OSError):
                    owned = False
            if owned:
                found.append({"pid": process.pid, "name": process.info.get("name"), "cmdline": line})
        except psutil.Error:
            continue
    return found


def artifact_map(out: Path) -> dict[str, dict[str, Any]]:
    artifacts: dict[str, dict[str, Any]] = {}
    for path in sorted(out.rglob("*")):
        if not path.is_file() or path.name in {"report.json", "verification.json", "verification-final.json", "failure.json"}:
            continue
        if path.is_relative_to(out / "tmp"):
            continue
        artifacts[path.relative_to(out).as_posix()] = {"sha256": sha256_file(path), "bytes": path.stat().st_size}
    return artifacts


def package_document(package_root: Path, out: Path) -> dict[str, Any]:
    executable = package_root / "Verse Claw.exe"
    resources = package_root / "resources"
    binaries = {
        name: resources / "bin" / filename
        for name, filename in (("vg", "vg.exe"), ("ae", "ae.exe"), ("node", "node.exe"), ("uv", "uv.exe"), ("agentBrowser", "agent-browser.exe"))
    }
    manifests = {
        "versegit": resources / "resources" / "versegit" / "manifest.json",
        "verseshell": resources / "resources" / "verseshell" / "manifest.json",
    }
    required = {"executable": executable, **binaries, **{f"manifest-{key}": value for key, value in manifests.items()},
                "nodeRuntime": resources / "bin" / "node-runtime.json",
                "package": resources / "app.asar", "mainRuntime": resources / "main-runtime.asar"}
    for name, path in required.items():
        if not path.is_file():
            raise FileNotFoundError(f"missing packaged file {name}: {path}")
    versegit_doc = json.loads(manifests["versegit"].read_text(encoding="utf-8"))
    verseshell_doc = json.loads(manifests["verseshell"].read_text(encoding="utf-8"))
    node_runtime_doc = json.loads(required["nodeRuntime"].read_text(encoding="utf-8"))
    vg_sha = sha256_file(binaries["vg"])
    ae_sha = sha256_file(binaries["ae"])
    node_sha = sha256_file(binaries["node"])
    if vg_sha != versegit_doc.get("artifact", {}).get("sha256"):
        raise RuntimeError("packaged vg.exe does not match versegit manifest")
    if ae_sha != verseshell_doc.get("artifacts", {}).get("win32-x64", {}).get("sha256"):
        raise RuntimeError("packaged ae.exe does not match verseshell manifest")
    if node_sha != node_runtime_doc.get("sha256"):
        raise RuntimeError("packaged node.exe does not match node-runtime manifest")
    inputs = out / "inputs"
    inputs.mkdir(parents=True, exist_ok=True)
    for name, path in manifests.items():
        shutil.copy2(path, inputs / f"{name}-manifest.json")
    shutil.copy2(required["nodeRuntime"], inputs / "node-runtime.json")
    package_json = {
        "name": "verse-claw", "version": None, "path": resources / "app.asar"
    }
    try:
        archive_package = json.loads((package_root / "resources" / "app.asar.unpacked" / "package.json").read_text(encoding="utf-8"))
        package_json["version"] = archive_package.get("version")
    except (OSError, json.JSONDecodeError):
        pass
    (inputs / "package-runtime.json").write_text(json.dumps(package_json, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {
        "root": str(package_root),
        "executable": {"path": str(executable), "sha256": sha256_file(executable), "bytes": executable.stat().st_size, "version": package_json.get("version")},
        **{name: {"path": str(path), "sha256": sha256_file(path), "bytes": path.stat().st_size} for name, path in binaries.items()},
        "manifests": {
            key: {
                "path": str(path), "sha256": sha256_file(path), "bytes": path.stat().st_size,
                "artifact": f"inputs/{key}-manifest.json",
            }
            for key, path in manifests.items()
        },
        "asar": {name: {"path": str(path), "sha256": sha256_file(path), "bytes": path.stat().st_size}
                 for name, path in {"app": required["package"], "mainRuntime": required["mainRuntime"]}.items()},
        "nodeRuntime": {"artifact": "inputs/node-runtime.json", "sha256": sha256_file(required["nodeRuntime"]), "bytes": required["nodeRuntime"].stat().st_size},
        "source": {
            "versegitCommit": versegit_doc.get("source", {}).get("commit"),
            "verseshellCommit": verseshell_doc.get("provenance", {}).get("commit"),
            "nodeVersion": node_runtime_doc.get("version"),
        },
        "installer": {"status": "not-run", "reason": "TF-0781 evaluates win-unpacked only"},
    }


def normalize_profile(raw: dict[str, Any], artifact_path: str) -> dict[str, Any]:
    commands = raw.get("commands", [])
    coding = raw.get("coding", {})
    vg = raw.get("vg", {})
    sts11 = vg.get("sts11", {})
    sts20 = vg.get("sts20", {})
    parse11 = sts11.get("parse", {}) if isinstance(sts11, dict) else {}
    parse20 = sts20.get("parse", {}) if isinstance(sts20, dict) else {}
    return {
        "profileId": raw["profileId"],
        "status": raw.get("status", "fail"),
        "driven_by": raw.get("driven_by"),
        "actor": raw.get("actor"),
        "realHumanEvidence": raw.get("realHumanEvidence"),
        "roots": {
            "userData": raw.get("profileDir"),
            "home": raw.get("profileHome"),
            "state": raw.get("profileState"),
            "workspace": raw.get("workspace"),
        },
        "app": raw.get("app", {}),
        "sourceDetached": raw.get("package", {}).get("detachedFromSource") is True,
        "packageExecutableSha256": None,
        "coding": {
            "worktreeBackend": raw.get("run", {}).get("delegationReceipt", {}).get("children", [{}])[0].get("isolation", {}).get("backend"),
            "verifiedCheckout": raw.get("run", {}).get("delegationReceipt", {}).get("children", [{}])[0].get("isolation", {}).get("verifiedCheckout"),
            "terminalStatus": raw.get("workerTerminal", {}).get("status"),
            "verificationObserved": "PACKAGED_VERIFY_PASS" in raw.get("workerToolResults", {}).get("verify", ""),
            "scratchRemoved": coding.get("scratchRemoved") is True,
            "mathSha256": coding.get("mathSha256"),
            "providerAnomalies": coding.get("providerAnomalies", []),
            "providerRequests": coding.get("providerRequests"),
            "workerToolResults": raw.get("workerToolResults", {}),
            "undoToolResults": raw.get("undoToolResults", {}),
        },
        "vg": {
            "capabilities": vg.get("capabilities", {}),
            "workspaceImport": vg.get("import", {}),
            "change": vg.get("change", {}),
            "snapshot": vg.get("snapshot", {}),
            "sts11": {
                "ok": sts11.get("ok"), "protocol": sts11.get("protocol"),
                "invalidRejected": parse11.get("invalid_rejected"), "invalidTotal": parse11.get("invalid_total"),
                "validPassed": parse11.get("valid_passed"), "validTotal": parse11.get("valid_total"),
            },
            "sts20": {
                "ok": sts20.get("ok"), "protocol": sts20.get("protocol"),
                "invalidRejected": parse20.get("invalid_rejected"), "invalidTotal": parse20.get("invalid_total"),
                "validPassed": parse20.get("valid_passed"), "validTotal": parse20.get("valid_total"),
            },
            "bundledPythonPresent": raw.get("defaults", {}).get("bundledPythonPresent"),
            "standaloneJjPresent": raw.get("defaults", {}).get("standaloneJjPresent"),
        },
        "commands": commands,
        "rawArtifact": artifact_path,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package-root", type=Path, required=True)
    parser.add_argument("--raw-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--build-package", action="store_true")
    args = parser.parse_args()
    package_input = args.package_root.resolve() if args.package_root.is_absolute() else (ROOT / args.package_root).resolve()
    raw_root = args.raw_root.resolve()
    out = args.output.resolve()
    for name, path in (("package-root", package_input), ("raw-root", raw_root), ("output", out)):
        if not path.is_absolute():
            parser.error(f"--{name} must be absolute")
    if raw_root.exists():
        parser.error("--raw-root must be a new directory")
    if out.exists():
        parser.error("--output must be a new directory")
    raw_root.mkdir(parents=True)
    out.mkdir(parents=True)
    commands: list[dict[str, Any]] = []
    try:
        candidate = source_document(ROOT)
        if candidate["dirty"]:
            raise RuntimeError("commit the TF-0781 evaluator before formal evidence collection")
        if args.build_package:
            run(out, commands, "package-build", ["cmd.exe", "/d", "/s", "/c", "corepack pnpm run package"], cwd=ROOT, timeout=3600, env_extra={"TEMP": "D:/tmp", "TMP": "D:/tmp"})
            electron_dist = next(ROOT.glob("node_modules/.pnpm/electron@*/node_modules/electron/dist"), None)
            if electron_dist is None or not electron_dist.is_dir():
                raise FileNotFoundError("installed Electron distribution is unavailable")
            package_input.mkdir(parents=True, exist_ok=True)
            run(out, commands, "package-directory", [
                "cmd.exe", "/d", "/s", "/c",
                f"node scripts/run-electron-builder.mjs --win --x64 --dir --publish never --config.electronDist={electron_dist.as_posix()} --config.win.signAndEditExecutable=false",
            ], cwd=ROOT, timeout=1800, env_extra={"TEMP": "D:/tmp", "TMP": "D:/tmp"})
        if not package_input.is_dir():
            raise FileNotFoundError(f"package root is not a directory: {package_input}")
        detached_package = raw_root / "detached-package"
        shutil.copytree(package_input, detached_package)
        package = package_document(detached_package, out)
        executable = detached_package / "Verse Claw.exe"
        if package["executable"]["path"] != str(executable):
            raise RuntimeError("package executable path mismatch")
        node = shutil.which("node")
        if not node:
            raise RuntimeError("node is unavailable")

        run(out, commands, "package-evidence-tests", [sys.executable, "-X", "utf8", "-B", ROOT / "scripts/coding-evaluation/test_package_evaluation.py"], cwd=ROOT, timeout=300)
        run(out, commands, "vite-package-alias-tests", ["cmd.exe", "/d", "/s", "/c", "corepack pnpm exec vitest run tests/unit/vite-config-openclaw-runtime.test.ts --maxWorkers=1"], cwd=ROOT, timeout=600)
        run(out, commands, "verseshell-package-verify", [node, ROOT / "scripts/verseshell-bundle.mjs", "verify-package", "--platform", "win32", "--arch", "x64"], cwd=ROOT, timeout=600)
        run(out, commands, "versegit-package-verify", [node, ROOT / "scripts/versegit-sidecar-package.mjs", "--verify"], cwd=ROOT, timeout=600)
        run(out, commands, "package-cli-probe", [node, ROOT / "scripts/check-packaged-windows-cli.mjs", detached_package, out / "package-cli"], cwd=ROOT, timeout=1200)
        run(out, commands, "playwright-package-profiles", ["cmd.exe", "/d", "/s", "/c", f"corepack pnpm exec playwright test tests/e2e/coding-package-three-profiles.spec.ts --workers=1"], cwd=ROOT, timeout=5400,
            env_extra={"CLAWX_PACKAGED_EXE": executable, "CLAWX_PACKAGE_RAW_ROOT": raw_root, "CLAWX_STS_CONTRACTS": ROOT / "harness/specs/fixtures/coding-evaluation/TF-0781/inputs/vg-sts", "TEMP": "D:/tmp", "TMP": "D:/tmp"})
        run(out, commands, "harness-validate", [node, ROOT / "harness/src/cli.mjs", "validate", "--spec", ROOT / "harness/specs/tasks/coding-windows-package-evaluation.md"], cwd=ROOT, timeout=600)
        run(out, commands, "comms-replay", ["cmd.exe", "/d", "/s", "/c", "corepack pnpm run comms:replay"], cwd=ROOT, timeout=900)
        run(out, commands, "comms-compare", ["cmd.exe", "/d", "/s", "/c", "corepack pnpm run comms:compare"], cwd=ROOT, timeout=900)
        run(out, commands, "repository-artifacts", [node, ROOT / "scripts/check-repository-artifacts.mjs"], cwd=ROOT, timeout=900)

        raw_profiles = []
        for profile_id in EXPECTED_PROFILES:
            source = raw_root / f"{profile_id}.json"
            if not source.is_file():
                raise RuntimeError(f"missing profile evidence: {source}")
            relative = f"raw-profiles/{profile_id}.json"
            target = out / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            raw = json.loads(target.read_text(encoding="utf-8"))
            raw["package"]["detachedFromSource"] = True
            normalized = normalize_profile(raw, relative)
            normalized["packageExecutableSha256"] = package["executable"]["sha256"]
            raw_profiles.append(normalized)
        package["executable"]["version"] = raw_profiles[0].get("app", {}).get("version")
        source_path = out / "evidence" / "source.json"
        source_path.parent.mkdir(parents=True, exist_ok=True)
        source_path.write_text(json.dumps(candidate, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        package_path = out / "evidence" / "package.json"
        package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

        final_source = source_document(ROOT)
        survivors_found = survivors(raw_root, out, detached_package)
        artifacts = artifact_map(out)
        checks = {
            "threeIndependentProfiles": len({row["profileId"] for row in raw_profiles}) == 3,
            "packagedApplication": all(row["app"].get("isPackaged") is True for row in raw_profiles),
            "sourceDetached": all(row["sourceDetached"] for row in raw_profiles),
            "codingWorktree": all(row["coding"].get("worktreeBackend") == "git-worktree" and row["coding"].get("verifiedCheckout") is True for row in raw_profiles),
            "verificationObserved": all(row["coding"].get("verificationObserved") is True and row["coding"].get("terminalStatus") == "ok" for row in raw_profiles),
            "undoRestored": all(row["coding"].get("scratchRemoved") is True for row in raw_profiles),
            "vgJjPassed": all(row["vg"].get("workspaceImport", {}).get("colocated") is True and row["vg"].get("snapshot", {}).get("operation_id") for row in raw_profiles),
            "stsContractsPassed": all(row["vg"].get("sts11", {}).get("ok") is True and row["vg"].get("sts20", {}).get("ok") is True for row in raw_profiles),
            "defaultsOff": all(row["vg"].get("capabilities", {}).get("safety", {}).get("default_enable") is False and row["vg"].get("capabilities", {}).get("safety", {}).get("managed_opt_in") is True for row in raw_profiles),
            "installerNotRun": package.get("installer", {}).get("status") == "not-run",
            "targetedCommandsPassed": all(row["exitCode"] == 0 for row in commands),
            "processSurvivors": len(survivors_found),
            "cleanCandidate": final_source == candidate and final_source.get("dirty") is False,
        }
        report = {
            "schema": "CodingWindowsPackageEvaluation/v1", "taskId": "TF-0781",
            "driven_by": "agent", "actor": ACTOR, "realHumanEvidence": False,
            "acceptanceEligible": True, "recordedAt": datetime.now(timezone.utc).isoformat(),
            "candidate": candidate, "package": package, "profiles": raw_profiles,
            "checks": checks,
            "commands": commands,
            "costs": {"wallSecondsTotal": sum(float(row["wallSeconds"]) for row in commands)},
            "cleanup": {"ownedProcesses": len(survivors_found), "survivors": survivors_found},
            "claims": {"realHuman": False, "ga": False, "releaseAuthorized": False, "defaultChanged": False, "productLockChanged": False},
            "artifacts": artifacts,
        }
        report_path = out / "report.json"
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        spec = importlib.util.spec_from_file_location("verify_package_evaluation", ROOT / "scripts/coding-evaluation/verify-package-evaluation.py")
        verifier = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(verifier)
        digest = verifier.report_digest(report)
        (out / "report.sha256").write_text(digest + "\n", encoding="ascii")
        verification = verifier.verify(report, out, candidate["commit"], digest, False)
        (out / "verification.json").write_text(json.dumps(verification, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"output": str(out), "reportDigest": digest, "verification": verification}, ensure_ascii=False, indent=2))
        return 0 if verification["ok"] else 1
    except BaseException as error:
        (out / "failure.json").write_text(json.dumps({
            "driven_by": "agent", "actor": ACTOR, "realHumanEvidence": False,
            "error": repr(error), "traceback": __import__("traceback").format_exc(), "commands": commands,
        }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        raise


if __name__ == "__main__":
    raise SystemExit(main())
