import { Quaternion, Vector3 } from "three";
import { P } from "../config/physics";
/** Rounded solid frame; inside tangents preserve the existing mouth dimensions.
 * End spheres meet in the solid fascia, leaving no exposed thin joint. */
export function goalFrame(sign: number) {
  const a = P.arena,
    r = a.postRadius;
  return [
    ...[-1, 1].map((side) => ({
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
      radius: r,
      length: 2 * (a.goalHalf + r),
      position: [0, a.goalHeight + r, sign * a.halfLength] as [
        number,
        number,
        number,
      ],
      rotation: new Quaternion().setFromAxisAngle(
        new Vector3(0, 0, 1),
        Math.PI / 2,
      ),
    },
  ];
}
