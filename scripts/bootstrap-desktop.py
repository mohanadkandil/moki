"""Runs inside one Moki sandbox. No service credentials are installed here."""
from pathlib import Path
import json
import shutil
import subprocess
import sys

role = sys.argv[1]
if role not in {"mechanical", "electrical"}:
    raise SystemExit("Unknown desktop role")
root = Path.home() / "moki"
root.mkdir(exist_ok=True)
log = root / "bootstrap.log"

def run(args):
    with log.open("a") as stream:
        result = subprocess.run(args, stdout=stream, stderr=subprocess.STDOUT)
    if result.returncode:
        print(log.read_text()[-5000:])
        raise SystemExit(result.returncode)

packages = ["python3-venv", "python3-pip", "dbus-x11", "libgl1-mesa-dri"]
packages += ["freecad"] if role == "mechanical" else ["kicad", "kicad-symbols", "kicad-footprints"]
run(["sudo", "-n", "apt-get", "update", "-qq"])
run(["sudo", "-n", "env", "DEBIAN_FRONTEND=noninteractive", "apt-get", "install", "-y", "--no-install-recommends", *packages])

if role == "mechanical":
    venv = root / ".venv"
    if not venv.exists():
        run(["/usr/bin/python3", "-m", "venv", str(venv)])
    # The pre-0.13 full-OCP wheel conflicts with the current novtk/proxy dependency family.
    run([str(venv / "bin/pip"), "uninstall", "-y", "cadquery-ocp", "cadquery_vtk"])
    run([str(venv / "bin/pip"), "install", "--disable-pip-version-check", "build123d==0.13.0"])
    run([str(venv / "bin/python"), "-c", "from build123d import Box; assert Box(10,20,2).volume > 0"])

application = shutil.which("freecad") or shutil.which("FreeCAD") if role == "mechanical" else shutil.which("kicad")
if not application:
    raise SystemExit("Expected design application was not installed")
report = {"role": role, "application": application, "status": "packages-ready", "kicad_3d_library_included": False}
(root / "environment.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report))
