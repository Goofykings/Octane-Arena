export const KICKOFF_GO_TIME = 0.7;
/** The same fixed-step clock boundary for matches and practice shots. */
export function advanceKickoffCountdown(remaining: number, dt: number) {
  const next = Math.max(0, remaining - dt);
  return next < 1e-8 ? 0 : next;
}
