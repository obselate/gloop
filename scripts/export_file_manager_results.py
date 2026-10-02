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
PRIVATE_TMP = re.compile(r"/tmp/[A-Za-z0-9._-]+")
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
                       "private_socket_redacted": 0, "private_temp_redacted": 0,
                       "hostnames_redacted": 0}

    def string(self, value):
        for old, new in self.prefixes:
            value = value.replace(old, new)
        value, count = DBUS_SOCKET.subn("${PRIVATE_DBUS_SOCKET}", value)
        self.counts["private_socket_redacted"] += count
        value, count = PRIVATE_TMP.subn("${PRIVATE_TMP}", value)
        self.counts["private_temp_redacted"] += count
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


def rebase_evidence(source):
    plan_path = source / "plan.json"
    if not plan_path.is_file():
        return {}
    if "provenance_rebase" not in json.loads(plan_path.read_text()):
        if source.name == "cohort-final-v7":
            raise ValueError("v7 plan lacks the required Node rebase record")
        return {}
    if source.name != "cohort-final-v7":
        raise ValueError("rebased v7 cohort must retain its canonical directory name")
    base = source.parent
    archive = base / "v7-node-rebase-archive"
    ledger_path = base / "v7-node-rebase-ledger.json"
    gate_path = base / "final-v7-measured-node2-gate.json"
    ledger = json.loads(ledger_path.read_text())
    index = json.loads((archive / "archive-index.json").read_text())
    original = ledger["original_sha256"]
    if Path(ledger["original_archive"]).resolve(strict=True) != archive.resolve(strict=True) or \
            index["original_sha256"] != original or \
            index["profiles_tree_sha256"] != ledger["profiles_tree_sha256_before_after"]:
        raise ValueError("Node rebase archive differs from ledger")
    for name, expected in original.items():
        path = archive / name
        if not paths_under(path.resolve(strict=True), archive.resolve()) or \
                not path.is_file() or path.is_symlink() or sha256(path) != expected:
            raise ValueError(f"Node rebase original changed: {name}")

    old_raw = original["raw.jsonl"]
    old_history = original["environment-warmup-invocations.jsonl"]
    old_host = original["inputs/host-packages.txt"]
    old_manifest = original["inputs/cohort-manifest.json"]
    new_host = ledger["current_host_inventory_sha256"]
    new_manifest = ledger["new_manifest_sha256"]
    if len((archive / "raw.jsonl").read_text().splitlines()) != 59 or \
            prefix_sha256(source / "raw.jsonl", 59) != old_raw or \
            sha256(source / "environment-warmup-invocations.jsonl") != old_history or \
            ledger["raw_sha256_after"] != old_raw or ledger["warmup_history_sha256_after"] != old_history or \
            ledger["warmups_used_for_numeric_metrics"] is not False or \
            ledger["no_later_rebase_after_any_measured_row"] is not True or \
            ledger["new_controller_started"] is not False or \
            ledger["new_measured_service_started"] is not False:
        raise ValueError("Node rebase changed or misclassified the 59 pre-update warmups")
    old_packages = set((archive / "inputs/host-packages.txt").read_text().splitlines())
    new_packages = set((source / "inputs/host-packages.txt").read_text().splitlines())
    if old_packages - new_packages != {"nodejs 26.10.0-1"} or \
            new_packages - old_packages != {"nodejs 26.10.0-2"} or \
            sha256(source / "inputs/host-packages.txt") != new_host or \
            sha256(base / "cohort-manifest-v7-node2.host-packages.txt") != new_host:
        raise ValueError("Node rebase host inventory differs from the NodeJS-only update")
    manifest_path = base / "cohort-manifest-v7-node2.json"
    old_manifest_data = json.loads((archive / "inputs/cohort-manifest.json").read_text())
    old_manifest_data["host_package_inventory_sha256"] = new_host
    old_manifest_data["host_package_inventory_file"] = str(
        (base / "cohort-manifest-v7-node2.host-packages.txt").resolve())
    if sha256(manifest_path) != new_manifest or \
            sha256(source / "inputs/cohort-manifest.json") != new_manifest or \
            json.loads(manifest_path.read_text()) != old_manifest_data:
        raise ValueError("Node rebase manifest differs beyond host provenance")
    plan = json.loads(plan_path.read_text())
    old_plan = json.loads((archive / "plan.json").read_text())
    rebase = plan.pop("provenance_rebase", None)
    old_plan["pins"]["manifest_sha256"] = new_manifest
    old_plan["pins"]["host_package_inventory_sha256"] = new_host
    if sha256(plan_path) != ledger["new_plan_sha256"] or plan != old_plan or \
            len(plan["slots"]) != 177 or not isinstance(rebase, dict) or \
            rebase.get("warmup_raw_sha256") != old_raw or \
            rebase.get("warmup_history_sha256") != old_history or \
            rebase.get("warmup_manifest_sha256") != old_manifest or \
            rebase.get("warmup_host_package_inventory_sha256") != old_host or \
            rebase.get("original_plan_sha256") != original["plan.json"] or \
            rebase.get("warmups_used_for_numeric_metrics") is not False or \
            rebase.get("no_later_rebase_after_any_measured_row") is not True:
        raise ValueError("Node rebase altered the fixed plan or warmup role")

    preflight_path = source / "environment.json"
    preflight = json.loads(preflight_path.read_text())
    execution_path = archive / "current-preflight-execution.json"
    execution = json.loads(execution_path.read_text())
    stdout = archive / "current-preflight.stdout.log"
    stderr = archive / "current-preflight.stderr.log"
    if sha256(preflight_path) != ledger["current_preflight_environment_sha256"] or \
            preflight.get("mode") != "preflight" or \
            preflight.get("manifest_sha256") != new_manifest or \
            preflight.get("host_package_inventory_sha256") != new_host or \
            sha256(execution_path) != ledger["current_preflight_execution_sha256"] or \
            sha256(stdout) != ledger["current_preflight_stdout_sha256"] or \
            sha256(stderr) != ledger["current_preflight_stderr_sha256"] or \
            execution.get("exit_code") != 0:
        raise ValueError("Node rebase current preflight differs")
    failed_session = archive / "failed-run-0-session"
    failed_status = (archive / "failed-service-systemctl.txt").read_text()
    node_audit = json.loads((archive / "v7-nodejs-provenance-audit.json").read_text())
    if failed_status != index["failed_service_systemctl"] or \
            "ExecMainStatus=2" not in failed_status or "MainPID=0" not in failed_status or \
            sha256(failed_session / "invocation.log") != node_audit["run0_invocation_log_sha256"] or \
            sha256(failed_session / "session.json") != node_audit["run0_session_json_sha256"] or \
            node_audit["run_history_exists"] is not False or node_audit["raw_count"] != 59 or \
            node_audit["saved_host_inventory_sha256"] != old_host or \
            node_audit["current_host_inventory_sha256"] != new_host or \
            node_audit["direct_node_or_v8_needed_hits"] or \
            node_audit["declared_app_binary_mismatches"] or \
            node_audit["warmup_gui_sha_mismatches"] or \
            node_audit["raw_nodejs_reference_hits"] or \
            node_audit["nodejs_payload_paths_differ"]:
        raise ValueError("Node rebase prelaunch failure evidence differs")
    gate = json.loads(gate_path.read_text())
    control_files = (("v7-measured-commands-node2.json", "new_commands_sha256", "commands_sha256"),
                     ("run-v7-measured-controller-node2.py", "new_controller_sha256", "controller_sha256"),
                     ("v7-controller-service-command-node2.json", "new_service_command_sha256",
                      "controller_service_command_sha256"))
    if gate.get("provenance_rebase_ledger_sha256") != sha256(ledger_path) or \
            gate.get("plan_sha256") != ledger["new_plan_sha256"] or \
            gate.get("host_package_inventory_sha256") != new_host or \
            gate.get("warmups") != 59 or gate.get("slots") != 177 or \
            gate.get("warmups_used_for_numeric_metrics") is not False or \
            any(sha256(base / name) != ledger[key] or gate.get(gate_key) != ledger[key]
                for name, key, gate_key in control_files):
        raise ValueError("Node rebase measured authorization differs")

    rows = [json.loads(line) for line in (source / "raw.jsonl").read_text().splitlines() if line.strip()]
    run_path = source / "environment-run-invocations.jsonl"
    runs = [json.loads(line) for line in run_path.read_text().splitlines() if line.strip()] \
        if run_path.exists() else []
    for item in runs:
        if item.get("mode") != "run" or item.get("plan_sha256") != ledger["new_plan_sha256"] or \
                item.get("manifest_sha256") != new_manifest or \
                item.get("host_package_inventory_sha256") != new_host or \
                item.get("host_package_inventory_sha256_at_end") != new_host or \
                item.get("provenance_drift") is not False or item.get("end_snapshot_errors") != []:
            raise ValueError("Node rebase measured invocation lacks the new host pin or clean end")
    for row in rows[59:]:
        if row.get("warmup") is not False or row.get("manifest_sha256") != new_manifest or \
                sum(item["invocation_ordinal_start"] <= row["ordinal"] <=
                    item["invocation_ordinal_end"] for item in runs) != 1:
            raise ValueError("Node rebase measured row lacks a unique new-host invocation")
    summary = json.loads((source / "summary.json").read_text())
    if any(ordinal < 59 for item in summary for key in ("raw_ordinals", "accepted_ordinals")
           for ordinal in item.get(key, [])):
        raise ValueError("Node rebase summary uses a pre-update warmup for numeric comparison")
    final_run = source / "environment-run.json"
    if final_run.is_file() and (not runs or json.loads(final_run.read_text()) != runs[-1]):
        raise ValueError("Node rebase final run does not match closed history")

    return {
        "ledger.json": ledger_path,
        "measured-gate.json": gate_path,
        "archive-index.json": archive / "archive-index.json",
        "original/environment.json": archive / "environment.json",
        "original/inputs/cohort-manifest.json": archive / "inputs/cohort-manifest.json",
        "original/inputs/host-packages.txt": archive / "inputs/host-packages.txt",
        "original/plan.json": archive / "plan.json",
        "original/final-v7-warmup-gate.json": archive / "final-v7-warmup-gate.json",
        "original/final-v7-measured-gate.json": archive / "final-v7-measured-gate.json",
        "original/v7-final-live-input-audit.json": archive / "v7-final-live-input-audit.json",
        "original/v7-nodejs-provenance-audit.json": archive / "v7-nodejs-provenance-audit.json",
        "failed-service-systemctl.txt": archive / "failed-service-systemctl.txt",
        "failed-run-0-invocation.log": failed_session / "invocation.log",
        "failed-run-0-session.json": failed_session / "session.json",
        "current-preflight-execution.json": execution_path,
        "current-preflight.stdout.log": stdout,
        "current-preflight.stderr.log": stderr,
    }


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
    rebase_files = rebase_evidence(source) if not allow_incomplete else {}

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
    for name, origin in rebase_files.items():
        target = output / "provenance-rebase" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        initial_hash = sha256(origin)
        if origin.suffix == ".json":
            write_json(target, sanitizer.walk(json.loads(origin.read_text())))
        else:
            target.write_text(sanitizer.string(origin.read_text()))
        if sha256(origin) != initial_hash:
            raise ValueError(f"Node rebase evidence changed during export: {name}")
        files[str(target.relative_to(output))] = {
            "source_sha256": initial_hash, "export_sha256": sha256(target),
            "source_bytes": origin.stat().st_size, "export_bytes": target.stat().st_size}
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
                                  "${PRIVATE_DBUS_SOCKET}": "private session bus socket",
                                  "${PRIVATE_TMP}": "private temporary path"},
                  "redactions": sanitizer.counts, "files": files}
    if rebase_files:
        ledger = json.loads(rebase_files["ledger.json"].read_text())
        provenance["provenance_rebase"] = {
            "ledger_source_sha256": files["provenance-rebase/ledger.json"]["source_sha256"],
            "original_archive_index_sha256":
                files["provenance-rebase/archive-index.json"]["source_sha256"],
            "pre_update_functional_warmups": 59,
            "warmups_used_for_numeric_metrics": False,
            "measured_host_inventory_sha256": ledger["current_host_inventory_sha256"]}
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
