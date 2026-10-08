import * as T from "three";
import type { TrainingShot } from "./packs";
import { P } from "../../config/physics";
export function trainingLaunchPreview(shot: TrainingShot){
  const direction=new T.Vector3().copy(shot.ballVelocity),speed=direction.length();
  return {direction:speed>0?direction.divideScalar(speed):direction,length:T.MathUtils.clamp(1.4+speed*0.2,1.4,6.5),visible:!shot.ballFrozen&&speed>0.001,speed};
}
export class TrainingPreview {
  readonly arrow = new T.ArrowHelper(new T.Vector3(0,1,0),new T.Vector3(),1,0xffdf89);
  constructor(scene:T.Scene){this.arrow.name="training-launch-arrow";scene.add(this.arrow);}
  load(shot:TrainingShot){
    const preview=trainingLaunchPreview(shot);
    this.arrow.userData.hasVelocity=preview.visible;
    this.arrow.userData.speed=preview.speed;
    this.arrow.userData.length=preview.length;
    this.arrow.setDirection(preview.visible?preview.direction:new T.Vector3(0,1,0));
    this.arrow.position.copy(shot.ballSpawn).addScaledVector(preview.direction,P.ball.radius+0.12);
    this.arrow.setLength(preview.length,Math.min(0.8,preview.length*0.22),Math.min(0.45,preview.length*0.14));
  }
  update(countdown:number){this.arrow.visible=countdown>0&&this.arrow.userData.hasVelocity;}
}
