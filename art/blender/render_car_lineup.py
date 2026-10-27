# Renders a comparison contact sheet of the Octane Arena car lineup (rows = cars, columns = views).
#   blender -b --factory-startup --python render_car_lineup.py -- --out sheet.png [--views side,front,...]
#           [--cars Default,Wedge] [--tile 560x350] [--blend lineup.blend]
# Without --blend the lineup is rebuilt from build_octane_arena_cars.py next to this script.
import bpy, math, os, runpy, sys
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
# name: (camera direction from the car, orthographic scale or None for perspective)
VIEWS = {
    "side": (Vector((1, 0, 0)), 1.45),
    "front": (Vector((0, 1, 0)), 1.25),
    "rear": (Vector((0, -1, 0)), 1.25),
    "top": (Vector((0, 0, 1)), 1.6),
    "q_front": (Vector((1.0, 1.25, 0.55)), None),
    "q_rear": (Vector((1.0, -1.25, 0.55)), None),
    "low_front": (Vector((0.55, 1.2, 0.12)), None),
}


def setup_scene(res):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = "PNG"
    sc.view_settings.view_transform = "AgX"
    try:
        sc.eevee.taa_render_samples = 32
    except AttributeError:
        pass
    world = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
    sc.world = world
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs[0].default_value = (0.42, 0.45, 0.5, 1)
    bg.inputs[1].default_value = 0.9
    for ob in list(bpy.data.objects):
        if ob.type in ("LIGHT", "CAMERA") or ob.name == "LineupGround":
            bpy.data.objects.remove(ob, do_unlink=True)
    for name, rot, energy in (("Key", (math.radians(40), 0, math.radians(35)), 4.0),
                              ("Fill", (math.radians(60), 0, math.radians(-140)), 1.5)):
        sun = bpy.data.objects.new(name, bpy.data.lights.new(name, "SUN"))
        sun.data.energy = energy
        sun.data.angle = math.radians(8)
        sun.rotation_euler = rot
        sc.collection.objects.link(sun)
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
    ground = bpy.context.active_object
    ground.name = "LineupGround"
    gm = bpy.data.materials.new("LineupGround")
    gm.use_nodes = True
    bsdf = next(n for n in gm.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (0.55, 0.57, 0.6, 1)
    bsdf.inputs["Roughness"].default_value = 0.8
    ground.data.materials.append(gm)
    cam = bpy.data.objects.new("LineupCam", bpy.data.cameras.new("LineupCam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    return cam


def aim(cam, root, view):
    d, ortho = VIEWS[view]
    target = root.matrix_world.translation + Vector((0, 0, 0.21))
    if ortho:
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = ortho
        cam.location = target + d.normalized() * 6
    else:
        cam.data.type = "PERSP"
        cam.data.lens = 50
        cam.location = target + d.normalized() * 2.6
    if view == "top":
        cam.rotation_euler = (0, 0, math.pi / 2)  # nose to the right, like the side view
    else:
        cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.clip_end = 50


def stitch(paths, rows, cols, out):
    imgs = [[None] * cols for _ in range(rows)]
    w = h = 0
    for (r, c), p in paths.items():
        im = bpy.data.images.load(p)
        w, h = im.size
        a = np.empty(w * h * 4, np.float32)
        im.pixels.foreach_get(a)
        imgs[r][c] = a.reshape(h, w, 4)
        bpy.data.images.remove(im)
    gap = 4
    W, H = cols * w + (cols - 1) * gap, rows * h + (rows - 1) * gap
    sheet = np.ones((H, W, 4), np.float32) * 0.1
    sheet[..., 3] = 1
    for r in range(rows):
        for c in range(cols):
            y0 = H - (r + 1) * h - r * gap  # Blender images are bottom-up
            sheet[y0:y0 + h, c * (w + gap):c * (w + gap) + w] = imgs[r][c]
    im = bpy.data.images.new("sheet", W, H, alpha=False)
    im.pixels.foreach_set(sheet.ravel())
    im.filepath_raw = out
    im.file_format = "PNG"
    im.save()
    print("wrote", out)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opt = {argv[i]: argv[i + 1] for i in range(0, len(argv) - 1, 2)}
    if "--blend" in opt:
        bpy.ops.wm.open_mainfile(filepath=opt["--blend"])
        roots = [o for o in bpy.data.objects if o.type == "EMPTY" and o.name.startswith("Car_")]
    else:
        roots = runpy.run_path(os.path.join(HERE, "build_octane_arena_cars.py"))["build_lineup"]()
    if "--cars" in opt:
        want = opt["--cars"].split(",")
        for r in roots:
            for ob in [r] + list(r.children):
                ob.hide_render = r.name[4:] not in want
        roots = [r for r in roots if r.name[4:] in want]
    views = opt.get("--views", "side,front,rear,q_front,q_rear").split(",")
    res = tuple(int(v) for v in opt.get("--tile", "560x350").split("x"))
    out = os.path.abspath(opt.get("--out", "car_lineup.png"))
    tmp = os.path.join(os.path.dirname(out), "_tiles")
    os.makedirs(tmp, exist_ok=True)
    cam = setup_scene(res)
    paths = {}
    for r, root in enumerate(roots):
        for other in roots:
            for ob in [other] + list(other.children):
                ob.hide_render = other is not root
        for c, view in enumerate(views):
            aim(cam, root, view)
            p = os.path.join(tmp, f"{root.name}_{view}.png")
            bpy.context.scene.render.filepath = p
            bpy.ops.render.render(write_still=True)
            paths[(r, c)] = p
    stitch(paths, len(roots), len(views), out)


main()
