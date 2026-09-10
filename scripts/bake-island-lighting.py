"""Bake sky visibility and bounced sunlight across the island’s fixed scenery.

Input: work/island-lighting-scene.json from export-island-lighting.ts.
Run: Blender --background --python scripts/bake-island-lighting.py
Output: public/lighting/island.json and island-ground.exr (no direct sun).
Add -- --terrain-only to preserve the existing scenery vertex bake.
"""
import json
import math
import sys

import numpy as np
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
source = json.loads((ROOT / 'work/island-lighting-scene.json').read_text())
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 128
scene.cycles.diffuse_bounces = 3
scene.cycles.max_bounces = 4
scene.cycles.use_denoising = False
prefs = bpy.context.preferences.addons['cycles'].preferences
try:
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for device in prefs.devices:
        device.use = device.type == 'METAL'
    scene.cycles.device = 'GPU'
except TypeError:
    scene.cycles.device = 'CPU'
scene.render.bake.target = 'VERTEX_COLORS'
scene.render.bake.use_pass_color = False


def linear(hex_color):
    def channel(value):
        return value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4
    return tuple(channel(int(hex_color[i:i + 2], 16) / 255) for i in (0, 2, 4))


# Sky/ground colours match the game's hemisphere light. Sky radiance is
# irradiance / pi; Cycles handles visibility and diffuse interreflection.
world = bpy.data.worlds.new('Papaya sky')
world.use_nodes = True
scene.world = world
nodes = world.node_tree.nodes
links = world.node_tree.links
geometry = nodes.new('ShaderNodeTexCoord')
separate = nodes.new('ShaderNodeSeparateXYZ')
links.new(geometry.outputs['Normal'], separate.inputs[0])
remap = nodes.new('ShaderNodeMapRange')
# The world Normal points back along the ray, into the scene.
remap.inputs['From Min'].default_value = 1
remap.inputs['From Max'].default_value = -1
links.new(separate.outputs['Z'], remap.inputs['Value'])
mix = nodes.new('ShaderNodeMixRGB')
mix.inputs[1].default_value = (*linear('6f8263'), 1)
mix.inputs[2].default_value = (*linear('f6f2db'), 1)
links.new(remap.outputs[0], mix.inputs[0])
background = nodes.get('Background')
links.new(mix.outputs[0], background.inputs['Color'])
background.inputs['Strength'].default_value = 2.4 / math.pi

sun_data = bpy.data.lights.new('Same sun as the game', 'SUN')
sun_data.energy = 3.1
sun_data.color = linear('fff0ce')
sun_data.angle = 0
sun = bpy.data.objects.new('Sun', sun_data)
scene.collection.objects.link(sun)
# Three.js Y-up -> Blender Z-up: (x, y, z) -> (x, -z, y).
sun.rotation_euler = Vector((50, 36, -84)).to_track_quat('-Z', 'Y').to_euler()

material = bpy.data.materials.new('Actual scenery albedo')
material.use_nodes = True
nodes = material.node_tree.nodes
nodes.clear()
albedo = nodes.new('ShaderNodeVertexColor')
albedo.layer_name = 'albedo'
diffuse = nodes.new('ShaderNodeBsdfDiffuse')
output = nodes.new('ShaderNodeOutputMaterial')
material.node_tree.links.new(albedo.outputs['Color'], diffuse.inputs['Color'])
material.node_tree.links.new(diffuse.outputs[0], output.inputs['Surface'])


def build_mesh(name, include):
    vertices, colors, mapping = [], [], []
    for mesh in source['meshes']:
        for face in mesh['faces']:
            if not include(mesh, face):
                continue
            for vertex, color in zip(face['vertices'], face['colors']):
                x, y, z = mesh['vertices'][vertex]
                vertices.append((x, -z, y))
                colors.append((*color, 1))
                mapping.append((mesh['id'], vertex))
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], [(i, i + 1, i + 2) for i in range(0, len(vertices), 3)])
    data.update()
    data.materials.append(material)
    attr = data.color_attributes.new(name='albedo', type='FLOAT_COLOR', domain='CORNER')
    attr.data.foreach_set('color', [channel for color in colors for channel in color])
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    return obj, mapping


def bake_vertices():
    target, mapping = build_mesh('Scenery vertex bake', lambda mesh, face: mesh['id'] != 'ground')
    build_mesh('Ground bounce and occlusion', lambda mesh, face: mesh['id'] == 'ground')
    bpy.context.view_layer.objects.active = target
    target.select_set(True)
    result = target.data.color_attributes.new(name='irradiance', type='FLOAT_COLOR', domain='CORNER')
    target.data.color_attributes.active_color = result
    target.data.color_attributes.render_color_index = target.data.color_attributes.find('irradiance')

    def bake(direct, indirect):
        scene.render.bake.use_pass_direct = direct
        scene.render.bake.use_pass_indirect = indirect
        bpy.ops.object.bake(type='DIFFUSE')
        return [tuple(pixel.color[:3]) for pixel in result.data]

    print('Baking bounced sunlight and skylight:', len(mapping), 'corners', flush=True)
    bounced = bake(False, True)
    sun_data.energy = 0
    print('Baking visible sky (direct sun stays dynamic in the game)', flush=True)
    sky = bake(True, False)

    # Average shared corners back onto the original game's scenery vertices.
    accumulated = {}
    for (mesh_id, vertex), indirect, direct in zip(mapping, bounced, sky):
        values = accumulated.setdefault(mesh_id, {}).setdefault(vertex, [0, 0, 0, 0])
        for i in range(3):
            values[i] += math.pi * (indirect[i] + direct[i])
        values[3] += 1
    metadata = {mesh['id']: mesh for mesh in source['meshes']}
    meshes = []
    for mesh_id, vertices in accumulated.items():
        indices = sorted(vertices)
        meshes.append({
            'id': mesh_id,
            'count': metadata[mesh_id]['count'],
            'signature': metadata[mesh_id]['signature'],
            'vertices': indices,
            'irradiance': [round(max(0, channel / vertices[i][3]), 4) for i in indices for channel in vertices[i][:3]],
        })
    return meshes


def bake_ground():
    # Independent UVs cover the island, not the unused 300 m ocean floor.
    ground = next(mesh for mesh in source['meshes'] if mesh['id'] == 'ground')
    points = [ground['vertices'][i] for face in ground['faces'] if face['target'] for i in face['vertices']]
    min_x = math.floor((min(p[0] for p in points) - 2.5) / 5) * 5
    max_x = math.ceil((max(p[0] for p in points) + 2.5) / 5) * 5
    min_z = math.floor((min(p[2] for p in points) - 2.5) / 5) * 5
    max_z = math.ceil((max(p[2] for p in points) + 2.5) / 5) * 5
    def receiver(mesh, face):
        return mesh['id'] == 'ground' and face['target']
    target, _ = build_mesh('Terrain lightmap', receiver)
    build_mesh('Fixed scenery and underwater terrain', lambda mesh, face: not receiver(mesh, face))
    uv = target.data.uv_layers.new(name='Lightmap')
    for loop in target.data.loops:
        x, minus_z, _ = target.data.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = ((x - min_x) / (max_x - min_x), (max_z + minus_z) / (max_z - min_z))
    image = bpy.data.images.new('Ground irradiance', width=2048, height=2048, float_buffer=True)
    image.colorspace_settings.name = 'Linear Rec.709'
    texture = material.node_tree.nodes.new('ShaderNodeTexImage')
    texture.image = image
    material.node_tree.nodes.active = texture
    bpy.context.view_layer.objects.active = target
    target.select_set(True)
    scene.render.bake.target = 'IMAGE_TEXTURES'
    scene.render.bake.margin = 8
    scene.cycles.samples = 256
    sun_data.energy = 3.1
    def bake(direct, indirect):
        scene.render.bake.use_pass_direct = direct
        scene.render.bake.use_pass_indirect = indirect
        bpy.ops.object.bake(type='DIFFUSE')
        pixels = np.empty(2048 * 2048 * 4, dtype=np.float32)
        image.pixels.foreach_get(pixels)
        return pixels.reshape((-1, 4))
    print('Baking 2048² terrain bounce light', flush=True)
    bounced = bake(False, True)
    sun_data.energy = 0
    print('Baking 2048² terrain sky visibility', flush=True)
    sky = bake(True, False)
    bounced[:, :3] = np.maximum(0, (bounced[:, :3] + sky[:, :3]) * math.pi)
    bounced[:, 3] = 1
    image.pixels.foreach_set(bounced.ravel())
    image.update()

    # Denoise the per-texel Monte Carlo samples offline, retaining HDR precision.
    # A separate empty render scene runs Blender's compositor on the baked image.
    output_scene = bpy.data.scenes.new('Lightmap denoise')
    output_scene.render.engine = 'CYCLES'
    output_scene.cycles.samples = 1
    output_scene.render.resolution_x = output_scene.render.resolution_y = 2048
    output_scene.render.resolution_percentage = 100
    camera = bpy.data.objects.new('Denoise camera', bpy.data.cameras.new('Denoise camera'))
    output_scene.collection.objects.link(camera)
    output_scene.camera = camera
    graph = bpy.data.node_groups.new('Lightmap denoise', 'CompositorNodeTree')
    output_scene.compositing_node_group = graph
    graph.interface.new_socket(name='Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    source_image = graph.nodes.new('CompositorNodeImage')
    source_image.image = image
    denoise = graph.nodes.new('CompositorNodeDenoise')
    denoise.inputs['HDR'].default_value = True
    output = graph.nodes.new('NodeGroupOutput')
    graph.links.new(source_image.outputs['Image'], denoise.inputs['Image'])
    graph.links.new(denoise.outputs['Image'], output.inputs['Image'])
    settings = output_scene.render.image_settings
    settings.file_format = 'OPEN_EXR'
    settings.color_mode = 'RGB'
    settings.color_depth = '16'
    settings.exr_codec = 'ZIP'
    output_scene.render.filepath = str(ROOT / 'public/lighting/island-ground.exr')
    bpy.ops.render.render(scene=output_scene.name, write_still=True)
    return {
        'id': 'ground', 'count': ground['count'], 'signature': ground['signature'],
        'bounds': [min_x, max_x, min_z, max_z],
        'texture': 'island-ground.exr', 'size': 2048,
    }


path = ROOT / 'public/lighting/island.json'
path.parent.mkdir(parents=True, exist_ok=True)
if '--terrain-only' in sys.argv:
    meshes = json.loads(path.read_text())['meshes']
else:
    meshes = bake_vertices()
    # Clear the bake receivers/context, retaining the original sun and world.
    for obj in list(scene.objects):
        if obj.type == 'MESH':
            bpy.data.objects.remove(obj, do_unlink=True)
terrain = bake_ground()
meshes = [mesh for mesh in meshes if mesh['id'] != 'ground']
path.write_text(json.dumps({'meshes': meshes, 'terrain': terrain}, separators=(',', ':')))
print('Saved', path, path.stat().st_size, 'bytes', flush=True)
