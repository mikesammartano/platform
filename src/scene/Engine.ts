import * as THREE from 'three';
import { prefersReducedMotion, useApp } from '../state/store';
import type { FocusKey, LabelKey, SceneState, ViewMode } from '../state/types';
import { type Pose, FOCUS_POSES, VIEW_POSES, poseFor } from './cameras';
import { buildGpsArrows, buildMagma, buildMantleFlow, buildMotionArrows, buildPlume, buildQuakes, buildWater } from './effects';
import { SUN_DIR, buildOcean, buildSky } from './environment';
import { DEFAULT_LABELS, LABELS } from './labels';
import { SECTION_BOTTOM, X_MAX, X_MIN, cycleAt } from './model';
import { buildSection } from './section';
import { TERRAIN_NX, buildTerrain, heightAt } from './terrain';

THREE.ColorManagement.enabled = false;

/** One full cycle of the playback timeline, in seconds at 1x. */
export const LOOP_SECONDS = 60;
/** How fast plate texture travels, scene units per second at 1x (accelerated teaching model). */
const PLATE_RATE = 7;

type Fade = { cur: number; target: number };
const FADE_KEYS = [
  'surface', 'plates', 'mantle', 'earthquakes', 'magma', 'volcanoes', 'motionArrows', 'crust', 'lithosphere',
  'asthenosphere', 'depth', 'gps', 'bathymetry', 'topography', 'temperature',
] as const;
type FadeKey = (typeof FADE_KEYS)[number];

export type LabelHandle = { el: HTMLElement; w: number; h: number };

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 16 / 9, 1, 20000);
  private target = new THREE.Vector3();
  private raf = 0;
  private last = 0;
  private dirty = true;
  private width = 1;
  private height = 1;
  private uiScale = 1;
  private panelInset = 0; // css px covered by the open panel on the right
  private offset = { cur: 0, target: 0 };
  private tween: { from: Pose; to: Pose; t: number; dur: number } | null = null;
  private fades = Object.fromEntries(FADE_KEYS.map((k) => [k, { cur: 0, target: 0 }])) as Record<FadeKey, Fade>;

  private modelTime = 0;
  private advect = 0;
  private dpr = 1;
  private maxDpr = 1;
  private adapted = false;
  private shown = false;
  private perf = { acc: 0, frames: 0, slow: 0, fast: 0 };

  private labels = new Map<LabelKey, LabelHandle>();
  private frameListeners = new Set<(progress: number) => void>();
  private cameraListeners = new Set<() => void>();
  private camSig = '';
  private raycaster = new THREE.Raycaster();
  private unsub: () => void;

  private sky = buildSky();
  private terrain = buildTerrain(SUN_DIR);
  private ocean = buildOcean(this.terrain.heightTex, this.terrain.heightTexBounds);
  private section = buildSection(this.terrain.profile);
  private quakes = buildQuakes();
  private magma = buildMagma();
  private water = buildWater();
  private flow = buildMantleFlow();
  private plume = buildPlume();
  private arrows = buildMotionArrows();
  private gps = buildGpsArrows();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setClearColor('#050505');
    this.renderer.setPixelRatio(this.dpr);

    this.scene.add(
      this.sky.mesh, this.terrain.mesh, this.ocean.mesh, this.section.mesh, this.quakes.points, this.magma.points,
      this.water.points, this.flow.points, this.plume.group, this.arrows.group, this.gps.group,
    );

    const st = useApp.getState();
    this.applyScene(st.scene, true);
    this.setPose(poseFor(st.scene.view, st.scene.focus));

    this.unsub = useApp.subscribe((s, prev) => {
      if (s.scene !== prev.scene) {
        this.applyScene(s.scene, false);
        if (s.scene.view !== prev.scene.view || s.scene.focus !== prev.scene.focus) this.flyTo(poseFor(s.scene.view, s.scene.focus));
      }
      if (s.seekReq !== prev.seekReq && s.seekReq) this.seek(s.seekReq.progress);
      if (s.resetSeq !== prev.resetSeq) {
        this.modelTime = 0;
        this.advect = 0;
      }
      this.dirty = true;
    });

    // Interactive boards and Chromebooks can drop the GPU context (sleep, driver reset). Recover by reloading.
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    canvas.addEventListener('webglcontextrestored', () => window.location.reload());

    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  // ------------------------------------------------------------ public api
  resize(width: number, height: number, uiScale: number) {
    this.width = width;
    this.height = height;
    this.uiScale = uiScale;
    // Pixel budget: about 1080p x 1.4 worth of pixels, so 4K boards and Chromebooks both hold frame rate.
    const budget = Math.sqrt((1920 * 1080 * 1.4) / Math.max(1, width * height));
    this.maxDpr = Math.max(0.5, Math.min(window.devicePixelRatio || 1, 1.5, budget));
    this.dpr = this.adapted ? Math.min(this.dpr, this.maxDpr) : this.maxDpr;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.updateProjection();
    this.dirty = true;
  }

  setPanelInset(px: number, instant = false) {
    this.panelInset = px;
    this.offset.target = px / 2;
    if (instant || prefersReducedMotion()) this.offset.cur = this.offset.target;
    this.dirty = true;
  }

  registerLabel(key: LabelKey, el: HTMLElement | null) {
    if (el) {
      const txt = el.querySelector<HTMLElement>('.txt') ?? el;
      this.labels.set(key, { el, w: txt.offsetWidth, h: txt.offsetHeight });
    } else this.labels.delete(key);
    this.dirty = true;
  }

  /** Text sizes change once the web font loads. */
  remeasureLabels() {
    this.labels.forEach((h) => {
      const txt = h.el.querySelector<HTMLElement>('.txt') ?? h.el;
      h.w = txt.offsetWidth;
      h.h = txt.offsetHeight;
    });
    this.dirty = true;
  }

  /** Called whenever the camera or projection changes (annotations re-project on this). */
  onCamera(fn: () => void) {
    this.cameraListeners.add(fn);
    return () => void this.cameraListeners.delete(fn);
  }

  /** Screen position (css px) of a world point; null when it is behind the camera. */
  project(v: [number, number, number]): [number, number] | null {
    const q = new THREE.Vector3(...v).project(this.camera);
    if (q.z > 1 || q.z < -1) return null;
    return [((q.x + 1) / 2) * this.width, ((1 - q.y) / 2) * this.height];
  }

  /** World point under a screen position: the cut face, else the landscape or sea, else far along the ray. */
  pick(cx: number, cy: number): [number, number, number] {
    this.raycaster.setFromCamera(new THREE.Vector2((cx / this.width) * 2 - 1, -(cy / this.height) * 2 + 1), this.camera);
    const { origin: o, direction: d } = this.raycaster.ray;
    if (o.z > 0 && d.z < 0) {
      const t = -o.z / d.z;
      const x = o.x + d.x * t;
      const y = o.y + d.y * t;
      if (x > X_MIN && x < X_MAX && y > SECTION_BOTTOM - 400 && y < Math.max(this.profileAt(x), 0)) return [x, y, 1.2];
    }
    const below = (t: number) => {
      const x = o.x + d.x * t;
      const z = o.z + d.z * t;
      if (z > 0) return false;
      return o.y + d.y * t < Math.max(heightAt(x, z), 0);
    };
    let prev = 0;
    for (let t = 2; t < 7000; t += Math.max(2, t * 0.012)) {
      if (below(t)) {
        let a = prev;
        let b = t;
        for (let i = 0; i < 10; i++) {
          const m = (a + b) / 2;
          if (below(m)) b = m;
          else a = m;
        }
        return [o.x + d.x * b, o.y + d.y * b + 0.5, o.z + d.z * b];
      }
      prev = t;
    }
    return [o.x + d.x * 1500, o.y + d.y * 1500, o.z + d.z * 1500];
  }

  private profileAt(x: number) {
    const prof = this.terrain.profile;
    const f = ((x - X_MIN) / (X_MAX - X_MIN)) * TERRAIN_NX;
    const i = Math.max(0, Math.min(TERRAIN_NX - 1, Math.floor(f)));
    const k = Math.min(1, Math.max(0, f - i));
    return prof[i] * (1 - k) + prof[i + 1] * k;
  }

  onFrame(fn: (progress: number) => void) {
    this.frameListeners.add(fn);
    fn(this.progress);
    return () => void this.frameListeners.delete(fn);
  }

  get progress() {
    return (this.modelTime % LOOP_SECONDS) / LOOP_SECONDS;
  }

  seek(progress: number) {
    const loops = Math.floor(this.modelTime / LOOP_SECONDS);
    const next = (loops + Math.min(0.9999, Math.max(0, progress))) * LOOP_SECONDS;
    if (useApp.getState().scene.layers.plateMotion) this.advect += (next - this.modelTime) * PLATE_RATE;
    this.modelTime = next;
    this.dirty = true;
  }

  /** Render a small still of a view or focus, for the View tab previews. */
  capture(kind: { view?: ViewMode; focus?: FocusKey }, w: number, h: number): string {
    const pose = kind.focus ? FOCUS_POSES[kind.focus] : VIEW_POSES[kind.view ?? 'combined'];
    const cam = new THREE.PerspectiveCamera(pose.fov, w / h, 1, 20000);
    cam.position.set(...pose.pos);
    cam.lookAt(...pose.target);
    const scale = 2;
    const rt = new THREE.WebGLRenderTarget(w * scale, h * scale, { samples: 4 });
    const prevSky = this.sky.mesh.position.clone();
    this.sky.mesh.position.copy(cam.position);
    this.terrain.material.uniforms.uCamPos.value.copy(cam.position);
    this.renderer.setRenderTarget(rt);
    this.renderer.render(this.scene, cam);
    const buf = new Uint8Array(w * scale * h * scale * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, w * scale, h * scale, buf);
    this.renderer.setRenderTarget(null);
    rt.dispose();
    this.sky.mesh.position.copy(prevSky);
    const c = document.createElement('canvas');
    c.width = w * scale;
    c.height = h * scale;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(w * scale, h * scale);
    const row = w * scale * 4;
    for (let y = 0; y < h * scale; y++) img.data.set(buf.subarray((h * scale - 1 - y) * row, (h * scale - y) * row), y * row);
    ctx.putImageData(img, 0, 0);
    this.dirty = true;
    return c.toDataURL('image/jpeg', 0.85);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.unsub();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
    this.renderer.dispose();
  }

  // ------------------------------------------------------------ internals
  private applyScene(s: SceneState, instant: boolean) {
    const l = s.layers;
    const e = s.evidence;
    const set = (k: FadeKey, on: boolean) => {
      this.fades[k].target = on ? 1 : 0;
      if (instant || prefersReducedMotion()) this.fades[k].cur = this.fades[k].target;
    };
    set('surface', l.surface);
    set('plates', l.plates);
    set('mantle', l.mantle);
    set('earthquakes', l.earthquakes);
    set('magma', l.magma);
    set('volcanoes', l.volcanoes && l.surface);
    set('motionArrows', l.motionArrows);
    set('crust', l.crust);
    set('lithosphere', l.lithosphere);
    set('asthenosphere', l.asthenosphere);
    set('depth', e.earthquakeDepth && l.earthquakes);
    set('gps', e.gps && l.surface);
    set('bathymetry', e.bathymetry);
    set('topography', e.topography);
    set('temperature', e.temperature);
    this.dirty = true;
  }

  private setPose(p: Pose) {
    this.camera.position.set(...p.pos);
    this.target.set(...p.target);
    this.camera.fov = p.fov;
    this.camera.lookAt(this.target);
    this.updateProjection();
  }

  private currentPose(): Pose {
    return {
      pos: this.camera.position.toArray() as Pose['pos'],
      target: this.target.toArray() as Pose['target'],
      fov: this.camera.fov,
    };
  }

  private flyTo(to: Pose) {
    if (prefersReducedMotion()) {
      this.tween = null;
      this.setPose(to);
      return;
    }
    this.tween = { from: this.currentPose(), to, t: 0, dur: 1.6 };
  }

  private updateProjection() {
    const w = this.width;
    const h = this.height;
    // Shift the projection so the scene is centered in the area not covered by Teacher Tools.
    this.camera.setViewOffset(w, h, this.offset.cur, 0, w, h);
    this.camera.updateProjectionMatrix();
  }

  private stepFades(dt: number) {
    let moving = false;
    const k = 1 - Math.exp(-dt * 7);
    for (const key of FADE_KEYS) {
      const f = this.fades[key];
      if (f.cur !== f.target) {
        f.cur += (f.target - f.cur) * k;
        if (Math.abs(f.cur - f.target) < 0.004) f.cur = f.target;
        moving = true;
      }
    }
    return moving;
  }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const st = useApp.getState();
    let active = false;

    let simDt = 0;
    if (st.playing) {
      simDt = dt * st.speed;
      this.modelTime += simDt;
      if (st.scene.layers.plateMotion) this.advect += simDt * PLATE_RATE;
      active = true;
    }

    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / tw.dur);
      const k = ease(tw.t);
      const lerp = (a: number[], b: number[]) => a.map((v, i) => v + (b[i] - v) * k) as [number, number, number];
      this.camera.position.set(...lerp(tw.from.pos, tw.to.pos));
      this.target.set(...lerp(tw.from.target, tw.to.target));
      this.camera.fov = tw.from.fov + (tw.to.fov - tw.from.fov) * k;
      this.camera.lookAt(this.target);
      if (tw.t >= 1) this.tween = null;
      active = true;
    }

    if (this.offset.cur !== this.offset.target) {
      const k = 1 - Math.exp(-dt * 9);
      this.offset.cur += (this.offset.target - this.offset.cur) * k;
      if (Math.abs(this.offset.cur - this.offset.target) < 0.5) this.offset.cur = this.offset.target;
      active = true;
    }
    this.updateProjection();

    if (this.stepFades(dt)) active = true;
    if (!active && !this.dirty) return;
    this.dirty = false;

    this.update(simDt);
    this.renderer.render(this.scene, this.camera);
    if (!this.shown) {
      this.shown = true;
      this.renderer.domElement.dataset.ready = '1';
    }
    const sig = this.camera.projectionMatrix.elements.join() + this.camera.matrixWorld.elements.join();
    if (sig !== this.camSig) {
      this.camSig = sig;
      this.cameraListeners.forEach((fn) => fn());
    }
    this.updateLabels(st.scene);
    const p = this.progress;
    this.frameListeners.forEach((fn) => fn(p));
    if (active) this.adaptQuality(dt);
  };

  private update(simDt: number) {
    const f = (k: FadeKey) => this.fades[k].cur;
    const t = this.modelTime;
    const px = this.dpr * Math.max(0.6, this.uiScale);

    const surf = f('surface');
    this.sky.mesh.visible = this.terrain.mesh.visible = this.ocean.mesh.visible = surf > 0.01;
    this.sky.mesh.position.copy(this.camera.position);
    this.sky.uniforms.uTime.value = t;
    this.terrain.material.uniforms.uCamPos.value.copy(this.camera.position);
    this.terrain.material.uniforms.uBathy.value = f('bathymetry');
    this.terrain.material.uniforms.uTopo.value = f('topography');
    this.ocean.uniforms.uTime.value = t;
    this.ocean.uniforms.uBathy.value = f('bathymetry');

    const cyc = cycleAt(t);
    const quakesOn = f('earthquakes');
    this.terrain.material.uniforms.uErupt.value = cyc.erupt * f('volcanoes');
    this.ocean.uniforms.uSince.value = cyc.since;
    this.ocean.uniforms.uQuakes.value = quakesOn;

    const su = this.section.uniforms;
    su.uTime.value = t;
    su.uStrain.value = cyc.strain;
    su.uSince.value = cyc.since;
    su.uDeform.value = cyc.deform;
    su.uErupt.value = cyc.erupt;
    su.uQuakes.value = quakesOn;
    su.uAdvect.value = this.advect;
    su.uSurface.value = surf > 0.5 ? 1 : 0;
    su.uPlates.value = f('plates');
    su.uMantle.value = f('mantle');
    su.uMagma.value = f('magma');
    su.uCrust.value = f('crust');
    su.uLith.value = f('lithosphere');
    su.uAsth.value = f('asthenosphere');
    su.uTemp.value = f('temperature');

    const q = this.quakes.uniforms;
    q.uTime.value = t;
    q.uSince.value = cyc.since;
    q.uPx.value = px;
    q.uOpacity.value = f('earthquakes') * (1 - 0.55 * f('temperature'));
    q.uDepthColor.value = f('depth');
    this.quakes.points.visible = f('earthquakes') > 0.01;

    const mg = f('magma');
    this.magma.points.visible = this.water.points.visible = mg > 0.01;
    if (mg > 0.01) {
      this.magma.update(t, px);
      this.magma.uniforms.uOpacity.value = mg;
      this.water.update(t, px);
      this.water.uniforms.uOpacity.value = mg;
    }

    const mt = f('mantle');
    this.flow.points.visible = mt > 0.01;
    if (mt > 0.01) {
      this.flow.update(simDt, px);
      this.flow.uniforms.uOpacity.value = mt * (1 - 0.7 * f('temperature'));
    }

    const vo = f('volcanoes');
    this.plume.group.visible = vo > 0.01;
    if (vo > 0.01) this.plume.update(t, vo);

    const ar = f('motionArrows');
    this.arrows.group.visible = ar > 0.01;
    this.arrows.materials.forEach((m, i) => (m.opacity = this.arrows.baseOpacity[i] * ar));

    const gp = f('gps');
    this.gps.group.visible = gp > 0.01;
    this.gps.material.opacity = 0.95 * gp;
  }

  private updateLabels(s: SceneState) {
    if (!this.labels.size) return;
    const layersOn = s.layers.labels;
    const allowed = s.labelSet ?? DEFAULT_LABELS;
    const W = this.width / this.uiScale;
    const H = this.height / this.uiScale;
    const panelLeft = (this.width - this.panelInset) / this.uiScale;
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const v = new THREE.Vector3();
    const camInFront = this.camera.position.z > 2;
    const order = [...LABELS].sort((a, b) => a.priority - b.priority);
    for (const def of order) {
      const h = this.labels.get(def.key);
      if (!h) continue;
      let show = layersOn && allowed.includes(def.key) && def.needs(s.layers) && (!def.onFace || camInFront);
      let x = 0;
      let y = 0;
      if (show) {
        v.set(...def.anchor).project(this.camera);
        if (v.z > 1 || v.z < -1) show = false;
        x = ((v.x + 1) / 2) * W;
        y = ((1 - v.y) / 2) * H;
        const tx = x + def.dx;
        const ty = y + def.dy;
        const left = def.dx >= 0 ? tx : tx - h.w;
        const box = { x0: Math.min(left, x) - 8, y0: Math.min(ty - h.h / 2, y) - 8, x1: Math.max(left + h.w, x) + 8, y1: Math.max(ty + h.h / 2, y) + 8 };
        // keep clear of the screen edges, the closed-state buttons and the bottom controls
        if (box.x0 < 8 || box.y0 < 8 || box.x1 > W - 8 || box.y1 > H - 112) show = false;
        if (!this.panelInset && box.y0 < 100 && box.x1 > W - 360) show = false;
        if (this.panelInset > 0 && box.x1 > panelLeft - 16) show = false;
        if (show && placed.some((p) => !(box.x1 < p.x0 || box.x0 > p.x1 || box.y1 < p.y0 || box.y0 > p.y1))) show = false;
        if (show) placed.push(box);
      }
      h.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      h.el.dataset.visible = show ? '1' : '0';
    }
  }

  private adaptQuality(dt: number) {
    const p = this.perf;
    p.acc += dt;
    p.frames++;
    if (p.acc < 1) return;
    const avg = p.acc / p.frames;
    p.acc = 0;
    p.frames = 0;
    if (avg > 1 / 32) p.slow++;
    else p.slow = 0;
    if (avg < 1 / 55) p.fast++;
    else p.fast = 0;
    if (p.slow >= 2 && this.dpr > 0.5) {
      this.dpr = Math.max(0.5, this.dpr - 0.2);
      this.adapted = true;
      this.renderer.setPixelRatio(this.dpr);
      this.renderer.setSize(this.width, this.height, false);
      p.slow = 0;
    } else if (p.fast >= 5 && this.dpr < this.maxDpr) {
      this.dpr = Math.min(this.maxDpr, this.dpr + 0.2);
      this.renderer.setPixelRatio(this.dpr);
      this.renderer.setSize(this.width, this.height, false);
      p.fast = 0;
    }
  }
}

