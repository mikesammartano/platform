import * as THREE from 'three';
import { LAND_VE, VE, VOLCANO, X_MAX, X_MIN, Z_FAR, seafloorAnalytic } from './model';
import { ATMOS, NOISE, NOISE_D } from './glsl';
import { detailTex } from './textures';

/**
 * Real landscape: the central Andes north of a cut at 23.4 S (through Lascar volcano), from
 * public/geo (built by scripts/geodata/build.py from Terrarium elevation and the Sentinel-2 120 m mosaic).
 *
 * Three grids in scene space (km, sinusoidal projection centred on the trench at the cut):
 *   MID   sharpest, the margin around the cut
 *   NEAR  detailed, the part the camera sees up close
 *   FAR   the whole continent out to the horizon
 * Rows run south -> north (row 0 at the cut), so v = (z - z0) / (z1 - z0) for every texture.
 */
export type Box = { x0: number; x1: number; z0: number; z1: number };
export const NEAR_BOX: Box = { x0: -650, x1: 1100, z0: 0, z1: -1750 };
export const FAR_BOX: Box = { x0: -1600, x1: 2600, z0: 0, z1: Z_FAR };
/** Sharpest tier around the cut: trench to Puna, first 800 km of coast. */
export const MID_BOX: Box = { x0: -150, x1: 650, z0: 0, z1: -800 };
export type Grid = Box & { n: number; y: Float32Array };

const GEO_URL = (f: string) => `${import.meta.env.BASE_URL}geo/${f}`;

let mid: Grid | null = null;
let near: Grid | null = null;
let far: Grid | null = null;
export function setGeo(m: Grid, n: Grid, f: Grid) {
  mid = m;
  near = n;
  far = f;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function sample(g: Grid, x: number, z: number) {
  const n = g.n;
  const fi = Math.min(n - 1.001, Math.max(0, ((x - g.x0) / (g.x1 - g.x0)) * n - 0.5));
  const fj = Math.min(n - 1.001, Math.max(0, ((z - g.z0) / (g.z1 - g.z0)) * n - 0.5));
  const i = Math.floor(fi);
  const j = Math.floor(fj);
  const u = fi - i;
  const v = fj - j;
  const k = j * n + i;
  const y = g.y;
  return (y[k] * (1 - u) + y[k + 1] * u) * (1 - v) + (y[k + n] * (1 - u) + y[k + n + 1] * u) * v;
}

/** 0 outside the box, 1 more than `edge` km inside it. The cut (z0) is the edge of all data, so it never fades. */
function boxWeight(b: Box, x: number, z: number, edge: number) {
  if (z > b.z0 + 1e-6) return 0;
  return smooth(0, edge, Math.min(x - b.x0, b.x1 - x, z - b.z1));
}

/** Scene height (display units: ocean depth x VE, land x LAND_VE) of the real surface. */
function realY(x: number, z: number) {
  const f = far && boxWeight(far, x, z, 1e-3) > 0 ? sample(far, x, z) : -4.2 * VE;
  if (!near || !mid) return f;
  const w = boxWeight(near, x, z, 40);
  const y = w > 0 ? f + (sample(near, x, z) - f) * w : f;
  const wm = boxWeight(mid, x, z, 25);
  return wm > 0 ? y + (sample(mid, x, z) - y) * wm : y;
}

/** Surface height. At the cut, the seafloor follows the section's plate model so the two meet exactly. */
export function heightAt(x: number, z: number) {
  const y = realY(x, z);
  const w = (1 - smooth(0, 50, -z)) * (1 - smooth(-10, 15, x));
  return w > 0 ? y + (seafloorAnalytic(x) - y) * w : y;
}

const toY = (m: number) => (m > 0 ? (m / 1000) * LAND_VE : (m / 1000) * VE);

// ---------- Mesh ----------
/** Column positions: 1.3 km spacing across the margin, coarser toward the far ocean and the continental interior. */
export const XS = (() => {
  const xs: number[] = [];
  let x = FAR_BOX.x0;
  while (x < FAR_BOX.x1) {
    xs.push(x);
    const d = x < -250 ? -250 - x : x > 950 ? x - 950 : 0;
    x += Math.min(9, 1.3 + d * 0.02);
  }
  xs.push(FAR_BOX.x1);
  return Float32Array.from(xs);
})();
export const TERRAIN_NZ = 700;
/** Row spacing grows with distance (z = Z_FAR * (j/NZ)^Z_POW): fine near the cut, coarse at the horizon. */
export const Z_POW = 2.1;
export const zAt = (j: number) => Z_FAR * Math.pow(j / TERRAIN_NZ, Z_POW);
/** Samples of the surface along the cut, evenly spaced over the section (X_MIN..X_MAX). */
export const PROFILE_N = 2800;

export type TerrainArrays = {
  pos: Float32Array;
  index: Uint32Array;
  profile: Float32Array;
  midY: Float32Array;
  nearY: Float32Array;
  farY: Float32Array;
  /** RGBA8 per grid texel: normal x, normal z, sky visibility (AO), sun visibility (soft shadow). MID has normals only. */
  midNL: Uint8Array;
  nearNL: Uint8Array;
  farNL: Uint8Array;
  midN: number;
  nearN: number;
  farN: number;
};

async function decodeDem(url: string, box: Box): Promise<Grid> {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const n = bmp.width;
  const cv = new OffscreenCanvas(n, n);
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  const px = ctx.getImageData(0, 0, n, n).data;
  const y = new Float32Array(n * n);
  // image rows run north -> south; grids run south -> north
  for (let r = 0; r < n; r++) {
    const src = (n - 1 - r) * n * 4;
    for (let c = 0; c < n; c++) {
      const k = src + c * 4;
      y[r * n + c] = toY(px[k] * 256 + px[k + 1] + px[k + 2] / 256 - 32768);
    }
  }
  return { ...box, n, y };
}

/**
 * Normals, sky visibility and soft sun shadows for one grid. Light is baked at half resolution
 * (rays march over the grid toward the sun and around the horizon) and upsampled.
 */
function bakeNormalLight(g: Grid, sun: { x: number; y: number; z: number }, light = true) {
  const n = g.n;
  const dx = (g.x1 - g.x0) / n;
  const dz = (g.z1 - g.z0) / n;
  const out = new Uint8Array(n * n * 4);
  const Y = g.y;
  for (let r = 0; r < n; r++) {
    const r0 = Math.max(0, r - 1);
    const r1 = Math.min(n - 1, r + 1);
    for (let c = 0; c < n; c++) {
      const c0 = Math.max(0, c - 1);
      const c1 = Math.min(n - 1, c + 1);
      const gx = (Y[r * n + c1] - Y[r * n + c0]) / ((c1 - c0) * dx);
      const gz = (Y[r1 * n + c] - Y[r0 * n + c]) / ((r1 - r0) * dz);
      const l = 1 / Math.hypot(gx, 1, gz);
      const k = (r * n + c) * 4;
      out[k] = Math.round((-gx * l * 0.5 + 0.5) * 255);
      out[k + 1] = Math.round((-gz * l * 0.5 + 0.5) * 255);
    }
  }
  if (!light) return out;
  const h = n >> 1;
  const sh = new Float32Array(h * h);
  const ao = new Float32Array(h * h);
  const lh = Math.hypot(sun.x, sun.z);
  const lx = sun.x / lh;
  const lz = sun.z / lh;
  const rise = sun.y / lh;
  const DIRS = 8;
  const dirs = Array.from({ length: DIRS }, (_, k) => [Math.cos((k / DIRS) * Math.PI * 2), Math.sin((k / DIRS) * Math.PI * 2)]);
  const RADII = [4, 10, 24, 55];
  const at = (x: number, z: number) => Math.max(0, sample(g, x, z));
  for (let r = 0; r < h; r++) {
    const z = g.z0 + (g.z1 - g.z0) * ((r + 0.5) / h);
    for (let c = 0; c < h; c++) {
      const x = g.x0 + (g.x1 - g.x0) * ((c + 0.5) / h);
      const y0 = sample(g, x, z);
      if (y0 < -3) {
        sh[r * h + c] = 1;
        ao[r * h + c] = 1;
        continue;
      }
      const y = Math.max(y0, 0) + 0.3;
      let vis = 1;
      for (let t = 2; t < 600; t = t * 1.12 + 1) {
        const d = y + rise * t - at(x + lx * t, z + lz * t);
        vis = Math.min(vis, (10 * d) / t);
        if (vis <= 0) break;
      }
      sh[r * h + c] = Math.max(0, Math.min(1, vis));
      let occ = 0;
      for (const [ddx, ddz] of dirs) {
        let m = 0;
        for (const rr of RADII) {
          const e = at(x + ddx * rr, z + ddz * rr) - y;
          if (e > 0) m = Math.max(m, e / Math.hypot(e, rr));
        }
        occ += m;
      }
      ao[r * h + c] = 1 - Math.min(0.85, (occ / DIRS) * 1.15);
    }
  }
  for (let r = 0; r < n; r++) {
    const fr = Math.min(h - 1.001, Math.max(0, (r + 0.5) / 2 - 0.5));
    const r0 = Math.floor(fr);
    const v = fr - r0;
    for (let c = 0; c < n; c++) {
      const fc = Math.min(h - 1.001, Math.max(0, (c + 0.5) / 2 - 0.5));
      const c0 = Math.floor(fc);
      const u = fc - c0;
      const k0 = r0 * h + c0;
      const bil = (A: Float32Array) => (A[k0] * (1 - u) + A[k0 + 1] * u) * (1 - v) + (A[k0 + h] * (1 - u) + A[k0 + h + 1] * u) * v;
      const k = (r * n + c) * 4;
      out[k + 2] = Math.round(bil(ao) * 255);
      out[k + 3] = Math.round(bil(sh) * 255);
    }
  }
  return out;
}

/** Heavy CPU work (decode elevation, mesh, light). Runs in a Web Worker in the app. */
export async function computeTerrain(sun: { x: number; y: number; z: number }): Promise<TerrainArrays> {
  const [m, n, f] = await Promise.all([
    decodeDem(GEO_URL('mid_dem.webp'), MID_BOX), decodeDem(GEO_URL('near_dem.webp'), NEAR_BOX), decodeDem(GEO_URL('far_dem.webp'), FAR_BOX),
  ]);
  setGeo(m, n, f);
  const nx = XS.length - 1;
  const nz = TERRAIN_NZ;
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
  for (let j = 0; j <= nz; j++) {
    const z = zAt(j);
    for (let i = 0; i <= nx; i++) {
      const k = (j * (nx + 1) + i) * 3;
      pos[k] = XS[i];
      pos[k + 1] = heightAt(XS[i], z);
      pos[k + 2] = z;
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
  const profile = new Float32Array(PROFILE_N + 1);
  for (let i = 0; i <= PROFILE_N; i++) profile[i] = heightAt(X_MIN + ((X_MAX - X_MIN) * i) / PROFILE_N, 0);
  return {
    pos, index, profile, midY: m.y, nearY: n.y, farY: f.y, midN: m.n, nearN: n.n, farN: f.n,
    midNL: bakeNormalLight(m, sun, false), nearNL: bakeNormalLight(n, sun), farNL: bakeNormalLight(f, sun),
  };
}

export type TerrainData = {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  /** Heights along the cut (z = 0), PROFILE_N + 1 samples evenly spaced from X_MIN to X_MAX. */
  profile: Float32Array;
  heightTex: THREE.DataTexture;
  heightTexBounds: THREE.Vector4;
};

const boxVec = (b: Box) => new THREE.Vector4(b.x0, b.x1, b.z0, b.z1);

function dataTex(data: Uint8Array, n: number) {
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Satellite colour (sRGB, decoded to linear albedo by the GPU). Shows flat grey until loaded. */
function colorTex(file: string, renderer?: THREE.WebGLRenderer, onLoad?: () => void) {
  const t = new THREE.TextureLoader().load(GEO_URL(file), onLoad);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 8;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Makes heightAt use the grids in a worker result (call before anything samples the landscape). */
export function adoptTerrain(data: TerrainArrays) {
  setGeo({ ...MID_BOX, n: data.midN, y: data.midY }, { ...NEAR_BOX, n: data.nearN, y: data.nearY }, { ...FAR_BOX, n: data.farN, y: data.farY });
}

export function buildTerrain(sunDir: THREE.Vector3, data: TerrainArrays, renderer?: THREE.WebGLRenderer, onLoad?: () => void): TerrainData {
  adoptTerrain(data);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(data.pos, 3));
  geo.setIndex(new THREE.BufferAttribute(data.index, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  // ocean floor depth for the sea surface shader (shallows, foam), over the detailed region
  const n = data.nearN;
  const half = new Uint16Array(n * n);
  for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data.nearY[i]);
  const heightTex = new THREE.DataTexture(half, n, n, THREE.RedFormat, THREE.HalfFloatType);
  heightTex.magFilter = THREE.LinearFilter;
  heightTex.minFilter = THREE.LinearFilter;
  heightTex.needsUpdate = true;

  let pending = 3;
  const loaded = () => {
    if (--pending === 0) onLoad?.();
  };
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: sunDir },
      uSkySun: { value: new THREE.Vector3() },
      uBathy: { value: 0 },
      uTopo: { value: 0 },
      uCamPos: { value: new THREE.Vector3() },
      uVolc: { value: new THREE.Vector3(VOLCANO.x, VOLCANO.z, VOLCANO.radius) },
      uErupt: { value: 0 },
      uTime: { value: 0 },
      uMidC: { value: colorTex('mid_color.webp', renderer, loaded) },
      uNearC: { value: colorTex('near_color.webp', renderer, loaded) },
      uFarC: { value: colorTex('far_color.webp', renderer, loaded) },
      uMidN: { value: dataTex(data.midNL, data.midN) },
      uNearN: { value: dataTex(data.nearNL, data.nearN) },
      uFarN: { value: dataTex(data.farNL, data.farN) },
      uRockN: { value: detailTex('rock_rough_normal.webp') },
      uMidB: { value: boxVec(MID_BOX) },
      uNearB: { value: boxVec(NEAR_BOX) },
      uFarB: { value: boxVec(FAR_BOX) },
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
      ${NOISE_D}
      ${ATMOS}
      uniform vec3 uSun; uniform vec3 uSkySun; uniform vec3 uCamPos;
      uniform float uBathy; uniform float uTopo; uniform vec3 uVolc; uniform float uErupt; uniform float uTime;
      uniform sampler2D uMidC, uNearC, uFarC, uMidN, uNearN, uFarN, uRockN; uniform vec4 uMidB, uNearB, uFarB;
      varying vec3 vPos; varying vec3 vNormal;
      vec3 lin(vec3 c){ return c * c; }
      vec3 ramp5(float t, vec3 a, vec3 b, vec3 c, vec3 d, vec3 e){
        t = clamp(t, 0., 1.) * 4.;
        if (t < 1.) return mix(a, b, t);
        if (t < 2.) return mix(b, c, t - 1.);
        if (t < 3.) return mix(c, d, t - 2.);
        return mix(d, e, t - 3.);
      }
      vec2 boxUv(vec4 b, vec2 q){ return vec2((q.x - b.x) / (b.y - b.x), (q.y - b.z) / (b.w - b.z)); }
      // fades toward the side and far edges of a box; the cut (v = 0) is where every dataset starts
      float boxW(vec2 uv, float e){ return smoothstep(0., e, min(min(uv.x, 1. - uv.x), 1. - uv.y)) * step(-1e-4, uv.y); }
      void main(){
        float h = vPos.y;
        vec2 q = vPos.xz;
        float dist = length(vPos - uCamPos);
        float fade = 1. - smoothstep(60., 700., dist);

        // ---------- real surface: satellite albedo, elevation normals, baked sky and sun visibility ----------
        vec2 uvN = boxUv(uNearB, q);
        vec2 uvF = boxUv(uFarB, q);
        float wN = boxW(uvN, .025);
        vec2 uvM = boxUv(uMidB, q);
        float wM = boxW(uvM, .03);
        vec3 alb = mix(mix(texture2D(uFarC, uvF).rgb, texture2D(uNearC, uvN).rgb, wN), texture2D(uMidC, uvM).rgb, wM);
        vec4 nl = mix(texture2D(uFarN, uvF), texture2D(uNearN, uvN), wN);
        nl.rg = mix(nl.rg, texture2D(uMidN, uvM).rg, wM);
        vec2 nxz = nl.rg * 2. - 1.;
        vec3 n = normalize(vec3(nxz.x, sqrt(max(.04, 1. - dot(nxz, nxz))), nxz.y));
        float ao = nl.b;
        float sh = nl.a;
        float snowK = smoothstep(.45, .7, min(alb.r, min(alb.g, alb.b))) * step(30., h);

        // close up: fine relief and grain below the data resolution
        // rough rock relief from a tileable CC0 normal map at two scales (sampled outside the branch)
        vec2 r1 = texture2D(uRockN, q * .33).xy * 2. - 1.;
        vec2 r2 = texture2D(uRockN, ROT * q * 1.37 + .5).xy * 2. - 1.;
        if (fade > 0.) {
          vec2 g = r1 + r2 * .55;
          float slope = 1. - n.y;
          n = normalize(n + vec3(g.x, 0., -g.y) * (.06 + .4 * slope) * (1. - snowK * .7) * fade);
          alb *= 1. + (fbm3(q * 2.3) - .5) * .35 * fade;
        }
        if (h < -.15) alb = mix(alb, lin(vec3(.13, .14, .14)), smoothstep(-2., -16., h));

        // evidence overlays replace the albedo so colors stay readable under lighting
        if (uBathy > 0. && h < 0.) {
          float km = -h / ${VE.toFixed(1)};
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
        float cloud = smoothstep(.52, .74, fbm5(q * .0016 + uTime * vec2(.0045, .0016)));
        sh *= 1. - .62 * cloud;
        float diff = max((dot(n, uSun) + .1) / 1.1, 0.) * sh;
        vec3 sunCol = vec3(1., .88, .72) * 3.3;
        vec3 skyCol = vec3(.42, .58, .95) * .55;
        vec3 bounce = vec3(.32, .26, .19) * .24;
        vec3 amb = mix(bounce, skyCol, n.y * .5 + .5) * ao;
        vec3 col = alb * (sunCol * diff + amb);
        // glancing sheen on snow and salt flats
        vec3 V = normalize(uCamPos - vPos);
        vec3 Hh = normalize(V + uSun);
        float rough = mix(1., .5, snowK);
        col += sunCol * pow(max(dot(n, Hh), 0.), mix(16., 60., 1. - rough)) * (1. - rough) * sh * .25 * max(dot(n, uSun), 0.);

        // lava on the upper flanks of the arc volcano, brighter during eruption pulses
        if (uErupt > 0.) {
          vec2 dv = q - uVolc.xy;
          float dn = length(dv) / uVolc.z;
          float ang = atan(dv.y, dv.x);
          float ch = smoothstep(.82, .97, sin(ang * 4. + fbm3(q * .6) * 3.));
          float lava = ch * (1. - smoothstep(.12, .48 + .1 * uErupt, dn)) * smoothstep(.04, .12, dn);
          vec3 hot = mix(vec3(1.6, .25, .03), vec3(5., 1.6, .3), vnoise(q * 3. + uErupt));
          col = mix(col, hot * (.6 + 1.2 * uErupt), lava * (.4 + .6 * uErupt));
        }

        col = aerial(col, vPos, uCamPos, uSkySun);
        gl_FragColor = vec4(col, 1.);
      }`,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  return { mesh, material, profile: data.profile, heightTex, heightTexBounds: boxVec(NEAR_BOX) };
}
