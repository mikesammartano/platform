import * as THREE from 'three';
import {
  ARC_X, CHAMBER, CYCLE, HYPOCENTER, MELT, SLAB, VOLCANO, buildQuakeCatalog, cycleAt, labY, prng, slabCoords, slabPoint,
  slabTangent, slabTopY,
} from './model';
import { heightAt } from './terrain';
import { detailTex } from './textures';
import { KEY_DIR } from './environment';
import { NOISE } from './glsl';

/** Shared depth palette (also used by the on-screen legend). Shallow -> deep. */
export const DEPTH_STOPS = ['#F2C94C', '#E8833A', '#D4473A', '#9E2F68'];
const FACE_Z = 0.8;

// ---------------------------------------------------------------- earthquakes
export function buildQuakes() {
  const cat = buildQuakeCatalog();
  const n = cat.length;
  const pos = new Float32Array(n * 3);
  const depth = new Float32Array(n);
  const mag = new Float32Array(n);
  const period = new Float32Array(n);
  const phase = new Float32Array(n);
  const kind = new Float32Array(n);
  const dist = new Float32Array(n);
  cat.forEach((q, i) => {
    kind[i] = q.kind === 'interface' ? 0 : 1;
    dist[i] = Math.hypot(q.x - HYPOCENTER.x, q.y - HYPOCENTER.y);
    pos.set([q.x, q.y, FACE_Z], i * 3);
    depth[i] = Math.min(1, q.depthKm / 300);
    mag[i] = q.mag;
    period[i] = q.period;
    phase[i] = q.phase;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
  geo.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
  geo.setAttribute('aPeriod', new THREE.BufferAttribute(period, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  geo.setAttribute('aDist', new THREE.BufferAttribute(dist, 1));
  const stops = DEPTH_STOPS.map((c) => new THREE.Color(c));
  const uniforms = {
    uTime: { value: 0 },
    uSince: { value: 99 },
    uPx: { value: 1 },
    uOpacity: { value: 1 },
    uDepthColor: { value: 0 },
    uFlash: { value: 1 },
    uStops: { value: stops },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute float aDepth, aMag, aPeriod, aPhase, aKind, aDist;
      uniform float uTime, uSince, uPx, uDepthColor; uniform vec3 uStops[4];
      varying vec3 vCol; varying float vT; varying float vCore;
      vec3 ramp(float t){ t = clamp(t, 0., 1.) * 3.; if (t < 1.) return mix(uStops[0], uStops[1], t); if (t < 2.) return mix(uStops[1], uStops[2], t - 1.); return mix(uStops[2], uStops[3], t - 2.); }
      void main(){
        vCol = mix(vec3(.96, .22, .1), ramp(aDepth), uDepthColor);
        vT = fract(uTime / aPeriod + aPhase);
        if (aKind < .5) {
          // interface events: quiet while the fault is locked, a burst of aftershocks after the great earthquake
          float after = 1. - smoothstep(0., 14., uSince);
          vT = fract(uTime / (aPeriod * mix(2.2, .3, after)) + aPhase);
          float arrive = uSince - aDist / 160.;
          if (arrive > 0. && arrive < .8) vT = arrive * .12;
        }
        float core = 2.8 + (aMag - 3.) * 1.6;
        vCore = core;
        gl_PointSize = core * 3.2 * uPx;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uOpacity, uFlash;
      varying vec3 vCol; varying float vT; varying float vCore;
      void main(){
        float r = length(gl_PointCoord - .5) * 2.;
        float coreR = 1. / 3.2;
        float aa = 2. / (vCore * 3.2);
        float dot = 1. - smoothstep(coreR - aa, coreR + aa, r);
        float flash = uFlash * (1. - smoothstep(0., .1, vT));
        float ringR = coreR + vT * 7.;
        float ring = flash * (1. - smoothstep(.0, aa * 2.5, abs(r - ringR))) * .9;
        float glow = flash * (1. - smoothstep(coreR, 1., r)) * .6;
        vec3 c = mix(vCol, vec3(1.), flash * .6 * dot);
        float a = max(max(dot * (.82 + .18 * flash), ring), glow);
        if (a < .01) discard;
        // HDR: a flash is bright enough to bloom
        gl_FragColor = vec4(c * (1. + flash * 3.5), a * uOpacity);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.renderOrder = 5;
  points.frustumCulled = false;
  return { points, uniforms };
}

// ---------------------------------------------------------------- soft particles (magma, water, mantle flow)
function softPoints(count: number, color: THREE.Color, renderOrder: number) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const alpha = new Float32Array(count);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  const uniforms = { uPx: { value: 1 }, uOpacity: { value: 1 }, uColor: { value: color }, uHot: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute float aSize, aAlpha; uniform float uPx; varying float vA;
      void main(){ vA = aAlpha; gl_PointSize = aSize * uPx; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uColor; uniform float uOpacity, uHot; varying float vA;
      void main(){
        float r = length(gl_PointCoord - .5) * 2.;
        float a = 1. - smoothstep(.35, 1., r);
        vec3 c = mix(uColor, vec3(1., .7, .35) * 3., uHot * (1. - smoothstep(0., .5, r)));
        gl_FragColor = vec4(c, a * vA * uOpacity);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.renderOrder = renderOrder;
  points.frustumCulled = false;
  return { points, uniforms, pos, size, alpha, geo };
}

/** Separate magma bodies rising from the melt region to crustal storage. */
export function buildMagma() {
  const N = 9;
  const sp = softPoints(N, new THREE.Color('#E0601E'), 4);
  sp.uniforms.uHot.value = 0.6;
  const r = prng(5);
  // bodies rise as one batch per cycle, so each arrival at the chamber lines up with an eruption pulse
  const seeds = Array.from({ length: N }, (_, i) => ({ off: (i / N) * 0.13, dx: (r() - 0.5) * 34, wob: r() * 6.28, size: 0.7 + r() * 0.55 }));
  const startY = MELT.y + 4;
  const endY = CHAMBER.y - CHAMBER.ry * 0.6;
  const update = (t: number, px: number) => {
    seeds.forEach((sd, i) => {
      const life = (t / CYCLE.magmaRise + sd.off) % 1;
      const y = startY + (endY - startY) * life;
      const x = MELT.x + sd.dx * (1 - life) + (CHAMBER.x - MELT.x) * life + Math.sin(t * 0.6 + sd.wob) * 1.5;
      sp.pos.set([x, y, FACE_Z - 0.2], i * 3);
      // bodies pass through the lithosphere slowly and shrink as they cool and crystallize
      sp.size[i] = (16 + 10 * Math.sin(Math.PI * Math.min(1, life * 1.4))) * sd.size;
      sp.alpha[i] = Math.min(1, life * 6) * (1 - Math.pow(life, 4)) * 0.85;
    });
    sp.uniforms.uPx.value = px;
    sp.geo.attributes.position.needsUpdate = true;
    sp.geo.attributes.aSize.needsUpdate = true;
    sp.geo.attributes.aAlpha.needsUpdate = true;
  };
  return { ...sp, update };
}

/** Water released from the sinking plate (dehydration) rising into the wedge. */
export function buildWater() {
  const N = 36;
  const sp = softPoints(N, new THREE.Color('#A9DCFF'), 4);
  const r = prng(11);
  const seeds = Array.from({ length: N }, () => ({ s: MELT.s - 70 + r() * 110, off: r(), speed: 0.7 + r() * 0.6 }));
  const update = (t: number, px: number) => {
    seeds.forEach((sd, i) => {
      const life = (t / 9 * sd.speed + sd.off) % 1;
      const base = slabPoint(sd.s, 0);
      const rise = life * 22;
      sp.pos.set([base.x - rise * 0.35, base.y + rise, FACE_Z - 0.1], i * 3);
      sp.size[i] = 7;
      sp.alpha[i] = Math.sin(Math.PI * life) * 0.9;
    });
    sp.uniforms.uPx.value = px;
    sp.geo.attributes.position.needsUpdate = true;
    sp.geo.attributes.aSize.needsUpdate = true;
    sp.geo.attributes.aAlpha.needsUpdate = true;
  };
  return { ...sp, update };
}

/** Slow solid-state mantle flow: corner flow in the wedge and drag beneath the slab. */
export function buildMantleFlow() {
  const N = 220;
  const TRAIL = 5;
  const sp = softPoints(N * TRAIL, new THREE.Color('#EBC9A3'), 3);
  const r = prng(23);
  type P = { x: number; y: number; age: number; life: number };
  const parts: P[] = [];
  const inWedge = (x: number, y: number) => slabCoords(x, y).n < -2 && y < labY(x) - 2 && x > 0;
  const inSub = (x: number, y: number) => slabCoords(x, y).n > SLAB.H + 3;
  const spawn = (): P => {
    for (let k = 0; k < 40; k++) {
      const x = -700 + r() * 1500;
      const y = -330 + r() * 260;
      if (inWedge(x, y) || inSub(x, y)) return { x, y, age: 0, life: 6 + r() * 8 };
    }
    return { x: 400, y: -200, age: 0, life: 5 };
  };
  for (let i = 0; i < N; i++) {
    const p = spawn();
    p.age = r() * p.life;
    parts.push(p);
  }
  const vel = (x: number, y: number) => {
    const { s, n } = slabCoords(x, y);
    const t = slabTangent(Math.max(s, 0));
    if (n < 0) {
      // wedge: material is pulled in from the continent side and dragged down along the slab
      const w = Math.exp(n / 30);
      return { x: -1 * (1 - w) + t.x * w, y: 0.15 * (1 - w) + t.y * w, k: 0.6 + 0.4 * w };
    }
    const w = Math.exp(-(n - SLAB.H) / 40);
    const ret = { x: 0.35, y: 0.08 };
    return { x: ret.x * (1 - w) + t.x * w, y: ret.y * (1 - w) + t.y * w, k: 0.35 + 0.65 * w };
  };
  const update = (dt: number, px: number) => {
    parts.forEach((p, i) => {
      if (dt > 0) {
        const v = vel(p.x, p.y);
        p.x += v.x * v.k * dt * 14;
        p.y += v.y * v.k * dt * 14;
        p.age += dt;
        if (p.age > p.life || !(inWedge(p.x, p.y) || inSub(p.x, p.y)) || p.y < -335) Object.assign(p, spawn());
      }
      const a = Math.sin(Math.PI * Math.min(1, p.age / p.life));
      const v = vel(p.x, p.y);
      // short comet trail behind each particle shows the direction of slow solid-state flow
      for (let k = 0; k < TRAIL; k++) {
        const j = i * TRAIL + k;
        sp.pos.set([p.x - v.x * k * 2.2, p.y - v.y * k * 2.2, FACE_Z - 0.3], j * 3);
        sp.size[j] = 6 - k * 0.8;
        sp.alpha[j] = a * 0.5 * (1 - k / TRAIL);
      }
    });
    sp.uniforms.uPx.value = px;
    sp.geo.attributes.position.needsUpdate = true;
    sp.geo.attributes.aSize.needsUpdate = true;
    sp.geo.attributes.aAlpha.needsUpdate = true;
  };
  return { ...sp, update };
}

// ---------------------------------------------------------------- volcanic plume
function smokeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const r = prng(3);
  for (let i = 0; i < 26; i++) {
    const x = 64 + (r() - 0.5) * 50;
    const y = 64 + (r() - 0.5) * 50;
    const rad = 16 + r() * 26;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, 'rgba(255,255,255,0.32)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Eruption column: billboarded puffs with a volumetric look. Each puff is shaded by a fake sphere normal
 * against the key light (bright sunlit side, dark ash core), and the base is lit orange by the vent.
 */
export function buildPlume() {
  const group = new THREE.Group();
  const tex = smokeTexture();
  const summitY = heightAt(VOLCANO.x, VOLCANO.z);
  const N = 56;
  const r = prng(41);
  const seeds = Array.from({ length: N }, (_, i) => ({ off: i / N + r() * 0.015, rot: r() * 6.28, spin: (r() - 0.5) * 0.6, seed: r() * 50, jx: r() - 0.5, jz: r() - 0.5 }));

  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  geo.setAttribute('uv', quad.getAttribute('uv'));
  const iPos = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
  const iData = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4); // size, alpha, rotation, seed
  const iHeat = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
  iPos.setUsage(THREE.DynamicDrawUsage);
  iData.setUsage(THREE.DynamicDrawUsage);
  iHeat.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', iPos);
  geo.setAttribute('iData', iData);
  geo.setAttribute('iHeat', iHeat);
  geo.instanceCount = N;
  const uniforms = { uKey: { value: KEY_DIR.clone() }, uOpacity: { value: 1 }, uCloud: { value: detailTex('cloud_puff.webp', { repeat: false }) } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute vec3 iPos; attribute vec4 iData; attribute float iHeat;
      varying vec2 vUv; varying float vAlpha; varying float vSeed; varying float vHeat; varying vec3 vKeyV;
      uniform vec3 uKey;
      void main(){
        float c = cos(iData.z), s = sin(iData.z);
        vec2 p = mat2(c, -s, s, c) * position.xy * iData.x;
        vec4 mv = modelViewMatrix * vec4(iPos, 1.);
        mv.xy += p;
        vUv = uv; vAlpha = iData.y; vSeed = iData.w; vHeat = iHeat;
        vKeyV = normalize((viewMatrix * vec4(uKey, 0.)).xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      ${NOISE}
      uniform float uOpacity; uniform sampler2D uCloud;
      varying vec2 vUv; varying float vAlpha; varying float vSeed; varying float vHeat; varying vec3 vKeyV;
      void main(){
        vec2 q = vUv * 2. - 1.;
        float r2 = dot(q, q);
        // a CC0 cloud puff gives each billow its shape; mirrored on half the puffs for variety
        vec2 tuv = mix(vUv, vec2(1. - vUv.x, vUv.y), step(.5, fract(vSeed * 3.17)));
        vec4 puff = texture2D(uCloud, tuv);
        float dens = puff.a * (1. - smoothstep(.75, 1., r2));
        if (dens < .01) discard;
        // billow normal: sphere plus the puff's own relief, lit by the key light and sky
        float shade = dot(puff.rgb, vec3(.333));
        vec3 nrm = normalize(vec3(q * (1.15 - shade * .4), sqrt(max(1. - r2, 0.)) + .2));
        float lit = max(dot(nrm, vKeyV), 0.) * (.55 + .6 * shade);
        vec3 ash = vec3(.06, .055, .05);
        vec3 col = ash * (.25 + .35 * nrm.y) + vec3(1., .86, .7) * 1.5 * lit * .35 + vec3(.25, .32, .45) * .12;
        // glow from the vent on the lowest, hottest puffs
        col += vec3(2.4, .7, .15) * vHeat * (1. - smoothstep(-.6, .6, q.y)) * .8;
        gl_FragColor = vec4(col, dens * vAlpha * uOpacity);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  group.add(mesh);

  // crater glow
  const glowMat = new THREE.SpriteMaterial({ color: new THREE.Color(4, 1.4, 0.35), transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending, map: tex });
  const glow = new THREE.Sprite(glowMat);
  glow.position.set(VOLCANO.x, summitY + 1.2, VOLCANO.z);
  glow.scale.set(14, 9, 1);
  group.add(glow);

  const wind = new THREE.Vector3(1, 0, -0.35).normalize();
  const order = seeds.map((_, i) => i);
  const tmp = new THREE.Vector3();
  const update = (t: number, opacity: number, cam: THREE.Vector3) => {
    const P: [number, number, number][] = [];
    const D: [number, number, number, number][] = [];
    const Hh: number[] = [];
    seeds.forEach((sd) => {
      const life = (t / 26 + sd.off) % 1;
      const rise = 6 + life * 200;
      const drift = life * life * 180;
      const spread = 4 + life * 30;
      P.push([VOLCANO.x + wind.x * drift + sd.jx * spread, summitY + rise, VOLCANO.z + wind.z * drift + sd.jz * spread]);
      const size = 10 + life * 110;
      const fade = Math.min(1, life * 10) * (1 - life) ** 1.3;
      // each puff carries the eruption strength from the moment it left the crater
      const born = cycleAt(t - life * 26).erupt;
      D.push([size, fade * (0.4 + 0.6 * born), sd.rot + t * sd.spin * 0.15, sd.seed]);
      Hh.push(Math.max(0, 1 - life * 7) * born);
    });
    // draw far puffs first so blending reads correctly
    order.sort((a, b) => tmp.set(...P[b]).distanceToSquared(cam) - tmp.set(...P[a]).distanceToSquared(cam));
    order.forEach((src, k) => {
      iPos.setXYZ(k, ...P[src]);
      iData.setXYZW(k, ...D[src]);
      iHeat.setX(k, Hh[src]);
    });
    iPos.needsUpdate = iData.needsUpdate = iHeat.needsUpdate = true;
    uniforms.uOpacity.value = opacity;
    const e = cycleAt(t).erupt;
    glowMat.opacity = (0.3 + 0.6 * e + 0.1 * Math.sin(t * 2.3)) * opacity;
    glow.scale.set(12 + 8 * e, 8 + 5 * e, 1);
  };
  return { group, update };
}

// ---------------------------------------------------------------- arrows
function arrowAlong(path: { x: number; y: number }[], width: number, head: number, z: number) {
  // flat ribbon with arrow head, in the XY plane
  const left: THREE.Vector2[] = [];
  const right: THREE.Vector2[] = [];
  const total = path.reduce((acc, p, i) => (i ? acc + Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y) : 0), 0);
  let run = 0;
  const bodyEnd = total - head * 1.1;
  const pts: { x: number; y: number; tx: number; ty: number }[] = [];
  for (let i = 0; i < path.length; i++) {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(path.length - 1, i + 1)];
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    if (i) run += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    if (run > bodyEnd) break;
    pts.push({ x: path[i].x, y: path[i].y, tx: (b.x - a.x) / l, ty: (b.y - a.y) / l });
  }
  pts.forEach((p, i) => {
    const w = (width / 2) * Math.min(1, 0.35 + i / 4);
    left.push(new THREE.Vector2(p.x - p.ty * w, p.y + p.tx * w));
    right.push(new THREE.Vector2(p.x + p.ty * w, p.y - p.tx * w));
  });
  const last = pts[pts.length - 1];
  const tip = path[path.length - 1];
  const hw = width * 1.25;
  const shape = new THREE.Shape([
    ...left,
    new THREE.Vector2(last.x - last.ty * hw, last.y + last.tx * hw),
    new THREE.Vector2(tip.x, tip.y),
    new THREE.Vector2(last.x + last.ty * hw, last.y - last.tx * hw),
    ...right.reverse(),
  ]);
  const geo = new THREE.ShapeGeometry(shape);
  geo.translate(0, 0, z);
  return geo;
}

export function buildMotionArrows() {
  const group = new THREE.Group();
  const white = new THREE.MeshBasicMaterial({ color: '#F7F7F5', transparent: true, opacity: 0.88, depthWrite: false });
  const warm = new THREE.MeshBasicMaterial({ color: '#F0C9A0', transparent: true, opacity: 0.55, depthWrite: false });
  const line = (a: { x: number; y: number }, b: { x: number; y: number }, n = 12) =>
    Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
  // oceanic plate moves toward the trench
  const oy = (x: number) => slabPoint(x, SLAB.H * 0.42).y;
  const ocean = Array.from({ length: 16 }, (_, i) => ({ x: -360 + i * 9, y: oy(-360 + i * 9) }));
  // slab sinks down-dip
  const slab = Array.from({ length: 24 }, (_, i) => slabPoint(220 + i * 6, SLAB.H * 0.5));
  // continent drifts slowly toward the trench (shorter arrow = slower)
  const cont = line({ x: 560, y: -40 }, { x: 490, y: -40 });
  // corner flow in the mantle wedge
  const wedge: { x: number; y: number }[] = [];
  for (let i = 0; i <= 14; i++) wedge.push({ x: ARC_X + 150 - i * 7, y: labY(ARC_X + 150 - i * 7) - 16 });
  const sStart = slabCoords(ARC_X + 52, slabTopY(ARC_X + 52)).s;
  for (let i = 0; i <= 12; i++) wedge.push(slabPoint(sStart + i * 6, -14));
  // smooth the joint
  const sm = wedge.map((p, i) => {
    const a = wedge[Math.max(0, i - 1)];
    const b = wedge[Math.min(wedge.length - 1, i + 1)];
    return { x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4 };
  });
  group.add(new THREE.Mesh(arrowAlong(ocean, 9, 16, FACE_Z + 0.3), white));
  group.add(new THREE.Mesh(arrowAlong(slab, 9, 16, FACE_Z + 0.3), white));
  group.add(new THREE.Mesh(arrowAlong(cont, 6, 12, FACE_Z + 0.3), white));
  group.add(new THREE.Mesh(arrowAlong(sm, 5, 11, FACE_Z + 0.25), warm));
  group.renderOrder = 7;
  group.children.forEach((c) => (c.renderOrder = 7));
  return { group, materials: [white, warm], baseOpacity: [0.88, 0.55] };
}

/** Plate motion evidence: velocity vectors on the ocean surface, relative to the continent. */
export function buildGpsArrows() {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: '#FFE08A', transparent: true, opacity: 0.95, depthWrite: false });
  const len = 70; // all arrows equal: the whole plate moves ~7 cm/yr toward the trench
  for (const x0 of [-430, -290, -150]) {
    for (const z of [-30, -150, -290, -450]) {
      const pts = Array.from({ length: 6 }, (_, i) => ({ x: x0 + (len * i) / 5, y: -z }));
      const g = arrowAlong(pts, 9, 20, 0);
      const m = new THREE.Mesh(g, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.6;
      m.renderOrder = 6;
      group.add(m);
    }
  }
  return { group, material: mat };
}
