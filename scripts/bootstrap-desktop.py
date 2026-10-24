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

    # Installed CAD skill uses OCP 7 APIs (including TDF_LabelSequence). Keep
    # its interpreter separate from the newer OCP 8 desktop modeling venv.
    skill_venv = root / ".cad-skill-venv"
    skill_python = skill_venv / "bin/python"
    pinned_check = (
        "import sys; from importlib.metadata import version; "
        "assert sys.version_info[:3] == (3, 12, 12); "
        "assert version('build123d') == '0.11.1'; "
        "assert version('cadquery-ocp') == '7.9.3.1.1'; "
        "from OCP.TDF import TDF_LabelSequence; "
        "from build123d import Box; assert Box(10,20,2).volume > 0"
    )
    ready = skill_python.exists() and subprocess.run(
        [str(skill_python), "-c", pinned_check], stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    ).returncode == 0
    if not ready:
        uv = shutil.which("uv")
        if not uv and (Path.home() / ".local/bin/uv").is_file():
            uv = str(Path.home() / ".local/bin/uv")
        if not uv:
            raise SystemExit("uv is required to provision the isolated CAD skill runtime")
        run([uv, "venv", "--python", "3.12.12", "--clear", str(skill_venv)])
        run([uv, "pip", "install", "--python", str(skill_python),
             "build123d==0.11.1", "cadquery-ocp==7.9.3.1.1"])
        run([str(skill_python), "-c", pinned_check])

if role == "electrical":
    config = Path.home() / ".config/kicad/9.0"
    config.mkdir(parents=True, exist_ok=True)
    for name in ("fp-lib-table", "sym-lib-table"):
        source = Path("/usr/share/kicad/template") / name
        if source.is_file() and not (config / name).exists():
            shutil.copyfile(source, config / name)

application = shutil.which("freecad") or shutil.which("FreeCAD") if role == "mechanical" else shutil.which("kicad")
if not application:
    raise SystemExit("Expected design application was not installed")
report = {"role": role, "application": application, "status": "packages-ready", "kicad_3d_library_included": False}
if role == "mechanical":
    report["cad_skill_runtime"] = {"python": str(skill_python), "pythonVersion": "3.12.12",
                                   "build123d": "0.11.1", "cadquery-ocp": "7.9.3.1.1"}
(root / "environment.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report))
