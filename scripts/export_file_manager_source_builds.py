#!/usr/bin/env python3

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import types


REPO = Path(__file__).resolve().parent.parent
CONTROL = REPO / "artifacts/performance/file-managers-20261001/source-build-control"
PRIVATE = re.compile(r"/home/|/tmp/|/run/user/|(?i:bearer |password|passwd|secret|api[_-]?key|access[_-]?token)")
PINS = ("manifest_sha256", "runner_sha256", "wrapper_sha256", "cohort_script_sha256",
        "prefix_sha256", "environment_sha256")
SOURCES = {"manifest_sha256": "source-builds.template.json", "runner_sha256": "runner.py",
           "wrapper_sha256": "run.py", "cohort_script_sha256": "file_manager_cohort.py"}
SUCCESS = {"ActiveState": "active", "SubState": "exited", "Result": "success",
           "ExecMainCode": "1", "ExecMainStatus": "0"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def read_json(data):
    return json.loads(data)


def bounded_path(value, parent):
    original = Path(value)
    require(original.is_absolute(), "source-build evidence paths must be absolute")
    path = original.resolve(strict=True)
    require(path == original and path.is_relative_to(parent.resolve()),
            f"path escapes source-build artifacts: {value}")
    return path


def public(value):
    content = json.dumps(value, ensure_ascii=False)
    require(not PRIVATE.search(content), "private path or credential in public source-build record")
    return value


def tokenize(value, paths):
    if isinstance(value, dict):
        return {key: tokenize(item, paths) for key, item in value.items()}
    if isinstance(value, list):
        return [tokenize(item, paths) for item in value]
    if isinstance(value, str):
        for old, token in paths:
            value = value.replace(old, token)
    return value


class Freeze:
    def __init__(self, root, expected):
        self.root = bounded_path(root, CONTROL)
        require(self.root.is_dir(), "source-build freeze is not a directory")
        index = (self.root / "freeze-index.json").read_bytes()
        require(sha256(index) == expected, "source-build freeze index changed")
        self.files = read_json(index)["files"]
        self.digest = expected
        self.modules = {}
        self.control_validated = False

    def data(self, name):
        relative = Path(name)
        require(name in self.files and not relative.is_absolute() and relative.parts
                and relative.as_posix() == name and all(part not in (".", "..") for part in relative.parts),
                f"missing frozen file: {name}")
        path = self.root / name
        require(path.is_file() and not path.is_symlink() and
                path.resolve().is_relative_to(self.root), f"invalid frozen file: {name}")
        data = path.read_bytes()
        record = self.files[name]
        require(len(data) == record["bytes"] and sha256(data) == record["sha256"],
                f"frozen file changed: {name}")
        return data

    def json(self, name):
        return read_json(self.data(name))

    def live(self, name, path):
        path = bounded_path(path, CONTROL)
        require(path.is_file() and sha256(path.read_bytes()) == self.files[name]["sha256"],
                f"live source-build proof differs from freeze: {name}")
        return self.json(name) if name.endswith(".json") else self.data(name)

    def runner(self):
        if "runner" not in self.modules:
            module = types.ModuleType("frozen_source_build_runner")
            module.__file__ = str(self.root / "runner.py")
            exec(compile(self.data("runner.py"), module.__file__, "exec"), module.__dict__)
            self.modules["runner"] = module
        return self.modules["runner"]

    def control(self, batch_path, batch):
        if self.control_validated:
            return
        states = self.json("unit-states.json")
        prefix = "batch/"
        request = self.live(prefix + "control-launch-request.json",
                            batch_path / "control-launch-request.json")
        launch = self.live(prefix + "control-launch.json", batch_path / "control-launch.json")
        claim = self.live(prefix + "control-run-claim.json", batch_path / "control-run-claim.json")
        completed = self.live(prefix + "control-completed.json", batch_path / "control-completed.json")
        success = self.live(prefix + "control-success.json", batch_path / "control-success.json")
        state = states.get(batch["control_unit"], success["unit_state"])
        require(service_closed(state), "source-build control did not close successfully")
        require(request == {"nonce": batch["nonce"], "unit": batch["control_unit"]}
                and launch["unit"] == batch["control_unit"] and launch["returncode"] == 0
                and claim["nonce"] == batch["nonce"] and claim["invocation_id"] == state["InvocationID"]
                and claim["argv"] == launch["service_argv"]
                and completed == {"nonce": batch["nonce"],
                                  "environment_sha256": batch["environment_sha256"]}
                and success["nonce"] == batch["nonce"] and success["unit"] == batch["control_unit"]
                and success["unit_state"] == state
                and success["completed_sha256"] == self.files[prefix + "control-completed.json"]["sha256"],
                "source-build control identity differs")
        for mode in ("prepare", "measure"):
            record = self.live(prefix + f"probe-{mode}.json", batch_path / f"probe-{mode}.json")
            inner = self.live(prefix + f"probe-{mode}-inner.json",
                              batch_path / f"probe-{mode}-inner.json")
            log = prefix + f"probe-{mode}-scope.log"
            self.live(log, batch_path / f"probe-{mode}-scope.log")
            require(record["verified"] is True and record["scope_returncode"] == 0
                    and record["scope_log_sha256"] == self.files[log]["sha256"]
                    and record["observed"] == inner and inner["verified"] is True
                    and inner["nonce"] == batch["nonce"] and inner["mode"] == mode
                    and inner["environment_sha256"] == batch["environment_sha256"]
                    and inner["limits"]["verified"] is True,
                    f"source-build {mode} control differs")
        self.control_validated = True


def file_if_frozen(freeze, name, live):
    if name not in freeze.files:
        require(not live.exists(), f"unfrozen source-build proof appeared: {name}")
        return None
    return freeze.live(name, live)


def service_closed(state):
    require(state.get("InvocationID") and state.get("ActiveState") != "activating"
            and state.get("SubState") not in ("running", "start"),
            "source-build service is not closed")
    succeeded = all(state.get(key) == value for key, value in SUCCESS.items())
    require(succeeded or state.get("Result") != "success" and
            state.get("ExecMainStatus") not in (None, "0"),
            "source-build service has an ambiguous end state")
    return succeeded


def reused_prefix(freeze, batch_path, batch, inventory, manifest, caches, app_id):
    require(app_id == "spacefm", "only the final SpaceFM retry may reuse a prefix manifest")
    receipt = freeze.live("batch/reused-prefix-receipt.json",
                          batch_path / "reused-prefix-receipt.json")
    previous = [item for item in caches.values()
                if item is not freeze and item.files["source-builds.template.json"]["sha256"] ==
                receipt["original_manifest_sha256"]]
    require(len(previous) == 1, "reused prefix source manifest is not uniquely frozen")
    original = previous[0]
    original_inventory = original.json("prefix-inventory.json")
    original_batch = original.json("batch/metadata.json")
    original_manifest = original.json("source-builds.template.json")
    require(receipt == {
        "schema_version": 1,
        "original_manifest_sha256": inventory["source_manifest_sha256"],
        "retry_manifest_sha256": batch["manifest_sha256"],
        "original_prefix_inventory_sha256": original.files["prefix-inventory.json"]["sha256"],
        "prefix_sha256": batch["prefix_sha256"],
        "package_plan_sha256": inventory["package_plan_sha256"],
        "app_id": "spacefm",
        "original_cflags": next(app for app in original_manifest["apps"]
                                if app["id"] == "spacefm")["environment"]["CFLAGS"],
        "retry_cflags": next(app for app in manifest["apps"]
                             if app["id"] == "spacefm")["environment"]["CFLAGS"],
        "original_batch": str(CONTROL / "batches" / original_batch["nonce"]),
        "retry_batch": str(batch_path),
    } and original_inventory == inventory
            and original.files["prefix-inventory.json"]["sha256"] ==
            freeze.files["prefix-inventory.json"]["sha256"]
            and all(original_batch[key] == batch[key] for key in PINS if key != "manifest_sha256"),
            "reused prefix receipt or pins differ")
    require(receipt["retry_cflags"] in (
        receipt["original_cflags"] + " -Wno-error=incompatible-pointer-types",
        receipt["original_cflags"] + " -Wno-error=incompatible-pointer-types -fcommon"),
        "SpaceFM retry flag differs")
    expected = read_json(json.dumps(original_manifest))
    next(app for app in expected["apps"] if app["id"] == "spacefm")["environment"]["CFLAGS"] = \
        receipt["retry_cflags"]
    require(manifest == expected, "reused prefix changed more than the SpaceFM CFLAGS override")
    original_bytes = original.data("source-builds.template.json")
    old = json.dumps(receipt["original_cflags"]).encode()
    new = json.dumps(receipt["retry_cflags"]).encode()
    require(original_bytes.count(old) == 1
            and original_bytes.replace(old, new, 1) == freeze.data("source-builds.template.json"),
            "reused prefix manifest changed outside the SpaceFM CFLAGS bytes")


def attempt(history, app_id, caches):
    attempt_path = bounded_path(history["attempt"], CONTROL / "attempts")
    batch_path = bounded_path(history["batch"], CONTROL / "batches")
    freeze_key = (history["freeze_root"], history["freeze_index_sha256"])
    if freeze_key not in caches:
        caches[freeze_key] = Freeze(*freeze_key)
    freeze = caches[freeze_key]
    batch = freeze.live("batch/metadata.json", batch_path / "metadata.json")
    meta = freeze.live(f"attempts/{app_id}/metadata.json", attempt_path / "metadata.json")
    require(batch["nonce"] == batch_path.name and meta["nonce"] == attempt_path.name
            and meta["app_id"] == app_id and Path(meta["root"]) == attempt_path / "builds"
            and Path(meta["batch"]) == batch_path, "source-build attempt identity differs")
    require(meta["batch_metadata_sha256"] == freeze.files["batch/metadata.json"]["sha256"],
            "attempt batch metadata pin differs")
    for name in PINS:
        require(meta[name] == batch[name], f"attempt {name} differs from batch")
    for name, source in SOURCES.items():
        require(freeze.files[source]["sha256"] == batch[name], f"frozen {source} differs")
    manifest = freeze.json("source-builds.template.json")
    app = next((item for item in manifest["apps"] if item["id"] == app_id), None)
    require(app is not None and len(manifest["apps"]) == 17, "frozen app manifest differs")
    inventory = freeze.json("prefix-inventory.json")
    require(inventory["prefix_sha256"] == batch["prefix_sha256"]
            and inventory["prefix_root"] == batch["prefix_root"],
            "frozen prefix inventory differs")
    if inventory["source_manifest_sha256"] != batch["manifest_sha256"]:
        reused_prefix(freeze, batch_path, batch, inventory, manifest, caches, app_id)
    runner = freeze.runner()
    freeze.control(batch_path, batch)
    batch_env = freeze.live("batch/environment.json", batch_path / "environment.json")
    app_env = freeze.live(f"attempts/{app_id}/environment.json",
                          attempt_path / "environment.json")
    require(batch_env == app_env and runner.hash_environment(batch_env) == batch["environment_sha256"]
            and meta["environment_file_sha256"] == freeze.files[f"attempts/{app_id}/environment.json"]["sha256"]
            and batch["environment_file_sha256"] == freeze.files["batch/environment.json"]["sha256"],
            "frozen source-build environment differs")
    for name in PINS:
        if name in history.get("pinned", {}):
            require(history["pinned"][name] == batch[name], f"selected {name} differs")
    states = freeze.json("unit-states.json")
    state = states.get(meta["unit"])
    require(state is not None and all(
        value == (meta["unit"] if key == "unit" else state.get(key))
        for key, value in history["service"].items()), "service closure snapshot differs")
    succeeded = service_closed(state)
    prefix = f"attempts/{app_id}/"
    launch = freeze.live(prefix + "launch.json", attempt_path / "launch.json")
    claim = freeze.live(prefix + "run-claim.json", attempt_path / "run-claim.json")
    request = freeze.live(prefix + "launch-request.json", attempt_path / "launch-request.json")
    require(launch["returncode"] == 0 and launch["unit"] == meta["unit"]
            and request == {"nonce": meta["nonce"], "unit": meta["unit"]}
            and claim["nonce"] == meta["nonce"]
            and claim["invocation_id"] == state["InvocationID"]
            and claim["argv"] == launch["service_argv"], "source-build service identity differs")
    records = {}
    log_hashes = {}
    for phase in ("fetch", "prepare", "measure"):
        name = prefix + f"records/{phase}.json"
        records[phase] = file_if_frozen(freeze, name, attempt_path / "builds/records" / app_id / f"{phase}.json")
        if phase + "_sha256" in history.get("phase_records", {}):
            require(freeze.files[name]["sha256"] == history["phase_records"][phase + "_sha256"],
                    f"selected {phase} record differs")
        outer = prefix + phase + ".log"
        if outer in freeze.files:
            freeze.live(outer, attempt_path / (phase + ".log"))
            log_hashes[phase + "_outer_sha256"] = freeze.files[outer]["sha256"]
        if phase in ("prepare", "measure") and records[phase] is not None:
            for suffix, key in ((".log", "log_sha256"), ("-scope.log", "scope_log_sha256")):
                log = prefix + "records/" + phase + suffix
                if key in records[phase]:
                    freeze.live(log, attempt_path / "builds/records" / app_id / (phase + suffix))
                    require(freeze.files[log]["sha256"] == records[phase][key],
                            f"{phase} log differs from record")
                    log_hashes[phase + ("_scope" if suffix.startswith("-") else "") + "_sha256"] = records[phase][key]
    result_name = prefix + "result.json"
    result = file_if_frozen(freeze, result_name, attempt_path / "result.json")
    result_sha = freeze.files[result_name]["sha256"] if result is not None else None
    require(result_sha == history.get("result_sha256"), "selected result hash differs")
    generated = next(item for item in runner.public_results(attempt_path / "builds", manifest,
                                                          batch["manifest_sha256"])["builds"]
                     if item["id"] == app_id)
    if result is not None:
        require(result == generated, "source-build result differs from frozen runner schema")
    completed = file_if_frozen(freeze, prefix + "completed.json", attempt_path / "completed.json")
    success = file_if_frozen(freeze, prefix + "success.json", attempt_path / "success.json")
    failure = file_if_frozen(freeze, prefix + "failure.json", attempt_path / "failure.json")
    if succeeded:
        require(result is not None and result["status"] == "ok" and completed is not None
                and success is not None and failure is None, "successful build proof is incomplete")
        require(completed == {"nonce": meta["nonce"], "app_id": app_id,
                              "result_sha256": result_sha}
                and success["nonce"] == meta["nonce"] and success["unit"] == meta["unit"]
                and success["unit_state"] == state
                and success["completed_sha256"] == freeze.files[prefix + "completed.json"]["sha256"],
                "successful build completion differs")
        fetch, prepare, measure = (records[name] for name in ("fetch", "prepare", "measure"))
        require(all(record is not None and record["status"] == "ok" for record in
                    (fetch, prepare, measure)), "successful build phases are incomplete")
        require(all(record["manifest_sha256"] == batch["manifest_sha256"] for record in
                    (fetch, prepare, measure))
                and all(fetch.get(key) == app.get(key) for key in
                        ("source_url", "source_ref", "source_commit"))
                and prepare["prefix_sha256"] == measure["prefix_sha256"] == batch["prefix_sha256"]
                and prepare["environment_sha256"] == measure["environment_sha256"]
                and prepare["dependency_cache_sha256"] == measure["dependency_cache_sha256"],
                "successful build phase pins differ")
        seconds = measure.get("source_build_seconds")
        require(type(seconds) in (int, float) and math.isfinite(seconds) and seconds > 0
                and result["source_build_seconds"] == seconds
                and measure["scope_returncode"] == prepare["scope_returncode"] == 0
                and measure["limits"]["verified"] is True
                and prepare["limits"]["verified"] is True,
                "successful build measurement differs")
        executable = runner.find_executable(runner.variables(attempt_path / "builds", app).values(),
                                            app["expected_executable"])
        require(executable is not None and runner.sha256(executable) == measure["built_executable_sha256"]
                and executable.stat().st_size == measure["built_executable_bytes"]
                and result["built_executable_sha256"] == measure["built_executable_sha256"],
                "successful build ELF differs")
        archive = attempt_path / "builds/archives" / app_id / app["archive"]
        require(runner.sha256(archive) == fetch["source_archive_sha256"],
                "successful build source archive differs")
    else:
        require(failure is not None and completed is None and success is None
                and (result is None or result["status"] != "ok"),
                "failed build proof is incomplete")
        if result is not None:
            require(failure.get("result_sha256") == result_sha, "failure result hash differs")
    row = dict(result or generated)
    row["manifest_sha256"] = batch["manifest_sha256"]
    if not succeeded:
        row["status"] = row["status"] if row["status"] not in ("ok", "not_run") else "orchestration_failed"
        row["source_build_seconds"] = None
        row["attempt_elapsed_seconds"] = None
        row["failure_reason"] = row.get("failure_reason") or "source-build service failed; private logs retained"
    row["attempt_id"] = meta["nonce"]
    row["batch_id"] = batch["nonce"]
    proof = {
        "app_id": app_id, "attempt_id": meta["nonce"], "batch_id": batch["nonce"],
        "freeze_index_sha256": freeze.digest, "selected": False,
        "manifest_sha256": batch["manifest_sha256"], "runner_sha256": batch["runner_sha256"],
        "wrapper_sha256": batch["wrapper_sha256"], "cohort_script_sha256": batch["cohort_script_sha256"],
        "prefix_sha256": batch["prefix_sha256"], "environment_sha256": batch["environment_sha256"],
        "result_sha256": result_sha, "phase_record_sha256": {
            phase: freeze.files[prefix + f"records/{phase}.json"]["sha256"]
            for phase in records if records[phase] is not None},
        "log_sha256": log_hashes, "phase_status": {
            phase: record["status"] for phase, record in records.items() if record is not None},
        "service": {"unit": meta["unit"], "InvocationID": state["InvocationID"],
            "ActiveState": state["ActiveState"], "SubState": state["SubState"],
            "Result": state["Result"], "ExecMainStatus": state["ExecMainStatus"]},
        "status": "ok" if succeeded else "failed",
    }
    paths = ((str(batch["prefix_root"]), "${PREFIX}"),
             (str(attempt_path), "${ATTEMPT}"), (str(batch_path), "${BATCH}"),
             (str(REPO), "${REPO}"))
    return public(tokenize(row, paths)), public(proof), app, public(tokenize(manifest["method"], paths)), succeeded


def verify_original_batch(freeze, path):
    batch = freeze.live("batch/metadata.json", path / "metadata.json")
    progress = freeze.live("batch/progress.json", path / "progress.json")
    results = freeze.live("batch/results.json", path / "results.json")
    published = freeze.live("batch/public-results.json", path / "public-results.json")
    require(progress == results and len(progress) == len(batch["app_ids"]) == 17
            and [row["app_id"] for row in progress] == batch["app_ids"]
            and [row["attempt"] for row in progress] == batch["attempts"]
            and all(row["status"] in ("ok", "failed") for row in progress)
            and published["schema_version"] == 1
            and published["manifest_sha256"] == batch["manifest_sha256"]
            and published["method"] == freeze.json("source-builds.template.json")["method"]
            and [row["id"] for row in published["builds"]] == batch["app_ids"]
            and all((outcome["status"] == "ok") == (row["status"] == "ok")
                    for outcome, row in zip(progress, published["builds"])),
            "original source-build batch closure differs")
    states = freeze.json("unit-states.json")
    state = states.get(batch["unit"])
    require(state is not None and not service_closed(state),
            "original batch service closure differs")
    request = freeze.live("batch/launch-request.json", path / "launch-request.json")
    launch = freeze.live("batch/launch.json", path / "launch.json")
    claim = freeze.live("batch/run-claim.json", path / "run-claim.json")
    require(request == {"nonce": batch["nonce"], "unit": batch["unit"]}
            and launch["returncode"] == 0 and launch["unit"] == batch["unit"]
            and claim["nonce"] == batch["nonce"]
            and claim["invocation_id"] == state["InvocationID"]
            and claim["argv"] == launch["service_argv"],
            "original batch unit identity differs")
    return {row["id"]: row for row in published["builds"]}


def verify_attempt_registry(selection, selected, original_batch_path):
    retry_batches = [bounded_path(path, CONTROL / "batches")
                     for path in selection["retry_batches"]]
    require(len(set(retry_batches)) == len(retry_batches)
            and original_batch_path not in retry_batches,
            "retry batch registry differs")
    batches = {original_batch_path, *retry_batches}
    listed = {(app_id, Path(item["attempt"])) for app_id, entry in selected.items()
              for item in entry["attempt_history"]}
    require({Path(item["batch"]) for entry in selected.values()
             for item in entry["attempt_history"]} == batches,
            "attempt history omits a declared retry batch")
    launched = set()
    for directory in (CONTROL / "attempts").iterdir():
        metadata = directory / "metadata.json"
        if not metadata.is_file():
            continue
        record = read_json(metadata.read_bytes())
        if Path(record["batch"]) in batches and (directory / "launch.json").is_file():
            launched.add((record["app_id"], directory))
    require(launched == listed, "selected attempt history omits or invents a launched attempt")


def build_conditions(freeze):
    batch = freeze.json("batch/metadata.json")
    inventory = freeze.json("prefix-inventory.json")
    plan = freeze.json("prefix-packages.json")
    environment = freeze.json("batch/environment.json")
    manifest = freeze.json("source-builds.template.json")
    packages = [{key: item[key] for key in ("name", "version", "sha256")}
                for item in plan["packages"]]
    require(inventory["package_plan_sha256"] == freeze.files["prefix-packages.json"]["sha256"]
            and packages == [{key: item[key] for key in ("name", "version", "sha256")}
                             for item in inventory["packages"]]
            and inventory["prefix_sha256"] == batch["prefix_sha256"],
            "frozen source-build package plan differs from prefix inventory")
    flags = {key: inventory["environment_additions"][key]
             for key in ("CFLAGS", "CXXFLAGS", "LDFLAGS")
             if key in inventory["environment_additions"]}
    overrides = {app["id"]: {key: app.get("environment", {})[key]
                              for key in ("CFLAGS", "CXXFLAGS", "LDFLAGS")
                              if key in app.get("environment", {})}
                 for app in manifest["apps"]}
    overrides = {app_id: value for app_id, value in overrides.items() if value}
    require(all(environment.get(key) == value for key, value in flags.items()),
            "source-build flags differ from actual batch environment")
    scripts = inventory.get("staged_overlay", {}).get("rebased_scripts", {})
    links = inventory.get("rebased_package_links", [])
    require(isinstance(scripts, dict) and len(scripts) <= 16
            and isinstance(links, list) and len(links) <= 32,
            "source-build relocation receipts exceed public bounds")
    replacement_count = 0
    for name, receipt in scripts.items():
        relative = Path(name)
        require(not relative.is_absolute() and ".." not in relative.parts
                and isinstance(receipt, dict)
                and set(receipt) <= {"original_sha256", "rebased_sha256", "prefix",
                                     "library_search_path", "original_path", "private_path",
                                     "replacements"}
                and all(re.fullmatch(r"[0-9a-f]{64}", receipt[key]) for key in
                        ("original_sha256", "rebased_sha256")),
                "invalid source-build relocation receipt")
        replacements = receipt.get("replacements", [])
        require(isinstance(replacements, list) and len(replacements) <= 128
                and all(isinstance(item, dict) and set(item) ==
                        {"original_path", "private_path", "occurrences"}
                        and type(item["occurrences"]) is int and item["occurrences"] > 0
                        and all(isinstance(item[key], str) for key in
                                ("original_path", "private_path"))
                        for item in replacements),
                "invalid source-build relocation replacements")
        replacement_count += len(replacements)
    require(replacement_count <= 128, "source-build relocation replacements exceed public bounds")
    require(all(isinstance(item, dict) and set(item) ==
                {"path", "package_target", "prefix_target"}
                and all(isinstance(item[key], str) for key in item)
                for item in links), "invalid source-build rebased package links")
    paths = ((batch["prefix_root"], "${PREFIX}"), (str(Path.home()), "${HOME}"))
    relocations = tokenize({"rebased_scripts": scripts, "rebased_package_links": links}, paths)
    require(len(json.dumps(relocations)) <= 30000,
            "source-build relocation receipts exceed public size limit")
    receipt = freeze.files.get("batch/reused-prefix-receipt.json")
    return public({"host": plan["host"], "prefix_sha256": batch["prefix_sha256"],
                   "package_plan_sha256": inventory["package_plan_sha256"],
                   "prefix_source_manifest_sha256": inventory["source_manifest_sha256"],
                   "batch_manifest_sha256": batch["manifest_sha256"],
                   "reused_prefix_receipt_sha256": receipt["sha256"] if receipt else None,
                   "compiler_linker_flags": tokenize(flags, paths),
                   "application_flag_overrides": tokenize(
                       overrides, (*paths, ("{prefix}", "${PREFIX}"))),
                   "prefix_relocations": relocations,
                   "private_packages": packages})


def export(selection):
    require(selection.get("schema_version") == 1, "unsupported source-build selection schema")
    selected = selection["selected"]
    require(isinstance(selected, dict) and len(selected) == 17, "expected 17 selected applications")
    original_batch_path = bounded_path(selection["original_batch"], CONTROL / "batches")
    verify_attempt_registry(selection, selected, original_batch_path)
    caches = {}
    builds = []
    attempts = []
    methods = []
    methods_by_batch = {}
    conditions_by_batch = {}
    original_apps = None
    original_freeze_key = None
    original_published = None
    for app_id, entry in selected.items():
        history = entry["attempt_history"]
        require(history and len({item["attempt"] for item in history}) == len(history),
                f"invalid attempt history for {app_id}")
        require(history[0]["attempt"] == entry["original_attempt"]
                and history[0]["batch"] == str(original_batch_path)
                and history[-1]["attempt"] == entry["attempt"]
                and history[-1]["batch"] == entry["batch"],
                f"selected attempt history differs for {app_id}")
        observations = [attempt(item, app_id, caches) for item in history]
        if original_apps is None:
            original_freeze_key = (history[0]["freeze_root"], history[0]["freeze_index_sha256"])
            original_freeze = caches[original_freeze_key]
            original_manifest = original_freeze.json("source-builds.template.json")
            original_apps = {app["id"]: app for app in original_manifest["apps"]}
            original_order = [app["id"] for app in original_manifest["apps"]]
            original_published = verify_original_batch(original_freeze, original_batch_path)
        require((history[0]["freeze_root"], history[0]["freeze_index_sha256"]) ==
                original_freeze_key, "original attempts use different freezes")
        require(app_id in original_apps, "selected app differs from original manifest")
        original_batch_meta = caches[original_freeze_key].json("batch/metadata.json")
        require(history[0]["attempt"] ==
                original_batch_meta["attempts"][original_batch_meta["app_ids"].index(app_id)],
                "original attempt differs from fixed batch roster")
        original_result, _, _, _, original_ok = observations[0]
        original_public = original_published[app_id]
        if original_ok:
            require(all(original_public.get(key) == value for key, value in original_result.items()
                        if key not in ("attempt_id", "batch_id")),
                    "original successful result differs from batch report")
        else:
            require(original_public["status"] == "orchestration_failed"
                    and original_public["source_build_seconds"] is None,
                    "original failed result was given a time")
        original_identity = original_apps[app_id]
        for item, (_, proof, app, method, ok) in zip(history, observations):
            require(all(app.get(key) == original_identity.get(key) for key in
                        ("tested_version", "source_url", "source_ref", "source_commit", "scope",
                         "archive", "expected_executable", "rustup_channel",
                         "expected_rustc_version", "prepare", "build")),
                    "retry source identity or build command differs from original")
            methods.append(method)
            previous_method = methods_by_batch.setdefault(proof["batch_id"], method)
            require(previous_method == method, "one batch has conflicting source-build methods")
            freeze_key = (item["freeze_root"], item["freeze_index_sha256"])
            conditions = build_conditions(caches[freeze_key])
            previous_conditions = conditions_by_batch.setdefault(proof["batch_id"], conditions)
            require(previous_conditions == conditions, "one batch has conflicting build conditions")
            attempts.append(proof)
        require(not any(observation[4] for observation in observations[:-1]),
                f"earlier successful timing would be replaced for {app_id}")
        require((entry["attempt"], entry["batch"]) ==
                (history[-1]["attempt"], history[-1]["batch"]), "selected attempt differs")
        selected_row, selected_proof, _, _, selected_ok = observations[-1]
        selected_proof["selected"] = True
        if "original_service" in entry:
            require(all(value == history[0]["service"].get(key)
                        for key, value in entry["original_service"].items()),
                    "original service closure differs")
        if "pinned" in entry:
            require(all(entry["pinned"][name] == selected_proof[name] for name in
                        ("manifest_sha256", "runner_sha256", "wrapper_sha256",
                         "prefix_sha256", "environment_sha256")), "selection pins differ")
        require(entry.get("result_sha256") == selected_proof["result_sha256"],
                "selection result hash differs")
        for phase, digest in entry.get("phase_records", {}).items():
            require(phase.endswith("_sha256") and
                    selected_proof["phase_record_sha256"].get(phase.removesuffix("_sha256")) == digest,
                    "selection phase record hash differs")
        require(selected_ok or selected_row["source_build_seconds"] is None,
                "failed selection has a numeric source-build timing")
        builds.append(public(selected_row))
    require(set(selected) == set(original_order), "source-build roster differs")
    require(all(method.get(key) == methods[0].get(key) for method in methods for key in
                ("cpu_quota", "memory_max_bytes", "affinity_logical_cpus", "observations_per_app")),
            "source-build resource method changed across attempts")
    rows = {row["id"]: row for row in builds}
    builds = [rows[app] for app in original_order]
    manifests = sorted({row["manifest_sha256"] for row in builds})
    comparison = "One selected observation per app; build scopes and toolchains are not ranked."
    if any(method != methods[0] for method in methods):
        comparison += " Methods differ by batch; inspect method_by_batch."
    report = {"schema_version": 1, "manifest_sha256": manifests[0] if len(manifests) == 1 else None,
              "manifest_sha256_by_batch": {row["batch_id"]: row["manifest_sha256"] for row in builds},
              "method": methods[0], "method_by_batch": methods_by_batch,
              "build_conditions_by_batch": conditions_by_batch,
              "attempt_proof": "source-build-attempts.jsonl",
              "comparison": comparison,
              "builds": builds}
    return public(report), attempts, caches


def write(path, data):
    require(not path.exists(), f"public source-build output already exists: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--selection-map", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    selection_data = args.selection_map.read_bytes()
    report, attempts, freezes = export(read_json(selection_data))
    root = args.output.parent
    require(args.output.name == "source-builds.json"
            and root.resolve() == REPO / "assets/performance/file-managers-2026-10-01",
            "source-build output must be the public asset path")
    attempt_bytes = b"".join((json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n").encode()
                             for row in attempts)
    report_bytes = (json.dumps(report, indent=2) + "\n").encode()
    provenance = {"schema_version": 1, "selection_map_sha256": sha256(selection_data),
                  "source_builds_sha256": sha256(report_bytes),
                  "attempts_sha256": sha256(attempt_bytes),
                  "freeze_indexes": sorted({freeze.digest for freeze in freezes.values()}),
                  "selected_successes": sum(row["status"] == "ok" for row in report["builds"]),
                  "selected_failures": sum(row["status"] != "ok" for row in report["builds"])}
    require(not any(path.exists() for path in
                    (root / "source-build-attempts.jsonl", root / "source-build-provenance.json", args.output)),
            "public source-build output already exists")
    write(root / "source-build-attempts.jsonl", attempt_bytes)
    write(root / "source-build-provenance.json", (json.dumps(provenance, indent=2) + "\n").encode())
    write(args.output, report_bytes)
    print(f"exported {len(report['builds'])} source-build rows from {len(attempts)} closed attempts")


if __name__ == "__main__":
    main()
