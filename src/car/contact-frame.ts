import { Vector3 } from "three";
/** A midpoint ray distinguishes continuous curvature from two faces meeting at
 * an edge. Never invent a diagonal driving plane across a real discontinuity. */
export function refineContactNormal(
  normal: Vector3,
  normals: Vector3[],
  weights: number[],
  midpoint: Vector3 | null,
) {
  if (normals.every((n) => n.lengthSq() === 0 || n.dot(normal) > 0.98))
    return true;
  // Clearance weights favor the loaded axle. Geometry continuity uses the
  // unweighted symmetric footprint, otherwise that load bias looks like an edge.
  const geometric = new Vector3();
  for (const n of normals) geometric.add(n);
  geometric.normalize();
  // At a tangent curve entrance the midpoint is not necessarily its average
  // normal. A distinct intermediate face confirms continuous curvature. At a
  // sharp edge it matches one endpoint face, so that face must remain separate.
  if (midpoint) {
    const active = normals.filter((n) => n.lengthSq() > 0);
    const insideArc =
      midpoint.dot(geometric) >=
      Math.min(...active.map((n) => n.dot(geometric))) - 0.002;
    let first = active[0],
      last = active[0],
      widest = 1;
    for (const a of active)
      for (const b of active) {
        const dot = a.dot(b);
        if (dot < widest) {
          widest = dot;
          first = a;
          last = b;
        }
      }
    // A diagonal footprint may already sample the midpoint's triangle. Compare
    // to the two extreme faces, not every wheel, to recognize that smooth arc.
    const intermediate =
      first.dot(midpoint) < 0.99995 && last.dot(midpoint) < 0.99995;
    if (insideArc && intermediate) return true;
  }
  let seed = midpoint;
  if (!seed) {
    let best = -1;
    for (let i = 0; i < normals.length; i++)
      if (weights[i] > best && normals[i].lengthSq() > 0) {
        best = weights[i];
        seed = normals[i];
      }
  }
  if (!seed) return false;
  const face = seed.clone();
  normal.set(0, 0, 0);
  for (let i = 0; i < normals.length; i++)
    if (normals[i].dot(face) > 0.98)
      normal.addScaledVector(normals[i], weights[i]);
  if (normal.lengthSq() > 1e-8) normal.normalize();
  else normal.copy(face);
  return false;
}
