"""Package source stdlib once, without zlib or child-startup filesystem hooks."""
import argparse
from pathlib import Path
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument("source", type=Path)
parser.add_argument("build", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()

# Retain Python sources for tracebacks/inspect and pure-Python fallbacks.
# Include normal packages without claiming support for their unavailable
# native dependencies. Tests, GUI examples and bundled pip wheels are omitted.
omit = {"test", "tests", "__pycache__", "ensurepip", "idlelib", "tkinter", "turtledemo"}
entries = {}
entries["LICENSE.txt"] = (args.source / "LICENSE").read_bytes()
entries["licenses/expat.txt"] = (args.source / "Modules/expat/COPYING").read_bytes()
hacl = (args.source / "Modules/_hacl/Hacl_Hash_SHA2.c").read_text()
entries["licenses/HACL.txt"] = (hacl.split("*/", 1)[0] + "*/\n").encode()
for path in sorted((args.source / "Lib").rglob("*.py")):
    relative = path.relative_to(args.source / "Lib")
    if not omit.intersection(relative.parts):
        entries[relative.as_posix()] = path.read_bytes()
for path in sorted(args.build.glob("build/lib.*/_sysconfigdata_*.py")):
    entries[path.name] = path.read_bytes()
if not any(name.startswith("_sysconfigdata_") for name in entries):
    raise SystemExit("missing target _sysconfigdata (build pybuilddir.txt first)")

temporary = args.output.with_suffix(".zip.part")
with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_STORED) as archive:
    for name, data in sorted(entries.items()):
        info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
        info.external_attr = 0o100644 << 16
        archive.writestr(info, data)
temporary.replace(args.output)
print(f"stdlib: {len(entries)} files, {args.output.stat().st_size} bytes")
