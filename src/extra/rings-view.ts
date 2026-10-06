import * as T from "three";
import { arenaThemes, type ArenaId } from "../render/arena-themes";
import { polishMaterial } from "../render/material-polish";
import {
  ringGeometry,
  ringScale,
  ringColors,
  type RingsCourse,
  type CoursePlatform,
} from "./course";

export class RingsLevel {
  readonly scene = new T.Scene();
  readonly rings: T.InstancedMesh;
  readonly clouds: T.InstancedMesh;
  readonly beacon = new T.Mesh(
    new T.TorusGeometry(1, 0.025, 6, 48),
    new T.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
    }),
  );
  private current = -2;
  private progress = -1;
  constructor(
    readonly course: RingsCourse,
    themeId: ArenaId,
  ) {
    const theme = arenaThemes[themeId],
      scene = this.scene;
    scene.background = new T.Color(theme.sky);
    scene.fog = new T.Fog(theme.sky, 350, 950);
    scene.add(
      new T.HemisphereLight(
        theme.skyLight,
        theme.groundLight,
        theme.ambientIntensity,
      ),
    );
    const sun = new T.DirectionalLight(theme.sunlight, theme.sunIntensity);
    sun.position.set(20, 60, 30);
    scene.add(sun);
    const ringMat = polishMaterial(
      new T.MeshStandardMaterial({
        color: 0xffffff,
        metalness: 0.25,
        roughness: 0.35,
      }),
      "light",
    );
    this.rings = new T.InstancedMesh(
      ringGeometry(),
      ringMat,
      course.rings.length,
    );
    this.rings.name = "rings-course-tori";
    const dummy = new T.Object3D();
    course.rings.forEach((ring, i) => {
      dummy.position.copy(ring.center);
      dummy.quaternion.copy(ring.rotation);
      dummy.scale.setScalar(ringScale(ring));
      dummy.updateMatrix();
      this.rings.setMatrixAt(i, dummy.matrix);
      this.rings.setColorAt(i, new T.Color(ringColors[ring.difficulty]));
    });
    this.rings.computeBoundingSphere();
    scene.add(this.rings, this.beacon);
    // Decorative spheres only: no colliders, camera obstacles or death triggers.
    // Even their upper edges remain well below the existing failure plane.
    const anchors = [
      course.start.center,
      ...course.rings.filter((_, i) => i % 2 === 0).map((ring) => ring.center),
      course.finish.center,
    ];
    this.clouds = new T.InstancedMesh(
      new T.SphereGeometry(1, 10, 8),
      new T.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 1,
        metalness: 0,
        emissive: 0xffffff,
        emissiveIntensity: 0.18,
      }),
      anchors.length * 3 * 7,
    );
    this.clouds.name = "rings-cloud-spheres";
    let cloudSeed = 519,
      cloudIndex = 0;
    const random = () => {
      cloudSeed = (Math.imul(cloudSeed, 1664525) + 1013904223) >>> 0;
      return cloudSeed / 4294967296;
    };
    for (const anchor of anchors) {
      for (const lane of [-1, 0, 1]) {
        const x = anchor.x + lane * 48 + (random() - 0.5) * 12;
        const z = anchor.z + (random() - 0.5) * 16;
        for (let puff = 0; puff < 7; puff++) {
          const radius = 5 + random() * 4;
          dummy.position.set(
            x + (random() - 0.5) * 22,
            course.failHeight - 12 - radius - random() * 3,
            z + (random() - 0.5) * 20,
          );
          dummy.quaternion.identity();
          dummy.scale.setScalar(radius);
          dummy.updateMatrix();
          this.clouds.setMatrixAt(cloudIndex++, dummy.matrix);
        }
      }
    }
    this.clouds.computeBoundingSphere();
    scene.add(this.clouds);
    const base = new T.MeshStandardMaterial({
      color: theme.lowerWall,
      metalness: 0.45,
      roughness: 0.6,
    });
    const trim = new T.MeshBasicMaterial({ color: theme.canopy });
    // Shared, original turf texture using this arena's palette. No stadium
    // enclosure or skyline is copied into the intentionally open course.
    const pixels = new Uint8Array(128 * 128 * 4);
    let seed = 73;
    for (let i = 0; i < 128 * 128; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const c = new T.Color(theme.turf[(seed >>> 16) % 3]);
      pixels[i * 4] = c.r * 255;
      pixels[i * 4 + 1] = c.g * 255;
      pixels[i * 4 + 2] = c.b * 255;
      pixels[i * 4 + 3] = 255;
    }
    const turf = new T.DataTexture(pixels, 128, 128);
    turf.magFilter = T.LinearFilter;
    turf.minFilter = T.LinearMipmapLinearFilter;
    turf.generateMipmaps = true;
    turf.wrapS = turf.wrapT = T.RepeatWrapping;
    turf.repeat.set(18, 24);
    turf.needsUpdate = true;
    const floorMat = new T.MeshStandardMaterial({ map: turf, roughness: 0.95 });
    const platform = (
      p: CoursePlatform,
      name: string,
      floorMaterial: T.Material,
    ) => {
      const group = new T.Group();
      group.name = name;
      const block = new T.Mesh(new T.BoxGeometry(p.width, 3, p.length), base);
      block.position.set(p.center.x, p.center.y - 1.5, p.center.z);
      group.add(block);
      const floor = new T.Mesh(
        new T.PlaneGeometry(p.width, p.length),
        floorMaterial,
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.copy(p.center).add(new T.Vector3(0, 0.008, 0));
      group.add(floor);
      for (const side of [-1, 1]) {
        const strip = new T.Mesh(new T.BoxGeometry(0.15, 0.06, p.length), trim);
        strip.position.set(
          p.center.x + side * (p.width / 2 - 0.09),
          p.center.y - 0.02,
          p.center.z,
        );
        group.add(strip);
      }
      scene.add(group);
    };
    platform(course.start, "rings-start-platform", floorMat);
    const checkers = new Uint8Array(8 * 8 * 4);
    for (let i = 0; i < 64; i++) {
      const value = ((i % 8) + Math.floor(i / 8)) % 2 ? 230 : 22;
      checkers.set([value, value, value, 255], i * 4);
    }
    const finishTexture = new T.DataTexture(checkers, 8, 8);
    finishTexture.magFilter = T.NearestFilter;
    finishTexture.needsUpdate = true;
    const finishMat = new T.MeshStandardMaterial({
      map: finishTexture,
      roughness: 0.8,
    });
    platform(course.finish, "rings-finish-platform", finishMat);
    // Low, painted launch chevrons indicate the direction without obstacles.
    const arrowGeo = new T.BufferGeometry().setFromPoints([
      new T.Vector3(-2, 0, 1),
      new T.Vector3(0, 0, -1),
      new T.Vector3(2, 0, 1),
    ]);
    const arrowMat = new T.LineBasicMaterial({ color: theme.marking });
    for (let i = 0; i < 7; i++) {
      const arrow = new T.Line(arrowGeo, arrowMat);
      arrow.position.set(0, 0.022, course.start.length * 0.18 - i * 6);
      scene.add(arrow);
    }
    // A finish arch beside the landing deck; no obstruction across its flight path.
    for (const sign of [-1, 1]) {
      const post = new T.Mesh(new T.BoxGeometry(0.3, 4, 0.3), trim);
      post.position
        .copy(course.finish.center)
        .add(new T.Vector3(sign * (course.finish.width / 2 + 0.5), 1, 0));
      scene.add(post);
    }
    this.update(0, 0);
  }
  update(passed: number, time: number) {
    if (passed !== this.progress) {
      this.course.rings.forEach((ring, i) =>
        this.rings.setColorAt(
          i,
          new T.Color(ringColors[ring.difficulty]).multiplyScalar(
            i < passed ? 0.25 : i === passed ? 2.2 : 0.85,
          ),
        ),
      );
      this.rings.instanceColor!.needsUpdate = true;
      this.progress = passed;
    }
    const ring = this.course.rings[passed];
    this.beacon.visible = !!ring;
    if (!ring) return;
    if (this.current !== passed) {
      this.beacon.position.copy(ring.center);
      this.beacon.quaternion.copy(ring.rotation);
      this.beacon.material.color.setHex(ringColors[ring.difficulty]);
      this.current = passed;
    }
    this.beacon.scale.setScalar(
      ringScale(ring) * (1.08 + Math.sin(time * 3) * 0.006),
    );
  }
  dispose() {
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>(),
      textures = new Set<T.Texture>();
    this.scene.traverse((object) => {
      if (object instanceof T.Mesh || object instanceof T.Line) {
        geometries.add(object.geometry);
        for (const mat of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          materials.add(mat);
          for (const value of Object.values(mat))
            if (value instanceof T.Texture) textures.add(value);
        }
      }
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    textures.forEach((t) => t.dispose());
    this.rings.dispose();
    this.clouds.dispose();
    this.scene.clear();
  }
}
