import assert from "node:assert/strict";
import { Vector3, Quaternion, Matrix4, Group, PerspectiveCamera } from "three";
import { Simulation, initializeSimulation } from "../src/physics/simulation";
import { collisionShell, meshEdges } from "../src/arena/shell";
import { insideArena } from "../src/arena/physics";
import { P } from "../src/config/physics";
import { neutralInput } from "../shared/player";
import { bodies } from "../shared/catalog";
import { chassisPoints } from "../src/car/chassis";
import { Match } from "../src/game/match";
import { GameCamera } from "../src/camera/camera";
import { carModel, animateWheels, disposeModel } from "../src/render/models";

await initializeSimulation();
const a = P.arena,
  n = neutralInput();
let failures = 0;
function check(name: string, fn: () => unknown) {
  if (process.env.ARENA_CASE && !name.includes(process.env.ARENA_CASE)) return;
  try {
    console.log("PASS", name, JSON.stringify(fn()));
  } catch (e) {
    failures++;
    console.error("FAIL", name, String(e));
  }
}
const s = new Simulation(),
  c = s.cars[0];
s.cars[1].body.setEnabled(false);
function clear() {
  s.reset();
  c.body.setEnabled(true);
  s.ball.setGravityScale(1, true);
  s.cars[1].body.setEnabled(false);
  s.containmentRecoveries = 0;
}
function contained(label: string) {
  assert.equal(s.containmentRecoveries, 0, `${label}: backstop was needed`);
  for (const body of [c.body, s.ball])
    if (body.isEnabled())
      assert.ok(
        insideArena(s.arenaCollider!, body.translation(), 0.03),
        `${label}: escaped ${JSON.stringify(body.translation())}`,
      );
}
function pose(position: Vector3, up: Vector3, forward: Vector3) {
  c.reset(position.x, position.z, 0, position.y);
  c.body.setRotation(
    new Quaternion().setFromRotationMatrix(
      new Matrix4().makeBasis(
        forward.clone().cross(up),
        up,
        forward.clone().negate(),
      ),
    ),
    true,
  );
}
check(
  "closed shell: no gaps, duplicate faces, winding conflicts or non-manifold edges",
  () => {
    const mesh = collisionShell(),
      edges = meshEdges(mesh.indices),
      seen = new Set<string>();
    for (const e of edges.values()) {
      assert.equal(e.faces.length, 2);
      const directions = e.faces.map((f) => {
        const t = Array.from(mesh.indices.slice(f * 3, f * 3 + 3));
        return t[(t.indexOf(e.a) + 1) % 3] === e.b;
      });
      assert.notEqual(...(directions as [boolean, boolean]));
    }
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const key = Array.from(mesh.indices.slice(i, i + 3))
        .sort((a, b) => a - b)
        .join(",");
      assert.ok(!seen.has(key));
      seen.add(key);
    }
    return { triangles: mesh.indices.length / 3, edges: edges.size };
  },
);

type Surface = { name: string; p: Vector3; n: Vector3 };
const surfaces: Surface[] = [];
function curve(
  name: string,
  x: number,
  z: number,
  nx: number,
  nz: number,
  H: number,
  r: number,
) {
  for (const upper of [false, true]) {
    const t = Math.PI / 4,
      inset = r * (1 - (upper ? Math.cos(t) : Math.sin(t)));
    surfaces.push({
      name: `${name}/${upper ? "upper" : "lower"}`,
      p: new Vector3(
        x - nx * inset,
        upper ? H - r + r * Math.sin(t) : r * (1 - Math.cos(t)),
        z - nz * inset,
      ),
      n: new Vector3(
        -nx * Math.SQRT1_2,
        upper ? -Math.SQRT1_2 : Math.SQRT1_2,
        -nz * Math.SQRT1_2,
      ),
    });
  }
}
for (const sign of [-1, 1]) {
  curve(`side ${sign}`, sign * a.halfWidth, 0, sign, 0, a.height, a.ramp);
  curve(`end ${sign}`, 22, sign * a.halfLength, 0, sign, a.height, a.ramp);
  for (const side of [-1, 1]) {
    curve(
      `arena corner ${side}/${sign}`,
      side * (a.halfWidth - a.corner + a.corner * Math.SQRT1_2),
      sign * (a.halfLength - a.corner + a.corner * Math.SQRT1_2),
      side * Math.SQRT1_2,
      sign * Math.SQRT1_2,
      a.height,
      a.ramp,
    );
    curve(
      `goal side ${side}/${sign}`,
      side * a.goalHalf,
      sign * (a.halfLength + 4),
      side,
      0,
      a.goalHeight,
      a.goalCurve,
    );
    curve(
      `goal rear corner ${side}/${sign}`,
      side * (a.goalHalf - a.goalCurve + a.goalCurve * Math.SQRT1_2),
      sign *
        (a.halfLength + a.goalDepth - a.goalCurve + a.goalCurve * Math.SQRT1_2),
      side * Math.SQRT1_2,
      sign * Math.SQRT1_2,
      a.goalHeight,
      a.goalCurve,
    );
    // The shoulder loft's analytic derivatives provide an independent impact normal.
    const u = 0.5,
      t = Math.PI / 4,
      blend = u * u * (3 - 2 * u),
      db = 6 * u * (1 - u);
    const p = new Vector3(
      side * (a.goalHalf + a.goalLip * u),
      a.ramp * blend * (1 - Math.cos(t)),
      sign * (a.halfLength - a.ramp * (1 - Math.sin(t)) * blend),
    );
    const du = new Vector3(
        side * a.goalLip,
        a.ramp * db * (1 - Math.cos(t)),
        -sign * a.ramp * (1 - Math.sin(t)) * db,
      ),
      dt = new Vector3(
        0,
        a.ramp * blend * Math.sin(t),
        sign * a.ramp * Math.cos(t) * blend,
      );
    const normal = new Vector3().crossVectors(du, dt).normalize();
    if (normal.y < 0) normal.negate();
    surfaces.push({ name: `goal shoulder ${side}/${sign}`, p, n: normal });
  }
  curve(
    `goal rear ${sign}`,
    0,
    sign * (a.halfLength + a.goalDepth),
    0,
    sign,
    a.goalHeight,
    a.goalCurve,
  );
}
for (const orientation of ["roof", "side"] as const)
  check(
    `${orientation}-first impacts into all ${surfaces.length} main curves`,
    () => {
      let cases = 0,
        maxPenetration = 0;
      for (const body of ["ion", "vector"] as const)
        for (const surface of surfaces)
          for (const speed of [3, 23]) {
            clear();
            s.ball.setEnabled(false);
            c.setBody(body);
            const normal = surface.n,
              forward = new Vector3()
                .crossVectors(normal, new Vector3(0, 1, 0))
                .normalize();
            const up =
              orientation === "roof"
                ? normal.clone().negate()
                : forward.clone().cross(normal).normalize();
            pose(surface.p.clone().addScaledVector(normal, 1.7), up, forward);
            c.body.setLinvel(normal.clone().multiplyScalar(-speed), true);
            let maximum = 0;
            for (let i = 0; i < 100; i++) {
              s.step([n, n], true);
              contained(`${body} ${orientation} ${surface.name} ${speed}`);
              maximum = Math.max(
                maximum,
                new Vector3().copy(c.body.linvel()).length(),
              );
              // All corners of the physical roof/sides must remain in the actual shell.
              const q = new Quaternion().copy(c.body.rotation()),
                p = new Vector3().copy(c.body.translation());
              for (const vertex of chassisPoints(body)) {
                const point = vertex.applyQuaternion(q).add(p);
                if (!insideArena(s.arenaCollider!, point, 0))
                  maxPenetration = Math.max(
                    maxPenetration,
                    point.distanceTo(
                      s.arenaCollider!.projectPoint(point, false)!.point,
                    ),
                  );
                assert.ok(
                  insideArena(s.arenaCollider!, point, 0.001),
                  `${surface.name} ${body}/${speed} frame=${i} point=${JSON.stringify(point)} center=${JSON.stringify(p)} distance=${point.distanceTo(s.arenaCollider!.projectPoint(point, false)!.point)}`,
                );
              }
            }
            assert.ok(
              maximum <=
                Math.min(P.car.maxSpeed, speed + P.gravity * 100 * P.dt) + 0.1,
              `${surface.name} artificial launch`,
            );
            cases++;
          }
      return { cases, maxPenetration };
    },
  );
check("slow/fast ball rolls and impacts at all arena and goal curves", () => {
  let cases = 0;
  for (const surface of surfaces)
    for (const speed of [1, 15, 60]) {
      clear();
      c.body.setEnabled(false);
      s.ball.setTranslation(
        surface.p.clone().addScaledVector(surface.n, P.ball.radius + 0.4),
        true,
      );
      const tangent = new Vector3()
        .crossVectors(surface.n, new Vector3(0, 1, 0))
        .normalize();
      s.ball.setLinvel(
        surface.n
          .clone()
          .multiplyScalar(-speed * 0.8)
          .addScaledVector(tangent, speed * 0.6),
        true,
      );
      s.ball.setAngvel(tangent.clone().multiplyScalar(2), true);
      for (let i = 0; i < 150; i++) {
        s.step([n, n], true);
        contained(`${surface.name} ball ${speed}`);
      }
      cases++;
    }
  return { cases };
});

check(
  "slow/fast floor rolls through all four arena corners and all four rear goal corners",
  () => {
    let cases = 0;
    for (const goal of [false, true])
      for (const side of [-1, 1])
        for (const sign of [-1, 1])
          for (const speed of [2, 60]) {
            clear();
            c.body.setEnabled(false);
            const x =
              side *
              (goal ? a.goalHalf - a.goalCurve - 1 : a.halfWidth - a.ramp - 1);
            const z =
              sign * (goal ? a.halfLength + 1.5 : a.halfLength - a.corner - 3);
            s.ball.setTranslation({ x, y: P.ball.radius + 0.015, z }, true);
            s.ball.setLinvel({ x: 0, y: 0, z: sign * speed }, true);
            s.ball.setAngvel(
              {
                x: sign * Math.min(P.ball.maxAngular, speed / P.ball.radius),
                y: 0,
                z: 0,
              },
              true,
            );
            let traveled = 0;
            for (let i = 0; i < 900; i++) {
              s.step([n, n], true);
              contained(`floor roll ${goal}/${side}/${sign}/${speed}`);
              traveled = Math.max(
                traveled,
                (s.ball.translation().z - z) * sign,
              );
            }
            assert.ok(
              traveled > 2,
              `ball never reached corner ${goal}/${speed}/${traveled}`,
            );
            cases++;
          }
    return { cases };
  },
);

check("ball impacts at floor/wall, wall/ceiling and mouth patch seams", () => {
  let cases = 0;
  const probes: { p: Vector3; n: Vector3 }[] = [];
  for (const sign of [-1, 1]) {
    for (const height of [a.ramp, a.height - a.ramp])
      probes.push({
        p: new Vector3(sign * a.halfWidth, height, 0),
        n: new Vector3(-sign, 0, 0),
      });
    for (const height of [0, a.height])
      probes.push({
        p: new Vector3(sign * (a.halfWidth - a.ramp), height, 0),
        n: new Vector3(0, height === 0 ? 1 : -1, 0),
      });
    for (const side of [-1, 1]) {
      for (const x of [a.goalHalf, a.goalHalf + a.goalLip])
        probes.push({
          p: new Vector3(side * x, a.ramp, sign * a.halfLength),
          n: new Vector3(0, 0, -sign),
        });
      for (const z of [
        a.halfLength,
        a.halfLength + a.goalLip,
        a.halfLength + a.goalDepth - a.goalCurve,
      ])
        probes.push({
          p: new Vector3(
            side * (a.goalHalf - a.goalCurve),
            a.goalHeight,
            sign * z,
          ),
          n: new Vector3(0, -1, 0),
        });
    }
  }
  for (const probe of probes)
    for (const speed of [2, 60]) {
      clear();
      c.body.setEnabled(false);
      s.ball.setGravityScale(0, true);
      s.ball.setTranslation(
        probe.p.clone().addScaledVector(probe.n, P.ball.radius + 0.2),
        true,
      );
      s.ball.setLinvel(probe.n.clone().multiplyScalar(-speed), true);
      for (let i = 0; i < 100; i++) {
        s.step([n, n], true);
        contained(`seam ${JSON.stringify(probe.p)}/${speed}`);
      }
      cases++;
    }
  return { cases };
});

check(
  "former post divots: tapered shoulder impacts and goal entry/exit",
  () => {
    let impacts = 0,
      crossings = 0;
    for (const sign of [-1, 1])
      for (const side of [-1, 1]) {
        for (const u of [0.08, 0.25, 0.75]) {
          const t = Math.PI / 4,
            blend = u * u * (3 - 2 * u),
            db = 6 * u * (1 - u);
          const p = new Vector3(
            side * (a.goalHalf + a.goalLip * u),
            a.ramp * blend * (1 - Math.cos(t)),
            sign * (a.halfLength - a.ramp * blend * (1 - Math.sin(t))),
          );
          const normal = new Vector3()
            .crossVectors(
              new Vector3(
                side * a.goalLip,
                a.ramp * db * (1 - Math.cos(t)),
                -sign * a.ramp * db * (1 - Math.sin(t)),
              ),
              new Vector3(
                0,
                a.ramp * blend * Math.sin(t),
                sign * a.ramp * blend * Math.cos(t),
              ),
            )
            .normalize();
          if (normal.y < 0) normal.negate();
          for (const speed of [2, 60]) {
            clear();
            c.body.setEnabled(false);
            s.ball.setGravityScale(0, true);
            s.ball.setTranslation(
              p.clone().addScaledVector(normal, P.ball.radius + 0.2),
              true,
            );
            s.ball.setLinvel(normal.clone().multiplyScalar(-speed), true);
            s.ball.setAngvel({ x: 1, y: 2, z: 3 }, true);
            for (let i = 0; i < 100; i++) {
              s.step([n, n], true);
              contained(`former divot ${side}/${sign}/${u}/${speed}`);
              assert.ok(
                new Vector3().copy(s.ball.linvel()).length() <= speed + 0.5,
                "shoulder injects bounce energy",
              );
            }
            impacts++;
          }
        }
        for (const direction of [-1, 1]) {
          clear();
          s.ball.setEnabled(false);
          const startZ = sign * (a.halfLength - direction * 3);
          const forward = new Vector3(0, 0, sign * direction);
          pose(
            new Vector3(
              side * (a.goalHalf - a.goalCurve - 1.2),
              P.car.contactHeight,
              startZ,
            ),
            new Vector3(0, 1, 0),
            forward,
          );
          c.body.setLinvel(forward.clone().multiplyScalar(10), true);
          for (let i = 0; i < 85; i++) {
            s.step([{ ...n, throttle: 1 }, n]);
            contained(`goal crossing ${side}/${sign}/${direction}`);
            assert.ok(c.up.y > 0.98, "goal threshold tips chassis");
          }
          assert.ok(
            (c.body.translation().z * sign - a.halfLength) * direction > 1,
            "did not cross goal mouth",
          );
          crossings++;
        }
      }
    return { impacts, crossings };
  },
);
check(
  "volumetric posts/crossbars: centered, glancing, inside/outside, ground and joints",
  () => {
    let cases = 0;
    for (const sign of [-1, 1])
      for (const kind of ["bar", "post", "ground", "joint"])
        for (const side of kind === "bar" ? [0] : [-1, 1])
          for (const offset of [-0.6, 0, 0.6])
            for (const speed of [8, 60]) {
              clear();
              c.body.setEnabled(false);
              s.ball.setGravityScale(0, true);
              const y =
                kind === "bar" || kind === "joint"
                  ? a.goalHeight + a.postRadius
                  : kind === "ground"
                    ? P.ball.radius + 0.02
                    : 3;
              const x = side * (a.goalHalf + a.postRadius);
              s.ball.setTranslation(
                {
                  x: x + (kind === "bar" ? 0 : offset),
                  y: y + (kind === "bar" ? offset : 0),
                  z: sign * (a.halfLength - 3),
                },
                true,
              );
              s.ball.setLinvel({ x: 0, y: 0, z: sign * speed }, true);
              s.ball.setAngvel({ x: 1, y: 1, z: 1 }, true);
              let bounced = false,
                transverse = 0;
              for (let i = 0; i < 110; i++) {
                s.step([n, n], true);
                contained(`frame ${sign}/${kind}/${offset}/${speed}`);
                const v = s.ball.linvel();
                if (v.z * sign < 0) {
                  if (
                    !bounced &&
                    offset === 0 &&
                    (kind === "bar" || kind === "post")
                  ) {
                    assert.ok(
                      Math.abs(v.z) > speed * 0.3 &&
                        Math.abs(v.z) < speed * 0.6,
                      "centered restitution changed",
                    );
                    assert.ok(
                      Math.abs(v.z) > Math.hypot(v.x, v.y),
                      "centered impact should rebound mostly backward",
                    );
                    assert.ok(
                      new Vector3().copy(s.ball.angvel()).length() > 0.01,
                      "spin was erased",
                    );
                  }
                  bounced = true;
                  transverse = Math.max(
                    transverse,
                    Math.abs(kind === "bar" ? v.y : v.x),
                  );
                }
              }
              assert.ok(bounced, `no bounce ${kind}/${offset}/${speed}`);
              if (
                offset !== 0 &&
                (kind === "post" || (kind === "bar" && offset < 0))
              )
                assert.ok(
                  transverse > 0.5,
                  `flat bounce ${kind}/${offset}/${speed}`,
                );
              if (kind === "bar" && offset > 0)
                assert.ok(
                  transverse < speed * 0.15,
                  "upper front frame should not launch upward",
                );
              cases++;
            }
    return { cases };
  },
);

check(
  "repeated low/high-speed floor-wall runs, boost, contact normal and camera stability",
  () => {
    let oneWheel = 0,
      maxNormalStep = 0,
      maxCameraAngle = 0;
    for (const side of [-1, 1])
      for (const speed of [5, 23])
        for (let repeat = 0; repeat < 3; repeat++) {
          clear();
          s.ball.setEnabled(false);
          c.setBody("ion");
          c.reset(side * 35, 0, (-side * Math.PI) / 2);
          c.body.setLinvel({ x: side * speed, y: 0, z: 0 }, true);
          const camera = new PerspectiveCamera(76, 16 / 9, 0.05, 340),
            cam = new GameCamera(camera),
            car = new Group(),
            ball = new Group();
          ball.position.set(0, 1, 0);
          let wall = 0,
            upper = false,
            detached = false,
            previous = c.normal.clone();
          for (let i = 0; i < 450; i++) {
            c.boost = 100;
            s.step([{ ...n, throttle: 1, boost: speed === 23 }, n]);
            contained("wall run");
            const p = c.body.translation();
            if (c.contacts === 1) oneWheel++;
            if (c.contacts >= 2 && i > 3)
              maxNormalStep = Math.max(
                maxNormalStep,
                previous.angleTo(c.normal),
              );
            previous.copy(c.normal);
            if (p.y > 4 && p.y < 14 && Math.abs(p.x) > a.halfWidth - 1) {
              wall++;
              assert.ok(c.contacts >= 2, "lost wall contact");
            }
            if (p.y > a.height - 1) upper = true;
            if (upper && !c.grounded && p.y < a.height - 1) detached = true;
            c.pose.render(car, 1);
            const q = camera.quaternion.clone();
            cam.update(car, ball, s, P.dt, false, i * P.dt);
            if (i > 10)
              maxCameraAngle = Math.max(
                maxCameraAngle,
                q.angleTo(camera.quaternion),
              );
            if (detached) break;
          }
          assert.ok(wall > 10, `no meaningful wall driving ${speed}`);
          if (speed === 23)
            assert.ok(upper && detached, "upper transition must release");
        }
    assert.ok(oneWheel < 6, `one-wheel jitter ${oneWheel}`);
    assert.ok(maxNormalStep < 0.2, `normal jitter ${maxNormalStep}`);
    assert.ok(maxCameraAngle < 0.12, `camera rotation jump ${maxCameraAngle}`);
    return { oneWheel, maxNormalStep, maxCameraAngle };
  },
);
check(
  "stationary wall slides down; ceiling releases even with throttle",
  () => {
    for (const along of [new Vector3(0, 1, 0), new Vector3(0, 0, -1)]) {
      clear();
      s.ball.setEnabled(false);
      pose(
        new Vector3(a.halfWidth - 0.31, 10, 0),
        new Vector3(-1, 0, 0),
        along,
      );
      for (let i = 0; i < 120; i++) s.step([n, n]);
      assert.ok(
        c.body.translation().y < 8.5 && c.body.linvel().y < -2,
        "wall remains glued",
      );
      contained("idle wall");
    }
    clear();
    s.ball.setEnabled(false);
    pose(
      new Vector3(0, a.height - 0.31, 0),
      new Vector3(0, -1, 0),
      new Vector3(0, 0, -1),
    );
    for (let i = 0; i < 120; i++) s.step([{ ...n, throttle: 1 }, n]);
    assert.ok(!c.grounded && c.body.translation().y < a.height - 2);
    contained("ceiling release");
  },
);
check("diagonal corner driving and goal-curve camera/contact stability", () => {
  let cases = 0,
    longestOneWheel = 0,
    maxCameraTurn = 0,
    worst: unknown;
  for (const goal of [false, true])
    for (const side of [-1, 1])
      for (const sign of [-1, 1])
        for (const speed of [5, 23]) {
          clear();
          s.ball.setEnabled(false);
          c.setBody("vector");
          if (goal)
            c.reset(
              side * (a.goalHalf - 4),
              sign * (a.halfLength + 4),
              (-side * Math.PI) / 2,
            );
          else
            c.reset(
              side * (a.halfWidth - a.corner),
              sign * (a.halfLength - a.corner),
              Math.atan2(-side, -sign),
            );
          const forward = goal
            ? new Vector3(side, 0, 0)
            : new Vector3(side, 0, sign).normalize();
          c.body.setLinvel(forward.multiplyScalar(speed), true);
          const camera = new PerspectiveCamera(76, 16 / 9, 0.05, 340),
            control = new GameCamera(camera),
            model = new Group(),
            ball = new Group();
          ball.position.set(0, 1, 0);
          let run = 0,
            curved = 0,
            reachedUpper = false;
          for (let i = 0; i < 300; i++) {
            c.boost = 100;
            s.step([{ ...n, throttle: 1, boost: speed === 23 }, n]);
            contained(`curve drive ${goal}/${side}/${sign}/${speed}`);
            run = c.contacts === 1 ? run + 1 : 0;
            if (run > longestOneWheel) {
              longestOneWheel = run;
              worst = {
                goal,
                side,
                sign,
                speed,
                i,
                p: c.body.translation(),
                normal: c.normal.toArray(),
                up: c.up.toArray(),
                velocity: c.body.linvel(),
              };
            }
            if (c.contacts >= 2 && c.normal.y < 0.9) curved++;
            c.pose.render(model, 1);
            const before = camera.quaternion.clone();
            control.update(model, ball, s, P.dt, false, i * P.dt);
            if (i > 10)
              maxCameraTurn = Math.max(
                maxCameraTurn,
                before.angleTo(camera.quaternion),
              );
            const ceiling = goal ? a.goalHeight : a.height;
            if (c.body.translation().y > ceiling - 1) reachedUpper = true;
            // Measure driving through the curve, not a later tilted aerial landing.
            // Landing/recovery have their own orientation-specific cases below.
            if (
              reachedUpper &&
              !c.grounded &&
              c.body.translation().y < ceiling - 1
            )
              break;
          }
          assert.ok(curved > 5, "did not reach the curved surface");
          cases++;
        }
  assert.ok(
    longestOneWheel < 12,
    `sustained one-wheel balance ${longestOneWheel} ticks ${JSON.stringify(worst)} camera=${maxCameraTurn}`,
  );
  assert.ok(maxCameraTurn < 0.12, `goal/corner camera jump ${maxCameraTurn}`);
  return { cases, longestOneWheel, maxCameraTurn };
});

check("upside-down goal slope can recover using normal controls", () => {
  for (const sign of [-1, 1]) {
    clear();
    s.ball.setEnabled(false);
    const target = surfaces.find((v) => v.name === `goal rear ${sign}/lower`)!;
    pose(
      target.p.clone().addScaledVector(target.n, 0.3),
      target.n.clone().negate(),
      new Vector3(1, 0, 0),
    );
    // Begin on the roof, not with an aerial dodge before the first collision.
    for (let i = 0; i < 60; i++) {
      s.step([n, n]);
      contained("settling inverted goal car");
    }
    let recovered = false;
    for (let i = 0; i < 480; i++) {
      s.step([
        { ...n, throttle: 1, jump: i % 100 < 30, boost: i > 80 && i < 130 },
        n,
      ]);
      contained("goal recovery");
      if (c.up.y > 0.8) recovered = true;
    }
    assert.ok(recovered, "trapped inverted");
  }
});
check(
  "kickoff steers visible front wheels only, then GO resumes physics",
  () => {
    clear();
    const m = new Match();
    m.start(s, "bot");
    const p = { ...c.body.translation() },
      q = { ...c.body.rotation() },
      boost = c.boost;
    const model = carModel(0xffffff, c.bodyId),
      input = { ...n, steer: 1, throttle: 1, boost: true, jump: true };
    for (let i = 0; i < 350; i++) {
      c.steerAtKickoff(input);
      animateWheels(model, 0, c.steerAngle, P.dt, c, model);
      m.tick(s);
    }
    animateWheels(model, 0, c.steerAngle, P.dt, c, model);
    assert.equal(m.phase, "countdown");
    assert.deepEqual({ ...c.body.translation() }, p);
    assert.deepEqual({ ...c.body.rotation() }, q);
    assert.equal(c.boost, boost);
    assert.ok(Math.abs(model.userData.frontWheels[0].rotation.y) > 0.2);
    c.steerAtKickoff({ ...input, steer: -1 });
    assert.ok(c.steerAngle > 0);
    while (m.phase === "countdown") m.tick(s);
    for (let i = 0; i < 12; i++) s.step([input, n]);
    assert.notDeepEqual({ ...c.body.translation() }, p);
    assert.ok(c.boost < boost);
    disposeModel(model);
  },
);
check("containment backstop recovers deliberate numerical escapes", () => {
  clear();
  c.body.setTranslation({ x: 100, y: 50, z: 100 }, true);
  s.ball.setTranslation({ x: 100, y: 50, z: 100 }, true);
  s.step([n, n], true);
  assert.equal(s.containmentRecoveries, 2);
  assert.ok(insideArena(s.arenaCollider!, c.body.translation()));
  assert.ok(insideArena(s.arenaCollider!, s.ball.translation()));
});
s.dispose();
if (failures) process.exitCode = 1;
