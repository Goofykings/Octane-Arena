/** Gameplay tuning: see docs/TUNING.md for the most useful knobs and their effects.
 * All distances/accelerations below are SI. Calibration sources and discrepancies: docs/PHYSICS.md.
 * Right-handed axes: +Y up, car forward -Z, car right +X. 100 uu = 1 metre.
 *
 * The vehicle model mirrors the public RocketSim reconstruction of Rocket League:
 * four raycast spring/damper wheels, per-wheel tire impulses with speed-dependent
 * steering angles, contact-count dependent sticky force and per-axis air control.
 * Values marked "RL" are reference constants converted from uu to metres. */
export const UU = 0.01;
/** RL converts air-control "torque" units into rad/s² with this factor. */
const TORQUE_SCALE = ((2 * Math.PI) / 65536) * 1000;
export const P = {
  training: { launchSpeed: 6, maxLaunchSpeed: 30 },
  demolition: { respawn: 3, boost: 33, minClosing: 2, frontDot: 0.7 },
  supersonic: { start: 22, maintain: 21, grace: 1 },
  skid: { lifetime: 0.75, minSlip: 1.2, fullSlip: 10 },
  dt: 1 / 120,
  maxSteps: 12,
  gravity: 650 * UU,
  car: {
    mass: 180, // RL; ball is one sixth of this.
    halfWidth: 42 * UU,
    halfHeight: 18 * UU,
    halfLength: 59 * UU,
    hitboxY: 0.04,
    // Body-frame centre of mass, as fractions of the chassis. RL's Octane COM sits
    // at the bottom face of its hitbox and 20% of the axle half-span behind the
    // wheelbase midpoint; that low, rear-biased COM makes wheels-down landings
    // and stable cornering emerge without any upright torque.
    comBottomOffset: 0, // Metres above the hitbox bottom face.
    comRearAxleFraction: 0.2,
    chassisFriction: 0.3, // RL car/world friction.
    chassisRestitution: 0.1, // RL car restitution; arena surfaces add none.
    maxSpeed: 2300 * UU,
    throttleMaxSpeed: 1410 * UU,
    sonic: 2200 * UU,
    brake: 3500 * UU,
    coast: 525 * UU,
    boostGround: (2975 / 3) * UU,
    boostAir: (3175 / 3) * UU,
    boostUse: 100 / 3,
    boostMinTime: 0.1, // RL: a boost tap lasts at least 0.1 s.
    airThrottle: (200 / 3) * UU,
    airReverse: 33.334 * UU,
    maxAngular: 5.5,
    // Per-axis air control (RL): torque and damping in rad/s² per unit input / per rad/s.
    airPitch: 130 * TORQUE_SCALE,
    airYaw: 95 * TORQUE_SCALE,
    airRoll: 400 * TORQUE_SCALE,
    airPitchDamping: 30 * TORQUE_SCALE, // Applied as (1 - |pitch input|).
    airYawDamping: 20 * TORQUE_SCALE, // Applied as (1 - |yaw input|).
    airRollDamping: 50 * TORQUE_SCALE, // Always applied.
    wheelSpinCoastTime: 45, // Seconds for airborne wheels to coast to zero.
    contactHeight: 0.31, // Wheel hardpoint to ground at static ride height.
    contactSkin: 0.008,
    maxContactCorrection: 0.04, // Chassis guard: bounded positional correction per tick.
    rayLength: 0.65, // Visual/edge clearance probe length; suspension rays use P.suspension.
    // Contact classification.
    groundedWheels: 3, // RL: three or four wheels grant "on ground".
    loadedTravel: 0.05, // A wheel extended further than this past rest is not touching.
    coherentNormal: 0.5, // Wheel normals farther than 60° from the average are not coherent.
    // Sticky force multiplier by touching wheels. RL applies it for any contact;
    // here one or two wheels get none, so they can never hold the car on a wall
    // or ceiling: gravity and momentum peel it away.
    partialSticky: [0, 0, 0, 1, 1],
    // Tire grip by touching wheels while not grounded, further scaled on walls and
    // ceilings by the RL non-sticky curve (a tenth on vertical/overhead surfaces).
    partialGrip: [0, 0.4, 0.6, 1, 1],
    // Landing stabilization: only a coherent 3-4 wheel touchdown that is already
    // nearly wheels-down and settling. Damps surface-tangent spin; never a pose target.
    landingAlignment: 0.985,
    landingDamping: 30, // 1/s, one-way (anti-tilt) spin damping after touchdown.
    landingDampingTime: 0.2,
    landingMinAir: 0.025,
    landingFirstContact: 0.9, // First touch must be wheels within ~25° of the surface.
    landingMaxAngular: 4,
    // RL auto-roll, restricted to a nearly stationary car resting on its side.
    autoRollForce: 100 * UU,
    autoRollTorque: 80,
    autoRollMaxSpeed: 2,
    autoRollMaxAngular: 1.5,
    // Roof recovery (RL auto-flip equivalent).
    recoveryCooldown: 0.8,
    recoveryInputThreshold: 0.25,
    recoveryDuration: 1.05,
    recoveryMaxSpeed: 5.6,
    recoveryAcceleration: 58,
    recoveryResponse: 20,
    recoveryBraking: 24,
    recoveryStopAngle: 0.1,
    recoveryStopSpeed: 0.15,
    recoveryHop: 1.1,
  },
  /** RL raycast suspension (RocketSim btVehicleRL). Stiffness and damping are per
   * unit sprung mass, so they are unit independent. */
  suspension: {
    stiffness: 500,
    compressionDamping: 25,
    relaxationDamping: 40,
    travel: 12 * UU,
    subtraction: 2.5 * UU, // RL ray shortening; also the hard bump-stop depth.
    pushbackErp: 0.2, // Bullet's default positional error reduction for the bump stop.
    // Correct bump-stop depth positionally instead of as velocity. Deader hard
    // landings, but it bleeds speed through tight wall transitions; RL uses
    // the velocity form, which keeps supersonic speed onto walls.
    splitPushback: false,
    staticLoad: 1.5, // Gravity plus the RL resting sticky force, in g.
    minContactDot: 0.6, // Contact normal · suspension axis needed for tire support.
  },
  /** RL per-wheel tire model. */
  tire: {
    // Bullet bilateral impulse fraction (0.2) × RL friction scale (mass/3) × dt at 120 Hz.
    lateral: 0.2 * (180 / 3) * (1 / 120),
    slipDeadband: 5 * UU,
    engine: 400 * UU, // Per contacting wheel; four wheels give the 1600 uu/s² curve.
    brake: 875 * UU, // Per contacting wheel; four wheels give 3500 uu/s².
    partialEngine: 0.25, // RL divides drive torque by four with fewer than three wheels.
    stopSpeed: 25 * UU,
    coastBrake: 0.15,
    throttleDeadzone: 0.001,
    brakeStop: 0.25, // Per-wheel fraction of forward contact speed removed per tick.
  },
  powerslide: {
    // RocketSim handbrake rates and friction curves.
    rise: 5,
    fall: 2,
    lateralFactor: 0.1,
    longitudinalAtForward: 0.5,
    longitudinalAtSideways: 0.9,
    lowSpeedSteer: 0.39235,
    highSpeedSteer: 0.1261,
    steerCurveEnd: 25,
  },
  sticky: {
    base: 0.5, // RL: half gravity toward the surface whenever wheels touch.
    driving: 1, // RL: + (1 - |normal.y|) while throttling or rolling.
  },
  jump: {
    stallThreshold: 0.85,
    stallSimultaneousWindow: 0.12,
    impulse: (875 / 3) * UU,
    holdAcceleration: (4375 / 3) * UU,
    holdTime: 0.2,
    minTime: 0.025,
    minTimeScale: 0.62, // RL scales the held force during the minimum jump.
    window: 1.25,
    flipTime: 0.65,
    flipMaxAngular: 7, // Spin cap while a flip's torque is active (RL: the global 5.5 rad/s).
    dodgeImpulse: 500 * UU,
    // RocketSim RLConst / RLUtilities calibration; y-up conversion in Car.tick.
    flipPitchTorque: 224,
    flipRollTorque: 260,
    pitchLockExtra: 0.3,
    controlReturn: 0.12, // Original short blend after the measured lock.
    verticalDampStart: 0.15,
    verticalDampEnd: 0.21,
    verticalDamp120: 0.35,
    cancelDamping: 4, // Pitch-only braking rate (1/s), preserving existing momentum.
  },
  ball: {
    // radius: 91.25 * UU,
    radius: 95 * UU,
    mass: 30, // RL: one sixth of the car.
    restitution: 0.6,
    friction: 0.35,
    drag: 0.03,
    angularDrag: 0,
    maxSpeed: 6000 * UU,
    maxAngular: 6,
  },
  hit: {
    // Car-ball contact material (RL): fully inelastic with high friction. The
    // rigid solver uses the true contact-point velocity v + ω × r, then RL's
    // extra impulse supplies the characteristic launch.
    friction: 2,
    restitution: 0,
    extraZScale: 0.35,
    extraForwardScale: 0.65,
    extraMaxRelative: 4600 * UU,
    // Below this relative speed (a resting or slowly rolling contact) no extra
    // impulse applies; RL has none, but its manifold rarely refreshes there.
    extraMinRelative: 25 * UU,
    minClosing: 1, // Stats/effects classification only.
  },
  bump: { minClosing: 2, gain: 0.22, maxExtra: 4.5, recovery: 0.28 },
  match: {
    countdown: 3,
    celebration: 3.2,
    explosionNear: 19,
    explosionFar: 8,
    kickoffBoost: 33,
  },
  arena: {
    halfWidth: 40.96,
    halfLength: 51.2,
    height: 20.44,
    corner: 9,
    ramp: 2.4,
    goalHalf: 8.93,
    goalHeight: 6.43,
    goalDepth: 8.8,
    goalCurve: 1.35, // Compact goal interior fillets; field/wall ramps remain 2.4 m.
    goalRoofDrop: 0.55, // Roof rises toward front; mouth height/score plane unchanged.
    goalLip: 1.2,
    postRadius: 0.22,
    crossbarBevel: 0.04, // Small rounded edges; the field-facing beam remains flat.
  },
} as const;
export function lookup(
  x: number,
  points: readonly (readonly [number, number])[],
): number {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    if (x < b[0])
      return a[1] + (b[1] - a[1]) * Math.max(0, (x - a[0]) / (b[0] - a[0]));
  }
  return points[points.length - 1][1];
}
/** RL drive-torque factor: throttle acceleration with four wheels on the ground. */
export const DRIVE_SPEED_CURVE = [
  [0, 1],
  [1400 * UU, 0.1],
  [1410 * UU, 0],
] as const;
export const throttleAcceleration = (speed: number) =>
  4 * P.tire.engine * lookup(Math.abs(speed), DRIVE_SPEED_CURVE);
/** RL front-wheel steering angle (radians) by forward speed. */
export const STEER_ANGLE_CURVE = [
  [0, 0.53356],
  [500 * UU, 0.3193],
  [1000 * UU, 0.18203],
  [1500 * UU, 0.1057],
  [1750 * UU, 0.08507],
  [3000 * UU, 0.03454],
] as const;
export const steerAngle = (speed: number) =>
  lookup(Math.abs(speed), STEER_ANGLE_CURVE);
export const powerslideSteerAngle = (speed: number) =>
  lookup(Math.abs(speed), [
    [0, P.powerslide.lowSpeedSteer],
    [P.powerslide.steerCurveEnd, P.powerslide.highSpeedSteer],
  ]);
/** RL lateral friction by slip ratio. */
export const LATERAL_FRICTION_CURVE = [
  [0, 1],
  [1, 0.2],
] as const;
/** RL friction scale for an unpowered car, by contact normal height. */
export const NON_STICKY_FRICTION_CURVE = [
  [0, 0.1],
  [0.7075, 0.5],
  [1, 1],
] as const;
/** RL extra car-ball impulse factor by relative speed. */
export const EXTRA_HIT_CURVE = [
  [0, 0.65],
  [500 * UU, 0.65],
  [2300 * UU, 0.55],
  [4600 * UU, 0.3],
] as const;
/** Measured community curvature (1/uu converted to 1/m). The tire model above
 * reproduces it; this table is the calibration target and the AI's planner. */
export const curvature = (speed: number) =>
  lookup(Math.abs(speed), [
    [0, 0.69],
    [5, 0.398],
    [10, 0.235],
    [15, 0.1375],
    [17.5, 0.11],
    [23, 0.088],
  ]);
