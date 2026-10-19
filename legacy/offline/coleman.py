"""Explicit local historical bootstrap. Never a scheduler or package-script entry point."""
from pathlib import Path
import runpy
import sys

root = Path(__file__).resolve().parents[2]
sys.argv = [str(root / "tools/migration/import_awards.py"), "--offline-historical", *sys.argv[1:]]
runpy.run_path(sys.argv[0], run_name="__main__")
