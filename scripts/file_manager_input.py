"""Send keyboard actions to the private KWin benchmark compositor."""

import ctypes
import os
from pathlib import Path
import re
import select
import time

import dbus
import dbus.bus


KEYS = {name: int(code) for name, code in re.findall(
    r"^#define KEY_([A-Z0-9_]+)\s+(\d+)$",
    Path("/usr/include/linux/input-event-codes.h").read_text(), re.M)}
ALIASES = {"CTRL": "LEFTCTRL", "CONTROL": "LEFTCTRL", "ALT": "LEFTALT",
           "SHIFT": "LEFTSHIFT", "SUPER": "LEFTMETA", "ESCAPE": "ESC"}


def verify_private_session(bus_address, socket):
    if not bus_address.startswith("unix:path=/tmp/dbus-") or not socket.startswith("gloop-file-bench-"):
        raise RuntimeError("benchmark target is not a private compositor and session bus")
    if not (Path(os.environ["XDG_RUNTIME_DIR"]) / socket).is_socket():
        raise RuntimeError("private benchmark Wayland socket is unavailable")
    bus = dbus.bus.BusConnection(bus_address)
    control = dbus.Interface(bus.get_object("org.freedesktop.DBus", "/org/freedesktop/DBus"),
                             "org.freedesktop.DBus")
    pid = int(control.GetConnectionUnixProcessID("org.kde.KWin"))
    command = [part.decode(errors="replace") for part in
               Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0") if part]
    if (not command or Path(command[0]).name != "kwin_wayland" or
            "--virtual" not in command or "--socket" not in command or
            command[command.index("--socket") + 1:command.index("--socket") + 2] != [socket]):
        raise RuntimeError("session bus KWin owner is not the expected private virtual compositor")
    return {"kwin_pid": pid, "kwin_command": command, "bus_address": bus_address,
            "wayland_display": socket}


class PrivateKeyboard:
    def __init__(self, bus_address, socket):
        verify_private_session(bus_address, socket)
        self.bus = dbus.bus.BusConnection(bus_address)
        remote = dbus.Interface(self.bus.get_object("org.kde.KWin", "/org/kde/KWin/EIS/RemoteDesktop"),
                                "org.kde.KWin.EIS.RemoteDesktop")
        fd, self.cookie = remote.connectToEIS(dbus.Int32(3))
        self.remote = remote
        self.lib = ctypes.CDLL("libei.so.1")
        definitions = {
            "ei_new_sender": (ctypes.c_void_p, [ctypes.c_void_p]),
            "ei_configure_name": (None, [ctypes.c_void_p, ctypes.c_char_p]),
            "ei_setup_backend_fd": (ctypes.c_int, [ctypes.c_void_p, ctypes.c_int]),
            "ei_get_fd": (ctypes.c_int, [ctypes.c_void_p]),
            "ei_dispatch": (None, [ctypes.c_void_p]),
            "ei_get_event": (ctypes.c_void_p, [ctypes.c_void_p]),
            "ei_event_get_type": (ctypes.c_int, [ctypes.c_void_p]),
            "ei_event_get_seat": (ctypes.c_void_p, [ctypes.c_void_p]),
            "ei_event_get_device": (ctypes.c_void_p, [ctypes.c_void_p]),
            "ei_event_unref": (None, [ctypes.c_void_p]),
            "ei_seat_bind_capabilities": (None, [ctypes.c_void_p]),
            "ei_device_has_capability": (ctypes.c_bool, [ctypes.c_void_p, ctypes.c_int]),
            "ei_device_ref": (ctypes.c_void_p, [ctypes.c_void_p]),
            "ei_device_unref": (None, [ctypes.c_void_p]),
            "ei_device_start_emulating": (None, [ctypes.c_void_p, ctypes.c_uint32]),
            "ei_device_stop_emulating": (None, [ctypes.c_void_p]),
            "ei_device_keyboard_key": (None, [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_bool]),
            "ei_device_pointer_motion_absolute": (None, [ctypes.c_void_p, ctypes.c_double, ctypes.c_double]),
            "ei_device_button_button": (None, [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_bool]),
            "ei_device_frame": (None, [ctypes.c_void_p, ctypes.c_uint64]),
            "ei_now": (ctypes.c_uint64, [ctypes.c_void_p]),
            "ei_unref": (None, [ctypes.c_void_p]),
        }
        for name, (result, arguments) in definitions.items():
            function = getattr(self.lib, name)
            function.restype = result
            function.argtypes = arguments
        self.context = self.lib.ei_new_sender(None)
        self.lib.ei_configure_name(self.context, b"Gloop benchmark input")
        if self.lib.ei_setup_backend_fd(self.context, fd.take()) != 0:
            raise RuntimeError("could not connect to private KWin EIS")
        self.keyboard = None
        self.pointer = None
        ready = set()
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline and len(ready) < 2:
            if select.select([self.lib.ei_get_fd(self.context)], [], [], .2)[0]:
                self.lib.ei_dispatch(self.context)
            while event := self.lib.ei_get_event(self.context):
                try:
                    kind = self.lib.ei_event_get_type(event)
                    if kind == 2:
                        raise RuntimeError("private KWin disconnected from EIS")
                    if kind == 3:
                        self.lib.ei_seat_bind_capabilities(self.lib.ei_event_get_seat(event),
                                                           2, 32, 16, 4, None)
                    if kind == 5:
                        device = self.lib.ei_event_get_device(event)
                        if self.pointer is None and self.lib.ei_device_has_capability(device, 2):
                            self.pointer = self.lib.ei_device_ref(device)
                        if self.keyboard is None and self.lib.ei_device_has_capability(device, 4):
                            self.keyboard = self.lib.ei_device_ref(device)
                    if kind == 8:
                        device = self.lib.ei_event_get_device(event)
                        if device == self.pointer:
                            self.lib.ei_device_start_emulating(self.pointer, 1)
                            ready.add("pointer")
                        if device == self.keyboard:
                            self.lib.ei_device_start_emulating(self.keyboard, 2)
                            ready.add("keyboard")
                finally:
                    self.lib.ei_event_unref(event)
        if len(ready) != 2:
            raise RuntimeError("private EIS input devices unavailable")

    def key(self, name, down):
        normalized = ALIASES.get(name.upper(), name.upper())
        code = KEYS.get(normalized)
        if code is None:
            raise ValueError(f"unsupported key: {name}")
        self.lib.ei_device_keyboard_key(self.keyboard, code, down)
        self.lib.ei_device_frame(self.keyboard, self.lib.ei_now(self.context))
        self.lib.ei_dispatch(self.context)
        time.sleep(.025)

    def chord(self, value):
        names = value.split("+")
        if any(not name for name in names):
            raise ValueError("empty key")
        for name in names:
            self.key(name, True)
        time.sleep(.06)
        for name in reversed(names):
            self.key(name, False)

    def click(self, x, y):
        if not (132 <= x <= 1308 and 72 <= y <= 828):
            raise ValueError("click outside private benchmark window")
        self.lib.ei_device_pointer_motion_absolute(self.pointer, x, y)
        self.lib.ei_device_frame(self.pointer, self.lib.ei_now(self.context))
        self.lib.ei_dispatch(self.context)
        time.sleep(.04)
        self.lib.ei_device_button_button(self.pointer, 0x110, True)
        self.lib.ei_device_frame(self.pointer, self.lib.ei_now(self.context))
        self.lib.ei_dispatch(self.context)
        time.sleep(.06)
        self.lib.ei_device_button_button(self.pointer, 0x110, False)
        self.lib.ei_device_frame(self.pointer, self.lib.ei_now(self.context))
        self.lib.ei_dispatch(self.context)

    def close(self):
        for device in (self.keyboard, self.pointer):
            self.lib.ei_device_stop_emulating(device)
            self.lib.ei_device_unref(device)
        self.lib.ei_unref(self.context)
        self.remote.disconnect(self.cookie)
