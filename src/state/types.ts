export type LayerKey =
  | 'surface'
  | 'plates'
  | 'mantle'
  | 'plateMotion'
  | 'earthquakes'
  | 'magma'
  | 'volcanoes'
  | 'labels'
  | 'motionArrows'
  | 'crust'
  | 'lithosphere'
  | 'asthenosphere';

export type Layers = Record<LayerKey, boolean>;

/** Earthquakes is shared with Layers so Show and Evidence never disagree. */
export type EvidenceKey = 'earthquakeDepth' | 'gps' | 'bathymetry' | 'topography' | 'temperature';
export type Evidence = Record<EvidenceKey, boolean>;

export type ViewMode = 'surface' | 'combined' | 'section';
export type FocusKey = 'trench' | 'subduction' | 'earthquakes' | 'wedge' | 'arc';

export type LabelKey =
  | 'oceanic'
  | 'trench'
  | 'subduction'
  | 'earthquakes'
  | 'continental'
  | 'wedge'
  | 'magma'
  | 'arc'
  | 'crust'
  | 'lithosphere'
  | 'asthenosphere';

export type SceneState = {
  layers: Layers;
  evidence: Evidence;
  view: ViewMode;
  focus: FocusKey | null;
  /** When set (Teach mode), only these labels are eligible. */
  labelSet: LabelKey[] | null;
};

export type Tab = 'show' | 'evidence' | 'draw' | 'view';

export type DrawTool = 'pen' | 'highlighter' | 'arrow' | 'circle' | 'label' | 'spotlight' | 'eraser';

/**
 * Annotation geometry is stored as world points picked on the scene (the cut face, the landscape or the sea),
 * so marks stay attached to the feature they point at when the view or focus changes.
 */
export type Annotation = {
  id: number;
  kind: 'pen' | 'highlighter' | 'arrow' | 'circle' | 'label';
  color: string;
  width: number;
  points: [number, number, number][];
  text?: string;
};
