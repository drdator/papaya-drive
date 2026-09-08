"""Palm Cove's hand-shaped, low-poly rock outcrop.
Run: Blender --background --python scripts/build-palm-mountain.py
Blockout coordinates use game X/Y-up/Z; Blender stores X/-Z/Y.
"""
import math
import json
import random
import subprocess
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

stone = bpy.data.materials.new('Granite • warm faces and blue-grey fractures')
stone.use_nodes = True
nodes = stone.node_tree.nodes
bsdf = nodes.get('Principled BSDF')
bsdf.inputs['Roughness'].default_value = 1
color_node = nodes.new('ShaderNodeVertexColor')
color_node.layer_name = 'Rock faces'
stone.node_tree.links.new(color_node.outputs['Color'], bsdf.inputs['Base Color'])


def linear(c):
    return c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4


def hull(name, points, tint=0, detail=True):
    """A few deliberate fracture planes, with no smoothing or voxel remeshing."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    for x, y, z in points:
        bm.verts.new((x, -z, y))
    result = bmesh.ops.convex_hull(bm, input=list(bm.verts))
    unused = [v for v in result['geom_unused'] + result['geom_interior'] if isinstance(v, bmesh.types.BMVert)]
    bmesh.ops.delete(bm, geom=list(set(unused)), context='VERTS')
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    # Split the large planes once and add shallow weathering at the new points.
    # Original corners stay fixed, preserving the approved silhouette.
    if detail:
        corners = set(bm.verts)
        bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=3 if name.startswith('01') else 1, use_grid_fill=True)
        bm.normal_update()
        for vertex in bm.verts:
            if vertex not in corners:
                x, y, z = vertex.co
                relief = .24 * math.sin(x * .61 + z * .43) * math.cos(y * .47 - z * .19)
                vertex.co += vertex.normal * relief
    if name.startswith('01'):
        # Carve into the front face, leaving the crown and buried foot intact.
        # Extra topology is limited to this rock so the recesses have real depth.
        for vertex in bm.verts:
            x, by, height = vertex.co
            front = max(0, min(1, (-by + 1) / 5))
            span = max(0, 1 - ((height - 34) / 17) ** 4)
            groove_x = -1.5 + .12 * (height - 30)
            groove = 2.6 * math.exp(-.5 * ((x - groove_x) / 2.5) ** 2) * span
            ledge = 1.8 * max(0, 1 - abs(height - (27 + x * .22)) / 2.8)
            ledge *= math.exp(-.5 * ((x - 3) / 5) ** 2)
            vertex.co.y += front * (groove + ledge)
            # A shorter chip in the eastern face makes the detail read from the track.
            east = max(0, min(1, (x - 5) / 5))
            chip = 1.8 * math.exp(-.5 * (((height - 39) / 4) ** 2 + ((by + 1) / 3) ** 2))
            vertex.co.x -= east * chip
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    mesh.materials.append(stone)
    colors = mesh.color_attributes.new(name='Rock faces', type='FLOAT_COLOR', domain='CORNER')
    for face in mesh.polygons:
        # Color uses each vertex's world height (Blender Z = game Y), so the
        # cool foot becomes warm stone and finally pale, sun-bleached limestone.
        variation = .018 * math.sin(face.index * 7.31 + tint * 9)
        orientation = face.normal.x * .026 + face.normal.y * .018
        for loop in face.loop_indices:
            p = mesh.vertices[mesh.loops[loop].vertex_index].co
            h = max(0, min(1, (p.z - 5) / 49))
            lower = (.30, .355, .43)
            middle = (.59, .495, .43)
            upper = (.80, .74, .655)
            t = min(1, h * 2)
            u = max(0, h * 2 - 1)
            band = .012 * math.sin(p.z * .48 + p.x * .035)
            rgb = [((lower[i] * (1 - t) + middle[i] * t) * (1 - u)
                    + upper[i] * u + variation + orientation + band + tint) for i in range(3)]
            colors.data[loop].color = (*[linear(min(.9, max(.1, c))) for c in rgb], 1)
    return obj


# Uneven outlines, rotated independently, make split rock slabs rather than
# lathed cylinders. Their buried feet overlap; exposed seams read as fractures.
def rock(name, cx, cz, rx, rz, height, lean, phase, tint=0, crown=(.86, .56)):
    outline = [(1, .04), (.52, .88), (-.38, 1), (-1, .32), (-.73, -.71), (.16, -1), (.88, -.57)]
    points = []
    for level, (y, scale, shift) in enumerate([(-5, 1.1, 0), (height * .38, 1, .25), (height * crown[0], .82, .8), (height, crown[1], 1)]):
        for i, (u, v) in enumerate(outline):
            angle = phase + (.1 if level == 1 else 0)
            x = (u * math.cos(angle) - v * math.sin(angle)) * rx * scale
            z = (u * math.sin(angle) + v * math.cos(angle)) * rz * scale
            top = (u * 2.8 + v * 1.9 + .8 * math.sin(i * 3 + phase)) if level else 0
            points.append((cx + x + lean[0] * shift, y + top, cz + z + lean[1] * shift))
    return hull(name, points, tint)

rock('01 • leaning pale summit', 1, -6, 15, 13, 54, (-7, -2), .18, .015, (.91, .62))
rock('02 • split western face', -15, 2, 10, 12, 31, (-3, 1), .6, -.005, (.76, .4))
rock('03 • rear ridge', 15, -8, 15, 13, 39, (3, -2), -.3, -.01, (.93, .7))
rock('04 • inland arch buttress', 31, 0, 14, 12, 33, (2, -2), .2, .015)
rock('05 • front fractured slab', 11, 16, 12, 9, 25, (-4, -2), -.2, .025, (.8, .45))
rock('06 • low talus wedge', -6, 21, 9, 6, 14, (2, -2), .5, -.005, (.65, .3))
rock('07 • eastern talus', 28, 15, 9, 8, 18, (-2, -2), -.3, -.025)

# The passage is the gap beneath a tilted roof slab and a leaning sea stack.
# There is no extruded semicircle: its asymmetrical underside and jagged mouth
# are just the faces of the rock masses. Keep x=48..57 clear for the beach lane.
hull('08 • leaning seaward stack', [
    (60,-5,-8),(69,-5,-6),(69,-5,7),(61,-5,10),
    (59,11,-7),(68,12,-4),(67,10,8),(60,11,9),
    (57.5,23,-4),(63,25,-3),(65,21,5),(59,22,6),
], -.005)
hull('09 • diagonal natural rock roof', [
    (30,24,-10),(32,23,10),(43,16,11),(44,16,-9),
    (57,13,-5),(59,14,7),(65,19,4),(63,20,-6),
    (31,35,-7),(34,36,5),(44,31,9),(47,32,-7),
    (59,25,-4),(63,23,3),
], .02)

# A few smaller split stones seat the formation into the earth skirt.
rock('10 • west scree', -24, 12, 5, 6, 9, (1, 0), .4)
rock('11 • front scree', 19, 26, 6, 4, 10, (-1, -1), -.4, .01)

# Loose stone gathers in uneven pockets around the foot, with larger fragments
# nearest the cliff and chips farther out. Sample the actual game terrain so the
# asset stays seated when the island's slopes change, and keep the beach lane clear.
rng = random.Random(23)
candidates = []
for cx, cz in [(-29, 6), (-25, 20), (-10, 29), (7, 30), (26, 30),
               (39, 16), (32, -21), (13, -26), (-8, -25), (-23, -12)]:
    for i in range(5):
        angle = rng.uniform(0, math.tau)
        distance = 0 if i == 0 else rng.uniform(2, 5)
        radius = rng.uniform(1.8, 2.8) if i == 0 else rng.uniform(.45, 1.35)
        candidates.append(dict(x=cx + math.cos(angle) * distance,
                               z=cz + math.sin(angle) * distance,
                               radius=radius, angle=angle,
                               height=radius * rng.uniform(.55, 1.15)))
query = """
import { tropicalHeight, tropicalRoute } from './app/tropical-map.ts';
let input = '';
for await (const chunk of process.stdin) input += chunk;
console.log(JSON.stringify(JSON.parse(input).map(p => ({...p,
  ground: tropicalHeight(p.x, p.z), road: tropicalRoute.distanceToRoad(p.x, p.z)
}))));
"""
samples = json.loads(subprocess.run(
    ['node', '--experimental-strip-types', '--input-type=module', '-e', query],
    cwd=ROOT, input=json.dumps(candidates), capture_output=True, text=True, check=True,
).stdout)
bpy.context.view_layer.update()
cliffs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
count = 0
for sample in samples:
    x, z, radius, height = (sample[k] for k in ('x', 'z', 'radius', 'height'))
    ground, angle = sample['ground'], sample['angle']
    if sample['road'] < 7 + radius or ground < 1:
        continue
    # Avoid fragments hidden inside an existing cliff or perched up on its roof.
    covered = False
    for cliff in cliffs:
        hit, point, _, _ = cliff.ray_cast(Vector((x, -z, 80)), Vector((0, 0, -1)))
        if hit and point.z > ground + height * .6:
            covered = True
            break
    if covered:
        continue
    points = []
    for layer, (y, scale) in enumerate([(ground - radius - .6, 1),
                                       (ground + height * .4, 1),
                                       (ground + height, .52)]):
        for i in range(5):
            a = angle + math.tau * i / 5
            r = radius * scale * (1 + .12 * math.sin(i * 2.1 + angle))
            points.append((x + math.cos(a) * r + layer * radius * .12,
                           y + (math.cos(a) * height * .18 if layer else 0),
                           z + math.sin(a) * r * .7))
    hull(f'Ground fragment {count + 1:02}', points, rng.uniform(-.01, .06), detail=False)
    count += 1
print(f'Ground fragments: {count}')

bpy.ops.object.select_all(action='SELECT')
bpy.context.view_layer.objects.active = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.region_3d.view_distance = 125
            area.spaces.active.region_3d.view_location = (22, 0, 22)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'assets/palm-cove-mountain.blend'))
bpy.ops.export_scene.gltf(filepath=str(ROOT / 'public/models/mountain-palm-cove.glb'), export_format='GLB', use_selection=True, export_yup=True)
print('Rock faces:', sum(len(o.data.polygons) for o in bpy.context.scene.objects if o.type == 'MESH'))
