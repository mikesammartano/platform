import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useApp } from '../state/store';
import type { Annotation } from '../state/types';
import { EngineCtx } from './context';

type Pt = [number, number];
type W3 = [number, number, number];
let nextId = 1;

/** Screen-space copy of an annotation for drawing and hit testing. Null points are behind the camera. */
type Projected = { a: Annotation; pts: (Pt | null)[] };

function drawItem(ctx: CanvasRenderingContext2D, { a, pts }: Projected, s: number) {
  if (!pts.some(Boolean)) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = a.color;
  ctx.fillStyle = a.color;
  const w = a.width * s;
  // a soft dark edge keeps marks readable over bright and dark parts of the scene
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 6 * s;
  if (a.kind === 'pen' || a.kind === 'highlighter') {
    if (a.kind === 'highlighter') {
      ctx.globalAlpha = 0.36;
      ctx.lineWidth = w * 3.4;
      ctx.shadowBlur = 0;
    } else ctx.lineWidth = w;
    ctx.beginPath();
    let open = false;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (!p) {
        open = false;
        continue;
      }
      const nxt = pts[i + 1];
      if (!open) {
        ctx.moveTo(p[0], p[1]);
        if (!nxt) ctx.lineTo(p[0] + 0.01, p[1]);
        open = true;
      } else if (nxt) ctx.quadraticCurveTo(p[0], p[1], (p[0] + nxt[0]) / 2, (p[1] + nxt[1]) / 2);
      else ctx.lineTo(p[0], p[1]);
    }
    ctx.stroke();
  } else if (a.kind === 'arrow' && pts[0] && pts[1]) {
    const [p0, p1] = [pts[0], pts[1]];
    const ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
    const head = 14 * s + w * 2.4;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0] - Math.cos(ang) * head * 0.6, p1[1] - Math.sin(ang) * head * 0.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p1[0], p1[1]);
    ctx.lineTo(p1[0] - Math.cos(ang - 0.45) * head, p1[1] - Math.sin(ang - 0.45) * head);
    ctx.lineTo(p1[0] - Math.cos(ang + 0.45) * head, p1[1] - Math.sin(ang + 0.45) * head);
    ctx.closePath();
    ctx.fill();
  } else if (a.kind === 'circle' && pts[0] && pts[1]) {
    const [p0, p1] = [pts[0], pts[1]];
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.ellipse((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, Math.abs(p1[0] - p0[0]) / 2, Math.abs(p1[1] - p0[1]) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (a.kind === 'label' && a.text && pts[0]) {
    const p = pts[0];
    ctx.font = `600 ${Math.round((24 + a.width * 1.4) * s)}px Geist, system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.shadowBlur = 0;
    ctx.lineWidth = 6 * s;
    ctx.strokeStyle = 'rgba(5,5,5,0.7)';
    ctx.strokeText(a.text, p[0], p[1]);
    ctx.fillText(a.text, p[0], p[1]);
  }
  ctx.restore();
}

const segDist = (p: Pt, a: Pt, b: Pt) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};

function hit({ a, pts }: Projected, P: Pt, r: number) {
  if (a.kind === 'circle') {
    if (!pts[0] || !pts[1]) return false;
    const [p0, p1] = [pts[0], pts[1]];
    const cx = (p0[0] + p1[0]) / 2;
    const cy = (p0[1] + p1[1]) / 2;
    const rx = Math.abs(p1[0] - p0[0]) / 2;
    const ry = Math.abs(p1[1] - p0[1]) / 2;
    for (let i = 0; i < 48; i++) {
      const t0 = (i / 48) * Math.PI * 2;
      const t1 = ((i + 1) / 48) * Math.PI * 2;
      if (segDist(P, [cx + rx * Math.cos(t0), cy + ry * Math.sin(t0)], [cx + rx * Math.cos(t1), cy + ry * Math.sin(t1)]) < r) return true;
    }
    return false;
  }
  if (a.kind === 'label') {
    const q = pts[0];
    if (!q) return false;
    const w = (a.text?.length ?? 1) * (14 + a.width) * (r / 22);
    return P[0] > q[0] - r && P[0] < q[0] + w + r && Math.abs(P[1] - q[1]) < r * 1.4;
  }
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (!p) continue;
    const q = pts[i + 1];
    if (q ? segDist(P, p, q) < r + a.width : Math.hypot(P[0] - p[0], P[1] - p[1]) < r) return true;
  }
  return false;
}

export function Ink({ uiScale, panelInset }: { uiScale: number; panelInset: number }) {
  const engine = useContext(EngineCtx);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const annotations = useApp((s) => s.annotations);
  const draw = useApp((s) => s.draw);
  const commit = useApp((s) => s.commitAnnotations);
  const active = useApp((s) => s.panelOpen && !s.presenting && !s.teach.active && s.tab === 'draw');
  const live = useRef<Annotation | null>(null);
  const erasing = useRef<Set<number> | null>(null);
  const pointer = useRef<number | null>(null);
  const lastScreen = useRef<Pt>([0, 0]);
  const [spot, setSpot] = useState<Pt | null>(null);
  const [editing, setEditing] = useState<{ w: W3; text: string } | null>(null);
  const size = useRef({ W: 1, H: 1, dpr: 1 });

  const projectAll = useCallback(
    (list: Annotation[]): Projected[] => (engine ? list.map((a) => ({ a, pts: a.points.map((p) => engine.project(p)) })) : []),
    [engine],
  );

  const redraw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const { W, H, dpr } = size.current;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const hidden = erasing.current;
    const list = useApp.getState().annotations.filter((a) => !hidden?.has(a.id));
    if (live.current) list.push(live.current);
    for (const p of projectAll(list)) drawItem(ctx, p, uiScale);
  }, [uiScale, projectAll]);

  useEffect(() => {
    const onResize = () => {
      const c = canvasRef.current;
      if (!c) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      size.current = { W: window.innerWidth, H: window.innerHeight, dpr };
      c.width = Math.round(window.innerWidth * dpr);
      c.height = Math.round(window.innerHeight * dpr);
      redraw();
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [redraw]);

  // marks are attached to the scene, so they follow every camera move
  useEffect(() => engine?.onCamera(redraw), [engine, redraw]);
  useEffect(redraw, [annotations, redraw]);

  const tool = draw.tool;
  const spotOn = active && tool === 'spotlight';
  useEffect(() => {
    if (spotOn) setSpot((cur) => cur ?? [(window.innerWidth - panelInset) / 2, window.innerHeight / 2]);
    else setSpot(null);
  }, [spotOn, panelInset]);

  const pick = (e: React.PointerEvent): W3 => (engine ? engine.pick(e.clientX, e.clientY) : [0, 0, 0]);

  const finishLabel = (save: boolean) => {
    if (editing && save && editing.text.trim()) {
      commit([...useApp.getState().annotations, { id: nextId++, kind: 'label', color: draw.color, width: draw.width, points: [editing.w], text: editing.text.trim() }]);
    }
    setEditing(null);
  };

  const eraseAt = (P: Pt) => {
    for (const p of projectAll(useApp.getState().annotations)) if (hit(p, P, 22 * uiScale)) erasing.current!.add(p.a.id);
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active || pointer.current !== null || !engine) return;
    if (editing) {
      finishLabel(true);
      return;
    }
    pointer.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    lastScreen.current = [e.clientX, e.clientY];
    if (tool === 'spotlight') setSpot([e.clientX, e.clientY]);
    else if (tool === 'label') {
      // keep the browser's default focus change from immediately blurring the new text box
      e.preventDefault();
      setEditing({ w: pick(e), text: '' });
    }
    else if (tool === 'eraser') {
      erasing.current = new Set();
      eraseAt([e.clientX, e.clientY]);
    } else {
      const w = pick(e);
      live.current = { id: nextId++, kind: tool, color: draw.color, width: draw.width, points: tool === 'pen' || tool === 'highlighter' ? [w] : [w, w] };
    }
    redraw();
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (spotOn) setSpot([e.clientX, e.clientY]);
    if (e.pointerId !== pointer.current) return;
    const l = live.current;
    if (l) {
      if (l.kind === 'pen' || l.kind === 'highlighter') {
        const [lx, ly] = lastScreen.current;
        if (Math.hypot(e.clientX - lx, e.clientY - ly) < 3) return;
        l.points.push(pick(e));
      } else l.points[1] = pick(e);
      lastScreen.current = [e.clientX, e.clientY];
      redraw();
    } else if (erasing.current) {
      eraseAt([e.clientX, e.clientY]);
      redraw();
    }
  };

  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerId !== pointer.current) return;
    pointer.current = null;
    const l = live.current;
    live.current = null;
    const all = useApp.getState().annotations;
    if (l) {
      const a = engine?.project(l.points[0]);
      const b = engine?.project(l.points[l.points.length - 1]);
      const len = a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0;
      const keep = l.kind === 'pen' || l.kind === 'highlighter' || len > 12;
      if (keep) commit([...all, l]);
      else redraw();
    } else if (erasing.current) {
      const ids = erasing.current;
      erasing.current = null;
      if (ids.size) commit(all.filter((x) => !ids.has(x.id)));
      else redraw();
    }
  };

  const R = 250 * uiScale;
  const editAt = editing && engine ? engine.project(editing.w) : null;
  return (
    <>
      {spot && (
        <div
          className="spot"
          style={{
            background: `radial-gradient(circle ${R}px at ${spot[0]}px ${spot[1]}px, rgba(0,0,0,0) 0, rgba(0,0,0,0) ${190 * uiScale}px, rgba(0,0,0,.66) ${330 * uiScale}px, rgba(0,0,0,.66) 100%)`,
          }}
        />
      )}
      <canvas
        ref={canvasRef}
        className="ink"
        data-active={active ? '1' : '0'}
        data-tool={tool}
        aria-hidden="true"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />
      {editing && editAt && (
        <input
          className="ink-input"
          autoFocus
          aria-label="Label text"
          value={editing.text}
          maxLength={60}
          style={{ left: editAt[0], top: editAt[1], color: draw.color, fontSize: Math.round((24 + draw.width * 1.4) * uiScale) }}
          onChange={(e) => setEditing({ ...editing, text: e.target.value })}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') finishLabel(true);
            if (e.key === 'Escape') finishLabel(false);
          }}
          onBlur={() => finishLabel(true)}
        />
      )}
    </>
  );
}
