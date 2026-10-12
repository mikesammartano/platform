import * as THREE from 'three';
import { NOISE } from './glsl';
import { TSUNAMI_X } from './model';

export const SUN_DIR = new THREE.Vector3(-0.78, 0.11, -0.62).normalize();
export const FOG_COLOR = new THREE.Color(0.6, 0.69, 0.79);

const SKY_FN = /* glsl */ `
vec3 skyColor(vec3 dir, vec3 sun){
  float h = dir.y;
  vec3 zen = vec3(.14,.3,.54);
  vec3 hor = vec3(.7,.78,.85);
  vec3 c = mix(hor, zen, pow(clamp(h, 0., 1.), .5));
  float sd = max(dot(dir, sun), 0.);
  c = mix(c, vec3(1.,.83,.58), pow(sd, 3.) * (1. - smoothstep(0., .35, h)) * .75);
  c += vec3(1.,.78,.5) * (pow(sd, 10.) * .35 + pow(sd, 400.) * 3.);
  return c;
}
`;

export function buildSky() {
  const uniforms = { uSun: { value: SUN_DIR }, uTime: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){
        vDir = normalize((modelMatrix * vec4(position, 1.)).xyz - cameraPosition);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      ${NOISE}
      ${SKY_FN}
      uniform vec3 uSun; uniform float uTime;
      varying vec3 vDir;
      void main(){
        vec3 dir = normalize(vDir);
        vec3 c = skyColor(dir, uSun);
        if (dir.y > 0.) {
          vec2 uv = dir.xz / (dir.y + .06) * 1.3 + vec2(uTime * .006, uTime * .002);
          float base = fbm5(uv * 1.4);
          float detail = fbm3(uv * 5.5);
          float cov = smoothstep(.5, .78, base + detail * .18);
          float sd = max(dot(dir, uSun), 0.);
          vec3 shade = mix(vec3(.46,.5,.58), vec3(.98,.93,.85), smoothstep(.35, .9, detail));
          shade = mix(shade, vec3(1.,.82,.6), pow(sd, 4.) * .7);
          cov *= smoothstep(.0, .18, dir.y) * .92;
          c = mix(c, shade, cov);
        } else {
          c = vec3(.6,.69,.79);
        }
        gl_FragColor = vec4(c, 1.);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 24), mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}

export function buildOcean(heightTex: THREE.Texture, bounds: THREE.Vector4) {
  const uniforms = {
    uSun: { value: SUN_DIR },
    uTime: { value: 0 },
    uHeight: { value: heightTex },
    uBounds: { value: bounds },
    uFogColor: { value: FOG_COLOR },
    uFogDensity: { value: 0.00042 },
    uBathy: { value: 0 },
    uSince: { value: 99 },
    uQuakes: { value: 1 },
  };
  const geo = new THREE.PlaneGeometry(10000, 9000, 1, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(-3500, 0, -4500);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main(){ vPos = (modelMatrix * vec4(position, 1.)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.); }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      ${NOISE}
      ${SKY_FN}
      uniform vec3 uSun; uniform float uTime; uniform sampler2D uHeight; uniform vec4 uBounds;
      uniform vec3 uFogColor; uniform float uFogDensity; uniform float uBathy;
      uniform float uSince, uQuakes;
      varying vec3 vPos;
      float W(vec2 q, float t, float lod){
        return vnoise(q * .18 + t * vec2(.16, .05)) * .5
             + vnoise(q * .5 - t * vec2(.05, .22)) * .3 * lod
             + vnoise(q * 1.4 + t * vec2(.4, .16)) * .2 * lod * lod;
      }
      void main(){
        vec2 q = vPos.xz;
        vec2 uv = vec2((q.x - uBounds.x) / (uBounds.y - uBounds.x), (q.y - uBounds.z) / (uBounds.w - uBounds.z));
        float floorY = -40.;
        if (uv.x >= 0. && uv.x <= 1. && uv.y >= 0. && uv.y <= 1.) floorY = texture2D(uHeight, uv).r;
        float depth = -floorY;
        if (depth < -.2) discard;
        vec3 V = cameraPosition - vPos;
        float dist = length(V);
        V /= dist;
        float t = uTime;
        float lod = 1. - smoothstep(250., 1200., dist);
        float e = .5 + dist * .002;
        float amp = 1.1 / (1. + dist * .004);
        float wx = (W(q + vec2(e, 0.), t, lod) - W(q - vec2(e, 0.), t, lod)) / (2. * e);
        float wz = (W(q + vec2(0., e), t, lod) - W(q - vec2(0., e), t, lod)) / (2. * e);
        // tsunami: a long, low wave front parallel to the trench, running out to sea and toward the coast
        float tsu = 0.;
        float tsuSlope = 0.;
        if (uSince < 16. && uQuakes > 0.) {
          float side = sign(q.x - ${TSUNAMI_X.toFixed(2)});
          float dd = abs(q.x - ${TSUNAMI_X.toFixed(2)}) - 55. * uSince;
          float env = uQuakes * exp(-uSince / 9.) * smoothstep(0., .6, uSince);
          tsu = exp(-dd * dd / 160.) * env;
          tsuSlope = -2. * dd / 160. * tsu * side;
        }
        vec3 n = normalize(vec3(-wx * amp - tsuSlope * 1.6, 1., -wz * amp));
        float fres = .02 + .98 * pow(1. - max(dot(n, V), 0.), 5.);
        vec3 R = reflect(-V, n);
        R.y = abs(R.y);
        vec3 refl = skyColor(R, uSun);
        vec3 body = mix(vec3(.08,.4,.42), vec3(.03,.13,.22), smoothstep(.2, 10., depth));
        body = mix(body, vec3(.02,.09,.17), smoothstep(10., 40., depth));
        vec3 col = mix(body, refl * vec3(.78, .84, .92), clamp(fres, 0., 1.) * .7);
        float spec = pow(max(dot(R, uSun), 0.), 280.) * 3.5 + pow(max(dot(R, uSun), 0.), 28.) * .18;
        col += vec3(1.,.86,.65) * spec;
        // surf along the shore, sparse whitecaps offshore
        float shore = 1. - smoothstep(0., 1.8, depth);
        float bands = smoothstep(.35, .75, vnoise(q * vec2(1.1, .6) + vec2(t * .8, 0.)) * .6 + vnoise(q * 3. + t) * .4);
        float foam = shore * bands + smoothstep(.8, .88, W(q * 1.7, t * 1.3, 1.)) * .3 * (1. - smoothstep(150., 700., dist));
        foam += tsu * smoothstep(.55, .75, vnoise(q * vec2(.5, 2.) + t)) * .8;
        col = mix(col, vec3(.9,.94,.96), clamp(foam, 0., .9));
        col += vec3(.12, .16, .2) * tsu;
        float alpha = mix(.45, 1., smoothstep(.3, 7., depth));
        alpha = mix(alpha, .3, uBathy);
        float fog = 1. - exp(-pow(dist * uFogDensity, 1.35));
        col = mix(col, uFogColor, clamp(fog, 0., 1.));
        alpha = mix(alpha, 1., fog);
        gl_FragColor = vec4(col, alpha);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}
