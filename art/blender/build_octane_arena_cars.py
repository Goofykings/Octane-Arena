# Octane Arena car lineup generator (run inside Blender, or headless:
#   blender -b --factory-startup --python build_octane_arena_cars.py -- [--save X.blend] [--export DIR])
# One parametric shell generator builds every car, so all four share materials, detail level and
# topology density; the designs differ by silhouette, roofline, proportions, nose, tail and stance.
# Design units: body length ~4.0, car faces +Y, +X is the car's right, Z up.
# Each car is scaled by CAR_SCALE (0.295 -> ~1.18 m game hitbox length) under a root empty "Car_<Name>".
# Car_Default is the original car from build_octane_arena_car.py, reproduced vertex for vertex.
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

CAR_SCALE = 0.295
COLL = "OctaneArenaCars"
LINEUP_SPACING = 1.0  # metres between car roots along X in the .blend
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
    def purge(c):
        for child in list(c.children):
            purge(child)
        for ob in list(c.objects):
            me = ob.data if ob.type == "MESH" else None
            bpy.data.objects.remove(ob, do_unlink=True)
            if me and me.users == 0:
                bpy.data.meshes.remove(me)
        bpy.data.collections.remove(c)

    old = bpy.data.collections.get(COLL)
    if old:
        purge(old)
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
        raise RuntimeError(f"patch ray missed the body at {tuple(round(c, 3) for c in P)}")
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
FRONT, REAR = Vector((0, -1, 0)), Vector((0, 1, 0))


def front_quad(c00, c10, c11, c01, sign=1.0, direction=None):
    """(x, z) quad projected along -Y onto the nose (or along +Y onto the tail with direction=REAR)."""
    d = direction or FRONT
    def f(a, b):
        u, v = (a + 1) / 2, (b + 1) / 2
        x = lerp(lerp(c00[0], c10[0], u), lerp(c01[0], c11[0], u), v)
        z = lerp(lerp(c00[1], c10[1], u), lerp(c01[1], c11[1], u), v)
        hu = 0.5 * abs(c10[0] - c00[0]) + 1e-3
        hv = 0.5 * abs(c01[1] - c00[1]) + 1e-3
        return Vector((sign * x, -d.y * 3.0, z)), d, hu, hv
    return f


def side_quad(c00, c10, c11, c01, side):
    """(y, z) quad projected across X onto the flank."""
    def f(a, b):
        u, v = (a + 1) / 2, (b + 1) / 2
        y = lerp(lerp(c00[0], c10[0], u), lerp(c01[0], c11[0], u), v)
        z = lerp(lerp(c00[1], c10[1], u), lerp(c01[1], c11[1], u), v)
        return Vector((side * 3.0, y, z)), Vector((-side, 0, 0)), 0.5 * abs(c10[0] - c00[0]), 0.5 * abs(c01[1] - c00[1])
    return f


def revolve(bm, prof, seg, mats):
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


# ---------------------------------------------------------------- car design
class Car:
    """The original Octane Arena car. Variants subclass it and override the knobs and curves."""

    name = "Default"
    # layout
    AXF = AXR = 1.24                  # front / rear axle |y|
    RA, RAZ, ZR = 0.55, 0.53, 0.49    # arch half-length / height, rocker height
    YEND, REND = 1.87, 0.12           # loft end |y|, end rounding radius
    XW = 0.62                         # wheel-well inner wall |x|
    WX, WR, WSEG = 0.86, 0.476, 32    # wheel |x|, outer lug radius (= axle height), segments
    CLAD = 14                         # half-section vertex index below which faces are DarkTrim
    STATIONS = 56                     # evenly spaced loft sections (arch sections are added on top)
    # shell section
    LEAN_Y, LEAN_Z = 1.55, 0.45       # nose/tail lean starts at |y|, pivots about z
    NOSE_LEAN, TAIL_LEAN = -0.30, 0.06
    GB_MAX, GB_IN = 0.90, 0.14        # greenhouse base: half-width cap, inset from the shoulder
    RF_MAX, RF_IN = 0.70, 0.20        # roof: half-width cap, inset from the greenhouse base
    ROOF_CROWN, HOOD_CROWN = 0.035, 0.018
    R_SIDE, R_SHOULDER = (0.22, 0.06), 0.09  # flank corner radius (open, at the doors), shoulder radius
    SIDE_MID = (0.42, 0.52)           # flank corner height between arch and belt (open, at the doors)
    DOOR = (-0.78, -0.42, 0.42, 0.78)  # door zone ramps
    # glass: y range bottom->top, half-widths, projection direction, grow extents
    WS = dict(y=(0.70, 0.10), hw=(0.63, 0.51), d=(0, -0.6, -0.8), h=(0.57, 0.30))
    RW = dict(y=(-1.36, -0.93), hw=(0.58, 0.48), d=(0, 0.55, -0.83), h=(0.53, 0.22))
    SW = dict(yb=(-1.10, 0.58), yt=(-0.84, 0.06), h=(0.8, 0.22))
    # trim and lights: front/rear quads are (x, z) corners, side quads (y, z) corners
    GRILLE = ((-0.40, 0.57), (0.40, 0.57), (0.44, 0.67), (-0.44, 0.67))
    DIFFUSER = ((-0.62, 0.56), (0.62, 0.56), (0.66, 0.66), (-0.66, 0.66))
    HOOD_VENT = dict(y=(0.98, 1.38), x=(0.24, 0.50), skew=0.07)
    REAR_PANEL = ((-0.90, 0.895), (0.90, 0.895), (0.90, 1.055), (-0.90, 1.055))
    EXHAUST = dict(x=(0.32, -0.32), z=0.615, r=0.055)
    SPLITTER = dict(hw=0.80, z=0.545)
    SIDE_VENT = ((0.30, 0.66), (0.60, 0.66), (0.66, 0.86), (0.42, 0.80))
    HEADLIGHT = ((0.36, 0.735), (0.80, 0.755), (0.86, 0.845), (0.50, 0.795))
    HEADLIGHT_P = 9
    TAILLIGHT = ((0.44, 0.925), (0.86, 0.925), (0.86, 1.025), (0.54, 1.01))
    TAIL_BAR = ((-0.46, 0.958), (0.46, 0.958), (0.46, 0.978), (-0.46, 0.978))
    # rear wing: centre, chord, span, angle of attack (deg), tip lift/sweep, struts, end plates
    WING = dict(y=-1.74, z=1.57, chord=0.42, span=1.0, aoa=9, lift=0.07, sweep=-0.06,
                strut_x=0.52, strut_y=(-1.60, -1.76), strut_base=-1.68, strut_len=(0.24, 0.15), plates=0.0)
    # wheels
    TIRE_W, SPOKES, SPOKE_W, SPOKE_TWIST, LUGS = 1.0, 6, 1.0, 0.0, 22

    def __init__(self):
        self.curves()
        self.ws_dir = Vector(self.WS["d"]).normalized()
        self.rw_dir = Vector(self.RW["d"]).normalized()

    def curves(self):
        AX, YEND, ZR = self.AXF, self.YEND, self.ZR
        self.z_rock = Pchip([(-YEND, 0.53), (-1.55, ZR), (1.55, ZR), (YEND, 0.52)])
        self.hw = Pchip([(-YEND, 1.04), (-1.62, 1.12), (-AX, 1.15), (-0.82, 1.04), (-0.4, 0.96), (0.4, 0.96),
                         (0.82, 1.04), (AX, 1.15), (1.62, 1.10), (YEND, 1.0)])
        self.z_belt = Pchip([(-YEND, 1.16), (-AX, 1.25), (-0.65, 1.14), (0.0, 1.12), (0.65, 1.13),
                             (AX, 1.20), (1.62, 1.08), (YEND, 0.92)])
        self.z_ctr = Pchip([(-YEND, 1.13), (-AX, 1.15), (-0.6, 1.12), (0.7, 1.10), (AX, 1.03),
                            (1.62, 0.95), (YEND, 0.86)])
        self.H = Pchip([(-1.48, 0.0), (-1.38, 0.05), (-1.0, 0.31), (-0.7, 0.435), (-0.3, 0.485), (0.05, 0.465),
                        (0.45, 0.24), (0.70, 0.05), (0.80, 0.0)])
        self.taper = Pchip([(-1.5, 0.86), (-0.8, 0.95), (-0.2, 1.0)])

    # ------------------------------------------------------------ shell
    def door(self, y):
        a, b, c, d = self.DOOR
        return sstep(a, b, y) * (1 - sstep(c, d, y))

    def frame(self, y):
        w = self.hw(y)
        xs = w - 0.03
        xgb = smin(self.GB_MAX, xs - self.GB_IN, 0.06)
        xrf = smin(self.RF_MAX, xgb - self.RF_IN, 0.06) * self.taper(y)
        return dict(w=w, xs=xs, xgb=xgb, xrf=xrf, zb=self.z_belt(y), zc=self.z_ctr(y), h=self.H(y))

    def top_z(self, y, x, F=None):
        F = F or self.frame(y)
        z = F["zc"] + (F["zb"] - F["zc"]) * sstep(0.30 * F["xs"], 0.92 * F["xs"], x)
        z += F["h"] * (1 - sstep(F["xrf"], F["xgb"], x))
        if x < F["xrf"]:
            z += self.ROOF_CROWN * (F["h"] / 0.55) * (1 - (x / F["xrf"]) ** 2) ** 2
        z += self.HOOD_CROWN * (1 - (min(x, F["xs"]) / F["xs"]) ** 2)
        return z

    def arch_z(self, y):
        za = self.z_rock(y)
        for ax in (-self.AXR, self.AXF):
            dy = y - ax
            if abs(dy) < self.RA:
                za = max(za, self.ZR + self.RAZ * math.sqrt(1 - (dy / self.RA) ** 2))
        return za

    def section(self, y):
        F = self.frame(y)
        dr = self.door(y)
        za, zf = self.arch_z(y), self.z_rock(y) - 0.05
        w, xs = F["w"], F["xs"]
        XW = self.XW
        zmid = za + lerp(*self.SIDE_MID, dr) * (F["zb"] - za)
        K = [V2(0, zf), V2(XW, zf), V2(XW, za), V2(w - 0.035 - 0.035 * dr, za), V2(w, zmid), V2(xs, F["zb"]),
             V2(F["xgb"], self.top_z(y, F["xgb"], F))]
        R = [0, 0.02, 0.02, 0.035, lerp(*self.R_SIDE, dr), self.R_SHOULDER, 0]
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
        pts += [V2(x, self.top_z(y, x, F)) for x in xs_list]
        return pts

    def shear(self, y, z):
        if y > 0:
            return sstep(self.LEAN_Y, self.YEND, y) * self.NOSE_LEAN * (z - self.LEAN_Z)
        return sstep(-self.LEAN_Y, -self.YEND, y) * self.TAIL_LEAN * (z - self.LEAN_Z)

    def body_ys(self):
        YEND, RA = self.YEND, self.RA
        n = self.STATIONS
        ys = [-YEND + i * (2 * YEND) / n for i in range(n + 1)]
        arch = [ax + RA * math.cos(math.pi * k / 16) for ax in (-self.AXR, self.AXF) for k in range(17)]
        ys = [y for y in ys if all(abs(y - a) > 0.028 for a in arch)] + arch
        return sorted(set(y for y in (round(y, 5) for y in ys) if -YEND <= y <= YEND))

    def build_body(self):
        bm = bmesh.new()
        YEND, REND = self.YEND, self.REND

        def ring_from_half(half, y, wsh=None):
            M = len(half)
            full = half + [V2(-p.x, p.y) for p in reversed(half[1:M - 1])]
            out = []
            for p in full:
                if wsh is None:
                    yy = y + self.shear(y, p.y)
                else:
                    yy = y + wsh * (self.NOSE_LEAN if y > 0 else self.TAIL_LEAN) * (p.y - self.LEAN_Z)
                out.append(bm.verts.new((p.x, yy, p.y)))
            return out

        def inset(half, d):
            xmax = max(p.x for p in half)
            zmin, zmax = min(p.y for p in half), max(p.y for p in half)
            zm, hz = 0.5 * (zmin + zmax), 0.5 * (zmax - zmin)
            return [V2(p.x * (1 - d / xmax), zm + (p.y - zm) * (1 - 0.8 * d / hz)) for p in half], zm

        ys = self.body_ys()
        halves = {y: self.section(y) for y in ys}
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
                    f.material_index = 1 if min(half_idx(i), half_idx(j)) < self.CLAD else 0
        for ring, _ in (rings[0], rings[-1]):
            c = sum((v.co for v in ring), Vector()) / len(ring)
            cv = bm.verts.new(c)
            for i in range(N):
                f = bm.faces.new((ring[i], ring[(i + 1) % N], cv))
                f.material_index = 1 if f.calc_center_median().z < 0.55 else 0
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        return bm

    # ------------------------------------------------------------ glass shapes
    def windshield(self, a, b):
        P = self.WS
        t = (b + 1) / 2
        x, y = a * lerp(*P["hw"], t), lerp(*P["y"], t)
        return Vector((x, y, self.top_z(y, abs(x)))), self.ws_dir, *P["h"]

    def rear_window(self, a, b):
        P = self.RW
        t = (b + 1) / 2
        x, y = a * lerp(*P["hw"], t), lerp(*P["y"], t)
        return Vector((x, y, self.top_z(y, abs(x)))), self.rw_dir, *P["h"]

    def side_window(self, side):
        P = self.SW
        def f(a, b):
            u, v = (a + 1) / 2, (b + 1) / 2
            y = lerp(lerp(*P["yb"], u), lerp(*P["yt"], u), v)
            Fy = self.frame(y)
            zb = self.top_z(y, Fy["xgb"], Fy) + 0.035
            zt = self.top_z(y, Fy["xrf"] + 0.025, Fy) - 0.04
            return Vector((side * 3.0, y, lerp(zb, zt, v))), Vector((-side, 0, 0)), *P["h"]
        return f

    def hood_vent(self, side):
        P = self.HOOD_VENT
        def f(a, b):
            u, v = (a + 1) / 2, (b + 1) / 2
            y = lerp(*P["y"], v)
            x = lerp(*P["x"], u) + P["skew"] * v
            return Vector((side * x, y, 3.0)), DOWN, 0.5 * (P["x"][1] - P["x"][0]), 0.5 * (P["y"][1] - P["y"][0])
        return f

    # ------------------------------------------------------------ trim pieces
    def add_exhaust(self, bm, x, z, r=0.055, seg=16):
        y0, y1 = -self.YEND - self.REND + 0.06, -self.YEND - self.REND - 0.05
        prof = [(r, y0, 1), (r, y1, 1), (r * 0.78, y1, 1), (r * 0.78, y1 + 0.06, 0)]
        rings = [[bm.verts.new((x + rr * math.cos(2 * math.pi * k / seg), yy, z + rr * math.sin(2 * math.pi * k / seg)))
                  for k in range(seg)] for rr, yy, _ in prof]
        for a in range(len(prof) - 1):
            for k in range(seg):
                q = (k + 1) % seg
                bm.faces.new((rings[a][k], rings[a][q], rings[a + 1][q], rings[a + 1][k])).material_index = prof[a][2]
        bm.faces.new(rings[-1]).material_index = 0

    def add_splitter(self, bm):
        # thin rounded lip under the nose, wider than the grille, slightly proud of the bumper
        hw, z = self.SPLITTER["hw"], self.SPLITTER["z"]
        ys = self.YEND + self.REND - 0.10
        sec = []
        for q in range(16):
            a = 2 * math.pi * q / 16
            sec.append((hw * math.copysign(abs(math.cos(a)) ** 0.35, math.cos(a)),
                        0.08 * math.copysign(abs(math.sin(a)) ** 0.35, math.sin(a))))
        top, bot = [], []
        for x, dy in sec:
            top.append(bm.verts.new((x, ys + dy, z)))
            bot.append(bm.verts.new((x, ys + dy - 0.01, z - 0.03)))
        bm.faces.new(top)
        bm.faces.new(list(reversed(bot)))
        for q in range(16):
            bm.faces.new((top[q], top[(q + 1) % 16], bot[(q + 1) % 16], bot[q]))

    def details(self, bvh):
        """Returns (trim, headlight, taillight) bmeshes projected onto the body."""
        bm = bmesh.new()
        frames = ((self.windshield, 18, 10, 5), (self.rear_window, 14, 8, 5),
                  (self.side_window(1), 18, 8, 6), (self.side_window(-1), 18, 8, 6))
        for shp, nu, nv, p in frames:
            add_frame(bm, bvh, shp, nu, nv, 0.005, 0.03, 0, p)
        if self.GRILLE:
            add_patch(bm, bvh, front_quad(*self.GRILLE), 12, 4, 0.006, 0, p=5)
        if self.DIFFUSER:
            add_patch(bm, bvh, front_quad(*self.DIFFUSER, direction=REAR), 12, 4, 0.006, 0, p=5)
        if self.HOOD_VENT:
            for sgn in (1, -1):
                add_patch(bm, bvh, self.hood_vent(sgn), 8, 5, 0.006, 0, p=5)
        if self.REAR_PANEL:
            add_patch(bm, bvh, front_quad(*self.REAR_PANEL, direction=REAR), 20, 5, 0.004, 0, p=9)
        for x in self.EXHAUST["x"]:
            self.add_exhaust(bm, x, self.EXHAUST["z"], self.EXHAUST["r"])
        self.add_splitter(bm)
        if self.SIDE_VENT:
            for sgn in (1, -1):
                add_patch(bm, bvh, side_quad(*self.SIDE_VENT, sgn), 8, 5, 0.006, 0, p=5)

        heads = bmesh.new()
        for sgn in (1, -1):
            add_patch(heads, bvh, front_quad(*self.HEADLIGHT, sign=sgn), 12, 5, 0.007, 0, p=self.HEADLIGHT_P)

        tails = bmesh.new()
        for sgn in (1, -1):
            add_patch(tails, bvh, front_quad(*self.TAILLIGHT, sign=sgn, direction=REAR), 12, 5, 0.008, 0, p=9)
        if self.TAIL_BAR:
            add_patch(tails, bvh, front_quad(*self.TAIL_BAR, direction=REAR), 16, 3, 0.008, 0, p=9)
        return bm, heads, tails

    # ------------------------------------------------------------ spoiler
    def build_spoiler(self):
        P = self.WING
        bm = bmesh.new()
        yc, zc, chord, span = P["y"], P["z"], P["chord"], P["span"]
        aoa = math.radians(P["aoa"])
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
            e = abs(x) / 1.0
            sc = 1.0 if e <= 0.95 else math.sqrt(max(0.0, 1 - ((e - 0.95) / 0.05) ** 2)) * 0.9 + 0.1
            lift = P["lift"] * sstep(0.55, 1.0, e)
            sweep = P["sweep"] * e * e
            ring = []
            for u, th in loop:
                ly, lz = (0.5 - u) * chord, th * chord * sc
                ly *= lerp(1.0, sc, 0.6)
                ry = ly * math.cos(aoa) - lz * math.sin(aoa)
                rz = ly * math.sin(aoa) * -1 + lz * math.cos(aoa)
                ring.append(bm.verts.new((x * span, yc + ry + sweep, zc + rz + lift)))
            rings.append(ring)
        L = len(loop)
        for a in range(len(rings) - 1):
            for i in range(L):
                bm.faces.new((rings[a][i], rings[a][(i + 1) % L], rings[a + 1][(i + 1) % L], rings[a + 1][i]))
        for ring in (rings[0], rings[-1]):
            bm.faces.new(ring)
        # struts
        for sx in (-P["strut_x"], P["strut_x"]):
            secs = []
            for k, t in enumerate((0.0, 0.5, 1.0)):
                zz = lerp(self.top_z(P["strut_base"], abs(sx)) - 0.04, zc - 0.005, t)
                yy = lerp(*P["strut_y"], t)
                ln = lerp(*P["strut_len"], t)
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
        # end plates: rounded fins that cap the wing tips
        if P["plates"]:
            ph, pl, n = P["plates"], 0.62 * chord, 24
            yp, zp = yc + P["sweep"] - 0.03, zc + P["lift"] - 0.3 * ph
            for sgn in (-1, 1):
                loops = []
                for x in (sgn * (span - 0.012), sgn * (span + 0.016)):
                    loops.append([bm.verts.new((x, yp + pl * c, zp + ph * s))
                                  for c, s in (squircle(math.cos(2 * math.pi * q / n), math.sin(2 * math.pi * q / n), 5)
                                               for q in range(n))])
                for q in range(n):
                    bm.faces.new((loops[0][q], loops[0][(q + 1) % n], loops[1][(q + 1) % n], loops[1][q]))
                bm.faces.new(loops[0])
                bm.faces.new(loops[1])
        return bm

    # ------------------------------------------------------------ wheels
    def build_wheel(self):
        bm = bmesh.new()
        WSEG = self.WSEG
        # tire (Rubber=0)
        half = [(-0.165, 0.28), (-0.182, 0.32), (-0.192, 0.365), (-0.188, 0.408), (-0.172, 0.438),
                (-0.146, 0.455), (-0.105, 0.462), (-0.055, 0.462), (-0.05, 0.449), (-0.03, 0.449), (-0.025, 0.462)]
        tire = half + [(-x, r) for x, r in reversed(half)]
        revolve(bm, tire, WSEG, 0)
        NL = self.LUGS
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
        for s in range(self.SPOKES):
            secs = []
            for k, (r, wdt, xf) in enumerate(((0.08, 0.085, 0.15), (0.17, 0.06, 0.142), (0.244, 0.05, 0.135))):
                ang = 2 * math.pi * s / self.SPOKES + self.SPOKE_TWIST * k / 2
                wdt *= self.SPOKE_W
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
        if self.TIRE_W != 1.0:
            bmesh.ops.scale(bm, vec=(self.TIRE_W, 1, 1), verts=bm.verts)
        return bm

    # ------------------------------------------------------------ assemble
    def build(self, parent_coll, x_offset=0.0):
        key = "Car_" + self.name
        coll = bpy.data.collections.new(key)
        parent_coll.children.link(coll)
        root = bpy.data.objects.new(key, None)
        root.empty_display_type = "PLAIN_AXES"
        coll.objects.link(root)

        bm_body = self.build_body()
        bvh = BVHTree.FromBMesh(bm_body)
        body = make_obj(coll, key + "_Body", bm_body, ["BodyPaint", "DarkTrim"], sharp_deg=48)

        bm = bmesh.new()
        add_patch(bm, bvh, self.windshield, 18, 10, 0.009, 0)
        add_patch(bm, bvh, self.rear_window, 14, 8, 0.009, 0)
        add_patch(bm, bvh, self.side_window(1), 18, 8, 0.009, 0, p=6)
        add_patch(bm, bvh, self.side_window(-1), 18, 8, 0.009, 0, p=6)
        glass = make_obj(coll, key + "_Glass", bm, ["Glass"], sharp_deg=60)

        bm_trim, bm_head, bm_tail = self.details(bvh)
        trim = make_obj(coll, key + "_Trim", bm_trim, ["DarkTrim", "Metal"], sharp_deg=50)
        heads = make_obj(coll, key + "_Headlights", bm_head, ["Headlight"], sharp_deg=50)
        tails = make_obj(coll, key + "_Taillights", bm_tail, ["TailLight"], sharp_deg=50)
        spoiler = make_obj(coll, key + "_Spoiler", self.build_spoiler(), ["BodyPaint", "DarkTrim"], sharp_deg=45)

        wheels = []
        for tag, sx, sy in (("FL", -1, self.AXF), ("FR", 1, self.AXF), ("RL", -1, -self.AXR), ("RR", 1, -self.AXR)):
            bm = self.build_wheel()
            if sx < 0:
                bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi, 3, "Z"))
            wheels.append(make_obj(coll, f"{key}_Wheel_{tag}", bm, ["Rubber", "Metal", "DarkTrim"],
                                   loc=(sx * self.WX, sy, self.WR), sharp_deg=38))

        for ob in [body, glass, trim, heads, tails, spoiler] + wheels:
            ob.data.transform(Matrix.Scale(CAR_SCALE, 4))
            ob.location = ob.location * CAR_SCALE
            ob.parent = root
        root.location.x = x_offset
        return root


# ---------------------------------------------------------------- variants
class LowFlat(Car):
    """Low, wide, long-hood fastback: cab pushed back, raked glass, flat roof, wide hips."""

    name = "LowFlat"
    AXF = AXR = 1.28
    RA, RAZ, ZR = 0.56, 0.56, 0.42
    WX = 0.92
    STATIONS = 50
    NOSE_LEAN, TAIL_LEAN = -0.50, 0.10
    GB_MAX, GB_IN = 0.92, 0.16
    RF_MAX, RF_IN = 0.64, 0.24
    R_SIDE, R_SHOULDER = (0.24, 0.07), 0.10
    DOOR = (-0.84, -0.46, 0.44, 0.82)
    WS = dict(y=(0.38, -0.14), hw=(0.62, 0.50), d=(0, -0.40, -0.92), h=(0.56, 0.28))
    RW = dict(y=(-1.56, -0.80), hw=(0.56, 0.46), d=(0, 0.30, -0.95), h=(0.51, 0.38))
    SW = dict(yb=(-1.30, 0.30), yt=(-1.02, -0.14), h=(0.8, 0.16))
    GRILLE = ((-0.42, 0.50), (0.42, 0.50), (0.48, 0.60), (-0.48, 0.60))
    DIFFUSER = ((-0.64, 0.52), (0.64, 0.52), (0.68, 0.62), (-0.68, 0.62))
    HOOD_VENT = dict(y=(0.95, 1.40), x=(0.22, 0.46), skew=0.06)
    REAR_PANEL = ((-0.94, 0.80), (0.94, 0.80), (0.94, 0.94), (-0.94, 0.94))
    EXHAUST = dict(x=(0.34, -0.34), z=0.575, r=0.055)
    SPLITTER = dict(hw=0.86, z=0.485)
    SIDE_VENT = ((0.26, 0.60), (0.60, 0.60), (0.66, 0.78), (0.38, 0.74))
    HEADLIGHT = ((0.40, 0.64), (0.82, 0.655), (0.88, 0.715), (0.52, 0.69))
    TAILLIGHT = ((0.40, 0.845), (0.90, 0.845), (0.92, 0.905), (0.46, 0.90))
    TAIL_BAR = ((-0.40, 0.862), (0.40, 0.862), (0.40, 0.882), (-0.40, 0.882))
    # low ducktail lip that sits almost on the deck instead of a strut wing
    WING = dict(y=-1.80, z=1.10, chord=0.36, span=1.04, aoa=14, lift=0.03, sweep=-0.06,
                strut_x=0.50, strut_y=(-1.70, -1.80), strut_base=-1.72, strut_len=(0.24, 0.20), plates=0.0)
    TIRE_W, SPOKES, SPOKE_W = 1.08, 8, 0.6

    def curves(self):
        AX, YEND, ZR = self.AXF, self.YEND, self.ZR
        self.z_rock = Pchip([(-YEND, 0.48), (-1.55, ZR), (1.55, ZR), (YEND, 0.45)])
        self.hw = Pchip([(-YEND, 1.08), (-1.62, 1.17), (-AX, 1.21), (-0.84, 1.08), (-0.4, 0.99), (0.4, 0.99),
                         (0.84, 1.07), (AX, 1.19), (1.62, 1.13), (YEND, 1.02)])
        # flat hood: the fenders rise only slightly above the centre line
        self.z_belt = Pchip([(-YEND, 1.00), (-AX, 1.12), (-0.65, 0.99), (0.0, 0.96), (0.65, 0.98),
                             (AX, 1.10), (1.62, 0.90), (YEND, 0.74)])
        self.z_ctr = Pchip([(-YEND, 0.99), (-AX, 1.02), (-0.6, 0.98), (0.4, 0.96), (AX, 0.97),
                            (1.62, 0.85), (YEND, 0.70)])
        self.H = Pchip([(-1.72, 0.0), (-1.55, 0.03), (-1.20, 0.16), (-0.85, 0.255), (-0.50, 0.29), (-0.20, 0.285),
                        (0.10, 0.20), (0.32, 0.08), (0.45, 0.0)])
        self.taper = Pchip([(-1.6, 0.80), (-0.8, 0.93), (-0.2, 1.0)])


class Boxy(Car):
    """Upright, chunky brawler: tall flat-roofed cabin, square nose and tail, boxed fender flares."""

    name = "Boxy"
    RA, RAZ, ZR = 0.56, 0.52, 0.55
    YEND, REND = 1.86, 0.13
    WX = 0.88
    CLAD = 16
    NOSE_LEAN, TAIL_LEAN = -0.10, 0.02
    GB_MAX, GB_IN = 0.94, 0.12
    RF_MAX, RF_IN = 0.80, 0.10
    R_SIDE, R_SHOULDER = (0.12, 0.05), 0.07
    WS = dict(y=(0.56, 0.16), hw=(0.70, 0.64), d=(0, -0.8, -0.6), h=(0.67, 0.30))
    RW = dict(y=(-1.46, -1.20), hw=(0.66, 0.62), d=(0, 0.85, -0.53), h=(0.64, 0.24))
    SW = dict(yb=(-1.24, 0.46), yt=(-1.12, 0.20), h=(0.85, 0.25))
    GRILLE = ((-0.38, 0.80), (0.38, 0.80), (0.38, 1.02), (-0.38, 1.02))
    DIFFUSER = ((-0.66, 0.62), (0.66, 0.62), (0.66, 0.74), (-0.66, 0.74))
    HOOD_VENT = dict(y=(1.10, 1.40), x=(0.30, 0.56), skew=0.0)
    REAR_PANEL = ((-0.92, 1.00), (0.92, 1.00), (0.92, 1.16), (-0.92, 1.16))
    EXHAUST = dict(x=(0.34, -0.34), z=0.69, r=0.06)
    SPLITTER = dict(hw=0.70, z=0.62)
    SIDE_VENT = None
    HEADLIGHT = ((0.46, 0.86), (0.86, 0.86), (0.86, 1.02), (0.46, 1.02))
    HEADLIGHT_P = 6
    TAILLIGHT = ((0.70, 0.86), (0.92, 0.86), (0.92, 1.18), (0.70, 1.18))
    TAIL_BAR = None
    WING = dict(y=-1.30, z=1.93, chord=0.36, span=0.86, aoa=4, lift=0.0, sweep=0.0,
                strut_x=0.45, strut_y=(-1.12, -1.24), strut_base=-1.10, strut_len=(0.20, 0.14), plates=0.0)
    TIRE_W, SPOKES, SPOKE_W, LUGS = 1.12, 5, 1.6, 16

    def curves(self):
        AX, YEND, ZR = self.AXF, self.YEND, self.ZR
        self.z_rock = Pchip([(-YEND, 0.60), (-1.55, ZR), (1.55, ZR), (YEND, 0.60)])
        self.hw = Pchip([(-YEND, 1.10), (-1.62, 1.16), (-AX, 1.20), (-0.82, 1.12), (-0.4, 1.04), (0.4, 1.04),
                         (0.82, 1.12), (AX, 1.20), (1.62, 1.16), (YEND, 1.10)])
        self.z_belt = Pchip([(-YEND, 1.24), (-AX, 1.32), (-0.65, 1.28), (0.0, 1.27), (0.65, 1.28),
                             (AX, 1.32), (1.62, 1.28), (YEND, 1.20)])
        self.z_ctr = Pchip([(-YEND, 1.20), (-AX, 1.24), (-0.6, 1.25), (0.7, 1.24), (AX, 1.20),
                            (1.62, 1.18), (YEND, 1.13)])
        self.H = Pchip([(-1.58, 0.0), (-1.48, 0.08), (-1.30, 0.42), (-1.10, 0.55), (-0.6, 0.585), (0.0, 0.58),
                        (0.25, 0.52), (0.48, 0.20), (0.62, 0.03), (0.68, 0.0)])
        self.taper = Pchip([(-1.5, 0.94), (-0.8, 0.99), (-0.2, 1.0)])


class Wedge(Car):
    """Doorstop wedge: knife-low nose, one long rising line over a raked canopy, tall chopped tail."""

    name = "Wedge"
    AXF, AXR = 1.18, 1.30
    RA, RAZ, ZR = 0.55, 0.52, 0.46
    YEND, REND = 1.88, 0.10
    STATIONS = 50
    NOSE_LEAN, TAIL_LEAN = -0.55, -0.02
    GB_MAX, GB_IN = 0.88, 0.16
    RF_MAX, RF_IN = 0.66, 0.22
    R_SIDE, R_SHOULDER = (0.20, 0.06), 0.08
    DOOR = (-0.84, -0.46, 0.36, 0.72)
    WS = dict(y=(0.85, -0.08), hw=(0.62, 0.52), d=(0, -0.30, -0.95), h=(0.57, 0.46))
    RW = dict(y=(-1.24, -0.70), hw=(0.54, 0.50), d=(0, 0.25, -0.97), h=(0.52, 0.27))
    SW = dict(yb=(-1.14, 0.70), yt=(-0.82, 0.00), h=(0.9, 0.16))
    GRILLE = ((-0.36, 0.52), (0.36, 0.52), (0.40, 0.59), (-0.40, 0.59))
    DIFFUSER = ((-0.70, 0.62), (0.70, 0.62), (0.74, 0.78), (-0.74, 0.78))
    HOOD_VENT = dict(y=(0.80, 1.30), x=(0.20, 0.40), skew=0.05)
    REAR_PANEL = ((-0.96, 1.08), (0.96, 1.08), (0.96, 1.30), (-0.96, 1.30))
    EXHAUST = dict(x=(0.12, -0.12), z=0.71, r=0.055)
    SPLITTER = dict(hw=0.84, z=0.51)
    SIDE_VENT = ((-0.72, 0.66), (-0.30, 0.70), (-0.36, 0.98), (-0.72, 0.98))
    HEADLIGHT = ((0.40, 0.62), (0.80, 0.64), (0.86, 0.70), (0.52, 0.68))
    TAILLIGHT = ((0.30, 1.15), (0.94, 1.15), (0.94, 1.24), (0.30, 1.24))
    TAIL_BAR = ((-0.30, 1.185), (0.30, 1.185), (0.30, 1.205), (-0.30, 1.205))
    WING = dict(y=-1.78, z=1.68, chord=0.44, span=1.02, aoa=10, lift=0.0, sweep=-0.04,
                strut_x=0.40, strut_y=(-1.62, -1.78), strut_base=-1.66, strut_len=(0.22, 0.16), plates=0.08)
    SPOKES, SPOKE_TWIST = 7, 0.35

    def curves(self):
        YEND, ZR = self.YEND, self.ZR
        AF, AR = self.AXF, self.AXR
        self.z_rock = Pchip([(-YEND, 0.56), (-1.55, ZR), (1.50, ZR), (YEND, 0.48)])
        self.hw = Pchip([(-YEND, 1.12), (-1.62, 1.17), (-AR, 1.19), (-0.84, 1.08), (-0.4, 1.00), (0.4, 0.98),
                         (0.80, 1.04), (AF, 1.10), (1.55, 1.04), (YEND, 0.90)])
        # one rising line: belt and hood centre stay close (flat hood, no fender humps) up to a high flat deck
        self.z_belt = Pchip([(-YEND, 1.42), (-AR, 1.38), (-0.65, 1.26), (0.0, 1.17), (0.65, 1.11),
                             (AF, 1.10), (1.55, 0.92), (YEND, 0.74)])
        self.z_ctr = Pchip([(-YEND, 1.40), (-AR, 1.34), (-0.6, 1.24), (0.0, 1.14), (0.8, 1.03),
                            (AF, 0.97), (1.55, 0.81), (YEND, 0.68)])
        self.H = Pchip([(-1.35, 0.0), (-1.25, 0.02), (-0.95, 0.11), (-0.6, 0.21), (-0.25, 0.26), (0.1, 0.23),
                        (0.45, 0.14), (0.85, 0.03), (1.0, 0.0)])
        self.taper = Pchip([(-1.5, 0.84), (-0.8, 0.94), (-0.2, 1.0)])


CARS = [Car, LowFlat, Boxy, Wedge]


# ---------------------------------------------------------------- build / save / export
def build_lineup():
    coll = reset()
    roots = []
    for i, cls in enumerate(CARS):
        roots.append(cls().build(coll, (i - (len(CARS) - 1) / 2) * LINEUP_SPACING))
    for root in roots:
        tri = 0
        for ob in root.children:
            t = sum(len(p.vertices) - 2 for p in ob.data.polygons)
            tri += t
            print(f"{ob.name:24s} tris={t}")
        print(f"{root.name} total tris {tri}")
    return roots


def export_glb(root, path):
    """Exports one car (root empty + parts) as a GLB, with the root at the origin."""
    saved = root.location.copy()
    root.location = (0, 0, 0)
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    for ob in [root] + list(root.children):
        ob.select_set(True)
    bpy.context.view_layer.objects.active = root
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True,
                              export_texcoords=False, export_normals=True, export_materials="EXPORT",
                              export_cameras=False, export_lights=False, export_extras=False)
    root.location = saved
    bpy.context.view_layer.update()


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opt = {argv[i]: argv[i + 1] for i in range(0, len(argv) - 1, 2)}
    roots = build_lineup()
    if "--export" in opt:
        for root in roots:
            slug = root.name[len("Car_"):].lower()
            export_glb(root, os.path.join(opt["--export"], f"car-{slug}.glb"))
    if "--save" in opt:
        bpy.ops.wm.save_as_mainfile(filepath=opt["--save"])
