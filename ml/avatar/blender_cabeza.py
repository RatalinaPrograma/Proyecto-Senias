"""Arma en Blender la cabeza del zorrito con la cara horneada, la renderiza desde
varios ángulos (para revisarla) y la guarda como .glb y .blend para retocarla.

Necesita el módulo de Blender para Python (`pip install bpy`, solo Python 3.11
o la versión que pida Blender) o correrlo dentro de Blender:

    python ml/avatar/blender_cabeza.py
    blender --background --python ml/avatar/blender_cabeza.py

Deja todo en ml/avatar/salida/ (no se sube al repo).
"""
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy  # noqa: E402

import cabeza as C  # noqa: E402
from proyectar import TEXTURA  # noqa: E402

SALIDA = Path(__file__).resolve().parent / 'salida'
VISTAS = [('frente', 0), ('tres_cuartos', 35), ('perfil', 90), ('espalda', 180)]


def malla_cabeza(W=128, H=96):
    """Esfera UV con la misma deformación radial y el mismo mapa UV que la app."""
    verts, uvs = [], []
    for i in range(H + 1):
        v = 1 - i / H
        phi = (v - 0.5) * math.pi
        for j in range(W + 1):
            u = j / W
            lam = (u - 0.5) * 2 * math.pi
            d = np.array([math.sin(lam) * math.cos(phi), math.sin(phi), math.cos(lam) * math.cos(phi)])
            p = d * C.radio(d[None])[0]
            # Blender: z hacia arriba, -y hacia la cámara frontal.
            verts.append((p[0], -p[2], p[1]))
            uvs.append((u, v))
    caras = []
    for i in range(H):
        for j in range(W):
            a = i * (W + 1) + j
            b = a + W + 1
            caras.append((a, b, b + 1, a + 1))
    malla = bpy.data.meshes.new('CabezaZorro')
    malla.from_pydata(verts, [], caras)
    uv = malla.uv_layers.new(name='UVMap')
    for poly in malla.polygons:
        for li in poly.loop_indices:
            uv.data[li].uv = uvs[malla.loops[li].vertex_index]
    obj = bpy.data.objects.new('CabezaZorro', malla)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.shade_smooth()
    # Polos y costura: vértices repetidos (las UV quedan separadas en la costura).
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.remove_doubles(threshold=1e-5)
    bpy.ops.object.mode_set(mode='OBJECT')
    return obj


def main():
    SALIDA.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    obj = malla_cabeza()

    # Material: la textura tal cual (en la app la cara se dibuja sin luz de escena).
    mat = bpy.data.materials.new('CaraZorro')
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(str(TEXTURA))
    emision = nt.nodes.new('ShaderNodeEmission')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(tex.outputs['Color'], emision.inputs['Color'])
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(emision.outputs['Emission'], out.inputs['Surface'])
    obj.data.materials.append(mat)

    escena = bpy.context.scene
    escena.render.engine = 'CYCLES'
    escena.cycles.samples = 8
    escena.cycles.device = 'CPU'
    escena.render.resolution_x = escena.render.resolution_y = 420
    escena.render.film_transparent = True
    escena.view_settings.view_transform = 'Standard'
    camara = bpy.data.objects.new('Camara', bpy.data.cameras.new('Camara'))
    camara.data.lens = 80
    bpy.context.collection.objects.link(camara)
    escena.camera = camara
    for nombre, grados in VISTAS:
        a = math.radians(grados)
        camara.location = (6.5 * math.sin(a), -6.5 * math.cos(a), 0.15)
        camara.rotation_euler = (math.radians(90), 0, a)
        escena.render.filepath = str(SALIDA / f'vista-{nombre}.png')
        bpy.ops.render.render(write_still=True)

    # Para retocar: la textura como color base de un material normal (glTF la empaqueta en el .glb).
    nt.nodes.remove(emision)
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    bpy.ops.export_scene.gltf(filepath=str(SALIDA / 'zorro-cabeza.glb'), export_format='GLB')
    bpy.ops.wm.save_as_mainfile(filepath=str(SALIDA / 'zorro-cabeza.blend'))
    print(f'listo: {SALIDA}')


if __name__ == '__main__':
    main()
