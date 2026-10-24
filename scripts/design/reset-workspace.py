"""Start an empty project desktop; preserve files, other documents and workers."""
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time

role, directory, *options = sys.argv[1:]
if role not in {"mechanical", "electrical"} or options not in ([], ["--close-blank"]):
    raise SystemExit("Expected mechanical|electrical, run directory, optional --close-blank")
uuid = re.compile(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")
root = Path(directory).resolve()
base = Path.home() / "moki"
if root.parent != base / "runs" or not uuid.fullmatch(root.name):
    raise SystemExit("Workspace reset requires a generated Moki run directory")
root.mkdir(exist_ok=True)
application = (shutil.which("freecad") or shutil.which("FreeCAD")) if role == "mechanical" else shutil.which("pcbnew")
if not application:
    raise SystemExit("Design application is missing")

def identity(pid):
    try:
        process = Path("/proc") / str(pid)
        argv = (process / "cmdline").read_bytes().decode().rstrip("\0").split("\0")
        started = (process / "stat").read_text().rsplit(") ", 1)[1].split()[19]
        return {"pid": int(pid), "argv": argv, "started": started} if argv[0] else None
    except (OSError, ValueError, IndexError, UnicodeError):
        return None

def owned_document(argv):
    if Path(argv[0]).name.lower() not in ({"freecad"} if role == "mechanical" else {"pcbnew"}):
        return False
    for arg in argv[1:]:
        path = Path(arg)
        if not path.is_absolute() or path.is_symlink():
            continue
        project = path.parent
        if project.parent == base / "runs" and uuid.fullmatch(project.name):
            if path.name in ({"preview.FCMacro", "workspace.FCMacro", "product.step"} if role == "mechanical" else {"board.kicad_pcb"}):
                return True
        if project.parent == base / "checks" and re.fullmatch(r"[A-Za-z0-9-]{1,60}", project.name):
            if path.name == ("preview.FCMacro" if role == "mechanical" else "fixture.kicad_pcb"):
                return True
    return False

records = [root / f"workspace-{role}.json"] if options else list((base / "runs").glob(f"*/workspace-{role}.json"))
targets = {}
for record in records:
    # Blank pcbnew has no document argument. Its persisted PID AND process
    # start-time identify only the process created by this helper.
    if not uuid.fullmatch(record.parent.name):
        continue
    try:
        saved = json.loads(record.read_text())
        current = identity(saved["pid"])
        if current == saved and (owned_document(current["argv"]) or current["argv"] == [application]):
            targets[current["pid"]] = current
    except (OSError, ValueError, KeyError, TypeError):
        continue
if not options:
    for process in Path("/proc").glob("[0-9]*"):
        current = identity(process.name)
        if current and owned_document(current["argv"]):
            targets[current["pid"]] = current
for pid, saved in targets.items():
    if identity(pid) == saved:
        os.kill(pid, signal.SIGTERM)
deadline = time.monotonic() + 3
while any(identity(pid) == saved for pid, saved in targets.items()) and time.monotonic() < deadline:
    time.sleep(0.1)
if any(identity(pid) == saved for pid, saved in targets.items()):
    raise SystemExit("An owned preview is still closing; no unrelated process was stopped")
if options:
    print(json.dumps({"role": role, "closedBlankPids": list(targets), "filesPreserved": True}))
    raise SystemExit(0)

displays = sorted(Path("/tmp/.X11-unix").glob("X[0-9]*"))
if not displays:
    raise SystemExit("No X display is running")
env = os.environ.copy()
env.update(DISPLAY=":" + displays[0].name[1:], LIBGL_ALWAYS_SOFTWARE="1", QT_X11_NO_MITSHM="1")
if role == "mechanical":
    # FreeCAD 1.0 discovers recovery files in its XDG user cache. Per-project
    # cache/temp directories avoid offering recovery of a previous run.
    # Existing recovery/source/artifact files stay untouched.
    temporary = root / "freecad-tmp"
    temporary.mkdir(exist_ok=True)
    env["TMPDIR"] = str(temporary)
    cache = root / "freecad-cache"
    cache.mkdir(exist_ok=True)
    env["XDG_CACHE_HOME"] = str(cache)
    macro = root / "workspace.FCMacro"
    label = "Moki new project " + root.name
    macro.write_text(
        "import FreeCAD as App\nimport FreeCADGui as Gui\n"
        "from PySide2 import QtCore, QtWidgets\n"
        "App.ParamGet('User parameter:BaseApp/Preferences/Mod/Start').SetBool('ShowOnStartup', False)\n"
        "doc = App.newDocument('MokiProject')\n"
        f"doc.Label = {label!r}\n"
        "def show_empty_project():\n"
        "    mdi = Gui.getMainWindow().findChild(QtWidgets.QMdiArea)\n"
        "    if mdi:\n"
        "        for window in mdi.subWindowList():\n"
        "            if window.windowTitle() == 'Start': window.close()\n"
        "    Gui.activeDocument().activeView().viewAxonometric()\n"
        "QtCore.QTimer.singleShot(1500, show_empty_project)\n"
    )
    arguments = [application, str(macro)]
else:
    config = Path.home() / ".config/kicad/9.0"
    config.mkdir(parents=True, exist_ok=True)
    for name in ("fp-lib-table", "sym-lib-table"):
        source = Path("/usr/share/kicad/template") / name
        if source.is_file() and not (config / name).exists():
            shutil.copyfile(source, config / name)
    # No temporary board is created or published as a completed design.
    arguments = [application]
with (root / "workspace.log").open("a") as log:
    process = subprocess.Popen(arguments, env=env, stdout=log, stderr=log, start_new_session=True)
deadline = time.monotonic() + 2
saved = None
while time.monotonic() < deadline:
    saved = identity(process.pid)
    if saved and (owned_document(saved["argv"]) or saved["argv"] == [application]):
        break
    time.sleep(0.05)
if not saved or not (owned_document(saved["argv"]) or saved["argv"] == [application]):
    raise SystemExit("Empty workspace application did not start")
(root / f"workspace-{role}.json").write_text(json.dumps(saved))
print(json.dumps({"role": role, "closedGeneratedPids": list(targets), "blankPid": process.pid,
                  "workspace": str(root), "filesPreserved": True, "designGenerated": False}))
