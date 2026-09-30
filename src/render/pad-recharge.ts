import * as T from "three";
import { padRecharge, type Pad } from "../game/pads";
export class PadRecharge {
  readonly mesh: T.Mesh<T.RingGeometry, T.ShaderMaterial>;
  constructor(parent: T.Group, large: boolean) {
    this.mesh = new T.Mesh(
      new T.RingGeometry(large ? 0.56 : 0.22, large ? 0.78 : 0.38, 64),
      new T.ShaderMaterial({
        uniforms: { progress: { value: 0 } },
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
        vertexShader: `varying vec2 point; void main(){point=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        fragmentShader: `varying vec2 point; uniform float progress; void main(){float turn=mod(atan(point.y,point.x)+4.712389,6.283185)/6.283185; if(turn>progress || progress<=0.)discard;gl_FragColor=vec4(1.,.55,.08,.8);}`,
      }),
    );
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0.008;
    parent.add(this.mesh);
  }
  update(pad: Pad) {
    this.mesh.visible = pad.cooldown > 0;
    this.mesh.material.uniforms.progress.value = padRecharge(pad);
  }
}
