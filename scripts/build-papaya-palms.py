"""Build Papaya's palms from the neighboring low-poly palm pack design.
Continuous bark and subtle foliage colors keep the facets without checkerboard bands.
Run: Blender --background --python scripts/build-papaya-palms.py
"""
import bpy
import bmesh
import math
import random
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/models'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
assets = bpy.data.collections.get('Collection')
if assets is None:
    assets = bpy.data.collections.new('Collection')
    bpy.context.scene.collection.children.link(assets)
assets.name = 'PALMS • three game assets'


def material(name, rgb):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*rgb, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Roughness'].default_value = .83
    return mat


bark = [material('Palm bark • ' + name, color) for name, color in [
    ('cedar', (.43, .24, .105))]]
leaves = [material('Palm foliage • ' + name, color) for name, color in [
    ('green', (.23, .43, .17)), ('sunlit', (.245, .45, .18)),
    ('shade', (.215, .41, .16)), ('young', (.255, .46, .185))]]
coconut = material('Coconut • umber', (.25, .125, .055))


def mesh(name, verts, faces, palette, indices):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    assets.objects.link(obj)
    for mat in palette:
        data.materials.append(mat)
    for face, index in zip(data.polygons, indices):
        face.material_index = index
        face.use_smooth = False
    return obj


def trunk(height, lean, radius):
    # Continuous seven-sided taper; lighting defines the facets, without alternating rings.
    verts, faces, indices = [], [], []
    rings = 13
    sides = 7
    for row in range(rings):
        t = row / (rings - 1)
        center = Vector((lean[0] * t * t, lean[1] * t * t, height * t))
        r = radius * (1 - .48 * t)
        if row == 0:
            r *= 1.22
        for i in range(sides):
            angle = math.tau * i / sides
            verts.append(center + Vector((r * math.cos(angle), r * math.sin(angle), 0)))
    faces.append(tuple(reversed(range(sides))))
    indices.append(0)
    for row in range(rings - 1):
        for i in range(sides):
            a = row * sides + i
            b = row * sides + (i + 1) % sides
            faces.append((a, b, b + sides, a + sides))
            indices.append(0)
    faces.append(tuple(range((rings - 1) * sides, rings * sides)))
    indices.append(0)
    return mesh('Faceted curved trunk', verts, faces, bark, indices)


def frond(crown, angle, length, width, lift, droop, tint, split=False):
    # Closed, folded leaves have visible undersides in any engine without alpha cards.
    direction = Vector((math.cos(angle), math.sin(angle), 0))
    side = Vector((-math.sin(angle), math.cos(angle), 0))
    verts = [crown]
    stations = [(0.20, .62), (.43, 1.0), (.67, .77), (.85, .40)]
    if split:
        stations = [(.16, .55), (.28, 1), (.32, .37), (.44, .96),
                    (.48, .32), (.60, .80), (.64, .24), (.76, .59),
                    (.80, .18), (.90, .32)]
    for t, spread in stations:
        center = crown + direction * length * t
        center.z += lift * math.sin(math.pi * t) - droop * t * t
        w = width * spread
        verts.extend([
            center + Vector((0, 0, w * .28)),
            center + side * w,
            center - Vector((0, 0, .025)),
            center - side * w,
        ])
    tip = crown + direction * length
    tip.z -= droop
    verts.append(tip)
    faces, indices = [], []
    # Diamond cross-section, with a light ridge and two darker underside facets.
    colors = [tint, 2, 2, 0]
    for j in range(4):
        faces.append((0, 1 + j, 1 + (j + 1) % 4))
        indices.append(colors[j])
    for row in range(len(stations) - 1):
        for j in range(4):
            a = 1 + row * 4 + j
            b = 1 + row * 4 + (j + 1) % 4
            faces.append((a, a + 4, b + 4, b))
            indices.append(colors[j])
    for j in range(4):
        a = 1 + (len(stations) - 1) * 4 + j
        b = 1 + (len(stations) - 1) * 4 + (j + 1) % 4
        faces.append((a, len(verts) - 1, b))
        indices.append(colors[j])
    return mesh('Split frond' if split else 'Slender folded frond', verts, faces, leaves, indices)


def fan_leaf(crown, angle, length, tilt, tint):
    direction = Vector((math.cos(angle), math.sin(angle), 0))
    side = Vector((-math.sin(angle), math.cos(angle), 0))
    forward = direction * math.cos(tilt) + Vector((0, 0, math.sin(tilt)))
    normal = forward.cross(side)
    root = crown + forward * .28
    # A broad polygonal fan with one gentle fold and an unbroken outer edge.
    bpy.ops.mesh.primitive_cone_add(vertices=5, radius1=.045, radius2=.028,
                                   depth=.30, location=crown + forward * .14)
    stalk = bpy.context.object
    stalk.name = 'Fan leaf stalk'
    stalk.rotation_euler = forward.to_track_quat('Z', 'Y').to_euler()
    stalk.data.materials.append(leaves[0])
    outline = []
    for i in range(5):
        theta = math.radians(-60 + i * 30)
        point = root + (forward * math.cos(theta) + side * math.sin(theta)) * length
        point += normal * (.07 * (1 - abs(i - 2) / 2))
        outline.append(point)
    verts = [root + normal * .014, root - normal * .014]
    for point in outline:
        verts.extend([point + normal * .014, point - normal * .014])
    faces, indices = [], []
    for i in range(len(outline) - 1):
        a = 2 + i * 2
        faces.extend([(0, a, a + 2), (1, a + 3, a + 1), (a, a + 1, a + 3, a + 2)])
        indices.extend([tint if i < 2 else 0, 2, 2])
    faces.extend([(0, 1, 3, 2), (0, len(verts) - 2, len(verts) - 1, 1)])
    indices.extend([2, 2])
    return [stalk, mesh('Simple broad fan leaf', verts, faces, leaves, indices)]


models, stats = [], {}


def palm(name, height, lean, radius, reach, count, seed, display, leaf_style, coconuts=False):
    rng = random.Random(seed)
    parts = [trunk(height, lean, radius)]
    crown = Vector((*lean, height))
    if leaf_style == 'fan':
        for i in range(count):
            angle = math.tau * i / count + .15
            parts.extend(fan_leaf(crown, angle, reach * rng.uniform(.66, .76),
                                  math.radians(rng.uniform(8, 30)), i % 2))
        for i in range(2):
            parts.extend(fan_leaf(crown, math.tau * (i + .2) / 2, reach * .52,
                                  math.radians(60), 1))
    else:
        split = leaf_style == 'split'
        for i in range(count):
            angle = math.tau * i / count + .22 + rng.uniform(-.12, .12)
            parts.append(frond(crown, angle, reach * rng.uniform(.90, 1.12),
                               reach * (.27 if split else .105), .30 if split else .48,
                               reach * rng.uniform(.27, .40) if split else reach * rng.uniform(.56, .74),
                               i % 2, split))
        for i in range(3):
            angle = math.tau * (i + .35) / 3
            parts.append(frond(crown + Vector((0, 0, .055)), angle, reach * .65,
                               reach * (.18 if split else .085), .52, .10,
                               3 if i % 2 else 1, split))
    if coconuts:
        for i in range(3):
            angle = math.tau * i / 3 - .8
            location = crown + Vector((.22 * math.cos(angle), .22 * math.sin(angle), -.19))
            bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=.19, location=location)
            obj = bpy.context.object
            obj.name = 'Angular coconut'
            obj.scale = (1, .92, 1.12)
            obj.data.materials.append(coconut)
            parts.append(obj)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    bm = bmesh.new()
    bm.from_mesh(bpy.context.object.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(bpy.context.object.data)
    bm.free()
    obj = bpy.context.object
    obj.name = name
    bpy.context.scene.cursor.location = (0, 0, 0)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    tri = obj.modifiers.new('Game triangles', 'TRIANGULATE')
    bpy.ops.object.modifier_apply(modifier=tri.name)
    obj['asset'] = 'Low-poly palm • meter scale • ground-level origin'
    stats[name] = len(obj.data.polygons)
    assert all(len(face.vertices) == 3 for face in obj.data.polygons)
    assert abs(min(v.co.z for v in obj.data.vertices)) < .0001
    bpy.ops.export_scene.gltf(filepath=str(OUT / (name + '.glb')), use_selection=True,
                             export_format='GLB', export_yup=True)
    obj.location = display
    models.append(obj)


palm('tree-palm-tall', 3.35, (.16, .02), .19, 1.52, 9, 41, (-3.8, 0, 0), 'slender')
palm('tree-palm-curved', 3.65, (.86, .05), .20, 1.65, 6, 42, (0, .25, 0), 'split', True)
palm('tree-palm-short', 1.85, (-.10, 0), .23, 1.42, 5, 43, (4, -.20, 0), 'fan', True)


bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'assets/papaya-palms.blend'))
print('Palm triangles:', stats)
