import * as T from "three";
/** Authoring visuals only; the limits remain the existing physical speed caps. */
export class TrainingPowerArrow extends T.ArrowHelper {
  readonly shaft = new T.Mesh(
    new T.CylinderGeometry(0.11, 0.11, 1, 8),
    new T.MeshBasicMaterial({ depthTest: false }),
  );
  private tint = new T.Color();
  private base: T.Color;
  private red = new T.Color(0xff3030);
  power = 0;
  length = 0;
  constructor(
    readonly maxSpeed: number,
    readonly minimumLength: number,
    readonly range: number,
    color: number,
  ) {
    super(new T.Vector3(0, 1, 0), new T.Vector3(), minimumLength, color);
    this.base = new T.Color(color);
    this.line.visible = false;
    this.add(this.shaft);
    this.renderOrder = 9;
    this.setPower(0);
  }
  speedAtLength(length: number) {
    return (
      T.MathUtils.clamp((length - this.minimumLength) / this.range, 0, 1) *
      this.maxSpeed
    );
  }
  setPower(speed: number) {
    this.power = T.MathUtils.clamp(speed / this.maxSpeed, 0, 1);
    this.length = this.minimumLength + this.range * this.power;
    const head = Math.min(1.35, this.length * 0.6);
    this.setLength(this.length, head, Math.min(0.95, this.length * 0.5));
    const shaftLength = Math.max(0.02, this.length - head * 0.8);
    this.shaft.scale.y = shaftLength;
    this.shaft.position.y = shaftLength / 2;
    this.tint
      .copy(this.base)
      .lerp(this.red, T.MathUtils.smoothstep(this.power, 0.55, 1));
    this.setColor(this.tint);
    this.shaft.material.color.copy(this.tint);
  }
}
