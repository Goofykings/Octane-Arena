import { dropshotPerimeter } from "../arena/dropshot";
import * as T from "three";
import { tileRadius, dropshotTiles } from "../../shared/dropshot";
/** Per-opening geometry only. Ray/floor clipping prevents any side/outside view
 * of under-floor geometry beyond the exact open hex footprint. No stencil target. */
export class DropshotDepth {
  readonly mesh: T.InstancedMesh<T.CylinderGeometry, T.ShaderMaterial>;
  private matrix = new T.Object3D();
  private color = new T.Color();
  constructor() {
    const geometry = new T.CylinderGeometry(
      tileRadius,
      tileRadius,
      16,
      6,
      1,
      false,
    ).translate(0, -8, 0);
    const material = new T.ShaderMaterial({
      uniforms: { cameraInside: { value: 0 } },
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
      vertexShader: `varying vec3 worldPoint;varying vec3 holeOrigin;varying vec3 tint;varying vec3 holePoint;
   void main(){holePoint=position;vec4 p=instanceMatrix*vec4(position,1.);worldPoint=(modelMatrix*p).xyz;holeOrigin=(modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.)).xyz;tint=instanceColor;gl_Position=projectionMatrix*viewMatrix*vec4(worldPoint,1.);}`,
      fragmentShader: `uniform float cameraInside;varying vec3 worldPoint;varying vec3 holeOrigin;varying vec3 tint;varying vec3 holePoint;
   float hex(vec2 p){p=abs(p);return max(p.x,.5*p.x+.8660254*p.y);}
   void main(){
    float height=cameraPosition.y-holeOrigin.y;if(cameraInside<.5||height<=.001||holePoint.y>-.001)discard;
    float t=height/(cameraPosition.y-worldPoint.y);
    vec2 entry=mix(cameraPosition.xz,worldPoint.xz,t)-holeOrigin.xz;
    if(hex(entry)>${((tileRadius * Math.sqrt(3)) / 2 - 0.002).toFixed(8)})discard;
    float depth=-holePoint.y, fade=exp(-depth*.12);
    float ring=1.-smoothstep(.025,.10,abs(fract(depth/2.6)*2.6-.12));
    float a=atan(holePoint.z,holePoint.x), reflected=1.-smoothstep(.02,.09,abs(sin(a*9.+depth*.09)));
    float fine=step(.965,cos(a*42.))*exp(-mod(depth,.65)*12.);
    float light=(.07+ring*.7+reflected*.1+fine*.3)*fade;
    gl_FragColor=vec4(tint*(.35+light*1.8),(.22+light*.65)*fade);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`,
    });
    this.mesh = new T.InstancedMesh(geometry, material, 140);
    this.mesh.name = "dropshot-open-depth";
    const perimeter = dropshotPerimeter(),
      eye = new T.Vector3();
    this.mesh.onBeforeRender = (_renderer, _scene, camera) => {
      camera.getWorldPosition(eye);
      material.uniforms.cameraInside.value = perimeter.every((p, i) => {
        const q = perimeter[(i + 1) % perimeter.length];
        return (
          (q.x - p.x) * (eye.z - p.y) - (q.y - p.y) * (eye.x - p.x) >= -0.001
        );
      })
        ? 1
        : 0;
    };
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.mesh.setColorAt(0, new T.Color());
  }
  update(states: string) {
    let count = 0;
    for (const tile of dropshotTiles)
      if (states[tile.id] === "2") {
        this.matrix.position.set(tile.x, 0, tile.z);
        this.matrix.updateMatrix();
        this.mesh.setMatrixAt(count, this.matrix.matrix);
        this.mesh.setColorAt(
          count++,
          this.color.setHex(tile.team === 0 ? 0x299fea : 0xf89136),
        );
      }
    this.mesh.count = count;
    this.mesh.visible = count > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
/** Fixed pool, visual only: state/collider changes are immediate and independent. */
export class FallingTiles {
  static readonly duration = 0.45;
  readonly mesh: T.InstancedMesh<T.BufferGeometry, T.MeshBasicMaterial>;
  private ages = new Float32Array(64).fill(1);
  private ids = new Int16Array(64).fill(-1);
  private alphas = new Float32Array(64);
  private next = 0;
  private dummy = new T.Object3D();
  constructor(tileGeometry: T.BufferGeometry) {
    const geometry = tileGeometry.clone();
    geometry.setAttribute(
      "debrisOpacity",
      new T.InstancedBufferAttribute(this.alphas, 1),
    );
    const material = new T.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
    });
    material.onBeforeCompile = (s) => {
      s.vertexShader =
        "attribute float debrisOpacity;varying float fallingAlpha;\n" +
        s.vertexShader.replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nfallingAlpha=debrisOpacity;",
        );
      s.fragmentShader =
        "varying float fallingAlpha;\n" +
        s.fragmentShader.replace(
          "#include <color_fragment>",
          "#include <color_fragment>\ndiffuseColor.a*=fallingAlpha;",
        );
    };
    material.customProgramCacheKey = () => "dropshot-falling-tile-v1";
    this.mesh = new T.InstancedMesh(geometry, material, 64);
    this.mesh.name = "dropshot-falling-tiles";
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.reset();
  }
  reset() {
    this.ages.fill(1);
    this.alphas.fill(0);
    this.mesh.count = 0;
  }
  start(id: number) {
    const i = this.next++ % 64;
    this.ids[i] = id;
    this.ages[i] = 0;
    this.mesh.setColorAt(
      i,
      new T.Color(dropshotTiles[id].team === 0 ? 0x6cceff : 0xffbd70),
    );
  }
  update(dt: number) {
    let count = 0;
    for (let i = 0; i < 64; i++) {
      const age = (this.ages[i] += Math.max(0, dt)),
        t = age / FallingTiles.duration,
        alive = t < 1;
      this.alphas[i] = alive ? 1 - T.MathUtils.smoothstep(t, 0.15, 1) : 0;
      this.dummy.scale.setScalar(alive ? 1 : 0);
      if (alive) {
        const tile = dropshotTiles[this.ids[i]];
        this.dummy.position.set(tile.x, -0.275 - 1.2 * t - 7 * t * t, tile.z);
        this.dummy.rotation.set(t * 0.15, 0, t * 0.1 * (tile.id % 2 ? 1 : -1));
        count = i + 1;
      }
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.count = count;
    this.mesh.visible = count > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.geometry.attributes.debrisOpacity.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
