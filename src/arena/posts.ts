import { goalTunnel } from "./goal";
/** Colored wall/entrance faces, never a separate solid beam. */
export function goalFrame(sign: number) {
  const mesh = goalTunnel(sign);
  return (["left", "right", "bar"] as const).map((kind) => ({
    kind,
    vertices: mesh.vertices,
    indices: mesh.frame![kind],
  }));
}
