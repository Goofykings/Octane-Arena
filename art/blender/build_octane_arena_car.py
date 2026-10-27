# Octane Arena car generator (run inside Blender).
# Design units: body length ~4.0, car faces +Y, +X is the car's right, Z up.
# The whole model is scaled by CAR_SCALE at the end (0.295 -> 1.18 m game hitbox length).
import bpy, bmesh, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

S = globals().get("CAR_SCALE", 1.0)
COLL = "OctaneArenaCar"
V2 = lambda x, y: Vector((x, y))


# ---------------------------------------------------------------- helpers
def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def sstep(e0, e1, x):
    t = clamp((x - e0) / (e1 - e0))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def smin(a, b, k=0.05):
    return 0.5 * (a + b - math.sqrt((a - b) ** 2 + k * k))


class Pchip:
    """Monotone cubic interpolation through (x, y) knots; flat beyond the ends."""

    def __init__(self, pts):
        self.x = [p[0] for p in pts]
        self.y = [p[1] for p in pts]
        n = len(pts)
        self.h = h = [self.x[i + 1] - self.x[i] for i in range(n - 1)]
        d = [(self.y[i + 1] - self.y[i]) / h[i] for i in range(n - 1)]
        m = [0.0] * n
        m[0], m[-1] = d[0], d[-1]
        for i in range(1, n - 1):
            if d[i - 1] * d[i] <= 0:
                m[i] = 0.0
            else:
                w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
                m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
        self.m = m

    def __call__(self, x):
        X = self.x
        if x <= X[0]:
            return self.y[0]
        if x >= X[-1]:
            return self.y[-1]
        i = 0
        while X[i + 1] < x:
            i += 1
        h = self.h[i]
        t = (x - X[i]) / h
        return ((2 * t**3 - 3 * t**2 + 1) * self.y[i] + (t**3 - 2 * t**2 + t) * h * self.m[i]
                + (-2 * t**3 + 3 * t**2) * self.y[i + 1] + (t**3 - t**2) * h * self.m[i + 1])


def bez(a, b, c, t):
    return a * (1 - t) ** 2 + b * (2 * t * (1 - t)) + c * (t * t)


def corner(A, B, C, r, tmin=0.012):
    u1, u2 = A - B, C - B
    l1, l2 = u1.length, u2.length
    u1, u2 = u1 / l1, u2 / l2
    ang = math.acos(clamp(u1.dot(u2), -1.0, 1.0))
    tn = math.tan(ang / 2)
    t = r / tn if tn > 1e-6 else tmin
    t = min(max(t, tmin), 0.45 * l1, 0.45 * l2)
    return B + u1 * t, B + u2 * t


# ---------------------------------------------------------------- scene / materials
def reset():
    old = bpy.data.collections.get(COLL)
    if old:
        for ob in list(old.all_objects):
            me = ob.data if ob.type == "MESH" else None
            bpy.data.objects.remove(ob, do_unlink=True)
            if me and me.users == 0:
                bpy.data.meshes.remove(me)
        bpy.data.collections.remove(old)
    cube = bpy.data.objects.get("Cube")
    if cube and cube.type == "MESH" and len(cube.data.vertices) == 8:
        bpy.data.objects.remove(cube, do_unlink=True)
    coll = bpy.data.collections.new(COLL)
    bpy.context.scene.collection.children.link(coll)
    return coll


def sock(node, ident):
    return next(s for s in node.inputs if s.identifier == ident)


def material(name, color, metallic=0.0, rough=0.5, coat=0.0, emit=None, strength=0.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    try:
        mat.use_nodes = True
    except Exception:
        pass
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    sock(bsdf, "Base Color").default_value = (*color, 1.0)
    sock(bsdf, "Metallic").default_value = metallic
    sock(bsdf, "Roughness").default_value = rough
    # Only paint gets clearcoat; any coat setting makes the exporter emit KHR_materials_clearcoat.
    sock(bsdf, "Coat Weight").default_value = coat
    sock(bsdf, "Coat Roughness").default_value = 0.04 if coat else 0.03
    sock(bsdf, "Emission Color").default_value = (*(emit or (0, 0, 0)), 1.0)
    sock(bsdf, "Emission Strength").default_value = strength
    mat.diffuse_color = (*color, 1.0)
    mat.roughness = rough
    mat.metallic = metallic
    return mat


MAT = {
    "BodyPaint": material("BodyPaint", (0.02, 0.16, 0.75), metallic=0.3, rough=0.3, coat=0.6),
    "Glass": material("Glass", (0.018, 0.022, 0.03), metallic=0.55, rough=0.06),
    "Rubber": material("Rubber", (0.022, 0.022, 0.024), rough=0.88),
    "Metal": material("Metal", (0.62, 0.64, 0.67), metallic=1.0, rough=0.26),
    "DarkTrim": material("DarkTrim", (0.03, 0.032, 0.036), rough=0.55),
    "Headlight": material("Headlight", (0.9, 0.92, 0.95), rough=0.08, emit=(1.0, 0.96, 0.88), strength=3.0),
    "TailLight": material("TailLight", (0.35, 0.0, 0.0), rough=0.12, emit=(1.0, 0.0, 0.0), strength=2.0),
}


def make_obj(coll, name, bm, mats, loc=(0, 0, 0), sharp_deg=40):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(MAT[m])
    me.shade_smooth()
    if sharp_deg:
        me.set_sharp_from_angle(angle=math.radians(sharp_deg))
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    coll.objects.link(ob)
    return ob


# ---------------------------------------------------------------- body design curves
AX, RA, RAZ, ZR = 1.24, 0.55, 0.53, 0.49  # axle |y|, arch half-length / height, rocker height
YEND, REND = 1.87, 0.12                # loft end |y|, end rounding radius
XW = 0.62                              # wheel-well inner wall |x|

z_rock = Pchip([(-YEND, 0.53), (-1.55, ZR), (1.55, ZR), (YEND, 0.52)])
hw = Pchip([(-YEND, 1.04), (-1.62, 1.12), (-AX, 1.15), (-0.82, 1.04), (-0.4, 0.96), (0.4, 0.96),
            (0.82, 1.04), (AX, 1.15), (1.62, 1.10), (YEND, 1.0)])
z_belt = Pchip([(-YEND, 1.16), (-AX, 1.25), (-0.65, 1.14), (0.0, 1.12), (0.65, 1.13),
                (AX, 1.20), (1.62, 1.08), (YEND, 0.92)])
z_ctr = Pchip([(-YEND, 1.13), (-AX, 1.15), (-0.6, 1.12), (0.7, 1.10), (AX, 1.03),
               (1.62, 0.95), (YEND, 0.86)])
H = Pchip([(-1.48, 0.0), (-1.38, 0.05), (-1.0, 0.31), (-0.7, 0.435), (-0.3, 0.485), (0.05, 0.465),
           (0.45, 0.24), (0.70, 0.05), (0.80, 0.0)])
door = lambda y: sstep(-0.78, -0.42, y) * (1 - sstep(0.42, 0.78, y))
taper = Pchip([(-1.5, 0.86), (-0.8, 0.95), (-0.2, 1.0)])


def frame(y):
    w = hw(y)
    xs = w - 0.03
    xgb = smin(0.90, xs - 0.14, 0.06)
    xrf = smin(0.70, xgb - 0.20, 0.06) * taper(y)
    return dict(w=w, xs=xs, xgb=xgb, xrf=xrf, zb=z_belt(y), zc=z_ctr(y), h=H(y))


def top_z(y, x, F=None):
    F = F or frame(y)
    z = F["zc"] + (F["zb"] - F["zc"]) * sstep(0.30 * F["xs"], 0.92 * F["xs"], x)
    z += F["h"] * (1 - sstep(F["xrf"], F["xgb"], x))
    if x < F["xrf"]:
        z += 0.035 * (F["h"] / 0.55) * (1 - (x / F["xrf"]) ** 2) ** 2
    z += 0.018 * (1 - (min(x, F["xs"]) / F["xs"]) ** 2)
    return z


def arch_z(y):
    za = z_rock(y)
    for ax in (-AX, AX):
        dy = y - ax
        if abs(dy) < RA:
            za = max(za, ZR + RAZ * math.sqrt(1 - (dy / RA) ** 2))
    return za


CLAD = 14  # half-section vertex index below which faces are DarkTrim (underside + arch lip band)


def section(y):
    F = frame(y)
    dr = door(y)
    za, zf = arch_z(y), z_rock(y) - 0.05
    w, xs = F["w"], F["xs"]
    zmid = za + lerp(0.42, 0.52, dr) * (F["zb"] - za)
    K = [V2(0, zf), V2(XW, zf), V2(XW, za), V2(w - 0.035 - 0.035 * dr, za), V2(w, zmid), V2(xs, F["zb"]),
         V2(F["xgb"], top_z(y, F["xgb"], F))]
    R = [0, 0.02, 0.02, 0.035, lerp(0.22, 0.06, dr), 0.09, 0]
    NA = [0, 2, 2, 3, 4, 5, 0]
    NS = [2, 1, 2, 3, 2]
    pts, prev = [K[0]], K[0]
    for i in range(1, 6):
        T1, T2 = corner(K[i - 1], K[i], K[i + 1], R[i])
        n = NS[i - 1]
        pts += [prev.lerp(T1, k / (n + 1)) for k in range(1, n + 1)]
        pts += [bez(T1, K[i], T2, k / (NA[i] - 1)) for k in range(NA[i])]
        prev = T2
    xgb, xrf = F["xgb"], F["xrf"]
    xs_list = [lerp(prev.x, xgb, k / 2) for k in (1, 2)]
    xs_list += [lerp(xgb, xrf, k / 8) for k in range(1, 9)]
    xs_list += [lerp(xrf, 0.0, k / 7) for k in range(1, 8)]
    pts += [V2(x, top_z(y, x, F)) for x in xs_list]
    return pts


def shear(y, z):
    if y > 0:
        return sstep(1.55, YEND, y) * -0.30 * (z - 0.45)
    return sstep(-1.55, -YEND, y) * 0.06 * (z - 0.45)


def body_ys():
    ys = [-YEND + i * (2 * YEND) / 56 for i in range(57)]
    arch = [ax + RA * math.cos(math.pi * k / 16) for ax in (-AX, AX) for k in range(17)]
    ys = [y for y in ys if all(abs(y - a) > 0.028 for a in arch)] + arch
    return sorted(set(round(y, 5) for y in ys if -YEND <= y <= YEND))


def build_body():
    bm = bmesh.new()
    rings = []  # (list of BMVerts, kind) kind: 'loft' or 'cap'

    def ring_from_half(half, y, wsh=None):
        M = len(half)
        full = half + [V2(-p.x, p.y) for p in reversed(half[1:M - 1])]
        out = []
        for p in full:
            yy = y + (shear(y, p.y) if wsh is None else wsh * (-0.30 if y > 0 else 0.06) * (p.y - 0.45))
            out.append(bm.verts.new((p.x, yy, p.y)))
        return out

    def inset(half, d):
        xmax = max(p.x for p in half)
        zmin, zmax = min(p.y for p in half), max(p.y for p in half)
        zm, hz = 0.5 * (zmin + zmax), 0.5 * (zmax - zmin)
        return [V2(p.x * (1 - d / xmax), zm + (p.y - zm) * (1 - 0.8 * d / hz)) for p in half], zm

    ys = body_ys()
    halves = {y: section(y) for y in ys}
    M = len(halves[ys[0]])

    def end_rings(sign):
        y0 = sign * YEND
        base = halves[y0 if sign > 0 else ys[0]]
        out = []
        for k in range(1, 5):
            th = k * math.pi / 8
            h, zm = inset(base, REND * (1 - math.cos(th)))
            out.append((ring_from_half(h, y0 + sign * REND * math.sin(th), 1.0), "end"))
        last, zm = inset(base, REND)
        for f in (0.7, 0.42, 0.18):
            h = [V2(p.x * f, zm + (p.y - zm) * f) for p in last]
            out.append((ring_from_half(h, y0 + sign * REND, 1.0), "cap"))
        return out

    rear = end_rings(-1)
    front = end_rings(1)
    rings = list(reversed(rear)) + [(ring_from_half(halves[y], y), "loft") for y in ys] + front
    N = 2 * M - 2

    def half_idx(i):
        return i if i < M else N - i

    for a in range(len(rings) - 1):
        ra, ka = rings[a]
        rb, kb = rings[a + 1]
        for i in range(N):
            j = (i + 1) % N
            f = bm.faces.new((ra[i], ra[j], rb[j], rb[i]))
            if "cap" in (ka, kb):
                f.material_index = 1 if f.calc_center_median().z < 0.55 else 0
            else:
                f.material_index = 1 if min(half_idx(i), half_idx(j)) < CLAD else 0
    for ring, _ in (rings[0], rings[-1]):
        c = sum((v.co for v in ring), Vector()) / len(ring)
        cv = bm.verts.new(c)
        for i in range(N):
            f = bm.faces.new((ring[i], ring[(i + 1) % N], cv))
            f.material_index = 1 if f.calc_center_median().z < 0.55 else 0
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


# ---------------------------------------------------------------- projected patches (glass, lights, trim)
def squircle(s, t, p):
    m = max(abs(s), abs(t))
    if m < 1e-9:
        return 0.0, 0.0
    a = math.atan2(t, s)
    c, sn = math.cos(a), math.sin(a)
    r = (abs(c) ** p + abs(sn) ** p) ** (-1.0 / p)
    return m * r * c, m * r * sn


def cast(bvh, P, d):
    loc, n, _, _ = bvh.ray_cast(P - d * 5.0, d, 20.0)
    if loc is None:
        return None
    if n.dot(d) > 0:
        n = -n
    return loc, n


def grid_samples(bvh, shape, nu, nv, p, grow=0.0):
    g = []
    for j in range(nv):
        row = []
        for i in range(nu):
            a, b = squircle(-1 + 2 * i / (nu - 1), -1 + 2 * j / (nv - 1), p)
            P, d, hu, hv = shape(a, b)
            if grow:
                P, d, _, _ = shape(a * (1 + grow / hu), b * (1 + grow / hv))
            row.append(cast(bvh, P, d))
        g.append(row)
    return g


def perimeter(nu, nv):
    return ([(i, 0) for i in range(nu)] + [(nu - 1, j) for j in range(1, nv)]
            + [(i, nv - 1) for i in range(nu - 2, -1, -1)] + [(0, j) for j in range(nv - 2, 0, -1)])


def add_patch(bm, bvh, shape, nu, nv, off, mat, p=5, skirt=0.012):
    g = grid_samples(bvh, shape, nu, nv, p)
    V = [[bm.verts.new(h[0] + h[1] * off) for h in row] for row in g]
    for j in range(nv - 1):
        for i in range(nu - 1):
            bm.faces.new((V[j][i], V[j][i + 1], V[j + 1][i + 1], V[j + 1][i])).material_index = mat
    per = perimeter(nu, nv)
    sk = [bm.verts.new(g[j][i][0] + g[j][i][1] * (off - skirt)) for i, j in per]
    for k in range(len(per)):
        i0, j0 = per[k]
        i1, j1 = per[(k + 1) % len(per)]
        bm.faces.new((V[j0][i0], V[j1][i1], sk[(k + 1) % len(per)], sk[k])).material_index = mat


def add_frame(bm, bvh, shape, nu, nv, off, width, mat, p=5):
    gi = grid_samples(bvh, shape, nu, nv, p, grow=-0.02)
    go = grid_samples(bvh, shape, nu, nv, p, grow=width)
    per = perimeter(nu, nv)
    inn = [bm.verts.new(gi[j][i][0] + gi[j][i][1] * off) for i, j in per]
    out = [bm.verts.new(go[j][i][0] + go[j][i][1] * off) for i, j in per]
    sk = [bm.verts.new(go[j][i][0] - go[j][i][1] * 0.01) for i, j in per]
    n = len(per)
    for k in range(n):
        q = (k + 1) % n
        bm.faces.new((inn[k], inn[q], out[q], out[k])).material_index = mat
        bm.faces.new((out[k], out[q], sk[q], sk[k])).material_index = mat


DOWN = Vector((0, 0, -1))
WS_DIR = Vector((0, -0.6, -0.8)).normalized()
RW_DIR = Vector((0, 0.55, -0.83)).normalized()


def windshield(a, b):
    t = (b + 1) / 2
    hwid = lerp(0.63, 0.51, t)
    x, y = a * hwid, lerp(0.70, 0.10, t)
    return Vector((x, y, top_z(y, abs(x)))), WS_DIR, 0.57, 0.30


def rear_window(a, b):
    t = (b + 1) / 2
    hwid = lerp(0.58, 0.48, t)
    x, y = a * hwid, lerp(-1.36, -0.93, t)
    return Vector((x, y, top_z(y, abs(x)))), RW_DIR, 0.53, 0.22


def side_window(side):
    def f(a, b):
        u, v = (a + 1) / 2, (b + 1) / 2
        y = lerp(lerp(-1.10, 0.58, u), lerp(-0.84, 0.06, u), v)
        Fy = frame(y)
        zb = top_z(y, Fy["xgb"], Fy) + 0.035
        zt = top_z(y, Fy["xrf"] + 0.025, Fy) - 0.04
        return Vector((side * 3.0, y, lerp(zb, zt, v))), Vector((-side, 0, 0)), 0.8, 0.22
    return f


def front_quad(c00, c10, c11, c01, sign=1.0, direction=None):
    d = direction or Vector((0, -1, 0))
    def f(a, b):
        u, v = (a + 1) / 2, (b + 1) / 2
        x = lerp(lerp(c00[0], c10[0], u), lerp(c01[0], c11[0], u), v)
        z = lerp(lerp(c00[1], c10[1], u), lerp(c01[1], c11[1], u), v)
        hu = 0.5 * abs(c10[0] - c00[0]) + 1e-3
        hv = 0.5 * abs(c01[1] - c00[1]) + 1e-3
        return Vector((sign * x, -d.y * 3.0, z)), d, hu, hv
    return f


def side_quad(c00, c10, c11, c01, side):
    def f(a, b):
        u, v = (a + 1) / 2, (b + 1) / 2
        y = lerp(lerp(c00[0], c10[0], u), lerp(c01[0], c11[0], u), v)
        z = lerp(lerp(c00[1], c10[1], u), lerp(c01[1], c11[1], u), v)
        return Vector((side * 3.0, y, z)), Vector((-side, 0, 0)), 0.5 * abs(c10[0] - c00[0]), 0.5 * abs(c01[1] - c00[1])
    return f


def hood_vent(side):
    def f(a, b):
        u, v = (a + 1) / 2, (b + 1) / 2
        y = lerp(0.98, 1.38, v)
        x = lerp(0.24, 0.50, u) + 0.07 * v
        return Vector((side * x, y, 3.0)), DOWN, 0.13, 0.2
    return f


def add_exhaust(bm, x, z, r=0.055, seg=16):
    y0, y1 = -YEND - REND + 0.06, -YEND - REND - 0.05
    prof = [(r, y0, 1), (r, y1, 1), (r * 0.78, y1, 1), (r * 0.78, y1 + 0.06, 0)]
    rings = [[bm.verts.new((x + rr * math.cos(2 * math.pi * k / seg), yy, z + rr * math.sin(2 * math.pi * k / seg)))
              for k in range(seg)] for rr, yy, _ in prof]
    for a in range(len(prof) - 1):
        for k in range(seg):
            q = (k + 1) % seg
            bm.faces.new((rings[a][k], rings[a][q], rings[a + 1][q], rings[a + 1][k])).material_index = prof[a][2]
    bm.faces.new(rings[-1]).material_index = 0


def add_splitter(bm):
    # thin rounded lip under the nose, wider than the grille, slightly proud of the bumper
    ys = YEND + REND - 0.10
    sec = []
    for q in range(16):
        a = 2 * math.pi * q / 16
        sec.append((0.80 * math.copysign(abs(math.cos(a)) ** 0.35, math.cos(a)),
                    0.08 * math.copysign(abs(math.sin(a)) ** 0.35, math.sin(a))))
    top, bot = [], []
    for x, dy in sec:
        top.append(bm.verts.new((x, ys + dy, 0.545)))
        bot.append(bm.verts.new((x, ys + dy - 0.01, 0.515)))
    bm.faces.new(top)
    bm.faces.new(list(reversed(bot)))
    for q in range(16):
        bm.faces.new((top[q], top[(q + 1) % 16], bot[(q + 1) % 16], bot[q]))


# ---------------------------------------------------------------- spoiler
def build_spoiler():
    bm = bmesh.new()
    yc, zc, chord, span = -1.74, 1.57, 0.42, 1.0
    aoa = math.radians(9)
    foil = []
    n = 10
    for k in range(n):
        u = (1 - math.cos(math.pi * k / (n - 1))) / 2
        th = 5 * 0.15 * (0.2969 * math.sqrt(u) - 0.126 * u - 0.3516 * u**2 + 0.2843 * u**3 - 0.1036 * u**4)
        foil.append((u, th))
    loop = [(u, th) for u, th in foil] + [(u, -th) for u, th in reversed(foil[1:-1])]
    xs = [-1.0, -0.985, -0.95, -0.85, -0.6, -0.3, 0.0, 0.3, 0.6, 0.85, 0.95, 0.985, 1.0]
    rings = []
    for x in xs:
        e = abs(x) / span
        sc = 1.0 if e <= 0.95 else math.sqrt(max(0.0, 1 - ((e - 0.95) / 0.05) ** 2)) * 0.9 + 0.1
        lift = 0.07 * sstep(0.55, 1.0, e)
        sweep = -0.06 * e * e
        ring = []
        for u, th in loop:
            ly, lz = (0.5 - u) * chord, th * chord * sc
            ly *= lerp(1.0, sc, 0.6)
            ry = ly * math.cos(aoa) - lz * math.sin(aoa)
            rz = ly * math.sin(aoa) * -1 + lz * math.cos(aoa)
            ring.append(bm.verts.new((x, yc + ry + sweep, zc + rz + lift)))
        rings.append(ring)
    L = len(loop)
    for a in range(len(rings) - 1):
        for i in range(L):
            bm.faces.new((rings[a][i], rings[a][(i + 1) % L], rings[a + 1][(i + 1) % L], rings[a + 1][i]))
    for ring in (rings[0], rings[-1]):
        bm.faces.new(ring)
    # struts
    for sx in (-0.52, 0.52):
        secs = []
        for k, t in enumerate((0.0, 0.5, 1.0)):
            zz = lerp(top_z(-1.68, abs(sx)) - 0.04, zc - 0.005, t)
            yy = lerp(-1.60, -1.76, t)
            ln = lerp(0.24, 0.15, t)
            sec = []
            for q in range(8):
                ang = 2 * math.pi * q / 8 + math.pi / 8
                sec.append(bm.verts.new((sx + 0.028 * math.copysign(abs(math.cos(ang)) ** 0.5, math.cos(ang)),
                                         yy + 0.5 * ln * math.copysign(abs(math.sin(ang)) ** 0.5, math.sin(ang)), zz)))
            secs.append(sec)
        for a in range(2):
            for q in range(8):
                f = bm.faces.new((secs[a][q], secs[a][(q + 1) % 8], secs[a + 1][(q + 1) % 8], secs[a + 1][q]))
                f.material_index = 1
    return bm


# ---------------------------------------------------------------- wheels
WR, WX, WSEG = 0.476, 0.86, 32  # WR = outer lug radius = axle height


def revolve(bm, prof, seg, mats, close_center=False):
    """prof: list of (x, r); revolves around X. mats: material index per profile segment."""
    rings = []
    for x, r in prof:
        rings.append([bm.verts.new((x, r * math.cos(2 * math.pi * k / seg), r * math.sin(2 * math.pi * k / seg)))
                      for k in range(seg)])
    for a in range(len(prof) - 1):
        for k in range(seg):
            q = (k + 1) % seg
            f = bm.faces.new((rings[a][k], rings[a][q], rings[a + 1][q], rings[a + 1][k]))
            f.material_index = mats[a] if isinstance(mats, list) else mats
    return rings


def build_wheel():
    bm = bmesh.new()
    # tire (Rubber=0)
    half = [(-0.165, 0.28), (-0.182, 0.32), (-0.192, 0.365), (-0.188, 0.408), (-0.172, 0.438),
            (-0.146, 0.455), (-0.105, 0.462), (-0.055, 0.462), (-0.05, 0.449), (-0.03, 0.449), (-0.025, 0.462)]
    tire = half + [(-x, r) for x, r in reversed(half)]
    revolve(bm, tire, WSEG, 0)
    NL = 22
    for row, (x0, x1) in enumerate(((-0.172, -0.058), (0.058, 0.172))):
        for k in range(NL):
            a0 = 2 * math.pi * (k + 0.5 * row) / NL
            a1 = a0 + 2 * math.pi / NL * 0.58
            vs = []
            for x, r, a in ((x0, 0.452, a0), (x1, 0.452, a0), (x1, 0.452, a1), (x0, 0.452, a1),
                            (x0 + 0.006, 0.476, a0 + 0.012), (x1 - 0.006, 0.476, a0 + 0.012),
                            (x1 - 0.006, 0.476, a1 - 0.012), (x0 + 0.006, 0.476, a1 - 0.012)):
                vs.append(bm.verts.new((x, r * math.cos(a), r * math.sin(a))))
            for q in ((4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
                bm.faces.new([vs[i] for i in q]).material_index = 0
    # rim barrel + lip + dish (Metal=1, DarkTrim=2)
    rim = [(-0.16, 0.278), (0.13, 0.278), (0.158, 0.284), (0.17, 0.27), (0.165, 0.25), (0.145, 0.24),
           (0.10, 0.234), (0.07, 0.222), (0.05, 0.19), (0.045, 0.09)]
    revolve(bm, rim, WSEG, [2, 1, 1, 1, 1, 1, 2, 2, 2])
    # hub (Metal)
    hub = [(0.04, 0.095), (0.135, 0.095), (0.152, 0.082), (0.162, 0.05), (0.166, 0.0)]
    rings = revolve(bm, hub[:-1], 18, 1)
    tip = bm.verts.new((hub[-1][0], 0, 0))
    for k in range(18):
        bm.faces.new((rings[-1][k], rings[-1][(k + 1) % 18], tip)).material_index = 1
    # spokes (Metal)
    for s in range(6):
        ang = 2 * math.pi * s / 6
        secs = []
        for r, wdt, xf in ((0.08, 0.085, 0.15), (0.17, 0.06, 0.142), (0.244, 0.05, 0.135)):
            sec = []
            for (ux, uw) in ((-1, -1), (-0.6, -1.25), (0.6, -1.25), (1, -1), (1, 1), (0.6, 1.25), (-0.6, 1.25), (-1, 1)):
                x = 0.055 + (xf - 0.055) * (ux + 1) / 2
                tw = 0.5 * wdt * (uw / 1.25 if abs(uw) > 1 else uw * 0.92)
                py, pz = r, tw
                sec.append(bm.verts.new((x, py * math.cos(ang) - pz * math.sin(ang), py * math.sin(ang) + pz * math.cos(ang))))
            secs.append(sec)
        for a in range(2):
            for q in range(8):
                f = bm.faces.new((secs[a][q], secs[a][(q + 1) % 8], secs[a + 1][(q + 1) % 8], secs[a + 1][q]))
                f.material_index = 1
    return bm


# ---------------------------------------------------------------- assemble
coll = reset()
root = bpy.data.objects.new("OctaneArenaCar", None)
root.empty_display_type = "PLAIN_AXES"
coll.objects.link(root)

bm_body = build_body()
bvh = BVHTree.FromBMesh(bm_body)
body = make_obj(coll, "Body", bm_body, ["BodyPaint", "DarkTrim"], sharp_deg=48)

bm = bmesh.new()
add_patch(bm, bvh, windshield, 18, 10, 0.009, 0)
add_patch(bm, bvh, rear_window, 14, 8, 0.009, 0)
add_patch(bm, bvh, side_window(1), 18, 8, 0.009, 0, p=6)
add_patch(bm, bvh, side_window(-1), 18, 8, 0.009, 0, p=6)
glass = make_obj(coll, "Glass", bm, ["Glass"], sharp_deg=60)

bm = bmesh.new()
for shp, nu, nv, p in ((windshield, 18, 10, 5), (rear_window, 14, 8, 5), (side_window(1), 18, 8, 6), (side_window(-1), 18, 8, 6)):
    add_frame(bm, bvh, shp, nu, nv, 0.005, 0.03, 0, p)
add_patch(bm, bvh, front_quad((-0.40, 0.57), (0.40, 0.57), (0.44, 0.67), (-0.44, 0.67)), 12, 4, 0.006, 0, p=5)
add_patch(bm, bvh, front_quad((-0.62, 0.56), (0.62, 0.56), (0.66, 0.66), (-0.66, 0.66), direction=Vector((0, 1, 0))), 12, 4, 0.006, 0, p=5)
for sgn in (1, -1):
    add_patch(bm, bvh, hood_vent(sgn), 8, 5, 0.006, 0, p=5)
add_patch(bm, bvh, front_quad((-0.90, 0.895), (0.90, 0.895), (0.90, 1.055), (-0.90, 1.055),
                              direction=Vector((0, 1, 0))), 20, 5, 0.004, 0, p=9)
for sgn in (1, -1):
    add_exhaust(bm, sgn * 0.32, 0.615)
add_splitter(bm)
for sgn in (1, -1):
    add_patch(bm, bvh, side_quad((0.30, 0.66), (0.60, 0.66), (0.66, 0.86), (0.42, 0.80), sgn), 8, 5, 0.006, 0, p=5)
trim = make_obj(coll, "Trim", bm, ["DarkTrim", "Metal"], sharp_deg=50)

bm = bmesh.new()
for sgn in (1, -1):
    add_patch(bm, bvh, front_quad((0.36, 0.735), (0.80, 0.755), (0.86, 0.845), (0.50, 0.795), sign=sgn), 12, 5, 0.007, 0, p=9)
heads = make_obj(coll, "Headlights", bm, ["Headlight"], sharp_deg=50)

bm = bmesh.new()
for sgn in (1, -1):
    add_patch(bm, bvh, front_quad((0.44, 0.925), (0.86, 0.925), (0.86, 1.025), (0.54, 1.01), sign=sgn,
                                  direction=Vector((0, 1, 0))), 12, 5, 0.008, 0, p=9)
add_patch(bm, bvh, front_quad((-0.46, 0.958), (0.46, 0.958), (0.46, 0.978), (-0.46, 0.978),
                              direction=Vector((0, 1, 0))), 16, 3, 0.008, 0, p=9)
tails = make_obj(coll, "Taillights", bm, ["TailLight"], sharp_deg=50)

spoiler = make_obj(coll, "Spoiler", build_spoiler(), ["BodyPaint", "DarkTrim"], sharp_deg=45)

wheels = []
for name, sx, sy in (("Wheel_FL", -1, 1), ("Wheel_FR", 1, 1), ("Wheel_RL", -1, -1), ("Wheel_RR", 1, -1)):
    bm = build_wheel()
    if sx < 0:
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi, 3, "Z"))
    wheels.append(make_obj(coll, name, bm, ["Rubber", "Metal", "DarkTrim"], loc=(sx * WX, sy * AX, WR), sharp_deg=38))

del bm_body
for ob in [body, glass, trim, heads, tails, spoiler] + wheels:
    if S != 1.0:
        ob.data.transform(Matrix.Scale(S, 4))
        ob.location = ob.location * S
    ob.parent = root

tri = 0
for ob in coll.objects:
    if ob.type == "MESH":
        t = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        tri += t
        print(f"{ob.name:12s} tris={t}")
print("total tris", tri)
