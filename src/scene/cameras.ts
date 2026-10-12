import type { FocusKey, ViewMode } from '../state/types';
import { ARC_X, MELT, VOLCANO, slabPoint } from './model';

export type Pose = { pos: [number, number, number]; target: [number, number, number]; fov: number };

const quakeMid = slabPoint(200, 10);
const iface = slabPoint(55, 0);

/** Curated camera states. The teacher picks a feature; there is no free camera. */
export const VIEW_POSES: Record<ViewMode, Pose> = {
  combined: { pos: [-40, 150, 900], target: [130, 10, -200], fov: 38 },
  surface: { pos: [-260, 105, -70], target: [150, 6, -480], fov: 44 },
  section: { pos: [140, -128, 900], target: [140, -128, 0], fov: 30 },
};

export const FOCUS_POSES: Record<FocusKey, Pose> = {
  trench: { pos: [-150, 70, 300], target: [10, -38, -40], fov: 36 },
  subduction: { pos: [-70, 40, 330], target: [iface.x + 25, iface.y - 15, 0], fov: 36 },
  earthquakes: { pos: [quakeMid.x - 40, quakeMid.y + 110, 560], target: [quakeMid.x + 20, quakeMid.y - 35, 0], fov: 36 },
  wedge: { pos: [MELT.x - 70, MELT.y + 120, 330], target: [MELT.x + 10, MELT.y - 5, 0], fov: 36 },
  arc: { pos: [ARC_X - 230, 120, 330], target: [VOLCANO.x + 10, -25, -40], fov: 36 },
};

export const poseFor = (view: ViewMode, focus: FocusKey | null): Pose => (focus ? FOCUS_POSES[focus] : VIEW_POSES[view]);
