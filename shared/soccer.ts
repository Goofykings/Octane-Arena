export const soccerModes = [
  { id: "soccar", label: "SOCCAR" },
  { id: "heatseeker", label: "HEATSEEKER" },
] as const;
export type SoccerMode = (typeof soccerModes)[number]["id"];
export interface HeatseekerState {
  active: boolean;
  ownerTeam: 0 | 1 | null;
  targetTeam: 0 | 1 | null;
  lastTouchPlayerId: string | null;
  tier: number;
  speed: number; // SI m/s; divide by UU to display uu/s.
  kickoffTeam: 0 | 1;
  backboardSequence: number;
}
