import * as THREE from 'three';
import { NOISE, NOISE_D, SLAB_GLSL } from './glsl';
import { HYPOCENTER, LOCKED, PRISM, SECTION_BOTTOM, TSUNAMI_X, X_MAX, X_MIN, slabCoords } from './model';
import { PROFILE_N } from './terrain';

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
  uStrain: { value: number };
  uSince: { value: number };
  uDeform: { value: number };
  uErupt: { value: number };
  uQuakes: { value: number };
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
    uStrain: { value: 0 },
    uSince: { value: 99 },
    uDeform: { value: 0 },
    uErupt: { value: 0.5 },
    uQuakes: { value: 1 },
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
      ${NOISE_D}
      ${SLAB_GLSL}
      uniform sampler2D uProfile;
      uniform float uAdvect, uTime, uSurface, uPlates, uMantle, uMagma, uCrust, uLith, uAsth, uTemp;
      uniform float uStrain, uSince, uDeform, uErupt, uQuakes;
      varying vec2 vXY;
      const float NX = ${PROFILE_N.toFixed(1)};
      const float TSUNAMI_X = ${TSUNAMI_X.toFixed(2)};
      const float LOCK_S0 = ${LOCKED.s0.toFixed(2)}, LOCK_S1 = ${LOCKED.s1.toFixed(2)};
      const vec2 HYPO = vec2(${HYPOCENTER.x.toFixed(3)}, ${HYPOCENTER.y.toFixed(3)});
      const float HYPO_S = ${slabCoords(HYPOCENTER.x, HYPOCENTER.y).s.toFixed(3)};
      const float PRISM_X1 = ${PRISM.x1.toFixed(2)}, PRISM_DIP = ${PRISM.dip.toFixed(3)};
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

      // tsunami: a trench-parallel wave that spreads both ways from above the rupture
      float tsunamiAt(float x){
        if (uSince > 16.) return 0.;
        // shallow-water waves travel at sqrt(g * depth): fast over the deep ocean, slowing (and growing taller)
        // as they cross the shallow shelf toward the coast
        bool landward = x > TSUNAMI_X;
        float c = landward ? 34. : 62.;
        float d = abs(x - TSUNAMI_X) - c * uSince;
        float shoal = landward ? 1. + .9 * smoothstep(TSUNAMI_X, COAST_X, x) : 1.;
        return uQuakes * 2.2 * shoal * exp(-d * d / (landward ? 110. : 180.)) * exp(-uSince / 9.) * smoothstep(0., .6, uSince);
      }

      void main(){
        vec2 p = vXY;
        float yo = p.y;
        float aa = max(fwidth(yo), 1e-3);

        // elastic rebound: rock above the locked fault is dragged down, then springs back in the earthquake
        vec2 sn0 = slabSN(p);
        if (sn0.y < 0. && p.x > 0. && p.x < 260.) {
          // seafloor above the locked patch is dragged down between earthquakes and springs up in them,
          // while the coast farther inland does the opposite (subsides in the earthquake)
          float bell = exp(-pow((p.x - 48.) / 42., 2.)) - .35 * exp(-pow((p.x - 140.) / 45., 2.));
          p.y -= uDeform * 5. * bell * smoothstep(0., 5., -sn0.y);
        }
        float x = p.x, y = p.y;
        float top = profileAt(x);
        float eta = tsunamiAt(x);
        float surf = max(top, eta);
        if (y > top && yo > surf + aa) discard;

        // ---------- water column ----------
        if (y > top) {
          if (uSurface < .5) discard;
          float edgeW = 1. - smoothstep(eta - aa, eta + aa * .5, yo);
          float d = clamp(-yo / 40., 0., 1.);
          vec3 wc = mix(vec3(.1,.28,.36), vec3(.02,.07,.12), pow(d, .6));
          wc += .025 * vnoise(vec2(x * .15 + uTime * .2, yo * .3));
          wc = mix(wc, vec3(.55,.75,.85), smoothstep(.2, 2., eta) * smoothstep(-6., 0., yo) * .6);
          gl_FragColor = vec4(wc * wc * 1.1, edgeW);
          return;
        }
        float edgeA = 1. - smoothstep(top - aa, top + aa * .5, y);

        vec3 glow = vec3(0.);
        vec2 sn = slabSN(p);
        float s = sn.x, n = sn.y;
        float moho = mohoY(x), lab = labY(x);
        float depthK = clamp(-y / 330., 0., 1.);

        // ---------- materials ----------
        vec3 mantleBase = mix(vec3(.15,.13,.12), vec3(.21,.14,.11), depthK);
        float mm = fbm3(p * .045);
        float mm2 = vnoise(p * .35);
        vec3 mantle = mantleBase * (.84 + .28 * mm) * (.95 + .08 * mm2);
        vec3 mantleOn = mantleBase * 1.2 * (.78 + .44 * mm);
        mantle = mix(mantle, mantleOn, uMantle);
        vec3 wedge = mantle * vec3(1.08, 1.02, .98);

        // plate-local texture coordinates travel with the plate
        float sa = s - uAdvect;
        vec2 pc = vec2(sa, n);
        float pn = fbm3(pc * vec2(.05, .12));
        float pn2 = vnoise(pc * vec2(.5, 1.1));
        // oceanic crust: sediment veneer, pillow basalt, sheeted dikes, gabbro
        vec3 sed = vec3(.45,.39,.3) * (.88 + .24 * pn2);
        float pillows = smoothstep(.5, .62, vnoise(pc * vec2(.9, 1.6)));
        vec3 basalt = vec3(.2,.21,.24) * (.82 + .3 * pn) * (.92 + .16 * pillows);
        float dikes = .5 + .5 * sin(sa * 2.2 + pn * 4.);
        vec3 gabbro = vec3(.28,.28,.28) * (.86 + .2 * pn) * (.96 + .06 * dikes * (1. - smoothstep(OCRUST * .5, OCRUST * .7, n)));
        vec3 ocrust = mix(basalt, gabbro, smoothstep(OCRUST * .4, OCRUST * .7, n));
        ocrust = mix(sed, ocrust, smoothstep(.7, 1.6, n));
        vec3 olm = vec3(.27,.27,.29) * (.82 + .26 * pn);
        vec3 plate = mix(ocrust, olm, smoothstep(OCRUST - aa, OCRUST + aa, n));
        plate *= mix(1.14, .8, smoothstep(0., SLAB_H, n));
        plate = mix(plate, plate * vec3(1.15, .98, .9), smoothstep(150., 450., s) * .6);
        // age bands: evenly spaced marks that ride with the plate, so its motion is easy to follow
        float band = line(fract(sa / 55.) - .5, aa / 55., .006);
        plate = mix(plate, plate * 1.32 + .02, band * .8 * smoothstep(-700., -300., s) * (1. - smoothstep(380., 470., s)));

        // continental crust: gently folded strata, granite plutons under the arc
        float warp = fbm3(p * vec2(.03, .06)) * 14.;
        float strata = smoothstep(.15, .85, sin((y + warp) * .7) * .5 + .5);
        vec3 ucrust = mix(vec3(.43,.35,.27), vec3(.37,.3,.24), strata) * (.9 + .16 * mm2);
        vec3 lcrust = mix(vec3(.3,.27,.25), vec3(.27,.24,.22), strata) * (.9 + .14 * mm2);
        vec3 ccrust = mix(lcrust, ucrust, smoothstep(moho * .45 - 4., moho * .45 + 4., y));
        float pluton = smoothstep(.6, .66, fbm3(p * vec2(.035, .05) + 3.)) * (1. - smoothstep(50., 110., abs(x - ARC_X - 20.)));
        ccrust = mix(ccrust, vec3(.47,.42,.38) * (.92 + .1 * mm2), pluton * .3 * smoothstep(moho + 6., moho + 20., y) * (1. - smoothstep(-14., -4., y)));
        // accretionary wedge: sediment scraped off the plate, stacked along landward-dipping thrusts
        float inPrism = smoothstep(.5, -.5, x - (PRISM_X1 + PRISM_DIP * (y + 15.)));
        float tw = fbm3(p * .08) * 6.;
        float thrusts = line(fract((x + y * 1.35 + tw) / 13.) - .5, aa / 13. * 1.7, .01);
        vec3 prism = mix(vec3(.47,.41,.32), vec3(.4,.35,.28), .5 + .5 * sin(y * 1.4 + x * .3)) * (.9 + .15 * pn2);
        prism *= 1. - .16 * thrusts;
        ccrust = mix(ccrust, prism, inPrism * step(0., x));
        vec3 clm = vec3(.24,.22,.19) * (.84 + .26 * mm);

        // "Plates" off: lithosphere fades toward mantle so plates are not distinguished
        float pl = .25 + .75 * uPlates;
        plate = mix(mantle, plate, pl);
        clm = mix(mantle, clm, pl);
        ccrust = mix(mantle * 1.1, ccrust, .5 + .5 * uPlates);

        // ---------- regions ----------
        vec3 overriding;
        if (x < 0.) {
          overriding = sed;
        } else {
          overriding = mix(wedge, clm, smoothstep(lab - aa, lab + aa, y));
          overriding = mix(overriding, ccrust, smoothstep(moho - aa, moho + aa, y));
        }
        vec3 col = mix(overriding, plate, smoothstep(-aa, aa, n));
        col = mix(col, mantle, smoothstep(SLAB_H - aa, SLAB_H + aa, n));

        // plate interface (the fault between the plates)
        float iface = line(n, aa, .35) * step(-20., s) * (1. - smoothstep(380., 480., s));
        col = mix(col, vec3(.86,.83,.76), iface * .5 * uPlates);
        col *= 1. - .25 * line(n - SLAB_H, aa, .6) * uPlates;

        // ---------- earthquake cycle on the plate interface ----------
        if (uQuakes > 0.) {
          float onFault = (1. - smoothstep(1.8, 5., abs(n + .6))) * smoothstep(LOCK_S0 - 6., LOCK_S0 + 6., s) * (1. - smoothstep(LOCK_S1 - 12., LOCK_S1 + 6., s));
          // locked patch: strain builds (amber glow grows)
          float build = pow(uStrain, 1.6) * (.75 + .25 * sin(uTime * 7. + s * .3));
          col = mix(col, vec3(1., .74, .28), onFault * build * .9 * uQuakes);
          // rupture runs both ways along the fault from the hypocenter
          float front = 160. * uSince;
          float rup = onFault * step(abs(s - HYPO_S), front) * exp(-uSince * 1.6);
          col = mix(col, vec3(1., .95, .8), clamp(rup, 0., 1.) * uQuakes);
          glow += vec3(1., .8, .5) * clamp(rup, 0., 1.) * 2.5 * uQuakes + vec3(1., .6, .2) * onFault * build * .25 * uQuakes;
          // seismic waves: P then S
          float r = length(p - HYPO);
          float wP = line(r - 230. * uSince, aa, .9 + uSince * .6) * exp(-uSince / 1.4);
          float wS = line(r - 130. * uSince, aa, 1.2 + uSince * .9) * exp(-uSince / 1.8);
          float waves = (wP * .45 + wS * .6) * step(uSince, 5.) * uQuakes;
          col = mix(col, vec3(1., .93, .78), waves);
        }

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
          glow += vec3(1., .3, .05) * melt * grains * .35 * uMagma;
          // crustal storage: crystal mush with a little melt
          vec2 cq = (p - CHAMBER.xy) / CHAMBER.zw;
          float ce = dot(cq, cq);
          float cham = 1. - smoothstep(.55, 1., ce + .25 * (vnoise(p * .4) - .5));
          vec3 mush = mix(vec3(.6,.2,.08), vec3(.95,.45,.12), smoothstep(.8, .1, ce));
          col = mix(col, mush * (.6 + .3 * vnoise(p * .9 + uTime * .1) + .35 * uErupt), cham * .85 * uMagma);
          // short upper-crust conduit to the volcano
          float wig = sin(y * .35) * .9 + sin(y * .9) * .3;
          float cond = 1. - smoothstep(.9, 2.2, abs(x - VOLC_X - wig));
          cond *= smoothstep(CHAMBER.y + CHAMBER.w * .4, CHAMBER.y + CHAMBER.w + 3., y);
          vec3 condCol = mix(vec3(.75,.22,.06), vec3(1.,.55,.15), smoothstep(CHAMBER.y, 8., y));
          col = mix(col, condCol * (.7 + .45 * uErupt), cond * (.55 + .45 * uErupt) * uMagma);
          glow += vec3(1., .35, .06) * (cond * (.4 + 1.6 * uErupt) + cham * (.15 + .5 * uErupt) * smoothstep(.8, .1, ce)) * uMagma;
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

        // cinematic depth falloff on the cut face
        col *= mix(1.05, .68, smoothstep(-20., ${SECTION_BOTTOM.toFixed(1)}, y));
        // carved-rock relief: the cut face is lit by a soft key light from the upper left
        vec2 bg = noised(p * .16 + 3.1).yz * .16 * 5. + noised(p * .62 + 7.7).yz * .62 * 1.1 + noised(p * 2.1).yz * 2.1 * .12;
        float rockK = 1. - inPrism * .3;
        vec3 fn = normalize(vec3(-bg * .65 * rockK, 1.));
        float relief = .8 + .32 * dot(fn, normalize(vec3(-.55, .62, .56)));
        col *= relief;
        // to linear light (scene colors above were authored in display space)
        vec3 lc = col * col * 1.05;
        // glowing material emits light: keep magma and quake flashes bright enough to bloom
        gl_FragColor = vec4(lc + glow, edgeA);
      }`,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.renderOrder = 2;
  return { mesh, uniforms, material };
}
