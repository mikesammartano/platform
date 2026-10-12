/**
 * Idealized oceanic-continental (Andes-type) subduction margin.
 *
 * Coordinates (scene units):
 *   x  east, from the ocean basin (x < 0) toward the continent (x > 0). Trench axis at x = 0.
 *   y  up. Sea level at y = 0.
 *   z  along the margin (strike). The cross-section is cut at z = 0; the landscape extends to z < 0.
 *
 * Scale: 1 unit = 1 km for deep structure. Surface relief (ocean depth, land elevation) is drawn with a
 * vertical exaggeration of VE so a 6 km mountain or 8 km trench is visible next to a 300 km deep slab.
 * The model note on screen says "Scale and geometry are not exact."
 *
 * Reference values (approximate, central Andes / Nazca plate):
 *   abyssal seafloor ~4.4 km deep, trench ~8 km, peaks ~6 km
 *   slab dip ~10-15 deg at the trench, steepening to ~30 deg below ~90 km depth
 *   oceanic lithosphere ~80 km thick, oceanic crust ~7 km
 *   arc volcanoes sit where the slab top is ~110-120 km deep
 *   convergence ~7 cm/yr
 */

export const VE = 5;
/** Land relief is exaggerated more than ocean depth so mountains read at classroom scale (display units per km). */
export const LAND_VE = 12;

const DEG = Math.PI / 180;

export const SLAB = {
  trenchY: -40, // 8 km * VE
  theta0: 12 * DEG, // dip at the trench
  theta1: 30 * DEG, // dip of the straight, deeper slab
  R: 480, // bending radius
  H: 80, // lithosphere thickness
  crust: 9, // oceanic crust (7 km, slightly thickened for legibility)
  outerRiseX: -150,
} as const;

/** Seafloor depth reference of the ocean basin, display units. */
export const ABYSSAL_Y = -22;
/** Coastline (sea level crossing) at z = 0. */
export const COAST_X = 95;
/** Section bottom. */
export const SECTION_BOTTOM = -330;
/** Horizontal extent of the modelled block. */
export const X_MIN = -900;
export const X_MAX = 2600;
export const Z_FAR = -3000;

const n0 = { x: -Math.sin(SLAB.theta0), y: -Math.cos(SLAB.theta0) };
/** Bending circle center. Points on the slab top arc are C + R (sin t, cos t). */
export const SLAB_C = { x: SLAB.R * n0.x, y: SLAB.trenchY + SLAB.R * n0.y };
export const SLAB_ARC_LEN = SLAB.R * (SLAB.theta1 - SLAB.theta0);
export const SLAB_P1 = {
  x: SLAB_C.x + SLAB.R * Math.sin(SLAB.theta1),
  y: SLAB_C.y + SLAB.R * Math.cos(SLAB.theta1),
};
const T1 = { x: Math.cos(SLAB.theta1), y: -Math.sin(SLAB.theta1) };
const N1 = { x: -Math.sin(SLAB.theta1), y: -Math.cos(SLAB.theta1) };

const OCEAN_L = 18 / Math.tan(SLAB.theta0);

/** Top of the incoming oceanic plate (x <= 0): abyssal floor, outer rise, bend into the trench. */
export function seafloorAnalytic(x: number): number {
  const xc = Math.min(x, 0);
  const rise = 3 * Math.exp(-(((xc - SLAB.outerRiseX) / 60) ** 2));
  return ABYSSAL_Y + rise - 18 * Math.exp(xc / OCEAN_L);
}

function seafloorDip(x: number) {
  const e = 0.25;
  return Math.atan((seafloorAnalytic(x - e) - seafloorAnalytic(x + e)) / (2 * e));
}

/**
 * Slab-local coordinates of a point.
 *  s: distance along the plate top (s < 0 on the ocean side, 0 at the trench)
 *  n: distance below the plate top (0 = top surface, SLAB.H = base of lithosphere; negative = above)
 */
export function slabCoords(x: number, y: number): { s: number; n: number } {
  const dx = x - SLAB_C.x;
  const dy = y - SLAB_C.y;
  const th = Math.atan2(dx, dy);
  if (th < SLAB.theta0) {
    // offset along the local plate normal, solved by fixed-point iteration (slopes are gentle)
    let x0 = x;
    let n = 0;
    for (let i = 0; i < 5; i++) {
      const a = seafloorDip(x0);
      n = (seafloorAnalytic(x0) - y) / Math.cos(a);
      x0 = Math.min(0, x + n * Math.sin(a));
    }
    return { s: x0, n };
  }
  if (th <= SLAB.theta1) {
    return { s: SLAB.R * (th - SLAB.theta0), n: SLAB.R - Math.hypot(dx, dy) };
  }
  const qx = x - SLAB_P1.x;
  const qy = y - SLAB_P1.y;
  return { s: SLAB_ARC_LEN + qx * T1.x + qy * T1.y, n: qx * N1.x + qy * N1.y };
}

/** Inverse of slabCoords. */
export function slabPoint(s: number, n: number): { x: number; y: number } {
  if (s < 0) {
    const a = seafloorDip(s);
    return { x: s - n * Math.sin(a), y: seafloorAnalytic(s) - n * Math.cos(a) };
  }
  if (s <= SLAB_ARC_LEN) {
    const th = SLAB.theta0 + s / SLAB.R;
    const r = SLAB.R - n;
    return { x: SLAB_C.x + r * Math.sin(th), y: SLAB_C.y + r * Math.cos(th) };
  }
  const d = s - SLAB_ARC_LEN;
  return { x: SLAB_P1.x + T1.x * d + N1.x * n, y: SLAB_P1.y + T1.y * d + N1.y * n };
}

/** Unit tangent of the slab top at s, pointing down-dip. */
export function slabTangent(s: number): { x: number; y: number } {
  if (s < 0) {
    const e = 0.5;
    const dy = seafloorAnalytic(s + e) - seafloorAnalytic(s - e);
    const l = Math.hypot(2 * e, dy);
    return { x: (2 * e) / l, y: dy / l };
  }
  const th = s <= SLAB_ARC_LEN ? SLAB.theta0 + s / SLAB.R : SLAB.theta1;
  return { x: Math.cos(th), y: -Math.sin(th) };
}

/** y of the slab top under a given x (x >= 0). */
export function slabTopY(x: number): number {
  if (x <= 0) return seafloorAnalytic(x);
  if (x <= SLAB_P1.x) {
    const dx = x - SLAB_C.x;
    return SLAB_C.y + Math.sqrt(SLAB.R * SLAB.R - dx * dx);
  }
  return SLAB_P1.y - (x - SLAB_P1.x) * Math.tan(SLAB.theta1);
}

/** x where the slab top reaches a given (negative) y. */
export function slabXAtY(y: number): number {
  let lo = 0;
  let hi = X_MAX;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (slabTopY(mid) > y) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Arc volcanoes sit above the slab where its top is ~118 km deep. */
export const ARC_SLAB_DEPTH = -118;
export const ARC_X = Math.round(slabXAtY(ARC_SLAB_DEPTH));

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Continental Moho (base of continental crust). Thick crust under the arc and plateau. */
export function mohoY(x: number): number {
  const thick = smooth(COAST_X - 20, ARC_X + 10, x) * (1 - smooth(470, 680, x));
  return -34 - 28 * thick;
}

/** Base of the continental lithosphere. Thinned under the arc, thick toward the continental interior. */
export function labY(x: number): number {
  const forearc = -90;
  const arc = -78;
  const interior = -125;
  const toArc = smooth(ARC_X - 70, ARC_X - 10, x);
  const toInterior = smooth(ARC_X + 90, ARC_X + 360, x);
  return forearc + (arc - forearc) * toArc + (interior - arc) * toInterior;
}

/** Main arc volcano, placed just behind the cut so the section slices through its flank. */
export const VOLCANO = { x: ARC_X, z: -1, radius: 40, height: 19 };
/** Upper-crust magma storage under the arc. */
export const CHAMBER = { x: ARC_X - 2, y: -20, rx: 20, ry: 6.5 };

/** Slab position where fluids are released and the mantle wedge melts (slab top ~100-140 km). */
export const MELT = (() => {
  const s = slabCoords(ARC_X - 14, slabTopY(ARC_X - 14)).s;
  const p = slabPoint(s, -18);
  return { s, x: p.x, y: p.y, rx: 34, ry: 12 };
})();

/**
 * Approximate depth in km below sea level. Deep structure is drawn 1:1, so this is close to the
 * display depth; only the top few km (water, relief) are exaggerated.
 */
export function realDepthKm(y: number): number {
  return Math.max(0, -y);
}

/** Mulberry32 deterministic PRNG so the catalog is identical on every load. */
export function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Quake = { x: number; y: number; depthKm: number; mag: number; period: number; phase: number; kind: QuakeKind };
export type QuakeKind = 'interface' | 'intraslab' | 'lower-plane' | 'outer-rise' | 'crustal';

/**
 * Representative earthquake catalog projected onto the section.
 * Pattern follows a Wadati-Benioff zone: shallow thrust events on the plate interface near the trench,
 * events inside the sinking slab to ~300 km, a weaker lower plane (double seismic zone),
 * bending-related events seaward of the trench, and shallow crustal events in the overriding plate.
 * No earthquakes occur in the hot mantle wedge.
 */
export function buildQuakeCatalog(): Quake[] {
  const r = prng(20261012);
  const out: Quake[] = [];
  const mag = () => 3 + 4.2 * Math.pow(r(), 3.2);
  const push = (x: number, y: number, kind: QuakeKind) =>
    out.push({ x, y, depthKm: realDepthKm(y), mag: mag(), period: 7 + r() * 18, phase: r(), kind });

  const maxS = slabCoords(slabXAtY(SECTION_BOTTOM + 25), SECTION_BOTTOM + 25).s;

  for (let i = 0; i < 80; i++) {
    const s = 6 + Math.pow(r(), 0.9) * 105;
    const p = slabPoint(s, -1.5 + r() * 5);
    push(p.x, p.y, 'interface');
  }
  for (let i = 0; i < 170; i++) {
    // density decreases with depth
    const s = 60 + (-Math.log(1 - r() * 0.985) / 3.2) * (maxS - 60);
    if (s > maxS) continue;
    const p = slabPoint(s, 2 + r() * 17);
    push(p.x, p.y, 'intraslab');
  }
  for (let i = 0; i < 34; i++) {
    const s = 110 + r() * 150;
    const p = slabPoint(s, 30 + r() * 8);
    push(p.x, p.y, 'lower-plane');
  }
  for (let i = 0; i < 16; i++) {
    const s = -120 + r() * 85;
    const p = slabPoint(s, 1 + r() * 22);
    push(p.x, p.y, 'outer-rise');
  }
  for (let i = 0; i < 26; i++) {
    const x = ARC_X - 40 + r() * 260;
    const y = -3 - r() * 22;
    push(x, y, 'crustal');
  }
  return out;
}

/** Plate convergence used for labels and the Plate motion evidence. */
export const CONVERGENCE_CM_PER_YR = 7;
