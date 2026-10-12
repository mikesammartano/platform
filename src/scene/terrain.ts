import * as THREE from 'three';
import { ARC_X, COAST_X, LAND_VE, VE, VOLCANO, X_MAX, X_MIN, Z_FAR, prng, seafloorAnalytic } from './model';
import { NOISE } from './glsl';

// ---------- CPU value noise (terrain heights) ----------
const PERM = (() => {
  const r = prng(7);
  const p = new Uint8Array(512);
  const base = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [base[i], base[j]] = [base[j], base[i]];
  }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  return p;
})();
const grad = (ix: number, iy: number) => PERM[(PERM[ix & 255] + iy) & 255] / 255;
function noise2(x: number, y: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = grad(ix, iy);
  const b = grad(ix + 1, iy);
  const c = grad(ix, iy + 1);
  const d = grad(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(x: number, y: number, oct = 5) {
  let s = 0;
  let a = 0.5;
  for (let i = 0; i < oct; i++) {
    s += a * noise2(x, y);
    const nx = 1.6 * x - 1.2 * y;
    y = 1.2 * x + 1.6 * y;
    x = nx;
    a *= 0.5;
  }
  return s;
}
function ridged(x: number, y: number, oct = 6) {
  let s = 0;
  let a = 0.5;
  let w = 1;
  for (let i = 0; i < oct; i++) {
    let n = 1 - Math.abs(noise2(x, y) * 2 - 1);
    n *= n * w;
    w = Math.min(1, n * 2);
    s += a * n;
    const nx = 1.7 * x - 1.1 * y;
    y = 1.1 * x + 1.7 * y;
    x = nx;
    a *= 0.5;
  }
  return s;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const bump = (x: number, c: number, w: number) => Math.exp(-(((x - c) / w) ** 2));

/** Along-strike shift of the whole margin, so the coast and trench curve gently. Zero at the cut. */
const n1 = (t: number) => noise2(t, 3.7);
export function strikeOffset(z: number) {
  return 16 * (n1(-z / 260) - n1(0)) + 6 * (n1(-z / 95 + 11) - n1(11));
}

type Volcano = { x: number; z: number; r: number; h: number; main?: boolean };
export const VOLCANOES: Volcano[] = (() => {
  const r = prng(99);
  const list: Volcano[] = [{ x: VOLCANO.x, z: VOLCANO.z, r: VOLCANO.radius, h: VOLCANO.height, main: true }];
  for (const z of [-150, -285, -420, -600, -790, -1010, -1260, -1540, -1850, -2200]) {
    const zz = z + (r() - 0.5) * 50;
    list.push({ x: ARC_X + (r() - 0.5) * 30 + strikeOffset(zz), z: zz, r: 26 + r() * 14, h: 9 + r() * 7 });
  }
  return list;
})();

function landProfile(x: number, z: number) {
  // x is relative to the trench at this z.
  if (x < 0) {
    const hills = (fbm(x / 14 + 40, z / 14) - 0.5) * 2.2 * smooth(-10, -70, x);
    return seafloorAnalytic(x) + hills;
  }
  if (x < COAST_X) {
    const t = x / COAST_X;
    const shelf = -40 * Math.pow(1 - t, 2.1);
    const canyons = (fbm(x / 9, z / 30 + 5) - 0.5) * 3 * Math.sin(Math.PI * t);
    return shelf + canyons + 0.4;
  }
  const ruggedMask = smooth(COAST_X, COAST_X + 40, x);
  const coastal = 4.5 * bump(x, COAST_X + 26, 22);
  const cordillera = 14 * smooth(ARC_X - 70, ARC_X - 5, x) * (1 - smooth(ARC_X + 40, ARC_X + 110, x));
  const plateau = 13 * smooth(ARC_X - 10, ARC_X + 60, x) * (1 - smooth(ARC_X + 260, ARC_X + 380, x));
  const eastern = 8 * bump(x, ARC_X + 330, 45);
  const base = 1 + coastal + Math.max(cordillera, plateau) + eastern;
  const massif = ridged(x / 120 + 3.1, z / 120 + 17);
  const detail = ridged(x / 34, z / 34 + 5);
  const relief = (1.6 + 0.85 * base) * (0.95 * massif + 0.38 * detail - 0.22) * ruggedMask;
  const lowNoise = (fbm(x / 25, z / 25) - 0.5) * 1.6;
  const h = base + relief - 1.6 * ruggedMask + lowNoise;
  // inland lowlands stay above sea level
  return x > COAST_X + 8 ? Math.max(h, 0.35 + 0.3 * smooth(COAST_X, COAST_X + 30, x)) : h;
}

export function heightAt(x: number, z: number) {
  const off = strikeOffset(z);
  let h = landProfile(x - off, z);
  for (const v of VOLCANOES) {
    const d = Math.hypot(x - v.x, z - v.z);
    if (d < v.r) {
      const t = 1 - d / v.r;
      const ribs = 1 + 0.06 * Math.sin(Math.atan2(z - v.z, x - v.x) * 11) * t;
      const cone = v.h * Math.pow(t, 1.5) * ribs;
      const craterR = 0.13 * v.r;
      const crater = d < craterR ? 1.1 * (1 - (d / craterR) ** 2) : 0;
      // the cone builds on the range, smoothing rugged relief near its summit
      h = h + (14 - h) * 0.45 * t + cone - crater;
    }
  }
  // Ocean depths use VE; land relief is exaggerated further so mountains read on a classroom display.
  return h > 0 ? h * (LAND_VE / VE) : h;
}

// ---------- Mesh ----------
export const TERRAIN_NX = 640;
export const TERRAIN_NZ = 280;

export type TerrainData = {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  /** Heights along the cut (z = 0), sampled exactly at the mesh vertices. */
  profile: Float32Array;
  heightTex: THREE.DataTexture;
  heightTexBounds: THREE.Vector4;
};

export const zAt = (j: number) => Z_FAR * Math.pow(j / TERRAIN_NZ, 2.1);
export const xAt = (i: number) => X_MIN + ((X_MAX - X_MIN) * i) / TERRAIN_NX;

export function buildTerrain(sunDir: THREE.Vector3): TerrainData {
  const nx = TERRAIN_NX;
  const nz = TERRAIN_NZ;
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
  const profile = new Float32Array(nx + 1);
  for (let j = 0; j <= nz; j++) {
    const z = zAt(j);
    for (let i = 0; i <= nx; i++) {
      const x = xAt(i);
      const h = heightAt(x, z);
      const k = (j * (nx + 1) + i) * 3;
      pos[k] = x;
      pos[k + 1] = h;
      pos[k + 2] = z;
      if (j === 0) profile[i] = h;
    }
  }
  const idx = new Uint32Array(nx * nz * 6);
  let p = 0;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + 1;
      const c = a + nx + 1;
      const d = c + 1;
      // rows go toward -z, so wind to face +y
      idx[p++] = a; idx[p++] = b; idx[p++] = c;
      idx[p++] = b; idx[p++] = d; idx[p++] = c;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  // Height texture for the ocean shader (water depth -> color, foam).
  const tw = 384;
  const th = 192;
  const bounds = new THREE.Vector4(-900, 700, -1400, 0); // xmin, xmax, zmin, zmax
  const hdata = new Uint16Array(tw * th);
  for (let j = 0; j < th; j++) {
    const z = bounds.z + ((bounds.w - bounds.z) * j) / (th - 1);
    for (let i = 0; i < tw; i++) {
      const x = bounds.x + ((bounds.y - bounds.x) * i) / (tw - 1);
      hdata[j * tw + i] = THREE.DataUtils.toHalfFloat(heightAt(x, z));
    }
  }
  const heightTex = new THREE.DataTexture(hdata, tw, th, THREE.RedFormat, THREE.HalfFloatType);
  heightTex.magFilter = THREE.LinearFilter;
  heightTex.minFilter = THREE.LinearFilter;
  heightTex.needsUpdate = true;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: sunDir },
      uFogColor: { value: new THREE.Color(0.6, 0.69, 0.79) },
      uFogDensity: { value: 0.00042 },
      uBathy: { value: 0 },
      uTopo: { value: 0 },
      uCamPos: { value: new THREE.Vector3() },
      uVolc: { value: VOLCANOES.slice(0, 4).map((v) => new THREE.Vector3(v.x, v.z, v.r)) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vPos; varying vec3 vNormal;
      void main(){
        vPos = position; vNormal = normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      ${NOISE}
      uniform vec3 uSun; uniform vec3 uFogColor; uniform float uFogDensity; uniform vec3 uCamPos;
      uniform float uBathy; uniform float uTopo; uniform vec3 uVolc[4];
      varying vec3 vPos; varying vec3 vNormal;
      vec3 ramp5(float t, vec3 a, vec3 b, vec3 c, vec3 d, vec3 e){
        t = clamp(t, 0., 1.) * 4.;
        if (t < 1.) return mix(a, b, t);
        if (t < 2.) return mix(b, c, t - 1.);
        if (t < 3.) return mix(c, d, t - 2.);
        return mix(d, e, t - 3.);
      }
      void main(){
        vec3 n = normalize(vNormal);
        float h = vPos.y;
        float slope = 1. - n.y;
        vec2 q = vPos.xz;
        float nz = fbm3(q * .08);
        float nz2 = vnoise(q * .6);
        // base colors
        vec3 deep = vec3(.11, .13, .15);
        vec3 sand = vec3(.62, .55, .42);
        vec3 grass = mix(vec3(.16, .25, .11), vec3(.3, .33, .16), nz);
        vec3 dry = mix(vec3(.45, .37, .26), vec3(.38, .3, .22), nz2);
        vec3 rock = mix(vec3(.31, .27, .24), vec3(.46, .41, .36), nz);
        vec3 darkRock = vec3(.2, .18, .17);
        vec3 snow = vec3(.92, .94, .97);
        vec3 col;
        if (h < -0.2) {
          col = mix(vec3(.36, .33, .27), deep, smoothstep(-1., -14., h));
        } else {
          col = mix(sand, grass, smoothstep(.3, 1.6, h));
          col = mix(col, dry, smoothstep(14., 34., h + nz * 12.));
          col = mix(col, rock, smoothstep(.22, .5, slope + nz * .15) * smoothstep(2., 12., h));
          col = mix(col, rock * .9, smoothstep(30., 44., h));
          // volcanic ash and lava rock near arc volcanoes
          for (int i = 0; i < 4; i++){
            float d = length(q - uVolc[i].xy) / uVolc[i].z;
            col = mix(col, darkRock * (.85 + .3 * nz2), (1. - smoothstep(.55, 1.05, d)) * .85);
          }
          float snowLine = 50. + nz * 9. - slope * 10.;
          col = mix(col, snow, smoothstep(snowLine, snowLine + 3., h) * (1. - smoothstep(.6, .85, slope)));
        }
        // evidence overlays
        if (uBathy > 0. && h < 0.) {
          float km = -h / 5.;
          vec3 b = ramp5(km / 8., vec3(.62,.9,.88), vec3(.24,.66,.8), vec3(.13,.4,.7), vec3(.12,.2,.52), vec3(.1,.06,.3));
          float c = abs(fract(km) - .5); float w = fwidth(km);
          b = mix(b * 1.25, b, smoothstep(.5 - w * 1.2, .5 - w * .2, .5 - c));
          col = mix(col, b, uBathy);
        }
        if (uTopo > 0. && h > 0.) {
          float km = h / ${LAND_VE.toFixed(1)};
          vec3 t = ramp5(km / 6., vec3(.25,.48,.24), vec3(.66,.66,.32), vec3(.66,.44,.24), vec3(.48,.31,.24), vec3(.95,.94,.92));
          float c = abs(fract(km * 2.) - .5); float w = fwidth(km * 2.);
          t = mix(t * .55, t, smoothstep(.5 - w * 1.2, .5 - w * .2, .5 - c));
          col = mix(col, t, uTopo);
        }
        // lighting: warm low sun + sky ambient
        // terrain is lit by a higher key light than the low sun seen in the sky, so relief reads clearly
        vec3 L = normalize(vec3(-.62, .62, -.18));
        float diff = max(dot(n, L), 0.);
        vec3 sunCol = vec3(1.25, 1.08, .88);
        vec3 amb = mix(vec3(.16, .18, .22), vec3(.34, .4, .5), n.y * .5 + .5);
        vec3 lit = col * (amb + sunCol * diff * .95);
        // fog
        float dist = length(vPos - uCamPos);
        float fog = 1. - exp(-pow(dist * uFogDensity, 1.35));
        float hazeH = exp(-max(h, 0.) * .015);
        lit = mix(lit, uFogColor, clamp(fog * (.65 + .35 * hazeH), 0., 1.));
        gl_FragColor = vec4(lit, 1.);
      }`,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  return { mesh, material, profile, heightTex, heightTexBounds: bounds };
}
