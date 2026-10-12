import * as THREE from 'three';
import { ARC_X, COAST_X, LAND_VE, VE, VOLCANO, X_MAX, X_MIN, Z_FAR, prng, seafloorAnalytic } from './model';
import { ATMOS, NOISE, NOISE_D } from './glsl';

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
/** Value noise with derivatives (quintic), used for erosion-like relief. */
function noised(x: number, y: number): [number, number, number] {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const dux = 30 * fx * fx * (fx * (fx - 2) + 1);
  const duy = 30 * fy * fy * (fy * (fy - 2) + 1);
  const a = grad(ix, iy);
  const b = grad(ix + 1, iy);
  const c = grad(ix, iy + 1);
  const d = grad(ix + 1, iy + 1);
  const k1 = b - a;
  const k2 = c - a;
  const k4 = a - b - c + d;
  return [a + k1 * ux + k2 * uy + k4 * ux * uy, dux * (k1 + k4 * uy), duy * (k2 + k4 * ux)];
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
function ridged(x: number, y: number, oct = 5) {
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
/**
 * "Eroded" fbm: octaves are damped where the accumulated slope is steep, which leaves sharp ridges,
 * smooth valley floors and dendritic gullies, like water-carved mountains.
 */
function eroded(x: number, y: number, oct = 7) {
  let s = 0;
  let a = 0.5;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < oct; i++) {
    const [v, gx, gy] = noised(x, y);
    dx += gx;
    dy += gy;
    s += (a * v) / (1 + dx * dx + dy * dy);
    const nx = 1.6 * x - 1.2 * y;
    y = 1.2 * x + 1.6 * y;
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
  const crest = ridged(x / 140 + 3.1, z / 140 + 17);
  const carved = eroded(x / 75 + 9.3, z / 75 - 2.7);
  const relief = (1.6 + 0.9 * base) * (0.55 * crest + 1.05 * carved - 0.42) * ruggedMask;
  const lowNoise = (fbm(x / 25, z / 25) - 0.5) * 1.4;
  const h = base + relief - 1.2 * ruggedMask + lowNoise;
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
      // concave stratovolcano profile with erosion gullies down the flanks
      const ang = Math.atan2(z - v.z, x - v.x);
      const gullies = 1 - 0.07 * Math.pow(Math.abs(Math.sin(ang * 9 + fbm(x / 6, z / 6) * 3)), 3) * (1 - t);
      const cone = v.h * Math.pow(t, 1.6) * gullies;
      const craterR = 0.12 * v.r;
      const crater = d < craterR ? 1.3 * (1 - (d / craterR) ** 2) : 0;
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

/**
 * Bakes sun visibility (soft shadows) and sky visibility (ambient occlusion) from the height grid.
 * Computed on a half-resolution grid and interpolated per vertex: about 4.5M height lookups.
 */
function bakeLight(H: Float32Array, nx: number, nz: number, sun: { x: number; y: number; z: number }) {
  const jOf = (z: number) => nz * Math.pow(Math.min(1, Math.max(0, z / Z_FAR)), 1 / 2.1);
  const sample = (x: number, z: number) => {
    if (z > 0 || x < X_MIN || x > X_MAX) return -1e9;
    const fi = ((x - X_MIN) / (X_MAX - X_MIN)) * nx;
    const fj = jOf(z);
    const i = Math.min(nx - 1, Math.floor(fi));
    const j = Math.min(nz - 1, Math.floor(fj));
    const u = fi - i;
    const v = fj - j;
    const r0 = j * (nx + 1);
    const r1 = r0 + nx + 1;
    const a = H[r0 + i] * (1 - u) + H[r0 + i + 1] * u;
    const b = H[r1 + i] * (1 - u) + H[r1 + i + 1] * u;
    return Math.max(a * (1 - v) + b * v, 0);
  };
  const lh = Math.hypot(sun.x, sun.z);
  const lx = sun.x / lh;
  const lz = sun.z / lh;
  const rise = sun.y / lh;
  const DIRS = 8;
  const dirs = Array.from({ length: DIRS }, (_, k) => [Math.cos((k / DIRS) * Math.PI * 2), Math.sin((k / DIRS) * Math.PI * 2)]);
  const RADII = [5, 12, 26, 50, 90];
  const hx = Math.ceil(nx / 2) + 1;
  const hz = Math.ceil(nz / 2) + 1;
  const shadowHalf = new Float32Array(hx * hz);
  const aoHalf = new Float32Array(hx * hz);
  for (let jj = 0; jj < hz; jj++) {
    const j = Math.min(nz, jj * 2);
    const z = zAt(j);
    for (let ii = 0; ii < hx; ii++) {
      const i = Math.min(nx, ii * 2);
      const x = xAt(i);
      const h = Math.max(H[j * (nx + 1) + i], 0) + 0.3;
      // soft shadow: smallest clearance angle along the ray toward the sun
      let vis = 1;
      for (let t = 2; t < 700; t *= 1.09) {
        const d = h + rise * t - sample(x + lx * t, z + lz * t);
        vis = Math.min(vis, (10 * d) / t);
        if (vis <= 0) break;
        t += 1.5;
      }
      shadowHalf[jj * hx + ii] = Math.max(0, Math.min(1, vis));
      // ambient occlusion: average horizon elevation around the point
      let occ = 0;
      for (const [dx, dz] of dirs) {
        let maxSin = 0;
        for (const r of RADII) {
          const e = sample(x + dx * r, z + dz * r) - h;
          if (e > 0) maxSin = Math.max(maxSin, e / Math.hypot(e, r));
        }
        occ += maxSin;
      }
      aoHalf[jj * hx + ii] = 1 - Math.min(0.85, (occ / DIRS) * 1.15);
    }
  }
  const light = new Float32Array((nx + 1) * (nz + 1) * 2);
  for (let j = 0; j <= nz; j++) {
    const fj = j / 2;
    const j0 = Math.min(hz - 2, Math.floor(fj));
    const v = fj - j0;
    for (let i = 0; i <= nx; i++) {
      const fi = i / 2;
      const i0 = Math.min(hx - 2, Math.floor(fi));
      const u = fi - i0;
      const k00 = j0 * hx + i0;
      const k10 = k00 + 1;
      const k01 = k00 + hx;
      const k11 = k01 + 1;
      const bil = (A: Float32Array) => (A[k00] * (1 - u) + A[k10] * u) * (1 - v) + (A[k01] * (1 - u) + A[k11] * u) * v;
      const k = (j * (nx + 1) + i) * 2;
      light[k] = bil(aoHalf);
      light[k + 1] = bil(shadowHalf);
    }
  }
  return light;
}

export type TerrainArrays = {
  pos: Float32Array;
  light: Float32Array;
  index: Uint32Array;
  profile: Float32Array;
  heights: Uint16Array;
  tw: number;
  th: number;
  bounds: [number, number, number, number];
};

/** Heavy CPU work (heights, baked light, ocean depth map). Runs in a Web Worker in the app. */
export function computeTerrain(sun: { x: number; y: number; z: number }): TerrainArrays {
  const nx = TERRAIN_NX;
  const nz = TERRAIN_NZ;
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
  const H = new Float32Array((nx + 1) * (nz + 1));
  const profile = new Float32Array(nx + 1);
  for (let j = 0; j <= nz; j++) {
    const z = zAt(j);
    for (let i = 0; i <= nx; i++) {
      const x = xAt(i);
      const h = heightAt(x, z);
      const k = j * (nx + 1) + i;
      pos[k * 3] = x;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = z;
      H[k] = h;
      if (j === 0) profile[i] = h;
    }
  }
  const index = new Uint32Array(nx * nz * 6);
  let p = 0;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + 1;
      const c = a + nx + 1;
      const d = c + 1;
      // rows go toward -z, so wind to face +y
      index[p++] = a; index[p++] = b; index[p++] = c;
      index[p++] = b; index[p++] = d; index[p++] = c;
    }
  }
  const light = bakeLight(H, nx, nz, sun);
  // Height map for the ocean shader (water depth -> color, foam).
  const tw = 384;
  const th = 192;
  const bounds: [number, number, number, number] = [-900, 700, -1400, 0]; // xmin, xmax, zmin, zmax
  const heights = new Uint16Array(tw * th);
  for (let j = 0; j < th; j++) {
    const z = bounds[2] + ((bounds[3] - bounds[2]) * j) / (th - 1);
    for (let i = 0; i < tw; i++) {
      const x = bounds[0] + ((bounds[1] - bounds[0]) * i) / (tw - 1);
      heights[j * tw + i] = THREE.DataUtils.toHalfFloat(heightAt(x, z));
    }
  }
  return { pos, light, index, profile, heights, tw, th, bounds };
}

export function buildTerrain(sunDir: THREE.Vector3, data: TerrainArrays = computeTerrain(sunDir)): TerrainData {
  const { pos, light, index, profile, heights, tw, th } = data;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aLight', new THREE.BufferAttribute(light, 2));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const bounds = new THREE.Vector4(...data.bounds);
  const heightTex = new THREE.DataTexture(heights, tw, th, THREE.RedFormat, THREE.HalfFloatType);
  heightTex.magFilter = THREE.LinearFilter;
  heightTex.minFilter = THREE.LinearFilter;
  heightTex.needsUpdate = true;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: sunDir },
      uSkySun: { value: new THREE.Vector3() },
      uBathy: { value: 0 },
      uTopo: { value: 0 },
      uCamPos: { value: new THREE.Vector3() },
      uVolc: { value: VOLCANOES.slice(0, 4).map((v) => new THREE.Vector3(v.x, v.z, v.r)) },
      uErupt: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute vec2 aLight;
      varying vec3 vPos; varying vec3 vNormal; varying vec2 vLight;
      void main(){
        vPos = position; vNormal = normal; vLight = aLight;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      ${NOISE}
      ${NOISE_D}
      ${ATMOS}
      uniform vec3 uSun; uniform vec3 uSkySun; uniform vec3 uCamPos;
      uniform float uBathy; uniform float uTopo; uniform vec3 uVolc[4]; uniform float uErupt;
      varying vec3 vPos; varying vec3 vNormal; varying vec2 vLight;
      vec3 lin(vec3 c){ return c * c; }
      vec3 ramp5(float t, vec3 a, vec3 b, vec3 c, vec3 d, vec3 e){
        t = clamp(t, 0., 1.) * 4.;
        if (t < 1.) return mix(a, b, t);
        if (t < 2.) return mix(b, c, t - 1.);
        if (t < 3.) return mix(c, d, t - 2.);
        return mix(d, e, t - 3.);
      }
      // perturbs a normal with derivative noise; fades with distance to avoid shimmer
      vec3 detailNormal(vec3 n, vec2 q, float scale, float strength, float fade){
        vec2 g = vec2(0.);
        float a = 1.;
        vec2 p = q * scale;
        for (int i = 0; i < 3; i++){
          g += noised(p).yz * a * scale;
          p = ROT * p; a *= .5; scale *= 2.;
        }
        return normalize(n - vec3(g.x, 0., g.y) * strength * fade);
      }
      void main(){
        vec3 n0 = normalize(vNormal);
        float h = vPos.y;
        vec2 q = vPos.xz;
        float dist = length(vPos - uCamPos);
        float fade = 1. - smoothstep(250., 1600., dist);
        float slope = 1. - n0.y;
        float nz = fbm3(q * .05);
        float nzF = fbm3(q * .4);

        // ---------- materials (albedo, linear) ----------
        float cliff = smoothstep(.3, .55, slope + (nz - .5) * .2);
        float strata = .5 + .5 * sin(h * 1.7 + nzF * 3. + nz * 6.);
        vec3 rockA = mix(lin(vec3(.33, .29, .26)), lin(vec3(.42, .36, .3)), strata);
        vec3 rockB = lin(vec3(.27, .25, .24));
        vec3 rock = mix(rockB, rockA, smoothstep(.3, .7, nzF)) * (.8 + .4 * nz);
        vec3 scree = lin(vec3(.42, .37, .32)) * (.85 + .3 * nzF);
        float forestN = fbm3(q * .12 + 7.);
        vec3 forest = lin(vec3(.1, .17, .08)) * (.6 + .5 * nzF);
        // lowland grassland: muted, patchy mix of green and sun-dried grass
        float patchN = fbm3(q * .012 + 3.);
        vec3 meadow = mix(lin(vec3(.3, .36, .17)), lin(vec3(.48, .44, .27)), smoothstep(.35, .65, patchN)) * (.85 + .3 * nzF);
        vec3 dry = mix(lin(vec3(.47, .38, .26)), lin(vec3(.38, .3, .21)), nzF);
        vec3 sand = lin(vec3(.76, .69, .55));
        vec3 wetSand = lin(vec3(.45, .4, .31));
        vec3 snow = lin(vec3(.95, .96, .98));
        vec3 ash = lin(vec3(.2, .19, .19)) * (.8 + .4 * nzF);

        vec3 alb;
        float rough = 1.;
        float detailK = .5;
        if (h < -.15) {
          alb = mix(wetSand, lin(vec3(.13, .14, .14)), smoothstep(-1., -16., h));
        } else {
          float veg = smoothstep(.5, 2., h) * (1. - smoothstep(18., 36., h + nz * 14.));
          vec3 green = mix(meadow, forest, smoothstep(.4, .7, forestN) * .85);
          alb = mix(mix(sand, wetSand, 1. - smoothstep(.0, .35, h)), green, veg);
          alb = mix(alb, dry, smoothstep(14., 32., h + nz * 12.) * (1. - veg * .5));
          alb = mix(alb, scree, smoothstep(.18, .32, slope) * smoothstep(4., 14., h));
          alb = mix(alb, rock, cliff * smoothstep(2., 10., h));
          alb = mix(alb, rock * .85, smoothstep(34., 48., h) * .8);
          // volcanic ash and dark lava rock around arc volcanoes
          for (int i = 0; i < 4; i++){
            float d = length(q - uVolc[i].xy) / uVolc[i].z;
            alb = mix(alb, ash, (1. - smoothstep(.5, 1.1, d)) * .9);
          }
          // snow: above the snow line, on gentle slopes, thicker on shaded aspects
          float aspect = dot(normalize(vec3(n0.x, 0., n0.z) + 1e-4), -uSun);
          float snowLine = 41. + nz * 10. - aspect * 5.;
          float snowK = smoothstep(snowLine, snowLine + 4., h) * (1. - smoothstep(.5, .78, slope + (nzF - .5) * .25));
          alb = mix(alb, snow, snowK);
          detailK = mix(mix(.35, .9, cliff), .15, snowK);
          rough = mix(1., .55, snowK);
        }

        // evidence overlays replace the albedo so colors stay readable under lighting
        if (uBathy > 0. && h < 0.) {
          float km = -h / 5.;
          vec3 b = ramp5(km / 8., vec3(.62,.9,.88), vec3(.24,.66,.8), vec3(.13,.4,.7), vec3(.12,.2,.52), vec3(.1,.06,.3));
          float c = abs(fract(km) - .5); float w = fwidth(km);
          b = mix(b * 1.25, b, smoothstep(.5 - w * 1.2, .5 - w * .2, .5 - c));
          alb = mix(alb, lin(b), uBathy);
        }
        if (uTopo > 0. && h > 0.) {
          float km = h / ${LAND_VE.toFixed(1)};
          vec3 t = ramp5(km / 6., vec3(.25,.48,.24), vec3(.66,.66,.32), vec3(.66,.44,.24), vec3(.48,.31,.24), vec3(.95,.94,.92));
          float c = abs(fract(km * 2.) - .5); float w = fwidth(km * 2.);
          t = mix(t * .55, t, smoothstep(.5 - w * 1.2, .5 - w * .2, .5 - c));
          alb = mix(alb, lin(t), uTopo);
        }

        // ---------- lighting (linear HDR) ----------
        vec3 n = detailNormal(n0, q, .08, detailK * 1.4, fade);
        float ao = vLight.x;
        float sh = vLight.y;
        float ndl = max(dot(n, uSun), 0.);
        // wrap a little light around terminators for softer, more natural relief
        float diff = max((dot(n, uSun) + .12) / 1.12, 0.) * sh;
        vec3 sunCol = vec3(1., .86, .68) * 3.4;
        vec3 skyCol = vec3(.42, .58, .95) * .5;
        vec3 bounce = vec3(.3, .25, .18) * .22;
        vec3 amb = mix(bounce, skyCol, n.y * .5 + .5) * ao;
        vec3 col = alb * (sunCol * diff + amb);
        // glancing sheen on snow and wet sand
        vec3 V = normalize(uCamPos - vPos);
        vec3 Hh = normalize(V + uSun);
        float spec = pow(max(dot(n, Hh), 0.), mix(16., 60., 1. - rough)) * (1. - rough) * sh;
        col += sunCol * spec * .25 * ndl;

        // lava on the upper flanks of the main volcano, brighter during eruption pulses
        if (uErupt > 0.) {
          vec2 dv = q - uVolc[0].xy;
          float dn = length(dv) / uVolc[0].z;
          float ang = atan(dv.y, dv.x);
          float ch = smoothstep(.82, .97, sin(ang * 4. + fbm3(q * .25) * 3.));
          float lava = ch * (1. - smoothstep(.12, .48 + .1 * uErupt, dn)) * smoothstep(.04, .12, dn);
          vec3 hot = mix(vec3(1.6, .25, .03), vec3(5., 1.6, .3), vnoise(q * 1.4 + uErupt));
          col = mix(col, hot * (.6 + 1.2 * uErupt), lava * (.4 + .6 * uErupt));
        }

        col = aerial(col, vPos, uCamPos, uSkySun);
        gl_FragColor = vec4(col, 1.);
      }`,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  return { mesh, material, profile, heightTex, heightTexBounds: bounds };
}
