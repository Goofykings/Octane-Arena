import * as T from "three";
import { P } from "../config/physics";
import { Pads } from "../game/pads";

// Original painted turf artwork. Coordinates are arena metres, never colliders.
export function createFieldArt() {
  const a = P.arena,
    length = a.halfLength + a.goalDepth;
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1536;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(canvas.width / (2 * a.halfWidth), canvas.height / (2 * length));
  ctx.translate(a.halfWidth, length);
  const polygon = (points: number[][], color: string, opacity: number) => {
    ctx.beginPath();
    points.forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)));
    ctx.closePath();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = Math.min(0.65, opacity + 0.12);
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.09;
    ctx.stroke();
  };
  for (const team of [-1, 1]) {
    const color = team > 0 ? "#579cc9" : "#cf965b";
    for (const side of [-1, 1]) {
      const panel = (points: number[][], alpha: number) =>
        polygon(
          points.map(([x, z]) => [side * x, team * z]),
          color,
          alpha,
        );
      // Broken perimeter ribbons turn inward; green pockets separate the lanes.
      panel(
        [
          [40.8, 10],
          [35.5, 10],
          [35.5, 24],
          [29, 33],
          [29, 42],
          [34, 48],
          [40.8, 48],
          [33, 40],
          [33, 34],
          [39, 25],
        ],
        0.42,
      );
      panel(
        [
          [34, 43],
          [24, 37],
          [15, 37],
          [12, 33],
          [12, 16],
          [9, 12],
          [9, 34],
          [13, 40],
          [23, 40],
          [32, 46],
        ],
        0.49,
      );
      // Three staggered cut-corner lanes, with a clear central approach corridor.
      for (const [z, end] of [
        [20, 25],
        [29, 29],
        [43, 26],
      ])
        panel(
          [
            [6, z],
            [end - 2, z],
            [end, z + 1.8],
            [8, z + 1.8],
          ],
          0.4,
        );
      panel(
        [
          [19, 12],
          [26, 12],
          [30, 18],
          [30, 24],
          [27, 24],
          [27, 19],
          [23, 15],
          [19, 15],
        ],
        0.27,
      );
    }
    polygon(
      [
        [-8, team * 46],
        [8, team * 46],
        [11, team * 50],
        [-11, team * 50],
      ],
      color,
      0.24,
    );
  }
  // Restrained panel/hex seams sit below the existing painted field markings.
  ctx.globalAlpha = 0.11;
  ctx.strokeStyle = "#c1d4c2";
  ctx.lineWidth = 0.055;
  for (let z = -47; z <= 47; z += 6)
    for (let x = -33; x <= 33; x += 7) {
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) {
        const t = (i * Math.PI) / 3;
        const px = x + Math.cos(t) * 3.35,
          pz = z + Math.sin(t) * 3.35;
        i ? ctx.lineTo(px, pz) : ctx.moveTo(px, pz);
      }
      ctx.stroke();
    }
  // Neutral kickoff circle, center cross and unpainted pad sockets preserve contrast.
  ctx.globalCompositeOperation = "destination-out";
  ctx.globalAlpha = 1;
  ctx.fillRect(-a.halfWidth, -5.5, a.halfWidth * 2, 11);
  ctx.fillRect(-3.3, -length, 6.6, length * 2);
  ctx.beginPath();
  ctx.arc(0, 0, 11, 0, Math.PI * 2);
  ctx.fill();
  for (const pad of new Pads().items) {
    ctx.beginPath();
    ctx.arc(pad.x, pad.z, pad.large ? 3 : 1.9, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new T.MeshStandardMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    roughness: 0.96,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const mesh = new T.Mesh(
    new T.PlaneGeometry(a.halfWidth * 2, length * 2),
    material,
  );
  mesh.name = "circuit-field-paint";
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.014;
  mesh.receiveShadow = true;
  return mesh;
}

/** Colors on the existing wall vertices; no displaced/new ramp geometry. */
export function rampPaint(vertices: ArrayLike<number>, base: number) {
  const colors = new Float32Array(vertices.length);
  const neutral = new T.Color(base),
    color = new T.Color();
  for (let i = 0; i < vertices.length; i += 3) {
    const y = vertices[i + 1],
      z = vertices[i + 2];
    const height = 1 - T.MathUtils.smoothstep(y, 0.15, 2.15);
    const territory = T.MathUtils.smoothstep(Math.abs(z), 6, 14);
    color
      .copy(neutral)
      .lerp(new T.Color(z > 0 ? 0x579cc9 : 0xcf965b), height * territory * 0.6);
    colors[i] = color.r;
    colors[i + 1] = color.g;
    colors[i + 2] = color.b;
  }
  return colors;
}
