import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { ATMOS, NOISE, NOISE_D } from './glsl';
import { TSUNAMI_X } from './model';

/** Late-afternoon sun low over the ocean, in the upper left of the default view. */
export const SUN_DIR = new THREE.Vector3(-0.3, 0.12, -0.95).normalize();
/**
 * Key light for the landscape and baked shadows. It comes from the same side as the sun but higher,
 * so the relief facing the class stays readable (a standard cinematography cheat).
 */
export const KEY_DIR = new THREE.Vector3(-0.6, 0.45, -0.25).normalize();

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
      ${ATMOS}
      uniform vec3 uSun; uniform float uTime;
      varying vec3 vDir;
      float cloudDensity(vec2 uv){
        float base = fbm5(uv * 1.1);
        float detail = fbm3(uv * 4.7 + base * 1.5);
        return smoothstep(.56, .86, base + detail * .24);
      }
      void main(){
        vec3 dir = normalize(vDir);
        vec3 c = skyRadiance(dir, uSun);
        float sd = max(dot(dir, uSun), 0.);
        // sun disc (very bright, so it blooms)
        c += vec3(1., .88, .7) * smoothstep(.99955, .99985, sd) * 22.;
        if (dir.y > 0.) {
          // a cloud deck on a plane overhead; light is marched toward the sun for self-shadowing
          vec2 uv = dir.xz / (dir.y + .07) * 1.25 + vec2(uTime * .005, uTime * .0018);
          float dens = cloudDensity(uv);
          if (dens > .002) {
            vec2 toSun = normalize(uSun.xz) * .08;
            float shade = 0.;
            for (int i = 1; i <= 3; i++) shade += cloudDensity(uv + toSun * float(i));
            float light = exp(-shade * .9);
            vec3 lit = vec3(1.25, 1.12, .98) * 1.6 * light + vec3(.35, .42, .55) * .55;
            // silver lining when looking toward the sun
            lit += vec3(1.4, 1.1, .8) * pow(sd, 6.) * (1. - dens) * 2.;
            float fadeH = smoothstep(.0, .2, dir.y);
            c = mix(c, lit, dens * fadeH * .95);
          }
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
    uBathy: { value: 0 },
    uSince: { value: 99 },
    uQuakes: { value: 1 },
    uNormals: { value: null as THREE.Texture | null },
    uNormalsOn: { value: 0 },
    uEnv: { value: null as THREE.Texture | null },
    uEnvOn: { value: 0 },
    uEnvRot: { value: 0 },
    uEnvGain: { value: 1 },
  };
  loadSeaAssets(uniforms);
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
      ${NOISE_D}
      ${ATMOS}
      uniform vec3 uSun; uniform float uTime; uniform sampler2D uHeight; uniform vec4 uBounds;
      uniform float uBathy, uSince, uQuakes;
      uniform sampler2D uNormals, uEnv;
      uniform float uNormalsOn, uEnvOn, uEnvRot, uEnvGain;
      varying vec3 vPos;
      vec2 nmGrad(vec2 uv){ vec3 n = texture2D(uNormals, uv).rgb * 2. - 1.; return n.xy / max(n.z, .35); }
      // real sky photograph (Poly Haven HDRI), turned so its sun lines up with the scene's sun
      vec3 envSample(vec3 d){
        float u = atan(d.z, d.x) * .15915494 + .5 - uEnvRot;
        float v = .5 - asin(clamp(d.y, -1., 1.)) * .31830989;
        return texture2D(uEnv, vec2(u, v)).rgb * uEnvGain;
      }
      // wind-driven sea: several directional swell trains plus derivative noise chop
      vec2 waveGrad(vec2 q, float t, float lod){
        vec2 g = vec2(0.);
        const int N = 4;
        vec2 dirs[4]; dirs[0] = normalize(vec2(1., .35)); dirs[1] = normalize(vec2(.8, -.6)); dirs[2] = normalize(vec2(1., .9)); dirs[3] = normalize(vec2(.3, 1.));
        float amps[4]; amps[0] = .55; amps[1] = .32; amps[2] = .2; amps[3] = .12;
        float freqs[4]; freqs[0] = .09; freqs[1] = .17; freqs[2] = .33; freqs[3] = .61;
        for (int i = 0; i < N; i++){
          float k = freqs[i];
          float ph = dot(dirs[i], q) * k + t * sqrt(9.8 * k) * .9;
          g += dirs[i] * cos(ph) * amps[i] * k * (i > 1 ? lod : 1.);
        }
        if (uNormalsOn > .5) {
          // photographed wave normals at two scales, drifting in different directions
          // two non-aligned scales (rotated, irrational ratio) hide the texture's tiling
          vec2 q2 = mat2(.8, -.6, .6, .8) * q;
          vec2 nm = nmGrad(q * .0105 + vec2(t * .006, t * .002)) * .55 + nmGrad(q2 * .0291 - vec2(t * .004, t * .011)) * .45;
          g += nm * .6 * lod;
        } else {
          vec2 p = q * .7 + vec2(t * .25, t * .1);
          float a = .35;
          for (int i = 0; i < 3; i++){
            g += noised(p).yz * a * lod;
            p = ROT * p * 1.9; a *= .5;
          }
        }
        return g;
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
        float lod = 1. - smoothstep(200., 1400., dist);
        vec2 g = waveGrad(q, t, lod) * (1.4 / (1. + dist * .0016));

        // tsunami: a long, low wave front parallel to the trench, running out to sea and toward the coast
        float tsu = 0.;
        if (uSince < 16. && uQuakes > 0.) {
          float side = sign(q.x - ${TSUNAMI_X.toFixed(2)});
          float dd = abs(q.x - ${TSUNAMI_X.toFixed(2)}) - 55. * uSince;
          float env = uQuakes * exp(-uSince / 9.) * smoothstep(0., .6, uSince);
          tsu = exp(-dd * dd / 160.) * env;
          g.x += -2. * dd / 160. * tsu * side * 1.6;
        }
        vec3 n = normalize(vec3(-g.x, 1., -g.y));

        // Fresnel reflection of the sky, GGX-like sun highlight (HDR, blooms), and deep-water color
        float cosT = max(dot(n, V), 0.);
        float F = .02 + .98 * pow(1. - cosT, 5.);
        vec3 R = reflect(-V, n);
        R.y = abs(R.y);
        vec3 refl = skyRadiance(R, uSun);
        if (uEnvOn > 0.) refl = mix(refl, envSample(R), uEnvOn * smoothstep(.03, .18, R.y) * .8);
        vec3 Hh = normalize(V + uSun);
        float nh = max(dot(n, Hh), 0.);
        float a2 = .0035;
        float D = a2 / (3.1416 * pow(nh * nh * (a2 - 1.) + 1., 2.));
        vec3 sunSpec = vec3(1., .85, .65) * min(D * .22 * F, 9.);
        vec3 deepC = vec3(.004, .03, .06);
        vec3 shallowC = vec3(.03, .2, .2);
        vec3 body = mix(shallowC, deepC, smoothstep(.3, 12., depth));
        // light passing through wave crests toward the viewer
        float sss = pow(max(dot(V, -uSun), 0.), 3.) * max(g.x * .8 + .3, 0.) * .25;
        body += vec3(.02, .14, .12) * sss;
        body += vec3(.04, .05, .05) * max(dot(n, uSun), 0.) * .5;
        vec3 col = mix(body, refl * .62, F) + sunSpec;

        // surf on the beach and sparse whitecaps offshore
        float shore = 1. - smoothstep(0., 1.8, depth);
        float bands = smoothstep(.35, .75, vnoise(q * vec2(1.1, .6) + vec2(t * .8, 0.)) * .6 + vnoise(q * 3. + t) * .4);
        float caps = smoothstep(.7, .9, vnoise(q * .55 + t * .3) * .6 + vnoise(q * 2.3 - t * .4) * .4) * .35 * lod;
        float foam = clamp(shore * bands + caps + tsu * .6 * smoothstep(.5, .75, vnoise(q * vec2(.5, 2.) + t)), 0., .95);
        col = mix(col, vec3(.85, .88, .9) * (max(dot(n, uSun), 0.) * 1.6 + .5), foam);
        col += vec3(.08, .11, .14) * tsu;

        float alpha = mix(.55, 1., smoothstep(.3, 7., depth));
        alpha = mix(alpha, .3, uBathy);
        col = aerial(col, vPos, cameraPosition, uSun);
        float far = 1. - exp(-dist * .00036);
        alpha = mix(alpha, 1., far);
        gl_FragColor = vec4(col, alpha);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}

/**
 * Loads the two image assets used by the sea (both optional; the shader falls back to procedural detail):
 * a tiling wave normal map, and a Poly Haven sky HDRI (CC0) used for the clouds seen in reflections.
 */
function loadSeaAssets(u: {
  uNormals: { value: THREE.Texture | null };
  uNormalsOn: { value: number };
  uEnv: { value: THREE.Texture | null };
  uEnvOn: { value: number };
  uEnvRot: { value: number };
  uEnvGain: { value: number };
}) {
  const base = import.meta.env.BASE_URL;
  new THREE.TextureLoader().load(`${base}textures/waternormals.jpg`, (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 4;
    u.uNormals.value = t;
    u.uNormalsOn.value = 1;
  });
  new HDRLoader().load(`${base}textures/sky_blouberg_sunrise_2_1k.hdr`, (t) => {
    const img = t.image as { data: Uint16Array | Float32Array; width: number; height: number };
    const read = (i: number) => (img.data instanceof Uint16Array ? THREE.DataUtils.fromHalfFloat(img.data[i]) : img.data[i]);
    // find the sun (brightest texel) and the average sky brightness in the upper half
    let best = 0;
    let sunX = 0;
    let sum = 0;
    let count = 0;
    const rows = Math.floor(img.height / 2);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < img.width; x += 2) {
        const i = (y * img.width + x) * 4;
        const l = read(i) + read(i + 1) + read(i + 2);
        if (l > best) {
          best = l;
          sunX = x;
        }
        if (y > rows * 0.25) {
          sum += Math.min(l, 6) / 3;
          count++;
        }
      }
    }
    const sunU = sunX / img.width;
    const ourU = Math.atan2(SUN_DIR.z, SUN_DIR.x) / (Math.PI * 2) + 0.5;
    t.wrapS = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    u.uEnv.value = t;
    u.uEnvRot.value = ourU - sunU;
    u.uEnvGain.value = 0.55 / Math.max(1e-3, sum / Math.max(1, count));
    u.uEnvOn.value = 1;
  });
}
