"""Compile one frozen C++ program and execute its tests in a single WSL process."""
import argparse
import json
import resource
import signal
import subprocess
import sys
import tempfile
from pathlib import Path

OUTPUT_LIMIT = 1024 * 1024


def limit_output():
    resource.setrlimit(resource.RLIMIT_FSIZE, (OUTPUT_LIMIT, OUTPUT_LIMIT))


def run_test(program, test, timeout):
    with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
        error, timed_out, exit_code = None, False, None
        try:
            result = subprocess.run([str(program)], input=test["input"].encode("utf-8"),
                                    stdout=stdout, stderr=stderr, timeout=timeout,
                                    preexec_fn=limit_output)
            exit_code = result.returncode if result.returncode >= 0 else 128 - result.returncode
            if result.returncode == -signal.SIGXFSZ:
                error = "stdio output exceeds 1048576 bytes"
        except subprocess.TimeoutExpired:
            error, timed_out = "stdio test timed out", True
        stdout.seek(0)
        stderr.seek(0)
        return {"exitCode": exit_code, "error": error, "timedOut": timed_out,
                "stdout": stdout.read(OUTPUT_LIMIT).decode("utf-8", "replace"),
                "stderr": stderr.read(OUTPUT_LIMIT).decode("utf-8", "replace")}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--shim", required=True)
    parser.add_argument("--compiler", choices=["clang++", "g++"], required=True)
    parser.add_argument("--compiler-version")
    parser.add_argument("--timeout-ms", type=int, required=True)
    args = parser.parse_args()
    tests = json.load(sys.stdin)
    timeout = args.timeout_ms / 1000
    report = {"compileError": None, "compiler": None, "stage": "toolchain", "results": []}
    try:
        version = subprocess.run([args.compiler, "--version"], capture_output=True,
                                 timeout=max(30, timeout), check=True)
        report["compiler"] = version.stdout.decode("utf-8", "replace").splitlines()[0]
        if args.compiler_version and report["compiler"] != args.compiler_version:
            raise OSError("stdio compiler version drift")
        report["stage"] = "compile"
        with tempfile.TemporaryDirectory(prefix="rsi-stdio-") as directory:
            source, program = Path(directory) / "case.cpp", Path(directory) / "program"
            source.write_text(Path(args.source).read_text(encoding="utf-8").replace("%I64d", "%lld"), encoding="utf-8")
            command = [args.compiler, "-std=c++17", "-O2", "-I", args.shim, str(source), "-o", str(program)]
            if args.compiler == "clang++":
                command.insert(1, "-stdlib=libc++")
            compiled = subprocess.run(command, capture_output=True, timeout=max(30, timeout))
            if compiled.returncode:
                report["compileError"] = compiled.stderr.decode("utf-8", "replace")[:2000] or f"compiler exited {compiled.returncode}"
            else:
                report["stage"] = "tests"
                report["results"] = [run_test(program, test, timeout) for test in tests]
    except (OSError, subprocess.SubprocessError) as error:
        report["compileError"] = str(error)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
