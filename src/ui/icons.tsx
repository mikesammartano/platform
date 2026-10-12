import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number; stroke?: string; sw?: number };

export function Icon({ d, size = 24, stroke = 'currentColor', sw = 1.75, ...rest }: P & { d: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      <path d={d} />
    </svg>
  );
}

/** Paths from the approved design (ToolsScene6). */
export const PATHS = {
  show: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9.25a2.75 2.75 0 100 5.5 2.75 2.75 0 000-5.5z',
  evidence: 'M3 12h4l3-7 4 14 3-7h4',
  draw: 'M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19zM14 7l3 3',
  view: 'M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4',
  pen: 'M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19zM14 7l3 3',
  highlighter: 'M15 4l5 5-9 9H6v-5zM3 21h8',
  arrow: 'M5 19L19 5M9 5h10v10',
  circle: 'M12 4a8 8 0 100 16 8 8 0 000-16z',
  label: 'M4 5h16v14H4zM8.5 9.5h7M12 9.5V15',
  spotlight: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 8a4 4 0 100 8 4 4 0 000-8z',
  eraser: 'M7 20h12M5.5 15.5l9-9a2 2 0 013 0l2 2a2 2 0 010 3L12 19H8l-2.5-2.5a1.4 1.4 0 010-1z',
  clear: 'M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3',
  chevron: 'M9 5l7 7-7 7',
  check: 'M5 12.5l4.5 4.5L19 7',
  reset: 'M4 5v5h5M5.2 14.5A8 8 0 1 0 6 7.2L4 10',
  collapse: 'M3.5 7a2.5 2.5 0 012.5-2.5h12A2.5 2.5 0 0120.5 7v10a2.5 2.5 0 01-2.5 2.5H6A2.5 2.5 0 013.5 17zM14.5 4.5v15M16.3 9.5l2.5 2.5-2.5 2.5',
  open: 'M3.5 7a2.5 2.5 0 012.5-2.5h12A2.5 2.5 0 0120.5 7v10a2.5 2.5 0 01-2.5 2.5H6A2.5 2.5 0 013.5 17zM14.5 4.5v15M18.5 9.5L16 12l2.5 2.5',
  exitTeach: 'M10 4H5v16h5M15 8l4 4-4 4M19 12H9',
  exitPresent: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
  /** Teacher Tools: three sliders */
  tools: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4a2 2 0 100 4 2 2 0 000-4zM9 10a2 2 0 100 4 2 2 0 000-4zM17 16a2 2 0 100 4 2 2 0 000-4z',
  /** Present: a display with a play mark */
  presentScreen: 'M3.5 5.5A1.5 1.5 0 015 4h14a1.5 1.5 0 011.5 1.5v10A1.5 1.5 0 0119 17H5a1.5 1.5 0 01-1.5-1.5zM12 17v3.5M8.5 20.5h7M10.5 8v6l5-3z',
  present: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  info: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 11v6M12 7.5v.01',
  teach: 'M12 2.5a9.5 9.5 0 100 19 9.5 9.5 0 000-19zM10 8.4v7.2l5.8-3.6z',
} as const;

export function PauseGlyph({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="5.5" y="4" width="4.5" height="16" rx="1.2" />
      <rect x="14" y="4" width="4.5" height="16" rx="1.2" />
    </svg>
  );
}

export function PlayGlyph({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7 4.6v14.8a1 1 0 001.5.86l12.2-7.4a1 1 0 000-1.72L8.5 3.74A1 1 0 007 4.6z" />
    </svg>
  );
}
