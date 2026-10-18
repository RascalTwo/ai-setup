"""Render a bakeoff GLB the same way for every contender, so looks are compared like for like.

usage: Blender --background --factory-startup --python render.py -- <model.glb> <out.png>
"""
import math
import sys

import bpy
from mathutils import Vector

glb, out = sys.argv[sys.argv.index("--") + 1 :][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
corners = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
lo = Vector(min(c[i] for c in corners) for i in range(3))
hi = Vector(max(c[i] for c in corners) for i in range(3))
centre, size = (lo + hi) / 2, max(hi - lo)

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x, scene.render.resolution_y = 1200, 900
scene.render.filepath = out
world = bpy.data.worlds.new("w")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.12, 0.13, 0.16, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.6
scene.world = world

# glTF +Z (front) arrives as Blender -Y, glTF Y-up as Blender Z-up: front-left, slightly above
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
scene.collection.objects.link(cam)
d = size * 3.4
cam.location = centre + Vector((-d * 0.55, -d * 0.8, d * 0.35))
cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
cam.data.lens = 50
scene.camera = cam
for loc, power in (((-2, -3, 3), 400), ((3, -1, 2), 150), ((0, 3, 3), 200)):
    light = bpy.data.objects.new("l", bpy.data.lights.new("l", "AREA"))
    light.data.energy, light.data.size = power * size, size * 2
    light.location = centre + Vector(loc) * size
    light.rotation_euler = (centre - light.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(light)
bpy.ops.render.render(write_still=True)
