import * as T from "three";
import { P } from "../config/physics";
import type { ArenaMesh } from "../arena/geometry";
export const ARENA_MARKINGS = {
  hexRadius: 1.2,
  lineWidth: 0.022,
  opacity: 0.7,
  near: 18,
  far: 70,
  circleRadius: 9,
  circleWidth: 0.65,
};
/** Unfold the wall/upper fillet into the ceiling's X/Z coordinates. At the
 * fillet's ceiling edge the offset is exactly zero, keeping one continuous tile. */
export function hexSurfaceUv(shell: ArenaMesh) {
  const uv = new Float32Array((shell.vertices.length / 3) * 2),
    a = P.arena,
    n = shell.profileLength;
  for (let column = 0; column < shell.vertices.length / 3 / n; column++) {
    const outer = column * n + 20,
      roof = column * n + n - 1;
    const ox = shell.vertices[outer * 3],
      oz = shell.vertices[outer * 3 + 2];
    const nx = (ox - shell.vertices[roof * 3]) / a.ramp,
      nz = (oz - shell.vertices[roof * 3 + 2]) / a.ramp;
    for (let j = 0; j < n; j++) {
      const i = column * n + j,
        x = shell.vertices[i * 3],
        y = shell.vertices[i * 3 + 1],
        z = shell.vertices[i * 3 + 2];
      const theta = Math.asin(
        Math.max(0, Math.min(1, (y - a.height + a.ramp) / a.ramp)),
      );
      const inset = (ox - x) * nx + (oz - z) * nz;
      const unfolded =
        a.ramp * (Math.PI / 2 - theta) + Math.max(0, a.height - a.ramp - y);
      const offset = inset - a.ramp + unfolded;
      uv[i * 2] = (x + nx * offset) / (3 * ARENA_MARKINGS.hexRadius);
      uv[i * 2 + 1] =
        (z + nz * offset) / (Math.sqrt(3) * ARENA_MARKINGS.hexRadius);
    }
  }
  return uv;
}
export function addArenaHex(group: T.Group, shell: ArenaMesh) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(512 / 3, 512 / Math.sqrt(3));
  ctx.strokeStyle = "white";
  ctx.lineWidth = ARENA_MARKINGS.lineWidth / ARENA_MARKINGS.hexRadius;
  for (let col = -1; col <= 3; col++)
    for (let row = -2; row <= 2; row++) {
      const x = col * 1.5,
        y = row * Math.sqrt(3) + (col % 2 ? Math.sqrt(3) / 2 : 0);
      ctx.beginPath();
      for (let corner = 0; corner <= 6; corner++) {
        const angle = (corner * Math.PI) / 3;
        const px = x + Math.cos(angle),
          py = y + Math.sin(angle);
        if (corner === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  const texture = new T.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.anisotropy = 4;
  const mat = new T.MeshBasicMaterial({
    map: texture,
    color: 0xffffff,
    transparent: true,
    opacity: ARENA_MARKINGS.opacity,
    depthWrite: false,
    side: T.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    toneMapped: false,
  });
  mat.customProgramCacheKey = () => "arena-hex-distance-fade";
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying float hexViewDistance;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nhexViewDistance=length(cameraPosition-(modelMatrix*vec4(transformed,1.0)).xyz);",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying float hexViewDistance;",
      )
      .replace(
        "#include <map_fragment>",
        "#include <map_fragment>\ndiffuseColor.a*=mix(1.0,0.18,smoothstep(" +
          ARENA_MARKINGS.near.toFixed(1) +
          "," +
          ARENA_MARKINGS.far.toFixed(1) +
          ",hexViewDistance));",
      );
  };
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.BufferAttribute(shell.vertices, 3));
  geo.setAttribute("uv", new T.BufferAttribute(hexSurfaceUv(shell), 2));
  geo.setIndex(new T.BufferAttribute(shell.indices, 1));
  const wall = new T.Mesh(geo, mat);
  wall.name = "arena-wall-ceiling-hex";
  group.add(wall);
  const shape = new T.Shape();
  for (
    let col = 0;
    col < shell.vertices.length / 3 / shell.profileLength;
    col++
  ) {
    const i = (col + 1) * shell.profileLength - 1,
      x = shell.vertices[i * 3],
      z = shell.vertices[i * 3 + 2];
    if (col === 0) shape.moveTo(x, z);
    else shape.lineTo(x, z);
  }
  shape.closePath();
  const ceilingGeo = new T.ShapeGeometry(shape),
    pos = ceilingGeo.getAttribute("position"),
    ceilUv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    ceilUv[i * 2] = pos.getX(i) / (3 * ARENA_MARKINGS.hexRadius);
    ceilUv[i * 2 + 1] = pos.getY(i) / (Math.sqrt(3) * ARENA_MARKINGS.hexRadius);
  }
  ceilingGeo.setAttribute("uv", new T.BufferAttribute(ceilUv, 2));
  const ceiling = new T.Mesh(ceilingGeo, mat);
  ceiling.name = "arena-ceiling-hex";
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = P.arena.height;
  group.add(ceiling);
  return { wall, ceiling };
}
export function addTeamCircles(group: T.Group) {
  const materials = [
    new T.MeshBasicMaterial({
      color: 0x46c9fa,
      transparent: true,
      opacity: 0.86,
      depthWrite: false,
    }),
    new T.MeshBasicMaterial({
      color: 0xffa442,
      transparent: true,
      opacity: 0.86,
      depthWrite: false,
    }),
  ];
  const r = ARENA_MARKINGS.circleRadius,
    w = ARENA_MARKINGS.circleWidth;
  const add = (team: 0 | 1, z: number, start: number, name: string) => {
    const mesh = new T.Mesh(
      new T.RingGeometry(r - w / 2, r + w / 2, 96, 1, start, Math.PI),
      materials[team],
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, 0.019, z);
    mesh.renderOrder=-1; // Ball/boost indicators stay readable above the painted field.
    mesh.name = name;
    mesh.userData.team = team;
    group.add(mesh);
    return mesh;
  };
  // Plane +Y maps to world -Z: orange (-Z) above the midfield axis.
  add(1, 0, 0, "center-orange-half");
  add(0, 0, Math.PI, "center-blue-half");
  add(0, P.arena.halfLength, 0, "blue-goal-semicircle");
  add(1, -P.arena.halfLength, Math.PI, "orange-goal-semicircle");
  return materials;
}
