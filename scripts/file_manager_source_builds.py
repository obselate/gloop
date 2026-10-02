#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shlex
import shutil
import subprocess
import sys
import tarfile
import time
from urllib.request import Request, urlopen


REPO = Path(__file__).resolve().parent.parent
MANIFEST = REPO / "assets/performance/file-managers-2026-10-01/source-builds.template.json"
DEFAULT_ROOT = REPO / "artifacts/performance/file-managers-20261001/source-builds"
MEMORY_LIMIT = 8 * 1024 ** 3
RUST_APPS = {"cosmic-files", "flea", "strata"}
FLEA_ARCHIVE_SHA256 = "1f17c57377c59b6e8bf211633c73ef5ca9222b79b3331cf7226cb705dc83d71c"
FLEA_RUNTIME_ALIASES = {
    "flea-0.3.7/ui/Commons": "/usr/share/omarchy/shell/Commons",
    "flea-0.3.7/ui/Ui": "/usr/share/omarchy/shell/Ui",
    "flea-0.3.7/ui/boot/Commons": "/usr/share/omarchy/shell/Commons",
    "flea-0.3.7/ui/boot/Ui": "/usr/share/omarchy/shell/Ui",
}
CACHE_ENV_KEYS = {"XDG_CACHE_HOME", "CARGO_HOME", "NUGET_PACKAGES",
                  "NUGET_HTTP_CACHE_PATH", "NUGET_PLUGINS_CACHE_PATH",
                  "NUGET_SCRATCH", "DOTNET_CLI_HOME", "RUSTUP_HOME",
                  "RUSTUP_TOOLCHAIN", "RUSTUP_AUTO_INSTALL"}
UNSAFE_BUILD_ENV_KEYS = {"CARGO_TARGET_DIR", "CARGO_BUILD_TARGET_DIR", "CARGO_BUILD_BUILD_DIR",
                         "RUSTC", "CARGO_BUILD_RUSTC", "RUSTC_WRAPPER", "RUSTC_WORKSPACE_WRAPPER",
                         "CARGO_BUILD_RUSTC_WRAPPER", "CARGO_BUILD_RUSTC_WORKSPACE_WRAPPER"}
TOOLS = {
    "cc": ["cc", "--version"],
    "cxx": ["c++", "--version"],
    "clang": ["clang", "--version"],
    "clangxx": ["clang++", "--version"],
    "cmake": ["cmake", "--version"],
    "meson": ["meson", "--version"],
    "ninja": ["ninja", "--version"],
    "make": ["make", "--version"],
    "cargo": ["cargo", "--version"],
    "rustc": ["rustc", "--version"],
    "fpc": ["fpc", "-iV"],
    "lazbuild": ["lazbuild", "--version"],
    "valac": ["valac", "--version"],
    "dotnet": ["dotnet", "--version"],
    "ld": ["ld", "--version"],
    "lld": ["ld.lld", "--version"],
    "pkg_config": ["pkg-config", "--version"],
}


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def tree_sha256(root):
    digest = hashlib.sha256()
    for directory, subdirs, files in os.walk(root, followlinks=False):
        base = Path(directory)
        subdirs.sort()
        for name in sorted([*subdirs, *files]):
            path = base / name
            relative = path.relative_to(root).as_posix().encode()
            if path.is_symlink():
                digest.update(b"L" + relative + b"\0" + os.readlink(path).encode() + b"\n")
            elif path.is_file():
                digest.update(b"F" + relative + b"\0" + sha256(path).encode() + b"\n")
    return digest.hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def read_json(path):
    return json.loads(path.read_text())


def selected_apps(manifest, ids):
    apps = {app["id"]: app for app in manifest["apps"]}
    if len(apps) != 17 or len(apps) != len(manifest["apps"]):
        raise ValueError("source manifest must contain 17 unique applications")
    if ids and set(ids) - apps.keys():
        raise ValueError(f"unknown applications: {sorted(set(ids) - apps.keys())}")
    return [apps[id] for id in (ids or apps.keys())]


def render(value, variables):
    if isinstance(value, str):
        return value.format_map(variables)
    if isinstance(value, list):
        return [render(item, variables) for item in value]
    if isinstance(value, dict):
        return {key: render(item, variables) for key, item in value.items()}
    return value


def variables(root, app):
    id = app["id"]
    return {
        "source": str(root / "source" / id),
        "build": str(root / "build" / id),
        "output": str(root / "output" / id),
    }


def fetch(root, app, manifest_hash):
    id = app["id"]
    archive = root / "archives" / id / app["archive"]
    source = root / "source" / id
    record = root / "records" / id / "fetch.json"
    if record.exists():
        old = read_json(record)
        if (old["status"] == "ok" and archive.exists() and source.is_dir()
                and old.get("manifest_sha256") == manifest_hash
                and old.get("source_url") == app["source_url"]
                and old.get("source_ref") == app["source_ref"]
                and old.get("source_commit") == app.get("source_commit")
                and sha256(archive) == old["source_archive_sha256"]
                and tree_sha256(source) == old["extracted_source_sha256"]):
            return
        raise RuntimeError(f"{id}: existing source record or archive has changed")
    archive.parent.mkdir(parents=True, exist_ok=True)
    if not archive.exists():
        temporary = archive.with_name(archive.name + ".part")
        request = Request(app["source_url"], headers={"User-Agent": "gloop-source-build-benchmark"})
        with urlopen(request, timeout=90) as remote, temporary.open("wb") as local:
            shutil.copyfileobj(remote, local)
        temporary.replace(archive)
    archive_hash = sha256(archive)
    if app.get("source_archive_sha256") and archive_hash != app["source_archive_sha256"]:
        raise RuntimeError(f"{id}: source archive SHA-256 differs from manifest")
    if id == "flea" and archive_hash != FLEA_ARCHIVE_SHA256:
        raise RuntimeError("flea: source archive differs from reviewed runtime alias archive")
    if source.exists():
        raise RuntimeError(f"{id}: source directory already exists without a valid record")
    temporary = root / "source" / (".extract-" + id)
    if temporary.exists():
        raise RuntimeError(f"{id}: unfinished source extraction exists")
    temporary.mkdir(parents=True)
    omitted_members = []
    def safe_member(member, destination):
        if id == "flea" and member.name in FLEA_RUNTIME_ALIASES:
            if not member.issym() or member.linkname != FLEA_RUNTIME_ALIASES[member.name]:
                raise RuntimeError(f"flea: reviewed runtime alias differs: {member.name}")
            omitted_members.append({"name": member.name, "type": "symlink",
                                    "target": member.linkname})
            return None
        return tarfile.data_filter(member, destination)
    with tarfile.open(archive) as bundle:
        for member in bundle.getmembers():
            path = PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts:
                raise RuntimeError(f"{id}: unsafe archive member {member.name}")
        bundle.extractall(temporary, filter=safe_member)
    if id == "flea" and (len(omitted_members) != len(FLEA_RUNTIME_ALIASES)
                          or {entry["name"] for entry in omitted_members} != set(FLEA_RUNTIME_ALIASES)):
        raise RuntimeError("flea: reviewed runtime aliases are missing or duplicated")
    roots = list(temporary.iterdir())
    if len(roots) != 1 or not roots[0].is_dir():
        raise RuntimeError(f"{id}: expected one source root in archive")
    roots[0].replace(source)
    temporary.rmdir()
    write_json(record, {
        "status": "ok", "manifest_sha256": manifest_hash, "source_url": app["source_url"],
        "source_ref": app["source_ref"], "source_commit": app.get("source_commit"),
        "source_archive_sha256": archive_hash,
        "omitted_archive_members": omitted_members,
        "extracted_source_sha256": tree_sha256(source),
    })


def scope(payload_path, cpu_pair, environment, phase):
    isolation = ["bwrap", "--unshare-net", "--bind", "/", "/", "--dev-bind", "/dev", "/dev", "--"] if phase == "measure" else []
    command = [
        "systemd-run", "--user", "--scope", "--collect",
        "--property=CPUQuota=200%", f"--property=MemoryMax={MEMORY_LIMIT}",
        "--", *isolation, "/usr/bin/env", "-u", "INVOCATION_ID",
        "taskset", "-c", ",".join(map(str, cpu_pair)),
        sys.executable, str(Path(__file__).resolve()), "internal", str(payload_path),
    ]
    return subprocess.run(command, capture_output=True, text=True, env=environment)


def environment_from(path):
    environment = os.environ.copy()
    if path:
        additions = read_json(path)
        if not isinstance(additions, dict) or any(not isinstance(key, str) or not isinstance(value, str)
                                                for key, value in additions.items()):
            raise ValueError("environment file must be a JSON object of strings")
        if CACHE_ENV_KEYS & additions.keys():
            raise ValueError("environment file cannot override isolated dependency cache paths")
        environment.update(additions)
    blocked = [key for key, value in environment.items() if value and
               (key in UNSAFE_BUILD_ENV_KEYS or key.startswith(("CCACHE_", "SCCACHE_"))
                or key.endswith("_COMPILER_LAUNCHER"))]
    for key in ("CC", "CXX"):
        parts = shlex.split(environment.get(key, ""))
        if parts and Path(parts[0]).name in {
                "ccache", "sccache", "distcc", "icecc"}:
            blocked.append(key)
    if blocked:
        raise ValueError(f"external build-cache settings are not allowed: {sorted(blocked)}")
    return environment


def cache_environment(root, app, environment, prefix):
    if CACHE_ENV_KEYS & app.get("environment", {}).keys():
        raise ValueError(f"{app['id']}: app environment cannot override isolated dependency cache paths")
    if UNSAFE_BUILD_ENV_KEYS & app.get("environment", {}).keys():
        raise ValueError(f"{app['id']}: app environment cannot override the pinned compiler or output path")
    cache_root = root / "cache" / app["id"]
    cache_root.mkdir(parents=True, exist_ok=True)
    if cache_root.resolve() != cache_root:
        raise ValueError(f"{app['id']}: dependency cache must not be a symlink")
    isolated = environment.copy()
    paths = {
        "XDG_CACHE_HOME": cache_root / "xdg",
        "CARGO_HOME": cache_root / "cargo",
        "NUGET_PACKAGES": cache_root / "nuget-packages",
        "NUGET_HTTP_CACHE_PATH": cache_root / "nuget-http",
        "NUGET_PLUGINS_CACHE_PATH": cache_root / "nuget-plugins",
        "NUGET_SCRATCH": cache_root / "nuget-scratch",
        "DOTNET_CLI_HOME": cache_root / "dotnet-cli",
    }
    for key, path in paths.items():
        path.mkdir(parents=True, exist_ok=True)
        if path.resolve() != path:
            raise ValueError(f"{app['id']}: {key} cache must not be a symlink")
        isolated[key] = str(path)
    if app.get("rustup_channel"):
        if prefix is None:
            raise ValueError(f"{app['id']}: Rust builds require a provisioned --prefix-root")
        rustup_home = prefix / "rustup"
        if not rustup_home.is_dir() or rustup_home.resolve() != rustup_home:
            raise ValueError(f"{app['id']}: provision Rust under --prefix-root/rustup before preparation")
        toolchain = rustup_home / "toolchains" / f"{app['rustup_channel']}-x86_64-unknown-linux-gnu"
        if not all((toolchain / "bin" / name).is_file() for name in ("rustc", "cargo")):
            raise ValueError(f"{app['id']}: exact Rust toolchain is missing from prefix")
        isolated["RUSTUP_HOME"] = str(rustup_home)
        isolated["RUSTUP_TOOLCHAIN"] = app["rustup_channel"]
        isolated["RUSTUP_AUTO_INSTALL"] = "0"
        isolated["RUSTC"] = str(toolchain / "bin" / "rustc")
    return isolated, cache_root


def environment_hash(environment, app):
    return hash_environment(environment | app.get("environment", {}))


def resolved_app(app, prefix):
    values = {}
    for key, value in app.get("environment", {}).items():
        if not isinstance(key, str) or not isinstance(value, str):
            raise ValueError(f"{app['id']}: environment values must be strings")
        if "{prefix}" in value and prefix is None:
            raise ValueError(f"{app['id']}: environment requires --prefix-root")
        values[key] = value.replace("{prefix}", str(prefix))
    return {**app, "environment": values}


def hash_environment(environment):
    return hashlib.sha256(json.dumps(environment, sort_keys=True).encode()).hexdigest()


def host_phase(root, app, phase, environment, cache_root, prefix_hash, manifest_hash):
    id = app["id"]
    env_hash = environment_hash(environment, app)
    folder = root / "records" / id
    fetch_record = read_json(folder / "fetch.json")
    archive = root / "archives" / id / app["archive"]
    if sha256(archive) != fetch_record["source_archive_sha256"]:
        raise RuntimeError(f"{id}: source archive changed")
    if fetch_record["status"] != "ok" or not (root / "source" / id).is_dir():
        raise RuntimeError(f"{id}: source was not extracted")
    if fetch_record.get("manifest_sha256") != manifest_hash:
        raise RuntimeError(f"{id}: manifest changed after source fetch")
    target = folder / f"{phase}.json"
    if target.exists():
        raise RuntimeError(f"{id}: {phase} already attempted; use a new root for another observation")
    expected_rust_toolchains = None
    if phase == "measure":
        prepared = read_json(folder / "prepare.json")
        if (prepared["status"] != "ok" or prepared["environment_sha256"] != env_hash
                or prepared["prefix_sha256"] != prefix_hash
                or prepared.get("manifest_sha256") != manifest_hash):
            raise RuntimeError(f"{id}: preparation did not succeed with this environment")
        expected_hash = prepared["prepared_source_sha256"]
        expected_cache_hash = prepared["dependency_cache_sha256"]
        if id in RUST_APPS:
            expected_rust_toolchains = {
                name: prepared["toolchains"].get(name) for name in ("selected_rustc", "selected_cargo")
            }
    else:
        expected_hash = fetch_record["extracted_source_sha256"]
        expected_cache_hash = None
    source_hash = tree_sha256(root / "source" / id)
    if source_hash != expected_hash:
        raise RuntimeError(f"{id}: source tree changed before {phase}")
    if expected_cache_hash and tree_sha256(cache_root) != expected_cache_hash:
        raise RuntimeError(f"{id}: dependency cache changed before {phase}")
    cpu_pair = sorted(os.sched_getaffinity(0))[:2]
    if len(cpu_pair) != 2:
        raise RuntimeError("two available logical CPUs are required")
    values = variables(root, app)
    if id in RUST_APPS:
        values["cargo"] = str(Path(environment["RUSTC"]).with_name("cargo"))
    if phase == "measure" and find_executable(values.values(), app["expected_executable"]):
        raise RuntimeError(f"{id}: executable exists before the timed build")
    (root / "build" / id).mkdir(parents=True, exist_ok=True)
    (root / "output" / id).mkdir(parents=True, exist_ok=True)
    payload = {
        "phase": phase, "id": id, "steps": render(app["prepare"], values) if phase == "prepare" else [],
        "build": render(app["build"], values), "result": str(target),
        "log": str(folder / f"{phase}.log"), "environment_sha256": env_hash,
        "manifest_sha256": manifest_hash,
        "prefix_sha256": prefix_hash, "app_environment": app.get("environment", {}),
        "dependency_cache_root": str(cache_root),
        "expected_dependency_cache_sha256": expected_cache_hash,
        "expected_rust_toolchains": expected_rust_toolchains,
        "expected_rustc_version": app.get("expected_rustc_version"),
        "expected_executable": app["expected_executable"],
        "search_roots": [values["source"], values["build"], values["output"]],
    }
    payload_path = folder / f"{phase}-payload.json"
    write_json(payload_path, payload)
    outer = scope(payload_path, cpu_pair, environment, phase)
    (folder / f"{phase}-scope.log").write_text(outer.stdout + outer.stderr)
    if not target.exists():
        write_json(target, {"status": f"{phase}_failed", "reason": "scope failed before producing a result",
                            "scope_returncode": outer.returncode, "environment_sha256": env_hash,
                            "manifest_sha256": manifest_hash,
                            "prefix_sha256": prefix_hash})
    result = read_json(target)
    result["scope_returncode"] = outer.returncode
    result["scope_log_sha256"] = sha256(folder / f"{phase}-scope.log")
    if outer.returncode and result["status"] == "ok":
        result.update(status="scope_failed", reason=f"scope exited {outer.returncode}")
        result.pop("source_build_seconds", None)
    if phase == "prepare" and result["status"] == "ok":
        result["prepared_source_sha256"] = tree_sha256(root / "source" / id)
        result["dependency_cache_sha256"] = tree_sha256(cache_root)
    write_json(target, result)
    print(f"{id}: {result['status']}")
    return result["status"] == "ok"


def limits():
    cgroup_root = Path("/sys/fs/cgroup")
    cgroup = cgroup_root / Path(Path("/proc/self/cgroup").read_text().split("::", 1)[1].strip().lstrip("/"))
    quota, period = (cgroup / "cpu.max").read_text().split()
    memory = (cgroup / "memory.max").read_text().strip()
    affinity = sorted(os.sched_getaffinity(0))
    valid = quota != "max" and memory != "max" and int(quota) == int(period) * 2
    valid = valid and int(memory) == MEMORY_LIMIT and len(affinity) == 2
    parent_cpu = []
    parent_memory = []
    for parent in cgroup.parents:
        if parent == cgroup_root or not parent.is_relative_to(cgroup_root):
            break
        parent_quota, parent_period = (parent / "cpu.max").read_text().split()
        parent_limit = (parent / "memory.max").read_text().strip()
        if parent_quota != "max":
            parent_cpu.append((int(parent_quota), int(parent_period)))
            valid = valid and int(parent_quota) >= 2 * int(parent_period)
        if parent_limit != "max":
            parent_memory.append(int(parent_limit))
            valid = valid and int(parent_limit) >= MEMORY_LIMIT
    return {"cpu_max": f"{quota} {period}", "memory_max_bytes": memory,
            "affinity_cpus": affinity, "parent_cpu_quotas": [f"{q} {p}" for q, p in parent_cpu],
            "parent_memory_limits_bytes": parent_memory, "verified": valid}


def toolchains(environment, source, build, app_id):
    versions = {}
    commands = dict(TOOLS)
    if app_id in RUST_APPS:
        commands["rustc"] = [environment["RUSTC"], "--version"]
        commands["cargo"] = [str(Path(environment["RUSTC"]).with_name("cargo")), "--version"]
    for key, name in (("CC", "cc"), ("CXX", "cxx")):
        if environment.get(key):
            commands[name] = [*shlex.split(environment[key]), "--version"]
    for name, command in commands.items():
        if name in {"cargo", "rustc"} and app_id not in RUST_APPS:
            continue
        if name == "dotnet" and app_id != "gloop":
            continue
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=10,
                                    cwd=source, env=environment)
            versions[name] = {
                "command": command,
                "path": shutil.which(command[0], path=environment.get("PATH")),
                "version": (result.stdout or result.stderr).splitlines()[0] if result.returncode == 0 else None,
            }
        except (FileNotFoundError, IndexError, subprocess.TimeoutExpired):
            versions[name] = None
    if app_id in RUST_APPS:
        try:
            selected = subprocess.run([environment["RUSTC"], "--print", "sysroot"], capture_output=True,
                                      text=True, timeout=10, cwd=source, env=environment)
            sysroot = Path(selected.stdout.strip()).resolve() if selected.returncode == 0 else None
        except (FileNotFoundError, subprocess.TimeoutExpired):
            sysroot = None
        rustup_home = Path(environment["RUSTUP_HOME"]).resolve()
        for name in ("rustc", "cargo"):
            executable = (sysroot / "bin" / name).resolve() if sysroot else None
            versions[f"selected_{name}"] = None if executable is None else {
                "path": str(executable),
                "sha256": sha256(executable) if executable and executable.is_file() else None,
                "inside_rustup_home": executable.is_relative_to(rustup_home),
            }
    cache = Path(build) / "CMakeCache.txt"
    if cache.exists():
        for line in cache.read_text(errors="replace").splitlines():
            for key in ("CMAKE_C_COMPILER", "CMAKE_CXX_COMPILER"):
                if line.startswith(key + ":FILEPATH="):
                    compiler = Path(line.split("=", 1)[1])
                    versions[key] = {"path": str(compiler),
                                     "sha256": sha256(compiler) if compiler.is_file() else None}
    return versions


def find_executable(roots, name):
    for root in map(Path, roots):
        for directory, _, files in os.walk(root):
            if name not in files:
                continue
            path = Path(directory) / name
            if path.is_file() and os.access(path, os.X_OK):
                with path.open("rb") as stream:
                    if stream.read(4) == b"\x7fELF":
                        return path
    return None


def internal(payload_path):
    payload = read_json(payload_path)
    log = Path(payload["log"])
    environment = os.environ.copy()
    environment.update(payload["app_environment"])
    result = {"status": "ok", "environment_sha256": payload["environment_sha256"],
              "app_environment": payload["app_environment"],
              "prefix_sha256": payload["prefix_sha256"],
              "manifest_sha256": payload["manifest_sha256"],
              "limits": limits(), "toolchains": toolchains(environment, payload["search_roots"][0],
                                                         payload["search_roots"][1], payload["id"])}
    rust_versions = result["toolchains"]
    rust_selected = [rust_versions.get(name) for name in ("selected_rustc", "selected_cargo")]
    rust_valid = all(item and item["inside_rustup_home"] and item["sha256"] for item in rust_selected)
    if payload["id"] in RUST_APPS:
        if rust_valid:
            rust_steps = payload["steps"] if payload["phase"] == "prepare" else [payload["build"]]
            rust_valid = (Path(environment["RUSTC"]).resolve() == Path(rust_selected[0]["path"])
                          and all(Path(step["argv"][0]).resolve() == Path(rust_selected[1]["path"])
                                  for step in rust_steps))
        rustc_version = (rust_versions.get("rustc") or {}).get("version") or ""
        rust_valid = rust_valid and rustc_version.startswith(
            f"rustc {payload['expected_rustc_version']} ")
        expected = payload["expected_rust_toolchains"]
        if expected:
            rust_valid = rust_valid and all(
                rust_versions[name] == expected[name] for name in ("selected_rustc", "selected_cargo"))
    if hash_environment(environment) != payload["environment_sha256"]:
        result.update(status="environment_failed", reason="effective environment differs from recorded environment")
    elif not result["limits"]["verified"]:
        result.update(status="limit_failed", reason="CPU, memory, or affinity limit differs from method")
    elif payload["id"] in RUST_APPS and not rust_valid:
        result.update(status="toolchain_failed", reason="selected Rust toolchain differs from pinned prefix")
    if result["status"] == "ok":
        steps = payload["steps"] if payload["phase"] == "prepare" else [payload["build"]]
        with log.open("w") as stream:
            for step in steps:
                print(json.dumps(step), file=stream, flush=True)
                if payload["phase"] == "measure":
                    result["dependency_cache_sha256"] = tree_sha256(Path(payload["dependency_cache_root"]))
                    if result["dependency_cache_sha256"] != payload["expected_dependency_cache_sha256"]:
                        result.update(status="cache_changed", reason="dependency cache changed before timed command")
                        break
                start = time.perf_counter_ns()
                try:
                    completed = subprocess.run(step["argv"], cwd=step["cwd"],
                                               env=environment, stdout=stream, stderr=subprocess.STDOUT)
                    returncode = completed.returncode
                except OSError as error:
                    print(str(error), file=stream, flush=True)
                    returncode = 127
                elapsed = (time.perf_counter_ns() - start) / 1e9
                if returncode:
                    result.update(status=f"{payload['phase']}_failed", reason=f"command exited {returncode}",
                                  failed_command=step["argv"], attempt_elapsed_seconds=elapsed)
                    break
                if payload["phase"] == "measure":
                    result["attempt_elapsed_seconds"] = elapsed
                    executable = find_executable(payload["search_roots"], payload["expected_executable"])
                    if executable is None:
                        result.update(status="build_failed", reason="expected ELF executable missing")
                    else:
                        result["source_build_seconds"] = elapsed
                        result["built_executable_sha256"] = sha256(executable)
                        result["built_executable_bytes"] = executable.stat().st_size
    if payload["phase"] == "measure" and "attempt_elapsed_seconds" in result:
        result["dependency_cache_after_sha256"] = tree_sha256(Path(payload["dependency_cache_root"]))
        result["dependency_cache_changed_during_build"] = (
            result["dependency_cache_after_sha256"] != result["dependency_cache_sha256"])
    if not log.exists():
        log.touch()
    result["log_sha256"] = sha256(log)
    write_json(Path(payload["result"]), result)


def public_reason(reason):
    if reason is None:
        return None
    if reason.startswith("command exited") or reason in {
        "expected ELF executable missing", "CPU, memory, or affinity limit differs from method"
    }:
        return reason
    return "runner or prerequisite failed; inspect retained logs"


def public_toolchains(versions):
    if versions is None:
        return None
    return {name: None if value is None else {
        "executable": Path(value.get("path") or value["command"][0]).name,
        "version": value.get("version"),
        "sha256": value.get("sha256"),
    } for name, value in versions.items()}


def public_results(root, manifest, manifest_hash):
    builds = []
    for app in manifest["apps"]:
        folder = root / "records" / app["id"]
        fetch_path = folder / "fetch.json"
        prepare_path = folder / "prepare.json"
        measure_path = folder / "measure.json"
        fetch_record = read_json(fetch_path) if fetch_path.exists() else {}
        prepare_record = read_json(prepare_path) if prepare_path.exists() else {}
        measure_record = read_json(measure_path) if measure_path.exists() else {}
        if measure_path.exists():
            status = measure_record.get("status", "measure_failed")
            seconds = measure_record.get("source_build_seconds")
            executable_bytes = measure_record.get("built_executable_bytes")
            scope_returncode = measure_record.get("scope_returncode")
            measured_limits = measure_record.get("limits")
            measured_tools = measure_record.get("toolchains") or {}
            prepared_tools = prepare_record.get("toolchains") or {}
            rust_proof = app["id"] not in RUST_APPS or all(
                isinstance(measured_tools.get(name), dict)
                and measured_tools[name].get("inside_rustup_home") is True
                and measured_tools[name].get("sha256")
                and measured_tools[name] == prepared_tools.get(name)
                for name in ("selected_rustc", "selected_cargo"))
            if status == "ok" and not (
                    type(seconds) in (int, float) and seconds >= 0
                    and measure_record.get("built_executable_sha256")
                    and type(executable_bytes) is int and executable_bytes > 0
                    and type(scope_returncode) is int and scope_returncode == 0
                    and measure_record.get("scope_log_sha256")
                    and measure_record.get("dependency_cache_sha256")
                    and measure_record["dependency_cache_sha256"] == prepare_record.get("dependency_cache_sha256")
                    and rust_proof
                    and isinstance(measured_limits, dict) and measured_limits.get("verified") is True):
                status = "invalid_measurement"
        elif prepare_path.exists():
            status = "prepared" if prepare_record.get("status") == "ok" else prepare_record.get("status", "prepare_failed")
        elif fetch_path.exists():
            status = "source_fetched" if fetch_record.get("status") == "ok" else fetch_record.get("status", "fetch_failed")
        else:
            status = "not_run"
        record_manifest = measure_record.get("manifest_sha256", prepare_record.get("manifest_sha256", fetch_record.get("manifest_sha256")))
        if record_manifest and record_manifest != manifest_hash:
            status = "manifest_mismatch"
        builds.append({
            "id": app["id"], "tested_version": app["tested_version"],
            "source_url": app["source_url"], "source_ref": app["source_ref"],
            "source_commit": app.get("source_commit"),
            "source_archive_sha256": fetch_record.get("source_archive_sha256"),
            "omitted_archive_members": fetch_record.get("omitted_archive_members", []),
            "manifest_sha256": record_manifest,
            "extracted_source_sha256": fetch_record.get("extracted_source_sha256"),
            "prepared_source_sha256": prepare_record.get("prepared_source_sha256"),
            "prefix_sha256": measure_record.get("prefix_sha256", prepare_record.get("prefix_sha256")),
            "dependency_cache_sha256": measure_record.get("dependency_cache_sha256", prepare_record.get("dependency_cache_sha256")),
            "dependency_cache_after_sha256": measure_record.get("dependency_cache_after_sha256"),
            "dependency_cache_changed_during_build": measure_record.get("dependency_cache_changed_during_build"),
            "environment_sha256": measure_record.get("environment_sha256", prepare_record.get("environment_sha256")),
            "status": status,
            "source_build_seconds": measure_record.get("source_build_seconds") if status == "ok" else None,
            "attempt_elapsed_seconds": measure_record.get("attempt_elapsed_seconds") if status != "ok" else None,
            "command": app["build"]["argv"], "scope": app["scope"],
            "app_environment": app.get("environment", {}),
            "rustup_channel": app.get("rustup_channel"),
            "built_executable_sha256": measure_record.get("built_executable_sha256"),
            "built_executable_bytes": measure_record.get("built_executable_bytes"),
            "toolchains": public_toolchains(measure_record.get("toolchains", prepare_record.get("toolchains"))),
            "limits": measure_record.get("limits", prepare_record.get("limits")),
            "failure_reason": "manifest changed after measurement" if status == "manifest_mismatch" else (
                "incomplete measured success record" if status == "invalid_measurement" else
                public_reason(measure_record.get("reason", prepare_record.get("reason", fetch_record.get("reason"))))),
            "prepare_log_sha256": prepare_record.get("log_sha256"),
            "build_log_sha256": measure_record.get("log_sha256"),
        })
    return {"schema_version": 1, "manifest_sha256": manifest_hash,
            "method": manifest["method"], "builds": builds}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("plan", "fetch", "prepare", "measure", "results", "internal"))
    parser.add_argument("payload", nargs="?")
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--id", action="append")
    parser.add_argument("--env-json", type=Path)
    parser.add_argument("--prefix-root", type=Path)
    parser.add_argument("--runtime-complete", action="store_true")
    args = parser.parse_args()
    if args.action == "internal":
        internal(Path(args.payload))
        return
    manifest = read_json(MANIFEST)
    manifest_hash = sha256(MANIFEST)
    apps = selected_apps(manifest, args.id)
    root = args.root.resolve()
    if not root.is_relative_to(REPO / "artifacts"):
        raise ValueError("build root must remain inside ignored artifacts/")
    if args.action == "plan":
        for app in apps:
            print(f"{app['id']}: {app['source_ref']} {app['source_url']} {app['build']['argv']}")
        return
    if args.action == "results":
        print(json.dumps(public_results(root, manifest, manifest_hash), indent=2))
        return
    if not args.runtime_complete:
        raise RuntimeError("fetch, prepare, and measure require --runtime-complete")
    if args.action == "fetch":
        failed = False
        for app in apps:
            try:
                fetch(root, app, manifest_hash)
                print(f"{app['id']}: source archived and hashed")
            except Exception as error:
                failed = True
                record = root / "records" / app["id"] / "fetch.json"
                if not record.exists():
                    write_json(record, {"status": "fetch_failed", "source_url": app["source_url"],
                                        "reason": str(error)})
                print(f"{app['id']}: fetch_failed: {error}", file=sys.stderr)
        if failed:
            sys.exit(1)
        return
    environment = environment_from(args.env_json)
    prefix = args.prefix_root.resolve() if args.prefix_root else None
    if prefix and (not prefix.is_relative_to(REPO / "artifacts") or not prefix.is_dir()):
        raise ValueError("prefix root must be an existing directory inside ignored artifacts/")
    if prefix and (prefix.is_relative_to(root) or root.is_relative_to(prefix)):
        raise ValueError("prefix root must be separate from the per-app build and cache root")
    apps = [resolved_app(app, prefix) for app in apps]
    prefix_hash = tree_sha256(prefix) if prefix else None
    failed = False
    for app in apps:
        app_environment = environment
        try:
            app_environment, cache_root = cache_environment(root, app, environment, prefix)
            failed = not host_phase(root, app, args.action, app_environment, cache_root,
                                    prefix_hash, manifest_hash) or failed
        except Exception as error:
            failed = True
            record = root / "records" / app["id"] / f"{args.action}.json"
            if not record.exists():
                write_json(record, {"status": f"{args.action}_failed", "reason": str(error),
                                    "environment_sha256": environment_hash(app_environment, app),
                                    "prefix_sha256": prefix_hash, "manifest_sha256": manifest_hash})
            print(f"{app['id']}: {args.action}_failed: {error}", file=sys.stderr)
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
