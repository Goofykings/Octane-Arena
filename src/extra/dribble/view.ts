import * as T from "three";
import { ribbonGeometry } from "./geometry";
import type { DribbleCourse } from "./levels";
export class DribbleView {
  readonly group = new T.Group();
  readonly spinners: { mesh: T.Group; obstacleIndex: number }[] = [];
  constructor(readonly course: DribbleCourse) {
    this.group.name = "dribble-course";
    course.obstacles.forEach((obstacle, obstacleIndex) => {
      const { piece, center, heading, width } = obstacle;
      const group = new T.Group();
      group.name = `dribble-${piece.kind}-${obstacleIndex}`;
      group.position.copy(center);
      group.rotation.y = -heading;
      const material = new T.MeshStandardMaterial({
        color: 0xe9aa51,
        roughness: 0.45,
        metalness: 0.25,
      });
      const add = (x: number, y: number, z: number) => {
        const mesh = new T.Mesh(new T.BoxGeometry(x, y, z), material);
        mesh.castShadow = mesh.receiveShadow = true;
        group.add(mesh);
      };
      if (piece.kind === "wall") {
        group.position.y += piece.height / 2;
        add(width, piece.height, piece.depth);
      } else {
        group.position.y += piece.radius;
        add(piece.radius * 2, piece.armWidth, piece.depth);
        add(piece.armWidth, piece.radius * 2, piece.depth);
        this.spinners.push({ mesh: group, obstacleIndex });
      }
      this.group.add(group);
    });
    const size = 64,
      pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const line = x % 16 === 0 || y % 16 === 0;
        const color = new T.Color(
          line ? 0x2d6479 : (x + y) % 3 === 0 ? 0x194356 : 0x173b4e,
        );
        pixels.set(
          [color.r * 255, color.g * 255, color.b * 255, 255],
          (y * size + x) * 4,
        );
      }
    const texture = new T.DataTexture(pixels, size, size);
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.needsUpdate = true;
    const geometry = ribbonGeometry(course.nodes);
    const position = geometry.attributes.position,
      uv: number[] = [];
    for (let i = 0; i < position.count; i++)
      uv.push(position.getX(i) / 5, position.getZ(i) / 5);
    geometry.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    const road = new T.Mesh(
      geometry,
      new T.MeshStandardMaterial({
        color: 0xffffff,
        map: texture,
        roughness: 0.8,
        metalness: 0.12,
      }),
    );
    road.receiveShadow = true;
    this.group.add(road);
    // Gray overlay shares the car-solid ribbon surface; only ball support is
    // added in physics, so the car never meets overlapping floor colliders.
    const safe = new T.Mesh(
      new T.PlaneGeometry(course.start.width, course.start.length),
      new T.MeshStandardMaterial({ color: 0x999ea4, roughness: 0.85 }),
    );
    safe.name = "dribble-safe-start";
    safe.rotation.x = -Math.PI / 2;
    safe.position.copy(course.start.center).add(new T.Vector3(0, 0.008, 0));
    safe.receiveShadow = true;
    this.group.add(safe);
    const edgeMaterial = new T.LineBasicMaterial({ color: 0x72cfe0 });
    for (const side of [-1, 1]) {
      let points: T.Vector3[] = [];
      const flush = () => {
        if (points.length > 1)
          this.group.add(
            new T.Line(
              new T.BufferGeometry().setFromPoints(points),
              edgeMaterial,
            ),
          );
        points = [];
      };
      course.nodes.forEach((node, i) => {
        if (i && !node.connected) flush();
        points.push(
          node.center
            .clone()
            .add(
              new T.Vector3(
                Math.cos(node.heading),
                0,
                Math.sin(node.heading),
              ).multiplyScalar((side * node.width) / 2),
            )
            .add(new T.Vector3(0, 0.025, 0)),
        );
      });
      flush();
    }
    const chevron = new T.BufferGeometry().setFromPoints([
      new T.Vector3(-0.5, 0, 0.4),
      new T.Vector3(0, 0, -0.4),
      new T.Vector3(0.5, 0, 0.4),
    ]);
    const arrowMat = new T.LineBasicMaterial({ color: 0x66a4b9 });
    course.nodes.forEach((node, i) => {
      if (i % 10 || !node.connected) return;
      const arrow = new T.Line(chevron, arrowMat);
      arrow.position.copy(node.center).add(new T.Vector3(0, 0.03, 0));
      arrow.rotation.y = -node.heading;
      this.group.add(arrow);
    });
    const warning = new T.MeshBasicMaterial({ color: 0xf0b566 });
    course.nodes.forEach((node, i) => {
      if (!i || node.connected || !course.nodes[i - 1].connected) return;
      const edge = course.nodes[i - 1];
      const strip = new T.Mesh(
        new T.BoxGeometry(edge.width - 0.1, 0.025, 0.16),
        warning,
      );
      strip.position.copy(edge.center).add(new T.Vector3(0, 0.018, 0));
      strip.rotation.y = -edge.heading;
      this.group.add(strip);
    });
    const f = course.finish;
    const goal = new T.Group();
    goal.name = "dribble-finish-wall";
    goal.position.copy(f.center);
    goal.rotation.y = -f.heading;
    const gridSize = 64,
      gridPixels = new Uint8Array(gridSize * gridSize * 4);
    for (let y = 0; y < gridSize; y++)
      for (let x = 0; x < gridSize; x++) {
        const line = x % 16 < 1 || y % 16 < 1;
        gridPixels.set(
          [216, 235, 240, line ? 115 : 18],
          (y * gridSize + x) * 4,
        );
      }
    const grid = new T.DataTexture(gridPixels, gridSize, gridSize);
    grid.wrapS = grid.wrapT = T.RepeatWrapping;
    grid.magFilter = T.LinearFilter;
    grid.minFilter = T.LinearMipmapLinearFilter;
    grid.generateMipmaps = true;
    grid.repeat.set(f.width / 2, f.height / 2);
    grid.needsUpdate = true;
    const wall = new T.Mesh(
      new T.PlaneGeometry(f.width, f.height),
      new T.MeshBasicMaterial({
        map: grid,
        transparent: true,
        side: T.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    wall.position.y = f.height / 2;
    goal.add(wall);
    const trim = new T.MeshBasicMaterial({
      color: 0xc4e5e7,
      transparent: true,
      opacity: 0.7,
    });
    for (const side of [-1, 1]) {
      const post = new T.Mesh(new T.BoxGeometry(0.08, f.height, 0.08), trim);
      post.position.set((side * f.width) / 2, f.height / 2, 0);
      goal.add(post);
    }
    const bar = new T.Mesh(new T.BoxGeometry(f.width, 0.08, 0.08), trim);
    bar.position.y = f.height;
    goal.add(bar);
    this.group.add(goal);
    // Labels are original canvas text, using the game's bundled font.
    if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 180;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#16394c";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.textAlign = "center";
      ctx.font = "bold 54px Rajdhani, sans-serif";
      ctx.fillStyle = "#f3c77c";
      ctx.fillText(`LEVEL ${course.definition.id}`, 320, 72);
      ctx.font = "bold 34px Rajdhani, sans-serif";
      ctx.fillStyle = "#d1eaf2";
      ctx.fillText("BALL-SAFE PICKUP", 320, 132);
      const label = new T.Sprite(
        new T.SpriteMaterial({
          map: new T.CanvasTexture(canvas),
          depthWrite: false,
          toneMapped: false,
        }),
      );
      label.position.set(3.2, 4.8, course.start.center.z);
      label.scale.set(3.2, 0.9, 1);
      this.group.add(label);
    }
  }
  dispose() {
    disposeDribbleResources(this.group);
    this.group.removeFromParent();
    this.group.clear();
  }
}
export function disposeDribbleResources(root: T.Object3D) {
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>(),
    textures = new Set<T.Texture>();
  root.traverse((object) => {
    if (object instanceof T.DirectionalLight) object.shadow.dispose();
    if (
      !(
        object instanceof T.Mesh ||
        object instanceof T.Line ||
        object instanceof T.Sprite
      )
    )
      return;
    if (!(object instanceof T.Sprite)) geometries.add(object.geometry);
    for (const mat of Array.isArray(object.material)
      ? object.material
      : [object.material]) {
      materials.add(mat);
      for (const value of Object.values(mat))
        if (value instanceof T.Texture) textures.add(value);
    }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  textures.forEach((t) => t.dispose());
}
