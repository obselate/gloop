#!/usr/bin/env python3
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
from urllib.request import urlopen


LOCK = Path(__file__).resolve().parent.parent / "assets/performance/file-managers-2026-10-01/packages.lock.json"


def digest(path):
    sha = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            sha.update(block)
    return sha.hexdigest()


def fetch(package, directory):
    path = directory / package["filename"]
    if not path.exists():
        temporary = path.with_name(path.name + ".part")
        with urlopen(package["url"], timeout=60) as source, temporary.open("wb") as target:
            shutil.copyfileobj(source, target)
        temporary.replace(path)
    if path.stat().st_size != package["bytes"] or digest(path) != package["sha256"]:
        raise ValueError(f"{path}: size or SHA-256 differs from packages.lock.json")
    return path


def extract(package, archive, root):
    destination = root / package["destination"]
    destination.mkdir(parents=True, exist_ok=True)
    if archive.name.endswith(".deb"):
        command = ["dpkg-deb", "-x", str(archive), str(destination)]
    else:
        command = ["bsdtar", "-xf", str(archive), "-C", str(destination)]
    subprocess.run(command, check=True)


def prepare_flea(root, revision):
    shortcut = root / "flea-runtime-root/usr/bin/qs"
    if shortcut.is_symlink() and shortcut.readlink() == Path("/usr/bin/quickshell"):
        shortcut.unlink()
        shortcut.symlink_to("quickshell")
    shell = root / "root/opt" / f"omarchy-{revision}" / "shell"
    ui = root / "root/opt/flea-0.3.7-linux-x86_64/ui"
    for name in ("Commons", "Ui"):
        target = ui / name
        if not target.exists():
            shutil.copytree(shell / name, target)
        link = ui / "boot" / name
        if not link.exists() and not link.is_symlink():
            link.symlink_to(Path("..") / name)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    root = args.output_dir.resolve()
    downloads = root / "downloads"
    downloads.mkdir(parents=True, exist_ok=True)
    lock = json.loads(LOCK.read_text())
    for package in lock["packages"]:
        archive = fetch(package, downloads)
        if not args.verify_only:
            extract(package, archive, root)
        print(f"{package['name']} {package['version']}: verified")
    if not args.verify_only:
        prepare_flea(root, next(p["version"] for p in lock["packages"] if p["name"] == "omarchy"))
    print(root)


if __name__ == "__main__":
    main()
