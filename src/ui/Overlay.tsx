import { useContext, useEffect, useRef, useState } from 'react';
import { DEPTH_STOPS } from '../scene/effects';
import { useApp } from '../state/store';
import { EngineCtx } from './context';
import { Icon, PATHS, PauseGlyph, PlayGlyph } from './icons';

export async function enterPresentation() {
  useApp.getState().setPresenting(true);
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
  } catch {
    /* fullscreen is optional (blocked in some embeds) */
  }
}

export async function exitPresentation() {
  useApp.getState().setPresenting(false);
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
  } catch {
    /* ignore */
  }
}

function ToolsButton({ size = 30 }: { size?: number }) {
  const setOpen = useApp((s) => s.setPanelOpen);
  return (
    <button className="tools-btn glass" onClick={() => setOpen(true)} aria-label="Open Teacher Tools">
      <Icon d={PATHS.open} size={size} />
      Tools
    </button>
  );
}

export function ClosedControls() {
  return (
    <>
      <button className="tools-btn glass present-btn" onClick={enterPresentation} aria-label="Present full screen">
        <Icon d={PATHS.present} size={28} />
        Present
      </button>
      <ToolsButton />
    </>
  );
}

/** Presentation: Teacher Tools stay one tap away, next to Exit. */
export function PresentControls() {
  return (
    <div className="top-actions">
      <ToolsButton size={24} />
      <button className="exit-present" onClick={exitPresentation} aria-label="Exit presentation">
        <Icon d={PATHS.exitPresent} size={24} />
        Exit
      </button>
    </div>
  );
}

function useProgress(fillRef: React.RefObject<HTMLDivElement | null>, trackRef: React.RefObject<HTMLDivElement | null>) {
  const engine = useContext(EngineCtx);
  useEffect(() => {
    if (!engine) return;
    let lastPct = -1;
    return engine.onFrame((p) => {
      const pct = Math.round(p * 1000) / 10;
      if (pct === lastPct) return;
      lastPct = pct;
      if (fillRef.current) fillRef.current.style.width = `${pct}%`;
      trackRef.current?.setAttribute('aria-valuenow', String(Math.round(pct)));
    });
  }, [engine, fillRef, trackRef]);
  return engine;
}

function Track({ mini }: { mini?: boolean }) {
  const fill = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const engine = useProgress(fill, track);
  const seekFromEvent = (e: React.PointerEvent) => {
    const r = track.current!.getBoundingClientRect();
    engine?.seek((e.clientX - r.left) / r.width);
  };
  return (
    <div
      ref={track}
      className="track"
      role="slider"
      tabIndex={0}
      aria-label="Animation progress"
      aria-valuemin={0}
      aria-valuemax={100}
      onPointerDown={(e) => {
        track.current!.setPointerCapture(e.pointerId);
        seekFromEvent(e);
      }}
      onPointerMove={(e) => {
        if (track.current!.hasPointerCapture(e.pointerId)) seekFromEvent(e);
      }}
      onKeyDown={(e) => {
        if (!engine) return;
        if (e.key === 'ArrowRight') engine.seek(engine.progress + 0.05);
        else if (e.key === 'ArrowLeft') engine.seek(engine.progress - 0.05);
        else if (e.key === 'Home') engine.seek(0);
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="rail" style={mini ? { height: 4 } : undefined}>
        <div className="fill" ref={fill} />
      </div>
    </div>
  );
}

function useIdle(ms: number) {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let t = window.setTimeout(() => setIdle(true), ms);
    const wake = () => {
      setIdle(false);
      window.clearTimeout(t);
      t = window.setTimeout(() => setIdle(true), ms);
    };
    window.addEventListener('pointermove', wake);
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
  }, [ms]);
  return idle;
}

export function Playback({ left }: { left: number }) {
  const playing = useApp((s) => s.playing);
  const speed = useApp((s) => s.speed);
  const toggle = useApp((s) => s.togglePlay);
  const cycle = useApp((s) => s.cycleSpeed);
  const idle = useIdle(5000);
  return (
    <div className="playback" style={{ left }} data-idle={idle && playing ? '1' : '0'} role="group" aria-label="Playback">
      <button className="pp" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <PauseGlyph /> : <PlayGlyph />}
      </button>
      <Track />
      <button className="speed" onClick={cycle} aria-label={`Speed ${speed} times. Change speed`}>
        {speed === 0.5 ? '½' : speed}×
      </button>
    </div>
  );
}

export function MiniPlayback({ left }: { left: number }) {
  const playing = useApp((s) => s.playing);
  const toggle = useApp((s) => s.togglePlay);
  return (
    <div className="mini-playback" style={{ left }} role="group" aria-label="Playback">
      <button className="pp" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <PauseGlyph /> : <PlayGlyph />}
      </button>
      <Track mini />
    </div>
  );
}

const grad = (stops: string[]) => `linear-gradient(90deg, ${stops.join(', ')})`;

export function Legends() {
  const quakes = useApp((s) => s.scene.layers.earthquakes);
  const ev = useApp((s) => s.scene.evidence);
  const surface = useApp((s) => s.scene.layers.surface);
  const items: React.ReactNode[] = [];
  if (ev.gps && surface)
    items.push(
      <div className="legend" key="gps">
        <div className="t">Plate motion</div>
        <div className="row">
          <svg width="56" height="16" viewBox="0 0 56 16" aria-hidden="true" style={{ flex: 'none' }}>
            <path d="M2 8h42M40 2l12 6-12 6z" stroke="#FFE08A" strokeWidth="4" fill="#FFE08A" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
          7 cm per year
        </div>
      </div>,
    );
  if (ev.bathymetry)
    items.push(
      <div className="legend" key="bathy">
        <div className="t">Ocean depth</div>
        <div className="bar" style={{ background: grad(['#9EE6E0', '#3DA8CC', '#2166B3', '#1F3385', '#1A0F4D']) }} />
        <div className="ends"><span>0 km</span><span>8 km</span></div>
      </div>,
    );
  if (ev.topography)
    items.push(
      <div className="legend" key="topo">
        <div className="t">Elevation</div>
        <div className="bar" style={{ background: grad(['#407A3D', '#A8A852', '#A8703D', '#7A4F3D', '#F2F0EB']) }} />
        <div className="ends"><span>0 km</span><span>6 km</span></div>
      </div>,
    );
  if (ev.temperature)
    items.push(
      <div className="legend" key="temp">
        <div className="t">Temperature</div>
        <div className="bar" style={{ background: grad(['#29459E', '#3899CC', '#F2E6A8', '#F29E40', '#D14029', '#73122B']) }} />
        <div className="ends"><span>Cold</span><span>Hot</span></div>
      </div>,
    );
  if (quakes && ev.earthquakeDepth)
    items.push(
      <div className="legend" key="depth">
        <div className="t">Earthquake depth</div>
        <div className="bar" style={{ background: grad(DEPTH_STOPS) }} />
        <div className="ends"><span>Shallow</span><span>Deep</span></div>
      </div>,
    );
  if (!items.length) return null;
  return <div className="legends passive" aria-live="polite">{items.slice(-3)}</div>;
}
