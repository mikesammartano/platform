import {
  ArrowUUpLeft, ArrowUUpRight, ArrowUpRight, ArrowsCounterClockwise, CaretRight, Check, Circle, CornersIn, Eraser, Eye,
  Flashlight, FrameCorners, Highlighter, type Icon as PhosphorIcon, type IconWeight, MonitorPlay, Pause, PencilSimple, Play,
  PlayCircle, Pulse, SidebarSimple, SignOut, SlidersHorizontal, TextT, Trash,
} from '@phosphor-icons/react';

/** Phosphor icons (regular weight) for every control: simple, consistent strokes. */
export const ICONS = {
  show: Eye,
  evidence: Pulse,
  draw: PencilSimple,
  view: FrameCorners,
  pen: PencilSimple,
  highlighter: Highlighter,
  arrow: ArrowUpRight,
  circle: Circle,
  label: TextT,
  spotlight: Flashlight,
  eraser: Eraser,
  clear: Trash,
  undo: ArrowUUpLeft,
  redo: ArrowUUpRight,
  chevron: CaretRight,
  check: Check,
  reset: ArrowsCounterClockwise,
  collapse: SidebarSimple,
  exitTeach: SignOut,
  exitPresent: CornersIn,
  tools: SlidersHorizontal,
  presentScreen: MonitorPlay,
  teach: PlayCircle,
} satisfies Record<string, PhosphorIcon>;

export type IconName = keyof typeof ICONS;

export function Icon({ i, size = 24, stroke = 'currentColor', weight = 'regular' }: { i: IconName; size?: number; stroke?: string; weight?: IconWeight }) {
  const C = ICONS[i];
  return <C size={size} color={stroke} weight={weight} aria-hidden="true" />;
}

export function PauseGlyph({ size = 24 }: { size?: number }) {
  return <Pause size={size} weight="fill" aria-hidden="true" />;
}

export function PlayGlyph({ size = 24 }: { size?: number }) {
  return <Play size={size} weight="fill" aria-hidden="true" />;
}
