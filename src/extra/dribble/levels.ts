import { Vector3 } from "three";

export type DribblePiece =
  | { kind: "straight" | "narrow"; length: number; width?: number }
  | { kind: "turn"; degrees: number; radius: number; width?: number }
  | { kind: "ramp" | "descent"; length: number; rise: number; width?: number }
  | { kind: "gap"; length: number };
export interface DribbleLevel {
  id: number;
  name: string;
  width: number;
  pieces: DribblePiece[];
}
const straight = (length: number, width?: number): DribblePiece => ({
  kind: width ? "narrow" : "straight",
  length,
  width,
});
const turn = (degrees: number, radius: number): DribblePiece => ({
  kind: "turn",
  degrees,
  radius,
});
const ramp = (length: number, rise: number): DribblePiece => ({
  kind: rise < 0 ? "descent" : "ramp",
  length,
  rise,
});
const gap = (length: number): DribblePiece => ({ kind: "gap", length });
// Original courses: generous introductions, then measured combinations of the
// same readable pieces. Add another definition here to extend the challenge.
export const dribbleLevels: DribbleLevel[] = [
  {
    id: 1,
    name: "First Carry",
    width: 10,
    pieces: [straight(16), turn(8, 45), straight(5)],
  },
  {
    id: 2,
    name: "Wide Bend",
    width: 10,
    pieces: [straight(9), turn(25, 25), straight(9)],
  },
  {
    id: 3,
    name: "Left and Right",
    width: 9,
    pieces: [
      straight(6),
      turn(30, 22),
      turn(-60, 22),
      turn(30, 22),
      straight(5),
    ],
  },
  {
    id: 4,
    name: "Gentle Rise",
    width: 9,
    pieces: [straight(6), ramp(14, 0.35), straight(5), ramp(12, -0.35)],
  },
  {
    id: 5,
    name: "Wide S",
    width: 8.5,
    pieces: [
      straight(6),
      turn(35, 20),
      turn(-60, 20),
      turn(25, 20),
      straight(5),
    ],
  },
  {
    id: 6,
    name: "Find Your Line",
    width: 7,
    pieces: [straight(10, 5.8), turn(-25, 22), straight(10, 7)],
  },
  {
    id: 7,
    name: "Rolling Hill",
    width: 7.5,
    pieces: [straight(5), ramp(14, 1), straight(4), ramp(14, -1), turn(18, 24)],
  },
  {
    id: 8,
    name: "First Hop",
    width: 7,
    pieces: [
      straight(9),
      ramp(4, 0.12),
      gap(0.9),
      straight(6),
      ramp(5, -0.12),
      straight(6),
    ],
  },
  {
    id: 9,
    name: "Rise and Turn",
    width: 6.5,
    pieces: [
      straight(6),
      ramp(12, 0.8),
      turn(30, 20),
      ramp(12, -0.8),
      straight(5),
    ],
  },
  {
    id: 10,
    name: "Changing Heights",
    width: 6.5,
    pieces: [
      ramp(12, 0.7),
      ramp(10, -0.4),
      turn(-25, 20),
      ramp(10, 0.5),
      ramp(12, -0.8),
    ],
  },
  {
    id: 11,
    name: "Closer S",
    width: 5.5,
    pieces: [
      straight(7),
      turn(35, 17),
      turn(-65, 17),
      turn(30, 17),
      straight(7),
    ],
  },
  {
    id: 12,
    name: "Double Hop",
    width: 6,
    pieces: [
      straight(9),
      ramp(4, 0.12),
      gap(0.9),
      straight(10),
      gap(1),
      straight(8),
      ramp(5, -0.12),
    ],
  },
  {
    id: 13,
    name: "Sharper Lines",
    width: 5.5,
    pieces: [
      straight(6),
      turn(-45, 14),
      straight(5),
      turn(65, 14),
      turn(-20, 16),
      straight(6),
    ],
  },
  {
    id: 14,
    name: "High Road",
    width: 5.5,
    pieces: [
      ramp(15, 1.2),
      straight(16, 4.5),
      turn(15, 24),
      straight(8, 5.5),
      ramp(15, -1.2),
    ],
  },
  {
    id: 15,
    name: "Up Around Down",
    width: 5.2,
    pieces: [
      ramp(16, 1.4),
      turn(40, 18),
      ramp(16, -1.4),
      turn(-30, 18),
      straight(6),
    ],
  },
  {
    id: 16,
    name: "Measured Jump",
    width: 5.5,
    pieces: [
      straight(10),
      ramp(5, 0.18),
      gap(1.4),
      straight(9),
      ramp(6, -0.18),
      turn(20, 22),
    ],
  },
  {
    id: 17,
    name: "Narrow Turns",
    width: 4.6,
    pieces: [
      straight(8),
      turn(40, 14),
      turn(-60, 14),
      turn(20, 14),
      straight(8),
    ],
  },
  {
    id: 18,
    name: "Hop and Flow",
    width: 5,
    pieces: [
      ramp(10, 0.4),
      gap(1),
      straight(7),
      turn(30, 18),
      ramp(10, -0.4),
      straight(7),
      gap(1.2),
      straight(8),
    ],
  },
  {
    id: 19,
    name: "Balance Changes",
    width: 4.8,
    pieces: [
      straight(6),
      turn(-35, 14),
      ramp(12, 0.8),
      straight(8, 4.2),
      turn(55, 15),
      ramp(12, -0.8),
      turn(-20, 18),
    ],
  },
  {
    id: 20,
    name: "Final Flow",
    width: 4.8,
    pieces: [
      straight(7),
      turn(35, 16),
      ramp(12, 0.8),
      gap(1.4),
      straight(8),
      turn(-60, 16),
      ramp(12, -0.8),
      gap(1.5),
      straight(8),
      turn(25, 18),
      straight(7),
    ],
  },
];
export interface PathNode {
  center: Vector3;
  heading: number;
  width: number;
  distance: number;
  connected: boolean;
}
export interface DribbleCourse {
  definition: DribbleLevel;
  nodes: PathNode[];
  spawn: Vector3;
  start: { center: Vector3; width: number; length: number };
  finish: { center: Vector3; heading: number; width: number; height: number };
  failHeight: number;
}
const ease = (t: number) => t * t * (3 - 2 * t);
export function buildDribbleCourse(definition: DribbleLevel): DribbleCourse {
  const nodes: PathNode[] = [
    {
      center: new Vector3(0, 2, 12),
      heading: 0,
      width: 11,
      distance: 0,
      connected: false,
    },
  ];
  const append = (piece: DribblePiece) => {
    const previous = nodes[nodes.length - 1];
    const length =
      piece.kind === "turn"
        ? ((Math.abs(piece.degrees) * Math.PI) / 180) * piece.radius
        : piece.length;
    const count = Math.max(1, Math.ceil(length / 0.75));
    const width =
      "width" in piece ? (piece.width ?? previous.width) : previous.width;
    let position = previous.center.clone();
    for (let i = 1; i <= count; i++) {
      const t = i / count,
        before = (i - 1) / count;
      const heading =
        previous.heading +
        (piece.kind === "turn" ? ((piece.degrees * Math.PI) / 180) * t : 0);
      const middleHeading =
        previous.heading +
        (piece.kind === "turn"
          ? (((piece.degrees * Math.PI) / 180) * (t + before)) / 2
          : 0);
      position = position
        .clone()
        .add(
          new Vector3(
            Math.sin(middleHeading),
            0,
            -Math.cos(middleHeading),
          ).multiplyScalar(length / count),
        );
      position.y =
        previous.center.y +
        (piece.kind === "ramp" || piece.kind === "descent"
          ? piece.rise * ease(t)
          : 0);
      nodes.push({
        center: position.clone(),
        heading,
        width: previous.width + (width - previous.width) * ease(t),
        distance: previous.distance + length * t,
        connected: piece.kind !== "gap",
      });
    }
  };
  append(straight(18, definition.width)); // Preserve the existing approach layout.
  for (const piece of definition.pieces) append(piece);
  append(straight(8, Math.max(7, definition.width)));
  const end = nodes[nodes.length - 1];
  const finish = end.center
    .clone()
    .add(
      new Vector3(
        -Math.sin(end.heading),
        0,
        Math.cos(end.heading),
      ).multiplyScalar(4),
    );
  return {
    definition,
    nodes,
    spawn: new Vector3(0, 2.34, 8),
    start: { center: new Vector3(0, 2, 7), width: 5, length: 6 },
    finish: {
      center: finish,
      heading: end.heading,
      width: end.width,
      height: 6,
    },
    failHeight: Math.min(...nodes.map((n) => n.center.y)) - 5,
  };
}
