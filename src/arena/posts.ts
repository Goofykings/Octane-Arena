import { Quaternion } from "three";
import { P } from "../config/physics";
/** Solid posts and a flat-front beam. The beam sits behind the fascia;
 * its rounded underside preserves the existing goal opening. */
export function goalFrame(sign: number) {
  const a = P.arena,
    r = a.postRadius;
  return [
    ...[-1, 1].map((side) => ({
      kind: "post" as const,
      radius: r,
      length: a.goalHeight,
      position: [
        side * (a.goalHalf + r),
        a.goalHeight / 2 + r,
        sign * a.halfLength,
      ] as [number, number, number],
      rotation: new Quaternion(),
    })),
    {
      kind: "bar" as const,
      radius: r,
      length: 2 * (a.goalHalf + r),
      size: [2 * (a.goalHalf + 2 * r), 2 * r, 2 * r] as [
        number,
        number,
        number,
      ],
      bevel: a.crossbarBevel,
      position: [
        0,
        a.goalHeight + r,
        sign * (a.halfLength + r + a.crossbarBevel),
      ] as [number, number, number],
      rotation: new Quaternion(),
    },
  ];
}
