import type RAPIER from "@dimforge/rapier3d-compat";
import {
  DROPSHOT_CONFIG as D,
  dropshotTiles,
  tileAt,
  dropshotSpawn,
  floorEntry,
  type DropshotSnapshot,
  type DropshotEvent,
  type TileState,
} from "../../shared/dropshot";
import type { createDropshotArena } from "../arena/dropshot";
export class Dropshot {
  states: TileState[] = dropshotTiles.map(() => 0);
  epoch = 0;
  revision = 0;
  energy = 0;
  recentAbsorbedForce = 0;
  lastTouchTeam: 0 | 1 | null = null;
  lastTouchPlayerId: string | null = null;
  events: DropshotEvent[] = [];
  goal: 0 | 1 | null = null;
  entry: 0 | 1 | null = null;
  grounded = false;
  private lastDamage = -Infinity;
  private lastFull = -Infinity;
  private fullRevision = -1;
  private regen = new Map<string, number>();
  readonly handles = new Map<number, number>();
  constructor(readonly arena: ReturnType<typeof createDropshotArena>) {
    arena.tiles.forEach((c, i) => this.handles.set(c.handle, i));
  }
  get chargeLevel(): 0 | 1 | 2 {
    return this.energy >= D.chargeThreshold2
      ? 2
      : this.energy >= D.chargeThreshold1
        ? 1
        : 0;
  }
  private tileText = "";
  private tileRevision = -1;
  private tileEpoch = -1;
  get tiles() {
    if (this.tileRevision !== this.revision || this.tileEpoch !== this.epoch) {
      this.tileText = this.states.join("");
      this.tileRevision = this.revision;
      this.tileEpoch = this.epoch;
    }
    return this.tileText;
  }
  respawnPoint(team: number, slot: number) {
    const spawn = dropshotSpawn(team, slot, 2),
      tile = tileAt(spawn.x, spawn.z);
    if (!tile || this.states[tile.id] < 2) return spawn;
    const safe = dropshotTiles
      .filter((t) => t.team === team && this.states[t.id] < 2)
      .sort(
        (a, b) =>
          Math.hypot(a.x - spawn.x, a.z - spawn.z) -
          Math.hypot(b.x - spawn.x, b.z - spawn.z),
      )[0];
    return { ...spawn, x: safe?.x ?? 0, z: safe?.z ?? 0 };
  }
  reset() {
    this.states.fill(0);
    this.arena.tiles.forEach((c) => c.setEnabled(true));
    this.epoch++;
    this.revision = 0;
    this.energy = this.recentAbsorbedForce = 0;
    this.lastTouchTeam = this.lastTouchPlayerId = null;
    this.events = [];
    this.goal = this.entry = null;
    this.lastDamage = -Infinity;
    this.lastFull = -Infinity;
    this.regen.clear();
    this.grounded = false;
  }
  touch(id: string, team: 0 | 1, impactSpeed: number) {
    this.lastTouchTeam = team;
    this.lastTouchPlayerId = id;
    const raw = impactSpeed * D.impactEnergyPerSpeed;
    if (raw < D.minimumChargeImpact) return 0;
    const energy = Math.max(
      0,
      Math.min(raw, D.recentForceCapacity - this.recentAbsorbedForce),
    );
    this.energy = Math.min(D.maxEnergy, this.energy + energy);
    this.recentAbsorbedForce += energy;
    return energy;
  }
  tick(dt: number, time = 0) {
    while (this.events.length && this.events[0].time < time - D.eventRetention)
      this.events.shift();
    this.recentAbsorbedForce = Math.max(
      0,
      this.recentAbsorbedForce - D.recentForceDecay * dt,
    );
  }
  regenBoost(
    car: {
      id: string;
      boost: number;
      mutators: { boostAmount: string };
      body: { isEnabled(): boolean };
    },
    held: boolean,
    dt: number,
  ) {
    if (!car.body.isEnabled()) return;
    if (held) this.regen.set(car.id, D.boostRegenDelay);
    else {
      const old = this.regen.get(car.id) ?? D.boostRegenDelay;
      this.regen.set(car.id, Math.max(0, old - dt));
      if (car.mutators.boostAmount === "DEFAULT")
        car.boost = Math.min(
          100,
          car.boost + D.boostRegenRate * Math.max(0, dt - old),
        );
    }
  }
  damage(tileId: number, impact: number, time: number) {
    const tile = dropshotTiles[tileId];
    if (
      !tile ||
      this.lastTouchTeam === null ||
      !this.lastTouchPlayerId ||
      tile.team === this.lastTouchTeam ||
      this.states[tileId] === 2 ||
      impact < D.minimumTileDamageImpact ||
      time - this.lastDamage < D.damageCooldown - 1e-8
    )
      return null;
    const level = this.chargeLevel,
      radius = [
        D.normalDamageRadius,
        D.chargedDamageRadius,
        D.superChargedDamageRadius,
      ][level],
      changes: [number, TileState][] = [];
    for (const id of tile.clusters[radius])
      if (this.states[id] < 2) {
        this.states[id] = (this.states[id] + 1) as TileState;
        if (this.states[id] === 2) this.arena.tiles[id].setEnabled(false);
        changes.push([id, this.states[id]]);
      }
    if (!changes.length) return null;
    const e: DropshotEvent = {
      id: ++this.revision,
      time,
      tileId,
      playerId: this.lastTouchPlayerId,
      level,
      changes,
    };
    this.events.push(e);
    if (this.events.length > 16) this.events.shift();
    this.lastDamage = time;
    this.energy = this.recentAbsorbedForce = 0;
    return e;
  }
  afterStep(
    ball: RAPIER.RigidBody,
    collider: RAPIER.Collider,
    world: RAPIER.World,
    before: { x: number; y: number; z: number },
    velocity: { x: number; y: number; z: number },
    radius: number,
    time: number,
  ) {
    this.grounded = false;
    let tileId: number | undefined,
      impact = 0;
    const desired = tileAt(ball.translation().x, ball.translation().z)?.id;
    world.contactPairsWith(collider, (other) => {
      const id = this.handles.get(other.handle);
      if (
        other.parent() !== null ||
        (id === undefined && other.handle !== this.arena.filler.handle)
      )
        return;
      world.contactPair(collider, other, (m, flipped) => {
        // Normal points from the static tile toward the ball, independent of pair order.
        const n = m.normal(),
          sign = flipped ? 1 : -1;
        const power = Math.max(
          0,
          -sign * (velocity.x * n.x + velocity.y * n.y + velocity.z * n.z),
        );
        for (let i = 0; i < m.numContacts(); i++) {
          if (m.contactDist(i) >= 0.004) continue;
          const top = sign * n.y > 0.995 && ball.translation().y >= 0;
          if (top) this.grounded = true;
          // A vertical face is exposed only beside an OPEN neighbor on that face.
          const t = id === undefined ? undefined : dropshotTiles[id];
          const horizontal = Math.hypot(n.x, n.z);
          const exposed =
            t &&
            horizontal > 0.15 &&
            t.neighbors.some((j) => {
              const b = dropshotTiles[j],
                dx = b.x - t.x,
                dz = b.z - t.z;
              return (
                this.states[j] === 2 &&
                ((dx * n.x + dz * n.z) * sign) / horizontal >
                  Math.hypot(dx, dz) * 0.85
              );
            });
          if (
            id !== undefined &&
            (top || exposed) &&
            (tileId === undefined ||
              power > impact ||
              (power === impact && id === desired))
          ) {
            tileId = id;
            impact = power;
          }
        }
      });
    });
    if (tileId !== undefined) this.damage(tileId, impact, time);
    const p = ball.translation();
    if (p.y > radius + 0.1) this.entry = null;
    const entry = floorEntry(before, p, radius, this.tiles);
    if (entry !== null) this.entry = entry;
    if (
      this.entry !== null &&
      p.y < -D.tileThickness - radius - D.goalClearance
    )
      this.goal = this.entry === 0 ? 1 : 0;
    // Numerical backstop: a downward crossing through CLOSED geometry never scores.
    if (before.y >= 0 && p.y < 0 && this.entry === null) {
      ball.setTranslation({ x: before.x, y: radius + 0.02, z: before.z }, true);
      const v = ball.linvel();
      ball.setLinvel({ x: v.x, y: Math.max(0, v.y), z: v.z }, true);
    }
  }
  private visual: DropshotSnapshot = {
    epoch: 0,
    revision: 0,
    energy: 0,
    chargeLevel: 0,
    lastTouchTeam: null,
    lastTouchPlayerId: null,
    recentAbsorbedForce: 0,
    events: [],
  };
  visualState() {
    const v = this.visual;
    v.epoch = this.epoch;
    v.revision = this.revision;
    v.energy = this.energy;
    v.chargeLevel = this.chargeLevel;
    v.lastTouchTeam = this.lastTouchTeam;
    v.lastTouchPlayerId = this.lastTouchPlayerId;
    v.recentAbsorbedForce = this.recentAbsorbedForce;
    v.tiles = this.tiles;
    v.events = this.events;
    return this.visual;
  }
  forceFull() {
    this.lastFull = -Infinity;
  }
  snapshot(time: number, full = false): DropshotSnapshot {
    const send =
      full ||
      time - this.lastFull >= D.fullStateInterval ||
      this.fullRevision < 0;
    if (send && !full) {
      this.lastFull = time;
      this.fullRevision = this.revision;
    }
    return {
      epoch: this.epoch,
      revision: this.revision,
      energy: this.energy,
      chargeLevel: this.chargeLevel,
      lastTouchTeam: this.lastTouchTeam,
      lastTouchPlayerId: this.lastTouchPlayerId,
      recentAbsorbedForce: this.recentAbsorbedForce,
      ...(send ? { tiles: this.tiles } : {}),
      events: this.events.map((e) => ({
        ...e,
        changes: e.changes.map((c) => [...c]),
      })),
    };
  }
}
