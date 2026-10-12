import { useEffect, useRef, useState } from 'react';
import { Engine } from './scene/Engine';
import { useApp } from './state/store';
import { EngineCtx } from './ui/context';
import { Ink } from './ui/Ink';
import { LabelLayer } from './ui/Labels';
import {
  ClosedControls, ExitPresentButton, InfoButton, Legends, MiniPlayback, ModelNote, Playback, enterPresentation, exitPresentation,
} from './ui/Overlay';
import { Panel } from './ui/Panel';

/** UI reference size from the design. The interface scales with the display height. */
const REF_H = 1080;
const REF_W = 1500; // narrowest width that still fits the panel, playback and legends side by side
const PANEL_SPACE = 416 + 32;
const PLAYBACK_W = 440;

function useViewport() {
  const read = () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const s = Math.max(0.5, Math.min(vh / REF_H, vw / REF_W));
    return { vw, vh, s };
  };
  const [v, setV] = useState(read);
  useEffect(() => {
    const on = () => setV(read());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return v;
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, [contenteditable]')) return;
      const st = useApp.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === ' ' && !t.closest('button, [role=slider]')) {
        e.preventDefault();
        st.togglePlay();
      } else if (e.key === 'Escape') {
        if (st.presenting) void exitPresentation();
        else if (st.teach.active) st.exitTeach();
      } else if (st.teach.active && (e.key === 'ArrowRight' || e.key === 'PageDown')) {
        // presentation clickers send PageDown / PageUp
        st.teachGo(st.teach.step + 1);
      } else if (st.teach.active && (e.key === 'ArrowLeft' || e.key === 'PageUp')) {
        st.teachGo(st.teach.step - 1);
      } else if (e.key.toLowerCase() === 'l') {
        st.toggleLayer('labels');
      } else if (e.key.toLowerCase() === 'p') {
        if (st.presenting) void exitPresentation();
        else void enterPresentation();
      } else if (e.key.toLowerCase() === 't' && !st.presenting) {
        st.setPanelOpen(!st.panelOpen);
      }
    };
    const onFs = () => {
      // leaving browser fullscreen (e.g. with the Esc key) also leaves Presentation mode
      if (!document.fullscreenElement && useApp.getState().presenting) useApp.getState().setPresenting(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, []);
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [failed, setFailed] = useState(false);
  const { vw, vh, s } = useViewport();
  const panelOpen = useApp((st) => st.panelOpen);
  const presenting = useApp((st) => st.presenting);
  useShortcuts();

  useEffect(() => {
    let e: Engine | null = null;
    try {
      e = new Engine(canvasRef.current!);
      setEngine(e);
      // test hook for the end-to-end suite and debugging (development builds only)
      if (import.meta.env.DEV) Object.assign(window, { __engine: e, __app: useApp });
    } catch (err) {
      console.error(err);
      setFailed(true);
    }
    return () => e?.dispose();
  }, []);

  useEffect(() => {
    engine?.resize(vw, vh, s);
  }, [engine, vw, vh, s]);

  const open = panelOpen && !presenting;
  const insetPx = open ? PANEL_SPACE * s : 0;
  useEffect(() => {
    engine?.setPanelInset(insetPx);
  }, [engine, insetPx]);

  useEffect(() => {
    if (!engine) return;
    document.fonts?.ready.then(() => engine.remeasureLabels());
  }, [engine]);

  const W = vw / s;
  const H = vh / s;
  const playLeft = (W - (open ? PANEL_SPACE : 0) - PLAYBACK_W) / 2;

  return (
    <EngineCtx.Provider value={engine}>
      <main className="stage">
        <canvas ref={canvasRef} className="gl" aria-label="Animated model of an ocean plate sinking beneath a continent" role="img" />
        {failed && (
          <div className="webgl-fallback">This visualization needs WebGL 2. Try a current version of Chrome, Edge, Safari or Firefox.</div>
        )}
        <div className="ui passive" style={{ width: W, height: H, transform: `scale(${s})` }}>
          <LabelLayer />
        </div>
        <Ink uiScale={s} panelInset={insetPx} />
        <div className="ui" style={{ width: W, height: H, transform: `scale(${s})` }}>
          <Legends />
          {presenting ? (
            <>
              <InfoButton />
              <MiniPlayback left={(W - PLAYBACK_W) / 2} />
              <ExitPresentButton />
            </>
          ) : (
            <>
              <ModelNote />
              <Playback left={playLeft} />
              {!panelOpen && <ClosedControls />}
            </>
          )}
          <Panel />
        </div>
      </main>
    </EngineCtx.Provider>
  );
}
