"""Legacy fallback for old setuptools (<61) that can't read PEP 621 pyproject
metadata. Modern environments use pyproject.toml directly."""
from setuptools import find_packages, setup

setup(
    name="verse-token",
    version="0.4.3",
    description="Verse Token - agent-runtime knowledge representation (HIR .vt / SIR graph / TIR injection)",
    package_dir={"": "src"},
    packages=find_packages("src"),
    entry_points={"console_scripts": ["vt=vtoken.cli:main"]},
    python_requires=">=3.10",
)
