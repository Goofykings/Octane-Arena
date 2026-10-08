import { P } from "../../config/physics";
export type TrainingType = "striker" | "goalie" | "aerial";
export interface TrainingShot {
  playerSpawn: { x: number; z: number; yaw: number };
  ballSpawn: { x: number; y: number; z: number };
  ballVelocity: { x: number; y: number; z: number };
  ballFrozen: boolean;
  successCondition: "opponent-goal" | "save";
  failureCondition: "goal-or-timeout";
  timeLimit: number;
}
export interface TrainingPack {
  id: TrainingType;
  name: string;
  description: string;
  type: TrainingType;
  shots: TrainingShot[];
}
const r = P.ball.radius + 0.025;
const shot = (
  px: number,
  pz: number,
  bx: number,
  by: number,
  bz: number,
  vx = 0,
  vy = 0,
  vz = 0,
  frozen = false,
  save = false,
  yawOffset = 0,
): TrainingShot => ({
  playerSpawn: { x: px, z: pz, yaw: Math.atan2(-(bx - px), -(bz - pz)) + yawOffset },
  ballSpawn: { x: bx, y: by, z: bz },
  ballVelocity: { x: vx, y: vy, z: vz },
  ballFrozen: frozen,
  successCondition: save ? "save" : "opponent-goal",
  failureCondition: "goal-or-timeout",
  timeLimit: save ? 16 : 36,
});
const goal = P.arena.halfLength;
// Metres, +Y up, Blue attacks -Z. Scenarios stay inside the existing arena.
const striker = [
  shot(0,-goal+25,0,r,-goal+12,0.8,0,-0.8,false,false,0.1),
  shot(-3,-goal+31,-1,r,-goal+17,1.2,0,-1,false,false,-0.15),
  shot(3,-goal+32,-6,r,-goal+18,2.2,0,-0.7,false,false,0.2),
  shot(-4,-goal+36,7,r,-goal+21,-3,0,-1,false,false,0.25),
  shot(-13,-goal+35,-5,r,-goal+20,2.7,0,-1.2,false,false,0.3),
  shot(13,-goal+35,5,r,-goal+20,-3.1,0,-1.2,false,false,-0.3),
  shot(-10,-goal+44,2,r,-goal+26,-2.8,0,-1.5,false,false,0.35),
  shot(8,-goal+40,-7,r,-goal+23,4.2,0,-1.2,false,false,-0.45),
  shot(-16,-goal+36,4,r,-goal+22,-4.4,0,-1.5,false,false,0.4),
  shot(16,-goal+38,-4,r,-goal+24,4.4,0,-1.5,false,false,-0.45),
];
// Genuine low, lofted and diagonal goal threats, with reaction/repositioning
// room. Initial heights and vertical speeds are tuned against the arena shell.
const goalie = [
  shot(-3,goal-4.5,0,r,goal-22,0,0,12,false,true,0.15),
  shot(2.8,goal-5,-4,r,goal-25,0,0,14,false,true,-0.2),
  shot(-2.8,goal-5,4,2.8,goal-18,0,4,15,false,true,0.2),
  shot(2,goal-6,-2,3.2,goal-22,0,3.2,17,false,true,-0.25),
  shot(4,goal-5,-10,1.2,goal-28,5,0.8,18,false,true,0.3),
  shot(-4.5,goal-5.5,10,1.2,goal-30,-5.5,0.8,19,false,true,-0.3),
  shot(2.5,goal-6,-4,5.8,goal-28,1,1.8,20,false,true,0.35),
  shot(-2,goal-6,4,5.5,goal-27,-0.8,1.4,22,false,true,-0.35),
  shot(3,goal-3.5,-8,4.8,goal-30,1,2.3,22,false,true,0.4),
  shot(-3.5,goal-6,10,5.8,goal-34,-4.2,2,24,false,true,-0.4),
];
const aerial = [
  shot(-2,-goal+25,0,3.8,-goal+11,0,0,0,true,false,0.15),
  shot(3,-goal+29,-4,4.2,-goal+13,0,0,0,true,false,-0.2),
  shot(-3,-goal+30,4,4.5,-goal+13,0,0,0,true,false,0.25),
  shot(5,-goal+35,-2,5.2,-goal+16,0,0,0,true,false,-0.3),
  shot(0,-goal+28,0,1.8,-goal+13,0.8,7.5,-0.3,false,false,0.15),
  shot(-3,-goal+30,-6,1.8,-goal+14,1.4,8,-0.5,false,false,-0.2),
  shot(3,-goal+32,6,2,-goal+15,-1.6,8.5,-0.6,false,false,0.25),
  shot(-5,-goal+35,2,2,-goal+17,-1.8,9,-0.8,false,false,-0.3),
  shot(6,-goal+38,-7,2.2,-goal+18,2.3,9.5,-1.1,false,false,0.35),
  shot(-6,-goal+41,8,2.2,-goal+20,-2.6,10,-1.3,false,false,-0.4),
];
export const trainingPacks: TrainingPack[] = [
  {
    id: "striker",
    type: "striker",
    name: "STRIKER",
    description: "Practice shots and approaches.",
    shots: striker,
  },
  {
    id: "goalie",
    type: "goalie",
    name: "GOALIE",
    description: "Practice saves from different angles.",
    shots: goalie,
  },
  {
    id: "aerial",
    type: "aerial",
    name: "AERIAL",
    description: "Practice hitting airborne balls.",
    shots: aerial,
  },
];
