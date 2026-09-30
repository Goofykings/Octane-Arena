import * as T from "three";
import { P } from "../config/physics";
import { goalPlane, goalIntersection } from "../game/goals";

/** Visual only: these objects never enter the physics world. */
export class GoalPlanes {
  private rings: T.Mesh[] = [];
  private neutral = false;
  private planes: T.Mesh<T.PlaneGeometry, T.MeshBasicMaterial>[] = [];
  private uniforms = {
    goalZ: { value: 0 },
    goalActive: { value: 0 },
    goalColor: { value: new T.Color() },
  };
  constructor(scene: T.Scene, ball?: T.Object3D) {
    ball?.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) {
        material.onBeforeCompile = (
          shader: T.WebGLProgramParametersWithUniforms,
        ) => {
          Object.assign(shader.uniforms, this.uniforms);
          shader.vertexShader =
            "varying float goalWorldZ;\n" +
            shader.vertexShader.replace(
              "#include <project_vertex>",
              "#include <project_vertex>\ngoalWorldZ = (modelMatrix * vec4(transformed, 1.0)).z;",
            );
          shader.fragmentShader =
            "varying float goalWorldZ; uniform float goalZ; uniform float goalActive; uniform vec3 goalColor;\n" +
            shader.fragmentShader.replace(
              "#include <opaque_fragment>",
              "float goalLine = (1.0 - smoothstep(.018, .05, abs(goalWorldZ - goalZ))) * goalActive;\noutgoingLight = mix(outgoingLight, goalColor, goalLine);\n#include <opaque_fragment>",
            );
        };
        material.customProgramCacheKey = () => "goal-intersection-v1";
      }
    });
    for (const sign of [-1, 1]) {
      const color = sign === 1 ? 0x69e9ff : 0xffb654;
      const plane = new T.Mesh(
        new T.PlaneGeometry(P.arena.goalHalf * 2, P.arena.goalHeight),
        new T.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.045,
          side: T.DoubleSide,
          depthWrite: false,
        }),
      );
      plane.position.set(0, P.arena.goalHeight / 2, goalPlane(sign));
      scene.add(plane);
      this.planes.push(plane);
      const ring = new T.Mesh(
        new T.RingGeometry(0.975, 1, 96),
        new T.MeshBasicMaterial({
          color: 0xeaffff,
          transparent: true,
          opacity: 0.85,
          side: T.DoubleSide,
          depthWrite: false,
        }),
      );
      ring.visible = false;
      ring.renderOrder = 3;
      scene.add(ring);
      this.rings.push(ring);
    }
  }
  setNeutral(neutral: boolean) {
    this.neutral = neutral;
    this.planes.forEach((plane, i) => plane.material.color.setHex(
      neutral ? 0xa8a8a8 : i === 0 ? 0xffb654 : 0x69e9ff,
    ));
    this.rings.forEach((ring) => (ring.material as T.MeshBasicMaterial).color.setHex(
      neutral ? 0xbcbcbc : 0xeaffff,
    ));
  }
  update(ball: T.Object3D) {
    this.uniforms.goalActive.value = 0;
    [-1, 1].forEach((sign, i) => {
      const intersection = goalIntersection(ball.position, sign),
        ring = this.rings[i];
      ring.visible = ball.visible && intersection !== null;
      if (!intersection) return;
      this.uniforms.goalActive.value = ball.visible ? 1 : 0;
      this.uniforms.goalZ.value = intersection.z;
      this.uniforms.goalColor.value.setRGB(
        ...((this.neutral ? [1.2, 1.2, 1.2] : sign < 0 ? [2.2, 0.25, 0.025] : [0.025, 1.2, 2.2]) as [
          number,
          number,
          number,
        ]),
      );
      ring.position.set(ball.position.x, ball.position.y, intersection.z);
      ring.scale.setScalar(intersection.radius + 0.008);
    });
  }
}
