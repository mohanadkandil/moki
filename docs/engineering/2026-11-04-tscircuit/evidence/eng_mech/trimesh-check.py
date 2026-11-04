import sys, json
sys.path.insert(0, sys.argv[1])
import trimesh
out = {"tool": "trimesh " + trimesh.__version__}
for t in sys.argv[3:]:
    for part in ("base", "lid"):
        m = trimesh.load(f"{sys.argv[2]}/{t}/enclosure-{part}.stl", process=True)
        out[f"{t}/{part}"] = {"watertight": bool(m.is_watertight), "windingConsistent": bool(m.is_winding_consistent), "isVolume": bool(m.is_volume), "bodyCount": int(m.body_count), "eulerNumber": int(m.euler_number), "volumeMm3": round(float(m.volume), 1), "faces": int(len(m.faces))}
print(json.dumps(out, indent=2))
