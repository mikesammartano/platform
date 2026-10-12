import { CHAMBER, MELT, SLAB, SLAB_ARC_LEN, SLAB_C, SLAB_P1, VOLCANO, ARC_X, COAST_X } from './model';

const f = (n: number) => n.toFixed(5);

export const NOISE = /* glsl */ `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 fr = fract(p); vec2 u = fr * fr * (3. - 2. * fr);
  return mix(mix(hash12(i), hash12(i + vec2(1., 0.)), u.x), mix(hash12(i + vec2(0., 1.)), hash12(i + vec2(1., 1.)), u.x), u.y);
}
const mat2 ROT = mat2(1.6, 1.2, -1.2, 1.6);
float fbm3(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 3; i++){ s += a * vnoise(p); p = ROT * p; a *= .5; } return s; }
float fbm5(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = ROT * p; a *= .5; } return s; }
`;

/** Slab geometry, mirrored from model.ts (constants are baked in). */
export const SLAB_GLSL = /* glsl */ `
const vec2 SLAB_C = vec2(${f(SLAB_C.x)}, ${f(SLAB_C.y)});
const vec2 SLAB_P1 = vec2(${f(SLAB_P1.x)}, ${f(SLAB_P1.y)});
const float SLAB_R = ${f(SLAB.R)};
const float SLAB_TH0 = ${f(SLAB.theta0)};
const float SLAB_TH1 = ${f(SLAB.theta1)};
const float SLAB_ARC = ${f(SLAB_ARC_LEN)};
const float SLAB_H = ${f(SLAB.H)};
const float OCRUST = ${f(SLAB.crust)};
const float ARC_X = ${f(ARC_X)};
const float COAST_X = ${f(COAST_X)};
const vec4 MELT = vec4(${f(MELT.x)}, ${f(MELT.y)}, ${f(MELT.rx)}, ${f(MELT.ry)});
const float MELT_S = ${f(MELT.s)};
const vec4 CHAMBER = vec4(${f(CHAMBER.x)}, ${f(CHAMBER.y)}, ${f(CHAMBER.rx)}, ${f(CHAMBER.ry)});
const float VOLC_X = ${f(VOLCANO.x)};

float seafloorA(float x){
  float xc = min(x, 0.);
  float d = (xc - (${f(SLAB.outerRiseX)})) / 60.;
  return -22. + 3. * exp(-d * d) - 18. * exp(xc / ${f(18 / Math.tan(SLAB.theta0))});
}
float seafloorDip(float x){ return atan((seafloorA(x - .25) - seafloorA(x + .25)) / .5); }
vec2 slabSN(vec2 p){
  vec2 d = p - SLAB_C;
  float th = atan(d.x, d.y);
  if (th < SLAB_TH0) {
    float x0 = p.x, n = 0.;
    for (int i = 0; i < 4; i++){
      float a = seafloorDip(x0);
      n = (seafloorA(x0) - p.y) / cos(a);
      x0 = min(0., p.x + n * sin(a));
    }
    return vec2(x0, n);
  }
  if (th <= SLAB_TH1) return vec2(SLAB_R * (th - SLAB_TH0), SLAB_R - length(d));
  vec2 t1 = vec2(cos(SLAB_TH1), -sin(SLAB_TH1));
  vec2 n1 = vec2(-sin(SLAB_TH1), -cos(SLAB_TH1));
  vec2 q = p - SLAB_P1;
  return vec2(SLAB_ARC + dot(q, t1), dot(q, n1));
}
float sm(float a, float b, float x){ return smoothstep(a, b, x); }
float mohoY(float x){
  float thick = sm(COAST_X - 20., ARC_X + 10., x) * (1. - sm(470., 680., x));
  return -34. - 28. * thick;
}
float labY(float x){
  float toArc = sm(ARC_X - 70., ARC_X - 10., x);
  float toInt = sm(ARC_X + 90., ARC_X + 360., x);
  return -90. + 12. * toArc - 47. * toInt;
}
`;
