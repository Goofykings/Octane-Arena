import * as T from "three";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

const vertexShader = `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
/** One quarter-resolution draw. Retains the original HDR scene for OutputPass. */
export class GlowExtractPass extends Pass {
  target: T.WebGLRenderTarget | null = null;
  private material = new T.ShaderMaterial({
    toneMapped: false,
    uniforms: {
      tDiffuse: { value: null },
      texel: { value: new T.Vector2() },
      threshold: { value: 1.8 },
    },
    vertexShader,
    fragmentShader: `// OCTANE_POLISH
      uniform sampler2D tDiffuse; uniform vec2 texel; uniform float threshold; varying vec2 vUv;
      vec3 bright(vec2 uv) {
        vec3 c=texture2D(tDiffuse,uv).rgb;
        float peak=max(max(c.r,c.g),c.b), low=min(min(c.r,c.g),c.b);
        // Suppress neutral whites (especially the ball), retain bright colored emitters.
        float mask=smoothstep(threshold,threshold+0.7,peak)*smoothstep(0.06,0.2,(peak-low)/max(peak,0.001));
        return c/max(peak,1.0)*mask;
      }
      void main(){vec3 glow=bright(vUv)*0.4;
        glow+=bright(vUv+vec2(texel.x,0.0))*0.15;
        glow+=bright(vUv-vec2(texel.x,0.0))*0.15;
        glow+=bright(vUv+vec2(0.0,texel.y))*0.15;
        glow+=bright(vUv-vec2(0.0,texel.y))*0.15;
        gl_FragColor=vec4(glow,1.0);}`,
  });
  private quad = new FullScreenQuad(this.material);
  constructor() {
    super();
    this.needsSwap = false;
    this.enabled = false;
  }
  setSize(width: number, height: number) {
    if (!this.enabled) return;
    const scale = Math.min(0.25, 512 / Math.max(width, height));
    const w = Math.max(1, Math.ceil(width * scale)),
      h = Math.max(1, Math.ceil(height * scale));
    if (!this.target)
      this.target = new T.WebGLRenderTarget(w, h, {
        depthBuffer: false,
        stencilBuffer: false,
        type: T.UnsignedByteType,
      });
    else if (this.target.width !== w || this.target.height !== h)
      this.target.setSize(w, h);
    this.material.uniforms.texel.value.set(1 / w, 1 / h);
  }
  render(
    renderer: T.WebGLRenderer,
    _write: T.WebGLRenderTarget,
    read: T.WebGLRenderTarget,
  ) {
    if (!this.target) return;
    const previous = renderer.getRenderTarget();
    this.material.uniforms.tDiffuse.value = read.texture;
    renderer.setRenderTarget(this.target);
    this.quad.render(renderer);
    renderer.setRenderTarget(previous);
  }
  setThreshold(threshold: number) {
    this.material.uniforms.threshold.value = threshold;
  }
  dispose() {
    this.target?.dispose();
    this.target = null;
    this.material.dispose();
    this.quad.dispose();
  }
}

/** One full-resolution draw, combining soft bloom, grading and optional vignette. */
export function compositePolishPass() {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      glow: { value: null },
      glowTexel: { value: new T.Vector2() },
      strength: { value: 0 },
      contrast: { value: 1.018 },
      saturation: { value: 1.02 },
      vignette: { value: 0 },
    },
    vertexShader,
    fragmentShader: `// OCTANE_POLISH
      uniform sampler2D tDiffuse, glow; uniform vec2 glowTexel;
      uniform float strength,contrast,saturation,vignette; varying vec2 vUv;
      void main(){
        vec4 source=texture2D(tDiffuse,vUv); vec3 c=source.rgb;
        if(strength>0.0){
          vec3 halo=texture2D(glow,vUv).rgb*0.4;
          halo+=texture2D(glow,vUv+vec2(glowTexel.x,0.0)).rgb*0.15;
          halo+=texture2D(glow,vUv-vec2(glowTexel.x,0.0)).rgb*0.15;
          halo+=texture2D(glow,vUv+vec2(0.0,glowTexel.y)).rgb*0.15;
          halo+=texture2D(glow,vUv-vec2(0.0,glowTexel.y)).rgb*0.15;
          c+=halo*strength*(1.0-c);
        }
        // Endpoint-preserving contrast avoids crushed blacks/clipped whites.
        c+=(contrast-1.0)*c*(1.0-c)*(2.0*c-1.0);
        float luma=dot(c,vec3(0.2126,0.7152,0.0722));
        c=mix(vec3(luma),c,saturation);
        vec2 edge=(vUv-0.5)*2.0;
        c*=1.0-vignette*smoothstep(0.45,1.5,dot(edge,edge));
        gl_FragColor=vec4(clamp(c,0.0,1.0),source.a);
      }`,
  });
}
