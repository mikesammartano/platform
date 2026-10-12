import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../state/store';
import type { Annotation } from '../state/types';

type Pt = [number, number];
let nextId = 1;

function drawItem(ctx: CanvasRenderingContext2D, a: Annotation, W: number, H: number, s: number) {
  const px = (p: Pt): Pt => [p[0] * W, p[1] * H];
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
    const pts = a.points.map(px);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.01, pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    if (pts.length > 1) ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    ctx.stroke();
  } else if (a.kind === 'arrow') {
    const [p0, p1] = a.points.map(px);
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
  } else if (a.kind === 'circle') {
    const [p0, p1] = a.points.map(px);
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.ellipse((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, Math.abs(p1[0] - p0[0]) / 2, Math.abs(p1[1] - p0[1]) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (a.kind === 'label' && a.text) {
    const [p] = a.points.map(px);
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

function hit(a: Annotation, p: Pt, W: number, H: number, r: number) {
  const px = (q: Pt): Pt => [q[0] * W, q[1] * H];
  const P = px(p);
  if (a.kind === 'circle') {
    const [p0, p1] = a.points.map(px);
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
    const q = px(a.points[0]);
    const w = (a.text?.length ?? 1) * (14 + a.width) * (r / 22);
    return P[0] > q[0] - r && P[0] < q[0] + w + r && Math.abs(P[1] - q[1]) < r * 1.4;
  }
  const pts = a.points.map(px);
  if (pts.length === 1) return Math.hypot(P[0] - pts[0][0], P[1] - pts[0][1]) < r;
  for (let i = 0; i < pts.length - 1; i++) if (segDist(P, pts[i], pts[i + 1]) < r + a.width) return true;
  return false;
}

export function Ink({ uiScale, panelInset }: { uiScale: number; panelInset: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const annotations = useApp((s) => s.annotations);
  const draw = useApp((s) => s.draw);
  const commit = useApp((s) => s.commitAnnotations);
  const active = useApp((s) => s.panelOpen && !s.presenting && !s.teach.active && s.tab === 'draw');
  const live = useRef<Annotation | null>(null);
  const erasing = useRef<Set<number> | null>(null);
  const pointer = useRef<number | null>(null);
  const [spot, setSpot] = useState<Pt | null>(null);
  const [editing, setEditing] = useState<{ p: Pt; text: string } | null>(null);
  const size = useRef({ W: 1, H: 1, dpr: 1 });

  const redraw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const { W, H, dpr } = size.current;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const hidden = erasing.current;
    for (const a of useApp.getState().annotations) if (!hidden?.has(a.id)) drawItem(ctx, a, W, H, uiScale);
    if (live.current) drawItem(ctx, live.current, W, H, uiScale);
  }, [uiScale]);

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

  useEffect(redraw, [annotations, redraw]);

  const tool = draw.tool;
  const spotOn = active && tool === 'spotlight';
  useEffect(() => {
    if (spotOn && !spot) setSpot([(window.innerWidth - panelInset) / 2, window.innerHeight / 2]);
    if (!spotOn) setSpot(null);
  }, [spotOn]);

  const norm = (e: React.PointerEvent): Pt => [e.clientX / size.current.W, e.clientY / size.current.H];

  const finishLabel = (save: boolean) => {
    if (editing && save && editing.text.trim()) {
      commit([...useApp.getState().annotations, { id: nextId++, kind: 'label', color: draw.color, width: draw.width, points: [editing.p], text: editing.text.trim() }]);
    }
    setEditing(null);
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active || pointer.current !== null) return;
    if (editing) {
      finishLabel(true);
      return;
    }
    pointer.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = norm(e);
    if (tool === 'spotlight') setSpot([e.clientX, e.clientY]);
    else if (tool === 'label') setEditing({ p, text: '' });
    else if (tool === 'eraser') {
      erasing.current = new Set();
      eraseAt(p);
    } else live.current = { id: nextId++, kind: tool, color: draw.color, width: draw.width, points: tool === 'pen' || tool === 'highlighter' ? [p] : [p, p] };
    redraw();
  };

  const eraseAt = (p: Pt) => {
    const { W, H } = size.current;
    for (const a of useApp.getState().annotations) if (hit(a, p, W, H, 22 * uiScale)) erasing.current!.add(a.id);
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (spotOn) setSpot([e.clientX, e.clientY]);
    if (e.pointerId !== pointer.current) return;
    const p = norm(e);
    const l = live.current;
    if (l) {
      if (l.kind === 'pen' || l.kind === 'highlighter') {
        const last = l.points[l.points.length - 1];
        if (Math.hypot((p[0] - last[0]) * size.current.W, (p[1] - last[1]) * size.current.H) > 2) l.points.push(p);
      } else l.points[1] = p;
      redraw();
    } else if (erasing.current) {
      eraseAt(p);
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
      const [a, b] = [l.points[0], l.points[l.points.length - 1]];
      const len = Math.hypot((b[0] - a[0]) * size.current.W, (b[1] - a[1]) * size.current.H);
      const keep = l.kind === 'pen' || l.kind === 'highlighter' || len > 12;
      if (keep) commit([...all, l]);
      else redraw();
    } else if (erasing.current) {
      const ids = erasing.current;
      erasing.current = null;
      if (ids.size) commit(all.filter((a) => !ids.has(a.id)));
      else redraw();
    }
  };

  const R = 250 * uiScale;
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
      {editing && (
        <input
          className="ink-input"
          autoFocus
          aria-label="Label text"
          placeholder="Type a label"
          value={editing.text}
          maxLength={60}
          style={{ left: editing.p[0] * size.current.W, top: editing.p[1] * size.current.H, color: draw.color, fontSize: Math.round((24 + draw.width * 1.4) * uiScale) }}
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
