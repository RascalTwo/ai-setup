# /// script
# requires-python = ">=3.11"
# dependencies = ["trimesh>=4", "numpy"]
# ///
"""Score a GLB against the real object's size: bounding-box error per axis, triangles, file size, watertight.

usage: uv run score.py <model.glb> <width_mm> <height_mm> <depth_mm> [node ...]
glTF is Y-up in metres: x = width, y = height, z = depth. Any extra args are node names that must exist.
"""
import json
import struct
import sys
from pathlib import Path

import trimesh

glb = Path(sys.argv[1])
want = [float(v) for v in sys.argv[2:5]]
need = sys.argv[5:]
scene = trimesh.load(glb, force="scene")
got = [round(float(v) * 1000, 1) for v in scene.extents]
mesh = scene.to_mesh()
err = [round(abs(g - w) / w * 100, 2) for g, w in zip(got, want)]
raw = glb.read_bytes()
names = {n.get("name", "") for n in json.loads(raw[20 : 20 + struct.unpack_from("<I", raw, 12)[0]]).get("nodes", [])}
print(json.dumps({
    "size_kb": round(glb.stat().st_size / 1024, 1),
    "triangles": int(len(mesh.faces)),
    "dims_mm": got,
    "want_mm": want,
    "error_pct": err,
    "within_1pct": max(err) <= 1.0,
    "watertight": bool(mesh.is_watertight),
    "missing_nodes": sorted(set(need) - names),
}, indent=2))
