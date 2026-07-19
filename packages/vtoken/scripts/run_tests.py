#!/usr/bin/env python3
"""Run vtoken unit tests with src/ on sys.path."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import pytest  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(pytest.main(["-q", *sys.argv[1:]]))
