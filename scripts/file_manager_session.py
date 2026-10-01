#!/usr/bin/env python3
"""Run a file-manager benchmark command in a private KWin Wayland session."""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time


def descendants(pid):
    pending = [pid]
    seen = set()
    while pending:
        current = pending.pop()
        if current in seen:
            continue
        seen.add(current)
        try:
            children = Path(f"/proc/{current}/task/{current}/children").read_text().split()
            pending.extend(int(child) for child in children)
        except (FileNotFoundError, ProcessLookupError):
            continue
    return seen


def owned_xwayland(kwin_pid):
    """Find a private X display from a listener owned by KWin or its Xwayland child."""
    listeners = {}
    for line in Path("/proc/net/unix").read_text().splitlines()[1:]:
        fields = line.split()
        if len(fields) >= 8 and re.fullmatch(r"/tmp/\.X11-unix/X\d+", fields[7]):
            listeners.setdefault(fields[7], set()).add(fields[6])
    results = []
    for path, inodes in listeners.items():
        socket = Path(path)
        if not socket.is_socket() or socket.stat().st_uid != os.getuid():
            continue
        display = ":" + socket.name[1:]
        owners = []
        private_pids = descendants(kwin_pid)
        for pid in private_pids:
            try:
                fds = {target for fd in Path(f"/proc/{pid}/fd").iterdir()
                       if (target := os.readlink(fd)).startswith("socket:[")}
            except (FileNotFoundError, ProcessLookupError, PermissionError):
                continue
            if not any(f"socket:[{inode}]" in fds for inode in inodes):
                continue
            owners.append(pid)
        lock_file = Path("/tmp") / f".X{display[1:]}-lock"
        try:
            lock_pid = int(lock_file.read_text().strip())
        except (FileNotFoundError, ValueError, PermissionError):
            lock_pid = None
        if lock_pid in private_pids and lock_pid not in owners:
            owners.append(lock_pid)
        if not owners:
            continue
        xwayland_pid = None
        xwayland_argv = None
        for pid in owners:
            try:
                argv = [item.decode(errors="replace") for item in
                        Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0") if item]
            except (FileNotFoundError, ProcessLookupError):
                continue
            if argv and Path(argv[0]).name == "Xwayland" and display in argv:
                xwayland_pid = pid
                xwayland_argv = argv
                break
        results.append({"display": display, "socket": path, "listener_inodes": sorted(inodes),
                        "owner_pids": owners, "lock_file": str(lock_file), "lock_pid": lock_pid,
                        "xwayland_pid": xwayland_pid,
                        "xwayland_argv": xwayland_argv})
    return results


def xwayland_debug(kwin_pid):
    children = []
    for pid in sorted(descendants(kwin_pid)):
        try:
            command = [part.decode(errors="replace") for part in
                       Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0") if part]
            if command and Path(command[0]).name == "Xwayland":
                children.append({"pid": pid, "argv": command})
        except (FileNotFoundError, ProcessLookupError):
            continue
    sockets = [str(path) for path in Path("/tmp/.X11-unix").glob("X*")]
    unix = [line for line in Path("/proc/net/unix").read_text().splitlines()
            if "/tmp/.X11-unix/X" in line]
    return {"xwayland_children": children, "x_sockets": sockets, "unix_socket_rows": unix}


def inner(root, command, require_xwayland):
    import dbus
    import dbus.bus

    socket = f"gloop-file-bench-{os.getpid()}"
    env = os.environ.copy()
    env.pop("DISPLAY", None)
    env.pop("WAYLAND_DISPLAY", None)
    env["KWIN_SCREENSHOT_NO_PERMISSION_CHECKS"] = "1"
    env["XDG_SESSION_TYPE"] = "wayland"
    env["XDG_CURRENT_DESKTOP"] = "KDE"
    env["KDE_SESSION_VERSION"] = "6"
    for name in ("home", "config", "data", "cache", "state"):
        (root / "compositor" / name).mkdir(parents=True, exist_ok=True)
    env["HOME"] = str(root / "compositor" / "home")
    for name in ("config", "data", "cache", "state"):
        env[f"XDG_{name.upper()}_HOME"] = str(root / "compositor" / name)
    invocation = ["kwin_wayland", "--virtual", "--xwayland", "--socket", socket,
                  "--width", "1440", "--height", "900", "--scale", "1",
                  "--no-global-shortcuts", "--no-lockscreen"]
    log = root / "kwin.log"
    with log.open("w") as stream:
        kwin = subprocess.Popen(invocation, env=env, stdout=stream, stderr=stream)
    script_name = f"gloop-file-bench-size-{os.getpid()}"
    manager = None
    try:
        path = Path(env["XDG_RUNTIME_DIR"]) / socket
        deadline = time.monotonic() + 20
        while not path.is_socket() and time.monotonic() < deadline:
            if kwin.poll() is not None:
                raise RuntimeError("private KWin exited: " + log.read_text()[-2000:])
            time.sleep(.05)
        if not path.is_socket():
            raise RuntimeError("private Wayland socket did not appear")
        owned_x = []
        x_deadline = time.monotonic() + (60 if require_xwayland else 3)
        while time.monotonic() < x_deadline:
            owned_x = owned_xwayland(kwin.pid)
            if len(owned_x) == 1:
                break
            time.sleep(.05)
        if require_xwayland and len(owned_x) != 1:
            raise RuntimeError("private Xwayland display could not be identified: " +
                               json.dumps(xwayland_debug(kwin.pid)))
        display = owned_x[0]["display"] if len(owned_x) == 1 else None
        bus = dbus.bus.BusConnection(env["DBUS_SESSION_BUS_ADDRESS"])
        while time.monotonic() < deadline and not bus.name_has_owner("org.kde.KWin"):
            if kwin.poll() is not None:
                raise RuntimeError("private KWin exited before DBus registration: " + log.read_text()[-2000:])
            time.sleep(.05)
        if not bus.name_has_owner("org.kde.KWin"):
            raise RuntimeError("private KWin did not register on its DBus")
        manager = dbus.Interface(bus.get_object("org.kde.KWin", "/Scripting"), "org.kde.kwin.Scripting")
        script = root / "window-size.js"
        script.write_text("workspace.windowAdded.connect(function(w) { w.frameGeometry = {x:130,y:70,width:1180,height:760}; });\n")
        identifier = int(manager.loadScript(str(script), script_name, signature="ss"))
        object_path = f"/Scripting/Script{identifier}"
        dbus.Interface(bus.get_object("org.kde.KWin", object_path), "org.kde.kwin.Script").run()
        child_env = env.copy()
        child_env["WAYLAND_DISPLAY"] = socket
        if display:
            child_env["DISPLAY"] = display
        child_env["GLOOP_BENCH_SESSION_ROOT"] = str(root)
        metadata = {"kwin_pid": kwin.pid, "bus": env["DBUS_SESSION_BUS_ADDRESS"],
                    "socket": socket, "xwayland_display": display,
                    "xwayland_identity": owned_x[0] if len(owned_x) == 1 else None,
                    "output": "1440x900@1",
                    "window_target": "1180x760", "kwin_command": invocation,
                    "kwin_log": str(log), "command": command}
        (root / "session.json").write_text(json.dumps(metadata, indent=2) + "\n")
        return subprocess.call(command, env=child_env)
    finally:
        if manager is not None:
            try:
                manager.unloadScript(script_name)
            except dbus.DBusException:
                pass
        kwin.terminate()
        try:
            kwin.wait(timeout=5)
        except subprocess.TimeoutExpired:
            kwin.kill()
            kwin.wait(timeout=3)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--inner", action="store_true")
    parser.add_argument("--require-xwayland", action="store_true")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("command required after --")
    root = args.output_dir.resolve()
    root.mkdir(parents=True, exist_ok=True)
    if args.inner:
        return inner(root, command, args.require_xwayland)
    env = os.environ.copy()
    env.pop("DBUS_SESSION_BUS_ADDRESS", None)
    return subprocess.call(["dbus-run-session", "--", sys.executable, str(Path(__file__).resolve()),
                            "--inner", "--output-dir", str(root),
                            *(["--require-xwayland"] if args.require_xwayland else []),
                            "--", *command], env=env)


if __name__ == "__main__":
    sys.exit(main())
