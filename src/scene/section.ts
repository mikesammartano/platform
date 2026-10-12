import * as THREE from 'three';
import { NOISE, SLAB_GLSL } from './glsl';
import { SECTION_BOTTOM, X_MAX, X_MIN } from './model';
import { TERRAIN_NX } from './terrain';

export type SectionUniforms = {
  uProfile: { value: THREE.DataTexture };
  uAdvect: { value: number };
  uTime: { value: number };
  uSurface: { value: number };
  uPlates: { value: number };
  uMantle: { value: number };
  uMagma: { value: number };
  uCrust: { value: number };
  uLith: { value: number };
  uAsth: { value: number };
  uTemp: { value: number };
};

/**
 * The cut face of the block (z = 0): water column, plates, slab, mantle, magma, temperature.
 * All regions are evaluated analytically per pixel from the model geometry, so every layer can be toggled
 * and the plates can move without rebuilding geometry.
 */
export function buildSection(profile: Float32Array) {
  // Half float textures are filterable on every WebGL2 device (float32 filtering is optional).
  const half = new Uint16Array(profile.length);
  for (let i = 0; i < profile.length; i++) half[i] = THREE.DataUtils.toHalfFloat(profile[i]);
  const tex = new THREE.DataTexture(half, profile.length, 1, THREE.RedFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;

  // The face extends well below the modelled depth so its lower edge never enters the frame.
  const top = 120;
  const bottom = SECTION_BOTTOM - 500;
  const w = X_MAX - X_MIN;
  const h = top - bottom;
  const geo = new THREE.PlaneGeometry(w, h, 1, 1);
  geo.translate(X_MIN + w / 2, bottom + h / 2, 0);

  const uniforms: SectionUniforms = {
    uProfile: { value: tex },
    uAdvect: { value: 0 },
    uTime: { value: 0 },
    uSurface: { value: 1 },
    uPlates: { value: 1 },
    uMantle: { value: 0 },
    uMagma: { value: 1 },
    uCrust: { value: 0 },
    uLith: { value: 0 },
    uAsth: { value: 0 },
    uTemp: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    transparent: true,
    depthWrite: true,
    vertexShader: /* glsl */ `
      varying vec2 vXY;
      void main(){ vXY = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      ${NOISE}
      ${SLAB_GLSL}
      uniform sampler2D uProfile;
      uniform float uAdvect, uTime, uSurface, uPlates, uMantle, uMagma, uCrust, uLith, uAsth, uTemp;
      varying vec2 vXY;
      const float NX = ${TERRAIN_NX.toFixed(1)};
      float profileAt(float x){
        float u = (x - (${X_MIN.toFixed(1)})) / ${w.toFixed(1)};
        u = u * (NX / (NX + 1.)) + .5 / (NX + 1.);
        return texture2D(uProfile, vec2(u, .5)).r;
      }
      vec3 tempRamp(float T){
        float t = clamp(T / 1500., 0., 1.) * 5.;
        vec3 c0 = vec3(.16,.27,.62), c1 = vec3(.22,.6,.8), c2 = vec3(.95,.9,.66), c3 = vec3(.95,.62,.25), c4 = vec3(.82,.25,.16), c5 = vec3(.45,.07,.17);
        if (t < 1.) return mix(c0, c1, t);
        if (t < 2.) return mix(c1, c2, t - 1.);
        if (t < 3.) return mix(c2, c3, t - 2.);
        if (t < 4.) return mix(c3, c4, t - 3.);
        return mix(c4, c5, t - 4.);
      }
      float line(float d, float aa, float w){ return 1. - smoothstep(w, w + aa * 1.5, abs(d)); }

      void main(){
        vec2 p = vXY; float x = p.x, y = p.y;
        float aa = max(fwidth(y), 1e-3);
        float top = profileAt(x);
        float sea = 0.;
        float surf = max(top, sea);
        if (y > surf + aa) discard;
        float edgeA = 1. - smoothstep(surf - aa, surf + aa * .5, y);

        // ---------- water column ----------
        if (y > top) {
          if (uSurface < .5) discard;
          float d = clamp(-y / 40., 0., 1.);
          vec3 wc = mix(vec3(.12,.33,.48), vec3(.03,.1,.19), pow(d, .7));
          wc += .025 * vnoise(vec2(x * .15 + uTime * .2, y * .3));
          gl_FragColor = vec4(wc, edgeA);
          return;
        }

        vec2 sn = slabSN(p);
        float s = sn.x, n = sn.y;
        float moho = mohoY(x), lab = labY(x);
        float depthK = clamp(-y / 330., 0., 1.);

        // ---------- materials ----------
        vec3 mantleBase = mix(vec3(.15,.13,.12), vec3(.2,.14,.11), depthK);
        float mm = fbm3(p * .045 + vec2(0., uTime * .002));
        float mm2 = vnoise(p * .35);
        vec3 mantle = mantleBase * (.82 + .32 * mm) * (.93 + .1 * mm2);
        // Mantle layer: reveal solid-rock texture and slow flow banding
        float flowBands = vnoise(vec2(dot(p, vec2(.06, .035)) - uTime * .03, dot(p, vec2(-.035, .06)) * .4));
        vec3 mantleOn = mantleBase * 1.18 * (.75 + .5 * mm) + vec3(.03, .015, .0) * flowBands;
        mantle = mix(mantle, mantleOn, uMantle);
        vec3 wedge = mantle * vec3(1.08, 1.02, .98);

        // plate-local texture coordinates move with the plate
        vec2 pc = vec2(s - uAdvect, n);
        float pn = fbm3(pc * vec2(.05, .12));
        float pn2 = vnoise(pc * vec2(.5, 1.1));
        // oceanic crust: sediment veneer, pillow basalt, dikes, gabbro
        vec3 sed = vec3(.42,.37,.3) * (.85 + .3 * pn2);
        vec3 basalt = vec3(.19,.2,.23) * (.8 + .35 * pn) * (.9 + .2 * step(.55, vnoise(pc * vec2(.9, 1.6))));
        vec3 gabbro = vec3(.27,.27,.27) * (.85 + .25 * pn);
        vec3 ocrust = mix(basalt, gabbro, smoothstep(OCRUST * .45, OCRUST * .7, n));
        ocrust = mix(sed, ocrust, smoothstep(.6, 1.4, n));
        vec3 olm = vec3(.29,.29,.3) * (.78 + .32 * pn) * (.95 + .08 * sin(n * .9 + pn * 3.));
        vec3 plate = mix(ocrust, olm, smoothstep(OCRUST - aa, OCRUST + aa, n));
        // rounded shading across the plate thickness gives the slab volume
        plate *= mix(1.14, .8, smoothstep(0., SLAB_H, n));
        // slab is warmed slowly as it sinks (stays solid)
        plate = mix(plate, plate * vec3(1.15, .98, .9), smoothstep(150., 450., s) * .6);

        // continental crust: folded strata, granite plutons under the arc
        float warp = fbm3(p * vec2(.03, .06)) * 14.;
        float strata = sin((y + warp) * .9) * .5 + .5;
        vec3 ucrust = mix(vec3(.44,.36,.28), vec3(.35,.29,.23), strata) * (.85 + .25 * mm2);
        vec3 lcrust = mix(vec3(.3,.27,.25), vec3(.25,.23,.22), strata) * (.85 + .2 * mm2);
        vec3 ccrust = mix(lcrust, ucrust, smoothstep(moho * .45 - 4., moho * .45 + 4., y));
        float pluton = smoothstep(.6, .66, fbm3(p * vec2(.035, .05) + 3.)) * (1. - smoothstep(50., 110., abs(x - ARC_X - 20.)));
        ccrust = mix(ccrust, vec3(.47,.42,.38) * (.92 + .1 * mm2), pluton * .35 * smoothstep(moho + 6., moho + 20., y) * (1. - smoothstep(-14., -4., y)));
        vec3 clm = vec3(.24,.22,.19) * (.82 + .3 * mm);

        // "Plates" off: lithosphere fades toward mantle so plates are not distinguished
        float pl = .25 + .75 * uPlates;
        plate = mix(mantle, plate, pl);
        clm = mix(mantle, clm, pl);
        ccrust = mix(mantle * 1.1, ccrust, .5 + .5 * uPlates);

        // ---------- regions ----------
        vec3 overriding;
        if (x < 0.) {
          overriding = sed; // sediment draped on the incoming plate
        } else {
          overriding = mix(wedge, clm, smoothstep(lab - aa, lab + aa, y));
          overriding = mix(overriding, ccrust, smoothstep(moho - aa, moho + aa, y));
        }
        vec3 col = mix(overriding, plate, smoothstep(-aa, aa, n));
        col = mix(col, mantle, smoothstep(SLAB_H - aa, SLAB_H + aa, n));

        // fault / plate interface highlight (subduction zone)
        float iface = line(n, aa, .35) * step(-20., s) * (1. - smoothstep(380., 480., s));
        col = mix(col, vec3(.86,.83,.76), iface * .55 * uPlates);
        // lithosphere base: faint edge so plates read as rigid slabs
        col *= 1. - .25 * line(n - SLAB_H, aa, .6) * uPlates;

        // ---------- geology overlays ----------
        bool aboveSlab = n < 0. && x >= 0.;
        float isAsth = (n > SLAB_H || (aboveSlab && y < lab)) ? 1. : 0.;
        col = mix(col, col * vec3(1.35, 1.12, .9) + vec3(.06, .03, .0), uAsth * isAsth * .8);
        float crustMask = (n >= 0. && n < OCRUST && s > -1e4) || (aboveSlab && y > moho) ? 1. : 0.;
        col = mix(col, col * vec3(1.22, 1.12, 1.) + .03, uCrust * crustMask * .7);
        float dash = step(.5, fract(x * .06));
        float mohoL = aboveSlab ? line(y - moho, aa, .5) : line(n - OCRUST, aa, .4) * step(n, OCRUST + 3.);
        col = mix(col, vec3(.95,.86,.62), uCrust * mohoL * .9);
        float labL = aboveSlab ? line(y - lab, aa, .6) : line(n - SLAB_H, aa, .6);
        col = mix(col, vec3(.95), uLith * labL * dash * .9);

        // ---------- magma ----------
        if (uMagma > 0.) {
          // partial melting in the mantle wedge, just above the slab (never inside it)
          float ds = (s - MELT_S) / MELT.z;
          float dn = (n + 18.) / MELT.w;
          float e = ds * ds + dn * dn;
          float melt = (1. - smoothstep(.15, 1., e)) * smoothstep(-3., -9., n);
          float grains = smoothstep(.45, .85, vnoise(p * 1.1 + vec2(0., -uTime * .15)));
          float flick = .85 + .15 * sin(uTime * 1.3 + x * .2);
          vec3 meltCol = vec3(.95,.38,.1);
          col = mix(col, meltCol, melt * (.18 + .5 * grains) * flick * uMagma);
          col += meltCol * melt * .08 * uMagma;
          // crustal storage: crystal mush with a little melt
          vec2 cq = (p - CHAMBER.xy) / CHAMBER.zw;
          float ce = dot(cq, cq);
          float cham = 1. - smoothstep(.55, 1., ce + .25 * (vnoise(p * .4) - .5));
          vec3 mush = mix(vec3(.6,.2,.08), vec3(.95,.45,.12), smoothstep(.8, .1, ce));
          col = mix(col, mush * (.75 + .35 * vnoise(p * .9 + uTime * .1)), cham * .85 * uMagma);
          // short upper-crust conduit to the volcano
          float wig = sin(y * .35) * .9 + sin(y * .9) * .3;
          float cond = 1. - smoothstep(.9, 2.2, abs(x - VOLC_X - wig));
          cond *= smoothstep(CHAMBER.y + CHAMBER.w * .4, CHAMBER.y + CHAMBER.w + 3., y);
          vec3 condCol = mix(vec3(.75,.22,.06), vec3(1.,.55,.15), smoothstep(CHAMBER.y, 8., y));
          col = mix(col, condCol, cond * .9 * uMagma);
        }

        // ---------- temperature evidence ----------
        if (uTemp > 0.) {
          float d = max(-y, 0.);
          float T;
          float Tm = 1300. + .4 * max(d - 100., 0.);
          if (n >= 0. && n <= SLAB_H) {
            float T0 = 1300. * n / SLAB_H;
            if (s > 0.) {
              float Ttop = min(1150., s * 3.6);
              float delta = 10. + .12 * s;
              T = max(T0, Ttop * exp(-n / delta));
              T = max(T, Tm - (Tm - T) * smoothstep(SLAB_H, SLAB_H - delta * 1.5, n));
            } else T = T0;
          } else if (n > SLAB_H) {
            T = Tm - 120. * exp(-(n - SLAB_H) / 25.) * smoothstep(-60., 60., s);
          } else if (x >= 0.) {
            // conductive geotherm measured from the local ground surface (mountains are cold at the top)
            float dc = max(top - y, 0.);
            float Tc = 1300. * clamp(dc / (max(top, 0.) - lab), 0., 1.);
            float Tw = max(Tc, Tm);
            if (y > lab) Tw = Tc;
            float Tslab = min(1150., max(s, 0.) * 3.6);
            T = mix(Tw, Tslab, exp(n / 22.) * step(lab, y + 200.));
            if (y > lab) T = min(T, Tc + 0.);
          } else {
            T = 15.;
          }
          vec3 tc = tempRamp(T);
          float iso = line(fract(T / 200. + .5) - .5, fwidth(T / 200.), .02);
          tc = mix(tc, tc * .45, iso * .8);
          col = mix(col, tc, .82 * uTemp);
        }

        // cinematic depth falloff and soft vignette on the cut face
        col *= mix(1.05, .7, smoothstep(-20., ${SECTION_BOTTOM.toFixed(1)}, y));
        gl_FragColor = vec4(col, edgeA);
      }`,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.renderOrder = 2;
  return { mesh, uniforms, material };
}
