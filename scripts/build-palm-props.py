"""Hand-built low-poly fishing landing, in game coordinates (X/Y-up/Z).
Run with Blender --background --python scripts/build-palm-props.py.
The named objects can also be reused separately from the saved Blender file.
"""
import json
import math
import random
import subprocess
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)


def material(name, color):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*[int(color[i:i + 2], 16) / 255 for i in (0, 2, 4)], 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    rgb = mat.diffuse_color[:3]
    shader.inputs['Base Color'].default_value = (
        *[c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in rgb], 1)
    shader.inputs['Roughness'].default_value = .87
    return mat


woods = [material('Sun-worn timber ' + str(i), c) for i, c in enumerate(
    ['b39a76', 'b59c78', 'b19975', 'b49b77'])]
wood_random = random.Random(812)
dark = material('End grain and iron hoops', '58594e')
teal = material('Faded lagoon paint', '488b82')
cream = material('Warm ivory paint', 'e7d8b2')
orange = material('Faded coral floats', 'd88755')
rope_mat = material('Hemp rope', 'c7b48e')

# A sheltered eastern beach, beyond the shoulder and away from the arch.
angle = math.radians(15)
origin = (math.cos(angle) * 69.77, 0, math.sin(angle) * 69.77)
yaw = math.pi / 2 - angle
parts = []


def world(p):
    x, y, z = p
    return (origin[0] + x * math.cos(yaw) + z * math.sin(yaw),
            origin[1] + y,
            origin[2] - x * math.sin(yaw) + z * math.cos(yaw))


def blender(p):
    x, y, z = world(p)
    return Vector((x, -z, y))


def mesh(name, points, faces, mat):
    data = bpy.data.meshes.new(name)
    data.from_pydata([blender(p) for p in points], [], faces)
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(data)
    bm.free()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    data.materials.append(mat)
    parts.append(obj)
    return obj


def box(name, center, size, mat, turn=0):
    points = []
    for x, y, z in [(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
                    (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]:
        x, y, z = x * size[0] / 2, y * size[1] / 2, z * size[2] / 2
        points.append((center[0] + x * math.cos(turn) + z * math.sin(turn),
                       center[1] + y,
                       center[2] - x * math.sin(turn) + z * math.cos(turn)))
    return mesh(name, points, [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
                             (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], mat)


def beam(name, a, b, radius, mat, sides=8, end_radius=None):
    a, b = blender(a), blender(b)
    bpy.ops.mesh.primitive_cone_add(vertices=sides, radius1=radius,
                                   radius2=radius if end_radius is None else end_radius,
                                   depth=(b - a).length, location=(a + b) / 2)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = (b - a).to_track_quat('Z', 'Y')
    obj.data.materials.append(mat)
    parts.append(obj)
    return obj


def rope(name, points, radius=.035):
    for a, b in zip(points, points[1:]):
        beam(name, a, b, radius, rope_mat, 5)


def finish(name, pivot=None):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    if pivot is not None:
        pose = Matrix.Translation(blender(pivot)) @ Matrix.Rotation(yaw, 4, 'Z')
        obj.data.transform(pose.inverted() @ obj.matrix_world)
        obj.matrix_world = pose
    parts.clear()
    return obj


# Uneven individual planks, with visible gaps and supporting beams underneath.
deck = 1.43
for i in range(28):
    box('Deck plank', (.025 * math.sin(i * 5), deck, i * .49),
        (2.65 + .08 * math.sin(i * 2), .17, .455), wood_random.choice(woods), .008 * math.sin(i * 3))
for x in [-.96, .96]:
    box('Long bearer', (x, deck - .27, 6.6), (.18, .32, 13.9), woods[2])
for z in [.3, 4.5, 9, 13.25]:
    for x in [-1.3, 1.3]:
        beam('Jetty piling', (x, -7, z), (x + .04, deck + .62, z), .18, woods[2], 7, .15)
        beam('Pale post cap', (x + .04, deck + .62, z), (x + .04, deck + .67, z), .17, woods[1], 7)
    box('Cross bearer', (0, deck - .32, z), (3, .24, .25), woods[2])
finish('Jetty')

# An open, thick-walled hull: tapered bow, broad transom, interior floor and seats.
boat_origin = (3.15, -.62, 10.1)
outline = [(-.72, -2.3), (-1.03, -1.25), (-1.07, .65), (-.72, 1.8),
           (0, 2.65), (.72, 1.8), (1.07, .65), (1.03, -1.25), (.72, -2.3)]
n = len(outline)


def bp(p):
    return tuple(p[i] + boat_origin[i] for i in range(3))


def hull_band(name, bottom_scale, bottom_y, top_scale, top_y, mat):
    points = [bp((x * scale, y, z * (.87 + .13 * scale)))
              for scale, y in [(bottom_scale, bottom_y), (top_scale, top_y)] for x, z in outline]
    faces = [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    return mesh(name, points, faces, mat)


hull_band('Teal hull', .57, -.33, 1, .72, teal)
hull_band('Ivory rubbing band', .95, .59, 1.005, .73, cream)
hull_band('Inside hull', .55, .02, .89, .71, woods[1])
mesh('Gunwale rim', [bp((x * s, .74, z * (.87 + .13 * s))) for s in [1, .89] for x, z in outline],
     [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)], cream)
mesh('Hull bottom', [bp((x * .57, -.33, z * .944)) for x, z in outline], [tuple(range(n))], teal)
# A complete inner sole covers the painted outer bottom at the bow and stern.
mesh('Wooden inner sole', [bp((x * .55, .02, z * .9415)) for x, z in outline],
     [tuple(range(n))], woods[1])
for i in range(5):
    box('Floor board', bp(((i - 2) * .23, .035, -.15)), (.21, .08, 3.55), wood_random.choice(woods))
for z in [-1.5, .35, 1.5]:
    box('Bench seat', bp((0, .52, z)), (1.75 if z < 1 else 1.12, .13, .39), woods[1])
for x in [-.91, .91]:
    beam('Oar', bp((x, .85, -1.8)), bp((x * .8, .85, 1.15)), .045, woods[2])
    box('Oar blade', bp((x, .85, -1.7)), (.2, .07, .65), woods[1])
boat = finish('Moored_boat', boat_origin)
boat['water_hull_outline'] = outline
boat['mooring_anchors'] = [world((1.32, deck + .4, z)) for z in [9, 13.25]]
boat['mooring_points'] = [(-1.03, .74, -1.25), (-.72, .74, 1.8)]
for post_z, hull_point in [(9, (-1.03, .74, -1.25)), (13.25, (-.72, .74, 1.8))]:
    end = bp(hull_point)
    rope('Mooring line', [(1.32, deck + .4, post_z),
                         ((1.32 + end[0]) / 2, .65, (post_z + end[2]) / 2), end], .032)
finish('Mooring_ropes')


# The landing supplies sit on the actual sloping sand, rather than hovering.
locations = [(-4.1, -1.5), (-3.2, -.5), (-4.7, .7)]
samples = [world((x, 0, z)) for x, z in locations]
code = "import { tropicalHeight } from './app/tropical-map.ts'; console.log(JSON.stringify(" + json.dumps(samples) + ".map(([x,y,z])=>tropicalHeight(x,z))));"
heights = json.loads(subprocess.check_output(
    ['node', '--experimental-strip-types', '--input-type=module', '-e', code], cwd=ROOT, text=True))


def crate(x, y, z, scale=1):
    for side in [-1, 1]:
        for i in range(4):
            box('Crate slat', (x, y + (.12 + i * .22) * scale, z + side * .43 * scale),
                (.94 * scale, .19 * scale, .08 * scale), wood_random.choice(woods))
            box('Crate end', (x + side * .43 * scale, y + (.12 + i * .22) * scale, z),
                (.08 * scale, .19 * scale, .94 * scale), wood_random.choice(woods))
        for end in [-1, 1]:
            box('Crate corner', (x + side * .4 * scale, y + .46 * scale, z + end * .44 * scale),
                (.11 * scale, .98 * scale, .11 * scale), woods[2])
    for i in range(4):
        box('Crate lid', (x + (i - 1.5) * .23 * scale, y + .95 * scale, z),
            (.21 * scale, .08 * scale, .95 * scale), wood_random.choice(woods))


for (x, z), y in zip(locations[:2], heights[:2]):
    crate(x, y - .08, z, 1.2)
crate(locations[0][0] + .09, heights[0] + 1.1, locations[0][1] + .06, .8)
finish('Landing_crates')

x, z = locations[2]
y = heights[2] - .06
for i, (low, high, r1, r2) in enumerate([(0, .2, .43, .51), (.2, .65, .51, .56),
                                        (.65, 1.1, .56, .51), (1.1, 1.3, .51, .43)]):
    beam('Barrel staves', (x, y + low, z), (x, y + high, z), r1, wood_random.choice(woods), 12, r2)
for h, r in [(.2, .525), (1.08, .525)]:
    beam('Iron barrel hoop', (x, y + h, z), (x, y + h + .075, z), r, dark, 12)
finish('Landing_barrel')

# Two faceted fishing floats mark the mooring, with narrow poles and pennants.
for i, (x, z) in enumerate([(5.4, 16.5), (-3.2, 20)]):
    beam('Buoy bottom', (x, -.93, z), (x, -.25, z), .3, cream, 10, .54)
    beam('Buoy shoulder', (x, -.25, z), (x, .12, z), .54, orange, 10, .2)
    beam('Marker pole', (x, .1, z), (x, 1.45, z), .035, woods[2], 6)
    mesh('Pennant', [(x, 1.43, z), (x + .57, 1.23, z), (x, 1.06, z)], [(0, 1, 2)], orange)
    finish('Fishing_buoy_' + str(i + 1), (x, -.6, z))

# A compact cabin yacht at anchor beyond the landing, turned slightly across it.
landing_origin, landing_yaw = origin, yaw
origin = world((-7, 0, 34))
yaw += .5
ivory = material('Yacht ivory fiberglass', 'eee7d6')
navy = material('Yacht blue waterline', '466d7a')
glass = material('Smoky blue glazing', '365560')
glass.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value = .24
steel = material('Warm stainless railings', 'babfb6')
outline_yacht = [(-1.28, -4.5), (-1.65, -2.6), (-1.62, .6), (-1.14, 3.3),
                 (0, 5.1), (1.14, 3.3), (1.62, .6), (1.65, -2.6), (1.28, -4.5)]
count = len(outline_yacht)
# The painted stripe is part of the hull surface, not a second shell over it.
stripe_bottom = (.91 + .09 * (.51 + .5) / 1.18, .51)
stripe_top = (.91 + .09 * (.65 + .5) / 1.18, .65)
for name, lower, upper, mat in [
    ('Underwater hull', (.62, -1.12), (.91, -.5), navy),
    ('Ivory topsides', (.91, -.5), stripe_bottom, ivory),
    ('Fine sheer stripe', stripe_bottom, stripe_top, navy),
    ('Ivory gunwale', stripe_top, (1, .68), ivory),
]:
    points = [(x * scale, height + max(0, z) * .04, z * (.9 + .1 * scale))
              for scale, height in [lower, upper] for x, z in outline_yacht]
    mesh(name, points, [(i, (i + 1) % count, (i + 1) % count + count, i + count)
                        for i in range(count)], mat)
mesh('Keel bottom', [(x * .62, -1.12, z * .962) for x, z in outline_yacht],
     [tuple(range(count))], navy)
mesh('Deck', [(x, .68 + max(0, z) * .04, z) for x, z in outline_yacht],
     [tuple(range(count))], ivory)
# Sloping windshield and a low cabin keep the silhouette light and nautical.
mesh('Cabin', [(-1.17, .74, -1.65), (1.17, .74, -1.65), (1.17, .78, 2.05), (-1.17, .78, 2.05),
               (-1.03, 2.3, -1.5), (1.03, 2.3, -1.5), (1.03, 2.3, 1.03), (-1.03, 2.3, 1.03)],
     [(0, 1, 2, 3), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0), (4, 7, 6, 5)], ivory)
mesh('Windshield', [(-1.03, 1.27, 1.74), (1.03, 1.27, 1.74),
                    (.95, 2.19, 1.115), (-.95, 2.19, 1.115)], [(0, 1, 2, 3)], glass)
beam('Windshield mullion', (0, 1.27, 1.75), (0, 2.2, 1.12), .035, ivory, 6)
for side in [-1, 1]:
    mesh('Cabin side window', [(side * 1.13, 1.28, -1.24), (side * 1.13, 1.28, 1.65),
                               (side * 1.049, 2.17, 1.0), (side * 1.049, 2.17, -1.24)],
         [(0, 1, 2, 3)], glass)
    beam('Window pillar', (side * 1.14, 1.28, -.35), (side * 1.06, 2.18, -.35), .035, ivory, 6)
box('Cabin roof', (0, 2.38, -.35), (2.55, .18, 3.4), ivory)
box('Roof hatch', (0, 2.485, -.3), (.77, .04, .9), glass)
beam('Short antenna', (.7, 2.48, -1.5), (.7, 3.45, -1.5), .025, steel, 6)
# Teak cockpit, upholstered stern bench, and a small bathing platform.
for i in range(9):
    box('Cockpit teak', ((i - 4) * .28, .735, -3.12), (.26, .055, 2.15), wood_random.choice(woods))
box('Stern seat base', (0, .94, -3.84), (2.35, .4, .63), ivory)
box('Stern cushion', (0, 1.18, -3.84), (2.34, .12, .65), cream)
box('Seat back', (0, 1.44, -4.12), (2.34, .48, .14), cream)
box('Swim platform', (0, .15, -4.78), (2.25, .14, .65), woods[0])
for side in [-1, 1]:
    rail = [(side * 1.42, 1.25, .25), (side * 1.08, 1.4, 3.05), (side * .16, 1.5, 4.78)]
    for x, y, z in rail:
        beam('Bow stanchion', (x, .7 + max(0, z) * .04, z), (x, y, z), .025, steel, 6)
    for a, b in zip(rail, rail[1:]):
        beam('Bow rail', a, b, .027, steel, 6)
    for z in [-2.3, -.7]:
        beam('Hanging fender', (side * 1.7, -.12, z), (side * 1.7, .55, z), .14, cream, 8)
# An anchor rode descends from the bow into the sea.
rope('Anchor rode', [(0, .91, 5.08), (0, -.8, 6.7), (0, -3, 7.6)], .028)
finish('Offshore_yacht', (0, 0, 0))
origin, yaw = landing_origin, landing_yaw

bpy.ops.object.select_all(action='SELECT')
bpy.context.preferences.filepaths.save_version = 0
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.region_3d.view_distance = 36
            area.spaces.active.region_3d.view_location = blender((0, 0, 7))
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'assets/palm-cove-props.blend'))
bpy.ops.export_scene.gltf(filepath=str(ROOT / 'public/models/props-palm-cove.glb'),
                          export_format='GLB', use_selection=True, export_yup=True, export_extras=True)
print('Fishing landing faces:', sum(len(o.data.polygons) for o in bpy.context.scene.objects if o.type == 'MESH'))
