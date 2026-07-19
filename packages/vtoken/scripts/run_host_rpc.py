#!/usr/bin/env python3
"""Dev launcher for the vtoken host_rpc stdio worker."""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
sys.path.insert(0, str(SRC))
os.environ.setdefault("PYTHONPATH", str(SRC))

from vtoken.host_rpc import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
