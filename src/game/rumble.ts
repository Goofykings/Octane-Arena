import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3, Quaternion } from "three";
import type { Simulation } from "../physics/simulation";
import type { PlayerInput } from "../../shared/player";
import type { Car } from "../car/car";
import { P } from "../config/physics";
import { RUMBLE_CONFIG as R } from "../config/rumble";
import {
  rumbleItems,
  type RumbleItem,
  type RumblePlayerState,
  type RumbleSnapshot,
  type RumbleEvent,
} from "../../shared/rumble";

/** Match-owned power state/forces. Renderers and network clients never instantiate
 * this to roll items or execute effects. Spikes use a real fixed dynamic joint. */
export class Rumble {
  readonly players = new Map<string, RumblePlayerState>();
  readonly events: RumbleEvent[] = [];
  readonly state: RumbleSnapshot = { players: [], events: this.events };
  running = false;
  allowGrants = true;
  private sequence = 0;
  private held = new Map<string, boolean>();
  private suspended = new Set<string>();
  private botTimes = new Map<string, number>();
  private joint: RAPIER.ImpulseJoint | null = null;
  private carrier: string | null = null;
  private direction = new Vector3();
  private impulse = new Vector3();
  private releaseVelocity = new Vector3();
  private arm = new Vector3();
  private rotation = new Quaternion();
  private inverse = new Quaternion();
  constructor(
    private sim: Simulation,
    private random = () => Math.random(),
  ) {
    this.reset();
  }
  reset() {
    if (this.carrier) this.detach();
    this.players.clear();
    this.held.clear();
    this.events.length = 0;
    this.botTimes.clear();
    for (const car of this.sim.cars)
      this.players.set(car.id, {
        playerId: car.id,
        phase: "cooldown",
        item: null,
        cooldown: R.cooldown,
        remaining: 0,
      });
    this.state.players.length = 0;
    for (const st of this.players.values()) this.state.players.push(st);
  }
  setPhase(running: boolean, allowGrants: boolean) {
    this.running = running;
    this.allowGrants = allowGrants;
  }
  private emit(car: Car, kind: RumbleEvent["kind"], item: RumbleItem) {
    this.events.push({
      id: ++this.sequence,
      time: this.sim.clock,
      playerId: car.id,
      kind,
      item,
      point: { ...this.sim.ball.translation() },
    });
    if (this.events.length > R.history.eventCapacity) this.events.shift();
  }
  grant(id: string, item?: RumbleItem) {
    const st = this.players.get(id);
    if (!st || st.phase !== "cooldown") return false;
    let pick = item;
    if (!pick) {
      const total = rumbleItems.reduce((sum, k) => sum + R.weights[k], 0);
      let roll = this.random() * total;
      pick = rumbleItems.at(-1)!;
      for (const k of rumbleItems) {
        roll -= R.weights[k];
        if (roll < 0) {
          pick = k;
          break;
        }
      }
    }
    st.phase = "ready";
    st.item = pick;
    st.cooldown = 0;
    return true;
  }
  inRange(id: string, item: RumbleItem) {
    const car = this.sim.cars.find((c) => c.id === id);
    if (!car?.body.isEnabled() || !this.sim.ball.isEnabled()) return false;
    const range =
      item === "HAYMAKER"
        ? R.haymaker.range
        : item === "GRAPPLING_HOOK"
          ? R.grapple.range
          : item === "PLUNGER"
            ? R.plunger.range
            : Infinity;
    return (
      this.direction
        .copy(this.sim.ball.translation())
        .sub(car.body.translation())
        .length() <= range
    );
  }
  use(id: string) {
    const st = this.players.get(id),
      car = this.sim.cars.find((c) => c.id === id);
    if (
      !this.running ||
      !st ||
      st.phase !== "ready" ||
      !st.item ||
      !car?.body.isEnabled() ||
      !this.inRange(id, st.item)
    )
      return false;
    const item = st.item;
    this.emit(car, "POWERUP_USED", item);
    if (item === "HAYMAKER") {
      this.direction
        .copy(this.sim.ball.translation())
        .sub(car.body.translation());
      if (this.direction.lengthSq() < R.numerical.epsilon)
        this.direction.copy(car.forward);
      this.impulse
        .copy(this.direction)
        .normalize()
        .multiplyScalar(R.haymaker.impulse);
      this.sim.powerTouch(
        id,
        () => this.ballImpulse(this.impulse),
        R.haymaker.impulse / P.ball.mass,
      );
      this.end(id);
      return true;
    }
    st.phase = "active";
    st.remaining =
      item === "GRAPPLING_HOOK"
        ? R.grapple.duration
        : item === "PLUNGER"
          ? R.plunger.duration
          : item === "SPIKES"
            ? R.spikes.duration
            : R.powerHitter.duration;
    if (item === "PLUNGER") this.sim.powerTouch(id, () => {}, 0);
    this.emit(car, "POWERUP_STARTED", item);
    return true;
  }
  end(id: string) {
    const st = this.players.get(id);
    if (!st) return;
    const item = st.item;
    if (this.carrier === id) this.detach();
    const car = this.sim.cars.find((c) => c.id === id);
    if (item && car) this.emit(car, "POWERUP_ENDED", item);
    st.item = null;
    st.phase = "cooldown";
    st.cooldown = R.cooldown;
    st.remaining = 0;
    delete st.attachment;
  }
  suspend(id: string, value = true) {
    if (value) {
      this.end(id);
      this.suspended.add(id);
    } else this.suspended.delete(id);
  }
  private botUse(car: Car, st: RumblePlayerState) {
    if (
      st.phase !== "ready" ||
      !st.item ||
      this.sim.clock - (this.botTimes.get(car.id) ?? -Infinity) < R.bot.interval
    )
      return;
    this.botTimes.set(car.id, this.sim.clock);
    this.direction
      .copy(this.sim.ball.translation())
      .sub(car.body.translation());
    const distance = this.direction.length(),
      attack = car.team === 0 ? -1 : 1;
    const goal = this.arm
      .set(0, 2, attack * P.arena.halfLength)
      .sub(this.sim.ball.translation());
    const useful =
      this.direction.dot(goal) > R.bot.alignment * distance * goal.length();
    if (
      (st.item === "HAYMAKER" && useful) ||
      (st.item === "GRAPPLING_HOOK" &&
        distance > R.bot.minGrappleDistance &&
        useful) ||
      (st.item === "POWER_HITTER" && distance < R.bot.challengeRange) ||
      (st.item === "PLUNGER" &&
        (-this.direction.z * attack > 0 ||
          this.sim.ball.translation().z * attack <
            -P.arena.halfLength + R.bot.ownGoalDistance)) ||
      (st.item === "SPIKES" && distance < R.bot.spikeRange)
    )
      this.use(car.id);
  }
  beforeStep(inputs: PlayerInput[] | ReadonlyMap<string, PlayerInput>) {
    if (!this.running) return;
    for (let i = 0; i < this.sim.cars.length; i++) {
      const car = this.sim.cars[i],
        st = this.players.get(car.id)!;
      if (this.suspended.has(car.id) || !car.body.isEnabled()) {
        if (st.phase !== "cooldown") this.end(car.id);
        continue;
      }
      const input = Array.isArray(inputs) ? inputs[i] : inputs.get(car.id);
      const down = !!input?.usePowerup,
        edge = down && !this.held.get(car.id);
      this.held.set(car.id, down);
      if (st.phase === "cooldown" && this.allowGrants) {
        st.cooldown = Math.max(0, st.cooldown - P.dt);
        if (st.cooldown <= R.numerical.epsilon) {
          this.grant(car.id);
          this.emit(car, "POWERUP_GRANTED", st.item!);
        }
      }
      if (edge) this.use(car.id);
      if (this.sim.players[i].controller === "bot") this.botUse(car, st);
      if (st.phase !== "active") continue;
      st.remaining = Math.max(0, st.remaining - P.dt);
      if (st.remaining <= R.numerical.epsilon) {
        this.end(car.id);
        continue;
      }
      if (st.attachment) st.attachment.age += P.dt;
      this.direction
        .copy(this.sim.ball.translation())
        .sub(car.body.translation());
      const distance = this.direction.length();
      if (distance < R.numerical.epsilon) continue;
      this.direction.divideScalar(distance);
      if (st.item === "GRAPPLING_HOOK") {
        const along = this.direction.dot(car.body.linvel());
        const dv = Math.min(
          R.grapple.acceleration * P.dt,
          Math.max(0, R.grapple.maxPullSpeed - along),
        );
        car.body.applyImpulse(
          this.impulse.copy(this.direction).multiplyScalar(P.car.mass * dv),
          true,
        );
      }
      if (st.item === "PLUNGER") {
        this.direction.negate();
        const approach = this.arm
          .copy(this.sim.ball.linvel())
          .sub(car.body.linvel())
          .dot(this.direction);
        const force = Math.max(
          0,
          Math.min(
            R.plunger.maxForce,
            distance * R.plunger.springStrength - approach * R.plunger.damping,
          ),
        );
        this.ballImpulse(
          this.impulse.copy(this.direction).multiplyScalar(force * P.dt),
        );
      }
    }
  }
  powerHitter(id: string) {
    const st = this.players.get(id);
    return st?.phase === "active" && st.item === "POWER_HITTER";
  }
  contact(
    car: Car,
    point: Vector3,
    normal: Vector3,
    normalImpulse: number,
    newContact: boolean,
  ) {
    const st = this.players.get(car.id);
    if (!st || st.phase !== "active") return;
    if (st.item === "GRAPPLING_HOOK" || st.item === "PLUNGER") {
      this.end(car.id);
      return;
    }
    if (st.item === "POWER_HITTER" && newContact && normalImpulse > 0) {
      const magnitude = Math.min(
        R.powerHitter.maxExtraImpulse,
        normalImpulse * (R.powerHitter.ballHitMultiplier - 1),
      );
      this.impulse.copy(normal).multiplyScalar(magnitude);
      this.ballImpulse(this.impulse, point);
      car.body.applyImpulseAtPoint(
        this.arm.copy(this.impulse).negate(),
        point,
        true,
      );
    }
    if (st.item === "SPIKES" && !this.carrier) {
      const projected = car.collider.projectPoint(
        this.sim.ball.translation(),
        false,
      );
      if (
        !projected ||
        this.direction
          .copy(projected.point)
          .distanceTo(this.sim.ball.translation()) >
          P.ball.radius + R.spikes.attachTolerance
      )
        return;
      this.inverse.copy(car.body.rotation()).invert();
      const local = this.direction
        .copy(this.sim.ball.translation())
        .sub(car.body.translation())
        .applyQuaternion(this.inverse)
        .clone();
      const contact = point
        .clone()
        .sub(car.body.translation())
        .applyQuaternion(this.inverse);
      const rotation = this.rotation
        .copy(this.inverse)
        .multiply(new Quaternion().copy(this.sim.ball.rotation()))
        .clone();
      this.joint = this.sim.world.createImpulseJoint(
        RAPIER.JointData.fixed(
          local,
          rotation,
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 0, z: 0, w: 1 },
        ),
        car.body,
        this.sim.ball,
        true,
      );
      this.joint.setContactsEnabled(false);
      this.carrier = car.id;
      st.attachment = {
        local: { x: local.x, y: local.y, z: local.z },
        contact: { x: contact.x, y: contact.y, z: contact.z },
        rotation: {
          x: rotation.x,
          y: rotation.y,
          z: rotation.z,
          w: rotation.w,
        },
        age: 0,
      };
      this.emit(car, "SPIKE_ATTACHED", "SPIKES");
    }
  }
  private ballImpulse(impulse: Vector3, point?: Vector3) {
    if (this.carrier) {
      const st = this.players.get(this.carrier)!;
      if (
        st.attachment!.age >= R.spikes.protection &&
        impulse.length() >= R.spikes.breakImpulse
      )
        this.end(this.carrier);
    }
    if (point) this.sim.ball.applyImpulseAtPoint(impulse, point, true);
    else this.sim.ball.applyImpulse(impulse, true);
  }
  private detach() {
    if (!this.carrier) return;
    const id = this.carrier,
      car = this.sim.cars.find((c) => c.id === id),
      st = this.players.get(id);
    if (this.joint) {
      this.sim.world.removeImpulseJoint(this.joint, true);
      this.joint = null;
    }
    if (car) {
      this.arm.copy(this.sim.ball.translation()).sub(car.body.worldCom());
      this.releaseVelocity
        .copy(car.body.angvel())
        .cross(this.arm)
        .add(car.body.linvel());
      this.sim.ball.setLinvel(this.releaseVelocity, true);
      this.sim.ball.setAngvel(car.body.angvel(), true);
      this.emit(car, "SPIKE_DETACHED", "SPIKES");
    }
    if (st) delete st.attachment;
    this.carrier = null;
  }
  recoverBall() {
    if (this.carrier) this.end(this.carrier);
  }
  afterStep() {
    for (const attacker of this.sim.cars) {
      if (!attacker.body.isEnabled() || !this.powerHitter(attacker.id))
        continue;
      this.sim.world.contactPairsWith(attacker.collider, (other) => {
        const victim = this.sim.cars.find(
          (c) =>
            c.collider.handle === other.handle &&
            c.team !== attacker.team &&
            c.body.isEnabled(),
        );
        if (!victim) return;
        let touching = false;
        this.sim.world.contactPair(attacker.collider, other, (m) => {
          if (m.numSolverContacts() > 0) touching = true;
        });
        if (touching) this.sim.demolish(attacker, victim);
      });
    }
    if (!this.carrier) return;
    const st = this.players.get(this.carrier)!;
    if (!st.attachment || st.attachment.age < R.spikes.protection) return;
    let largest = 0;
    const owner = this.sim.cars.find((c) => c.id === this.carrier)!;
    this.sim.world.contactPairsWith(this.sim.ballCollider, (other) => {
      if (other.handle === owner.collider.handle) return;
      this.sim.world.contactPair(this.sim.ballCollider, other, (m) => {
        let impulse = 0;
        for (let k = 0; k < m.numContacts(); k++)
          impulse += Math.abs(m.contactImpulse(k));
        largest = Math.max(largest, impulse);
      });
    });
    if (largest >= R.spikes.breakImpulse) this.end(this.carrier);
  }
  snapshot(): RumbleSnapshot {
    return {
      players: [...this.players.values()].map((st) => ({
        ...st,
        attachment: st.attachment
          ? {
              local: { ...st.attachment.local },
              contact: { ...st.attachment.contact },
              rotation: { ...st.attachment.rotation },
              age: st.attachment.age,
            }
          : undefined,
      })),
      events: this.events.map((e) => ({ ...e, point: { ...e.point } })),
    };
  }
  dispose() {
    this.reset();
    this.players.clear();
    this.state.players.length = 0;
  }
}
