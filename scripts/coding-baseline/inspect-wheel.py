"""Read-only binding of a built STS wheel to the frozen VG source and contracts."""
import hashlib
import json
import sys
import zipfile
from pathlib import Path

source = Path(sys.argv[1]).resolve() / "extensions" / "sts"
wheel = Path(sys.argv[2]).resolve()
expected = {
    file.relative_to(source / "src").as_posix(): file
    for file in (source / "src" / "smart_sorter").rglob("*.py")
}
for version in ("v1", "v2"):
    folder = source / "contracts" / "vg-sts" / version
    for file in folder.rglob("*"):
        if file.is_file():
            expected["smart_sorter/_contract/vg-sts/" + version + "/" + file.relative_to(folder).as_posix()] = file

issues = []
with zipfile.ZipFile(wheel) as archive:
    names = set(archive.namelist())
    for relative, file in expected.items():
        if relative not in names:
            issues.append("missing:" + relative)
        elif hashlib.sha256(archive.read(relative)).digest() != hashlib.sha256(file.read_bytes()).digest():
            issues.append("different:" + relative)
    issues.extend("unexpected-python:" + n for n in names if n.endswith(".py") and n not in expected)
assert expected, "empty wheel oracle"
print(json.dumps({"verified": not issues, "scope": "all smart_sorter Python modules and v1/v2 contract bytes", "filesChecked": len(expected), "issues": issues}))
sys.exit(1 if issues else 0)
