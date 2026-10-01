#!/usr/bin/env python3
"""Resolve the pinned portable file-manager cohort for a local checkout."""

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess


ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "assets/performance/file-managers-2026-10-01/cohort.template.json"


def digest(path):
    sha = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            sha.update(block)
    return sha.hexdigest()


def resolve(value, paths):
    if isinstance(value, str):
        for token, replacement in paths.items():
            value = value.replace("{" + token + "}", str(replacement))
        return value
    if isinstance(value, list):
        return [resolve(item, paths) for item in value]
    if isinstance(value, dict):
        return {key: resolve(item, paths) for key, item in value.items()}
    return value


def host_packages():
    for manager, command in (("pacman", ["pacman", "-Q"]),
                             ("dpkg", ["dpkg-query", "-W", "-f=${Package} ${Version}\n"])):
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=30)
        except FileNotFoundError:
            continue
        if result.returncode == 0:
            return manager, result.stdout
    raise RuntimeError("pacman or dpkg package inventory is required")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--packages-dir", type=Path, required=True)
    parser.add_argument("--gloop-binary", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--template", type=Path, default=TEMPLATE)
    args = parser.parse_args()
    packages = args.packages_dir.resolve()
    source = args.gloop_binary.resolve()
    template = json.loads(args.template.read_text())
    gloop = next(app for app in template["apps"] if app["id"] == "gloop")
    expected = gloop["binary_sha256"]
    if digest(source) != expected:
        parser.error(f"Gloop source binary differs from pinned SHA-256 {expected}")
    staged = packages / "root/opt/gloop-0.7.2/gloop"
    staged.parent.mkdir(parents=True, exist_ok=True)
    if staged.exists():
        if digest(staged) != expected:
            parser.error(f"staged Gloop binary differs: {staged}")
    else:
        shutil.copyfile(source, staged, follow_symlinks=True)
        staged.chmod(source.stat().st_mode & 0o777)
    if staged.samefile(source):
        parser.error("staged Gloop must have a distinct inode for fair PSS measurement")
    paths = {"workspace": ROOT, "packages_dir": packages,
             "package_root": packages / "root", "flea_runtime": packages / "flea-runtime-root",
             "gloop_staged": staged}
    lock = Path(resolve(template["package_lock"], paths))
    if not lock.is_file() or digest(lock) != template["package_lock_sha256"]:
        parser.error(f"package lock missing or changed: {lock}")
    cohort = resolve(template, paths)
    cohort["gloop_origin_binary"] = str(source)
    cohort["gloop_origin_sha256"] = expected
    cohort["template_sha256"] = digest(args.template)
    manager, inventory = host_packages()
    cohort["host_package_manager"] = manager
    cohort["host_package_inventory_sha256"] = hashlib.sha256(inventory.encode()).hexdigest()
    cohort["host_package_inventory_file"] = str(args.output.with_suffix(".host-packages.txt").resolve())
    for app in cohort["apps"]:
        binary = Path(app["binary"])
        if not binary.is_file() or not binary.stat().st_mode & 0o111:
            parser.error(f"missing executable from package extraction: {binary}")
        if app.get("binary_sha256") and digest(binary) != app["binary_sha256"]:
            parser.error(f"binary hash differs for {app['id']}: {binary}")
        if app.get("binary_bytes") and binary.stat().st_size != app["binary_bytes"]:
            parser.error(f"binary size differs for {app['id']}: {binary}")
        if app.get("gui_executable"):
            gui = Path(app["gui_executable"])
            if not gui.is_file() or digest(gui) != app["gui_executable_sha256"]:
                parser.error(f"GUI executable missing or changed for {app['id']}: {gui}")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.with_suffix(".host-packages.txt").write_text(inventory)
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary.write_text(json.dumps(cohort, indent=2) + "\n")
    temporary.replace(args.output)
    print(args.output.resolve())
    print("SHA-256", digest(args.output))


if __name__ == "__main__":
    main()
