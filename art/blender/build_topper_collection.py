"""Original Octane Arena topper collection. Execute in Blender using Blender MCP.

Metres, Z up, +Y forward; roof mount is (0,0,0). glTF exports Y up / -Z forward.
No external models, procedural dependencies or unapplied subdivision modifiers.
"""
import bpy, math, json, random
from pathlib import Path
from mathutils import Vector
from math import sin, cos, pi

ROOT = Path('C:/Users/Public/Octane-Arena-New')
MODELS = ROOT / 'public/models/toppers'
IMAGES = ROOT / 'public/images/toppers'
ART = ROOT / 'art/blender'
for directory in (MODELS, IMAGES, ART): directory.mkdir(parents=True, exist_ok=True)
random.seed(82)

def material(name, rgb, metallic=0, rough=.4, emission=0, alpha=1):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, alpha)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*rgb, alpha)
    p.inputs['Metallic'].default_value = metallic
    p.inputs['Roughness'].default_value = rough
    p.inputs['Alpha'].default_value = alpha
    p.inputs['Emission Color'].default_value = (*rgb, 1)
    p.inputs['Emission Strength'].default_value = emission
    if alpha < 1:
        m.surface_render_method = 'BLENDED'
        m.use_transparency_overlap = False
    return m

def mesh(name, verts, faces, mat, smooth=True, parent=None):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces); data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent or current
    if mat: data.materials.append(mat)
    for p in data.polygons: p.use_smooth = smooth
    return obj

def finish(obj, name, mat, parent=None):
    obj.name = name; obj.parent = parent or current
    obj.data.materials.append(mat)
    for p in obj.data.polygons: p.use_smooth = True
    return obj

def ellipsoid(name, at, radii, mat, seg=24, rings=12, parent=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, location=at)
    obj = finish(bpy.context.object, name, mat, parent)
    obj.scale = radii
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return obj

def box(name, at, dims, mat, bevel=.006, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=at)
    obj = finish(bpy.context.object, name, mat, parent); obj.scale = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new('Soft manufactured edge', 'BEVEL'); mod.width=bevel; mod.segments=2
        bpy.ops.object.modifier_apply(modifier=mod.name)
        normal = obj.modifiers.new('Face normals', 'WEIGHTED_NORMAL')
        bpy.ops.object.modifier_apply(modifier=normal.name)
    else:
        for p in obj.data.polygons: p.use_smooth=False
    return obj

def lathe(name, profile, mat, n=40, parent=None, warp=None):
    verts=[]
    for r,z in profile:
        for i in range(n):
            a=2*pi*i/n
            verts.append((r*cos(a),r*sin(a),z+(warp(a,r) if warp else 0)))
    faces=[]
    for j in range(len(profile)-1):
        for i in range(n): faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
    return mesh(name,verts,faces,mat,parent=parent)

def tube(name, points, radius, mat, sides=6, parent=None):
    verts=[]; faces=[]
    for i,p in enumerate(points):
        p=Vector(p)
        tangent=Vector(points[min(i+1,len(points)-1)])-Vector(points[max(0,i-1)])
        tangent.normalize()
        axis=tangent.cross(Vector((0,0,1)))
        if axis.length < .01: axis=tangent.cross(Vector((0,1,0)))
        axis.normalize(); other=tangent.cross(axis).normalized()
        r=radius[i] if isinstance(radius,list) else radius
        for k in range(sides): verts.append(p+r*(cos(2*pi*k/sides)*axis+sin(2*pi*k/sides)*other))
    for i in range(len(points)-1):
        for k in range(sides): faces.append((i*sides+k,i*sides+(k+1)%sides,(i+1)*sides+(k+1)%sides,(i+1)*sides+k))
    faces += [tuple(reversed(range(sides))),tuple((len(points)-1)*sides+k for k in range(sides))]
    return mesh(name,verts,faces,mat,parent=parent)

def ring(name,r,z,thickness,mat,n=40,parent=None):
    return tube(name,[(r*cos(i*2*pi/n),r*sin(i*2*pi/n),z) for i in range(n+1)],thickness,mat,6,parent)

def empty(name,parent=None):
    obj=bpy.data.objects.new(name,None); bpy.context.collection.objects.link(obj); obj.parent=parent
    return obj

def birthday():
    lathe('Rounded party cone',[(0,0),(.115,0),(.123,.009),(.12,.025),(.012,.3),(.006,.311),(0,.315)],ivory,40)
    # An original constellation pattern, deliberately without copied lettering.
    for i in range(18):
        z=.047+(i%4)*.054; a=i*2.4; r=.12-(.108/.275)*(z-.025)+.003
        points=[]
        for k in range(10):
            angle=k*pi/5; s=.012 if k%2==0 else .005
            surface=r-(.108/.275)*s*sin(angle)
            points.append((surface*cos(a)-s*sin(a)*cos(angle),surface*sin(a)+s*cos(a)*cos(angle),z+s*sin(angle)))
        mesh('Constellation star',points,[tuple(range(10))],blue if i%2 else gold,False)
    ring('Tinsel core',.123,.018,.013,blue,32)
    for i in range(22):
        a=i*2*pi/22
        tube('Folded tinsel',[(r*cos(a+d),r*sin(a+d),z) for r,d,z in [(.118,-.07,.015),(.138,0,.03),(.146,.05,.014),(.131,.08,.006)]],.0045,sky,5)
    for i in range(9):
        a=i*2*pi/9
        tube('Top streamer',[(0,0,.302),(.017*cos(a),.017*sin(a),.345),(.037*cos(a),.037*sin(a),.35),(.044*cos(a),.044*sin(a),.33)],.0045,blue if i%2 else gold,5)

def ears():
    # Rounded triangular shells: back volume, rolled outer lip, recessed inner bowl.
    outline=[(-.086,.015),(-.081,.064),(-.062,.127),(-.035,.189),(-.016,.205),(.005,.189),(.04,.122),(.075,.055),(.086,.015),(.04,.008),(-.035,.008)]
    for side in [-1,1]:
        verts=[]
        for scale,y in [(1,-.035),(1,.016),(.92,.036),(.66,.04),(.54,.016)]:
            for x,z in outline: verts.append((side*.115+side*x*scale,y,.01+(z-.01)*scale))
        n=len(outline); faces=[]
        for j in range(4):
            for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
        faces += [tuple(reversed(range(n))),tuple(4*n+i for i in range(n))]
        obj=mesh('Sculpted gold ear',verts,faces,gold)
        obj.data.materials.append(earinner)
        for p in list(obj.data.polygons)[3*n:4*n]:p.material_index=1
        obj.data.polygons[-1].material_index=1
        bpy.context.view_layer.objects.active=obj; obj.select_set(True)
        mod=obj.modifiers.new('Rounded ear contour','BEVEL');mod.width=.005;mod.segments=3
        bpy.ops.object.modifier_apply(modifier=mod.name);obj.select_set(False)

def cone():
    box('Soft square foot',(0,0,.014),(.3,.3,.028),orange,.018)
    lathe('Foot lip',[(.112,.027),(.112,.037),(.104,.043)],orange)
    levels=[(.104,.035),(.101,.048),(.078,.116),(.063,.163),(.048,.208),(.033,.254),(.018,.298),(.013,.307),(0,.309)]
    obj=lathe('Cone with reflective stripes',levels,orange,40)
    obj.data.materials.append(white)
    for j in [2,4]:
        for p in list(obj.data.polygons)[j*40:(j+1)*40]:p.material_index=1

def halo():
    ring('Floating gold halo',.162,.155,.019,halogold,48)
    ring('Warm luminous core',.163,.158,.009,halolight,48)

def propeller():
    verts=[(0,0,.156)]; faces=[]
    n=40; rows=8
    for j in range(1,rows+1):
        a=(pi/2)*j/rows
        for i in range(n):
            t=i*2*pi/n;verts.append((.142*sin(a)*cos(t),.142*sin(a)*sin(t),.012+.144*cos(a)))
    for i in range(n):faces.append((0,1+i,1+(i+1)%n))
    for j in range(rows-1):
        for i in range(n):faces.append((1+j*n+i,1+j*n+(i+1)%n,1+(j+1)*n+(i+1)%n,1+(j+1)*n+i))
    obj=mesh('Tailored fabric panels',verts,faces,red)
    for m in [yellow,green,blue]:obj.data.materials.append(m)
    for i,p in enumerate(obj.data.polygons):p.material_index=(i%n)//10
    ring('Cap lower seam',.142,.012,.009,blue)
    # Curved crescent brim extends toward +Y, away from the back of the cap.
    verts=[]
    for r in [.115,.207]:
        for i in range(17):
            a=pi*.12+pi*.76*i/16;verts.append((r*cos(a),r*sin(a),.015-.02*(r/.207)**2+.012*cos(a)**2))
    brim=mesh('Curved brim',verts,[(i,i+1,18+i,17+i) for i in range(16)],blue)
    bpy.context.view_layer.objects.active=brim;brim.select_set(True)
    mod=brim.modifiers.new('Brim thickness','SOLIDIFY');mod.thickness=.009;bpy.ops.object.modifier_apply(modifier=mod.name);brim.select_set(False)
    tube('Propeller stem',[(0,0,.15),(0,0,.208)],.009,gold,10)
    rotor=empty('Propeller',current);rotor.location.z=.213
    for side in [-1,1]:
        blade=box('Rounded rotor blade',(side*.084,0,0),(.166,.034,.009),yellow,.004,rotor)
        blade.rotation_euler.y=side*.14;blade.rotation_euler.z=.16
    ellipsoid('Rotor hub',(0,0,.007),(.022,.022,.014),red,16,8,rotor)

def ufo():
    body=empty('Body',current)
    lathe('Saucer shell',[(0,.18),(.055,.181),(.12,.196),(.183,.216),(.195,.226),(.187,.236),(.12,.26),(.065,.274),(0,.277)],hull,48,body)
    ellipsoid('Rounded observation dome',(0,0,.262),(.085,.085,.053),ufoglass,32,12,body)
    ring('Underside ring',.113,.197,.009,trim,40,body)
    ring('Cyan rim',.188,.228,.004,cyan,48,body)
    for i in range(8):
        a=2*pi*i/8
        ellipsoid('Navigation light',(.161*cos(a),.161*sin(a),.247),(.012,.012,.006),cyan,12,6,body)
    lathe('Emitter',[(.039,.182),(.044,.19),(.044,.2)],cyan,32,body)
    # A single open cone, without caps or nested transparency shells.
    lathe('Beam',[(.118,.004),(.037,.182)],beam,32,current)

def top_hat():
    lathe('Curved broad brim',[(.001,.008),(.124,.008),(.176,.015),(.18,.022),(.175,.029),(.12,.022),(.001,.019)],fabric,48,warp=lambda a,r:.009*(r/.18)**3*cos(2*a))
    lathe('Shaped felt crown',[(.119,.018),(.121,.031),(.113,.082),(.12,.22),(.125,.245),(.122,.252),(.001,.253)],fabric,48)
    lathe('Satin black band',[(.121,.038),(.118,.042),(.116,.078),(.118,.082)],band,48)
    ring('Rolled brim edge',.175,.022,.004,band,48)

def banana():
    points=[(0,-.008,.015),(0,-.012,.09),(.002,-.003,.17),(.01,.015,.25),(.022,.039,.314),(.03,.05,.336)]
    tube('Curved banana flesh',points,[.025,.044,.046,.038,.023,.008],cream,14)
    for i in range(4):
        a=2*pi*i/4+.45
        points=[]
        for r,z in [(.032,.188),(.069,.195),(.102,.164),(.12,.11),(.136,.058),(.16,.046)]: points.append((r*cos(a),r*sin(a),z))
        # Elliptical cross sections give the peel useful thickness and a broad face.
        p=tube('Thick hanging peel',points,[.023,.031,.032,.027,.017,.006],yellow,8)
        p.data.materials.append(peelinner)
        for poly in p.data.polygons:
            if poly.index%8 in (0,1,2):poly.material_index=1
    tube('Banana stem',[(0,-.008,.002),(0,-.008,.027)],.018,brown,10)
    for x in [-.014,.014]:ellipsoid('Friendly eye',(x,.042,.244),(.004,.003,.006),black,12,6)

def shark():
    # Cross sections follow a swept leading edge and concave trailing edge.
    sections=[(.0,-.105,.143,.04),(.024,-.103,.13,.038),(.074,-.085,.11,.03),(.14,-.05,.099,.021),(.21,-.008,.105,.014),(.265,.044,.111,.007),(.281,.089,.11,.001)]
    verts=[]
    for z,front,back,width in sections:
        for i in range(16):
            a=2*pi*i/16
            verts.append((width*sin(a),-((front+back)/2+(front-back)/2*cos(a)),z))
    faces=[]
    for j in range(len(sections)-1):
        for i in range(16):faces.append((j*16+i,j*16+(i+1)%16,(j+1)*16+(i+1)%16,(j+1)*16+i))
    faces.append(tuple((len(sections)-1)*16+i for i in range(16)))
    obj=mesh('Swept dorsal fin only',verts,faces,fin)
    # One contour subdivision, baked once. No base, shark or water geometry.
    bpy.context.view_layer.objects.active=obj;obj.select_set(True)
    mod=obj.modifiers.new('Organic contour','SUBSURF');mod.levels=1
    bpy.ops.object.modifier_apply(modifier=mod.name);obj.select_set(False)

def glasses():
    pixel=.022
    for side in [-1,1]:
        # Stair-step lower contour preserves the intentionally pixelated silhouette.
        shape=[(-3,2),(3,2),(3,0),(2,0),(2,-1),(1,-1),(1,-2),(-2,-2),(-2,-1),(-3,-1)]
        verts=[]
        for y in [.042,.068]:
            for x,z in shape:verts.append((side*.086+x*pixel,y,.085+z*pixel))
        n=len(shape);faces=[tuple(reversed(range(n))),tuple(n+i for i in range(n))]
        faces += [(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)]
        mesh('Pixel lens frame',verts,faces,black,False)
        box('Dark inset lens',(side*.086,.069,.087),(.095,.003,.047),lens,0)
        for x,z in [(-.024,.101),(-.004,.081),(.016,.101)]:
            box('White pixel highlight',(side*.086+x,.072,z),(.017,.002,.017),white,0)
        box('Short side arm',(side*.153,-.017,.122),(.018,.17,.021),black,0)
        box('Temple foot',(side*.153,-.093,.061),(.018,.019,.12),black,0)
    box('Pixel brow bridge',(0,.054,.128),(.316,.025,.023),black,0)
    box('Nose bridge',(0,.054,.105),(.051,.027,.018),black,0)

def fries():
    # Rounded carton with a scooped front and high back. Real thickness at the rim.
    n=32;verts=[]
    for j in range(4):
        for i in range(n):
            a=2*pi*i/n
            x=cos(a);y=sin(a)
            # Superellipse gives a carton shape with broad front and softened corners.
            sx=math.copysign(abs(x)**.35,x);sy=math.copysign(abs(y)**.35,y)
            if j==0: rx,ry,z=.095,.048,.007
            elif j==1:rx,ry,z=.126,.063,.169-.047*max(0,y)**4
            elif j==2:rx,ry,z=.12,.057,.169-.047*max(0,y)**4
            else:rx,ry,z=.09,.043,.015
            verts.append((sx*rx,sy*ry,z))
    faces=[]
    for j in range(3):
        for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
    faces += [tuple(reversed(range(n))),tuple(3*n+i for i in range(n))]
    mesh('Sculpted red carton',verts,faces,red)
    for i in range(14):
        x=((i%5)-2)*.041+random.uniform(-.006,.006)
        y= -.036+(i//5)*.035
        height=random.uniform(.15,.23)
        p=box('Golden fry',(x,y,.105+height/2),(.026,.026,height),yellow if i%3 else frygold,.004)
        p.rotation_euler=(random.uniform(-.16,.16),random.uniform(-.2,.2),random.uniform(-.12,.12))
    # 256x64 transparent baked lettering, generated separately with Pillow.
    img=bpy.data.images.load(str(ART/'octane-fries-label.png'),check_existing=True);img.pack()
    m=material('Octane Fries baked white lettering',(1,1,1),rough=.6)
    nodes=m.node_tree.nodes;p=nodes.get('Principled BSDF');tex=nodes.new('ShaderNodeTexImage');tex.image=img
    m.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color']);m.node_tree.links.new(tex.outputs['Alpha'],p.inputs['Alpha'])
    m.surface_render_method='DITHERED';p.inputs['Alpha'].default_value=1
    obj=mesh('Octane Fries front label',[(.098,.064,.058),(-.098,.064,.058),(-.098,.064,.107),(.098,.064,.107)],[(0,1,2,3)],m,False)
    uv=obj.data.uv_layers.new(name='Label UV')
    for loop,coord in zip(uv.data,[(0,0),(1,0),(1,1),(0,1)]):loop.uv=coord

def crown():
    lathe('Solid lower gold band',[(.135,.005),(.146,.006),(.15,.016),(.15,.073),(.145,.08),(.132,.077),(.13,.015),(.135,.005)],gold,48)
    ring('Lower band rolled edge',.148,.015,.006,gold,32)
    ring('Upper band rolled edge',.149,.073,.006,gold,32)
    # Six separate bulging fabric gores beneath the actual metal ribs.
    verts=[];faces=[];n=48;rows=9
    for j in range(rows+1):
        t=j/rows;z=.068+.16*t
        for i in range(n):
            a=2*pi*i/n
            r=(.131+.035*sin(pi*t))*(1-.82*t**3)
            r*=1+.055*(1-cos(6*a))
            verts.append((r*cos(a),r*sin(a),z))
    for j in range(rows):
        for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
    mesh('Six royal velvet cushion gores',verts,faces,velvet)
    for i in range(6):
        a=2*pi*i/6
        points=[]
        for j in range(13):
            t=j/12;r=(.131+.035*sin(pi*t))*(1-.82*t**3)+.008
            points.append((r*cos(a),r*sin(a),.068+.16*t))
        points.append((0,0,.242))
        tube('Raised gold arch',points,.009,gold,6)
        # Raised points add a royal silhouette above the jeweled band.
        ellipsoid('Gold fleur setting',(.145*cos(a),.145*sin(a),.092),(.018,.018,.026),gold,8,4)
    gems=[ruby,emerald,sapphire,diamond]
    for i in range(8):
        a=2*pi*i/8;at=Vector((.151*cos(a),.151*sin(a),.043))
        setting=ellipsoid('Raised jewel bezel',at,(.022,.013,.022),gold,8,4)
        setting.rotation_euler.z=a-pi/2
        # Octagonal faceted gems point outward from their lower-band settings.
        verts=[]
        for radius,depth in [(.017,0),(.018,.009),(.011,.016)]:
            for k in range(8):
                b=k*pi/4;verts.append(at+Vector((cos(a)*depth-sin(a)*radius*cos(b),sin(a)*depth+cos(a)*radius*cos(b),radius*sin(b))))
        faces=[]
        for j in range(2):
            for k in range(8):faces.append((j*8+k,j*8+(k+1)%8,(j+1)*8+(k+1)%8,(j+1)*8+k))
        faces.append(tuple(16+k for k in range(8)))
        mesh('Faceted band jewel',verts,faces,gems[i%4],False)
    ring('Arch meeting collar',.024,.242,.006,gold,24)
    ellipsoid('Royal top orb',(0,0,.264),(.024,.024,.024),gold,20,10)
    ring('Orb equator',.024,.264,.003,gold,24)
    box('Top ornament upright',(0,0,.294),(.009,.009,.035),gold,.002)
    box('Top ornament crossbar',(0,0,.297),(.031,.009,.009),gold,.002)

BUILDERS=[('birthday','birthday-hat','BirthdayHat',birthday),('cat-ears','cat-ears','CatEars',ears),('cone','traffic-cone','TrafficCone',cone),('halo','halo','Halo',halo),('beanie','propeller-hat','PropellerHat',propeller),('ufo','ufo','UFO',ufo),('top-hat','top-hat','TopHat',top_hat),('banana','banana','Banana',banana),('shark-fin','shark-fin','SharkFin',shark),('pixel-sunglasses','pixel-sunglasses','PixelSunglasses',glasses),('octane-fries','octane-fries','OctaneFries',fries),('crown','royal-crown','RoyalCrown',crown)]

def setup_materials():
    global gold,ivory,blue,sky,orange,white,earinner,halogold,halolight,red,yellow,green,hull,trim,ufoglass,cyan,beam,fabric,band,cream,peelinner,brown,black,fin,lens,frygold,velvet,ruby,emerald,sapphire,diamond
    gold=material('Polished warm gold',(.82,.48,.08),.78,.26)
    ivory=material('Pearl party paper',(.84,.89,.95),.06,.48)
    blue=material('Sapphire blue',(.025,.23,.7),.12,.34)
    sky=material('Ice blue tinsel',(.09,.61,.95),.5,.29)
    orange=material('Safety orange',(.98,.155,.016),0,.34)
    white=material('Reflective ivory',(.94,.96,1),.1,.26)
    earinner=material('Recessed amber gold',(.44,.22,.037),.64,.36)
    halogold=material('Halo warm gold',(.95,.51,.035),.48,.25,.65)
    halolight=material('Halo luminous core',(1,.79,.24),.2,.25,2.4)
    red=material('Arcade crimson',(.65,.017,.038),0,.4)
    yellow=material('Sunshine yellow',(.98,.62,.035),0,.38)
    green=material('Cap green',(.035,.49,.16),0,.55)
    hull=material('Midnight saucer alloy',(.038,.071,.12),.66,.29)
    trim=material('Brushed titanium',(.16,.24,.31),.7,.31)
    ufoglass=material('Opaque blue dome',(.04,.23,.34),.48,.19,.12)
    cyan=material('Ion cyan',(.13,.72,1),.1,.24,2.2)
    beam=material('UFO beam',(.27,.82,1),0,.65,.65,.14)
    fabric=material('Charcoal felt',(.015,.019,.028),0,.8)
    band=material('Black satin band',(.008,.011,.018),.06,.34)
    cream=material('Banana cream',(.98,.86,.38),0,.5)
    peelinner=material('Peel inner cream',(.91,.77,.27),0,.62)
    brown=material('Banana stem',(.19,.09,.025),0,.7)
    black=material('Pixel black',(.008,.013,.022),.08,.4)
    fin=material('Ocean blue slate',(.045,.095,.155),.12,.38)
    lens=material('Smoky dark lenses',(.023,.043,.06),.45,.16)
    frygold=material('Toasted fry edges',(.83,.39,.018),0,.55)
    velvet=material('Royal crimson velvet',(.39,.009,.034),0,.87)
    ruby=material('Ruby',(.63,.008,.033),.26,.16)
    emerald=material('Emerald',(.009,.47,.13),.24,.16)
    sapphire=material('Sapphire',(.017,.1,.8),.28,.15)
    diamond=material('Pale ice jewel',(.57,.89,1),.4,.13)

def build():
    global current
    for obj in bpy.context.scene.objects:obj.hide_set(False)
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    for m in list(bpy.data.materials):bpy.data.materials.remove(m)
    setup_materials(); report=[]
    for item_id,slug,name,builder in BUILDERS:
        current=empty(name);current['topper_id']=item_id;current['mount']='roof-local Z=0; +Y forward'
        builder()
        # The carton label keeps its UV layer separate from untextured meshes.
        # Collapse static detail to material batches; preserve animated/transparent nodes.
        for parent in [current]+[p for p in current.children_recursive if p.type=='EMPTY']:
            groups={}
            for obj in list(parent.children):
                if obj.type=='MESH' and obj.name not in ('Beam','Octane Fries front label'):groups.setdefault('static',[]).append(obj)
            for objects in groups.values():
                if len(objects)<2:continue
                bpy.ops.object.select_all(action='DESELECT')
                for obj in objects:obj.select_set(True)
                bpy.context.view_layer.objects.active=objects[0]
                bpy.ops.object.join()
                bpy.context.object.name=parent.name+'_Sculpture'
        # Bake static mesh transforms in parent space; the only moving origin is
        # the explicit Propeller group. Exported bounds now match actual vertices.
        for obj in current.children_recursive:
            if obj.type=='MESH':
                bpy.ops.object.select_all(action='DESELECT');obj.select_set(True)
                bpy.context.view_layer.objects.active=obj
                bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
        bpy.ops.object.select_all(action='DESELECT')
        current.select_set(True)
        for obj in current.children_recursive:obj.select_set(True)
        bpy.context.view_layer.objects.active=current
        bpy.ops.export_scene.gltf(filepath=str(MODELS/(slug+'.glb')),export_format='GLB',use_selection=True,export_yup=True,export_apply=True,export_animations=False,export_materials='EXPORT',export_extras=True)
        tris=0;materials=set()
        for obj in current.children_recursive:
            if obj.type=='MESH':
                obj.data.calc_loop_triangles();tris+=len(obj.data.loop_triangles)
                materials.update(m.name for m in obj.data.materials)
        report.append(dict(id=item_id,slug=slug,root=name,triangles=tris,materials=sorted(materials),glb='models/toppers/'+slug+'.glb',thumbnail='images/toppers/'+slug+'.png'))
        current.hide_render=True
        for obj in current.children_recursive:obj.hide_render=True
    (ART/'topper-manifest.json').write_text(json.dumps(report,indent=2)+'\n')
    setup_preview()
    save_source()
    print(json.dumps(report,indent=2))

def setup_preview():
    scene=bpy.context.scene
    scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
    scene.render.resolution_x=320;scene.render.resolution_y=320;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
    scene.render.film_transparent=False
    scene.world.color=(.12,.12,.12);scene.world.use_nodes=True
    bg=scene.world.node_tree.nodes.get('Background');bg.inputs['Color'].default_value=(.045,.065,.095,1);bg.inputs['Strength'].default_value=.7
    scene.view_settings.view_transform='AgX'
    for name,at,power,color,size in [('Softbox Key',(.55,.75,.9),12,(1,.88,.74),.7),('Cool Fill',(-.65,.4,.5),8,(.57,.77,1),.7),('Edge Light',(.1,-.55,.65),14,(.78,.89,1),.5)]:
        data=bpy.data.lights.new(name,'AREA');data.energy=power;data.color=color;data.shape='DISK';data.size=size
        obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj);obj.location=at;obj.rotation_euler=(Vector((0,0,.15))-obj.location).to_track_quat('-Z','Y').to_euler()
    data=bpy.data.cameras.new('Topper Preview Camera');camera=bpy.data.objects.new('Topper Preview Camera',data);scene.collection.objects.link(camera)
    data.type='ORTHO';data.ortho_scale=.48;scene.camera=camera

def render_thumbnail(slug):
    entry=next(entry for entry in BUILDERS if entry[1]==slug)
    for _,_,name,_ in BUILDERS:
        obj=bpy.data.objects[name]
        obj.hide_render=name!=entry[2]
        for child in obj.children_recursive:child.hide_render=obj.hide_render
    obj=bpy.data.objects[entry[2]]
    coords=[p.matrix_world@Vector(corner) for p in obj.children_recursive if p.type=='MESH' for corner in p.bound_box]
    low=Vector(tuple(min(v[k] for v in coords) for k in range(3)))
    high=Vector(tuple(max(v[k] for v in coords) for k in range(3)))
    center=(low+high)/2
    camera=bpy.context.scene.camera
    camera.location=center+Vector((.52,.95,.59))
    camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.ortho_scale=max(.34,max(high-low)*1.42)
    bpy.context.scene.render.filepath=str(IMAGES/(slug+'.png'))
    bpy.ops.render.render(write_still=True)
    print('Rendered '+slug)

def save_source():
    # One editable collection per accessory, all roof origins preserved. Show the
    # crown initially so opening the source doesn't overlay twelve sculptures.
    for _,_,name,_ in BUILDERS:
        root=bpy.data.objects[name]
        collection=bpy.data.collections.get('Topper / '+name) or bpy.data.collections.new('Topper / '+name)
        if collection.name not in bpy.context.scene.collection.children:
            bpy.context.scene.collection.children.link(collection)
        for obj in [root]+list(root.children_recursive):
            if collection not in list(obj.users_collection):collection.objects.link(obj)
            for old in list(obj.users_collection):
                if old!=collection:old.objects.unlink(obj)
            obj.hide_set(name!='RoyalCrown');obj.hide_render=name!='RoyalCrown'
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':
                area.spaces.active.region_3d.view_location=(0,0,.15)
                area.spaces.active.region_3d.view_distance=.85
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(ART/'octane-arena-toppers.blend'))

if __name__=='__main__':build()
