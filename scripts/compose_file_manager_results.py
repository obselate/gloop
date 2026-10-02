#!/usr/bin/env python3
"""Export three closed cohorts and select the declared app and scenario sources."""

import argparse
import hashlib
import json
from pathlib import Path

from export_file_manager_results import Sanitizer, export, sha256, write_csv, write_json
from file_manager_cohort import reviewed_terminal_slots


SCENARIOS = {"list100", "list100000", "tiles100000", "preview3png"}
DISCLOSURE = ("Sixteen apps use the main cohort, except Dolphin's preview case. SpaceFM's "
              "whole-app correction and Dolphin's preview-only correction ran in separate "
              "cohorts on the same host and measurement method. This is a descriptive "
              "same-host comparison, not one balanced experiment.")
SHARED_PINS = (
    "adapter_sha256", "fixture_inventory", "source_sha256", "host_package_inventory_sha256",
    "gpu_driver_identity", "session_method", "order_seed", "monitor_pids", "monitor_comms",
    "min_gpu_free_mib", "max_global_gpu_util_percent", "host_baseline_sha256",
    "quiet_seconds", "runs",
)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_json(path):
    return json.loads(path.read_text())


def read_jsonl(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def evidence_path(value):
    repo = Path(__file__).resolve().parent.parent
    staging = repo / "artifacts/performance/file-managers-20261001"
    path = Path(value)
    path = (path if path.is_absolute() else repo / path).resolve(strict=True)
    require(path.is_relative_to(staging) and path.is_file() and not path.is_symlink(),
            "review evidence path escapes benchmark staging")
    return path


def prefix_sha256(path, count):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for _ in range(count):
            line = stream.readline()
            require(line.endswith(b"\n"), "withdrawal raw prefix is incomplete")
            digest.update(line)
    return digest.hexdigest()


def app_rows(rows, app):
    selected = [row for row in rows if row["app"] == app]
    require(len(selected) == 4 and {row["scenario"] for row in selected} == SCENARIOS,
            f"{app} summary does not cover four scenarios")
    return selected


def validate_sources(main, spacefm, declaration, withdrawal, audit):
    main_plan = read_json(main / "plan.json")
    space_plan = read_json(spacefm / "plan.json")
    main_manifest = read_json(main / "inputs/cohort-manifest.json")
    space_manifest = read_json(spacefm / "inputs/cohort-manifest.json")
    main_spec = declaration["main"]
    space_spec = declaration["spacefm"]
    require(main.name == main_spec["cohort"] == "cohort-final-v7" and
            spacefm.name == space_spec["cohort"] == "cohort-spacefm-no-saved-tabs-v1" and
            sha256(main / "plan.json") == main_spec["plan_sha256"] and
            sha256(spacefm / "plan.json") == space_spec["plan_sha256"] and
            sha256(main / "inputs/cohort-manifest.json") == main_spec["manifest_sha256"] and
            sha256(spacefm / "inputs/cohort-manifest.json") == space_spec["manifest_sha256"],
            "source cohort identity differs from declared plan or manifest")
    require(withdrawal["state"] == "withdrawal_declared_before_corrective_launch" and
            withdrawal["withdrawn_app"] == "spacefm" and
            withdrawal["source_plan_sha256"] == main_spec["plan_sha256"] and
            withdrawal["source_manifest_sha256"] == main_spec["manifest_sha256"] and
            withdrawal["tab_growth_audit_sha256"] == declaration["tab_audit_sha256"] and
            audit["measured_ordinal"] == 112 and audit["measured_five_second_and_late"]["observed_tabs"] == 2,
            "SpaceFM withdrawal does not match the reviewed incident")
    observed = withdrawal["observed_source_records_at_declaration"]
    raw_path = main / "raw.jsonl"
    require(declaration["withdrawal_raw_prefix_lines"] == 125 and
            prefix_sha256(raw_path, declaration["withdrawal_raw_prefix_lines"]) ==
            withdrawal["source_raw_prefix_sha256_at_declaration"],
            "main raw prefix changed since prospective withdrawal")
    main_raw = read_jsonl(raw_path)
    for item in observed:
        record = main_raw[item["ordinal"]]
        require(all(record.get(key) == item[key] for key in ("ordinal", "scenario", "slot_id", "warmup"))
                and record["app"] == "spacefm", "withdrawal observed raw identity differs")
    main_slots = main_plan["slots"]
    withdrawn_slots = [dict(slot, index=index) for index, slot in enumerate(main_slots)
                       if slot["app"] == "spacefm"]
    require(len(main_slots) == 177 and len(withdrawn_slots) == 9 and
            withdrawn_slots == withdrawal["withdrawn_main_plan_slots"],
            "withdrawal does not cover all nine original SpaceFM slots")
    slot_identity = lambda slot: tuple(slot[key] for key in ("slot_id", "app", "scenario", "round"))
    require(len(space_plan["slots"]) == 9 and
            {slot_identity(slot) for slot in space_plan["slots"]} ==
            {slot_identity(slot) for slot in withdrawn_slots},
            "corrective plan is not the nine SpaceFM slots")
    main_pins = main_plan["pins"]
    space_pins = space_plan["pins"]
    require(all(main_pins[key] == space_pins[key] for key in SHARED_PINS) and
            space_pins["binary_sha256"] == {"spacefm": main_pins["binary_sha256"]["spacefm"]} and
            main_pins["runs"] == 3, "shared method, host, fixture, or binary pins differ")
    main_apps = {app["id"]: app for app in main_manifest["apps"]}
    correction_apps = space_manifest["apps"]
    require(len(main_apps) == 17 and len(correction_apps) == 1 and
            correction_apps[0]["id"] == "spacefm" and
            declaration["app_sources"] == {app: "spacefm" if app == "spacefm" else "main"
                                            for app in main_apps},
            "app-to-cohort source declaration is incomplete")
    original_app = main_apps["spacefm"]
    corrected_app = correction_apps[0]
    require(withdrawal["original_command"] == original_app["command"] and
            withdrawal["corrected_command"] == corrected_app["command"] and
            corrected_app["command"] == original_app["command"][:-1] +
            ["--no-saved-tabs", original_app["command"][-1]] and
            {key: value for key, value in corrected_app.items() if key != "command"} ==
            {key: value for key, value in original_app.items() if key != "command"},
            "corrective SpaceFM app differs beyond the declared command flag")
    return main_apps


def validate_dolphin_sources(main, dolphin, declaration, withdrawal, audit, seed):
    main_plan = read_json(main / "plan.json")
    plan = read_json(dolphin / "plan.json")
    main_manifest = read_json(main / "inputs/cohort-manifest.json")
    manifest = read_json(dolphin / "inputs/cohort-manifest.json")
    spec = declaration["dolphin_preview"]
    require(dolphin.name == spec["cohort"] == "cohort-dolphin-preview-state-seed-v1" and
            sha256(dolphin / "plan.json") == spec["plan_sha256"] and
            sha256(dolphin / "inputs/cohort-manifest.json") == spec["manifest_sha256"] and
            sha256(dolphin / "inputs/cohort-manifest.json") ==
            declaration["dolphin_seed_manifest_sha256"] and
            declaration["scenario_sources"] == {"dolphin/preview3png": "dolphin_preview"},
            "Dolphin preview source declaration differs")
    require(withdrawal["state"] == "withdrawal_declared_before_corrective_launch" and
            withdrawal["withdrawn_app"] == "dolphin" and
            withdrawal["withdrawn_scenario"] == "preview3png" and
            withdrawal["source_plan_sha256"] == declaration["main"]["plan_sha256"] and
            withdrawal["source_manifest_sha256"] == declaration["main"]["manifest_sha256"] and
            withdrawal["correction_manifest_sha256"] == spec["manifest_sha256"] and
            withdrawal["independent_state_audit_sha256"] ==
            declaration["dolphin_audit_sha256"],
            "Dolphin preview withdrawal differs from prospective source choice")
    raw_path = main / "raw.jsonl"
    end_path = main / "environment-run-invocations.jsonl"
    require(declaration["dolphin_withdrawal_raw_prefix_lines"] ==
            withdrawal["source_raw_count_at_declaration"] == 222 and
            declaration["dolphin_withdrawal_run_end_prefix_lines"] ==
            withdrawal["source_run_end_count_at_declaration"] == 163 and
            prefix_sha256(raw_path, 222) ==
            withdrawal["source_raw_prefix_sha256_at_declaration"] and
            prefix_sha256(end_path, 163) ==
            withdrawal["source_run_end_prefix_sha256_at_declaration"],
            "Dolphin preview prospective raw or run-end prefix changed")
    raw_lines = raw_path.read_bytes().splitlines(keepends=True)
    main_raw = [json.loads(line) for line in raw_lines]
    for item in withdrawal["observed_source_records_at_declaration"]:
        record = main_raw[item["ordinal"]]
        require(record["app"] == "dolphin" and
                all(record.get(key) == item[key] for key in
                    ("ordinal", "scenario", "slot_id", "warmup")),
                "Dolphin observed raw identity differs")
    slots = [dict(slot, index=index) for index, slot in enumerate(main_plan["slots"])
             if slot["app"] == "dolphin" and slot["scenario"] == "preview3png"]
    require(len(slots) == len(plan["slots"]) == 3 and
            slots == withdrawal["withdrawn_main_plan_slots"] and
            [{key: slot[key] for key in ("slot_id", "app", "scenario", "round")}
             for slot in slots] == plan["slots"],
            "Dolphin preview three-slot replacement differs")
    pins = main_plan["pins"]
    correction_pins = plan["pins"]
    require(all(pins[key] == correction_pins[key] for key in SHARED_PINS) and
            correction_pins["binary_sha256"] == {"dolphin": pins["binary_sha256"]["dolphin"]} and
            pins["runs"] == 3, "Dolphin preview shared method or binary pins differ")
    original = next(app for app in main_manifest["apps"] if app["id"] == "dolphin")
    require(len(manifest["apps"]) == 1 and manifest["apps"][0]["id"] == "dolphin",
            "Dolphin corrective manifest app roster differs")
    corrected = manifest["apps"][0]
    require({key: value for key, value in corrected.items() if key not in
             ("scenarios", "supported_scenarios", "unsupported")} ==
            {key: value for key, value in original.items() if key not in
             ("scenarios", "supported_scenarios", "unsupported")} and
            corrected["supported_scenarios"] == ["preview3png"] and
            set(corrected["unsupported"]) == SCENARIOS - {"preview3png"} and
            set(corrected["scenarios"]) == {"preview3png"},
            "Dolphin corrective app differs outside preview support")
    old = original["scenarios"]["preview3png"]
    new = corrected["scenarios"]["preview3png"]
    known_on = evidence_path(withdrawal["known_on_state_source"])
    known_hash = sha256(known_on)
    require(withdrawal["known_on_state_source"].endswith(
                seed["correction"]["known_on_state_source"]) and
            known_hash == seed["correction"]["known_on_state_sha256"] ==
            withdrawal["known_on_state_sha256"] and
            withdrawal["original_post_launch_input"] == old["post_launch_input"] and
            withdrawal["corrected_post_launch_input"] == new["post_launch_input"] and
            old["post_launch_input"] == [{"action": "key", "key": "F11"},
                                         {"action": "click", "at": [340, 100]}] and
            new == {**old,
                    "files": {**old["files"], "state/dolphinstaterc": known_on.read_text()},
                    "post_launch_input": [{"action": "click", "at": [340, 100]}]} and
            seed["correction"]["command_delta"] == "none" and
            corrected["command"] == original["command"],
            "Dolphin known-on seed or click-only delta differs")
    warmup = audit["warmup"]
    measured = audit["measured"]
    require(audit["scope"] == "dolphin/preview3png" and
            audit["manifest_sha256"] == declaration["main"]["manifest_sha256"] and
            audit["plan_sha256"] == declaration["main"]["plan_sha256"] and
            warmup["ordinal"] == 50 and measured["ordinal"] == 217 and
            warmup["raw_line_sha256"] == hashlib.sha256(raw_lines[50]).hexdigest() and
            measured["raw_line_sha256"] == hashlib.sha256(raw_lines[217]).hexdigest() and
            warmup["profile_state_sha256_at_end"] ==
            measured["profile_state_sha256_at_launch"] == known_hash and
            measured["profile_state_sha256_at_end"] != known_hash and
            all(sha256(evidence_path(item["capture"]["path"])) == item["capture"]["sha256"]
                for item in (warmup, measured)),
            "Dolphin preview state audit differs from frozen raw and captures")
    return corrected


def validate_export(path, spec, provenance):
    require(provenance["complete"] is True and provenance["run_execution_status"] == "complete" and
            not provenance["provenance_problems"] and not provenance["missing_required_files"] and
            not provenance["missing_referenced_captures"] and
            not provenance["overwritten_capture_references"],
            "strict standalone export is incomplete")
    files = provenance["files"]
    require(files["plan.json"]["source_sha256"] == spec["plan_sha256"] and
            files["inputs/cohort-manifest.json"]["source_sha256"] == spec["manifest_sha256"],
            "standalone export source identity differs")
    for name, record in files.items():
        relative = Path(name)
        require(not relative.is_absolute() and ".." not in relative.parts and
                (path / relative).is_file() and not (path / relative).is_symlink() and
                sha256(path / relative) == record["export_sha256"],
                f"standalone export file changed: {name}")


def validate_rows(export_dir, plan, app_ids, terminal_ids):
    rows = read_json(export_dir / "summary.json")
    raw = read_jsonl(export_dir / "raw.jsonl")
    require(len(rows) == 4 * len(app_ids) and
            {(row["app"], row["scenario"]) for row in rows} ==
            {(app, scenario) for app in app_ids for scenario in SCENARIOS},
            "standalone summary app/scenario coverage differs")
    require([record["ordinal"] for record in raw] == list(range(len(raw))),
            "standalone raw ordinals are not unique and contiguous")
    accepted = [record for record in raw if record.get("warmup") is False and
                record.get("accepted") is True]
    accepted_ids = [record["slot_id"] for record in accepted]
    planned_ids = {slot["slot_id"] for slot in plan["slots"]}
    slots = {slot["slot_id"]: slot for slot in plan["slots"]}
    require(len(accepted_ids) == len(set(accepted_ids)) and
            all(all(record.get(key) == slots[record["slot_id"]][key]
                    for key in ("slot_id", "app", "scenario", "round")) for record in accepted) and
            set(accepted_ids).isdisjoint(terminal_ids) and
            set(accepted_ids) | terminal_ids == planned_ids and
            set(read_json(export_dir / "environment-run.json")["terminal_failed_slot_ids"]) == terminal_ids,
            "standalone slots are not closed by accepted or reviewed terminal records")
    for row in rows:
        relevant = [record for record in raw if record.get("warmup") is False and
                    record["app"] == row["app"] and record["scenario"] == row["scenario"]]
        require(row["raw_ordinals"] == [record["ordinal"] for record in relevant] and
                len(row["accepted_ordinals"]) == len(set(row["accepted_ordinals"])) and
                set(row["accepted_ordinals"]) ==
                {record["ordinal"] for record in relevant if record.get("accepted") is True} and
                row["n"] == len(row["accepted_ordinals"]) and
                (row["n"] == 3 or
                 (row["comparable"] is False and
                  not any(row["metrics_comparable"].values()))) and
                set(row["accepted_ordinals"]).issubset(row["raw_ordinals"]) and
                all(raw[ordinal]["app"] == row["app"] and
                    raw[ordinal]["scenario"] == row["scenario"] and
                    raw[ordinal]["accepted"] is True for ordinal in row["accepted_ordinals"]),
                "summary raw references differ from standalone raw")
    return rows, raw


def source_terminal_slots(source, plan):
    return reviewed_terminal_slots(read_json(source / "review.json"),
                                   read_jsonl(source / "raw.jsonl"), plan,
                                   source / "environment-run-invocations.jsonl",
                                   sha256(source / "plan.json"))


def validate_warmup_review(spacefm, plan, review_path, method_path, declaration):
    review = read_json(review_path)
    method = read_json(method_path)
    require(sha256(review_path) == declaration["warmup_review_sha256"] and
            sha256(method_path) == declaration["method_sha256"] and
            review["state"] == "reviewed_pass" and
            review["cohort"] == "artifacts/performance/file-managers-20261001/" + spacefm.name and
            review["manifest_sha256"] == declaration["spacefm"]["manifest_sha256"] and
            review["method_sha256"] == declaration["method_sha256"] and
            method["withdrawal_ledger_sha256"] == declaration["withdrawal_ledger_sha256"] and
            method["corrective_manifest_sha256"] == declaration["spacefm"]["manifest_sha256"],
            "corrective warmup review or method declaration differs")
    independent = review["independent_review"]
    independent_path = evidence_path(independent["artifact"])
    independent_review = read_json(independent_path)
    snapshot_path = evidence_path(review["cohort_review_snapshot"])
    snapshot = read_json(snapshot_path)
    require(independent["decision"] == "pass" and
            sha256(independent_path) == independent["sha256"] and
            sha256(snapshot_path) == review["cohort_review_snapshot_sha256"] and
            review["cohort_review_json_sha256"] == sha256(snapshot_path) and
            snapshot["warmups"] == read_json(spacefm / "review.json")["warmups"],
            "independent warmup review or frozen warmup entries differ")
    raw_lines = (spacefm / "raw.jsonl").read_bytes().splitlines(keepends=True)
    expected = {"list100": (0, "100", 100, "list"),
                "list100000": (1, "100000", 100000, "list"),
                "tiles100000": (2, "100000", 100000, "tiles")}
    require(set(review["warmups"]) == {"spacefm/" + name for name in expected},
            "corrective warmup review does not cover all three workloads")
    require(independent_review["cohort"] == review["cohort"] and
            independent_review["decision"] == "pass" and
            independent_review["manifest_sha256"] == declaration["spacefm"]["manifest_sha256"] and
            independent_review["method_sha256"] == declaration["method_sha256"] and
            independent_review["withdrawal_ledger_sha256"] ==
            declaration["withdrawal_ledger_sha256"] and
            independent_review["source_sha256"] == plan["pins"]["source_sha256"] and
            independent_review["raw_prefix_rows"] == 3 and
            independent_review["raw_prefix_sha256"] == prefix_sha256(spacefm / "raw.jsonl", 3) and
            independent_review["warmup_history_rows"] == 3 and
            independent_review["warmup_history_sha256"] ==
            prefix_sha256(spacefm / "environment-warmup-invocations.jsonl", 3) and
            independent_review["captures"] ==
            {scenario: review["warmups"]["spacefm/" + scenario]["capture_sha256"]
             for scenario in expected},
            "independent reviewer did not approve these three corrective captures")
    for scenario, (ordinal, folder, count, mode) in expected.items():
        item = review["warmups"]["spacefm/" + scenario]
        independent_item = independent_review["warmups"][scenario]
        record = json.loads(raw_lines[ordinal])
        capture = record["capture"]
        validation = independent_item["validation"]
        path = evidence_path(item["capture_path"])
        target = Path(__file__).resolve().parent.parent / "artifacts/performance/optimization/fixtures" / folder
        require(item["raw_ordinal"] == ordinal and
                hashlib.sha256(raw_lines[ordinal]).hexdigest() == item["raw_line_sha256"] and
                record["ordinal"] == ordinal and record["app"] == "spacefm" and
                record["scenario"] == scenario and record["warmup"] is True and
                record["status"] in ("ok", "late_window") and not record.get("discard_reason") and
                record["gui_executable_sha256"] == plan["pins"]["binary_sha256"]["spacefm"] and
                int(capture["window"]["pid"]) == record["gui_process_pid"] and
                any(process["pid"] == record["gui_process_pid"]
                    for process in record["processes_at_5s"]) and
                capture["path"] == str(path) and capture["sha256"] == item["capture_sha256"] and
                sha256(path) == item["capture_sha256"] and
                item["fixture_target"] == str(target) and
                record["launch_command"][-1] == str(target) and
                plan["pins"]["fixture_inventory"][folder]["count"] ==
                item["expected_fixture_file_count"] == count and
                item["expected_mode"] == item["observed_mode"] == mode and
                item["populated_tab_count"] == 1 and item["target_folder_verified"] is True and
                item["approved"] is True and independent_item["ordinal"] == ordinal and
                independent_item["raw_line_sha256"] == item["raw_line_sha256"] and
                independent_item["one_fixture_tab"] is True and
                independent_item["scenario_visible"] is True and
                independent_item["population_validated_by_deadline"] is True and
                independent_item["configured_mode"] ==
                ("icons" if mode == "tiles" else "detail") and
                validation["owned_gui_pid"] == record["gui_process_pid"] and
                validation["gui_executable_sha256"] == record["gui_executable_sha256"] and
                validation["pid_in_saved_5s_tree"] is True,
                f"corrective {scenario} warmup review is not bound to a one-tab capture")
    return independent_path, snapshot_path


def validate_dolphin_warmup_review(dolphin, plan, review_path, method_path, declaration):
    review = read_json(review_path)
    method = read_json(method_path)
    cohort = "artifacts/performance/file-managers-20261001/" + dolphin.name
    require(sha256(review_path) == declaration["dolphin_warmup_review_sha256"] and
            sha256(method_path) == declaration["dolphin_method_sha256"] and
            review["state"] == "reviewed_pass" and review["cohort"] == cohort and
            review["manifest_sha256"] == declaration["dolphin_preview"]["manifest_sha256"] and
            review["method_sha256"] == declaration["dolphin_method_sha256"] and
            method["withdrawal_ledger_sha256"] ==
            declaration["dolphin_withdrawal_ledger_sha256"] and
            method["corrective_manifest_sha256"] ==
            declaration["dolphin_preview"]["manifest_sha256"] and
            method["known_on_state_sha256"] == declaration["dolphin_known_on_state_sha256"] and
            method["source_main_plan_sha256"] == declaration["main"]["plan_sha256"] and
            method["source_sha256"] == plan["pins"]["source_sha256"] and
            method["measured_slot_count"] == len(plan["slots"]) == 3,
            "Dolphin reviewed warmup or method differs")
    independent = review["independent_review"]
    independent_path = evidence_path(independent["artifact"])
    independent_review = read_json(independent_path)
    snapshot_path = evidence_path(review["cohort_review_snapshot"])
    snapshot = read_json(snapshot_path)
    require(independent["decision"] == "pass" and
            sha256(independent_path) == independent["sha256"] ==
            declaration["dolphin_independent_warmup_review_sha256"] and
            sha256(snapshot_path) == review["cohort_review_snapshot_sha256"] ==
            review["cohort_review_json_sha256"] ==
            declaration["dolphin_warmup_review_snapshot_sha256"] and
            snapshot["warmups"] == read_json(dolphin / "review.json")["warmups"] and
            set(review["warmups"]) == {"dolphin/preview3png"},
            "Dolphin independent warmup or frozen review snapshot differs")
    raw_lines = (dolphin / "raw.jsonl").read_bytes().splitlines(keepends=True)
    record = json.loads(raw_lines[0])
    item = review["warmups"]["dolphin/preview3png"]
    other = independent_review["warmups"]["preview3png"]
    capture = record[item["capture_role"]]
    path = evidence_path(item["capture_path"])
    target = Path(__file__).resolve().parent.parent / "artifacts/performance/optimization/fixtures/3"
    owned = (record["processes_at_5s"] if item["capture_role"] == "capture" else
             record["late_state"]["processes"])
    validation = other["validation"]
    require(len(raw_lines) >= 1 and item["capture_role"] in ("capture", "late_capture") and
            record["ordinal"] == item["raw_ordinal"] == other["ordinal"] == 0 and
            record["app"] == "dolphin" and record["scenario"] == "preview3png" and
            record["warmup"] is True and record["status"] in ("ok", "late_window") and
            not record.get("discard_reason") and
            record["manifest_sha256"] == declaration["dolphin_preview"]["manifest_sha256"] and
            record["binary_sha256"] == plan["pins"]["binary_sha256"]["dolphin"] and
            record["gui_executable_sha256"] == plan["pins"]["binary_sha256"]["dolphin"] and
            record["profile_files_sha256_at_launch"]["state/dolphinstaterc"] ==
            declaration["dolphin_known_on_state_sha256"] and
            [entry["action"] for entry in record["post_launch_input"]] ==
            [{"action": "click", "at": [340, 100]}] and
            hashlib.sha256(raw_lines[0]).hexdigest() ==
            item["raw_line_sha256"] == other["raw_line_sha256"] and
            capture["path"] == str(path) == item["capture_path"] and
            capture["sha256"] == item["capture_sha256"] == other["capture_sha256"] and
            sha256(path) == capture["sha256"] and
            int(capture["window"]["pid"]) == record["gui_process_pid"] and
            any(process["pid"] == record["gui_process_pid"] for process in owned) and
            item["fixture_target"] == str(target) == record["launch_command"][-1] and
            item["expected_fixture_file_count"] ==
            plan["pins"]["fixture_inventory"]["3"]["count"] == 3 and
            item["observed_mode"] == "preview" and
            item["selected_image"] == other["selected_image"] == "image-0.png" and
            item["information_panel_visible"] is True and
            item["whole_image_visible"] is True and
            item["seed_sha256"] == declaration["dolphin_known_on_state_sha256"] and
            item["approved"] is True and
            other["capture_role"] == item["capture_role"] and
            other["information_panel_visible"] is True and
            other["whole_image_visible"] is True and
            other["population_validated_by_deadline"] is True and
            validation["owned_gui_pid"] == record["gui_process_pid"] and
            validation["gui_executable_sha256"] == record["gui_executable_sha256"] and
            validation["pid_in_saved_capture_tree"] is True,
            "Dolphin preview warmup review is not bound to an owned full-image preview")
    source = plan["pins"]["source_sha256"]
    require(independent_review["cohort"] == cohort and
            independent_review["decision"] == "pass" and
            independent_review["manifest_sha256"] == declaration["dolphin_preview"]["manifest_sha256"] and
            independent_review["method_sha256"] == declaration["dolphin_method_sha256"] and
            independent_review["withdrawal_ledger_sha256"] ==
            declaration["dolphin_withdrawal_ledger_sha256"] and
            independent_review["audit_sha256"] == declaration["dolphin_audit_sha256"] and
            independent_review["seed_sha256"] == declaration["dolphin_known_on_state_sha256"] and
            independent_review["source_sha256"] == source and
            independent_review["raw_prefix_rows"] == 1 and
            independent_review["raw_prefix_sha256"] == prefix_sha256(dolphin / "raw.jsonl", 1) and
            independent_review["warmup_history_rows"] == 1 and
            independent_review["warmup_history_sha256"] ==
            prefix_sha256(dolphin / "environment-warmup-invocations.jsonl", 1) and
            independent_review["captures"] == {"preview3png": capture["sha256"]},
            "Dolphin independent reviewer did not approve the actual warmup prefix")
    return independent_path, snapshot_path


def compose(main, spacefm, dolphin, declaration_path, withdrawal_path, audit_path,
            warmup_review_path, method_path, dolphin_withdrawal_path, dolphin_audit_path,
            dolphin_seed_path, dolphin_warmup_review_path, dolphin_method_path, output):
    main = main.resolve(strict=True)
    spacefm = spacefm.resolve(strict=True)
    dolphin = dolphin.resolve(strict=True)
    output = output.resolve()
    require(not output.exists() or not any(output.iterdir()), "results directory must be absent or empty")
    declaration = read_json(declaration_path)
    withdrawal = read_json(withdrawal_path)
    audit = read_json(audit_path)
    dolphin_withdrawal = read_json(dolphin_withdrawal_path)
    dolphin_audit = read_json(dolphin_audit_path)
    dolphin_seed = read_json(dolphin_seed_path)
    space_ledger = evidence_path(
        "artifacts/performance/file-managers-20261001/spacefm-no-saved-tabs-plan-creation-v1.json")
    dolphin_ledger = evidence_path(
        "artifacts/performance/file-managers-20261001/dolphin-preview-state-seed-plan-creation-v1.json")
    require(declaration["schema_version"] == 1 and declaration["disclosure"] == DISCLOSURE and
            declaration["stage"] ==
            "after_reviewed_corrective_warmups_before_corrective_measurements" and
            all(declaration[key] == 0 for key in
                ("corrective_measured_raw_rows_at_declaration",
                 "corrective_run_end_rows_at_declaration",
                 "dolphin_corrective_measured_raw_rows_at_declaration",
                 "dolphin_corrective_run_end_rows_at_declaration")) and
            sha256(Path(__file__).with_name("export_file_manager_results.py")) ==
            declaration["exporter_sha256"] and
            sha256(space_ledger) == declaration["plan_creation_ledger_sha256"] and
            sha256(dolphin_ledger) == declaration["dolphin_plan_creation_ledger_sha256"] and
            read_json(space_ledger)["plan_sha256"] == declaration["spacefm"]["plan_sha256"] and
            read_json(dolphin_ledger)["plan_sha256"] ==
            declaration["dolphin_preview"]["plan_sha256"] and
            sha256(withdrawal_path) == declaration["withdrawal_ledger_sha256"] and
            sha256(audit_path) == declaration["tab_audit_sha256"] and
            sha256(dolphin_withdrawal_path) == declaration["dolphin_withdrawal_ledger_sha256"] and
            sha256(dolphin_audit_path) == declaration["dolphin_audit_sha256"] and
            sha256(dolphin_seed_path) == declaration["dolphin_seed_manifest_sha256"],
            "composition declaration or original evidence hash differs")
    main_apps = validate_sources(main, spacefm, declaration, withdrawal, audit)
    corrected_dolphin = validate_dolphin_sources(
        main, dolphin, declaration, dolphin_withdrawal, dolphin_audit, dolphin_seed)
    independent_path, snapshot_path = validate_warmup_review(
        spacefm, read_json(spacefm / "plan.json"), warmup_review_path, method_path, declaration)
    dolphin_independent, dolphin_snapshot = validate_dolphin_warmup_review(
        dolphin, read_json(dolphin / "plan.json"), dolphin_warmup_review_path,
        dolphin_method_path, declaration)
    main_terminal = source_terminal_slots(main, read_json(main / "plan.json"))
    space_terminal = source_terminal_slots(spacefm, read_json(spacefm / "plan.json"))
    dolphin_terminal = source_terminal_slots(dolphin, read_json(dolphin / "plan.json"))
    main_export = output / "cohorts/main"
    space_export = output / "cohorts/spacefm"
    dolphin_export = output / "cohorts/dolphin_preview"
    main_provenance = export(main, main_export, False)
    space_provenance = export(spacefm, space_export, False)
    dolphin_provenance = export(dolphin, dolphin_export, False)
    validate_export(main_export, declaration["main"], main_provenance)
    validate_export(space_export, declaration["spacefm"], space_provenance)
    validate_export(dolphin_export, declaration["dolphin_preview"], dolphin_provenance)
    main_rows, main_raw = validate_rows(main_export, read_json(main_export / "plan.json"),
                                        main_apps, main_terminal)
    space_rows, space_raw = validate_rows(space_export, read_json(space_export / "plan.json"),
                                          {"spacefm"}, space_terminal)
    dolphin_rows, dolphin_raw = validate_rows(
        dolphin_export, read_json(dolphin_export / "plan.json"), {"dolphin"}, dolphin_terminal)
    require(len([record for record in space_raw if record["warmup"] is True]) == 3 and
            {record["scenario"] for record in space_raw if record["warmup"] is True} ==
            SCENARIOS - {"preview3png"}, "corrective warmups differ from the three declared workloads")
    app_rows(space_rows, "spacefm")
    require(len([record for record in dolphin_raw if record["warmup"] is True]) == 1 and
            [(record["app"], record["scenario"]) for record in dolphin_raw
             if record["warmup"] is True] == [("dolphin", "preview3png")],
            "corrective Dolphin warmup differs from the declared workload")
    app_rows(dolphin_rows, "dolphin")
    selected = {"spacefm": {(row["app"], row["scenario"]): row for row in space_rows},
                "dolphin_preview": {(row["app"], row["scenario"]): row for row in dolphin_rows}}
    cohort_names = {"main": declaration["main"]["cohort"],
                    "spacefm": declaration["spacefm"]["cohort"],
                    "dolphin_preview": declaration["dolphin_preview"]["cohort"]}
    combined = []
    for row in main_rows:
        key = row["app"] + "/" + row["scenario"]
        source = declaration["scenario_sources"].get(key, declaration["app_sources"][row["app"]])
        selected_row = row if source == "main" else selected[source][(row["app"], row["scenario"])]
        result = dict(selected_row)
        result["source_cohort"] = cohort_names[source]
        result["raw_ids"] = [f"{cohort_names[source]}:{ordinal}"
                             for ordinal in result["raw_ordinals"]]
        result["accepted_ids"] = [f"{cohort_names[source]}:{ordinal}"
                                  for ordinal in result["accepted_ordinals"]]
        combined.append(result)
    require(len(combined) == 68 and len({(row["app"], row["scenario"]) for row in combined}) == 68,
            "composite does not contain 68 disjoint app/scenario rows")
    composite = output / "composite"
    write_json(composite / "summary.json", combined)
    write_csv(composite / "summary.csv", combined)
    manifest = read_json(main_export / "inputs/cohort-manifest.json")
    corrected_app = read_json(space_export / "inputs/cohort-manifest.json")["apps"][0]
    manifest["apps"] = [corrected_app if app["id"] == "spacefm" else
                        {**app, "scenarios": {**app["scenarios"],
                                              "preview3png": corrected_dolphin["scenarios"]["preview3png"]}}
                        if app["id"] == "dolphin" else app for app in manifest["apps"]]
    manifest["composition"] = {"source_map": "../../source-map.json",
                               "method": "sixteen main-cohort apps, later whole-app SpaceFM and Dolphin preview corrections",
                               "interpretation": DISCLOSURE}
    write_json(composite / "inputs/composite-manifest.json", manifest)
    sanitizer = Sanitizer(main, None)
    write_json(composite / "evidence/spacefm-withdrawal.json", sanitizer.walk(withdrawal))
    write_json(composite / "evidence/spacefm-tab-audit.json", sanitizer.walk(audit))
    write_json(composite / "evidence/spacefm-warmup-review.json",
               sanitizer.walk(read_json(warmup_review_path)))
    write_json(composite / "evidence/spacefm-independent-warmup-review.json",
               sanitizer.walk(read_json(independent_path)))
    write_json(composite / "evidence/spacefm-warmup-review-snapshot.json",
               sanitizer.walk(read_json(snapshot_path)))
    for name, path in (("spacefm-method", method_path),
                       ("spacefm-plan-creation", space_ledger),
                       ("dolphin-preview-method", dolphin_method_path),
                       ("dolphin-preview-plan-creation", dolphin_ledger),
                       ("dolphin-preview-withdrawal", dolphin_withdrawal_path),
                       ("dolphin-preview-audit", dolphin_audit_path),
                       ("dolphin-preview-seed-manifest", dolphin_seed_path),
                       ("dolphin-preview-warmup-review", dolphin_warmup_review_path),
                       ("dolphin-preview-independent-warmup-review", dolphin_independent),
                       ("dolphin-preview-warmup-review-snapshot", dolphin_snapshot)):
        write_json(composite / "evidence" / (name + ".json"), sanitizer.walk(read_json(path)))
    source_map = sanitizer.walk(declaration)
    source_map["declaration_sha256"] = sha256(declaration_path)
    source_map["composer_sha256"] = sha256(Path(__file__))
    source_map["standalone_exports"] = {
        "main": {"path": "cohorts/main", "provenance_sha256": sha256(main_export / "export-provenance.json"),
                 "summary_sha256": sha256(main_export / "summary.json")},
        "spacefm": {"path": "cohorts/spacefm", "provenance_sha256": sha256(space_export / "export-provenance.json"),
                    "summary_sha256": sha256(space_export / "summary.json")},
        "dolphin_preview": {"path": "cohorts/dolphin_preview",
                            "provenance_sha256": sha256(dolphin_export / "export-provenance.json"),
                            "summary_sha256": sha256(dolphin_export / "summary.json")},
    }
    source_map["withdrawn_main_spacefm_raw_ids"] = [
        f"{cohort_names['main']}:{record['ordinal']}" for record in main_raw if record["app"] == "spacefm"]
    source_map["withdrawn_main_dolphin_preview_raw_ids"] = [
        f"{cohort_names['main']}:{record['ordinal']}" for record in main_raw
        if record["app"] == "dolphin" and record["scenario"] == "preview3png"]
    source_map["reviewed_terminal_slot_ids"] = {"main": sorted(main_terminal),
                                                "spacefm": sorted(space_terminal),
                                                "dolphin_preview": sorted(dolphin_terminal)}
    source_map["final_summary_sha256"] = sha256(composite / "summary.json")
    source_map["final_csv_sha256"] = sha256(composite / "summary.csv")
    source_map["composite_manifest_sha256"] = sha256(composite / "inputs/composite-manifest.json")
    source_map["public_withdrawal_sha256"] = sha256(composite / "evidence/spacefm-withdrawal.json")
    source_map["public_tab_audit_sha256"] = sha256(composite / "evidence/spacefm-tab-audit.json")
    source_map["independent_warmup_review_sha256"] = sha256(independent_path)
    source_map["warmup_review_snapshot_sha256"] = sha256(snapshot_path)
    source_map["public_warmup_review_sha256"] = sha256(composite / "evidence/spacefm-warmup-review.json")
    source_map["public_independent_warmup_review_sha256"] = sha256(
        composite / "evidence/spacefm-independent-warmup-review.json")
    source_map["public_warmup_review_snapshot_sha256"] = sha256(
        composite / "evidence/spacefm-warmup-review-snapshot.json")
    for key in ("spacefm-method", "spacefm-plan-creation",
                "dolphin-preview-method", "dolphin-preview-plan-creation",
                "dolphin-preview-withdrawal", "dolphin-preview-audit",
                "dolphin-preview-seed-manifest", "dolphin-preview-warmup-review",
                "dolphin-preview-independent-warmup-review",
                "dolphin-preview-warmup-review-snapshot"):
        source_map["public_" + key.replace("-", "_") + "_sha256"] = sha256(
            composite / "evidence" / (key + ".json"))
    write_json(output / "source-map.json", source_map)
    return source_map


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--main-cohort", type=Path, required=True)
    parser.add_argument("--spacefm-cohort", type=Path, required=True)
    parser.add_argument("--dolphin-cohort", type=Path, required=True)
    parser.add_argument("--source-map", type=Path, required=True)
    parser.add_argument("--withdrawal-ledger", type=Path, required=True)
    parser.add_argument("--tab-audit", type=Path, required=True)
    parser.add_argument("--warmup-review", type=Path, required=True)
    parser.add_argument("--method", type=Path, required=True)
    parser.add_argument("--dolphin-withdrawal-ledger", type=Path, required=True)
    parser.add_argument("--dolphin-audit", type=Path, required=True)
    parser.add_argument("--dolphin-seed-manifest", type=Path, required=True)
    parser.add_argument("--dolphin-warmup-review", type=Path, required=True)
    parser.add_argument("--dolphin-method", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = compose(args.main_cohort, args.spacefm_cohort, args.dolphin_cohort,
                         args.source_map, args.withdrawal_ledger, args.tab_audit,
                         args.warmup_review, args.method, args.dolphin_withdrawal_ledger,
                         args.dolphin_audit, args.dolphin_seed_manifest,
                         args.dolphin_warmup_review, args.dolphin_method, args.output_dir)
    except (OSError, ValueError, RuntimeError, KeyError, TypeError, IndexError,
            json.JSONDecodeError) as error:
        parser.exit(1, f"composition failed: {error}\n")
    print(f"composed 68 rows from {len(result['standalone_exports'])} strict cohort exports")


if __name__ == "__main__":
    main()
