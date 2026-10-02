#!/usr/bin/env python3
"""Export two closed cohorts and select the declared app sources."""

import argparse
import hashlib
import json
from pathlib import Path

from export_file_manager_results import Sanitizer, export, sha256, write_csv, write_json
from file_manager_cohort import reviewed_terminal_slots


SCENARIOS = {"list100", "list100000", "tiles100000", "preview3png"}
DISCLOSURE = ("The 16 main-cohort apps and SpaceFM's later corrective cohort use the same host "
              "and measurement method, but ran in separate orders. This is a descriptive "
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
                ("icons" if mode == "tiles" else "detail"),
                f"corrective {scenario} warmup review is not bound to a one-tab capture")
    return independent_path, snapshot_path


def compose(main, spacefm, declaration_path, withdrawal_path, audit_path,
            warmup_review_path, method_path, output):
    main = main.resolve(strict=True)
    spacefm = spacefm.resolve(strict=True)
    output = output.resolve()
    require(not output.exists() or not any(output.iterdir()), "results directory must be absent or empty")
    declaration = read_json(declaration_path)
    withdrawal = read_json(withdrawal_path)
    audit = read_json(audit_path)
    require(declaration["schema_version"] == 1 and declaration["disclosure"] == DISCLOSURE and
            sha256(Path(__file__).with_name("export_file_manager_results.py")) ==
            declaration["exporter_sha256"] and
            sha256(withdrawal_path) == declaration["withdrawal_ledger_sha256"] and
            sha256(audit_path) == declaration["tab_audit_sha256"],
            "composition declaration or original evidence hash differs")
    main_apps = validate_sources(main, spacefm, declaration, withdrawal, audit)
    independent_path, snapshot_path = validate_warmup_review(
        spacefm, read_json(spacefm / "plan.json"), warmup_review_path, method_path, declaration)
    main_terminal = source_terminal_slots(main, read_json(main / "plan.json"))
    space_terminal = source_terminal_slots(spacefm, read_json(spacefm / "plan.json"))
    main_export = output / "cohorts/main"
    space_export = output / "cohorts/spacefm"
    main_provenance = export(main, main_export, False)
    space_provenance = export(spacefm, space_export, False)
    validate_export(main_export, declaration["main"], main_provenance)
    validate_export(space_export, declaration["spacefm"], space_provenance)
    main_rows, main_raw = validate_rows(main_export, read_json(main_export / "plan.json"),
                                        main_apps, main_terminal)
    space_rows, space_raw = validate_rows(space_export, read_json(space_export / "plan.json"),
                                          {"spacefm"}, space_terminal)
    require(len([record for record in space_raw if record["warmup"] is True]) == 3 and
            {record["scenario"] for record in space_raw if record["warmup"] is True} ==
            SCENARIOS - {"preview3png"}, "corrective warmups differ from the three declared workloads")
    app_rows(space_rows, "spacefm")
    selected = {(row["app"], row["scenario"]): row for row in space_rows}
    cohort_names = {"main": declaration["main"]["cohort"],
                    "spacefm": declaration["spacefm"]["cohort"]}
    combined = []
    for row in main_rows:
        source = declaration["app_sources"][row["app"]]
        selected_row = row if source == "main" else selected[(row["app"], row["scenario"])]
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
    manifest["apps"] = [corrected_app if app["id"] == "spacefm" else app
                        for app in manifest["apps"]]
    manifest["composition"] = {"source_map": "../../source-map.json",
                               "method": "sixteen main-cohort apps plus later corrective SpaceFM cohort",
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
    source_map = sanitizer.walk(declaration)
    source_map["declaration_sha256"] = sha256(declaration_path)
    source_map["composer_sha256"] = sha256(Path(__file__))
    source_map["standalone_exports"] = {
        "main": {"path": "cohorts/main", "provenance_sha256": sha256(main_export / "export-provenance.json"),
                 "summary_sha256": sha256(main_export / "summary.json")},
        "spacefm": {"path": "cohorts/spacefm", "provenance_sha256": sha256(space_export / "export-provenance.json"),
                    "summary_sha256": sha256(space_export / "summary.json")},
    }
    source_map["withdrawn_main_spacefm_raw_ids"] = [
        f"{cohort_names['main']}:{record['ordinal']}" for record in main_raw if record["app"] == "spacefm"]
    source_map["reviewed_terminal_slot_ids"] = {"main": sorted(main_terminal),
                                                "spacefm": sorted(space_terminal)}
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
    write_json(output / "source-map.json", source_map)
    return source_map


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--main-cohort", type=Path, required=True)
    parser.add_argument("--spacefm-cohort", type=Path, required=True)
    parser.add_argument("--source-map", type=Path, required=True)
    parser.add_argument("--withdrawal-ledger", type=Path, required=True)
    parser.add_argument("--tab-audit", type=Path, required=True)
    parser.add_argument("--warmup-review", type=Path, required=True)
    parser.add_argument("--method", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = compose(args.main_cohort, args.spacefm_cohort, args.source_map,
                         args.withdrawal_ledger, args.tab_audit, args.warmup_review,
                         args.method, args.output_dir)
    except (OSError, ValueError, RuntimeError, KeyError, TypeError, IndexError,
            json.JSONDecodeError) as error:
        parser.exit(1, f"composition failed: {error}\n")
    print(f"composed 68 rows from {len(result['standalone_exports'])} strict cohort exports")


if __name__ == "__main__":
    main()
