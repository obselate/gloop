#!/usr/bin/env python3
"""Export one file-manager cohort with portable paths and an audit trail."""

import argparse
import csv
import hashlib
import json
import os
import re
import shutil
import sys
from pathlib import Path


REQUIRED = (
    "raw.jsonl",
    "summary.json",
    "review.json",
    "plan.json",
    "environment.json",
    "environment-warmup.json",
    "environment-run.json",
    "environment-warmup-invocations.jsonl",
    "environment-run-invocations.jsonl",
    "inputs/cohort-manifest.json",
    "inputs/host-baseline.json",
    "inputs/host-packages.txt",
)
OPTIONAL = ("inputs/scenario-adapters.json", "recovery-manifest.json")
APPROVED_RECOVERY_SHA256 = "2300f14da03bc090181cb5766e6a359f7d992237802ab04f5cee30e2d9270931"
SECRET = re.compile(r"(?i)\b(?:authorization|bearer|password|passwd|api[_-]?key|secret|access[_-]?token|cookie)\b\s*[:=]\s*\S+")
BEARER = re.compile(r"(?i)\bBearer\s+\S+")
SECRET_OPTION = re.compile(r"(?i)(--(?:api[-_]?key|password|passwd|secret|access[-_]?token|auth[-_]?token|cookie))(?:\s+|=)\S+")
DBUS_SOCKET = re.compile(r"/tmp/dbus-[A-Za-z0-9_-]+")
HOME_PATH = re.compile(r"/home/[^/\s\"']+")
CMD_KEYS = {"cmdline", "commandline", "command_line", "argv", "environ"}
SECRET_KEYS = {"authorization", "password", "passwd", "api_key", "apikey",
               "secret", "access_token", "auth_token", "cookie"}


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def paths_under(value, root):
    return value == root or root in value.parents


def prefix_sha256(path, lines):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for _ in range(lines):
            line = stream.readline()
            if not line:
                raise ValueError(f"recovery prefix is shorter than declared: {path}")
            digest.update(line)
    return digest.hexdigest()


class Recovery:
    def __init__(self, source):
        path = source / "recovery-manifest.json"
        if sha256(path) != APPROVED_RECOVERY_SHA256:
            raise ValueError("recovery manifest differs from independently reviewed evidence")
        manifest = json.loads(path.read_text())
        self.origin = Path(manifest["source"]).resolve(strict=True)
        if Path(manifest["target"]).resolve() != source or self.origin.parent != source.parent:
            raise ValueError("recovery origin/target are not the reviewed sibling cohorts")
        if manifest["closed_ordinal_range"] != [0, 32] or \
                [row["ordinal"] for row in manifest["excluded_ordinals"]] != list(range(33, 39)):
            raise ValueError("recovery ordinal boundary differs from reviewed evidence")
        self.source = source
        self.manifest = manifest
        self.captures = {}
        self.verify()
        for name, expected in manifest["copied_capture_sha256"].items():
            old = self.origin / "captures" / name
            current = source / "captures" / name
            if current.is_file() and not current.is_symlink() and sha256(current) == expected:
                self.captures[old] = (current, Path("captures") / name)
            else:
                self.captures[old] = (old, Path("captures/recovery-origin") / name)

    def verify(self):
        manifest = self.manifest
        source = self.source
        if sha256(source / "recovery-manifest.json") != APPROVED_RECOVERY_SHA256:
            raise ValueError("recovery manifest changed during export")
        originals = (("raw.jsonl", "source_raw_sha256"),
                     ("environment-warmup.json", "source_incomplete_environment_sha256"),
                     ("environment-warmup-invocations.jsonl", "source_history_sha256"))
        for name, key in originals:
            if sha256(self.origin / name) != manifest[key]:
                raise ValueError(f"recovery origin changed: {name}")
        copied = manifest["copied_file_sha256"]
        if prefix_sha256(source / "raw.jsonl", 33) != copied["raw.jsonl"] or \
                prefix_sha256(source / "environment-warmup-invocations.jsonl", 5) != \
                copied["environment-warmup-invocations.jsonl"]:
            raise ValueError("recovered closed prefix changed")
        for name in ("environment.json", "inputs/cohort-manifest.json",
                     "inputs/host-baseline.json", "inputs/host-packages.txt"):
            if sha256(source / name) != copied[name]:
                raise ValueError(f"recovered pinned input changed: {name}")
        for name, expected in manifest["copied_capture_sha256"].items():
            if Path(name).name != name or not name.endswith(".png"):
                raise ValueError(f"invalid recovery capture name: {name}")
            old = self.origin / "captures" / name
            if not old.is_file() or old.is_symlink() or sha256(old) != expected:
                raise ValueError(f"recovery origin capture changed: {name}")
        for old, (evidence, _) in self.captures.items():
            expected = manifest["copied_capture_sha256"][old.name]
            if evidence == old:
                continue
            if not evidence.is_file() or evidence.is_symlink() or sha256(evidence) != expected:
                raise ValueError(f"recovered current capture changed during export: {old.name}")

    def resolve_capture(self, path):
        if path not in self.captures:
            raise ValueError(f"capture is not listed by reviewed recovery manifest: {path.name}")
        return self.captures[path]


class Sanitizer:
    def __init__(self, source, recovery):
        repo = Path(__file__).resolve().parent.parent
        staging = repo / "artifacts/performance/file-managers-20261001"
        recovered = tuple((str(old), str(target))
                          for old, (_, target) in recovery.captures.items()) if recovery else ()
        origin_prefix = ((str(recovery.origin), "${RECOVERY_ORIGIN}"),) if recovery else ()
        self.prefixes = recovered + (
            (str(source / "captures") + "/", "captures/"),
            (str(source / "inputs") + "/", "inputs/"),
            (str(source), "${COHORT}"),
        ) + origin_prefix + (
            (str(staging), "${STAGING}"),
            (str(repo), "${REPO}"),
            (str(Path.home()), "${HOME}"),
        )
        self.hostname = os.uname().nodename
        self.counts = {"process_argv_removed": 0, "secret_fields_redacted": 0,
                       "account_fields_redacted": 0,
                       "private_socket_redacted": 0, "hostnames_redacted": 0}

    def string(self, value):
        for old, new in self.prefixes:
            value = value.replace(old, new)
        value, count = DBUS_SOCKET.subn("${PRIVATE_DBUS_SOCKET}", value)
        self.counts["private_socket_redacted"] += count
        value, count = HOME_PATH.subn("${HOME}", value)
        self.counts["hostnames_redacted"] += value.count(self.hostname)
        value = value.replace(self.hostname, "${HOSTNAME}")
        value, count = BEARER.subn("Bearer <redacted credential>", value)
        self.counts["secret_fields_redacted"] += count
        value, count = SECRET_OPTION.subn(r"\1 <redacted credential>", value)
        self.counts["secret_fields_redacted"] += count
        value, count = SECRET.subn("<redacted credential>", value)
        self.counts["secret_fields_redacted"] += count
        return value

    def walk(self, value):
        if isinstance(value, dict):
            result = {}
            for key, item in value.items():
                if key.lower() in CMD_KEYS:
                    result[key] = "<omitted: process arguments or environment>"
                    self.counts["process_argv_removed"] += 1
                elif key in ("USER", "LOGNAME") and isinstance(item, str):
                    result[key] = "<redacted account>"
                    self.counts["account_fields_redacted"] += 1
                elif key.lower().replace("-", "_") in SECRET_KEYS:
                    result[key] = "<redacted credential>"
                    self.counts["secret_fields_redacted"] += 1
                else:
                    result[key] = self.walk(item)
            return result
        if isinstance(value, list):
            return [self.walk(item) for item in value]
        if isinstance(value, str):
            return self.string(value)
        return value


def referenced_captures(value, source, recovery, found, required, label):
    if isinstance(value, dict):
        path = value.get("path")
        if isinstance(path, str) and path.endswith(".png"):
            candidate = Path(path).resolve()
            if paths_under(candidate, source / "captures"):
                evidence, exported = candidate, candidate.relative_to(source)
            elif recovery and paths_under(candidate, recovery.origin / "captures"):
                evidence, exported = recovery.resolve_capture(candidate)
            else:
                raise ValueError(f"capture reference escapes cohort: {path}")
            found.append({"path": evidence, "export_path": exported,
                          "expected_sha256": value.get("sha256"),
                          "required": required, "record": label})
        for child in value.values():
            referenced_captures(child, source, recovery, found, required, label)
    elif isinstance(value, list):
        for child in value:
            referenced_captures(child, source, recovery, found, required, label)


def latest_successful_warmups(path):
    latest = {}
    if not path.is_file():
        return latest
    with path.open() as stream:
        for line in stream:
            if not line.strip():
                continue
            record = json.loads(line)
            if record.get("warmup") is True and record.get("status") in ("ok", "late_window") and \
                    not record.get("discard_reason") and (record.get("capture") or record.get("late_capture")):
                latest[(record.get("app"), record.get("scenario"))] = record.get("ordinal")
    return latest


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def write_csv(path, rows):
    if not isinstance(rows, list):
        raise ValueError("summary.json must contain a list")
    columns = list(dict.fromkeys(key for row in rows for key in row))
    with path.open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: json.dumps(value, ensure_ascii=False, separators=(",", ":"))
                             if isinstance(value, (dict, list)) else value
                             for key, value in row.items()})


def provenance_problems(source):
    problems = []
    for name in ("environment-warmup.json", "environment-run.json",
                 "environment-warmup-invocations.jsonl", "environment-run-invocations.jsonl"):
        path = source / name
        if not path.is_file():
            continue
        records = (json.loads(line) for line in path.read_text().splitlines() if line.strip()) \
            if name.endswith(".jsonl") else [json.loads(path.read_text())]
        for index, record in enumerate(records):
            if "execution_status" not in record:
                problems.append(f"{name}:{index} lacks end snapshots")
            if record.get("provenance_drift") or record.get("end_snapshot_errors"):
                problems.append(f"{name}:{index} has provenance drift or end-snapshot errors")
    return problems


def export(source, output, allow_incomplete):
    source = source.resolve(strict=True)
    output = output.resolve()
    if paths_under(output, source) or paths_under(source, output):
        raise ValueError("source and output directories must be separate")
    if output.exists() and any(output.iterdir()):
        raise ValueError("output directory must be absent or empty")
    missing = [name for name in REQUIRED if not (source / name).is_file()]
    if missing and not allow_incomplete:
        raise ValueError("cohort is incomplete; missing: " + ", ".join(missing))
    run_path = source / "environment-run.json"
    run = json.loads(run_path.read_text()) if run_path.is_file() else {}
    problems = provenance_problems(source)
    if not allow_incomplete and run.get("execution_status") != "complete":
        raise ValueError("run execution status is not complete")
    if not allow_incomplete and problems:
        raise ValueError("cohort provenance invalid: " + "; ".join(problems))

    recovery = Recovery(source) if (source / "recovery-manifest.json").is_file() else None
    output.mkdir(parents=True, exist_ok=True)
    sanitizer = Sanitizer(source, recovery)
    files = {}
    capture_refs = []
    latest_warmups = latest_successful_warmups(source / "raw.jsonl")
    summary = None
    selected = [name for name in REQUIRED + OPTIONAL if (source / name).is_file()]
    for name in selected:
        origin = source / name
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        initial_hash = sha256(origin)
        if name.endswith(".jsonl"):
            with origin.open() as src, target.open("w") as dst:
                for line in src:
                    if not line.strip():
                        continue
                    original = json.loads(line)
                    latest_warmup = original.get("warmup") is True and \
                        original.get("ordinal") == latest_warmups.get((original.get("app"), original.get("scenario")))
                    required = name != "raw.jsonl" or original.get("accepted") is True or latest_warmup
                    label = f"{name}:ordinal={original.get('ordinal')}:status={original.get('status')}"
                    referenced_captures(original, source, recovery, capture_refs, required, label)
                    dst.write(json.dumps(sanitizer.walk(original), ensure_ascii=False) + "\n")
        elif name.endswith(".json"):
            original = json.loads(origin.read_text())
            referenced_captures(original, source, recovery, capture_refs, True, name)
            cleaned = sanitizer.walk(original)
            write_json(target, cleaned)
            if name == "summary.json":
                summary = cleaned
        else:
            target.write_text(sanitizer.string(origin.read_text()))
        if sha256(origin) != initial_hash:
            raise ValueError(f"source changed during export: {name}")
        files[name] = {"source_sha256": initial_hash, "export_sha256": sha256(target),
                       "source_bytes": origin.stat().st_size, "export_bytes": target.stat().st_size}

    capture_dir = source / "captures"
    if capture_dir.is_dir():
        for origin in sorted(capture_dir.rglob("*.png")):
            if not origin.is_file() or origin.is_symlink():
                raise ValueError(f"capture is not a regular file: {origin}")
            relative = origin.relative_to(source)
            target = output / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            initial_hash = sha256(origin)
            shutil.copyfile(origin, target)
            if sha256(origin) != initial_hash or sha256(target) != initial_hash:
                raise ValueError(f"capture changed during export: {relative}")
            files[str(relative)] = {"source_sha256": initial_hash,
                                    "export_sha256": sha256(target),
                                    "source_bytes": origin.stat().st_size,
                                    "export_bytes": target.stat().st_size}
    if recovery:
        for old, (evidence, relative) in recovery.captures.items():
            if evidence != old:
                continue
            target = output / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(old, target)
            expected = sha256(old)
            if sha256(target) != expected:
                raise ValueError(f"recovery capture changed during export: {old.name}")
            files[str(relative)] = {"source_sha256": expected, "export_sha256": expected,
                                    "source_bytes": old.stat().st_size,
                                    "export_bytes": target.stat().st_size,
                                    "source_reference": "${RECOVERY_ORIGIN}/captures/" + old.name}
    missing_captures = []
    stale_captures = []
    historical_captures = []
    for reference in capture_refs:
        path = reference["path"]
        actual = sha256(path) if path.is_file() else None
        expected = reference["expected_sha256"]
        if actual is not None and actual == expected:
            continue
        mismatch = {"path": str(reference["export_path"]), "record": reference["record"],
                    "expected_sha256": expected, "current_sha256": actual}
        if not reference["required"]:
            historical_captures.append(mismatch)
        elif actual is None:
            missing_captures.append(mismatch)
        else:
            stale_captures.append(mismatch)
    if (missing_captures or stale_captures) and not allow_incomplete:
        raise ValueError("referenced captures are missing or overwritten; see --allow-incomplete pilot")
    if summary is not None:
        write_csv(output / "summary.csv", summary)
        files["summary.csv"] = {"source_sha256": None,
                                "export_sha256": sha256(output / "summary.csv"),
                                "source_bytes": None,
                                "export_bytes": (output / "summary.csv").stat().st_size}
    if recovery:
        recovery.verify()
    provenance = {"schema_version": 1,
                  "complete": not missing and not missing_captures and not stale_captures and not problems and
                              run.get("execution_status") == "complete",
                  "run_execution_status": run.get("execution_status"),
                  "run_provenance_drift": run.get("provenance_drift"),
                  "provenance_problems": problems,
                  "missing_required_files": missing, "missing_referenced_captures": missing_captures,
                  "overwritten_capture_references": stale_captures,
                  "historical_capture_references": historical_captures,
                  "recovery_manifest_sha256": APPROVED_RECOVERY_SHA256 if recovery else None,
                  "path_tokens": {"${COHORT}": "original ignored cohort root",
                                  "${RECOVERY_ORIGIN}": "frozen original interrupted cohort",
                                  "${STAGING}": "ignored performance staging root",
                                  "${REPO}": "repository root", "${HOME}": "user home",
                                  "${HOSTNAME}": "source host name",
                                  "${PRIVATE_DBUS_SOCKET}": "private session bus socket"},
                  "redactions": sanitizer.counts, "files": files}
    write_json(output / "export-provenance.json", provenance)
    return provenance


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cohort-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--allow-incomplete", action="store_true",
                        help="permit a clearly labelled export pilot from unfinished warmups")
    args = parser.parse_args()
    try:
        result = export(args.cohort_dir, args.output_dir, args.allow_incomplete)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        parser.exit(1, f"export failed: {error}\n")
    print(f"exported {len(result['files'])} files; complete={result['complete']}; {args.output_dir}")


if __name__ == "__main__":
    sys.exit(main())
