import * as T from "three";

// Shared analytic pattern: no texture downloads, per-tile shaders or dot objects.
const pattern = `
float hexRadius(vec2 p){p=abs(p);return max(p.x,p.x*.5+p.y*.8660254)/3.3;}
float tilePattern(vec2 p){
 float h=hexRadius(p), a=atan(p.y,p.x);
 float w=max(fwidth(h),.002);
 float edge=1.-smoothstep(.982-w,.982+w,h);
 float rings=0.;
 for(int i=0;i<3;i++){
  float r=.28+float(i)*.245;
  float band=1.-smoothstep(.007,.007+w,abs(h-r));
  float dots=pow(max(0.,cos(a*(30.+float(i)*12.))),14.);
  rings=max(rings,band*dots);
 }
 float technical=(1.-smoothstep(.004,.004+w,abs(h-.88)))*step(.92,cos(a*6.));
 return max(rings,technical)*.95 + (1.-edge)*.35;
}`;
const extensionPoint = `
vec2 extendedHex(vec2 field){
 float z=abs(field.y), base=floor((z-4.260512)/5.715768);
 vec2 local=vec2(0.); float best=1e6;
 for(int i=0;i<3;i++){
  float row=base+float(i)-1.;
  float centerZ=4.260512+row*5.715768;
  float offset=(12.-row)*3.3;
  float centerX=floor((field.x+offset)/6.6+.5)*6.6-offset;
  vec2 p=vec2(field.x-centerX,z-centerZ);
  float h=hexRadius(p); if(h<best){best=h;local=p;}
 }
 return local;
}`;
function floorMaterial(extension: boolean) {
  const material = new T.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.55,
    metalness: 0.4,
    side: T.DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader =
      "varying vec2 tilePoint;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\ntilePoint=position.xz;",
      );
    shader.fragmentShader =
      "varying vec2 tilePoint;\n" +
      pattern +
      "\n" +
      (extension ? extensionPoint : "") +
      "\n" +
      shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
   ${extension ? "diffuseColor.rgb *= tilePoint.y>0.?vec3(.00212469,.00699541,.0159963):vec3(.0152085,.00651209,.00303527);" : ""}
   float detail=tilePattern(${extension ? "extendedHex(tilePoint)" : "tilePoint"});
   diffuseColor.rgb *= .62+detail*.6;
   totalEmissiveRadiance += diffuseColor.rgb * detail * 1.8;`,
    );
  };
  material.customProgramCacheKey = () =>
    extension ? "dropshot-clipped-extension-v2" : "dropshot-dotted-hex-v2";
  return material;
}
export const tileMaterial = () => floorMaterial(false);
export const extensionMaterial = () => floorMaterial(true);
