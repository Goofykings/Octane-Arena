import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";
import type { PathNode } from "./levels";
/** Closed thick ribbons with shared vertices; actual gaps have no triangles. */
export function ribbonGeometry(nodes: PathNode[], thickness = 0.65) {
  const vertices: number[] = [],
    indices: number[] = [];
  nodes.forEach((node) => {
    const right = new Vector3(
      Math.cos(node.heading),
      0,
      Math.sin(node.heading),
    );
    const left = node.center.clone().addScaledVector(right, -node.width / 2);
    const edge = node.center.clone().addScaledVector(right, node.width / 2);
    vertices.push(
      left.x,
      left.y,
      left.z,
      edge.x,
      edge.y,
      edge.z,
      left.x,
      left.y - thickness,
      left.z,
      edge.x,
      edge.y - thickness,
      edge.z,
    );
  });
  for (let i = 1; i < nodes.length; i++) {
    if (!nodes[i].connected) continue;
    const a = (i - 1) * 4,
      b = i * 4;
    indices.push(a, a + 1, b, a + 1, b + 1, b);
    indices.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3);
    indices.push(a, b, a + 2, a + 2, b, b + 2);
    indices.push(a + 1, a + 3, b + 1, a + 3, b + 3, b + 1);
    if (i === 1 || !nodes[i - 1].connected)
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    if (i === nodes.length - 1 || !nodes[i + 1].connected)
      indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
