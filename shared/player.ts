/** Device-independent intent. Physics never imports keyboard, gamepad or transport code. */
export interface PlayerInput {
  throttle: number;
  steer: number;
  pitch: number;
  yaw: number;
  roll: number;
  jump: boolean;
  boost: boolean;
  slide: boolean;
  dodgeX?: number;
  dodgeY?: number;
}
export type TeamId = 0 | 1;
export interface PlayerEntity {
  id: string;
  localPlayerId?: string;
  avatarId?: string;
  avatarColor?: string;
  name: string;
  team: TeamId;
  controller: "local" | "bot" | "remote";
}
export const neutralInput = (): PlayerInput => ({
  throttle: 0,
  steer: 0,
  pitch: 0,
  yaw: 0,
  roll: 0,
  jump: false,
  boost: false,
  slide: false,
});
