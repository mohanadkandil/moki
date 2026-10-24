"""Open one fixed generated fixture in its design application, never shell text."""
import json
import ctypes
from ctypes.util import find_library
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time

role, directory = sys.argv[1:]
if role not in {"mechanical", "electrical"}:
    raise SystemExit("Unknown preview role")
root = Path(directory).resolve()
if root.parent != Path.home() / "moki/checks" or not re.fullmatch(r"[A-Za-z0-9-]{1,60}", root.name):
    raise SystemExit("Preview requires a generated Moki run directory")
artifact = root / ("tray.step" if role == "mechanical" else "fixture.kicad_pcb")
if not artifact.is_file():
    raise SystemExit("Generated preview artifact is missing")
displays = sorted(Path("/tmp/.X11-unix").glob("X[0-9]*"))
if not displays:
    raise SystemExit("No desktop X display is running")
env = os.environ.copy()
env.update(DISPLAY=":" + displays[0].name[1:], LIBGL_ALWAYS_SOFTWARE="1", QT_X11_NO_MITSHM="1")
application = (shutil.which("freecad") or shutil.which("FreeCAD")) if role == "mechanical" else shutil.which("pcbnew")
if not application:
    raise SystemExit("Required artifact application is missing")

# Repeated web runs must not accumulate CAD windows or leave KiCad's generated
# file locked. Close only previous Moki fixture previews, identified by argv;
# never stop the sandbox or touch an app editing a document outside checks/.
previous = []
for process_dir in Path("/proc").glob("[0-9]*"):
    try:
        argv = (process_dir / "cmdline").read_bytes().decode().split("\0")
        app_name = Path(argv[0]).name.lower()
        if app_name not in ({"freecad"} if role == "mechanical" else {"pcbnew"}):
            continue
        for arg in argv[1:]:
            candidate = Path(arg)
            if (candidate.is_absolute() and candidate.parent.parent == Path.home() / "moki/checks"
                    and (candidate.name == "preview.FCMacro" if role == "mechanical"
                         else candidate.name == "fixture.kicad_pcb")):
                os.kill(int(process_dir.name), signal.SIGTERM)
                previous.append(process_dir)
                break
    except (OSError, UnicodeError, ValueError):
        continue
deadline = time.monotonic() + 3
def still_running(process):
    try:
        return bool((process / "cmdline").read_bytes())
    except OSError:
        return False

while any(still_running(process) for process in previous) and time.monotonic() < deadline:
    time.sleep(0.1)
if any(still_running(process) for process in previous):
    raise SystemExit("Previous generated preview is still closing")
if role == "electrical":
    # These are reproducible fixtures, not user-edited boards. A terminated
    # previous preview can leave KiCad's lock file behind on the same run path.
    (root / "~fixture.kicad_pcb.lck").unlink(missing_ok=True)

if role == "mechanical":
    # A fixed macro makes the imported solid visible rather than leaving the
    # empty startup document or an unhelpful default camera in the screenshot.
    title = "Moki " + root.name + " preview-" + str(os.getpid())
    macro = root / "preview.FCMacro"
    macro.write_text(
        "import FreeCAD as App\nimport FreeCADGui as Gui\nimport Part\n"
        "from PySide2 import QtCore, QtWidgets\n"
        "App.ParamGet('User parameter:BaseApp/Preferences/Mod/Start').SetBool('ShowOnStartup', False)\n"
        f"Part.open({str(artifact)!r})\n"
        "def present_fixture():\n"
        "    mdi = Gui.getMainWindow().findChild(QtWidgets.QMdiArea)\n"
        "    if mdi:\n"
        "        for window in mdi.subWindowList():\n"
        "            if window.windowTitle() == 'Start':\n"
        "                window.close()\n"
        "    Gui.activeDocument().activeView().viewAxonometric()\n"
        "    Gui.activeDocument().activeView().fitAll()\n"
        f"    App.activeDocument().Label = {title!r}\n"
        "QtCore.QTimer.singleShot(1500, present_fixture)\n"
    )
    arguments = [application, str(macro)]
else:
    # KiCad's first-run library dialog otherwise hides the generated board.
    config = Path.home() / ".config/kicad/9.0"
    config.mkdir(parents=True, exist_ok=True)
    for name in ("fp-lib-table", "sym-lib-table"):
        source = Path("/usr/share/kicad/template") / name
        if source.is_file() and not (config / name).exists():
            shutil.copyfile(source, config / name)
    title = artifact.stem
    arguments = [application, str(artifact)]

with (root / "preview.log").open("a") as log:
    process = subprocess.Popen(arguments, env=env, stdout=log, stderr=log, start_new_session=True)

# Desktop apps can load behind the manager window. Raise the actual document
# via X11, using only its expected title; no xdotool/wmctrl dependency or shell.
x11 = ctypes.CDLL(find_library("X11"))
display_type, window_type = ctypes.c_void_p, ctypes.c_ulong
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XOpenDisplay.restype = display_type
x11.XDefaultRootWindow.argtypes = [display_type]
x11.XDefaultRootWindow.restype = window_type
x11.XQueryTree.argtypes = [display_type, window_type, ctypes.POINTER(window_type), ctypes.POINTER(window_type), ctypes.POINTER(ctypes.POINTER(window_type)), ctypes.POINTER(ctypes.c_uint)]
x11.XFetchName.argtypes = [display_type, window_type, ctypes.POINTER(ctypes.c_char_p)]
x11.XInternAtom.argtypes = [display_type, ctypes.c_char_p, ctypes.c_int]
x11.XInternAtom.restype = ctypes.c_ulong
x11.XGetWindowProperty.argtypes = [display_type, window_type, ctypes.c_ulong, ctypes.c_long, ctypes.c_long, ctypes.c_int, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_void_p)]
x11.XFree.argtypes = [ctypes.c_void_p]
x11.XMapRaised.argtypes = [display_type, window_type]
x11.XSendEvent.argtypes = [display_type, window_type, ctypes.c_int, ctypes.c_long, ctypes.c_void_p]
x11.XFlush.argtypes = [display_type]
x11.XCloseDisplay.argtypes = [display_type]
display = x11.XOpenDisplay(env["DISPLAY"].encode())
if not display:
    raise SystemExit("Cannot connect to preview X display")
desktop = x11.XDefaultRootWindow(display)
title_atom = x11.XInternAtom(display, b"_NET_WM_NAME", 0)

def find_document(parent, frame=None):
    value, actual_type, actual_format = ctypes.c_void_p(), ctypes.c_ulong(), ctypes.c_int()
    length, remaining = ctypes.c_ulong(), ctypes.c_ulong()
    text = ""
    if x11.XGetWindowProperty(display, parent, title_atom, 0, 1024, 0, 0, ctypes.byref(actual_type), ctypes.byref(actual_format), ctypes.byref(length), ctypes.byref(remaining), ctypes.byref(value)) == 0 and value.value:
        text = ctypes.string_at(value, length.value).decode(errors="replace")
        x11.XFree(value)
    name = ctypes.c_char_p()
    if x11.XFetchName(display, parent, ctypes.byref(name)) and name.value:
        text = text or name.value.decode(errors="replace")
        x11.XFree(name)
    if title.casefold() in text.casefold():
        return parent, frame or parent
    tree_root, tree_parent = window_type(), window_type()
    children, count = ctypes.POINTER(window_type)(), ctypes.c_uint()
    if not x11.XQueryTree(display, parent, ctypes.byref(tree_root), ctypes.byref(tree_parent), ctypes.byref(children), ctypes.byref(count)):
        return None
    child_ids = [children[index] for index in range(count.value)]
    if children:
        x11.XFree(children)
    for child in child_ids:
        found = find_document(child, child if parent == desktop else frame)
        if found:
            return found
    return None

deadline = time.monotonic() + 10
found = None
while time.monotonic() < deadline and not found:
    found = find_document(desktop)
    if not found:
        time.sleep(0.2)
if found:
    client, frame = found
    class EventData(ctypes.Union):
        _fields_ = [("b", ctypes.c_char * 20), ("s", ctypes.c_short * 10), ("l", ctypes.c_long * 5)]

    class ClientMessage(ctypes.Structure):
        _fields_ = [("type", ctypes.c_int), ("serial", ctypes.c_ulong), ("send_event", ctypes.c_int),
                    ("display", display_type), ("window", window_type), ("message_type", ctypes.c_ulong),
                    ("format", ctypes.c_int), ("data", EventData)]

    message = ClientMessage()
    message.type, message.send_event, message.display = 33, 1, display
    message.window = client
    message.message_type = x11.XInternAtom(display, b"_NET_ACTIVE_WINDOW", 0)
    message.format = 32
    message.data.l[0] = 2  # Window-manager request, preserving its focus policy.
    x11.XSendEvent(display, desktop, 0, (1 << 19) | (1 << 20), ctypes.byref(message))
    x11.XFlush(display)
x11.XCloseDisplay(display)
if not found:
    raise SystemExit("Generated artifact did not finish loading in the design application")
print(json.dumps({"role": role, "pid": process.pid, "artifact": str(artifact), "expectedTitle": title, "documentWindow": int(found[0])}))
