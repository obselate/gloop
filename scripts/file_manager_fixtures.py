#!/usr/bin/env python3
import argparse
import hashlib
from pathlib import Path


SOURCE = Path(__file__).resolve().parent.parent / "assets/performance/file-managers-2026-10-01/fixtures/3"
IMAGES = {
    "image-0.png": "ec3df6aba16e0f1a44af4b7acb0985295138e618418af883404f3b5d9d15f5b6",
    "image-1.png": "8e9af76331d553369bf00c823363e3dfa16f7ce9fd36291b4c411b75ad803f60",
    "image-2.png": "27e80984020ffc6303145f93d36c1e71956343eecce05b33d134ca7c235bd5d9",
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def text_folder(root, count):
    folder = root / str(count)
    existed = folder.exists()
    folder.mkdir(parents=True, exist_ok=True)
    if existed:
        files = list(folder.iterdir())
        if len(files) != count:
            raise ValueError(f"{folder}: expected {count} files, found {len(files)}")
        for index in range(count):
            path = folder / f"file-{index:06d}.txt"
            if not path.is_file() or path.stat().st_size:
                raise ValueError(f"{folder}: missing or nonempty {path.name}")
        return
    for index in range(count):
        (folder / f"file-{index:06d}.txt").touch()
    if sum(1 for _ in folder.iterdir()) != count:
        raise ValueError(f"{folder}: wrong fixture count")


def image_folder(root):
    folder = root / "3"
    folder.mkdir(parents=True, exist_ok=True)
    actual = {path.name for path in folder.iterdir()}
    if actual - IMAGES.keys():
        raise ValueError(f"{folder}: unexpected files {sorted(actual - IMAGES.keys())}")
    for name, expected in IMAGES.items():
        source = SOURCE / name
        if digest(source) != expected:
            raise ValueError(f"{source}: original hash mismatch")
        target = folder / name
        if target.exists():
            if not target.is_file() or digest(target) != expected:
                raise ValueError(f"{target}: fixture hash mismatch")
        else:
            target.write_bytes(source.read_bytes())
    if sum(1 for _ in folder.iterdir()) != len(IMAGES):
        raise ValueError(f"{folder}: wrong fixture count")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    root = args.output_dir.resolve()
    for count in (0, 100, 100000):
        text_folder(root, count)
    image_folder(root)
    print(root)


if __name__ == "__main__":
    main()
