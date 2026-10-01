#!/usr/bin/env python3
"""Freeze portable package and reviewed adapter inputs into a relocatable cohort template."""

import argparse
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
LOCK = ROOT / "assets/performance/file-managers-2026-10-01/packages.lock.json"
DEFAULT_OUTPUT = ROOT / "assets/performance/file-managers-2026-10-01/cohort.template.json"
GLOOP_SHA256 = "28c9cc2f583c94db4e67c40224cf92a073e66cff8147ca8c204cddf3722ca6bd"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def normalize(value, replacements):
    if isinstance(value, str):
        for old, new in replacements:
            value = value.replace(old, new)
        return value
    if isinstance(value, list):
        return [normalize(item, replacements) for item in value]
    if isinstance(value, dict):
        return {key: normalize(item, replacements) for key, item in value.items()}
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--packages-manifest", type=Path, required=True)
    parser.add_argument("--adapters", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    packages = json.loads(args.packages_manifest.read_text())
    adapters = json.loads(args.adapters.read_text())["apps"]
    package_root = str(packages["package_root"])
    packages_dir = str(Path(package_root).parent)
    replacements = [
        (str(ROOT / "artifacts/performance/flea/v0.3.6" /
             "omarchy-b18ab4952b88b95efe7758ee5f9bd3bb47483875"),
         "{package_root}/opt/omarchy-b18ab4952b88b95efe7758ee5f9bd3bb47483875"),
        (str(ROOT / "artifacts/performance/flea/runtime-root"), "{flea_runtime}"),
        (package_root, "{package_root}"),
        (packages_dir, "{packages_dir}"),
        (str(ROOT), "{workspace}"),
    ]
    allowed = ("id", "name", "binary", "binary_sha256", "binary_bytes", "version",
               "distribution", "package", "source_tag", "source_commit",
               "source_commit_embedded", "source_tag_commit", "source_commit_note", "backend",
               "trace_single_client_verified", "expected_exe", "command", "env",
               "supported_scenarios", "scenarios", "unsupported", "publish_time_s",
               "publish_time_status")
    result = {"date": packages["date"], "platform": packages["platform"],
              "package_root": "{package_root}",
              "apps": [normalize({key: app[key] for key in allowed if key in app}, replacements)
                       for app in packages["apps"]]}
    for app in result["apps"]:
        adapter = adapters.get(app["id"])
        if adapter:
            app.update({key: normalize(adapter[key], replacements)
                        for key in ("supported_scenarios", "scenarios", "unsupported") if key in adapter})
        app["backend"] = app.get("backend", "wayland")
        late_seconds = 115 if app["id"] in ("xfe", "elementary-files", "konqueror") else 15
        app["late_validation_seconds"] = {"list100000": late_seconds,
                                          "tiles100000": late_seconds}
        if app["id"] == "flea":
            app["gui_executable"] = "{flea_runtime}/usr/bin/quickshell"
            app["gui_executable_sha256"] = digest(Path(packages_dir) /
                                                  "flea-runtime-root/usr/bin/quickshell")
    result["apps"].append({"id": "gloop", "name": "Gloop", "version": "0.7.2",
                           "binary": "{gloop_staged}", "binary_sha256": GLOOP_SHA256,
                           "binary_bytes": 17615832,
                           "publish_time_s": 30.249,
                           "publish_time_status": "prior same-day Ubuntu 24.04 NativeAOT Size observation; not measured in this runtime cohort",
                           "publish_environment": "SDK 10.0.401, 2 CPUs, 8 GiB RAM, Ubuntu 24.04",
                           "backend": "wayland", "trace_single_client_verified": True,
                           "supported_scenarios": ["list100", "list100000", "tiles100000", "preview3png"],
                           "scenarios": {},
                           "late_validation_seconds": {"list100000": 15, "tiles100000": 15}})
    result["cohort_schema_version"] = 1
    result["package_lock"] = "{workspace}/assets/performance/file-managers-2026-10-01/packages.lock.json"
    result["package_lock_sha256"] = digest(LOCK)
    result["package_input_manifest_sha256"] = digest(args.packages_manifest)
    result["adapter_input_sha256"] = digest(args.adapters)
    result["fixture_generator"] = "{workspace}/scripts/file_manager_fixtures.py"
    result["package_fetcher"] = "{workspace}/scripts/file_manager_packages.py"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(args.output.resolve())
    print("SHA-256", digest(args.output))


if __name__ == "__main__":
    main()
