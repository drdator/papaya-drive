"""Build Papaya City's low-poly streetscape and editable Blender source.
Run: Blender --background --python scripts/build-papaya-city.py
Coordinates are game X/Y-up/Z; materials are batched for a lightweight GLB.
"""
import json
import subprocess
import math
import random
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
rng = random.Random(2048)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
buckets = {}
# Use the game's terrain samples and block transforms, keeping the editable
# Blender scene in exactly the same coordinates as the drivable heightfield.
layout = json.loads(subprocess.check_output([
    'node', '--experimental-strip-types', str(ROOT / 'scripts/export-city-layout.ts')]))
blocks = {(b['x'], b['z']): b for b in layout['blocks']}
active_block = None
active_car_pose = None


def world_point(x, z):
    return (1.4 * x + 26 * math.sin(z / 65) + 12 * math.sin(x / 70 + z / 110),
            1.35 * z + 24 * math.sin(x / 78) - 14 * math.cos(z / 65))


def ground_height(x, z):
    u, v = (x - layout['min']) / layout['step'], (z - layout['min']) / layout['step']
    i, j = max(0, min(399, int(u))), max(0, min(399, int(v)))
    u, v = max(0, min(1, u - i)), max(0, min(1, v - j))
    h = layout['heights']
    return ((h[j][i] * (1-u) + h[j][i+1] * u) * (1-v)
            + (h[j+1][i] * (1-u) + h[j+1][i+1] * u) * v)


def transform(x, y, z, category):
    if category.startswith('City_streets'):
        return x, y, z
    if active_car_pose is not None and category != 'Road_paint':
        cx, cz, center, right, up, forward = active_car_pose
        p = center + right * (x-cx) + up * (y-1) + forward * (z-cz)
        return tuple(p)
    if active_block is not None and category != 'Road_paint':
        b = active_block
        dx, dz = x - b['x'], z - b['z']
        c, s = math.cos(b['angle']), math.sin(b['angle'])
        return b['wx'] + dx*c - dz*s, y + b['height'] - 1, b['wz'] + dx*s + dz*c
    wx, wz = world_point(x, z)
    return wx, y + ground_height(wx, wz) - 1, wz


def road_open(x, z):
    if abs(x) > 120.1 or abs(z) > 120.1:
        return False
    for ax, az, bx, bz in layout['closedLinks']:
        if ax == bx and abs(x-ax) < 7 and az+.1 < z < bz-.1:
            return False
        if az == bz and abs(z-az) < 7 and ax+.1 < x < bx-.1:
            return False
    return True



def material(name, color, roughness=1):
    mat = bpy.data.materials.new(name)
    rgb = [int(color[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    mat.diffuse_color = (*rgb, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (
        *[c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in rgb], 1)
    shader.inputs['Roughness'].default_value = roughness
    return mat


walls = [material('Facade_' + str(i), c) for i, c in enumerate(
    ['d39d80', 'a7b49a', 'decba5', '96b3b8', 'bc8773', 'd8cbb7'])]
cream = material('Limestone_trim', 'e3d8bd')
sidewalk = material('Sidewalk', 'bcb9aa')
asphalt = material('Asphalt', '576268')
curb_stone = material('Curb_stone', 'b0ad9c')
roof = material('Terracotta_roofs', 'a17a67')
roof_dark = material('Slate_roofs', '68767a')
glass = material('Blue_glazing', '45666f', .32)
window_lit = material('Warm_windows', 'cbbd96', .6)
metal = material('Street_metal', '475c59', .75)
rubber = material('Tires', '303c3c')
wood = material('Weathered_wood', 'ae9270')
leaf = [material('Tree_canopy_' + str(i), c) for i, c in enumerate(['66916a', '86a765', '4e8066'])]
lawn = material('Park_lawn', '86a86c')
paint = material('Road_paint', 'eee5cb')
yellow = material('Ochre', 'd6b568')
coral = material('Coral', 'c87560')
teal = material('Teal', '679b99')
red = material('Traffic_red', 'c76655')
green = material('Traffic_green', '8fbd88')
pool = material('Fountain_water', '78b9b6', .3)


def add(points, faces, mat, category='City_details'):
    key = (category, mat.name)
    vertices, polygons = buckets.setdefault(key, ([], []))
    offset = len(vertices)
    vertices.extend((wx, -wz, wy) for wx, wy, wz in
                    (transform(x, y, z, category) for x, y, z in points))
    polygons.extend(tuple(offset + i for i in face) for face in faces)


def box(center, size, mat, category='City_details', turn=0):
    points = []
    for x, y, z in [(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
                    (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]:
        x, y, z = x * size[0] / 2, y * size[1] / 2, z * size[2] / 2
        points.append((center[0] + x * math.cos(turn) + z * math.sin(turn),
                       center[1] + y, center[2] - x * math.sin(turn) + z * math.cos(turn)))
    add(points, [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
                 (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], mat, category)


def beam(a, b, radius, mat, category='City_details', sides=8, top_radius=None):
    a, b = Vector(a), Vector(b)
    axis = (b - a).normalized()
    side = axis.cross(Vector((0, 0, 1)) if abs(axis.z) < .9 else Vector((1, 0, 0))).normalized()
    other = axis.cross(side)
    points = []
    for center, r in [(a, radius), (b, radius if top_radius is None else top_radius)]:
        for i in range(sides):
            angle = math.tau * i / sides
            points.append(center + r * (side * math.cos(angle) + other * math.sin(angle)))
    faces = [tuple(reversed(range(sides))), tuple(range(sides, sides * 2))]
    faces += [(i, (i + 1) % sides, (i + 1) % sides + sides, i + sides) for i in range(sides)]
    add(points, faces, mat, category)


# Reuse one faceted crown shape; no dense spheres or texture dependencies.
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1)
template = bpy.context.object
crown_vertices = [v.co.copy() for v in template.data.vertices]
crown_faces = [tuple(p.vertices) for p in template.data.polygons]
bpy.data.objects.remove(template, do_unlink=True)


def crown(center, size, mat):
    add([(center[0] + p.x * size[0], center[1] + p.y * size[1], center[2] + p.z * size[2])
         for p in crown_vertices], crown_faces, mat)


def tree(x, z, size=1):
    beam((x, 1.28, z), (x + .15, 4.1 * size, z), .19 * size, wood, 'City_solids', 7)
    crown((x, 4.8 * size, z), (1.6 * size, 2.05 * size, 1.6 * size), rng.choice(leaf))
    box((x, 1.35, z), (2.4, .15, 2.4), lawn)
    for dx, dz, sx, sz in [(0, -1.25, 2.6, .13), (0, 1.25, 2.6, .13), (-1.25, 0, .13, 2.4), (1.25, 0, .13, 2.4)]:
        box((x + dx, 1.41, z + dz), (sx, .24, sz), cream, 'City_solids')


def bench(x, z, turn=0):
    def local(dx, y, dz):
        return (x + dx * math.cos(turn) + dz * math.sin(turn), y,
                z - dx * math.sin(turn) + dz * math.cos(turn))
    for dx in [-.85, .85]:
        box(local(dx, 1.55, 0), (.12, .6, .65), metal, 'City_solids', turn)
    for dz in [-.23, 0, .23]:
        box(local(0, 1.86, dz), (2.1, .1, .2), wood, turn=turn)
    for y in [2.1, 2.36]:
        box(local(0, y, -.32), (2.1, .19, .08), wood, turn=turn)


def lamp(x, z, turn=0):
    beam((x, 1.28, z), (x, 6.3, z), .095, metal, 'City_solids')
    end = (x + math.cos(turn) * .95, 6.3, z + math.sin(turn) * .95)
    beam((x, 6.3, z), end, .085, metal)
    box(end, (.95, .17, .43), metal, turn=-turn)
    box((end[0], 6.2, end[2]), (.7, .04, .3), cream, turn=-turn)


def label(text, x, y, z, width):
    bpy.ops.object.text_add(location=(x, -z, y), rotation=(math.pi / 2, 0, 0))
    obj = bpy.context.object
    obj.data.body = text
    obj.data.align_x = 'CENTER'
    obj.data.size = .62
    obj.data.resolution_u = 2
    bpy.context.view_layer.update()
    if obj.dimensions.x > width:
        obj.scale *= width / obj.dimensions.x
    bpy.ops.object.convert(target='MESH')
    obj = bpy.context.object
    points = [obj.matrix_world @ v.co for v in obj.data.vertices]
    add([(p.x, p.z, -p.y) for p in points], [tuple(p.vertices) for p in obj.data.polygons], cream)
    bpy.data.objects.remove(obj, do_unlink=True)


def awning(x, y, z, width, color):
    for i in range(6):
        left = x - width / 2 + width * i / 6
        right = left + width / 6
        add([(left, y, z), (right, y, z), (right, y - .45, z + 1.35), (left, y - .45, z + 1.35)],
            [(0, 1, 2, 3)], color if i % 2 else cream)
        box(((left + right) / 2, y - .57, z + 1.35), (width / 6, .24, .07), color if i % 2 else cream)


def building(cx, cz, width, depth, floors, tint, kind, shop):
    base = 1.28
    height = floors * 3.1 + .3
    top = base + height
    box((cx, base + height / 2, cz), (width, height, depth), tint, 'City_solids')
    box((cx, base + .25, cz), (width + .16, .5, depth + .16), cream)
    box((cx, top + .12, cz), (width + .7, .26, depth + .7), cream)
    box((cx, top + .3, cz), (width - .3, .12, depth - .3), roof_dark if kind == 'office' else roof)
    if kind == 'terrace':
        w, d, y = width / 2 + .5, depth / 2 + .5, top + .25
        points = [(cx - w, y, cz - d), (cx + w, y, cz - d),
                  (cx + w, y, cz + d), (cx - w, y, cz + d),
                  (cx, y + 2.6, cz - d), (cx, y + 2.6, cz + d)]
        add(points, [(0, 4, 5, 3), (1, 2, 5, 4)], roof)
        add(points, [(0, 1, 4), (3, 5, 2)], tint)
    else:
        for side in [-1, 1]:
            box((cx, top + .5, cz + side * (depth / 2 - .15)), (width, .65, .23), tint)
            box((cx + side * (width / 2 - .15), top + .5, cz), (.23, .65, depth), tint)
    if kind == 'office':
        box((cx, top + 1.9, cz - 1.5), (width * .56, 3.2, depth * .55), tint, 'City_solids')
        box((cx, top + 3.58, cz - 1.5), (width * .59, .2, depth * .59), cream)
        box((cx, top + 1.85, cz - 1.5 + depth * .275 + .04), (width * .46, 1.8, .09), glass)
    columns = max(3, round(width / 3.6))
    for floor in range(floors):
        y = base + 1.65 + floor * 3.1
        for col in range(columns):
            x = cx + (col - (columns - 1) / 2) * (width - 3) / columns
            for side in [-1, 1]:
                z = cz + side * (depth / 2 + .04)
                w = 2.35 if kind == 'office' else 1.65
                box((x, y, z), (w + .2, 1.94, .1), cream)
                box((x, y, z + side * .08), (w, 1.7, .07), window_lit if rng.random() < .12 else glass)
                box((x, y - 1, z + side * .12), (w + .38, .12, .35), cream)
        for col in range(max(3, round(depth / 4))):
            z = cz - depth / 2 + 2.7 + col * (depth - 5.4) / max(2, round(depth / 4) - 1)
            for side in [-1, 1]:
                x = cx + side * (width / 2 + .06)
                box((x, y, z), (.12, 1.9, 1.9), cream)
                box((x + side * .09, y, z), (.07, 1.65, 1.65), glass)
    front = cz + depth / 2
    # Recessed-looking glazed shopfronts, doors, signage and projecting awnings.
    for x in [cx - width * .25, cx + width * .25]:
        box((x, 2.65, front + .15), (width * .35, 2.2, .12), glass)
        box((x, 2.6, front + .24), (.07, 2.15, .08), cream)
    box((cx, 2.55, front + .17), (1.3, 2.5, .14), metal)
    box((cx + .43, 2.45, front + .29), (.05, .36, .06), cream)
    if shop:
        if kind != 'civic':
            awning(cx, 4.65, front + .1, min(width - 1, 12), [coral, teal, yellow][floors % 3])
        box((cx, 5.22, front + .2), (min(width - 1, 11), .92, .16), metal)
        label(shop, cx, 4.96, front + .3, min(width - 2, 10))
    if kind == 'apartments' and floors > 2:
        for floor in range(2, floors):
            y = base + floor * 3.1
            for x in [cx - width * .27, cx + width * .27]:
                box((x, y, front + .48), (3.2, .18, 1.05), cream)
                beam((x - 1.5, y + .8, front + 1), (x + 1.5, y + .8, front + 1), .035, metal)
                for dx in [-1.5, 0, 1.5]:
                    beam((x + dx, y, front + 1), (x + dx, y + .8, front + 1), .025, metal)
    # Rooftop equipment gives each silhouette a few small identifying details.
    box((cx - width * .22, top + .75, cz), (2.5, .9, 1.7), roof_dark)
    for i in range(5):
        box((cx - width * .22, top + 1.22, cz - .6 + i * .3), (2.2, .04, .1), metal)
    if floors % 2:
        beam((cx + width * .23, top + .4, cz - 2), (cx + width * .23, top + 2.4, cz - 2), .8, cream, sides=10)
        beam((cx + width * .23, top + 2.4, cz - 2), (cx + width * .23, top + 2.85, cz - 2), .94, roof_dark, sides=10, top_radius=.08)
    else:
        beam((cx + 2, top + .4, cz - 2), (cx + 2, top + 3.5, cz - 2), .035, metal)
        beam((cx + 1, top + 2.9, cz - 2), (cx + 3, top + 2.9, cz - 2), .025, metal)
    if kind == 'civic':
        box((cx, top + 4.5, cz), (4.5, 9, 4.5), cream, 'City_solids')
        box((cx, top + 9, cz), (5.2, .25, 5.2), cream)
        beam((cx, top + 9.1, cz), (cx, top + 12.1, cz), 3.7, roof_dark, sides=4, top_radius=0)
        for side in [-1, 1]:
            face = cz + side * 2.29
            beam((cx, top + 6.6, face), (cx, top + 6.6, face + side * .1), 1.28, yellow, sides=16)
            beam((cx, top + 6.6, face + side * .11), (cx, top + 6.6, face + side * .15), 1.1, cream, sides=16)
            beam((cx, top + 6.6, face + side * .19), (cx, top + 7.38, face + side * .19), .055, metal, sides=6)
            beam((cx, top + 6.6, face + side * .19), (cx + .65, top + 6.42, face + side * .19), .055, metal, sides=6)
        for dx in [-7, -3.5, 3.5, 7]:
            beam((cx + dx, 1.28, front + 1), (cx + dx, 4.7, front + 1), .22, cream, 'City_solids')
        box((cx, 4.8, front + .6), (width + .5, .25, 1.8), cream)


streets = [-120, -80, -40, 0, 40, 80, 120]
centers = [-100, -60, -20, 20, 60, 100]
shops = ['CAFE', 'MARKET', 'BAKERY', 'PAPAYA', 'BOOKS', 'HOTEL', 'CYCLES', 'DELI']
for row, cz in enumerate(centers):
    for col, cx in enumerate(centers):
        active_block = blocks[(cx, cz)]
        block = row * 6 + col
        if (cx, cz) in [(-100, 60), (-60, 100)]:
            for dx, dz in [(-10, 10), (10, -10)]:
                tree(cx + dx, cz + dz, 1.4)
            continue
        if [cx, cz] in layout['parks']:
            for dx, dz in [(-8, -7), (7, 7), (-7, 8), (8, -8)]:
                tree(cx + dx, cz + dz, 1.2 + rng.random() * .5)
            bench(cx, cz + 7)
            # Footpaths through larger, connected neighborhood gardens.
            box((cx, 1.06, cz), (3, .12, 25), sidewalk)
            continue
        box((cx, 1.14, cz), (26, .28, 26), sidewalk, 'City_solids')
        for dx, dz in [(-11.8, -11.8), (11.8, 11.8)]:
            lamp(cx + dx, cz + dz, math.pi if dx > 0 else 0)
        if (cx, cz) == (20, 20):
            box((cx, 1.31, cz), (22, .08, 22), lawn)
            box((cx, 1.37, cz), (3.2, .08, 22), cream)
            box((cx, 1.38, cz), (22, .08, 3.2), cream)
            beam((cx, 1.3, cz), (cx, 1.75, cz), 3.5, cream, 'City_solids', 16)
            beam((cx, 1.75, cz), (cx, 1.79, cz), 2.95, pool, sides=16)
            beam((cx, 1.8, cz), (cx, 3.05, cz), .42, cream, 'City_solids', 8)
            beam((cx, 2.85, cz), (cx, 3.05, cz), 1.45, cream, sides=12, top_radius=1.25)
            for dx, dz in [(-7, -7), (7, -7), (-7, 7), (7, 7)]:
                tree(cx + dx, cz + dz, 1.35)
            for dx in [-6, 6]:
                bench(cx + dx, cz, math.pi / 2)
            continue
        if (cx, cz) == (-20, -20):
            for dx, dz in [(-6, -5), (6, -5), (-6, 5), (6, 5)]:
                for px in [-1.8, 1.8]:
                    beam((cx + dx + px, 1.28, cz + dz), (cx + dx + px, 4.2, cz + dz), .065, wood, 'City_solids')
                box((cx + dx, 2.1, cz + dz), (3.9, 1.3, 1.6), wood, 'City_solids')
                awning(cx + dx, 4.2, cz + dz - .8, 4.4, coral if dx < 0 else teal)
                for k in range(5):
                    crown((cx + dx - 1.35 + k * .65, 2.9, cz + dz), (.24, .24, .24), yellow if dz < 0 else green)
            tree(cx - 9, cz + 8)
            tree(cx + 9, cz - 8)
            continue
        if (cx, cz) == (-20, 20):
            building(cx, cz, 20, 18, 2, walls[2], 'civic', 'TOWN HALL')
            bench(cx + 8, cz + 11)
            continue
        if block % 6 in [2, 5]:
            for side in [-1, 1]:
                building(cx + side * 5.6, cz - .6, 9.4, 15, 2 + (row % 2),
                         walls[(block + side) % len(walls)], 'terrace', shops[(block + side) % len(shops)])
            tree(cx - 9, cz + 11, .8)
            bench(cx + 5, cz + 11)
            continue
        floors = [3, 4, 2, 5, 3, 4][(row + col * 2) % 6]
        kind = 'office' if block % 7 == 0 else 'apartments'
        if kind == 'office':
            floors += 2
        width, depth = 17 + rng.random() * 3, 16 + rng.random() * 3
        building(cx, cz - .6, width, depth, floors, walls[block % len(walls)], kind,
                 shops[block % len(shops)] if block % 3 != 1 else None)
        if block % 2 == 0:
            tree(cx - 9, cz + 11, .8)
        else:
            bench(cx + 5, cz + 11)
        beam((cx + 10.5, 1.28, cz - 5), (cx + 10.5, 2.3, cz - 5), .32, metal, 'City_solids', 8)
        box((cx + 10.5, 2.34, cz - 5), (.73, .1, .73), metal)

active_block = None

# Road markings are flush visual details and never collision or shadow casters.
crosswalk_intersections = {(-40, -40), (-40, 0), (-40, 40), (0, 0), (0, 40), (80, 0), (-80, 80)}
for street in streets:
    for p in range(-146, 147, 8):
        if min(abs(p - cross) for cross in streets) < 13:
            continue
        if road_open(street, p):
            box((street, 1.045, p), (.16, .012, 2.8), yellow, 'Road_paint')
        if road_open(p, street):
            box((p, 1.045, street), (2.8, .012, .16), yellow, 'Road_paint')
    for cross in streets:
        if (street, cross) not in crosswalk_intersections:
            continue
        for side in [-1, 1]:
            for offset in [-5, -3, -1, 1, 3, 5]:
                if road_open(street, cross + side * 10):
                    box((street + offset * .7, 1.05, cross + side * 10), (.8, .015, 2.2), paint, 'Road_paint')
                if road_open(street + side * 10, cross):
                    box((street + side * 10, 1.05, cross + offset * .7), (2.2, .015, .8), paint, 'Road_paint')
# Center dashes on the garden avenue follow its diagonal bends.
for a, b in zip(layout['avenue'], layout['avenue'][1:]):
    dx, dz = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dz)
    for distance in range(5, int(length)-3, 8):
        t = distance / length
        box((a[0]+dx*t, 1.06, a[1]+dz*t), (.16, .012, 2.8), yellow,
            'Road_paint', math.atan2(dx, dz))

for x in [-80, 0, 80]:
    for z in [-80, 0, 80]:
        px, pz = x + 8.3, z + 10.4
        beam((px, 1.28, pz), (px, 4.8, pz), .09, metal, 'City_solids')
        box((px, 4.6, pz), (.44, 1.3, .38), metal)
        for i, mat in enumerate([red, yellow, green]):
            beam((px, 5 - i * .4, pz + .2), (px, 5 - i * .4, pz + .25), .125, mat, sides=8)
        # A squat red hydrant on the other corner.
        beam((x - 8.5, 1.28, z - 10), (x - 8.5, 2, z - 10), .16, coral, 'City_solids')
        beam((x - 8.8, 1.75, z - 10), (x - 8.2, 1.75, z - 10), .09, coral)


def parked_car(x, z, color):
    box((x, 1.64, z), (1.8, .68, 3.9), color, 'City_solids')
    add([(x - .83, 1.98, z - 1.1), (x + .83, 1.98, z - 1.1),
         (x + .83, 1.98, z + 1.15), (x - .83, 1.98, z + 1.15),
         (x - .66, 2.67, z - .65), (x + .66, 2.67, z - .65),
         (x + .66, 2.67, z + .5), (x - .66, 2.67, z + .5)],
        [(0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], glass)
    box((x, 2.7, z - .08), (1.43, .12, 1.25), color)
    for dx in [-.87, .87]:
        for dz in [-1.24, 1.24]:
            beam((x + dx - .1, 1.38, z + dz), (x + dx + .1, 1.38, z + dz), .34, rubber, sides=10)
    for dx in [-.6, .6]:
        box((x + dx, 1.72, z + 1.97), (.37, .2, .05), cream)
        box((x + dx, 1.72, z - 1.97), (.37, .2, .05), coral)
    box((x, 1.43, z + 2), (1.65, .12, .12), cream)


for i, (street, z) in enumerate([(-120, -60), (-80, 20), (-40, -100), (0, -60),
                               (0, 60), (40, 60), (80, -20), (120, 60), (120, -100), (-120, 100)]):
    if not road_open(street, z):
        continue
    # Apply one orthonormal pose to the complete car. Curved streets affect its
    # heading and slope, never its width, wheelbase, windows, or body shape.
    x = street + 3.9
    wx, wz = world_point(x, z)
    before, after = world_point(x, z-.5), world_point(x, z+.5)
    forward = Vector((after[0]-before[0], ground_height(*after)-ground_height(*before), after[1]-before[1])).normalized()
    right = Vector((forward.z, 0, -forward.x)).normalized()
    right.y = (ground_height(wx+right.x, wz+right.z)-ground_height(wx-right.x, wz-right.z))/2
    up = forward.cross(right).normalized()
    right = up.cross(forward).normalized()
    active_car_pose = (x, z, Vector((wx, ground_height(wx,wz), wz)), right, up, forward)
    parked_car(x, z, [coral, teal, cream, yellow][i % 4])
    active_car_pose = None
    for dz in [-3, 3]:
        box((street + 3.9, 1.05, z + dz), (2.6, .015, .1), paint, 'Road_paint')

# Green belts follow the valley instead of a ring of disconnected towers.
for i in range(170):
    x, z = rng.uniform(-150, 150), rng.uniform(-150, 150)
    if abs(x) < 130 and abs(z) < 130:
        continue
    tree(x, z, 1.1 + rng.random() * 1.3)
# Plant the closed connections as pocket gardens, making T junctions readable.
for ax, az, bx, bz in layout['closedLinks']:
    for t in [.35, .65]:
        x, z = ax + (bx-ax)*t, az + (bz-az)*t
        tree(x, z, 1.4)

# Authored polygon surfaces: junctions are welded in plan, with no curb walls
# across street openings. Triangles follow the game's terrain exactly.
for name, mat in [('asphalt', asphalt), ('sidewalk', sidewalk), ('curb', curb_stone)]:
    surface = layout['streets'][name]
    add(surface['vertices'], surface['faces'], mat, 'City_streets_' + name)

for (category, material_name), (vertices, faces) in buckets.items():
    name = category + '_' + material_name
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    if category.startswith('City_streets'):
        # Clip-generated triangles share the terrain's planes. Weld and dissolve
        # only coplanar interior edges, preserving every road/curb outline.
        bm = bmesh.new()
        bm.from_mesh(data)
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.00001)
        bmesh.ops.dissolve_limit(bm, angle_limit=.0005, use_dissolve_boundaries=False,
                                verts=list(bm.verts), edges=list(bm.edges))
        bm.to_mesh(data)
        bm.free()
        data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    data.materials.append(bpy.data.materials[material_name])

bpy.ops.object.select_all(action='SELECT')
bpy.context.preferences.filepaths.save_version = 0
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.region_3d.view_distance = 320
            area.spaces.active.region_3d.view_location = (0, 0, 8)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'assets/papaya-city.blend'))
bpy.ops.export_scene.gltf(filepath=str(ROOT / 'public/models/city-papaya.glb'),
                          export_format='GLB', use_selection=True, export_yup=True)
print('City meshes:', len(buckets), 'faces:', sum(len(faces) for _, faces in buckets.values()))
