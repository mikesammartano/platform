import { create } from 'zustand';
import { TEACH_STEPS } from '../content/teach';
import type {
  Annotation, DrawTool, Evidence, EvidenceKey, FocusKey, LayerKey, Layers, SceneState, Tab, ViewMode,
} from './types';

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** The topic's initial instructional state (what Reset returns to). */
export const INITIAL_LAYERS: Layers = {
  surface: true,
  plates: true,
  mantle: false,
  plateMotion: true,
  earthquakes: true,
  magma: true,
  volcanoes: true,
  labels: true,
  motionArrows: false,
  crust: false,
  lithosphere: false,
  asthenosphere: false,
};

export const INITIAL_EVIDENCE: Evidence = {
  earthquakeDepth: false,
  gps: false,
  bathymetry: false,
  topography: false,
  temperature: false,
};

const initialScene = (): SceneState => ({
  layers: { ...INITIAL_LAYERS },
  evidence: { ...INITIAL_EVIDENCE },
  view: 'combined',
  focus: null,
  labelSet: null,
});

export const SPEEDS = [0.5, 1, 2] as const;

type History = { past: Annotation[][]; future: Annotation[][] };

export type AppState = {
  scene: SceneState;
  panelOpen: boolean;
  tab: Tab;
  geologyOpen: boolean;
  presenting: boolean;
  noteOpen: boolean;
  teach: { active: boolean; step: number };

  playing: boolean;
  speed: (typeof SPEEDS)[number];
  /** Incremented to ask the engine to rewind the model clock. */
  resetSeq: number;
  /** Teach steps can jump the timeline to the moment that shows their idea. */
  seekReq: { progress: number } | null;

  draw: { tool: DrawTool; color: string; width: number };
  annotations: Annotation[];
  history: History;

  toggleLayer: (k: LayerKey) => void;
  toggleEarthquakes: () => void;
  toggleEvidence: (k: EvidenceKey) => void;
  setView: (v: ViewMode) => void;
  setFocus: (f: FocusKey | null) => void;
  setTab: (t: Tab) => void;
  setPanelOpen: (open: boolean) => void;
  setGeologyOpen: (open: boolean) => void;
  setPresenting: (on: boolean) => void;
  setNoteOpen: (on: boolean) => void;

  startTeach: () => void;
  teachGo: (step: number) => void;
  exitTeach: () => void;

  togglePlay: () => void;
  cycleSpeed: () => void;
  setPlaying: (p: boolean) => void;

  reset: () => void;

  setTool: (t: DrawTool) => void;
  setColor: (c: string) => void;
  setWidth: (w: number) => void;
  commitAnnotations: (next: Annotation[]) => void;
  undo: () => void;
  redo: () => void;
  clearAnnotations: () => void;
};

const applyStep = (step: number): SceneState => {
  const s = TEACH_STEPS[step];
  return {
    layers: { ...INITIAL_LAYERS, ...s.layers },
    evidence: { ...INITIAL_EVIDENCE, ...s.evidence },
    view: s.view,
    focus: s.focus,
    labelSet: s.labels,
  };
};

export const useApp = create<AppState>()((set, get) => ({
  scene: initialScene(),
  panelOpen: false,
  tab: 'show',
  geologyOpen: false,
  presenting: false,
  noteOpen: false,
  teach: { active: false, step: 0 },

  playing: !prefersReducedMotion(),
  speed: 1,
  resetSeq: 0,
  seekReq: null,

  draw: { tool: 'pen', color: '#F2C94C', width: 7 },
  annotations: [],
  history: { past: [], future: [] },

  toggleLayer: (k) =>
    set((st) => ({ scene: { ...st.scene, labelSet: null, layers: { ...st.scene.layers, [k]: !st.scene.layers[k] } } })),

  toggleEarthquakes: () =>
    set((st) => {
      const on = !st.scene.layers.earthquakes;
      return {
        scene: {
          ...st.scene,
          labelSet: null,
          layers: { ...st.scene.layers, earthquakes: on },
          // depth coloring only makes sense while earthquakes are visible
          evidence: on ? st.scene.evidence : { ...st.scene.evidence, earthquakeDepth: false },
        },
      };
    }),

  toggleEvidence: (k) =>
    set((st) => {
      const on = !st.scene.evidence[k];
      const layers = k === 'earthquakeDepth' && on ? { ...st.scene.layers, earthquakes: true } : st.scene.layers;
      return { scene: { ...st.scene, labelSet: null, layers, evidence: { ...st.scene.evidence, [k]: on } } };
    }),

  setView: (view) => set((st) => ({ scene: { ...st.scene, view, focus: null } })),
  setFocus: (focus) =>
    set((st) => ({
      scene: { ...st.scene, focus, view: st.scene.view === 'surface' && focus ? 'combined' : st.scene.view },
    })),
  setTab: (tab) => set({ tab }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  setGeologyOpen: (geologyOpen) => set({ geologyOpen }),
  // entering Presentation starts clean (tools collapsed); the Tools button can still open them while presenting
  setPresenting: (presenting) => set((st) => ({ presenting, noteOpen: false, panelOpen: presenting ? false : st.panelOpen })),
  setNoteOpen: (noteOpen) => set({ noteOpen }),

  startTeach: () => set({ teach: { active: true, step: 0 }, panelOpen: true, scene: applyStep(0) }),
  teachGo: (step) => {
    const clamped = Math.max(0, Math.min(TEACH_STEPS.length - 1, step));
    if (clamped === get().teach.step && get().teach.active) return;
    const seek = TEACH_STEPS[clamped].seek;
    set({
      teach: { active: true, step: clamped },
      scene: applyStep(clamped),
      ...(seek !== undefined ? { seekReq: { progress: seek }, playing: !prefersReducedMotion() || get().playing } : {}),
    });
  },
  // Leaving Teach keeps the scene the teacher is looking at; Reset is available for a clean start.
  exitTeach: () => set((st) => ({ teach: { active: false, step: 0 }, scene: { ...st.scene, labelSet: null } })),

  togglePlay: () => set((st) => ({ playing: !st.playing })),
  cycleSpeed: () => set((st) => ({ speed: SPEEDS[(SPEEDS.indexOf(st.speed) + 1) % SPEEDS.length] })),
  setPlaying: (playing) => set({ playing }),

  // Reset view, layers, evidence, playback and focus. Annotations are kept: Draw has its own Clear.
  reset: () =>
    set((st) => ({
      scene: initialScene(),
      geologyOpen: false,
      playing: !prefersReducedMotion(),
      speed: 1,
      resetSeq: st.resetSeq + 1,
      teach: { active: false, step: 0 },
    })),

  setTool: (tool) => set((st) => ({ draw: { ...st.draw, tool } })),
  setColor: (color) => set((st) => ({ draw: { ...st.draw, color } })),
  setWidth: (width) => set((st) => ({ draw: { ...st.draw, width } })),

  commitAnnotations: (next) => {
    const { annotations, history } = get();
    set({ annotations: next, history: { past: [...history.past, annotations].slice(-100), future: [] } });
  },
  undo: () => {
    const { annotations, history } = get();
    if (!history.past.length) return;
    const prev = history.past[history.past.length - 1];
    set({ annotations: prev, history: { past: history.past.slice(0, -1), future: [annotations, ...history.future] } });
  },
  redo: () => {
    const { annotations, history } = get();
    if (!history.future.length) return;
    const [next, ...rest] = history.future;
    set({ annotations: next, history: { past: [...history.past, annotations], future: rest } });
  },
  clearAnnotations: () => {
    if (!get().annotations.length) return;
    get().commitAnnotations([]);
  },
}));
