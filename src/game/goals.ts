import { P } from "../config/physics";
export const goalPlane = (sign: number) => sign * P.arena.halfLength;
export function goalIntersection(
  position: { x: number; y: number; z: number },
  sign: number,
) {
  const distance = Math.abs(position.z - goalPlane(sign));
  if (
    distance >= P.ball.radius ||
    Math.abs(position.x) > P.arena.goalHalf ||
    position.y > P.arena.goalHeight
  )
    return null;
  return {
    radius: Math.sqrt(P.ball.radius ** 2 - distance ** 2),
    z: goalPlane(sign),
  };
}
export function scoringTeam(position: {
  x: number;
  y: number;
  z: number;
}): number | null {
  const a = P.arena,
    r = P.ball.radius;
  if (
    Math.abs(position.z) > Math.abs(goalPlane(1)) + r &&
    Math.abs(position.x) < a.goalHalf - r &&
    position.y >= 0 &&
    position.y < a.goalHeight - r
  )
    return position.z < 0 ? 0 : 1;
  return null;
}
