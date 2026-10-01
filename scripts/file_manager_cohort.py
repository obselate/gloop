#!/usr/bin/env python3
"""Measure isolated file-manager launches on a private Wayland compositor."""

import argparse
from collections import deque
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import random
import re
import shutil
import statistics
import subprocess
import sys
import threading
import time
import xml.etree.ElementTree as ET


SCENARIOS = {
    "list100": ("100", "list"),
    "list100000": ("100000", "list"),
    "tiles100000": ("100000", "tiles"),
    "preview3png": ("3", "preview"),
}
METRICS = ("first_buffer_ms", "cpu_first_3s_ms", "rss_mib", "pss_mib",
           "gpu_mib", "peak_rss_mib", "main_process_vmhwm_mib", "scope_peak_rss_mib",
           "cpu_3_to_5_percent", "idle_cpu_percent")
INFRASTRUCTURE = {"dbus-daemon", "dbus-run-session"}


def digest(path):
    sha = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            sha.update(block)
    return sha.hexdigest()


def fixture_inventory(root):
    inventory = {}
    for folder in ("100", "100000", "3"):
        directory = root / folder
        items = sorted(os.scandir(directory), key=lambda item: item.name)
        sha = hashlib.sha256()
        total = 0
        nonempty = {}
        for item in items:
            if not item.is_file(follow_symlinks=False):
                raise RuntimeError(f"fixture contains a non-file: {item.path}")
            size = item.stat(follow_symlinks=False).st_size
            content_hash = digest(Path(item.path)) if size else None
            sha.update(json.dumps([item.name, size, content_hash], ensure_ascii=False).encode() + b"\n")
            total += size
            if content_hash:
                nonempty[item.name] = content_hash
        inventory[folder] = {"count": len(items), "bytes": total,
                             "sha256": sha.hexdigest(), "nonempty_sha256": nonempty}
    return inventory


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def host_packages():
    for name, command in (("pacman", ["pacman", "-Q"]),
                          ("dpkg", ["dpkg-query", "-W", "-f=${Package} ${Version}\\n"])):
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=30)
        except FileNotFoundError:
            continue
        if result.returncode == 0:
            return name, result.stdout
    raise RuntimeError("host package inventory unavailable")


def substitute(value, variables):
    return value.format_map(variables) if isinstance(value, str) else value


def worker(payload_path):
    payload = json.loads(payload_path.read_text())
    ready = Path(payload["ready"])
    go = Path(payload["go"])
    stop = Path(payload["stop"])
    for command in payload.get("setup", []):
        result = subprocess.run(command, env=os.environ, capture_output=True, text=True, timeout=15)
        if result.returncode:
            print("BENCH_SETUP_ERROR " + json.dumps({"command": command, "stderr": result.stderr}), flush=True)
            return 2
    portal = subprocess.run(["gdbus", "introspect", "--session", "--dest",
                             "org.freedesktop.portal.Desktop", "--object-path",
                             "/org/freedesktop/portal/desktop"], env=os.environ,
                            capture_output=True, text=True, timeout=12)
    if portal.returncode:
        print("BENCH_SETUP_ERROR " + json.dumps({"service": "desktop portal",
                                                 "stderr": portal.stderr[-1000:]}), flush=True)
        return 2
    time.sleep(.2)
    ready.touch()
    while not go.exists():
        time.sleep(.002)
    print("BENCH_START " + str(time.monotonic_ns()), flush=True)
    command = payload["command"]
    app_env = os.environ.copy()
    app_env["WAYLAND_DEBUG"] = "client"
    child = subprocess.Popen(command, env=app_env, stdout=subprocess.DEVNULL)
    reported_exit = False
    while not stop.exists():
        if not reported_exit and child.poll() is not None:
            print("BENCH_APP_EXIT " + json.dumps({"pid": child.pid, "returncode": child.returncode,
                                                  "monotonic_ns": time.monotonic_ns()}), flush=True)
            reported_exit = True
        time.sleep(.02)
    return 0


def supervisor_environment():
    env = os.environ.copy()
    env["DBUS_SESSION_BUS_ADDRESS"] = f"unix:path=/run/user/{os.getuid()}/bus"
    return env


class WaylandTrace:
    def __init__(self):
        self.created_surfaces = set()
        self.surfaces = {}
        self.toplevel = {}
        self.app_ids = {}
        self.titles = {}
        self.first_buffers = {}
        self.registry_requests = 0
        self.ambiguous_object_ids = False
        self.evidence = []

    def feed(self, line, received_ns):
        if re.search(r"wl_display[@#]\d+\.get_registry\(", line):
            self.registry_requests += 1
        relevant = any(marker in line for marker in (".get_registry(", ".create_surface(",
                                                    "get_xdg_surface(", ".get_toplevel(",
                                                    ".set_app_id(", ".set_title(", ".attach("))
        if relevant and len(self.evidence) < 100:
            self.evidence.append({"received_monotonic_ns": received_ns, "line": line.strip()})
        match = re.search(r"wl_compositor[@#]\d+\.create_surface\(new id wl_surface[@#](\d+)\)", line)
        if match:
            if match.group(1) in self.created_surfaces:
                self.ambiguous_object_ids = True
            self.created_surfaces.add(match.group(1))
        match = re.search(r"get_xdg_surface\(new id xdg_surface[@#](\d+), wl_surface[@#](\d+)\)", line)
        if match:
            if match.group(1) in self.surfaces or match.group(2) in self.surfaces.values():
                self.ambiguous_object_ids = True
            self.surfaces[match.group(1)] = match.group(2)
        match = re.search(r"xdg_surface[@#](\d+)\.get_toplevel\(new id xdg_toplevel[@#](\d+)\)", line)
        if match and match.group(1) in self.surfaces:
            surface = self.surfaces[match.group(1)]
            if match.group(2) in self.toplevel or surface in self.toplevel.values():
                self.ambiguous_object_ids = True
            self.toplevel[match.group(2)] = surface
        match = re.search(r'xdg_toplevel[@#](\d+)\.set_app_id\("([^\"]*)"\)', line)
        if match:
            self.app_ids[match.group(1)] = match.group(2)
        match = re.search(r'xdg_toplevel[@#](\d+)\.set_title\("([^\"]*)"\)', line)
        if match:
            self.titles.setdefault(match.group(1), []).append(match.group(2))
        match = re.search(r"wl_surface[@#](\d+)\.attach\(wl_buffer[@#]", line)
        if match and match.group(1) in self.toplevel.values():
            self.first_buffers.setdefault(match.group(1), received_ns)

    def matched_first_buffer(self, window):
        if self.ambiguous_object_ids or not window:
            return None, "ambiguous Wayland object mapping"
        app_id = window.get("desktopFile") or window.get("resourceClass")
        matches = [(top, surface) for top, surface in self.toplevel.items()
                   if self.app_ids.get(top) == app_id and surface in self.first_buffers]
        if len(matches) != 1:
            return None, f"expected one traced toplevel matching captured app ID {app_id!r}; found {len(matches)}"
        return self.first_buffers[matches[0][1]], None


def scope_path(unit):
    show = subprocess.run(["systemctl", "--user", "show", unit, "--property=ControlGroup", "--value"],
                          capture_output=True, text=True, timeout=3, env=supervisor_environment())
    if show.returncode or not show.stdout.strip():
        return None
    path = Path("/sys/fs/cgroup") / show.stdout.strip().lstrip("/")
    return path if path.exists() else None


def scope_pids(scope):
    try:
        return sorted({int(pid) for file in scope.rglob("cgroup.procs") for pid in file.read_text().split()})
    except FileNotFoundError:
        return []


def cpu_usec(scope):
    match = re.search(r"^usage_usec (\d+)$", (scope / "cpu.stat").read_text(), re.M)
    if not match:
        raise RuntimeError("cgroup CPU accounting unavailable")
    return int(match.group(1))


def proc_sample(pid):
    proc = Path("/proc") / str(pid)
    try:
        exe = (proc / "exe").resolve(strict=True)
        cmdline = (proc / "cmdline").read_bytes().replace(b"\0", b" ").decode(errors="replace").strip()
        if exe.name in INFRASTRUCTURE or "--worker" in cmdline and "file_manager_cohort.py" in cmdline:
            return None
        status = (proc / "status").read_text()
        peak = re.search(r"^VmHWM:\s+(\d+) kB", status, re.M)
        rollup = (proc / "smaps_rollup").read_text()
        memory = {name: int(value) for name, value in
                  re.findall(r"^(Rss|Pss):\s+(\d+) kB", rollup, re.M)}
        return {"pid": pid, "exe": str(exe), "cmdline": cmdline,
                "rss_kib": memory.get("Rss"), "pss_kib": memory.get("Pss"),
                "vmhwm_kib": int(peak.group(1)) if peak else None}
    except (FileNotFoundError, ProcessLookupError, PermissionError):
        return None


def proc_identity(pid):
    proc = Path("/proc") / str(pid)
    try:
        fields = (proc / "stat").read_text().rpartition(")")[2].split()
        return {"pid": pid, "exe": str((proc / "exe").resolve(strict=True)),
                "comm": (proc / "comm").read_text().strip(),
                "starttime_ticks": int(fields[19])}
    except (FileNotFoundError, ProcessLookupError, PermissionError):
        return {"pid": pid, "missing": True}


def process_snapshot(scope, exclude_pids=()):
    samples = [sample for pid in scope_pids(scope) if pid not in exclude_pids
               and (sample := proc_sample(pid)) is not None]
    if any(sample["rss_kib"] is None or sample["pss_kib"] is None for sample in samples):
        raise RuntimeError("process smaps_rollup lacks RSS or PSS")
    return samples


def process_ticks(pid):
    try:
        fields = Path(f"/proc/{pid}/stat").read_text().rpartition(")")[2].split()
        return int(fields[11]) + int(fields[12])
    except (FileNotFoundError, ProcessLookupError, IndexError):
        return None


def baseline_ticks(pids):
    return {pid: ticks for pid in pids if (ticks := process_ticks(pid)) is not None}


def accounted_usec(scope, baseline):
    current = baseline_ticks(baseline)
    scope_usage = cpu_usec(scope)
    missing = sorted(set(baseline) - set(current))
    overhead = sum(current[pid] - baseline[pid] for pid in current) if not missing else None
    return {"scope_usec": scope_usage, "infrastructure_ticks": overhead,
            "infrastructure_exited_pids": missing,
            "application_usec": scope_usage - overhead * 1000000 / os.sysconf("SC_CLK_TCK")
            if overhead is not None else None}


def gpu_processes():
    result = subprocess.run(["nvidia-smi", "-q", "-x"], capture_output=True, text=True, timeout=5)
    if result.returncode:
        return None, result.stderr.strip()
    root = ET.fromstring(result.stdout)
    values = {}
    for process in root.findall(".//process_info"):
        pid = process.findtext("pid")
        used = process.findtext("used_memory", "")
        match = re.match(r"(\d+) MiB", used)
        if pid and match:
            values[int(pid)] = values.get(int(pid), 0) + int(match.group(1))
    return values, None


def resolve_monitored(monitored_pids, monitored_comms):
    matches = set(monitored_pids)
    if monitored_comms:
        for entry in Path("/proc").iterdir():
            if not entry.name.isdigit():
                continue
            try:
                if (entry / "comm").read_text().strip() in monitored_comms:
                    matches.add(int(entry.name))
            except (FileNotFoundError, ProcessLookupError, PermissionError):
                continue
    return matches


def private_compositor_pids():
    root = os.environ.get("GLOOP_BENCH_SESSION_ROOT")
    if not root:
        return set()
    try:
        kwin_pid = int(json.loads((Path(root) / "session.json").read_text())["kwin_pid"])
    except (FileNotFoundError, ValueError, KeyError):
        return set()
    found = set()
    pending = [kwin_pid]
    while pending:
        pid = pending.pop()
        if pid in found:
            continue
        found.add(pid)
        try:
            pending.extend(int(child) for child in
                           Path(f"/proc/{pid}/task/{pid}/children").read_text().split())
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            continue
    return found


def external_gpu_processes(scope, owned_seen):
    owned_seen.update(scope_pids(scope))
    gpu, error = gpu_processes()
    if error or gpu is None:
        raise RuntimeError("host GPU process identity unavailable: " + str(error))
    owned_seen.update(scope_pids(scope))
    owned = owned_seen | private_compositor_pids()
    return {pid: {"gpu_mib": used, "identity": proc_identity(pid)}
            for pid, used in gpu.items() if pid not in owned}


def host_snapshot(monitored_pids, monitored_comms=(), scope=None, owned_seen=None):
    result = subprocess.run(["nvidia-smi", "--query-gpu=utilization.gpu,memory.free",
                             "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=5)
    if result.returncode:
        raise RuntimeError("host GPU monitor failed: " + result.stderr[-500:])
    lines = result.stdout.strip().splitlines()
    if len(lines) != 1:
        raise RuntimeError("benchmark expects exactly one NVIDIA GPU")
    utilization, free = (int(value.strip()) for value in lines[0].split(","))
    current_pids = resolve_monitored(monitored_pids, monitored_comms)
    return {"monotonic_ns": time.monotonic_ns(), "gpu_utilization_percent": utilization,
            "gpu_free_mib": free, "monitored_cpu_ticks": baseline_ticks(current_pids),
            "monitored_pids_present": sorted(current_pids),
            "external_gpu_processes": external_gpu_processes(scope, owned_seen) if scope else None}


def pmon_usage(monitored_pids):
    if not monitored_pids:
        return {}
    result = subprocess.run(["nvidia-smi", "pmon", "-c", "1", "-s", "u"],
                            capture_output=True, text=True, timeout=5)
    if result.returncode:
        raise RuntimeError("host GPU process monitor failed: " + result.stderr[-500:])
    usage = {}
    for line in result.stdout.splitlines():
        parts = line.split()
        if len(parts) >= 4 and parts[1].isdigit() and int(parts[1]) in monitored_pids:
            usage[int(parts[1])] = int(parts[3]) if parts[3].isdigit() else None
    return usage


class QuietTimeout(RuntimeError):
    def __init__(self, message, readings):
        super().__init__(message)
        self.readings = readings


def wait_for_quiet(monitored_pids, monitored_comms, min_free_mib, max_gpu_util,
                   required_seconds, timeout_seconds):
    if not monitored_pids and not monitored_comms:
        reading = host_snapshot((), ())
        if reading["gpu_free_mib"] < min_free_mib or reading["gpu_utilization_percent"] > max_gpu_util:
            raise QuietTimeout("host GPU exceeds prelaunch baseline cap", [reading])
        return {"waited_s": 0, "readings": [reading], "required_quiet_s": 0}
    start = time.monotonic()
    previous = host_snapshot(monitored_pids, monitored_comms)
    readings = [previous]
    quiet = 0
    while quiet < required_seconds:
        if time.monotonic() - start > timeout_seconds:
            raise QuietTimeout("external monitored workload did not become quiet before timeout", readings)
        time.sleep(1)
        current = host_snapshot(monitored_pids, monitored_comms)
        active_pids = set(current["monitored_pids_present"]) | set(previous["monitored_pids_present"])
        sm = pmon_usage(active_pids)
        current["monitored_gpu_sm_percent"] = sm
        readings.append(current)
        busy_cpu = any(
            (pid not in current["monitored_cpu_ticks"] or pid not in previous["monitored_cpu_ticks"] or
             current["monitored_cpu_ticks"][pid] - previous["monitored_cpu_ticks"][pid] > 5)
            for pid in active_pids if pid in current["monitored_cpu_ticks"] or
            pid in previous["monitored_cpu_ticks"])
        busy_gpu = (current["gpu_utilization_percent"] > max_gpu_util or
                    any(value is None or value > 5 for value in sm.values()))
        quiet = quiet + 1 if not busy_cpu and not busy_gpu and current["gpu_free_mib"] >= min_free_mib else 0
        previous = current
    return {"waited_s": round(time.monotonic() - start, 2), "readings": readings,
            "required_quiet_s": required_seconds}


class HostMonitor:
    def __init__(self, pids, comms, min_free_mib, scope):
        self.pids = tuple(pids)
        self.comms = tuple(comms)
        self.min_free_mib = min_free_mib
        self.scope = scope
        self.owned_seen = set()
        self.readings = []
        self.errors = []
        self.finished = threading.Event()
        self.worker = None
        self.pmon = None

    def start(self):
        first = host_snapshot(self.pids, self.comms, self.scope, self.owned_seen)
        if first["gpu_free_mib"] < self.min_free_mib:
            raise RuntimeError(f"only {first['gpu_free_mib']} MiB GPU memory free; need {self.min_free_mib}")
        self.readings.append(first)
        if self.pids or self.comms:
            self.pmon = subprocess.Popen(["nvidia-smi", "pmon", "-c", "5", "-s", "u"],
                                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

        def collect():
            next_sample = time.monotonic() + 1
            while not self.finished.wait(max(0, next_sample - time.monotonic())):
                try:
                    self.readings.append(host_snapshot(self.pids, self.comms, self.scope, self.owned_seen))
                except Exception as error:
                    self.errors.append(str(error))
                    break
                next_sample += 1

        self.worker = threading.Thread(target=collect, daemon=True)
        self.worker.start()

    def finish(self):
        self.finished.set()
        if self.worker:
            self.worker.join(timeout=12)
            if self.worker.is_alive():
                self.errors.append("host monitor reader did not stop before classification")
        try:
            self.readings.append(host_snapshot(self.pids, self.comms, self.scope, self.owned_seen))
        except Exception as error:
            self.errors.append(str(error))
        readings = list(self.readings)
        pmon_rows = []
        if self.pmon:
            try:
                stdout, stderr = self.pmon.communicate(timeout=2)
                if self.pmon.returncode:
                    self.errors.append("nvidia-smi pmon: " + stderr[-500:])
                for line in stdout.splitlines():
                    parts = line.split()
                    watched = set().union(*(set(reading["monitored_pids_present"])
                                            for reading in readings))
                    if len(parts) >= 4 and parts[1].isdigit() and int(parts[1]) in watched:
                        pmon_rows.append({"pid": int(parts[1]), "sm_percent": parts[3], "line": line})
            except subprocess.TimeoutExpired:
                self.pmon.terminate()
                self.pmon.communicate(timeout=2)
                self.errors.append("nvidia-smi pmon did not finish")
        busy_cpu = False
        for before, after in zip(readings, readings[1:]):
            for pid in set(before["monitored_pids_present"]) | set(after["monitored_pids_present"]):
                prior = before["monitored_cpu_ticks"].get(pid)
                later = after["monitored_cpu_ticks"].get(pid)
                if prior is None and later is None:
                    continue
                if prior is None or later is None or later - prior > 5:
                    busy_cpu = True
        busy_gpu = any(row["sm_percent"].isdigit() and int(row["sm_percent"]) > 5
                       for row in pmon_rows)
        initial_gpu = set(readings[0].get("external_gpu_processes") or {})
        seen_gpu = {}
        for reading in readings:
            seen_gpu.update(reading.get("external_gpu_processes") or {})
        new_external_gpu = sorted(pid for pid in set(seen_gpu) - initial_gpu
                                  if not seen_gpu[pid]["identity"].get("missing"))
        unknown_new_gpu = sorted(pid for pid in set(seen_gpu) - initial_gpu
                                 if seen_gpu[pid]["identity"].get("missing"))
        reason = ("host monitor failed" if self.errors else
                  "monitored external process used CPU/GPU" if busy_cpu or busy_gpu else
                  "new external GPU process appeared" if new_external_gpu else
                  "unattributed GPU process appeared" if unknown_new_gpu else
                  "GPU free memory fell below threshold" if any(
                      item["gpu_free_mib"] < self.min_free_mib for item in readings) else None)
        return {"readings": readings, "pmon_rows": pmon_rows,
                "errors": list(self.errors), "new_external_gpu_pids": new_external_gpu,
                "unknown_new_gpu_pids": unknown_new_gpu,
                "discard_reason": reason}


def capture_kwin(path, compositor_bus, pids):
    import dbus
    import dbus.bus
    from PIL import Image
    bus = dbus.bus.BusConnection(compositor_bus)
    shot = dbus.Interface(bus.get_object("org.kde.KWin.ScreenShot2", "/org/kde/KWin/ScreenShot2"),
                          "org.kde.KWin.ScreenShot2")
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = path.with_suffix(".raw")
    with raw.open("wb") as stream:
        result = shot.CaptureActiveWindow({}, dbus.types.UnixFd(stream.fileno()), signature="a{sv}h")
    kwin = dbus.Interface(bus.get_object("org.kde.KWin", "/KWin"), "org.kde.KWin")
    window = dict(kwin.getWindowInfo(str(result["windowId"]), signature="s"))
    if int(window.get("pid", 0)) not in pids:
        raw.unlink(missing_ok=True)
        raise RuntimeError("active window PID is outside the measured app scope")
    width, height, stride = (int(result[name]) for name in ("width", "height", "stride"))
    if width < 100 or height < 100 or stride != width * 4:
        raw.unlink(missing_ok=True)
        raise RuntimeError("unexpected KWin capture geometry")
    deadline = time.monotonic() + 3
    while raw.stat().st_size != stride * height and time.monotonic() < deadline:
        time.sleep(.02)
    pixels = raw.read_bytes()
    raw.unlink()
    if len(pixels) != stride * height:
        raise RuntimeError("KWin capture is incomplete")
    Image.frombytes("RGBA", (width, height), pixels, "raw", "BGRA").convert("RGB").save(path)
    if path.read_bytes()[:8] != b"\x89PNG\r\n\x1a\n":
        raise RuntimeError("KWin capture is not PNG")
    return {"path": str(path), "sha256": digest(path), "width": width, "height": height,
            "window": {str(k): str(v) for k, v in window.items()}}


def active_window_info(compositor_bus):
    import dbus
    import dbus.bus
    bus = dbus.bus.BusConnection(compositor_bus)
    shot = dbus.Interface(bus.get_object("org.kde.KWin.ScreenShot2", "/org/kde/KWin/ScreenShot2"),
                          "org.kde.KWin.ScreenShot2")
    with open(os.devnull, "wb") as sink:
        result = shot.CaptureActiveWindow({"include-shadow": False},
                                          dbus.types.UnixFd(sink.fileno()), signature="a{sv}h")
    kwin = dbus.Interface(bus.get_object("org.kde.KWin", "/KWin"), "org.kde.KWin")
    window = {str(k): str(v) for k, v in
              dict(kwin.getWindowInfo(str(result["windowId"]), signature="s")).items()}
    window["capture_width"] = int(result["width"])
    window["capture_height"] = int(result["height"])
    return window


def environment(root, app, scenario):
    base = root / "profiles" / app["id"] / scenario
    env = {key: os.environ[key] for key in ("PATH", "LANG", "LC_ALL", "LC_CTYPE", "USER", "LOGNAME",
                                           "SHELL", "XDG_RUNTIME_DIR", "VK_DRIVER_FILES", "VK_ICD_FILENAMES")
           if key in os.environ}
    for name in ("home", "config", "data", "cache", "state"):
        (base / name).mkdir(parents=True, exist_ok=True)
    env.update(HOME=str(base / "home"), XDG_CONFIG_HOME=str(base / "config"),
               XDG_DATA_HOME=str(base / "data"), XDG_CACHE_HOME=str(base / "cache"),
               XDG_STATE_HOME=str(base / "state"), WAYLAND_DISPLAY=os.environ["WAYLAND_DISPLAY"],
               XDG_SESSION_TYPE="wayland", GDK_BACKEND="wayland", QT_QPA_PLATFORM="wayland",
               SDL_VIDEODRIVER="wayland", GOO_DEVTOOLS="0")
    if app.get("backend") == "xwayland":
        env["DISPLAY"] = os.environ["DISPLAY"]
    env.update({key: str(value) for key, value in app.get("env", {}).items()})
    return env, base


def prepare(app, scenario, base, variables):
    setup = app.get("scenarios", {}).get(scenario, {})
    files = dict(setup.get("files", {}))
    if app["id"] == "gloop":
        files.setdefault("config/gloop/setup-complete", "1\n")
        files.setdefault("config/gloop/settings.json", {
            "viewMode": "tiles" if scenario == "tiles100000" else "list",
            "showPreview": scenario == "preview3png",
        })
    for relative, contents in files.items():
        path = (base / relative).resolve()
        if not path.is_relative_to(base.resolve()):
            raise ValueError("profile file escapes its directory")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(contents, indent=2) + "\n" if isinstance(contents, (dict, list))
                        else substitute(contents, variables))
    return [[substitute(str(part), variables) for part in command]
            for command in setup.get("setup", [])]


def profile_hashes(base):
    return {str(file.relative_to(base)): digest(file)
            for name in ("config", "data", "state", "home")
            for file in (base / name).rglob("*") if file.is_file()}


def launch(root, app, scenario, fixture, ordinal, warmup, monitored_pids, monitored_comms,
           min_gpu_free_mib, warmup_extra_seconds):
    env, base = environment(root, app, scenario)
    variables = {"folder": str(fixture), "binary": str(app["binary"]), "profile": str(base),
                 "home": env["HOME"], "empty_folder": env["HOME"],
                 "config": env["XDG_CONFIG_HOME"]}
    setup = prepare(app, scenario, base, variables)
    command = [substitute(str(part), variables) for part in
               app.get("command", ["{binary}", "{folder}"])]
    unit = f"gloop-file-bench-{os.getpid()}-{ordinal}.scope"
    run_dir = root / "control" / str(ordinal)
    run_dir.mkdir(parents=True, exist_ok=False)
    ready, go, stop = run_dir / "ready", run_dir / "go", run_dir / "stop"
    payload = run_dir / "payload.json"
    atomic_json(payload, {"ready": str(ready), "go": str(go), "stop": str(stop),
                          "setup": setup, "command": command})
    invocation = ["systemd-run", "--user", "--scope", "--unit=" + unit,
                  "/usr/bin/env", "-i", *[f"{key}={value}" for key, value in env.items()],
                  "dbus-run-session", "--", sys.executable, str(Path(__file__).resolve()),
                  "--worker", str(payload)]
    trace = WaylandTrace()
    output = deque(maxlen=500)
    start_ns = []
    launcher_exits = []
    process = subprocess.Popen(invocation, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               text=True, bufsize=1, env=supervisor_environment())

    def read_output():
        for line in process.stdout:
            received = time.monotonic_ns()
            if line.startswith("BENCH_START "):
                start_ns.append(int(line.split()[1]))
            elif line.startswith("BENCH_APP_EXIT "):
                launcher_exits.append(json.loads(line.removeprefix("BENCH_APP_EXIT ")))
            else:
                trace.feed(line, received)
                if not line.startswith("["):
                    output.append(line.strip())

    reader = threading.Thread(target=read_output, daemon=True)
    reader.start()
    scope = None
    profile_files_at_launch = None
    host = HostMonitor(monitored_pids, monitored_comms, min_gpu_free_mib, None)
    try:
        deadline = time.monotonic() + 35
        while time.monotonic() < deadline and not ready.exists():
            scope = scope_path(unit)
            if process.poll() is not None:
                raise RuntimeError("launch setup exited: " + " | ".join(list(output)[-10:]))
            time.sleep(.02)
        if not ready.exists() or not scope:
            raise RuntimeError("private bus or cgroup did not become ready")
        host.scope = scope
        host.start()
        infrastructure_pids = set(scope_pids(scope))
        infrastructure = [proc_identity(pid) for pid in sorted(infrastructure_pids)]
        profile_files_at_launch = profile_hashes(base)
        initial_ticks = baseline_ticks(infrastructure_pids)
        initial_cpu = cpu_usec(scope)
        go.touch()
        deadline = time.monotonic() + 3
        while not start_ns and time.monotonic() < deadline:
            time.sleep(.002)
        if not start_ns:
            raise RuntimeError("worker did not launch app")
        begin = start_ns[0]
        samples = []
        sample_errors = []

        def sample_peak():
            next_sample = time.monotonic()
            while (time.monotonic_ns() - begin) / 1e9 < 5:
                try:
                    members = process_snapshot(scope, infrastructure_pids)
                    samples.append({"elapsed_s": round((time.monotonic_ns() - begin) / 1e9, 4),
                                    "pids": [p["pid"] for p in members],
                                    "rss_kib_sum": sum(p["rss_kib"] for p in members),
                                    "vmhwm_kib_sum": sum(p["vmhwm_kib"] or 0 for p in members),
                                    "processes": members})
                except Exception as error:
                    sample_errors.append(str(error))
                    return
                next_sample += .1
                time.sleep(max(0, next_sample - time.monotonic()))

        sampler = threading.Thread(target=sample_peak, daemon=True)
        sampler.start()
        actions = app.get("scenarios", {}).get(scenario, {}).get("post_launch_input", [])
        applied = []
        pre_input_window = None
        pre_input_window_elapsed = None
        if actions:
            from file_manager_input import PrivateKeyboard
            deadline = begin / 1e9 + 2.6
            last_window_error = None
            while time.monotonic() < deadline:
                if trace.first_buffers:
                    try:
                        candidate = active_window_info(os.environ["DBUS_SESSION_BUS_ADDRESS"])
                        owned = int(candidate.get("pid", 0)) in set(scope_pids(scope)) - infrastructure_pids
                        mapped, _ = trace.matched_first_buffer(candidate)
                        sized = all(abs(float(candidate.get(key, 0)) - target) < 1 for key, target in
                                    (("x", 130), ("y", 70), ("width", 1180), ("height", 760)))
                        content_sized = (round(float(candidate["width"])) == int(candidate["capture_width"]) and
                                         0 <= round(float(candidate["height"])) -
                                         int(candidate["capture_height"]) <= 80)
                        if owned and mapped and sized and content_sized:
                            pre_input_window = candidate
                            pre_input_window_elapsed = (time.monotonic_ns() - begin) / 1e9
                            break
                        last_window_error = (f"owned={owned}, mapped={bool(mapped)}, "
                                             f"geometry={candidate.get('x')},{candidate.get('y')},"
                                             f"{candidate.get('width')}x{candidate.get('height')}, "
                                             f"capture={candidate.get('capture_width')}x"
                                             f"{candidate.get('capture_height')}")
                    except Exception as error:
                        last_window_error = str(error)
                time.sleep(.02)
            if pre_input_window is None:
                raise RuntimeError("no owned active Wayland app window before preview input deadline: " +
                                   str(last_window_error))
            keyboard = PrivateKeyboard(os.environ["DBUS_SESSION_BUS_ADDRESS"], os.environ["WAYLAND_DISPLAY"])
            try:
                for action in actions:
                    when = (time.monotonic_ns() - begin) / 1e9
                    if action["action"] == "key":
                        keyboard.chord(action["key"])
                    elif action["action"] == "click":
                        x, y = action["at"]
                        current = active_window_info(os.environ["DBUS_SESSION_BUS_ADDRESS"])
                        if int(current.get("pid", 0)) != int(pre_input_window["pid"]):
                            raise RuntimeError("active window changed before preview click")
                        frame_width = round(float(current["width"]))
                        frame_height = round(float(current["height"]))
                        capture_width = int(current["capture_width"])
                        capture_height = int(current["capture_height"])
                        if frame_width != capture_width:
                            raise RuntimeError("unexpected window content width inset " +
                                               str(frame_width - capture_width))
                        inset_y = frame_height - capture_height
                        if not 0 <= inset_y <= 80:
                            raise RuntimeError(f"unexpected window content inset {inset_y}")
                        if not 0 <= x < capture_width or not 0 <= y < capture_height:
                            raise RuntimeError("preview click is outside window content")
                        screen = [round(float(current["x"])) + x,
                                  round(float(current["y"])) + inset_y + y]
                        keyboard.click(*screen)
                    elif action["action"] == "wait":
                        milliseconds = int(action["ms"])
                        if not 1 <= milliseconds <= 1000:
                            raise ValueError("post-launch input wait must be 1 to 1000 ms")
                        time.sleep(milliseconds / 1000)
                    else:
                        raise ValueError("post_launch_input supports key, click and wait actions")
                    applied.append({"action": action, "screen_at": screen if action["action"] == "click" else None,
                                    "input_capture": {"width": capture_width, "height": capture_height,
                                                      "top_inset": inset_y, "includes_shadow": False}
                                    if action["action"] == "click" else None,
                                    "start_elapsed_s": when,
                                    "end_elapsed_s": (time.monotonic_ns() - begin) / 1e9})
            finally:
                keyboard.close()
            if (time.monotonic_ns() - begin) / 1e9 >= 3:
                raise RuntimeError("input actions did not complete before CPU first-three-second sample")
        cpu_at_3 = None
        cpu_at_5 = None
        while True:
            elapsed = (time.monotonic_ns() - begin) / 1e9
            if elapsed >= 3 and cpu_at_3 is None:
                usage = accounted_usec(scope, initial_ticks)
                cpu_at_3 = {"elapsed_s": (time.monotonic_ns() - begin) / 1e9, **usage}
            if elapsed >= 5:
                usage = accounted_usec(scope, initial_ticks)
                cpu_at_5 = {"elapsed_s": (time.monotonic_ns() - begin) / 1e9, **usage}
                break
            if process.poll() is not None:
                raise RuntimeError("app exited before the five-second sample")
            time.sleep(.01)
        sampler.join(timeout=2)
        if sampler.is_alive() or sample_errors:
            raise RuntimeError("peak sampler failed: " + str(sample_errors))
        memory_start = time.monotonic_ns()
        members = process_snapshot(scope, infrastructure_pids)
        memory_elapsed = (memory_start - begin) / 1e9
        if not members:
            raise RuntimeError("no app processes in scope at memory sample")
        expected = app.get("expected_exe", app["binary"])
        if not any(p["exe"] == str(Path(expected).resolve()) for p in members):
            raise RuntimeError("expected executable absent from owned process tree")
        gpu, gpu_error = gpu_processes()
        gpu_elapsed = (time.monotonic_ns() - begin) / 1e9
        pids = {p["pid"] for p in members}
        capture = None
        capture_error = None
        capture_request_elapsed = (time.monotonic_ns() - begin) / 1e9
        try:
            label = "warmup" if warmup else str(ordinal)
            capture = capture_kwin(root / "captures" / f"{app['id']}-{scenario}-{label}.png",
                                   os.environ["DBUS_SESSION_BUS_ADDRESS"], pids)
        except Exception as error:
            capture_error = str(error)
        capture_reply_elapsed = (time.monotonic_ns() - begin) / 1e9
        background = host.finish()
        late_capture = None
        late_capture_error = None
        late_capture_elapsed = None
        intermediate_capture = None
        intermediate_capture_error = None
        intermediate_capture_elapsed = None
        intermediate_state = None
        late_state = None
        validation_label = "" if warmup else f"-{ordinal}"
        configured_late = float(app.get("late_validation_seconds", {}).get(scenario, 0))
        late_seconds = max(warmup_extra_seconds if warmup else 0, configured_late)
        if late_seconds:
            if late_seconds >= 30:
                time.sleep(15)
                intermediate_capture_elapsed = (time.monotonic_ns() - begin) / 1e9
                try:
                    intermediate_members = process_snapshot(scope, infrastructure_pids)
                    intermediate_state = {"elapsed_s": intermediate_capture_elapsed,
                                          "scope_cpu_usec": cpu_usec(scope),
                                          "processes": intermediate_members}
                    intermediate_capture = capture_kwin(
                        root / "captures" / f"{app['id']}-{scenario}{validation_label}-intermediate.png",
                        os.environ["DBUS_SESSION_BUS_ADDRESS"],
                        {item["pid"] for item in intermediate_members})
                except Exception as error:
                    intermediate_capture_error = str(error)
                time.sleep(late_seconds - 15)
            else:
                time.sleep(late_seconds)
            late_capture_elapsed = (time.monotonic_ns() - begin) / 1e9
            try:
                late_members = process_snapshot(scope, infrastructure_pids)
                late_state = {"elapsed_s": late_capture_elapsed,
                              "scope_cpu_usec": cpu_usec(scope),
                              "processes": late_members}
                live = {item["pid"] for item in late_members}
                late_capture = capture_kwin(
                    root / "captures" / f"{app['id']}-{scenario}{validation_label}-late.png",
                    os.environ["DBUS_SESSION_BUS_ADDRESS"], live)
            except Exception as error:
                late_capture_error = str(error)
        window = capture["window"] if capture else None
        buffer_ns, trace_reason = trace.matched_first_buffer(window)
        gui_window = window or (late_capture["window"] if late_capture else None)
        seen_app_pids = {p["pid"] for p in members}
        seen_app_pids.update(pid for sample in samples for pid in sample["pids"])
        owned_window = bool(gui_window and int(gui_window.get("pid", 0)) in seen_app_pids)
        first = ((buffer_ns - begin) / 1e6 if buffer_ns and window and owned_window else None)
        gui_pid = int(gui_window.get("pid", 0)) if owned_window else None
        gui_process = next((p for p in members if p["pid"] == gui_pid), None)
        gui_executable = gui_process["exe"] if gui_process else None
        peak = max([*(p["vmhwm_kib"] or 0 for p in members if p["pid"] == gui_pid),
                    *(p["vmhwm_kib"] or 0 for sample in samples for p in sample["processes"]
                      if p["pid"] == gui_pid)], default=0)
        scope_peak = max([sum(p["rss_kib"] or 0 for p in members),
                          *(sample["rss_kib_sum"] for sample in samples)])
        scope_hwm_bound = max([sum(p["vmhwm_kib"] or 0 for p in members),
                               *(sample["vmhwm_kib_sum"] for sample in samples)])
        gpu_value = sum(gpu[pid] for pid in pids if pid in gpu) if gpu is not None and any(pid in gpu for pid in pids) else None
        if app.get("backend", "wayland") != "wayland":
            first = None
        reason = None
        if app.get("backend", "wayland") != "wayland":
            reason = "XWayland client has no comparable native Wayland first buffer"
        elif not owned_window:
            reason = "captured window PID was not in the owned application process tree at five seconds"
        elif trace_reason:
            reason = trace_reason
        elif first is None:
            reason = "no native Wayland toplevel buffer observed"
        late_window = bool(not capture and late_capture and owned_window and late_seconds)
        validation_timeout = bool(not capture and not late_capture and late_seconds and late_state and
                                  any(p["exe"] == str(Path(expected).resolve())
                                      for p in late_state["processes"]))
        return {"app": app["id"], "scenario": scenario, "warmup": warmup,
                "ordinal": ordinal, "status": "ok" if capture else "late_window" if late_window else
                "validation_timeout" if validation_timeout else "partial",
                "reason": reason if capture else
                          "No captured window at five seconds; late owned window captured" if late_window else
                          "No captured window by late validation deadline; owned app still running"
                          if validation_timeout else
                          capture_error,
                "manifest_sha256": app["_manifest_sha256"],
                "adapter_sha256": app.get("_adapter_sha256"),
                "binary_sha256": digest(Path(app["binary"])),
                "profile_files_sha256_at_launch": profile_files_at_launch,
                "profile_files_sha256_at_end": profile_hashes(base),
                "launch_command": command, "launch_environment": env,
                "launcher_exits": launcher_exits,
                "timestamps": {"start_monotonic_ns": begin, "cpu_3s": cpu_at_3,
                               "cpu_5s": cpu_at_5, "memory_elapsed_s": memory_elapsed,
                               "gpu_elapsed_s": gpu_elapsed,
                               "capture_request_elapsed_s": capture_request_elapsed,
                               "capture_reply_elapsed_s": capture_reply_elapsed},
                "first_buffer_ms": round(first, 2) if first is not None else None,
                "cpu_first_3s_ms": round((cpu_at_3["scope_usec"] - initial_cpu) / 1000, 2),
                "cpu_first_3s_adjusted_ms": round((cpu_at_3["application_usec"] - initial_cpu) / 1000, 2)
                if cpu_at_3["application_usec"] is not None else None,
                "rss_mib": round(sum(p["rss_kib"] or 0 for p in members) / 1024, 2),
                "pss_mib": round(sum(p["pss_kib"] or 0 for p in members) / 1024, 2),
                "gpu_mib": gpu_value,
                "peak_rss_mib": round(peak / 1024, 2) if peak else None,
                "main_process_vmhwm_mib": round(peak / 1024, 2) if peak else None,
                "gui_process_pid": gui_pid,
                "gui_executable": gui_executable,
                "gui_executable_sha256": digest(Path(gui_executable)) if gui_executable else None,
                "gui_executable_bytes": Path(gui_executable).stat().st_size if gui_executable else None,
                "scope_peak_rss_mib": round(scope_peak / 1024, 2),
                "scope_vmhwm_upper_bound_mib": round(scope_hwm_bound / 1024, 2),
                "idle_cpu_percent": round((cpu_at_5["scope_usec"] - cpu_at_3["scope_usec"])
                                          / ((cpu_at_5["elapsed_s"] - cpu_at_3["elapsed_s"]) * 10000), 2),
                "cpu_3_to_5_percent": round((cpu_at_5["scope_usec"] - cpu_at_3["scope_usec"])
                                              / ((cpu_at_5["elapsed_s"] - cpu_at_3["elapsed_s"]) * 10000), 2),
                "idle_cpu_adjusted_percent": round((cpu_at_5["application_usec"] - cpu_at_3["application_usec"])
                                                  / ((cpu_at_5["elapsed_s"] - cpu_at_3["elapsed_s"]) * 10000), 2)
                if cpu_at_5["application_usec"] is not None and
                   cpu_at_3["application_usec"] is not None else None,
                "processes_at_5s": members, "peak_samples": samples,
                "prewarmed_infrastructure": infrastructure,
                "prewarmed_infrastructure_cpu_ticks_at_start": initial_ticks,
                "scope_cpu_usec_at_start": initial_cpu,
                "post_launch_input": applied,
                "pre_input_window": pre_input_window,
                "pre_input_window_elapsed_s": pre_input_window_elapsed,
                "gpu_by_pid_mib": {pid: gpu[pid] for pid in pids if gpu is not None and pid in gpu},
                "gpu_error": gpu_error, "capture": capture, "capture_error": capture_error,
                "window_at_5s": capture is not None,
                "late_window_validated_by_owned_pid": late_window,
                "late_validation_delay_after_5s": late_seconds,
                "validation_timeout": validation_timeout,
                "late_capture": late_capture, "late_capture_error": late_capture_error,
                "late_capture_elapsed_s": late_capture_elapsed,
                "intermediate_capture": intermediate_capture,
                "intermediate_capture_error": intermediate_capture_error,
                "intermediate_capture_elapsed_s": intermediate_capture_elapsed,
                "intermediate_state": intermediate_state, "late_state": late_state,
                "background": background, "discard_reason": background["discard_reason"],
                "ready_at_5s": None,
                "wayland_trace_registry_requests": trace.registry_requests,
                "wayland_trace_toplevels": trace.toplevel,
                "wayland_trace_app_ids": trace.app_ids,
                "wayland_trace_titles": trace.titles,
                "wayland_trace_ambiguous_object_ids": trace.ambiguous_object_ids,
                "trace_evidence": trace.evidence, "diagnostics": list(output)}
    except Exception as error:
        background = host.finish() if host.worker else None
        try:
            remaining = scope_pids(scope) if scope else []
        except Exception:
            remaining = []
        try:
            events = (scope / "memory.events").read_text() if scope else None
        except Exception:
            events = None
        return {"app": app["id"], "scenario": scenario, "warmup": warmup,
                "ordinal": ordinal, "status": "error", "reason": str(error),
                "recorded_utc": datetime.now(timezone.utc).isoformat(),
                "manifest_sha256": app["_manifest_sha256"],
                "adapter_sha256": app.get("_adapter_sha256"),
                "binary_sha256": digest(Path(app["binary"])),
                "profile_files_sha256_at_launch": profile_files_at_launch,
                "profile_files_sha256_at_failure": profile_hashes(base),
                "command": command, "worker_returncode": process.poll(),
                "launch_environment": env, "launcher_exits": launcher_exits,
                "start_monotonic_ns": start_ns[0] if start_ns else None,
                "scope_remaining_pids": remaining, "scope_memory_events": events,
                "background": background, "diagnostics": list(output),
                "trace_evidence": trace.evidence,
                "wayland_trace_app_ids": trace.app_ids,
                "wayland_trace_toplevels": trace.toplevel}
    finally:
        if host.worker and host.worker.is_alive():
            host.finish()
        stop.touch()
        if scope_path(unit):
            subprocess.run(["systemctl", "--user", "stop", unit], capture_output=True,
                           timeout=5, env=supervisor_environment())
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=3)
        reader.join(timeout=1)


def support_reason(app, scenario, fixture):
    binary = Path(app["binary"])
    if not binary.is_file() or not os.access(binary, os.X_OK):
        return "executable unavailable"
    if not fixture.is_dir():
        return "fixture unavailable"
    if scenario not in app.get("supported_scenarios", []):
        return "scenario adapter unsupported or unvalidated"
    return None


def balanced_orders(apps, seed, scenario):
    items = list(apps)
    random.Random(f"{seed}:{scenario}").shuffle(items)
    count = len(items)
    if count < 2:
        return [items, items, items]
    if count % 2:
        half = (count - 1) // 2
        positions = [list(range(count)), [(index + half) % count for index in range(count)]]
        positions.append([3 * half - positions[0][index] - positions[1][index]
                          for index in range(count)])
    else:
        half = count // 2
        positions = [list(range(count)), [(index + half) % count for index in range(count)]]
        positions.append([3 * half - 2 + int(index >= half) - positions[0][index] -
                          positions[1][index] for index in range(count)])
    if any(sorted(row) != list(range(count)) for row in positions):
        raise RuntimeError("balanced order positions are not permutations")
    sums = [sum(row[index] for row in positions) for index in range(count)]
    expected_sums = ({3 * (count - 1) // 2} if count % 2 else
                     {3 * (count // 2) - 2, 3 * (count // 2) - 1})
    if set(sums) != expected_sums:
        raise RuntimeError("balanced order mean positions are invalid")
    return [[items[index] for index in sorted(range(count), key=lambda item: row[item])]
            for row in positions]


def planned_slots(apps, fixtures, reviews, records, root, selected_apps, selected_scenarios, seed):
    slots = []
    roster = {}
    warmup_gui = {}
    for scenario, (folder, _) in SCENARIOS.items():
        if selected_scenarios and scenario not in selected_scenarios:
            continue
        available = [app for app in apps if scenario in app.get("supported_scenarios", [])
                     and (not selected_apps or app["id"] in selected_apps)]
        unavailable = [f"{app['id']}: {support_reason(app, scenario, fixtures / folder)}"
                       for app in available if support_reason(app, scenario, fixtures / folder)]
        if unavailable:
            raise RuntimeError(f"supported {scenario} entries cannot launch: {', '.join(unavailable)}")
        missing = [app["id"] for app in available if
                   not ((root / "captures" / f"{app['id']}-{scenario}-warmup.png").is_file() or
                        (root / "captures" / f"{app['id']}-{scenario}-late.png").is_file()) or
                   reviews.get("warmups", {}).get(f"{app['id']}/{scenario}") is not True]
        if missing:
            raise RuntimeError(f"supported {scenario} entries lack reviewed configured-target/mode "
                               f"warmups: {', '.join(missing)}")
        for app in available:
            matching = [r for r in records if r.get("app") == app["id"] and
                        r.get("scenario") == scenario and r.get("warmup") is True and
                        r.get("status") in ("ok", "late_window") and not r.get("discard_reason") and
                        (r.get("capture") or r.get("late_capture")) and
                        r.get("binary_sha256") == digest(Path(app["binary"])) and
                        r.get("manifest_sha256") == app["_manifest_sha256"] and
                        r.get("adapter_sha256") == app.get("_adapter_sha256")]
            matching = [r for r in matching if (capture := r.get("capture") or r.get("late_capture")) and
                        capture.get("sha256") == digest(Path(capture["path"]))]
            if not matching or not matching[-1].get("gui_executable_sha256"):
                raise RuntimeError(f"reviewed warmup lacks pinned successful raw GUI evidence: "
                                   f"{app['id']} {scenario}")
            warmup_gui[f"{app['id']}/{scenario}"] = matching[-1]["gui_executable_sha256"]
        roster[scenario] = [app["id"] for app in available]
        for round_number, order in enumerate(balanced_orders(available, seed, scenario)):
            slots.extend({"slot_id": f"{scenario}/{round_number}/{app['id']}",
                          "app": app["id"], "scenario": scenario, "round": round_number}
                         for app in order)
    return roster, slots, warmup_gui


def append_record(stream, records, record):
    stream.write(json.dumps(record) + "\n")
    stream.flush()
    os.fsync(stream.fileno())
    records.append(record)


def next_ordinal(records):
    return 1 + max((record.get("ordinal", -1) for record in records), default=-1)


def summaries(apps, fixtures, records, runs, reviews):
    result = []
    for app in apps:
        for scenario, (folder, _) in SCENARIOS.items():
            relevant = [r for r in records if r["app"] == app["id"] and r["scenario"] == scenario
                        and not r["warmup"]]
            warmups = [r for r in records if r["app"] == app["id"] and r["scenario"] == scenario
                       and r["warmup"]]
            accepted_by_round = {round_number: [r for r in relevant
                                                 if r.get("round") == round_number and r.get("accepted")]
                                 for round_number in range(runs)}
            valid = [matches[0] for matches in accepted_by_round.values() if matches]
            reason = support_reason(app, scenario, fixtures / folder)
            if not reason and any(len(matches) > 1 for matches in accepted_by_round.values()):
                reason = "multiple accepted attempts for one fixed round slot"
            if not reason and len(valid) != runs:
                reason = next((r["reason"] for r in relevant if r["status"] not in ("ok", "deferred")
                               and r.get("discard_reason") != "monitored external process used CPU/GPU"),
                              f"only {len(valid)} of {runs} measured runs")
            if not reason and any(r.get("validation_timeout") for r in valid):
                reason = "one or more owned launches lacked a validated window by the late deadline"
            if not reason and not reviews.get("warmups", {}).get(f"{app['id']}/{scenario}"):
                reason = "warmup view validation pending"
            if not reason and not all(reviews.get("runs", {}).get(str(r["ordinal"]), {}).get("scenario_visible") is True
                                      for r in valid):
                reason = "measured workload view needs review"
            if not reason and len({r.get("gui_executable_sha256") for r in valid}) != 1:
                reason = "GUI executable changed across measured launches"
            population_validation = []
            for record in valid:
                review = reviews.get("runs", {}).get(str(record["ordinal"]), {})
                reviewed_value = review.get("population_validated_by_deadline")
                ready_capture = bool(record.get("capture") and review.get("ready_at_5s") is True)
                late_capture = bool(record.get("late_capture") and record.get("late_state") and
                                    int(record["late_capture"]["window"].get("pid", 0)) in
                                    {item["pid"] for item in record["late_state"]["processes"]})
                evidence = "five_second" if ready_capture else "late" if late_capture else None
                population_validation.append({
                    "ordinal": record["ordinal"], "review_value": reviewed_value,
                    "validated": reviewed_value if reviewed_value is not True or evidence else None,
                    "evidence": evidence,
                    "deadline_elapsed_s": record.get("late_capture_elapsed_s") if late_capture else
                    record.get("timestamps", {}).get("capture_reply_elapsed_s")})
            population_validated = (True if len(population_validation) == runs and
                                    all(item["validated"] is True for item in population_validation)
                                    else False if any(item["validated"] is False
                                                      for item in population_validation) else None)
            if not reason and population_validated is False:
                reason = "folder population or selected image remained incomplete at validation deadline"
            if not reason and any(item["review_value"] is True and not item["evidence"]
                                  for item in population_validation):
                reason = "population review lacks a populated five-second capture or owned late image"
            if not reason and population_validated is None:
                reason = "measured folder population or selected image validation pending"
            readiness = [reviews.get("runs", {}).get(str(r["ordinal"]), {}).get("ready_at_5s")
                         for r in valid]
            ready_at_5s = (False if any(r.get("window_at_5s") is False for r in valid) else
                           True if len(readiness) == runs and all(value is True for value in readiness)
                           else False if any(value is False for value in readiness) else None)
            ready_at_3s = all(reviews.get("runs", {}).get(str(r["ordinal"]), {}).get("ready_at_3s") is True
                              for r in valid) if len(valid) == runs else False
            window_states = []
            for record in valid:
                review = reviews.get("runs", {}).get(str(record["ordinal"]), {})
                if record.get("capture") is None:
                    state = "no_captured_window"
                elif review.get("scenario_visible") is True and review.get("ready_at_5s") is True:
                    state = "populated_window"
                elif review.get("scenario_visible") is True and review.get("ready_at_5s") is False:
                    state = "loading_window"
                else:
                    state = "unreviewed_window"
                window_states.append({"ordinal": record["ordinal"], "state": state})
            window_state_counts = {state: sum(item["state"] == state for item in window_states)
                                   for state in ("no_captured_window", "loading_window",
                                                 "populated_window", "unreviewed_window")}
            item = {"app": app["id"], "name": app.get("name", app["id"]),
                    "scenario": scenario, "executable_bytes": Path(app["binary"]).stat().st_size
                    if Path(app["binary"]).is_file() else None,
                    "executable_sha256": digest(Path(app["binary"]))
                    if Path(app["binary"]).is_file() else None,
                    "gui_executable": valid[0].get("gui_executable") if valid else None,
                    "gui_executable_bytes": valid[0].get("gui_executable_bytes") if valid else None,
                    "gui_executable_sha256": valid[0].get("gui_executable_sha256") if valid else None,
                    "n": len(valid), "valid": len(valid) == runs,
                    "comparable": reason is None, "workload_validated": reason is None,
                    "ready_at_5s": ready_at_5s, "ready_at_3s": ready_at_3s,
                    "window_state_at_5s": window_states[0]["state"] if window_states and
                    all(item["state"] == window_states[0]["state"] for item in window_states)
                    else "mixed" if window_states else None,
                    "population_validated_by_deadline": population_validated,
                    "population_validation": population_validation,
                    "window_states_at_5s": window_states,
                    "window_state_counts_at_5s": window_state_counts,
                    "reason": reason,
                    "warmup_status": warmups[-1]["status"] if warmups else None,
                    "warmup_reason": warmups[-1].get("reason") if warmups else None,
                    "warmup_capture": warmups[-1].get("capture") if warmups else None,
                    "raw_ordinals": [r["ordinal"] for r in relevant],
                    "accepted_ordinals": [r["ordinal"] for r in valid],
                    "excluded_attempts": [{"ordinal": r["ordinal"], "slot_id": r.get("slot_id"),
                                            "reason": r.get("discard_reason") or r.get("reason")}
                                           for r in relevant if not r.get("accepted")],
                    "ranges": {}, "metrics_comparable": {}}
            for key in METRICS:
                values = [r[key] for r in valid if r.get(key) is not None]
                item[key] = round(statistics.median(values), 2) if len(values) == runs else None
                item["ranges"][key] = [min(values), max(values)] if len(values) == runs else None
                item["metrics_comparable"][key] = reason is None and len(values) == runs
                if key == "idle_cpu_percent":
                    item["metrics_comparable"][key] = item["metrics_comparable"][key] and ready_at_3s
            result.append(item)
    return result


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--worker":
        return worker(Path(sys.argv[2]))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--adapters", type=Path)
    parser.add_argument("--gloop-binary", type=Path)
    parser.add_argument("--fixture-root", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--mode", choices=("preflight", "warmup", "run"), default="preflight")
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--only-app", action="append", default=[])
    parser.add_argument("--only-scenario", choices=tuple(SCENARIOS), action="append", default=[])
    parser.add_argument("--monitor-pid", type=int, action="append", default=[])
    parser.add_argument("--monitor-comm", action="append", default=["llama-server"],
                        help="watch processes by /proc comm, including restarted instances")
    parser.add_argument("--min-gpu-free-mib", type=int, default=512)
    parser.add_argument("--max-global-gpu-util-percent", type=int, default=30)
    parser.add_argument("--host-baseline", type=Path)
    parser.add_argument("--order-seed", type=int, default=20261001)
    parser.add_argument("--warmup-extra-seconds", type=float, default=0)
    parser.add_argument("--quiet-seconds", type=int, default=10)
    parser.add_argument("--quiet-timeout-seconds", type=int, default=45)
    parser.add_argument("--quiet-warmup", action="store_true")
    parser.add_argument("--max-launches", type=int, default=12,
                        help="stop cleanly after this many app launches; resume with the same output directory")
    args = parser.parse_args()
    if args.runs != 3:
        parser.error("the matched cohort requires three measured launches")
    if args.min_gpu_free_mib < 0 or any(pid <= 0 for pid in args.monitor_pid):
        parser.error("invalid GPU floor or monitor PID")
    if not 0 <= args.max_global_gpu_util_percent <= 100:
        parser.error("invalid global GPU utilization cap")
    if args.mode == "run" and args.host_baseline is None:
        parser.error("measured mode requires a recorded app-free host baseline")
    if any(not re.fullmatch(r"[A-Za-z0-9_.-]{1,15}", name) for name in args.monitor_comm):
        parser.error("invalid monitored process comm")
    if not 0 <= args.warmup_extra_seconds <= 115:
        parser.error("warmup extra seconds must be between 0 and 115")
    if args.quiet_seconds < 1 or args.quiet_timeout_seconds < args.quiet_seconds:
        parser.error("invalid quiet wait")
    baseline_sha = None
    baseline_stats = None
    if args.host_baseline:
        baseline = json.loads(args.host_baseline.read_text())
        baseline_sha = digest(args.host_baseline)
        utilization = sorted(int(item["gpu_utilization_percent"]) for item in baseline["samples"])
        if len(utilization) < 30:
            parser.error("host baseline needs at least 30 app-free one-second samples")
        p95 = utilization[(95 * len(utilization) + 99) // 100 - 1]
        if p95 > args.max_global_gpu_util_percent:
            parser.error("declared global GPU cap is below baseline p95")
        baseline_stats = {"samples": len(utilization), "utilization_min": utilization[0],
                          "utilization_median": statistics.median(utilization),
                          "utilization_p95": p95, "utilization_max": utilization[-1]}
    if args.max_launches < 1:
        parser.error("max launches must be positive")
    session_identity = None
    session_files = {}
    if args.mode != "preflight":
        from file_manager_input import verify_private_session
        try:
            session_identity = verify_private_session(os.environ.get("DBUS_SESSION_BUS_ADDRESS", ""),
                                                      os.environ.get("WAYLAND_DISPLAY", ""))
            session_root = Path(os.environ["GLOOP_BENCH_SESSION_ROOT"])
            session_files = {name: digest(session_root / name)
                             for name in ("session.json", "window-size.js")}
        except Exception as error:
            parser.error("private benchmark session required: " + str(error))
    manifest = json.loads(args.manifest.read_text())
    apps = manifest["apps"]
    adapters = json.loads(args.adapters.read_text())["apps"] if args.adapters else {}
    for app in apps:
        if app["id"] in adapters:
            app.update({key: value for key, value in adapters[app["id"]].items()
                        if key in ("supported_scenarios", "scenarios", "unsupported")})
    if args.gloop_binary:
        apps.append({"id": "gloop", "name": "Gloop", "binary": str(args.gloop_binary.resolve()),
                     "backend": "wayland", "supported_scenarios": list(SCENARIOS),
                     "scenarios": {}, "trace_single_client_verified": True})
    for app in apps:
        app["_manifest_sha256"] = digest(args.manifest)
        app["_adapter_sha256"] = digest(args.adapters) if args.adapters else None
    if len({app["id"] for app in apps}) != len(apps):
        parser.error("duplicate app id")
    fixtures = args.fixture_root.resolve()
    fixture_start = fixture_inventory(fixtures)
    source_start = {name: digest(Path(__file__).with_name(name)) for name in
                    ("file_manager_cohort.py", "file_manager_input.py", "file_manager_session.py")}
    root = args.output_dir.resolve()
    root.mkdir(parents=True, exist_ok=True)
    input_dir = root / "inputs"
    input_dir.mkdir(exist_ok=True)
    for name, source in (("cohort-manifest.json", args.manifest),
                         ("scenario-adapters.json", args.adapters)):
        if source is None:
            continue
        destination = input_dir / name
        if destination.exists() and digest(destination) != digest(source):
            parser.error(f"input snapshot changed: {destination}")
        if not destination.exists():
            shutil.copyfile(source, destination)
    host_manager, host_inventory = host_packages()
    host_inventory_sha = hashlib.sha256(host_inventory.encode()).hexdigest()
    gpu_driver_start = subprocess.run(["nvidia-smi", "--query-gpu=name,driver_version",
                                       "--format=csv,noheader"], capture_output=True,
                                      text=True, timeout=10, check=True).stdout.strip()
    host_inventory_path = input_dir / "host-packages.txt"
    if host_inventory_path.exists() and digest(host_inventory_path) != host_inventory_sha:
        parser.error("host package inventory changed since this output directory was created")
    if not host_inventory_path.exists():
        host_inventory_path.write_text(host_inventory)
    if args.host_baseline:
        baseline_copy = input_dir / "host-baseline.json"
        if baseline_copy.exists() and digest(baseline_copy) != baseline_sha:
            parser.error("host baseline changed since this output directory was created")
        if not baseline_copy.exists():
            shutil.copyfile(args.host_baseline, baseline_copy)
    records_path = root / "raw.jsonl"
    previous = root / "environment.json"
    if args.mode in ("run", "warmup") and records_path.exists() and previous.exists():
        existing = json.loads(previous.read_text())
        if (existing["manifest_sha256"] != digest(args.manifest) or
                existing.get("adapter_sha256") != (digest(args.adapters) if args.adapters else None) or
                existing.get("fixture_inventory_at_start") != fixture_start or
                existing.get("source_sha256_at_start") != source_start or
                existing.get("host_package_inventory_sha256") != host_inventory_sha or
                existing.get("nvidia_smi") != gpu_driver_start):
            parser.error("manifest, adapters, fixtures, host packages, GPU driver, or harness changed since warmup")
    records = [json.loads(line) for line in records_path.read_text().splitlines()] if records_path.exists() else []
    invocation_start_ordinal = next_ordinal(records)
    prior_drift = False
    for history_name in ("environment-warmup-invocations.jsonl", "environment-run-invocations.jsonl"):
        history_path = root / history_name
        if history_path.exists() and any(json.loads(line).get("provenance_drift")
                                         for line in history_path.read_text().splitlines()):
            prior_drift = True
    if previous.exists() and json.loads(previous.read_text()).get("provenance_drift"):
        prior_drift = True
    if args.mode in ("run", "warmup") and prior_drift:
        parser.error("a prior invocation recorded provenance drift; this output cannot resume")
    prior_incomplete = False
    for mode in ("warmup", "run"):
        previous_invocation = root / f"environment-{mode}.json"
        if previous_invocation.exists() and "execution_status" not in json.loads(previous_invocation.read_text()):
            prior_incomplete = True
    if args.mode in ("run", "warmup") and prior_incomplete:
        parser.error("a prior warmup or measured invocation lacks end snapshots; this output cannot resume")
    if args.mode == "run" and any(not record.get("warmup", False) for record in records) and not (root / "plan.json").exists():
        parser.error("measured attempts exist without a pinned slot plan")
    provenance = {"recorded_utc": datetime.now(timezone.utc).isoformat(),
                  "mode": args.mode, "manifest": str(args.manifest.resolve()),
                  "manifest_sha256": digest(args.manifest),
                  "adapters": str(args.adapters.resolve()) if args.adapters else None,
                  "adapter_sha256": digest(args.adapters) if args.adapters else None,
                  "fixture_root": str(fixtures),
                  "fixture_inventory_at_start": fixture_start,
                  "source_sha256_at_start": source_start,
                  "session_identity": session_identity, "session_files_sha256": session_files,
                  "wayland_display": os.environ.get("WAYLAND_DISPLAY"),
                  "compositor_bus": os.environ.get("DBUS_SESSION_BUS_ADDRESS"),
                  "host": subprocess.check_output(["uname", "-a"], text=True).strip(),
                  "nvidia_smi": gpu_driver_start,
                  "host_package_manager": host_manager,
                  "host_package_inventory_sha256": host_inventory_sha,
                  "monitor_pids": args.monitor_pid, "monitor_comms": args.monitor_comm,
                  "min_gpu_free_mib": args.min_gpu_free_mib,
                  "max_global_gpu_util_percent": args.max_global_gpu_util_percent,
                  "host_baseline": str(args.host_baseline.resolve()) if args.host_baseline else None,
                  "host_baseline_sha256": baseline_sha, "host_baseline_stats": baseline_stats,
                  "order_seed": args.order_seed,
                  "warmup_extra_seconds": args.warmup_extra_seconds,
                  "quiet_seconds": args.quiet_seconds,
                  "quiet_timeout_seconds": args.quiet_timeout_seconds,
                  "quiet_warmup": args.quiet_warmup,
                  "frame_target": "1180x760 outer KWin frame; ScreenShot2 captures client content",
                  "apps": [{"id": app["id"], "binary": app["binary"],
                            "sha256": digest(Path(app["binary"])) if Path(app["binary"]).is_file() else None,
                            "version": app.get("version"), "package": app.get("package")}
                           for app in apps],
                  "method": {"first_buffer": "first non-null wl_buffer attached to an xdg toplevel, client stderr arrival timestamp",
                             "cpu": "owned scope cgroup cpu.stat since exec gate, including idle prewarmed infrastructure; adjusted tick estimate retained separately",
                             "memory": "sum of post-launch process smaps_rollup at approximately five seconds; prewarmed infrastructure excluded",
                             "main_process_vmhwm": "main GUI executable process VmHWM through five seconds",
                             "scope_peak_rss": "maximum sampled simultaneous app process RSS sum through five seconds",
                             "scope_vmhwm_upper_bound": "sum of live process VmHWM, an upper bound rather than true aggregate peak",
                             "gpu": "sum of reported owned NVIDIA graphics or compute processes near five seconds; unknown when none reported",
                             "cpu_3_to_5": "fixed-window scope CPU percentage of one core from three to five seconds; not necessarily idle",
                             "idle": "legacy numeric alias of cpu_3_to_5; only comparable as idle when readiness by three seconds is reviewed"}}
    if not previous.exists():
        atomic_json(previous, provenance)
    if args.mode != "preflight":
        atomic_json(root / f"environment-{args.mode}.json", provenance)
    execution_error = None
    execution_status = "complete"
    launch_count = 0
    if args.mode != "preflight":
        if not os.environ.get("WAYLAND_DISPLAY") or not os.environ.get("DBUS_SESSION_BUS_ADDRESS"):
            parser.error("private Wayland compositor and its DBus address are required")
        app_by_id = {app["id"]: app for app in apps}
        review_path = root / "review.json"
        reviews = json.loads(review_path.read_text()) if review_path.exists() else {}
        session_record = json.loads((Path(os.environ["GLOOP_BENCH_SESSION_ROOT"]) / "session.json").read_text())
        session_method = {"kwin_command": ["{private_wayland_socket}" if part == session_record["socket"]
                                            else part for part in session_record["kwin_command"]],
                          "output": session_record["output"],
                          "window_target": session_record["window_target"],
                          "window_rules_sha256": session_files["window-size.js"],
                          "xwayland_available": bool(os.environ.get("DISPLAY"))}
        pins = {"manifest_sha256": provenance["manifest_sha256"],
                "adapter_sha256": provenance["adapter_sha256"],
                "fixture_inventory": fixture_start, "source_sha256": source_start,
                "binary_sha256": {item["id"]: item["sha256"] for item in provenance["apps"]},
                "host_package_inventory_sha256": host_inventory_sha,
                "gpu_driver_identity": provenance["nvidia_smi"],
                "session_method": session_method,
                "only_app": sorted(args.only_app), "only_scenario": sorted(args.only_scenario),
                "order_seed": args.order_seed, "monitor_pids": args.monitor_pid,
                "monitor_comms": args.monitor_comm,
                "min_gpu_free_mib": args.min_gpu_free_mib,
                "max_global_gpu_util_percent": args.max_global_gpu_util_percent,
                "host_baseline_sha256": baseline_sha,
                "quiet_seconds": args.quiet_seconds, "runs": args.runs}
        plan = None
        if args.mode == "run":
            plan_path = root / "plan.json"
            if plan_path.exists():
                plan = json.loads(plan_path.read_text())
                if plan["pins"] != pins:
                    parser.error("slot plan pins changed; resume requires the original roster, order, inputs, and method")
            else:
                roster, slots, warmup_gui = planned_slots(apps, fixtures, reviews, records, root,
                                                          args.only_app, args.only_scenario, args.order_seed)
                if not slots:
                    parser.error("no reviewed app/scenario warmups are eligible for measured slots")
                if any(app_by_id[slot["app"]].get("backend") == "xwayland" for slot in slots) and \
                   not os.environ.get("DISPLAY"):
                    parser.error("XWayland cohort needs a verified private DISPLAY")
                plan = {"created_utc": datetime.now(timezone.utc).isoformat(),
                        "pins": pins, "roster": roster, "slots": slots,
                        "warmup_gui_sha256": warmup_gui,
                        "warmup_reviews_at_plan": reviews.get("warmups", {})}
                atomic_json(plan_path, plan)
            provenance["plan_sha256"] = digest(plan_path)
            provenance["planned_slots"] = len(plan["slots"])
        with records_path.open("a") as stream:
            try:
                if args.mode == "warmup":
                    stop = False
                    for scenario, (folder, _) in SCENARIOS.items():
                        if args.only_scenario and scenario not in args.only_scenario:
                            continue
                        available = [app for app in apps if support_reason(app, scenario, fixtures / folder) is None
                                     and (not args.only_app or app["id"] in args.only_app)]
                        for app in available:
                            prior = [r for r in records if r["app"] == app["id"] and r["scenario"] == scenario
                                     and r.get("warmup")]
                            if any(r["status"] in ("ok", "late_window") and
                                   not r.get("discard_reason") for r in prior):
                                continue
                            if any(r["status"] not in ("deferred",) and
                                   r.get("discard_reason") not in
                                   ("monitored external process used CPU/GPU",
                                    "new external GPU process appeared") for r in prior):
                                raise RuntimeError(f"warmup failure for {app['id']} {scenario} needs review")
                            ordinal = next_ordinal(records)
                            quiet_before = None
                            if args.quiet_warmup:
                                try:
                                    quiet_before = wait_for_quiet(args.monitor_pid, args.monitor_comm,
                                                                  args.min_gpu_free_mib,
                                                                  args.max_global_gpu_util_percent,
                                                                  args.quiet_seconds, args.quiet_timeout_seconds)
                                except QuietTimeout as error:
                                    append_record(stream, records, {"app": app["id"], "scenario": scenario,
                                                  "warmup": True, "ordinal": ordinal, "status": "deferred",
                                                  "reason": str(error), "quiet_before": {"readings": error.readings},
                                                  "session_identity": session_identity,
                                                  "recorded_utc": datetime.now(timezone.utc).isoformat()})
                                    execution_status = "deferred_quiet"
                                    stop = True
                                    break
                            record = launch(root, app, scenario, fixtures / folder, ordinal, True,
                                            args.monitor_pid, args.monitor_comm, args.min_gpu_free_mib,
                                            args.warmup_extra_seconds if folder == "100000" else
                                            min(args.warmup_extra_seconds, 3))
                            record.update(quiet_before=quiet_before, session_identity=session_identity)
                            append_record(stream, records, record)
                            launch_count += 1
                            print(f"warmup {app['id']} {scenario}: {record['status']}", flush=True)
                            if record["status"] not in ("ok", "late_window"):
                                raise RuntimeError(f"warmup failed for {app['id']} {scenario}: {record.get('reason')}")
                            if record.get("discard_reason"):
                                execution_status = "deferred_external_contamination"
                                stop = True
                                break
                            if launch_count >= args.max_launches:
                                execution_status = "partial_launch_limit"
                                stop = True
                                break
                        if stop:
                            break
                elif args.mode == "run":
                    external_reasons = {"monitored external process used CPU/GPU",
                                        "new external GPU process appeared"}
                    for slot in plan["slots"]:
                        attempts = [r for r in records if r.get("slot_id") == slot["slot_id"]]
                        accepted = [r for r in attempts if r.get("accepted") is True]
                        if len(accepted) > 1:
                            raise RuntimeError(f"multiple accepted attempts for {slot['slot_id']}")
                        if accepted:
                            continue
                        if any(r["status"] != "deferred" and
                               (r["status"] not in ("ok", "late_window") or
                                not (r.get("capture") or r.get("late_capture")) or
                                r.get("discard_reason") not in external_reasons) for r in attempts):
                            raise RuntimeError(f"prior non-external failure for {slot['slot_id']} needs review")
                        app = app_by_id[slot["app"]]
                        scenario = slot["scenario"]
                        ordinal = next_ordinal(records)
                        print(f"slot {slot['slot_id']} attempt {len(attempts) + 1}: waiting for quiet",
                              flush=True)
                        try:
                            quiet_before = wait_for_quiet(args.monitor_pid, args.monitor_comm,
                                                          args.min_gpu_free_mib,
                                                          args.max_global_gpu_util_percent,
                                                          args.quiet_seconds, args.quiet_timeout_seconds)
                        except QuietTimeout as error:
                            append_record(stream, records, {**slot, "warmup": False, "ordinal": ordinal,
                                          "attempt": len(attempts) + 1, "status": "deferred",
                                          "accepted": False, "reason": str(error),
                                          "quiet_before": {"readings": error.readings},
                                          "session_identity": session_identity,
                                          "recorded_utc": datetime.now(timezone.utc).isoformat()})
                            execution_status = "deferred_quiet"
                            break
                        record = launch(root, app, scenario, fixtures / SCENARIOS[scenario][0],
                                        ordinal, False, args.monitor_pid, args.monitor_comm,
                                        args.min_gpu_free_mib, 0)
                        record.update(slot_id=slot["slot_id"], round=slot["round"],
                                      attempt=len(attempts) + 1, quiet_before=quiet_before,
                                      session_identity=session_identity)
                        expected_gui = plan["warmup_gui_sha256"][f"{app['id']}/{scenario}"]
                        if record["status"] != "validation_timeout" and \
                           record.get("gui_executable_sha256") != expected_gui:
                            record["reason"] = ("GUI executable hash differs from reviewed warmup: "
                                                f"{record.get('gui_executable_sha256')} != {expected_gui}")
                        discard = record.get("discard_reason")
                        validated_capture = (record["status"] in ("ok", "late_window") and
                                             (record.get("capture") or record.get("late_capture")) is not None and
                                             record.get("gui_executable_sha256") == expected_gui)
                        bounded_timeout = (record["status"] == "validation_timeout" and
                                           all(record.get(key) is not None for key in
                                               ("cpu_first_3s_ms", "rss_mib", "pss_mib",
                                                "scope_peak_rss_mib", "cpu_3_to_5_percent")))
                        record["accepted"] = bool(discard is None and (validated_capture or bounded_timeout))
                        append_record(stream, records, record)
                        launch_count += 1
                        print(f"slot {slot['slot_id']}: {record['status']}, "
                              f"{'accepted' if record['accepted'] else discard or record.get('reason')}",
                              flush=True)
                        if not record["accepted"] and (record["status"] not in ("ok", "late_window",
                                                                                "validation_timeout") or
                                                       not (record.get("capture") or record.get("late_capture")) or
                                                       (record["status"] != "validation_timeout" and
                                                        record.get("gui_executable_sha256") != expected_gui) or
                                                       discard not in external_reasons):
                            raise RuntimeError(f"measured attempt failed for {slot['slot_id']}: "
                                               f"{record.get('reason') or discard}")
                        if not record["accepted"]:
                            execution_status = "deferred_external_contamination"
                            break
                        if launch_count >= args.max_launches:
                            execution_status = "partial_launch_limit"
                            break
            except Exception as error:
                execution_error = str(error)
                execution_status = "failed"
    records = [json.loads(line) for line in records_path.read_text().splitlines()] if records_path.exists() else []
    if args.mode == "run" and execution_status == "complete" and plan and any(
            not any(r.get("slot_id") == slot["slot_id"] and r.get("accepted") is True for r in records)
            for slot in plan["slots"]):
        execution_status = "partial_pending_slots"
    provenance["execution_status"] = execution_status
    provenance["execution_error"] = execution_error
    provenance["launches_this_invocation"] = launch_count
    provenance["invocation_ordinal_start"] = invocation_start_ordinal
    provenance["invocation_ordinal_end"] = next_ordinal(records) - 1
    end_snapshot_errors = []
    try:
        fixture_end = fixture_inventory(fixtures)
    except Exception as error:
        fixture_end = None
        end_snapshot_errors.append("fixture inventory: " + str(error))
    try:
        source_end = {name: digest(Path(__file__).with_name(name)) for name in source_start}
    except Exception as error:
        source_end = None
        end_snapshot_errors.append("source hashes: " + str(error))
    session_root = Path(os.environ["GLOOP_BENCH_SESSION_ROOT"]) if session_identity else None
    try:
        session_end = {name: digest(session_root / name) for name in ("session.json", "window-size.js")} \
            if session_root else {}
    except Exception as error:
        session_end = None
        end_snapshot_errors.append("session hashes: " + str(error))
    try:
        input_end = {"manifest_sha256": digest(args.manifest),
                     "adapter_sha256": digest(args.adapters) if args.adapters else None,
                     "host_baseline_sha256": digest(args.host_baseline) if args.host_baseline else None,
                     "binary_sha256": {app["id"]: digest(Path(app["binary"])) for app in apps}}
    except Exception as error:
        input_end = None
        end_snapshot_errors.append("input hashes: " + str(error))
    try:
        _, host_inventory_end = host_packages()
        host_inventory_end_sha = hashlib.sha256(host_inventory_end.encode()).hexdigest()
        gpu_driver_end = subprocess.run(["nvidia-smi", "--query-gpu=name,driver_version",
                                         "--format=csv,noheader"], capture_output=True,
                                        text=True, timeout=10, check=True).stdout.strip()
    except Exception as error:
        host_inventory_end_sha = None
        gpu_driver_end = None
        end_snapshot_errors.append("host identity: " + str(error))
    provenance.update(fixture_inventory_at_end=fixture_end, source_sha256_at_end=source_end,
                      session_files_sha256_at_end=session_end, input_hashes_at_end=input_end,
                      host_package_inventory_sha256_at_end=host_inventory_end_sha,
                      gpu_driver_identity_at_end=gpu_driver_end,
                      end_snapshot_errors=end_snapshot_errors)
    provenance["provenance_drift"] = (
        bool(end_snapshot_errors) or
        fixture_start != fixture_end or source_start != source_end or session_files != session_end or
        host_inventory_sha != host_inventory_end_sha or provenance["nvidia_smi"] != gpu_driver_end or
        input_end is None or provenance["manifest_sha256"] != input_end["manifest_sha256"] or
        provenance["adapter_sha256"] != input_end["adapter_sha256"] or
        baseline_sha != input_end["host_baseline_sha256"] or
        any(entry["sha256"] != input_end["binary_sha256"][entry["id"]]
            for entry in provenance["apps"]))
    if provenance["provenance_drift"]:
        provenance["invalidated_accepted_ordinals"] = [record["ordinal"] for record in records
            if invocation_start_ordinal <= record.get("ordinal", -1) <= provenance["invocation_ordinal_end"]
            and record.get("accepted") is True]
    review_path = root / "review.json"
    reviews = json.loads(review_path.read_text()) if review_path.exists() else {}
    result = summaries(apps, fixtures, records, args.runs, reviews)
    if provenance["provenance_drift"] or prior_drift or prior_incomplete:
        for row in result:
            row["comparable"] = False
            row["workload_validated"] = False
            row["reason"] = ("prior invocation lacks end snapshots" if prior_incomplete else
                             "cohort provenance drift in this or a prior invocation")
            row["metrics_comparable"] = {metric: False for metric in row["metrics_comparable"]}
    atomic_json(root / "summary.json", result)
    if args.mode != "preflight":
        atomic_json(root / f"environment-{args.mode}.json", provenance)
        with (root / f"environment-{args.mode}-invocations.jsonl").open("a") as stream:
            stream.write(json.dumps(provenance) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
    if provenance["provenance_drift"]:
        raise RuntimeError("source, input, binary, fixture, or compositor rules changed during cohort")
    if execution_error:
        raise RuntimeError(execution_error)
    print(f"{args.mode}: {execution_status}; {len(result)} app/scenario rows, "
          f"{len(records)} raw records; {root / 'summary.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
