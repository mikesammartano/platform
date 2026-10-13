import { type CSSProperties, useContext, useEffect, useRef, useState } from 'react';
import { TEACH_STEPS } from '../content/teach';
import { useApp } from '../state/store';
import type { DrawTool, EvidenceKey, FocusKey, LayerKey, Tab, ViewMode } from '../state/types';
import { EngineCtx } from './context';
import { Icon, PATHS } from './icons';

const TABS: { id: Tab; label: string; d: string }[] = [
  { id: 'show', label: 'Show', d: PATHS.show },
  { id: 'evidence', label: 'Evidence', d: PATHS.evidence },
  { id: 'draw', label: 'Draw', d: PATHS.draw },
  { id: 'view', label: 'View', d: PATHS.view },
];

export function Panel() {
  const open = useApp((s) => s.panelOpen);
  const tab = useApp((s) => s.tab);
  const teaching = useApp((s) => s.teach.active);
  const setTab = useApp((s) => s.setTab);

  return (
    <aside className="panel lg" data-open={open ? '1' : '0'} aria-label="Teacher Tools" aria-hidden={!open} inert={!open}>
      {teaching ? (
        <TeachView />
      ) : (
        <>
          <div className="tabs" role="tablist" aria-label="Tools" style={{ '--i': TABS.findIndex((t) => t.id === tab) } as CSSProperties}>
            {/* a single glass pill slides to the selected tool */}
            <span className="tab-ind" aria-hidden="true" />
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls="tool-body"
                className="tab"
                onClick={() => setTab(t.id)}
              >
                <Icon d={t.d} size={34} stroke={tab === t.id ? 'var(--green-ic)' : 'var(--dim)'} />
                {t.label}
              </button>
            ))}
          </div>
          <div className="panel-body scroll tab-in" key={tab} id="tool-body" role="tabpanel" aria-labelledby={`tab-${tab}`}>
            {tab === 'show' && <ShowTab />}
            {tab === 'evidence' && <EvidenceTab />}
            {tab === 'draw' && <DrawTab />}
            {tab === 'view' && <ViewTab />}
          </div>
          <Footer />
        </>
      )}
    </aside>
  );
}

function Indicator() {
  return (
    <span className="ind" aria-hidden="true">
      <Icon d={PATHS.check} size={18} stroke="#F7F7F5" sw={3.4} />
    </span>
  );
}

function ToggleRow({ label, on, onClick, tall }: { label: string; on: boolean; onClick: () => void; tall?: boolean }) {
  return (
    <button className={tall ? 'row tall' : 'row'} aria-pressed={on} onClick={onClick}>
      {label}
      <Indicator />
    </button>
  );
}

// ---------------------------------------------------------------- Show
const SHOW_GROUPS: { title: string; rows: [LayerKey, string][] }[] = [
  { title: 'Structure', rows: [['surface', 'Surface'], ['plates', 'Plates'], ['mantle', 'Mantle']] },
  { title: 'Activity', rows: [['plateMotion', 'Plate motion'], ['earthquakes', 'Earthquakes'], ['magma', 'Magma'], ['volcanoes', 'Volcanoes']] },
  { title: 'Explain', rows: [['labels', 'Labels'], ['motionArrows', 'Motion arrows']] },
];
const GEOLOGY: [LayerKey, string][] = [['crust', 'Crust'], ['lithosphere', 'Lithosphere'], ['asthenosphere', 'Asthenosphere']];

function ShowTab() {
  const layers = useApp((s) => s.scene.layers);
  const toggle = useApp((s) => s.toggleLayer);
  const toggleQuakes = useApp((s) => s.toggleEarthquakes);
  const geoOpen = useApp((s) => s.geologyOpen);
  const setGeo = useApp((s) => s.setGeologyOpen);
  return (
    <div style={{ flex: 1, marginTop: 14, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {SHOW_GROUPS.map((g) => (
          <div key={g.title} role="group" aria-labelledby={`grp-${g.title}`} style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="group-title" id={`grp-${g.title}`}>{g.title}</div>
            {g.rows.map(([k, label]) => (
              <ToggleRow key={k} label={label} on={layers[k]} onClick={() => (k === 'earthquakes' ? toggleQuakes() : toggle(k))} />
            ))}
          </div>
        ))}
      </div>
      <div>
        <button className="geo-toggle" aria-expanded={geoOpen} aria-controls="geology" onClick={() => setGeo(!geoOpen)}>
          Geology
          <Icon d={PATHS.chevron} size={30} sw={2.2} />
        </button>
        {geoOpen && (
          <div id="geology" role="group" aria-label="Geology layers">
            {GEOLOGY.map(([k, label]) => (
              <ToggleRow key={k} label={label} on={layers[k]} onClick={() => toggle(k)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Evidence
const EVIDENCE: [EvidenceKey | 'earthquakes', string][] = [
  ['earthquakes', 'Earthquakes'],
  ['earthquakeDepth', 'Earthquake depth'],
  ['gps', 'Plate motion'],
  ['bathymetry', 'Bathymetry'],
  ['topography', 'Topography'],
  ['temperature', 'Temperature'],
];

function EvidenceTab() {
  const ev = useApp((s) => s.scene.evidence);
  const quakes = useApp((s) => s.scene.layers.earthquakes);
  const toggleEv = useApp((s) => s.toggleEvidence);
  const toggleQuakes = useApp((s) => s.toggleEarthquakes);
  return (
    <div style={{ flex: 1, marginTop: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {EVIDENCE.map(([k, label]) => (
        <ToggleRow
          key={k}
          tall
          label={label}
          on={k === 'earthquakes' ? quakes : ev[k]}
          onClick={() => (k === 'earthquakes' ? toggleQuakes() : toggleEv(k))}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Draw
const DRAW_TOOLS: [DrawTool, string][] = [
  ['pen', 'Pen'], ['highlighter', 'Highlighter'], ['arrow', 'Arrow'], ['circle', 'Circle'],
  ['label', 'Label'], ['spotlight', 'Spotlight'], ['eraser', 'Eraser'],
];
export const COLORS: [string, string][] = [['White', '#F7F7F5'], ['Yellow', '#F2C94C'], ['Green', '#2FBF71'], ['Blue', '#4DA3FF'], ['Red', '#E5484D']];
const WIDTHS: [string, number][] = [['Thin', 3], ['Medium', 7], ['Thick', 12]];

function DrawTab() {
  const draw = useApp((s) => s.draw);
  const setTool = useApp((s) => s.setTool);
  const setColor = useApp((s) => s.setColor);
  const setWidth = useApp((s) => s.setWidth);
  const canUndo = useApp((s) => s.history.past.length > 0);
  const canRedo = useApp((s) => s.history.future.length > 0);
  const undo = useApp((s) => s.undo);
  const redo = useApp((s) => s.redo);
  const hasMarks = useApp((s) => s.annotations.length > 0);
  const clear = useApp((s) => s.clearAnnotations);
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<number>(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!hasMarks) setConfirming(false);
  }, [hasMarks]);

  const onClear = () => {
    if (!hasMarks) return;
    if (!confirming) {
      setConfirming(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setConfirming(false), 5000);
      return;
    }
    window.clearTimeout(timer.current);
    setConfirming(false);
    clear();
  };

  const noInk = draw.tool === 'spotlight' || draw.tool === 'eraser';
  return (
    <div style={{ flex: 1, marginTop: 8, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 8, paddingBottom: 20 }}>
      <div>
        <div className="sec-label" id="lbl-tools">Tools</div>
        <div className="tool-grid" role="group" aria-labelledby="lbl-tools">
          {DRAW_TOOLS.map(([id, label]) => (
            <button key={id} className="tool" aria-pressed={draw.tool === id} onClick={() => setTool(id)}>
              <Icon d={PATHS[id]} size={34} />
              {label}
            </button>
          ))}
          <button
            className={confirming ? 'tool confirm' : 'tool'}
            onClick={onClear}
            aria-disabled={!hasMarks}
            aria-label={confirming ? 'Tap again to clear all drawings' : 'Clear all drawings'}
            style={{ opacity: hasMarks ? 1 : 0.4 }}
          >
            <Icon d={PATHS.clear} size={34} />
            {confirming ? 'Tap again' : 'Clear'}
          </button>
        </div>
      </div>
      <div>
        <div className="sec-label" id="lbl-hist">History</div>
        <div className="history" role="group" aria-labelledby="lbl-hist">
          <button className="hist" disabled={!canUndo} onClick={undo}>
            <Icon d={PATHS.undo} size={30} />
            Undo
          </button>
          <button className="hist" disabled={!canRedo} onClick={redo}>
            <Icon d={PATHS.redo} size={30} />
            Redo
          </button>
        </div>
      </div>
      <div className="dimmable" data-dim={noInk ? '1' : '0'} aria-hidden={noInk}>
        <div className="sec-label" id="lbl-color">Color</div>
        <div className="colors" role="group" aria-labelledby="lbl-color">
          {COLORS.map(([name, hex]) => (
            <button key={hex} className="swatch" aria-label={name} aria-pressed={draw.color === hex} disabled={noInk} onClick={() => setColor(hex)}>
              <span className="ring">
                <span className="fill" style={{ background: hex }} />
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="dimmable" data-dim={noInk ? '1' : '0'} aria-hidden={noInk}>
        <div className="sec-label" id="lbl-width">Width</div>
        <div className="widths" role="group" aria-labelledby="lbl-width">
          {WIDTHS.map(([label, px]) => (
            <button key={label} className="width-opt" aria-pressed={draw.width === px} disabled={noInk} onClick={() => setWidth(px)}>
              <svg width="64" height="14" viewBox="0 0 64 14" aria-hidden="true">
                <line x1="8" y1="7" x2="56" y2="7" stroke="currentColor" strokeWidth={px} strokeLinecap="round" />
              </svg>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- View
const VIEWS: [ViewMode, string][] = [['surface', 'Surface'], ['combined', 'Combined'], ['section', 'Cross-section']];
const FOCUS: [FocusKey, string][] = [
  ['trench', 'Ocean trench'], ['subduction', 'Subduction zone'], ['earthquakes', 'Earthquakes'], ['wedge', 'Mantle wedge'], ['arc', 'Volcanic arc'],
];
const previewCache = new Map<string, string>();

function usePreviews() {
  const engine = useContext(EngineCtx);
  const [, bump] = useState(0);
  useEffect(() => {
    if (!engine || previewCache.size) return;
    // Render the stills after the panel animation so the first frame is not delayed.
    const id = window.setTimeout(() => {
      for (const [v] of VIEWS) previewCache.set(v, engine.capture({ view: v }, 376, 210));
      for (const [f] of FOCUS) previewCache.set(f, engine.capture({ focus: f }, 88, 88));
      bump((n) => n + 1);
    }, 450);
    return () => window.clearTimeout(id);
  }, [engine]);
  return previewCache;
}

function ViewTab() {
  const view = useApp((s) => s.scene.view);
  const focus = useApp((s) => s.scene.focus);
  const setView = useApp((s) => s.setView);
  const setFocus = useApp((s) => s.setFocus);
  const previews = usePreviews();
  const img = previews.get(view);
  return (
    <div style={{ flex: 1, marginTop: 18, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="seg" role="group" aria-label="View" data-free={focus ? '1' : '0'} style={{ '--i': VIEWS.findIndex((v) => v[0] === view) } as CSSProperties}>
          <span className="seg-ind" aria-hidden="true" />
          {VIEWS.map(([id, label]) => (
            <button key={id} aria-pressed={view === id && !focus} onClick={() => setView(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="preview" role="img" aria-label={`${VIEWS.find((v) => v[0] === view)?.[1]} view preview`} style={{ backgroundImage: img ? `url(${img})` : undefined }} />
      </div>
      <div role="group" aria-labelledby="lbl-focus" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="group-title" id="lbl-focus">Focus</div>
        {FOCUS.map(([id, label]) => (
          <button key={id} className="focus-row" aria-pressed={focus === id} onClick={() => setFocus(focus === id ? null : id)}>
            <span className="thumb" style={{ backgroundImage: previews.get(id) ? `url(${previews.get(id)})` : undefined }} />
            {label}
          </button>
        ))}
      </div>
      <p className="credit">
        Central Andes, 23.4° S. Imagery: Copernicus Sentinel-2 (2020), Sentinel Hub, CC BY 4.0. Elevation: Mapzen Terrarium.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- Footer
function Footer() {
  const startTeach = useApp((s) => s.startTeach);
  const reset = useApp((s) => s.reset);
  return (
    <div className="footer">
      <button className="teach-row" onClick={startTeach}>
        <Icon d={PATHS.teach} size={40} stroke="#F7F7F5" />
        <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span className="t1">Teach</span>
          <span className="t2">Guided sequence</span>
        </span>
        <Icon d={PATHS.chevron} size={32} stroke="var(--text-2)" sw={2.2} />
      </button>
      <div className="util">
        <button className="l" onClick={reset} aria-label="Reset visualization">
          <Icon d={PATHS.reset} size={28} />
          Reset
        </button>
        <CollapseButton />
      </div>
    </div>
  );
}

function CollapseButton() {
  const setOpen = useApp((s) => s.setPanelOpen);
  return (
    <button className="r" aria-label="Collapse Teacher Tools" onClick={() => setOpen(false)}>
      Collapse
      <Icon d={PATHS.collapse} size={28} />
    </button>
  );
}

// ---------------------------------------------------------------- Teach
function TeachView() {
  const step = useApp((s) => s.teach.step);
  const go = useApp((s) => s.teachGo);
  const exit = useApp((s) => s.exitTeach);
  const s = TEACH_STEPS[step];
  const last = step === TEACH_STEPS.length - 1;
  const headRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headRef.current?.focus({ preventScroll: true });
  }, [step]);
  return (
    <div className="teach">
      <div className="count" aria-live="polite">
        {step + 1} of {TEACH_STEPS.length}
      </div>
      <div className="dots">
        {TEACH_STEPS.map((t, i) => (
          <button key={t.title} aria-label={`Step ${i + 1}: ${t.title}`} aria-current={i === step ? 'step' : undefined} onClick={() => go(i)}>
            <span data-on={i <= step ? '1' : '0'} />
          </button>
        ))}
      </div>
      <div className="scroll step-in" key={step} style={{ flex: 1, minHeight: 0 }}>
        <h2 ref={headRef} tabIndex={-1} style={{ outline: 'none' }}>
          {s.title}
        </h2>
        <div className="lead">{s.note}</div>
        <div className="ask-l">Ask students</div>
        <div className="ask">{s.ask}</div>
      </div>
      <div className="footer" style={{ margin: '0 -8px' }}>
        <div className="nav">
          <button className="prev" disabled={step === 0} onClick={() => go(step - 1)}>
            Previous
          </button>
          <button className="next" onClick={() => (last ? exit() : go(step + 1))}>
            {last ? 'Finish' : 'Next'}
          </button>
        </div>
        <div className="util">
          <button className="l" onClick={exit}>
            <Icon d={PATHS.exitTeach} size={28} />
            Exit teaching
          </button>
          <CollapseButton />
        </div>
      </div>
    </div>
  );
}
