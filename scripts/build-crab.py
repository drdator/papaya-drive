"""Build the Palm Cove crab. Run with Blender --background --python build-crab.py."""
import math
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30
scene.frame_start, scene.frame_end = 1, 25
asset = bpy.data.collections.new('CRAB • export')
studio = bpy.data.collections.new('STUDIO • preview only')
scene.collection.children.link(asset)
scene.collection.children.link(studio)


def material(name, color):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = .83
    return mat


# Vertex colors keep the articulated animal to a single material / draw call.
mat = material('Crab • flat vertex colors', (1, 1, 1))
color_node = mat.node_tree.nodes.new('ShaderNodeVertexColor')
color_node.layer_name = 'Color'
mat.node_tree.links.new(color_node.outputs['Color'],
                        mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
coral = (.72, .075, .027)
light = (.95, .19, .055)
dark = (.38, .028, .013)
cream = (1, .69, .36)
black = (.008, .018, .021)
white = (1, .96, .80)
verts, faces, colors, weights = [], [], [], []
bones = {}


def bone(name, head, tail, parent=None):
    bones[name] = (Vector(head), Vector(tail), parent)
    return name


body = bone('Body', (0, 0, .18), (0, 0, .35))


def geometry(points, polygons, color, joint):
    start = len(verts)
    verts.extend(points)
    weights.extend([joint] * len(points))
    faces.extend([tuple(start + i for i in face) for face in polygons])
    colors.extend([color] * len(polygons))


def ellipsoid(center, radius, color, joint, segments=10, rings=4):
    center = Vector(center)
    points = [center + Vector((0, 0, -radius[2]))]
    for row in range(1, rings):
        phi = -math.pi / 2 + math.pi * row / rings
        for i in range(segments):
            a = math.tau * i / segments
            points.append(center + Vector((radius[0] * math.cos(phi) * math.cos(a),
                                          radius[1] * math.cos(phi) * math.sin(a),
                                          radius[2] * math.sin(phi))))
    points.append(center + Vector((0, 0, radius[2])))
    polygons = [(0, 1 + (i + 1) % segments, 1 + i) for i in range(segments)]
    for row in range(rings - 2):
        for i in range(segments):
            a, b = 1 + row * segments + i, 1 + row * segments + (i + 1) % segments
            polygons.append((a, b, b + segments, a + segments))
    last = 1 + (rings - 2) * segments
    polygons.extend((last + i, last + (i + 1) % segments, len(points) - 1)
                    for i in range(segments))
    geometry(points, polygons, color, joint)


def limb(stations, color, joint, sides=5):
    points = []
    for row, (p, radius) in enumerate(stations):
        before = Vector(stations[max(0, row - 1)][0])
        after = Vector(stations[min(len(stations) - 1, row + 1)][0])
        direction = (after - before).normalized()
        axis = direction.cross(Vector((0, 0, 1))).normalized()
        other = direction.cross(axis)
        for i in range(sides):
            a = math.tau * i / sides
            points.append(Vector(p) + radius * (axis * math.cos(a) + other * math.sin(a)))
    polygons = [tuple(reversed(range(sides)))]
    for row in range(len(stations) - 1):
        for i in range(sides):
            a, b = row * sides + i, row * sides + (i + 1) % sides
            polygons.append((a, b, b + sides, a + sides))
    polygons.append(tuple(range(len(points) - sides, len(points))))
    geometry(points, polygons, color, joint)


# Broad carapace, continuous dark rim and a small pale underside.
ellipsoid((0, 0, .175), (.266, .185, .082), cream, body, 12)
ellipsoid((0, 0, .213), (.308, .217, .080), dark, body, 12)
ellipsoid((0, 0, .245), (.31, .218, .126), coral, body, 12, 5)
# Restrained raised shell panels follow the carapace surface.
ellipsoid((0, .015, .345), (.165, .12, .031), light, body, 10, 3)
for sign in (-1, 1):
    for y, x in [(-.07, .291), (.04, .298), (.13, .254)]:
        limb([((sign * x, y, .24), .038),
              ((sign * (x + .057), y + .016, .25), .002)], coral, body)

legs = []
for sign, side in [(-1, 'L'), (1, 'R')]:
    for i, (y, spread) in enumerate([(-.13, -.15), (-.04, -.04), (.065, .10), (.145, .24)]):
        hip = Vector((sign * .24, y, .205))
        knee = Vector((sign * (.425 - i * .012), y + spread * .55, .24))
        foot = Vector((sign * (.535 - i * .019), y + spread, .012))
        upper = bone(f'Leg_{side}{i + 1}_upper', hip, knee, body)
        lower = bone(f'Leg_{side}{i + 1}_lower', knee, foot, upper)
        limb([(hip, .032), (hip.lerp(knee, .55) + Vector((0, 0, .02)), .034),
              (knee, .022)], coral, upper)
        ellipsoid(knee, (.025, .025, .025), dark, lower, 6, 3)
        limb([(knee, .023), (knee.lerp(foot, .72), .014), (foot, .0025)], light, lower)
        legs.append((hip, knee, foot, upper, lower, i, sign))

claws = []
for sign, side in [(-1, 'L'), (1, 'R')]:
    shoulder = Vector((sign * .22, -.145, .225))
    elbow = Vector((sign * .365, -.225, .22))
    palm = Vector((sign * .41, -.365, .26))
    arm = bone(f'Claw_{side}', shoulder, palm, body)
    limb([(shoulder, .040), (elbow, .045), (palm, .045)], coral, arm, 6)
    size = 1.13 if side == 'R' else 1
    ellipsoid(palm, (.099 * size, .118 * size, .079 * size), light, arm, 10, 4)
    # Two bent fingers leave an unmistakable open pincer silhouette.
    fixed = palm + Vector((sign * .067 * size, -.07 * size, 0))
    limb([(fixed, .044 * size),
          (palm + Vector((sign * .086 * size, -.156 * size, .01)), .031 * size),
          (palm + Vector((sign * .024 * size, -.204 * size, .01)), .006)], coral, arm)
    hinge = palm + Vector((-sign * .064 * size, -.046 * size, 0))
    finger = bone(f'Pincer_{side}', hinge, hinge + Vector((0, -.13, 0)), arm)
    limb([(hinge, .035 * size),
          (palm + Vector((-sign * .088 * size, -.128 * size, .01)), .027 * size),
          (palm + Vector((-sign * .027 * size, -.190 * size, .01)), .004)], cream, finger)
    claws.append((arm, finger, sign))
    eye_start = Vector((sign * .105, -.148, .306))
    eye_end = Vector((sign * .132, -.20, .445))
    eye = bone(f'Eye_{side}', eye_start, eye_end, body)
    limb([(eye_start, .023), (eye_end, .019)], coral, eye, 6)
    ellipsoid(eye_end, (.040, .037, .045), black, eye, 8, 4)
    ellipsoid(eye_end + Vector((-.008, -.029, .018)), (.012, .010, .012), white, eye, 6, 3)

mesh = bpy.data.meshes.new('CrabMesh')
mesh.from_pydata(verts, [], faces)
mesh.update()
mesh.materials.append(mat)
attr = mesh.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='CORNER')
for polygon, color in zip(mesh.polygons, colors):
    for loop in polygon.loop_indices:
        attr.data[loop].color = (*color, 1)
crab = bpy.data.objects.new('Crab', mesh)
asset.objects.link(crab)
for name in bones:
    group = crab.vertex_groups.new(name=name)
    indices = [i for i, joint in enumerate(weights) if joint == name]
    if indices:
        group.add(indices, 1, 'REPLACE')

armature = bpy.data.armatures.new('CrabRig')
rig = bpy.data.objects.new('CrabRig', armature)
asset.objects.link(rig)
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for name, (head, tail, parent) in bones.items():
    edit = armature.edit_bones.new(name)
    edit.head, edit.tail = head, tail
    if parent:
        edit.parent = armature.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
crab.parent = rig
modifier = crab.modifiers.new('Rigid segment skinning', 'ARMATURE')
modifier.object = rig
rig.show_in_front = True
rig['forward'] = '-Y in Blender; +Z in glTF'
rig['scuttle_speed_mps'] = .35
rig['animation'] = 'Scuttle: 0.8 second in-place loop, travels local +X at 0.35 m/s'
rest = {b.name: b.matrix_local.copy() for b in armature.bones}


def aimed(name, head, tail):
    start, end, _ = bones[name]
    q = (end - start).rotation_difference(Vector(tail) - Vector(head))
    return Matrix.Translation(head) @ q.to_matrix().to_4x4() @ rest[name].to_3x3().to_4x4()


def solve_knee(hip, foot, rest_knee, upper_length, lower_length):
    delta = foot - hip
    length = delta.length
    assert abs(upper_length - lower_length) < length < upper_length + lower_length, 'Foot outside leg reach'
    axis = delta.normalized()
    along = (upper_length ** 2 - lower_length ** 2 + length ** 2) / (2 * length)
    bend = rest_knee - hip
    bend = (bend - axis * bend.dot(axis)).normalized()
    return hip + axis * along + bend * math.sqrt(max(0, upper_length ** 2 - along ** 2))


# Alternating four-foot supports. During stance, the foot moves opposite +X
# at 0.35 m/s, cancelling runtime travel; the other four legs lift and recover.
for frame in range(1, 26):
    t = (frame - 1) / 24
    bob = Vector((0, 0, .006 * (1 - math.cos(math.tau * t * 2))))
    desired = {name: Matrix.Translation(bob) @ matrix for name, matrix in rest.items()}
    for hip, knee, foot, upper, lower, index, sign in legs:
        phase = (t + .5 * ((index + (sign == 1)) % 2)) % 1
        target = foot.copy()
        if phase < .5:
            target.x += .07 - .28 * phase
        else:
            u = (phase - .5) * 2
            target.x += -.07 + .14 * u
            target.z += .060 * math.sin(math.pi * u)
        h = hip + bob
        k = solve_knee(h, target, knee + bob, (knee - hip).length, (foot - knee).length)
        desired[upper] = aimed(upper, h, k)
        desired[lower] = aimed(lower, k, target)
    for arm, finger, sign in claws:
        head = bones[arm][0] + bob
        sway = Matrix.Rotation(sign * .045 * math.sin(math.tau * t), 4, 'Y')
        desired[arm] = Matrix.Translation(head) @ sway @ Matrix.Translation(-head) @ desired[arm]
        desired[finger] = desired[arm] @ rest[arm].inverted() @ rest[finger]
        desired[finger] = desired[finger] @ Matrix.Rotation(sign * .075 * (1 - math.cos(math.tau * t)), 4, 'Z')
    for name, (_, _, parent) in bones.items():
        pose = rig.pose.bones[name]
        local = rest[name].inverted() @ desired[name]
        if parent:
            local = rest[name].inverted() @ rest[parent] @ desired[parent].inverted() @ desired[name]
        pose.rotation_mode = 'QUATERNION'
        pose.matrix_basis = local
        pose.keyframe_insert('location', frame=frame, group=name)
        pose.keyframe_insert('rotation_quaternion', frame=frame, group=name)
    scene.frame_set(frame)
rig.animation_data.action.name = 'Scuttle'
action = rig.animation_data.action
for layer in action.layers:
    for strip in layer.strips:
        for bag in strip.channelbags:
            for curve in bag.fcurves:
                for key in curve.keyframe_points:
                    key.interpolation = 'LINEAR'

scene.frame_set(1)
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
crab.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(filepath=str(ROOT / 'public/models/crab.glb'), use_selection=True,
                         export_format='GLB', export_yup=True, export_animations=True,
                         export_animation_mode='ACTIONS', export_skins=True,
                         export_anim_slide_to_zero=True)

# Preview studio is excluded from the GLB.
def to_studio(obj):
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    studio.objects.link(obj)


sand = material('Studio • beach sand', (.66, .49, .27))
bpy.ops.mesh.primitive_plane_add(size=200)
plane = bpy.context.object
plane.name = 'Preview sand'
plane.data.materials.append(sand)
to_studio(plane)
world = bpy.data.worlds.new('Warm coast daylight')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (.64, .82, 1, 1)
world.node_tree.nodes['Background'].inputs[1].default_value = .5
scene.world = world
for name, loc, power, size in [('Key', (-2, -3, 5), 450, 4), ('Fill', (3, -1, 2), 100, 3)]:
    data = bpy.data.lights.new(name, 'AREA')
    data.energy, data.shape, data.size = power, 'DISK', size
    obj = bpy.data.objects.new(name, data)
    studio.objects.link(obj)
    obj.location = loc
    obj.rotation_euler = (Vector((0, 0, .2)) - obj.location).to_track_quat('-Z', 'Y').to_euler()
camera_data = bpy.data.cameras.new('Preview camera')
camera = bpy.data.objects.new('Preview camera', camera_data)
studio.objects.link(camera)
camera.location = (1.05, -1.85, 1.18)
camera.rotation_euler = (Vector((0, -.04, .17)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera_data.type, camera_data.ortho_scale = 'ORTHO', 1.5
scene.camera = camera
scene.render.engine = 'CYCLES'
scene.cycles.samples = 32
scene.cycles.use_denoising = True
scene.render.resolution_x, scene.render.resolution_y = 1400, 1200
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = 'Standard'
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = str(ROOT / 'docs/crab-preview.png')
bpy.ops.object.select_all(action='DESELECT')
crab.select_set(True)
bpy.context.view_layer.objects.active = crab
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.shading.type = 'MATERIAL'
            area.spaces.active.region_3d.view_distance = 1.9
            area.spaces.active.region_3d.view_location = (0, 0, .22)
            area.spaces.active.region_3d.view_rotation = camera.rotation_euler.to_quaternion()
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'assets/crab.blend'))
bpy.ops.render.render(write_still=True)
mesh.calc_loop_triangles()
print('CRAB_TRIANGLES', len(mesh.loop_triangles))
print('CRAB_BONES', len(bones))
print('DONE', ROOT)
