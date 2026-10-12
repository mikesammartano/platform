import type { Evidence, FocusKey, LabelKey, Layers, ViewMode } from '../state/types';

export type TeachStep = {
  title: string;
  /** What the teacher reveals. One short sentence, grade 8 reading level. */
  note: string;
  /** Question for students. */
  ask: string;
  view: ViewMode;
  focus: FocusKey | null;
  layers: Partial<Layers>;
  evidence: Partial<Evidence>;
  labels: LabelKey[];
};

const quiet: Partial<Layers> = {
  earthquakes: false,
  magma: false,
  motionArrows: false,
  mantle: false,
  crust: false,
  lithosphere: false,
  asthenosphere: false,
};

const noEvidence: Evidence = {
  earthquakeDepth: false,
  gps: false,
  bathymetry: false,
  topography: false,
  temperature: false,
};

export const TEACH_STEPS: TeachStep[] = [
  {
    title: 'Start',
    note: 'Look at the surface. An ocean meets a coast with tall mountains.',
    ask: 'What features do you notice?',
    view: 'surface',
    focus: null,
    layers: { ...quiet, surface: true, plates: true, volcanoes: true, labels: false },
    evidence: noEvidence,
    labels: [],
  },
  {
    title: 'Plates',
    note: 'Two plates meet here. Watch the arrows to see how each one moves.',
    ask: 'Which plate is moving beneath the other?',
    view: 'combined',
    focus: null,
    layers: { ...quiet, surface: true, plates: true, plateMotion: true, motionArrows: true, volcanoes: true, labels: true },
    evidence: noEvidence,
    labels: ['oceanic', 'continental', 'subduction'],
  },
  {
    title: 'Trench',
    note: 'The plate boundary is under the ocean. Colors show how deep the water is.',
    ask: 'What happens to the seafloor near the boundary?',
    view: 'combined',
    focus: 'trench',
    layers: { ...quiet, surface: true, plates: true, plateMotion: true, volcanoes: true, labels: true },
    evidence: { ...noEvidence, bathymetry: true },
    labels: ['trench', 'oceanic', 'continental'],
  },
  {
    title: 'Earthquakes',
    note: 'Notice how earthquake depth changes beneath the continent.',
    ask: 'What pattern do you notice?',
    view: 'combined',
    focus: 'earthquakes',
    layers: { ...quiet, surface: true, plates: true, plateMotion: true, earthquakes: true, volcanoes: true, labels: true },
    evidence: { ...noEvidence, earthquakeDepth: true },
    labels: ['earthquakes', 'subduction'],
  },
  {
    title: 'Magma',
    note: 'Water leaves the sinking plate. It helps the hot mantle above it partly melt.',
    ask: 'Where does melting occur relative to the descending plate?',
    view: 'combined',
    focus: 'wedge',
    layers: { ...quiet, surface: true, plates: true, plateMotion: true, mantle: true, magma: true, volcanoes: true, labels: true },
    evidence: noEvidence,
    labels: ['wedge', 'magma'],
  },
  {
    title: 'Volcanic arc',
    note: 'Melted rock rises, collects in the crust, and some of it erupts.',
    ask: 'Why are volcanoes located inland from the trench?',
    view: 'combined',
    focus: 'arc',
    layers: { ...quiet, surface: true, plates: true, plateMotion: true, magma: true, volcanoes: true, labels: true },
    evidence: noEvidence,
    labels: ['arc', 'magma', 'trench'],
  },
  {
    title: 'Complete system',
    note: 'All of the parts are shown together.',
    ask: 'How are these features connected?',
    view: 'combined',
    focus: null,
    layers: {
      ...quiet,
      surface: true,
      plates: true,
      plateMotion: true,
      earthquakes: true,
      magma: true,
      volcanoes: true,
      motionArrows: true,
      labels: true,
    },
    evidence: noEvidence,
    labels: ['oceanic', 'trench', 'subduction', 'earthquakes', 'continental', 'magma', 'arc'],
  },
];
