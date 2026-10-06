/** Gameplay tuning: see docs/TUNING.md for the most useful knobs and their effects.
 * All distances/accelerations below are SI. Calibration sources and discrepancies: docs/PHYSICS.md.
 * Right-handed axes: +Y up, car forward -Z, car right +X. 100 uu = 1 metre. */
export const UU = 0.01;
export const P = {
  training: { launchSpeed: 6, maxLaunchSpeed: 30 },
  demolition: { respawn: 3, boost: 33, minClosing: 2, frontDot: 0.7 },
  supersonic: { start: 22, maintain: 21, grace: 1 },
  skid: { lifetime: 0.75, minSlip: 1.2, fullSlip: 10 },
  dt: 1 / 120,
  maxSteps: 12,
  gravity: 650 * UU,
  car: {
    mass: 150,
    halfWidth: 42 * UU,
    halfHeight: 18 * UU,
    halfLength: 59 * UU,
    hitboxY: 0.04,
    comY: -0.04,
    maxSpeed: 2300 * UU,
    sonic: 2200 * UU,
    brake: 3500 * UU,
    coast: 525 * UU,
    boostGround: 991.666 * UU,
    boostAir: 1058.333 * UU,
    boostUse: 33.3,
    airThrottle: 66.667 * UU,
    airReverse: 33.334 * UU,
    maxAngular: 6,
    chassisFriction: 0.05,
    wheelSpinCoastTime: 45, // Seconds for airborne wheels to coast to zero.
    roofFriction: 0.5, // Extra rigid-body friction only while resting/sliding on the roof.
    roofSteeringFriction: 0.2, // Less resistance while actively turning on the roof.
    roofYawSpeed: 1.5, // Weaker steering while sliding on real roof contacts (rad/s).
    roofYawResponse: 12,
    contactHeight: 0.31,
    contactReach: 0.5,
    contactSkin: 0.008,
    maxContactCorrection: 0.04,
    rayLength: 0.65,
    grip: 24,
    adhesion: 3.25,
    wallDriveSpeed: 4,
    wallIdleGrip: 0.025,
    ceilingAdhesionEnd: -0.25,
    normalResponse: 40,
    align: 100,
    alignDamping: 16,
    curveAlignmentScale: 6, // Responsive normal support only while the surface frame is turning.
    curveDampingScale: 3,
    steeringResponse: 18,
    airPitch: 12.1,
    airYaw: 8.9,
    airRoll: 36.1,
    airDamping: 1.7,
    contactRelease: 0.025,
    airControlBlend: 0.04,
    recoveryCooldown: 0.8,
    edgeRecoverySpeed: 2, // Slow wheel-shoulder contact only; never normal cornering.
    edgeDriveGrip: 0.65, // Maximum driven sidewall friction as a fraction of static load.
  },
  powerslide: {
    // RocketSim handbrake rates / friction curves; our contact-force mapping is original.
    rise: 5,
    fall: 2,
    lateralAtForward: 0.1,
    lateralAtSideways: 0,
    minimumLateralGrip: 0.030,
    longitudinalAtForward: 0.5,
    longitudinalAtSideways: 1,
    slipGripFalloff: 0.8,
    coastDrag: 0.25, // Supported, unpowered drift keeps rolling resistance.
    lowSpeedSteer: 0.39235,
    highSpeedSteer: 0.1261,
    steerCurveEnd: 25,
    yawResponse: 14,
    rotationScale: 0.6, // Gentler powerslide rotation; normal steering is unchanged.
    partialContactScale: 0.5,
  },
  jump: {
    impulse: 292 * UU,
    holdAcceleration: 1460 * UU,
    holdTime: 0.2,
    sticky: 325 * UU,
    stickyTime: 3 / 120,
    window: 1.25,
    flipTime: 0.65,
    flipMaxAngular: 7, // Flip-only rotation cap (rad/s); previously shared car.maxAngular = 5.5.
    dodgeImpulse: 5,
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
    // Heavier, calmer ball for Octane Arena's standard mode (original tuning).
    mass: 50,
    restitution: 0.48,
    friction: 0.28,
    drag: 0.08,
    angularDrag: 0.08,
    maxSpeed: 6000 * UU, // Soccar reference cap; calmer bounce/mass tuning stays independent.
    maxAngular: 6,
  },
  hit: {
    minClosing: 1,
    rearmClosing: 0.35,
    impactRamp: 2,
    maxRelative: 46,
    verticalScale: 0.55,
    forwardScale: 0.65,
    roofTilt: 0.2,
    cooldown: 0.025,
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
    goalCurve: 2.4,
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
export const throttleAcceleration = (speed: number) =>
  lookup(Math.abs(speed), [
    [0, 16],
    [14, 1.6],
    [14.1, 0],
    [23, 0],
  ]);
// Community curvature in 1/uu converted to 1/metre.
export const curvature = (speed: number) =>
  lookup(Math.abs(speed), [
    [0, 0.69],
    [5, 0.398],
    [10, 0.235],
    [15, 0.1375],
    [17.5, 0.11],
    [23, 0.088],
  ]);
