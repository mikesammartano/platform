import type { LabelKey, Layers } from '../state/types';
import { ARC_X, MELT, VOLCANO, labY, slabPoint, slabTopY } from './model';
import { heightAt } from './terrain';

export type LabelDef = {
  key: LabelKey;
  text: string;
  anchor: [number, number, number];
  /** Text offset from the anchor in reference px (1920 wide UI). */
  dx: number;
  dy: number;
  /** Lower number wins when labels collide. Geology labels outrank activity labels because the teacher turned them on. */
  priority: number;
  /** Which layers must be visible for the label to be meaningful. */
  needs: (l: Layers) => boolean;
  /** Anchors on the cut face are only visible from in front of it. */
  onFace: boolean;
};

const sub = slabPoint(62, 0);
const eq = slabPoint(235, 10);
const wedgeX = ARC_X + 55;

export const LABELS: LabelDef[] = [
  { key: 'trench', text: 'Ocean trench', anchor: [0, -39, 0.5], dx: -40, dy: -84, priority: 1, needs: () => true, onFace: true },
  { key: 'subduction', text: 'Subduction zone', anchor: [sub.x, sub.y, 0.5], dx: -60, dy: 70, priority: 2, needs: (l) => l.plates, onFace: true },
  { key: 'earthquakes', text: 'Earthquakes', anchor: [eq.x, eq.y, 1], dx: -70, dy: 64, priority: 3, needs: (l) => l.earthquakes, onFace: true },
  {
    key: 'arc', text: 'Volcanic arc', anchor: [VOLCANO.x, heightAt(VOLCANO.x, VOLCANO.z) + 1, VOLCANO.z], dx: -60, dy: -70, priority: 4,
    needs: (l) => l.surface, onFace: false,
  },
  { key: 'oceanic', text: 'Oceanic plate', anchor: [-330, slabPoint(-330, 30).y, 0.5], dx: -40, dy: -70, priority: 5, needs: (l) => l.plates, onFace: true },
  { key: 'continental', text: 'Continental plate', anchor: [ARC_X + 250, -30, 0.5], dx: 50, dy: -60, priority: 6, needs: (l) => l.plates, onFace: true },
  { key: 'magma', text: 'Magma generation', anchor: [MELT.x, MELT.y, 0.5], dx: 70, dy: 40, priority: 7, needs: (l) => l.magma, onFace: true },
  {
    key: 'wedge', text: 'Mantle wedge', anchor: [wedgeX, (labY(wedgeX) + slabTopY(wedgeX)) / 2 - 4, 0.5], dx: 80, dy: -36, priority: 8,
    needs: (l) => l.mantle || l.magma, onFace: true,
  },
  { key: 'crust', text: 'Crust', anchor: [ARC_X - 55, -18, 0.5], dx: -70, dy: -50, priority: 2.5, needs: (l) => l.crust, onFace: true },
  {
    key: 'lithosphere', text: 'Lithosphere', anchor: [slabPoint(-250, 55).x, slabPoint(-250, 55).y, 0.5], dx: 60, dy: -46, priority: 2.6,
    needs: (l) => l.lithosphere, onFace: true,
  },
  { key: 'asthenosphere', text: 'Asthenosphere', anchor: [-300, -135, 0.5], dx: 60, dy: 40, priority: 2.7, needs: (l) => l.asthenosphere, onFace: true },
];

/** Labels shown outside Teach mode, most important first. Geology labels appear when their layer is on. */
export const DEFAULT_LABELS: LabelKey[] = [
  'trench', 'subduction', 'earthquakes', 'arc', 'oceanic', 'continental', 'magma', 'wedge', 'crust', 'lithosphere', 'asthenosphere',
];
