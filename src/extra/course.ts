import { Quaternion, Vector3, TorusGeometry } from "three";
import { P } from "../config/physics";

export interface RingCheckpoint {
  center: Vector3;
  rotation: Quaternion;
  normal: Vector3;
  opening: number;
  difficulty: "green" | "yellow" | "red";
}
export interface CoursePlatform {
  center: Vector3;
  width: number;
  length: number;
}
export interface RingsCourse {
  id: string;
  start: CoursePlatform;
  finish: CoursePlatform;
  spawn: Vector3;
  spawnYaw: number;
  failHeight: number;
  rings: RingCheckpoint[];
}
export const ringColors = { green: 0x65f69a, yellow: 0xffd76b, red: 0xff667b };
export const ringTubeRadius = 0.07;
// One reusable torus. Scaling gives the requested *inner* radius, with a
// proportionally rounded tube. Visual and physical geometry use identical data.
export function ringGeometry() {
  const geometry = new TorusGeometry(1, ringTubeRadius, 10, 48);
  const positions = geometry.getAttribute("position");
  // Weld both periodic seams exactly for Rapier's internal-edge treatment.
  // Three duplicates seam vertices for UVs; sin(2*pi) is not exactly zero.
  for (let row = 0; row <= 10; row++) {
    const first = row * 49,
      last = first + 48;
    positions.setXYZ(
      last,
      positions.getX(first),
      positions.getY(first),
      positions.getZ(first),
    );
  }
  for (let column = 0; column < 49; column++)
    positions.setXYZ(
      490 + column,
      positions.getX(column),
      positions.getY(column),
      positions.getZ(column),
    );
  return geometry;
}
export const ringScale = (ring: RingCheckpoint) =>
  ring.opening / (1 - ringTubeRadius);

export function createRingsCourse(): RingsCourse {
  // One-based challenge placements: ample green approaches between precision
  // rings, including three isolated red challenges late in the course.
  const yellow = new Set([10, 13, 17, 20, 24, 28, 31, 34, 37, 39]);
  const red = new Set([33, 36, 40]);
  const start = {
    center: new Vector3(),
    width: P.arena.halfWidth * 2 * 0.65,
    length: P.arena.halfLength * 2 * 0.7,
  };
  const centers: Vector3[] = [];
  let position = new Vector3(0, 7, -start.length / 2 - 16);
  for (let i = 0; i < 40; i++) {
    if (i > 0) {
      let heading = 0,
        climb = 0.25,
        spacing = 18;
      if (i < 9) {
        // A wider S with distinct climbs and drops teaches steering immediately.
        // Eighteen-metre approaches and large green openings stay forgiving.
        heading = Math.sin(i * 0.7) * 0.42;
        climb = 0.4 + Math.sin(i * 0.8) * 1.65;
      }
      if (i >= 9 && i < 29) {
        const t = i - 9;
        heading = Math.sin(t * 0.38) * 0.52 + Math.sin(t * 0.19) * 0.2;
        climb = 0.35 + Math.sin(t * 0.6) * 1.65;
        spacing = 16 - t * 0.1;
      }
      if (i >= 29) {
        const t = i - 29;
        heading = Math.sin(t * 0.68) * 0.7;
        climb = Math.sin(t * 0.85) * 2.1 + 0.15;
        spacing = 12.5;
      }
      position = position
        .clone()
        .add(
          new Vector3(
            Math.sin(heading) * spacing,
            climb,
            -Math.cos(heading) * spacing,
          ),
        );
    }
    centers.push(position.clone());
  }
  const rings = centers.map((center, i): RingCheckpoint => {
    const difficulty = red.has(i + 1)
      ? "red"
      : yellow.has(i + 1)
        ? "yellow"
        : "green";
    const previous = i ? centers[i - 1] : new Vector3(0, 7, -start.length / 2);
    const next = centers[Math.min(i + 1, 39)];
    const normal = (
      i === 39 ? center.clone().sub(previous) : next.clone().sub(previous)
    ).normalize();
    return {
      center,
      normal,
      rotation: new Quaternion().setFromUnitVectors(
        new Vector3(0, 0, 1),
        normal,
      ),
      opening: { green: 6, yellow: 3.2, red: 1.6 }[difficulty],
      difficulty,
    };
  });
  const last = rings[39],
    finishCenter = last.center.clone().addScaledVector(last.normal, 24);
  finishCenter.y = last.center.y - 3;
  return {
    id: "skyline-40-v2",
    start,
    rings,
    finish: { center: finishCenter, width: 22, length: 28 },
    spawn: new Vector3(0, 0.36, start.length * 0.3),
    spawnYaw: 0,
    failHeight: -6,
  };
}
