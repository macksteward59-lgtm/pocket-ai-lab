"""Recover Pocket AI Lab's tracked source at a named branch snapshot (Python 3)."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile

ROOT = Path(__file__).resolve().parent

def safe_path(root, relative):
    path = (root / relative).resolve()
    if root not in path.parents:
        raise ValueError(f"Invalid archive path: {relative}")
    return path

def recover(index, branch, destination):
    revision = index["branches"].get(branch, branch)
    records = index["snapshots"].get(revision)
    if records is None:
        raise ValueError(f"Unknown branch or commit: {branch}")
    destination = destination.resolve()
    if destination.exists():
        raise ValueError(f"Choose a new output folder: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    external = []
    with tempfile.TemporaryDirectory(dir=destination.parent) as temporary:
        staged = Path(temporary) / "source"
        staged.mkdir()
        for item in records:
            name, mode, digest, archived = index["entries"][item]
            target = safe_path(staged, name)
            if mode == "160000":
                target.mkdir(parents=True, exist_ok=True)
                external.append((name, digest))
                continue
            if mode not in ("100644", "100755"):
                raise ValueError(f"Unsupported Git mode {mode} at {name}")
            data = safe_path(ROOT, archived).read_bytes()
            header = f"blob {len(data)}".encode("ascii") + bytes(1)
            if hashlib.sha1(header + data).hexdigest() != digest:
                raise ValueError(f"Source integrity check failed: {name}")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            target.chmod(int(mode[-3:], 8))
        if destination.exists():
            raise ValueError(f"Output folder already exists: {destination}")
        os.rename(staged, destination)
    print(f"Recovered {len(records) - len(external)} files from {revision} in {destination}")
    for name, digest in external:
        print(f"External submodule: {name} at {digest} (see .gitmodules)")

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list", action="store_true", help="list recorded branches")
    parser.add_argument("branch", nargs="?")
    parser.add_argument("destination", nargs="?", type=Path)
    args = parser.parse_args()
    index = json.loads((ROOT / "source-index.json").read_text(encoding="utf-8"))
    if args.list:
        for name, revision in sorted(index["branches"].items()):
            print(f"{name}  {revision}")
    elif args.branch and args.destination:
        try:
            recover(index, args.branch, args.destination)
        except (OSError, ValueError) as error:
            parser.exit(1, f"Source recovery failed: {error}\n")
    else:
        parser.error("use --list or specify a branch and a new destination folder")

if __name__ == "__main__":
    main()
